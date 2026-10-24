const { getUsersFromSheet, updateUserInSheet, getLoginLogsFromSheet } = require('../config/googleSheets');

const handleGetUsers = async (req, res) => {
  try {
    const rawUsers = await getUsersFromSheet();
    const seen = new Set();
    const safeUsers = [];

    for (const u of rawUsers) {
      const key = (u.id || u.email || '').trim().toLowerCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);

      safeUsers.push({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        team: u.team || '',
        createdAt: u.createdAt
      });
    }

    return res.status(200).json({ success: true, users: safeUsers });
  } catch (err) {
    console.error('Fetch Users Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const handleUpdateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;

    if (!['active', 'banned', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be "active", "pending", or "banned".' });
    }

    await updateUserInSheet(null, userId, { status });
    return res.status(200).json({ success: true, message: `User status updated to ${status}.` });
  } catch (err) {
    console.error('Update Status Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const handleUpdateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Role must be "admin" or "user".' });
    }

    await updateUserInSheet(null, userId, { role });
    return res.status(200).json({ success: true, message: `User role updated to ${role}.` });
  } catch (err) {
    console.error('Update Role Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const handleEditUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, team } = req.body || {};

    if (!name && !email && team === undefined) {
      return res.status(400).json({ success: false, error: 'Name, email, or team is required.' });
    }

    await updateUserInSheet(null, userId, { name, email, team });
    return res.status(200).json({ success: true, message: 'User updated successfully.' });
  } catch (err) {
    console.error('Edit User Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const handleGetLoginLogs = async (req, res) => {
  try {
    const logs = await getLoginLogsFromSheet();
    return res.status(200).json({ success: true, logs });
  } catch (err) {
    console.error('Fetch Logs Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  handleGetUsers,
  handleUpdateUserStatus,
  handleUpdateUserRole,
  handleEditUser,
  handleGetLoginLogs
};
