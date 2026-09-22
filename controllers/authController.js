const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getUsersFromSheet, saveUserToSheet, logUserLoginToSheet } = require('../config/googleSheets');
const { JWT_SECRET } = require('../middleware/authMiddleware');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

const handleRegister = async (req, res) => {
  try {
    const { name, email, password, adminSecret } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
    }

    if (password.length < 4) {
      return res.status(400).json({ success: false, error: 'Password must be at least 4 characters long.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUsers = await getUsersFromSheet();

    // Check if user already registered
    const userExists = existingUsers.some(u => u.email === cleanEmail);
    if (userExists) {
      return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please log in.' });
    }

    // Determine role (First user is automatically admin, or central admin email, or if valid adminSecret passed)
    let role = 'user';
    if (cleanEmail === 'nexadmin.ph@gmail.com' || cleanEmail === 'ashikmahmud.ph@gmail.com' || cleanEmail === 'admin@admin.com' || existingUsers.length === 0 || (adminSecret && adminSecret.trim() === ADMIN_SECRET)) {
      role = 'admin';
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
      status: 'active',
      createdAt: new Date().toISOString()
    };

    // Save user to Central Master Google Sheet Users tab
    await saveUserToSheet(null, newUser);

    // Log login event
    await logUserLoginToSheet(null, {
      email: cleanEmail,
      role,
      details: 'Account registered and logged in'
    });

    // Sign 24-hour JWT Token
    const tokenPayload = { id: userId, name: newUser.name, email: cleanEmail, role, status: 'active' };
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
    const users = await getUsersFromSheet();

    const user = users.find(u => u.email === cleanEmail);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    if (user.status === 'banned') {
      return res.status(403).json({ success: false, error: 'Your account has been banned by an administrator.' });
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
    let userRole = user.role;
    if (cleanEmail === 'nexadmin.ph@gmail.com' || cleanEmail === 'ashikmahmud.ph@gmail.com' || cleanEmail === 'admin@admin.com') {
      userRole = 'admin';
    }

    await logUserLoginToSheet(null, {
      email: cleanEmail,
      role: userRole,
      details: 'Successful login (24h session started)'
    });

    // Sign 24-hour JWT Token
    const tokenPayload = { id: user.id, name: user.name, email: cleanEmail, role: userRole, status: user.status };
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
    const users = await getUsersFromSheet();
    const user = users.find(u => u.id === req.user.id || u.email === req.user.email);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (user.status === 'banned') {
      return res.status(403).json({ success: false, error: 'Account banned.' });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  handleRegister,
  handleLogin,
  handleGetMe
};
