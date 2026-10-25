const express = require('express');
const router = express.Router();
const { handleScreening, handleSSEProgress, handleGetHistory, handleAtsCheck, handleLogActivity, handleGetActivityLogs, handleGithubCheck, handleLinkedinCheck } = require('../controllers/screeningController');
const { handleRegister, handleLogin, handleGetMe, handleChangePassword } = require('../controllers/authController');
const { handleGetUsers, handleUpdateUserStatus, handleUpdateUserRole, handleEditUser, handleGetLoginLogs } = require('../controllers/adminController');
const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');

// Screening Routes
router.post('/screen', handleScreening);
router.post('/ats-check', handleAtsCheck);
router.post('/github-check', handleGithubCheck);
router.post('/linkedin-check', handleLinkedinCheck);
router.get('/progress', handleSSEProgress);
router.get('/history', handleGetHistory);


// Activity Audit Log Routes
router.post('/activity/log', verifyToken, handleLogActivity);
router.get('/activity/logs', verifyToken, handleGetActivityLogs);

// Authentication Routes
router.post('/auth/register', handleRegister);
router.post('/auth/login', handleLogin);
router.get('/auth/me', verifyToken, handleGetMe);
router.post('/auth/change-password', verifyToken, handleChangePassword);

// Admin Control Panel Routes
router.get('/admin/users', verifyToken, requireAdmin, handleGetUsers);
router.put('/admin/users/:userId/status', verifyToken, requireAdmin, handleUpdateUserStatus);
router.put('/admin/users/:userId/role', verifyToken, requireAdmin, handleUpdateUserRole);
router.put('/admin/users/:userId/edit', verifyToken, requireAdmin, handleEditUser);
router.get('/admin/login-logs', verifyToken, requireAdmin, handleGetLoginLogs);

module.exports = router;
