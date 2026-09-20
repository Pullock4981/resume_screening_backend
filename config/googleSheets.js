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

function parseCsvRows(csvText) {
  if (!csvText) return [];
  const lines = csvText.split(/\r?\n/);
  return lines.map(line => {
    const result = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(cell.trim());
        cell = '';
      } else {
        cell += char;
      }
    }
    result.push(cell.trim());
    return result;
  }).filter(r => r.some(c => c.length > 0));
}

/**
 * Fetch rows from Google Sheet and map them with column indices
 */
async function getSheetData(sheetUrlOrId) {
  const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheet URL or Spreadsheet ID.');
  }

  const gidMatch = (sheetUrlOrId || '').match(/gid=([0-9]+)/);
  const targetGid = gidMatch ? gidMatch[1] : null;

  let sheetName = 'Sheet1';
  let rows = [];

  try {
    const sheets = getGoogleSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    
    if (meta.data && meta.data.sheets && meta.data.sheets.length > 0) {
      if (targetGid) {
        const foundTab = meta.data.sheets.find(s => s.properties.sheetId.toString() === targetGid);
        sheetName = foundTab ? foundTab.properties.title : meta.data.sheets[0].properties.title;
      } else {
        sheetName = meta.data.sheets[0].properties.title;
      }
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A1:Z1000`,
    });

    rows = response.data.values || [];
  } catch (apiErr) {
    // Fallback to public CSV export if service account permission fails or sheet is public
    try {
      const axios = require('axios');
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${targetGid ? `&gid=${targetGid}` : ''}`;
      const csvRes = await axios.get(csvUrl);
      if (csvRes.data) {
        rows = parseCsvRows(csvRes.data);
      } else {
        throw apiErr;
      }
    } catch (csvErr) {
      throw new Error(`Google Sheet Access Error: ${apiErr.message || 'Permission denied'}. Please check if the Google Sheet URL is valid and shared (or set to "Anyone with link can view").`);
    }
  }

  if (!rows || rows.length === 0) {
    throw new Error('Google Sheet is empty or no readable rows found.');
  }

  const headers = rows[0].map(h => h ? h.trim() : '');

  // Find column indices (case-insensitive & flexible)
  const nameIdx = headers.findIndex(h => /name|candidate|applicant|student/i.test(h));
  const emailIdx = headers.findIndex(h => /email|mail/i.test(h));
  const phoneIdx = headers.findIndex(h => /phone|mobile|contact|num/i.test(h));
  const resumeIdx = headers.findIndex(h => /resume|cv|link|url|drive|file/i.test(h));

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
    try {
      const sheets = getGoogleSheetsClient();
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updatedHeaders] },
      });
    } catch (hErr) {
      console.error('Failed to update sheet header row:', hErr.message);
    }
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

/**
 * Fetch live history batches from Master Database Spreadsheet.
 * Automatically filters out any deleted tabs or deleted rows!
 */
async function fetchMasterHistory(masterSheetUrlOrId) {
  try {
    const spreadsheetId = extractSpreadsheetId(masterSheetUrlOrId || process.env.DEFAULT_GOOGLE_SHEET_URL);
    if (!spreadsheetId) return [];

    const sheets = getGoogleSheetsClient();

    // 1. Get spreadsheet metadata to find existing sheet titles
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheetTitles = meta.data.sheets.map(s => s.properties.title);

    const indexSheetName = 'Master_Index';
    if (!existingSheetTitles.includes(indexSheetName)) {
      return [];
    }

    // 2. Read Master_Index values
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${indexSheetName}!A1:F100`
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return [];

    const historyRecords = [];

    // Loop through rows skipping header (row 0)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const operationName = row[0] ? row[0].trim() : `Batch #${i}`;
      const dateFormatted = row[1] ? row[1].trim() : '';
      const totalCandidates = parseInt(row[2]) || 0;
      const goodToGoCount = parseInt(row[3]) || 0;
      const waitingListCount = parseInt(row[4]) || 0;

      // Extract tab name from link or cell
      let tabName = row[5] ? row[5].trim() : '';
      if (tabName.includes('=')) {
        const match = tabName.match(/,\s*["']([^"']+)["']\)/);
        if (match) tabName = match[1];
      }

      // CHECK: Does this tab actually exist in Google Sheet?
      if (tabName && !existingSheetTitles.includes(tabName)) {
        console.log(`Skipping deleted Google Sheet tab: ${tabName}`);
        continue; // TAB WAS DELETED IN GOOGLE SHEET! SKIP IT!
      }

      let candidates = [];
      if (tabName && existingSheetTitles.includes(tabName)) {
        try {
          const tabRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!A1:Z1000`
          });

          const tabRows = tabRes.data.values;
          if (tabRows && tabRows.length > 1) {
            const tabHeaders = tabRows[0].map(h => h ? h.trim() : '');
            const nameIdx = tabHeaders.findIndex(h => /name|candidate/i.test(h));
            const emailIdx = tabHeaders.findIndex(h => /email|mail/i.test(h));
            const phoneIdx = tabHeaders.findIndex(h => /phone|mobile/i.test(h));
            const resumeIdx = tabHeaders.findIndex(h => /resume|cv|link/i.test(h));
            const matchIdx = tabHeaders.findIndex(h => /match/i.test(h));
            const atsIdx = tabHeaders.findIndex(h => /ats/i.test(h));
            const finalIdx = tabHeaders.findIndex(h => /final/i.test(h));
            const catIdx = tabHeaders.findIndex(h => /category/i.test(h));
            const critIdx = tabHeaders.findIndex(h => /critical/i.test(h));
            const feedIdx = tabHeaders.findIndex(h => /feedback/i.test(h));

            for (let r = 1; r < tabRows.length; r++) {
              const tr = tabRows[r];
              if (!tr || tr.length === 0) continue;

              const name = nameIdx !== -1 && tr[nameIdx] ? tr[nameIdx] : `Candidate #${r}`;
              const email = emailIdx !== -1 && tr[emailIdx] ? tr[emailIdx] : '';
              const phone = phoneIdx !== -1 && tr[phoneIdx] ? tr[phoneIdx] : 'N/A';
              const resumeLink = resumeIdx !== -1 && tr[resumeIdx] ? tr[resumeIdx] : '';
              const matchScore = matchIdx !== -1 ? parseInt(tr[matchIdx]) || 0 : 0;
              const atsScore = atsIdx !== -1 ? parseInt(tr[atsIdx]) || 0 : 0;
              const finalScore = finalIdx !== -1 ? parseInt(tr[finalIdx]) || 0 : 0;
              const category = catIdx !== -1 && tr[catIdx] ? tr[catIdx] : '';
              const criticalFlag = critIdx !== -1 && tr[critIdx] ? /missing/i.test(tr[critIdx]) : false;
              const feedback = feedIdx !== -1 && tr[feedIdx] ? tr[feedIdx] : '';

              candidates.push({
                name,
                email,
                phone,
                resumeLink,
                matchScore,
                atsScore,
                finalScore,
                category,
                criticalFlag,
                feedback,
                atsDetails: { warnings: [] },
                matchingResults: { mustHaveResults: [], niceToHaveResults: [], criticalMissing: [] }
              });
            }
          }
        } catch (e) {
          console.error(`Error loading candidates for tab ${tabName}:`, e.message);
        }
      }

      const notMatchingCount = Math.max(0, (candidates.length || totalCandidates) - (goodToGoCount + waitingListCount));

      historyRecords.push({
        id: `gs_${i}_${tabName || operationName}`,
        operationName,
        timestamp: new Date().toISOString(),
        dateFormatted,
        studentSheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        totalCandidates: candidates.length || totalCandidates,
        goodToGoCount: candidates.length ? candidates.filter(c => c.finalScore >= 90).length : goodToGoCount,
        waitingListCount: candidates.length ? candidates.filter(c => c.finalScore >= 70 && c.finalScore < 90).length : waitingListCount,
        notMatchingCount: candidates.length ? candidates.filter(c => c.finalScore < 70).length : notMatchingCount,
        candidates
      });
    }

    return historyRecords;
  } catch (err) {
    console.error('Failed to fetch master history from Google Sheets:', err.message);
    return [];
  }
}

/**
 * Ensure Users tab and Login_Logs tab exist in Master Central Google Sheet
 */
async function ensureUserTabsExist(masterSheetUrlOrId) {
  try {
    const spreadsheetId = extractSpreadsheetId(masterSheetUrlOrId || process.env.DEFAULT_GOOGLE_SHEET_URL);
    if (!spreadsheetId) return;

    const sheets = getGoogleSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTitles = meta.data.sheets.map(s => s.properties.title);

    const requests = [];
    if (!existingTitles.includes('Users')) {
      requests.push({ addSheet: { properties: { title: 'Users' } } });
    }
    if (!existingTitles.includes('Login_Logs')) {
      requests.push({ addSheet: { properties: { title: 'Login_Logs' } } });
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
      });
    }

    if (!existingTitles.includes('Users')) {
      const userHeaders = ['User ID', 'Full Name', 'Email Address', 'Password Hash', 'Role', 'Status', 'Created At'];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Users!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [userHeaders] }
      });
    }

    if (!existingTitles.includes('Login_Logs')) {
      const logHeaders = ['Log ID', 'Email', 'Role', 'Login Date & Time', 'IP / Details'];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Login_Logs!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [logHeaders] }
      });
    }
  } catch (err) {
    console.error('Failed to ensure user tabs exist:', err.message);
  }
}

/**
 * Fetch all users from Users tab in Master Central Google Sheet
 */
async function getUsersFromSheet(masterSheetUrlOrId) {
  try {
    const spreadsheetId = extractSpreadsheetId(masterSheetUrlOrId || process.env.DEFAULT_GOOGLE_SHEET_URL);
    if (!spreadsheetId) return [];

    await ensureUserTabsExist(spreadsheetId);
    const sheets = getGoogleSheetsClient();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Users!A1:G1000'
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return [];

    const users = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 3) continue;

      users.push({
        rowIndex: i + 1,
        id: r[0] ? r[0].trim() : `usr_${i}`,
        name: r[1] ? r[1].trim() : '',
        email: r[2] ? r[2].trim().toLowerCase() : '',
        passwordHash: r[3] ? r[3].trim() : '',
        role: r[4] ? r[4].trim().toLowerCase() : 'user',
        status: r[5] ? r[5].trim().toLowerCase() : 'active',
        createdAt: r[6] ? r[6].trim() : ''
      });
    }

    return users;
  } catch (err) {
    console.error('Failed to get users from sheet:', err.message);
    return [];
  }
}

/**
 * Save new user row to Users tab
 */
async function saveUserToSheet(masterSheetUrlOrId, userObj) {
  try {
    const spreadsheetId = extractSpreadsheetId(masterSheetUrlOrId || process.env.DEFAULT_GOOGLE_SHEET_URL);
    if (!spreadsheetId) return;

    await ensureUserTabsExist(spreadsheetId);
    const sheets = getGoogleSheetsClient();

    const newRow = [
      userObj.id,
      userObj.name,
      userObj.email.toLowerCase(),
      userObj.passwordHash,
      userObj.role || 'user',
      userObj.status || 'active',
      userObj.createdAt || new Date().toISOString()
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Users!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
  } catch (err) {
    console.error('Failed to save user to sheet:', err.message);
    throw err;
  }
}

/**
 * Update user row details in Users tab (role, status, name, email)
 */
async function updateUserInSheet(masterSheetUrlOrId, userId, updateData) {
  try {
    const spreadsheetId = extractSpreadsheetId(masterSheetUrlOrId || process.env.DEFAULT_GOOGLE_SHEET_URL);
    if (!spreadsheetId) return;

    const users = await getUsersFromSheet(spreadsheetId);
    const targetUser = users.find(u => u.id === userId || u.email.toLowerCase() === (userId || '').toLowerCase());
    if (!targetUser) {
      throw new Error(`User not found with ID/Email: ${userId}`);
    }

    const sheets = getGoogleSheetsClient();
    const updatedName = updateData.name !== undefined ? updateData.name : targetUser.name;
    const updatedEmail = updateData.email !== undefined ? updateData.email.toLowerCase() : targetUser.email;
    const updatedRole = updateData.role !== undefined ? updateData.role.toLowerCase() : targetUser.role;
    const updatedStatus = updateData.status !== undefined ? updateData.status.toLowerCase() : targetUser.status;

    const rowValues = [
      targetUser.id,
      updatedName,
      updatedEmail,
      targetUser.passwordHash,
      updatedRole,
      updatedStatus,
      targetUser.createdAt
    ];

    const range = `Users!A${targetUser.rowIndex}:G${targetUser.rowIndex}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowValues] }
    });
  } catch (err) {
    console.error('Failed to update user in sheet:', err.message);
    throw err;
  }
}

/**
 * Log user login audit entry to Login_Logs tab
 */
async function logUserLoginToSheet(masterSheetUrlOrId, logObj) {
  try {
    const spreadsheetId = extractSpreadsheetId(masterSheetUrlOrId || process.env.DEFAULT_GOOGLE_SHEET_URL);
    if (!spreadsheetId) return;

    await ensureUserTabsExist(spreadsheetId);
    const sheets = getGoogleSheetsClient();

    const logId = `log_${Date.now()}`;
    const dateFormatted = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Dhaka',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    const newRow = [
      logId,
      logObj.email.toLowerCase(),
      logObj.role || 'user',
      dateFormatted,
      logObj.details || 'User logged in successfully'
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Login_Logs!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
  } catch (err) {
    console.error('Failed to log user login to sheet:', err.message);
  }
}

/**
 * Fetch all login audit logs from Login_Logs tab
 */
async function getLoginLogsFromSheet(masterSheetUrlOrId) {
  try {
    const spreadsheetId = extractSpreadsheetId(masterSheetUrlOrId || process.env.DEFAULT_GOOGLE_SHEET_URL);
    if (!spreadsheetId) return [];

    await ensureUserTabsExist(spreadsheetId);
    const sheets = getGoogleSheetsClient();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Login_Logs!A1:E1000'
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return [];

    const logs = [];
    for (let i = rows.length - 1; i >= 1; i--) { // newest first
      const r = rows[i];
      if (!r || r.length < 2) continue;

      logs.push({
        id: r[0] || `log_${i}`,
        email: r[1] || '',
        role: r[2] || 'user',
        loginTime: r[3] || '',
        details: r[4] || ''
      });
    }

    return logs;
  } catch (err) {
    console.error('Failed to get login logs from sheet:', err.message);
    return [];
  }
}

module.exports = {
  extractSpreadsheetId,
  getSheetData,
  updateCandidateResult,
  batchUpdateCandidateResults,
  logOperationToMasterSheet,
  writeBatchToMasterDatabase,
  sortSheetByFinalScore,
  fetchMasterHistory,
  ensureUserTabsExist,
  getUsersFromSheet,
  saveUserToSheet,
  updateUserInSheet,
  logUserLoginToSheet,
  getLoginLogsFromSheet
};

