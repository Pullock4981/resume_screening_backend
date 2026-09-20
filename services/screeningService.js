const { getSheetData, updateCandidateResult, batchUpdateCandidateResults, logOperationToMasterSheet, writeBatchToMasterDatabase, sortSheetByFinalScore, extractSpreadsheetId } = require('../config/googleSheets');
const { fetchResumeText } = require('./resumeDownloader');
const { evaluateATS } = require('../engine/atsChecker');
const { extractSkillsFromJD, matchResumeToRequirements } = require('../engine/jdMatcher');
const { calculateScore } = require('../engine/scoringEngine');
const { generateFeedback } = require('../engine/feedbackGenerator');

async function processScreening({ sheetUrl, masterSheetUrl, jdText, mustHave = [], niceToHave = [], minExperience = 0, operationName = '' }, onProgress) {
  // Step 1: Read Sheet Data
  const sheetInfo = await getSheetData(sheetUrl);
  const { spreadsheetId, sheetName, colMap, candidates } = sheetInfo;

  if (candidates.length === 0) {
    throw new Error('No candidate rows found in the Google Sheet.');
  }

  // Step 2: Extract skills & min experience from JD
  const { mustHaveSkills, niceToHaveSkills, minExperience: extractedMinExp } = extractSkillsFromJD(jdText, mustHave, niceToHave, minExperience);
  const targetMinExp = Number(minExperience) || extractedMinExp || 0;

  const total = candidates.length;
  const results = [];
  const updateItems = [];

  // Notify initial progress
  if (onProgress) {
    onProgress({
      completed: 0,
      total,
      status: 'started',
      candidatesCount: total
    });
  }

  // Step 3: Fast Concurrent Processing (5 Candidates at once)
  const chunkSize = 5;
  for (let i = 0; i < candidates.length; i += chunkSize) {
    const chunk = candidates.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async (candidate) => {
        let resumeText = '';
        let fetchError = null;

        try {
          if (candidate.resumeLink) {
            resumeText = await fetchResumeText(candidate.resumeLink);
          } else {
            fetchError = 'Resume link was missing in sheet.';
          }
        } catch (err) {
          fetchError = err.message;
        }

        let resultItem = null;

        if (fetchError) {
          resultItem = {
            name: candidate.name,
            email: candidate.email,
            phone: candidate.phone,
            resumeLink: candidate.resumeLink,
            matchScore: 0,
            atsScore: 0,
            finalScore: 0,
            category: 'Critical Mismatch (<30%)',
            criticalFlag: true,
            feedback: `Error: ${fetchError}`,
            atsDetails: { warnings: [fetchError] },
            matchingResults: { mustHaveResults: [], niceToHaveResults: [], criticalMissing: ['Resume Parsing Failed'] }
          };
        } else {
          // 1. Evaluate ATS
          const atsResults = evaluateATS(resumeText);

          // 2. Match JD Requirements & Experience
          const matchingResults = matchResumeToRequirements(resumeText, mustHaveSkills, niceToHaveSkills, targetMinExp);

          // 3. Calculate Math Score
          const scoreDetails = calculateScore(matchingResults, atsResults);

          // 4. Generate Feedback Text
          const feedbackText = generateFeedback(candidate.name, scoreDetails, matchingResults, atsResults);

          resultItem = {
            name: candidate.name,
            email: candidate.email,
            phone: candidate.phone,
            resumeLink: candidate.resumeLink,
            matchScore: scoreDetails.matchScore,
            atsScore: scoreDetails.atsScore,
            finalScore: scoreDetails.finalScore,
            category: scoreDetails.category,
            criticalFlag: scoreDetails.criticalFlag,
            feedback: feedbackText,
            atsDetails: atsResults,
            matchingResults
          };
        }

        return { candidate, resultItem };
      })
    );

    chunkResults.forEach(({ candidate, resultItem }, chunkIdx) => {
      results.push(resultItem);
      updateItems.push({ rowIndex: candidate.rowIndex, result: resultItem });

      if (onProgress) {
        onProgress({
          completed: i + chunkIdx + 1,
          total,
          currentCandidate: candidate.name,
          result: resultItem,
          status: 'processing'
        });
      }
    });
  }

  // Step 4: Fast Bulk Update to Candidate Google Sheet in ONE single API call!
  try {
    await batchUpdateCandidateResults(spreadsheetId, sheetName, colMap, updateItems);
  } catch (writeErr) {
    console.error('Failed to batch update Google Sheet:', writeErr.message);
  }

  // Step 5: Automatically sort candidate sheet rows by Final Score (%) in DESCENDING order!
  await sortSheetByFinalScore(spreadsheetId, sheetName, colMap);

  // Step 6: Always log operation to candidate sheet if masterSheetUrl is same or missing
  const targetMasterUrl = masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL || sheetUrl;
  const isDifferentMaster = extractSpreadsheetId(targetMasterUrl) !== spreadsheetId;

  if (isDifferentMaster) {
    // Write full batch rows into Master Database Sheet & log to Master_Index
    await writeBatchToMasterDatabase(targetMasterUrl, operationName, results);
  } else {
    // Log operation summary to Master_Index tab on the same sheet
    await logOperationToMasterSheet(spreadsheetId, operationName, sheetName, total, results);
  }

  return {
    spreadsheetId,
    total,
    results,
    extractedRequirements: {
      mustHave: mustHaveSkills.map(s => s.name),
      niceToHave: niceToHaveSkills.map(s => s.name)
    }
  };
}

async function processAtsCheck({ sheetUrl, resumeUrl }, onProgress) {
  const { evaluateAtsRubric } = require('../engine/atsRubricEvaluator');

  // Case 1: Google Sheet URL provided
  if (sheetUrl && sheetUrl.trim().length > 0) {
    const sheetInfo = await getSheetData(sheetUrl);
    const { spreadsheetId, sheetName, colMap, candidates } = sheetInfo;

    if (!candidates || candidates.length === 0) {
      throw new Error('No candidate rows found in the Google Sheet.');
    }

    const total = candidates.length;
    const results = [];
    const updateItems = [];

    if (onProgress) {
      onProgress({ completed: 0, total, status: 'started' });
    }

    const chunkSize = 5;
    for (let i = 0; i < candidates.length; i += chunkSize) {
      const chunk = candidates.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(
        chunk.map(async (candidate) => {
          let resumeText = '';
          let fetchError = null;

          try {
            if (candidate.resumeLink) {
              resumeText = await fetchResumeText(candidate.resumeLink);
            } else {
              fetchError = 'Resume link was missing in sheet.';
            }
          } catch (err) {
            fetchError = err.message;
          }

          let rubricResult;
          if (fetchError) {
            rubricResult = evaluateAtsRubric('');
            rubricResult.feedback.summary = `Fetch Error: ${fetchError}`;
          } else {
            rubricResult = evaluateAtsRubric(resumeText);
          }

          const resultItem = {
            name: candidate.name || 'Applicant',
            email: candidate.email || 'N/A',
            phone: candidate.phone || 'N/A',
            resumeLink: candidate.resumeLink || '',
            atsScore: rubricResult.totalScore,
            matchScore: rubricResult.breakdown?.keywordMatch?.score || 0,
            finalScore: rubricResult.totalScore,
            category: rubricResult.grade,
            criticalFlag: rubricResult.totalScore < 55,
            feedback: rubricResult.feedback?.summary || '',
            ...rubricResult
          };

          return { candidate, resultItem };
        })
      );

      chunkResults.forEach(({ candidate, resultItem }, idx) => {
        results.push(resultItem);
        updateItems.push({ rowIndex: candidate.rowIndex, result: resultItem });

        if (onProgress) {
          onProgress({
            completed: i + idx + 1,
            total,
            currentCandidate: resultItem.name,
            result: resultItem,
            status: 'processing'
          });
        }
      });
    }

    // Step 4: Batch Update ATS scores & feedback back to the Google Sheet columns!
    try {
      await batchUpdateCandidateResults(spreadsheetId, sheetName, colMap, updateItems);
    } catch (writeErr) {
      console.error('Failed to batch update Google Sheet:', writeErr.message);
    }

    // Step 5: Automatically sort candidate sheet rows by Final Score (%) in DESCENDING order!
    try {
      await sortSheetByFinalScore(spreadsheetId, sheetName, colMap);
    } catch (sortErr) {
      console.error('Failed to sort candidate sheet:', sortErr.message);
    }

    // Step 6: Log operation summary to Master_Index tab on the sheet
    try {
      await logOperationToMasterSheet(spreadsheetId, `ATS_Check_${sheetName}`, sheetName, total, results);
    } catch (logErr) {
      console.error('Failed to log operation to master sheet:', logErr.message);
    }

    return { total, results };
  }

  // Case 2: Single Direct Resume Link provided
  if (resumeUrl && resumeUrl.trim().length > 0) {
    let resumeText = '';
    let fetchError = null;

    try {
      resumeText = await fetchResumeText(resumeUrl);
    } catch (err) {
      fetchError = err.message;
    }

    let rubricResult;
    if (fetchError) {
      rubricResult = evaluateAtsRubric('');
      rubricResult.feedback.summary = `Fetch Error: ${fetchError}`;
    } else {
      rubricResult = evaluateAtsRubric(resumeText);
    }

    const singleItem = {
      name: 'Direct Candidate Resume',
      email: 'N/A',
      phone: 'N/A',
      resumeLink: resumeUrl,
      ...rubricResult
    };

    return { total: 1, results: [singleItem] };
  }

  throw new Error('Please provide either a Candidate Google Sheet URL or a Direct Resume Link.');
}

module.exports = {
  processScreening,
  processAtsCheck
};
