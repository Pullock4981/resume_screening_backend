const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getUsersFromSheet, saveUserToSheet, updateUserInSheet, logUserLoginToSheet } = require('../config/googleSheets');
const { JWT_SECRET } = require('../middleware/authMiddleware');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

/**
 * Validate organizational email requirement:
 * Email must contain either '.ph@gmail.com' or 'programming-hero.com'
 */
const isValidOrgEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(clean)) return false;
  return clean.includes('.ph@gmail.com') || clean.includes('programming-hero.com');
};

const handleRegister = async (req, res) => {
  try {
    const { name, email, password, team, adminSecret } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
    }

    if (!team || !team.trim()) {
      return res.status(400).json({ success: false, error: 'Please select your Team Name (Nexen, Alpha, Delta, Supernuva, or PRM).' });
    }

    const cleanTeam = team.trim();

    if (password.length < 4) {
      return res.status(400).json({ success: false, error: 'Password must be at least 4 characters long.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Enforce email verification rule: must contain .ph@gmail.com or programming-hero.com
    if (!isValidOrgEmail(cleanEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email address. Email must contain ".ph@gmail.com" or "programming-hero.com" (e.g. name.ph@gmail.com or name@programming-hero.com).'
      });
    }

    const existingUsers = await getUsersFromSheet();

    // Check if user already registered
    const userExists = existingUsers.some(u => u.email === cleanEmail);
    if (userExists) {
      return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please log in.' });
    }

    // Role is strictly 'user' for anyone registering. Status is 'pending' requiring admin approval.
    let role = 'user';
    let status = 'pending';

    // Only master central admin is auto-granted active admin
    if (cleanEmail === 'nexadmin.ph@gmail.com') {
      role = 'admin';
      status = 'active';
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userId = `usr_${Date.now()}`;
    const newUser = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      role,
      status,
      team: cleanTeam,
      createdAt: new Date().toISOString()
    };

    // Save user to Central Master Google Sheet Users tab
    await saveUserToSheet(null, newUser);

    // If pending approval, DO NOT issue session token; notify user
    if (status === 'pending') {
      await logUserLoginToSheet(null, {
        email: cleanEmail,
        role: 'user',
        details: `New user registered [Team: ${cleanTeam}] — Pending admin approval`
      });

      return res.status(201).json({
        success: true,
        pendingApproval: true,
        message: 'Account registered successfully! An administrator must approve your account before you can log in.'
      });
    }

    // Auto-login only for master admins
    await logUserLoginToSheet(null, {
      email: cleanEmail,
      role,
      details: `Master admin registered [Team: ${cleanTeam}] and logged in`
    });

    const tokenPayload = { id: userId, name: newUser.name, email: cleanEmail, role, status: 'active', team: cleanTeam };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    return res.status(201).json({
      success: true,
      message: 'Registration successful.',
      token,
      user: tokenPayload
    });
  } catch (err) {
    console.error('Registration Error:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Registration failed.' });
  }
};

const handleLogin = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Enforce email verification rule for login (.ph@gmail.com or programming-hero.com)
    if (!isValidOrgEmail(cleanEmail) && cleanEmail !== 'admin@admin.com') {
      return res.status(400).json({
        success: false,
        error: 'Invalid email address. Access is restricted to ".ph@gmail.com" and "programming-hero.com" emails.'
      });
    }

    // Direct Master Admin Authentication (Guaranteed instant login without sheet latency)
    if (cleanEmail === 'nexadmin.ph@gmail.com' && password === '@1234Admin') {
      const adminPayload = {
        id: 'usr_admin_nex',
        name: 'Nex Admin',
        email: cleanEmail,
        role: 'admin',
        status: 'active'
      };
      const token = jwt.sign(adminPayload, JWT_SECRET, { expiresIn: '24h' });

      // Save/Ensure user in Google Sheet in background
      (async () => {
        try {
          const salt = await bcrypt.genSalt(10);
          const passwordHash = await bcrypt.hash(password, salt);
          await saveUserToSheet(null, {
            ...adminPayload,
            passwordHash,
            createdAt: new Date().toISOString()
          });
          await logUserLoginToSheet(null, {
            email: cleanEmail,
            role: 'admin',
            details: 'Master Admin Login'
          });
        } catch (e) {
          console.warn('Background admin sheet sync notice:', e.message);
        }
      })();

      return res.status(200).json({
        success: true,
        message: 'Login successful.',
        token,
        user: adminPayload
      });
    }

    let users = [];
    try {
      users = await getUsersFromSheet();
    } catch (sheetErr) {
      console.warn('Failed to fetch users from Google Sheet:', sheetErr.message);
    }

    const user = users.find(u => u.email === cleanEmail);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    if (user.status === 'banned') {
      return res.status(403).json({ success: false, error: 'Your account has been banned by an administrator.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({
        success: false,
        error: 'Your account is pending administrator approval. Please contact central admin to approve your account before logging in.'
      });
    }

    // Verify Password Hash
    let isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch && cleanEmail === 'nexadmin.ph@gmail.com' && password === '@1234Admin') {
      isMatch = true;
    }
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // Log login entry to Google Sheet Login_Logs tab
    let userRole = user.role || 'user';
    if (cleanEmail === 'nexadmin.ph@gmail.com') {
      userRole = 'admin';
    }

    logUserLoginToSheet(null, {
      email: cleanEmail,
      role: userRole,
      details: 'Successful user login'
    }).catch(() => {});

    // Sign 24-hour JWT Token
    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: cleanEmail,
      role: userRole,
      status: user.status,
      team: user.team || ''
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: tokenPayload
    });
  } catch (err) {
    console.error('Login Error:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Login failed.' });
  }
};

const handleGetMe = async (req, res) => {
  try {
    if (req.user && req.user.email === 'nexadmin.ph@gmail.com') {
      return res.status(200).json({
        success: true,
        user: {
          id: req.user.id || 'usr_admin_nex',
          name: req.user.name || 'Nex Admin',
          email: 'nexadmin.ph@gmail.com',
          role: 'admin',
          status: 'active',
          team: 'Nexen'
        }
      });
    }

    let users = [];
    try {
      users = await getUsersFromSheet();
    } catch (e) {}

    const user = users.find(u => u.id === req.user.id || u.email === req.user.email);
    if (!user) {
      if (req.user) {
        return res.status(200).json({
          success: true,
          user: {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
            role: req.user.role,
            status: req.user.status || 'active',
            team: req.user.team || ''
          }
        });
      }
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (user.status === 'banned') {
      return res.status(403).json({ success: false, error: 'Account banned.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ success: false, error: 'Account is pending admin approval.' });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        team: user.team || ''
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const handleChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required.' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ success: false, error: 'New password must be at least 4 characters long.' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, error: 'New password must be different from your current password.' });
    }

    const email = (req.user?.email || '').trim().toLowerCase();
    const userId = req.user?.id;

    if (!email) {
      return res.status(401).json({ success: false, error: 'Unauthorized user session.' });
    }

    // Get users from sheet
    const users = await getUsersFromSheet();
    const targetUser = users.find(u => 
      (u.email && u.email.toLowerCase() === email) || 
      (u.id && u.id === userId)
    );

    let isMatch = false;
    // Check root admin fallback password
    if (email === 'nexadmin.ph@gmail.com' && currentPassword === '@1234Admin') {
      isMatch = true;
    }

    if (!isMatch && targetUser && targetUser.passwordHash) {
      isMatch = await bcrypt.compare(currentPassword, targetUser.passwordHash);
    }

    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect. Please check and try again.' });
    }

    // Hash new password using bcrypt
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // Save updated password hash to Google Sheet Users tab
    const targetUserId = targetUser ? targetUser.id : (userId || email);
    if (targetUser) {
      await updateUserInSheet(null, targetUserId, {
        passwordHash: newPasswordHash
      });
    } else {
      await saveUserToSheet(null, {
        id: userId || `usr_${Date.now()}`,
        name: req.user?.name || email.split('@')[0],
        email,
        passwordHash: newPasswordHash,
        role: req.user?.role || 'user',
        status: req.user?.status || 'active',
        createdAt: new Date().toISOString(),
        team: req.user?.team || 'Nexen'
      });
    }

    // Log password change event
    logUserLoginToSheet(null, {
      email,
      role: req.user?.role || 'user',
      details: 'Account password changed successfully'
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully! Please use your new password for future logins.'
    });
  } catch (err) {
    console.error('Change Password Error:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Failed to change password.' });
  }
};

module.exports = {
  handleRegister,
  handleLogin,
  handleGetMe,
  handleChangePassword
};
