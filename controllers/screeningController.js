const { processScreening } = require('../services/screeningService');

// Global SSE clients list
let sseClients = [];

function sendSSEEvent(data) {
  sseClients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

const handleScreening = async (req, res) => {
  try {
    const { sheetUrl, masterSheetUrl, jdText, mustHave, niceToHave, minExperience, operationName } = req.body;

    if (!sheetUrl) {
      return res.status(400).json({ error: 'Candidate Applicant Google Sheet URL is required.' });
    }

    if (!jdText) {
      return res.status(400).json({ error: 'Job Description text is required.' });
    }

    // Start screening asynchronously or synchronously
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
        sendSSEEvent(progressData);
      }
    );

    sendSSEEvent({ status: 'completed', total: outcome.total });

    return res.status(200).json({
      success: true,
      message: 'Screening process completed successfully.',
      data: outcome
    });
  } catch (error) {
    console.error('Screening Error:', error);
    sendSSEEvent({ status: 'error', error: error.message });
    return res.status(500).json({ error: error.message });
  }
};

const handleSSEProgress = (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
};

module.exports = {
  handleScreening,
  handleSSEProgress
};
