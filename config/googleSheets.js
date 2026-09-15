const { google } = require('googleapis');
require('dotenv').config();

function extractSpreadsheetId(urlOrId) {
  if (!urlOrId) return null;
  if (!urlOrId.includes('/') && urlOrId.length > 20) return urlOrId;
  const match = urlOrId.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : urlOrId;
}

const fs = require('fs');
const path = require('path');

function formatPrivateKey(keyStr) {
  if (!keyStr) return '';
  let cleaned = keyStr.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.replace(/\\n/g, '\n').replace(/\r/g, '');
}

function getGoogleSheetsClient() {
  let email = '';
  let privateKey = '';

  // 1. Try built-in serviceAccountData module (guaranteed valid & uncorrupted key)
  try {
    const sa = require('./serviceAccountData');
    if (sa && sa.client_email && sa.private_key) {
      email = sa.client_email;
      privateKey = sa.private_key;
    }
  } catch (err) {}

  // 2. Check if service_account.json exists in backend directory
  if (!email || !privateKey) {
    const jsonPath1 = path.join(__dirname, '../service_account.json');
    if (fs.existsSync(jsonPath1)) {
      try {
        const sa = JSON.parse(fs.readFileSync(jsonPath1, 'utf-8'));
        if (sa.client_email && sa.private_key) {
          email = sa.client_email;
          privateKey = sa.private_key;
        }
      } catch (err) {}
    }
  }

  // 3. Fallback to GOOGLE_SERVICE_ACCOUNT_BASE64 or GOOGLE_SERVICE_ACCOUNT_JSON environment variables
  if (!email || !privateKey) {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
      try {
        const decodedStr = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64.trim(), 'base64').toString('utf-8');
        const sa = JSON.parse(decodedStr);
        if (sa.client_email && sa.private_key) {
          email = sa.client_email;
          privateKey = sa.private_key;
        }
      } catch (e) {}
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        let rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
        if ((rawJson.startsWith("'") && rawJson.endsWith("'")) || (rawJson.startsWith('"') && rawJson.endsWith('"'))) {
          rawJson = rawJson.slice(1, -1);
        }
        const sa = JSON.parse(rawJson);
        if (sa.client_email && sa.private_key) {
          email = sa.client_email;
          privateKey = sa.private_key;
        }
      } catch (e) {}
    }
  }

  // 4. Fallback to individual env vars
  if (!email || !privateKey) {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      privateKey = process.env.GOOGLE_PRIVATE_KEY;
    }
  }

  if (!email || !privateKey) {
    throw new Error('Google Service Account Credentials are missing or incomplete.');
  }

  // Format private key cleanly
  privateKey = formatPrivateKey(privateKey);

  const auth = new google.auth.JWT({
    email: email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Fetch rows from Google Sheet and map them with column indices
 */
async function getSheetData(sheetUrlOrId) {
  const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheet URL or Spreadsheet ID.');
  }

  const sheets = getGoogleSheetsClient();

  // Get sheet metadata to find first sheet name
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetName = meta.data.sheets[0].properties.title;

  // Read all values
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:Z1000`,
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    throw new Error('Google Sheet is empty.');
  }

  const headers = rows[0].map(h => h ? h.trim() : '');

  // Find column indices (case-insensitive)
  const nameIdx = headers.findIndex(h => /name|candidate/i.test(h));
  const emailIdx = headers.findIndex(h => /email|mail/i.test(h));
  const phoneIdx = headers.findIndex(h => /phone|mobile|contact/i.test(h));
  const resumeIdx = headers.findIndex(h => /resume|cv|link|url/i.test(h));

  // Required output headers
  const requiredOutputHeaders = [
    'Match Score (%)',
    'ATS Score (%)',
    'Final Score (%)',
    'Category',
    'Critical Flag',
    'Feedback Summary'
  ];

  // Ensure output headers exist
  let updatedHeaders = [...headers];
  let headersAdded = false;

  requiredOutputHeaders.forEach(reqH => {
    if (!updatedHeaders.some(h => h.toLowerCase() === reqH.toLowerCase())) {
      updatedHeaders.push(reqH);
      headersAdded = true;
    }
  });

  if (headersAdded) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [updatedHeaders] },
    });
  }

  // Create column mapping dictionary for output writing
  const colMap = {};
  updatedHeaders.forEach((h, idx) => {
    colMap[h] = idx;
  });

  const seenKeys = new Set();
  const candidates = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const email = emailIdx !== -1 && row[emailIdx] ? row[emailIdx].trim() : '';
    const phone = phoneIdx !== -1 && row[phoneIdx] ? row[phoneIdx].trim() : '';
    const resumeLink = resumeIdx !== -1 && row[resumeIdx] ? row[resumeIdx].trim() : '';

    // Ignore completely empty rows where there is no resume link or email
    if (!resumeLink && !email) continue;

    // Deduplication key (lowercase email or resume link)
    const dedupKey = (email ? email : resumeLink).toLowerCase().trim();
    if (seenKeys.has(dedupKey)) {
      console.log(`Skipping duplicate candidate row ${i + 1}: ${dedupKey}`);
      continue;
    }
    seenKeys.add(dedupKey);

    // Derive name if missing
    let name = nameIdx !== -1 && row[nameIdx] ? row[nameIdx].trim() : '';
    if (!name) {
      if (email) {
        name = email.split('@')[0];
      } else {
        name = `Candidate #${i}`;
      }
    }

    candidates.push({
      rowIndex: i + 1, // 1-based index for Google Sheets row
      name,
      email,
      phone: phone || 'N/A',
      resumeLink,
      rawRowData: row
    });
  }

  return {
    spreadsheetId,
    sheetName,
    headers: updatedHeaders,
    colMap,
    candidates
  };
}

/**
 * Update candidate screening result in Google Sheet
 */
async function updateCandidateResult(spreadsheetId, sheetName, colMap, rowIndex, result) {
  const sheets = getGoogleSheetsClient();

  const updates = [
    { col: 'Match Score (%)', value: result.matchScore },
    { col: 'ATS Score (%)', value: result.atsScore },
    { col: 'Final Score (%)', value: result.finalScore },
    { col: 'Category', value: result.category },
    { col: 'Critical Flag', value: result.criticalFlag ? 'CRITICAL MISSING' : 'OK' },
    { col: 'Feedback Summary', value: result.feedback }
  ];

  const validColIndices = updates
    .map(u => colMap[u.col])
    .filter(idx => idx !== undefined);

  if (validColIndices.length === 0) return;

  const minColIdx = Math.min(...validColIndices);
  const maxColIdx = Math.max(...validColIndices);

  const rowValues = new Array(maxColIdx - minColIdx + 1).fill('');

  updates.forEach(u => {
    const idx = colMap[u.col];
    if (idx !== undefined) {
      rowValues[idx - minColIdx] = u.value;
    }
  });

  const startColLetter = getColumnLetter(minColIdx + 1);
  const endColLetter = getColumnLetter(maxColIdx + 1);
  const range = `${sheetName}!${startColLetter}${rowIndex}:${endColLetter}${rowIndex}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowValues] },
  });
}

/**
 * Bulk update candidate screening results in Google Sheet (Single Batch API call)
 */
async function batchUpdateCandidateResults(spreadsheetId, sheetName, colMap, updateItems) {
  if (!updateItems || updateItems.length === 0) return;

  const sheets = getGoogleSheetsClient();
  const data = [];

  for (const item of updateItems) {
    const { rowIndex, result } = item;
    const updates = [
      { col: 'Match Score (%)', value: result.matchScore },
      { col: 'ATS Score (%)', value: result.atsScore },
      { col: 'Final Score (%)', value: result.finalScore },
      { col: 'Category', value: result.category },
      { col: 'Critical Flag', value: result.criticalFlag ? 'CRITICAL MISSING' : 'OK' },
      { col: 'Feedback Summary', value: result.feedback }
    ];

    const validColIndices = updates
      .map(u => colMap[u.col])
      .filter(idx => idx !== undefined);

    if (validColIndices.length === 0) continue;

    const minColIdx = Math.min(...validColIndices);
    const maxColIdx = Math.max(...validColIndices);

    const rowValues = new Array(maxColIdx - minColIdx + 1).fill('');
    updates.forEach(u => {
      const idx = colMap[u.col];
      if (idx !== undefined) {
        rowValues[idx - minColIdx] = u.value;
      }
    });

    const startColLetter = getColumnLetter(minColIdx + 1);
    const endColLetter = getColumnLetter(maxColIdx + 1);
    const range = `${sheetName}!${startColLetter}${rowIndex}:${endColLetter}${rowIndex}`;

    data.push({
      range,
      values: [rowValues]
    });
  }

  if (data.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data
      }
    });
  }
}

function getColumnLetter(colNum) {
  let temp, letter = '';
  while (colNum > 0) {
    temp = (colNum - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    colNum = (colNum - temp - 1) / 26;
  }
  return letter;
}

/**
 * Log screening operation summary to Master Index sheet tab
 */
async function logOperationToMasterSheet(spreadsheetId, operationName, sheetName, total, results) {
  try {
    const sheets = getGoogleSheetsClient();
    const indexSheetName = 'Master_Index';

    // 1. Get spreadsheet metadata to check if Master_Index tab exists
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = meta.data.sheets.map(s => s.properties.title);
    
    if (!existingSheets.includes(indexSheetName)) {
      // Add Master_Index sheet tab
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: indexSheetName
                }
              }
            }
          ]
        }
      });

      // Add Headers to Master_Index tab
      const headers = [
        'Operation / Job Name',
        'Date & Time Executed',
        'Total Candidates',
        'Good to Go (≥90%)',
        'Waiting List (70-89%)',
        'Details Sheet Tab'
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${indexSheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] }
      });
    }

    // 2. Count statistics
    const goodToGoCount = results.filter(r => r.finalScore >= 90).length;
    const waitingListCount = results.filter(r => r.finalScore >= 70 && r.finalScore < 90).length;
    
    const now = new Date();
    const timeFormatted = now.toLocaleString('en-US', {
      timeZone: 'Asia/Dhaka',
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    // Find target sheetId for sheetName to construct a direct clickable tab URL
    const targetSheet = meta.data.sheets.find(s => s.properties.title === sheetName);
    const targetGid = targetSheet ? targetSheet.properties.sheetId : null;
    
    let tabLinkCell = sheetName;
    if (targetGid !== null && targetGid !== undefined) {
      const tabUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${targetGid}`;
      tabLinkCell = `=HYPERLINK("${tabUrl}", "${sheetName}")`;
    }

    const opTitle = (operationName || sheetName).trim();
    const newRow = [
      opTitle,
      timeFormatted,
      total,
      goodToGoCount,
      waitingListCount,
      tabLinkCell
    ];

    // Append to Master_Index
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${indexSheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
  } catch (err) {
    console.error('Failed to log operation to Master Index sheet:', err.message);
  }
}

/**
 * Write full batch results to Master Database Spreadsheet
 */
async function writeBatchToMasterDatabase(masterSheetUrl, operationName, results) {
  const masterSpreadsheetId = extractSpreadsheetId(masterSheetUrl);
  if (!masterSpreadsheetId) return;

  const sheets = getGoogleSheetsClient();

  const dateStr = new Date().toISOString().slice(0, 10);
  const rawTitle = (operationName || `Batch_${dateStr}`).trim();
  const cleanTitle = rawTitle.replace(/[^a-zA-Z0-9_\- ]/g, '').slice(0, 30) || 'Screening_Batch';

  let targetTabName = cleanTitle;

  try {
    // 1. Check existing sheets
    const meta = await sheets.spreadsheets.get({ spreadsheetId: masterSpreadsheetId });
    const existingSheetTitles = meta.data.sheets.map(s => s.properties.title);

    let counter = 1;
    while (existingSheetTitles.includes(targetTabName)) {
      targetTabName = `${cleanTitle.slice(0, 25)}_${counter++}`;
    }

    // 2. Create the tab
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: masterSpreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: targetTabName
              }
            }
          }
        ]
      }
    });

    // 3. Prepare headers & candidate rows
    // 3. Prepare headers & candidate rows sorted by finalScore descending
    const sortedResults = [...results].sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

    const headers = [
      'Candidate Name',
      'Email',
      'Phone',
      'Resume Link',
      'Match Score (%)',
      'ATS Score (%)',
      'Final Score (%)',
      'Category',
      'Critical Flag',
      'Feedback Summary'
    ];

    const rowsData = [
      headers,
      ...sortedResults.map(r => [
        r.name || '',
        r.email || '',
        r.phone || '',
        r.resumeLink || '',
        r.matchScore || 0,
        r.atsScore || 0,
        r.finalScore || 0,
        r.category || '',
        r.criticalFlag ? 'CRITICAL MISSING' : 'OK',
        r.feedback || ''
      ])
    ];

    // Write all rows to the new tab
    await sheets.spreadsheets.values.update({
      spreadsheetId: masterSpreadsheetId,
      range: `${targetTabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rowsData }
    });

    // 4. Log summary entry to Master_Index
    await logOperationToMasterSheet(masterSpreadsheetId, operationName, targetTabName, results.length, sortedResults);
  } catch (err) {
    console.error('Failed to write batch to Master Database:', err.message);
  }
}

/**
 * Automatically sort Google Sheet rows by Final Score (%) in DESCENDING order
 */
async function sortSheetByFinalScore(spreadsheetId, sheetName, colMap) {
  try {
    const sheets = getGoogleSheetsClient();

    // 1. Get spreadsheet metadata to find sheetId for current sheetName
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const targetSheet = meta.data.sheets.find(s => s.properties.title === sheetName);
    
    if (!targetSheet) return;
    const sheetId = targetSheet.properties.sheetId;

    // 2. Find column index for Final Score (%)
    const scoreColIdx = colMap['Final Score (%)'];
    if (scoreColIdx === undefined) return;

    // 3. Trigger sortRange batchUpdate
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            sortRange: {
              range: {
                sheetId: sheetId,
                startRowIndex: 1, // Skip header row
                startColumnIndex: 0
              },
              sortSpecs: [
                {
                  dimensionIndex: scoreColIdx,
                  sortOrder: 'DESCENDING'
                }
              ]
            }
          }
        ]
      }
    });
  } catch (err) {
    console.error('Failed to auto-sort Google Sheet:', err.message);
  }
}

module.exports = {
  extractSpreadsheetId,
  getSheetData,
  updateCandidateResult,
  batchUpdateCandidateResults,
  logOperationToMasterSheet,
  writeBatchToMasterDatabase,
  sortSheetByFinalScore
};
