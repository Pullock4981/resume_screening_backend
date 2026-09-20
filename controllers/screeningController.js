const { processScreening } = require('../services/screeningService');
const { fetchMasterHistory } = require('../config/googleSheets');

// Global SSE clients list
let sseClients = [];

function sendSSEEvent(data) {
  sseClients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

const handleScreening = async (req, res) => {
  // Set headers for chunked streaming response (NDJSON)
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { sheetUrl, masterSheetUrl, jdText, mustHave, niceToHave, minExperience, operationName } = req.body;

    if (!sheetUrl) {
      res.write(JSON.stringify({ status: 'error', error: 'Candidate Applicant Google Sheet URL is required.' }) + '\n');
      return res.end();
    }

    if (!jdText) {
      res.write(JSON.stringify({ status: 'error', error: 'Job Description text is required.' }) + '\n');
      return res.end();
    }

    // Process screening with real-time stream callback
    const outcome = await processScreening(
      {
        sheetUrl,
        masterSheetUrl: masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL || '',
        jdText,
        mustHave: mustHave || [],
        niceToHave: niceToHave || [],
        minExperience: minExperience || 0,
        operationName: operationName || ''
      },
      (progressData) => {
        // Stream progress chunk directly to client on the same HTTP response
        res.write(JSON.stringify(progressData) + '\n');
      }
    );

    // Stream final completion event
    res.write(JSON.stringify({ status: 'completed', data: outcome }) + '\n');
    res.end();
  } catch (error) {
    console.error('Screening Error:', error);
    res.write(JSON.stringify({ status: 'error', error: error.message }) + '\n');
    res.end();
  }
};

const handleSSEProgress = (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  } else if (typeof res.flush === 'function') {
    res.flush();
  }

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
};

const handleGetHistory = async (req, res) => {
  try {
    const masterSheetUrl = req.query.masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL;
    const history = await fetchMasterHistory(masterSheetUrl);
    return res.status(200).json({ success: true, history });
  } catch (err) {
    console.error('Fetch history error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

const handleAtsCheck = async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  try {
    const { sheetUrl, masterSheetUrl, resumeUrl, operationName } = req.body || {};

    if (!sheetUrl && !resumeUrl) {
      res.write(JSON.stringify({ status: 'error', error: 'Google Sheet URL or Resume Link is required.' }) + '\n');
      return res.end();
    }

    const { processAtsCheck } = require('../services/screeningService');
    const outcome = await processAtsCheck(
      {
        sheetUrl,
        masterSheetUrl: masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL || '',
        resumeUrl,
        operationName: operationName || ''
      },
      (progressData) => {
        try {
          res.write(JSON.stringify(progressData) + '\n');
        } catch (e) {}
      }
    );

    res.write(JSON.stringify({ status: 'completed', data: outcome }) + '\n');
    res.end();
  } catch (error) {
    console.error('ATS Check Error:', error);
    try {
      res.write(JSON.stringify({ status: 'error', error: error.message || 'ATS Resume Evaluation failed.' }) + '\n');
      res.end();
    } catch (e) {}
  }
};

module.exports = {
  handleScreening,
  handleSSEProgress,
  handleGetHistory,
  handleAtsCheck
};
