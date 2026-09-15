const express = require('express');
const router = express.Router();
const { handleScreening, handleSSEProgress, handleGetHistory } = require('../controllers/screeningController');

router.post('/screen', handleScreening);
router.get('/progress', handleSSEProgress);
router.get('/history', handleGetHistory);

module.exports = router;
