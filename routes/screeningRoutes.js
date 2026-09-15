const express = require('express');
const router = express.Router();
const { handleScreening, handleSSEProgress } = require('../controllers/screeningController');

router.post('/screen', handleScreening);
router.get('/progress', handleSSEProgress);

module.exports = router;
