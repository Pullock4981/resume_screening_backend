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

    // Save to Google Sheet incrementally per chunk (every 5 candidates)
    try {
      const chunkUpdates = chunkResults.map(cr => ({ rowIndex: cr.candidate.rowIndex, result: cr.resultItem }));
      await batchUpdateCandidateResults(spreadsheetId, sheetName, colMap, chunkUpdates);
    } catch (chunkErr) {
      console.error('Incremental chunk save failed:', chunkErr.message);
    }
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

async function processAtsCheck({ sheetUrl, masterSheetUrl, resumeUrl, operationName = '' }, onProgress) {
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
            ...rubricResult,
            name: candidate.name || 'Applicant',
            email: candidate.email || 'N/A',
            phone: candidate.phone || 'N/A',
            resumeLink: candidate.resumeLink || '',
            atsScore: rubricResult.totalScore,
            matchScore: rubricResult.breakdown?.keywordMatch?.score || 0,
            finalScore: rubricResult.totalScore,
            category: rubricResult.grade,
            criticalFlag: rubricResult.totalScore < 55,
            feedback: rubricResult.feedback?.summary || ''
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
      console.error('Failed to batch update ATS results in Google Sheet:', writeErr.message);
    }

    // Step 5: Automatically sort candidate sheet rows by Final Score (%) in DESCENDING order!
    try {
      await sortSheetByFinalScore(spreadsheetId, sheetName, colMap);
    } catch (sortErr) {
      console.error('Failed to sort candidate sheet:', sortErr.message);
    }

    // Step 6: Log operation summary to Master Central Database Sheet & Master_Index
    const targetMasterUrl = masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL || sheetUrl;
    const isDifferentMaster = extractSpreadsheetId(targetMasterUrl) !== spreadsheetId;
    const opName = operationName || `ATS_Check_${sheetName}`;

    try {
      if (isDifferentMaster) {
        await writeBatchToMasterDatabase(targetMasterUrl, opName, results);
      } else {
        await logOperationToMasterSheet(spreadsheetId, opName, sheetName, total, results);
      }
    } catch (masterErr) {
      console.error('Failed to log ATS check to Master Sheet:', masterErr.message);
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
      ...rubricResult,
      name: 'Direct Candidate Resume',
      email: 'N/A',
      phone: 'N/A',
      resumeLink: resumeUrl,
      atsScore: rubricResult.totalScore,
      matchScore: rubricResult.breakdown?.keywordMatch?.score || 0,
      finalScore: rubricResult.totalScore,
      category: rubricResult.grade,
      criticalFlag: rubricResult.totalScore < 55,
      feedback: rubricResult.feedback?.summary || ''
    };

    const targetMasterUrl = masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL;
    if (targetMasterUrl) {
      try {
        const opName = operationName || 'ATS_Direct_Check';
        await writeBatchToMasterDatabase(targetMasterUrl, opName, [singleItem]);
      } catch (masterErr) {
        console.error('Failed to log single ATS check to Master Sheet:', masterErr.message);
      }
    }

    return { total: 1, results: [singleItem] };
  }

  throw new Error('Please provide either a Candidate Google Sheet URL or a Direct Resume Link.');
}

async function processGithubCheck({ sheetUrl, masterSheetUrl, githubUrl, operationName = '' }, userEmail, onProgress) {
  const { evaluateGithubProfile, extractGithubUsername } = require('../engine/githubChecker');
  const { saveGithubCheckToSheet } = require('../config/googleSheets');

  // Case 1: Google Sheet URL provided
  if (sheetUrl && sheetUrl.trim().length > 0) {
    const sheetInfo = await getSheetData(sheetUrl);
    const { spreadsheetId, sheetName, colMap, candidates } = sheetInfo;

    if (!candidates || candidates.length === 0) {
      throw new Error('No candidate rows found in the Google Sheet.');
    }

    const total = candidates.length;
    const results = [];

    if (onProgress) {
      onProgress({ completed: 0, total, status: 'started' });
    }

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      // Small delay between candidate scans to prevent API rate limit bursts
      if (i > 0) {
        await new Promise(r => setTimeout(r, 200));
      }

      // Find GitHub URL from candidate fields or raw row
      let targetGithub = '';
      const candidateValues = Object.values(candidate.rawRowData || {}).join(' ');
      const ghMatch = candidateValues.match(/github\.com\/([a-zA-Z0-9_-]+)/i);

      if (ghMatch) {
        targetGithub = `https://github.com/${ghMatch[1]}`;
      } else if (candidate.resumeLink && candidate.resumeLink.includes('github.com')) {
        targetGithub = candidate.resumeLink;
      } else {
        const handleMatch = candidateValues.match(/@([a-zA-Z0-9_-]{3,39})/);
        if (handleMatch) {
          targetGithub = handleMatch[1];
        }
      }

      let evalResult = null;
      if (!targetGithub) {
        evalResult = {
          username: candidate.name || 'N/A',
          name: candidate.name || 'Candidate',
          avatarUrl: '',
          profileUrl: '#',
          bio: '',
          location: '',
          publicRepos: 0,
          followers: 0,
          following: 0,
          totalScore: 0,
          maxScore: 60,
          percentage: 0,
          grade: 'No GitHub Link',
          gradeColor: 'rose',
          breakdown: [{ title: 'GitHub Link Missing', score: 0, maxScore: 60, passed: false, detail: 'No GitHub profile URL or @username provided in candidate Google Sheet row.' }],
          topRepos: []
        };
      } else {
        try {
          evalResult = await evaluateGithubProfile(targetGithub);
        } catch (err) {
          const isRateLimit = err.message && err.message.includes('Rate Limit');
          evalResult = {
            username: extractGithubUsername(targetGithub) || candidate.name || 'Unknown',
            name: candidate.name || 'Unknown',
            avatarUrl: '',
            profileUrl: targetGithub || '#',
            bio: '',
            location: '',
            publicRepos: 0,
            followers: 0,
            following: 0,
            totalScore: 0,
            maxScore: 60,
            percentage: 0,
            grade: isRateLimit ? 'Rate Limited' : 'Needs Improvement',
            gradeColor: 'rose',
            breakdown: [{ title: isRateLimit ? 'GitHub Rate Limit' : 'Profile Error', score: 0, maxScore: 60, passed: false, detail: err.message }],
            topRepos: []
          };
        }
      }

      const passedList = (evalResult.breakdown || []).filter(b => b.passed);
      const missingList = (evalResult.breakdown || []).filter(b => !b.passed);

      const presentItemsStr = passedList.length > 0 
        ? passedList.map((b, idx) => `• ${b.title || b.criterion} (+${b.score !== undefined ? b.score : (b.earnedPoints || 0)}/${b.maxScore !== undefined ? b.maxScore : (b.maxPoints || 0)})`).join('\n')
        : 'None';
      const missingItemsStr = missingList.length > 0 
        ? missingList.map((b, idx) => `• ${b.title || b.criterion} (${b.score !== undefined ? b.score : (b.earnedPoints || 0)}/${b.maxScore !== undefined ? b.maxScore : (b.maxPoints || 0)})`).join('\n')
        : '🎉 Everything Present (0 Missing)';

      const item = {
        ...evalResult,
        name: candidate.name || evalResult.name,
        email: candidate.email || 'N/A',
        phone: candidate.phone || 'N/A',
        presentItems: presentItemsStr,
        missingItems: missingItemsStr
      };
      results.push(item);

      if (onProgress) {
        onProgress({
          completed: i + 1,
          total,
          currentCandidate: item.name,
          result: item,
          status: 'processing'
        });
      }
      // Incremental periodic save to Google Sheet every 25 candidates
      if ((i + 1) % 25 === 0 || i === candidates.length - 1) {
        const pendingUpdates = [];
        const startIdx = Math.max(0, Math.floor(i / 25) * 25);
        for (let k = startIdx; k <= i; k++) {
          const cand = candidates[k];
          const resItem = results[k];
          if (cand && resItem) {
            pendingUpdates.push({
              rowIndex: cand.rowIndex,
              result: {
                matchScore: resItem.totalScore,
                atsScore: resItem.percentage,
                finalScore: resItem.percentage,
                category: resItem.grade,
                criticalFlag: resItem.totalScore < 30,
                feedback: `GitHub Check (${resItem.totalScore}/60 Marks - ${resItem.grade}). ${resItem.publicRepos} Repos, ${resItem.followers} Followers. Profile: ${resItem.profileUrl}`,
                presentItems: resItem.presentItems,
                missingItems: resItem.missingItems
              }
            });
          }
        }
        try {
          await batchUpdateCandidateResults(spreadsheetId, sheetName, colMap, pendingUpdates);
        } catch (partialErr) {
          console.error(`Incremental Google Sheet save failed at candidate ${i + 1}:`, partialErr.message);
        }
      }
    }

    try {
      await sortSheetByFinalScore(spreadsheetId, sheetName, colMap);
    } catch (writeErr) {
      console.error('Failed to sort candidate Google Sheet:', writeErr.message);
    }

    // Save batch to Master Central Google Sheet
    const targetMasterUrl = masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL || sheetUrl;
    const opName = operationName || `Github_Check_${sheetName}`;
    try {
      await saveGithubCheckToSheet(targetMasterUrl, opName, results, userEmail);
    } catch (sheetErr) {
      console.error('Failed to save GitHub Check batch to master sheet:', sheetErr.message);
    }

    return { total, results };

  }

  // Case 2: Single GitHub URL / Username provided
  if (githubUrl && githubUrl.trim().length > 0) {
    const evalResult = await evaluateGithubProfile(githubUrl.trim());
    const passedList = (evalResult.breakdown || []).filter(b => b.passed);
    const missingList = (evalResult.breakdown || []).filter(b => !b.passed);

    const presentItemsStr = passedList.length > 0 
      ? passedList.map((b, idx) => `• ${b.title || b.criterion} (+${b.score !== undefined ? b.score : (b.earnedPoints || 0)}/${b.maxScore !== undefined ? b.maxScore : (b.maxPoints || 0)})`).join('\n')
      : 'None';
    const missingItemsStr = missingList.length > 0 
      ? missingList.map((b, idx) => `• ${b.title || b.criterion} (${b.score !== undefined ? b.score : (b.earnedPoints || 0)}/${b.maxScore !== undefined ? b.maxScore : (b.maxPoints || 0)})`).join('\n')
      : '🎉 Everything Present (0 Missing)';

    const singleItem = {
      ...evalResult,
      email: 'N/A',
      phone: 'N/A',
      presentItems: presentItemsStr,
      missingItems: missingItemsStr
    };

    const targetMasterUrl = masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL;
    if (targetMasterUrl) {
      try {
        const opName = operationName || `Github_Check_${evalResult.username}`;
        await saveGithubCheckToSheet(targetMasterUrl, opName, [singleItem], userEmail);
      } catch (err) {
        console.error('Failed to save single GitHub Check to sheet:', err.message);
      }
    }

    return { total: 1, results: [singleItem] };
  }

  throw new Error('Please provide either a Candidate Google Sheet URL or a Direct GitHub URL / Username.');
}

module.exports = {
  processScreening,
  processAtsCheck,
  processGithubCheck
};

