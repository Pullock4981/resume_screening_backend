const express = require('express');
const cors = require('cors');
require('dotenv').config();

const screeningRoutes = require('./routes/screeningRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Root Health Check Endpoint
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Resume Screener Express Engine' });
});

// API Routes
app.use('/api', screeningRoutes);

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Resume Screener Express Engine' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Resume Screening Backend Server listening on port ${PORT}`);
  });
}

module.exports = app;
