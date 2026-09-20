const express = require('express');
const router = express.Router();
const { handleScreening, handleSSEProgress, handleGetHistory, handleAtsCheck } = require('../controllers/screeningController');
const { handleRegister, handleLogin, handleGetMe } = require('../controllers/authController');
const { handleGetUsers, handleUpdateUserStatus, handleUpdateUserRole, handleEditUser, handleGetLoginLogs } = require('../controllers/adminController');
const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');

// Screening Routes
router.post('/screen', handleScreening);
router.post('/ats-check', handleAtsCheck);
router.get('/progress', handleSSEProgress);
router.get('/history', handleGetHistory);

// Authentication Routes
router.post('/auth/register', handleRegister);
router.post('/auth/login', handleLogin);
router.get('/auth/me', verifyToken, handleGetMe);

// Admin Control Panel Routes
router.get('/admin/users', verifyToken, requireAdmin, handleGetUsers);
router.put('/admin/users/:userId/status', verifyToken, requireAdmin, handleUpdateUserStatus);
router.put('/admin/users/:userId/role', verifyToken, requireAdmin, handleUpdateUserRole);
router.put('/admin/users/:userId/edit', verifyToken, requireAdmin, handleEditUser);
router.get('/admin/login-logs', verifyToken, requireAdmin, handleGetLoginLogs);

module.exports = router;
