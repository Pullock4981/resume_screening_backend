const express = require('express');
const router = express.Router();
const { handleScreening, handleSSEProgress, handleGetHistory, handleAtsCheck } = require('../controllers/screeningController');

router.post('/screen', handleScreening);
router.post('/ats-check', handleAtsCheck);
router.get('/progress', handleSSEProgress);
router.get('/history', handleGetHistory);

module.exports = router;
