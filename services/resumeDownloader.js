const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

function extractGoogleDriveFileId(url) {
  if (!url) return null;
  const matchD = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchD) return matchD[1];
  const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId) return matchId[1];
  return null;
}

async function fetchResumeText(resumeUrl) {
  if (!resumeUrl || typeof resumeUrl !== 'string') {
    throw new Error('Resume link is empty or invalid.');
  }

  let downloadUrl = resumeUrl.trim();
  const driveId = extractGoogleDriveFileId(downloadUrl);

  if (driveId) {
    downloadUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
  }

  try {
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const buffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || '';

    // Check if DOCX
    if (downloadUrl.toLowerCase().endsWith('.docx') || contentType.includes('wordprocessingml')) {
      const docxResult = await mammoth.extractRawText({ buffer });
      return docxResult.value || '';
    }

    // Default assume PDF or attempt PDF parsing
    try {
      const pdfData = await pdfParse(buffer);
      if (pdfData.text && pdfData.text.trim().length > 0) {
        return pdfData.text;
      }
    } catch (err) {
      // Fallback: try reading as plain UTF-8 string
      const plainText = buffer.toString('utf-8');
      if (plainText.length > 50) return plainText;
      throw err;
    }

    return buffer.toString('utf-8');
  } catch (error) {
    throw new Error(`Failed to fetch or parse resume from link (${resumeUrl}): ${error.message}`);
  }
}

module.exports = {
  fetchResumeText,
  extractGoogleDriveFileId
};
