const { getSheetData, updateCandidateResult, batchUpdateCandidateResults, logOperationToMasterSheet, writeBatchToMasterDatabase, sortSheetByFinalScore, extractSpreadsheetId } = require('../config/googleSheets');
const { fetchResumeText } = require('./resumeDownloader');
const { evaluateATS } = require('../engine/atsChecker');
const { extractSkillsFromJD, matchResumeToRequirements } = require('../engine/jdMatcher');
const { calculateScore } = require('../engine/scoringEngine');
const { generateFeedback } = require('../engine/feedbackGenerator');

async function processScreening({ sheetUrl, masterSheetUrl, jdText, mustHave = [], niceToHave = [], minExperience = 0, operationName = '' }, onProgress) {
  // Step 1: Read Sheet Data
  const sheetInfo = await getSheetData(sheetUrl, 'screening');
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
        let resumeContent = '';
        let fetchError = null;

        try {
          if (candidate.resumeLink) {
            resumeContent = await fetchResumeText(candidate.resumeLink);
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
          const atsResults = await evaluateATS(resumeContent);
          const atsScoreVal = atsResults.ats_score !== undefined ? atsResults.ats_score : (atsResults.score || 0);
          const normalizedAts = { ...atsResults, atsScore: atsScoreVal };

          // 2. Match JD Requirements & Experience
          const matchingResults = matchResumeToRequirements(resumeContent, mustHaveSkills, niceToHaveSkills, targetMinExp);

          // 3. Calculate Math Score
          const scoreDetails = calculateScore(matchingResults, normalizedAts);

          // 4. Generate Feedback Text
          const feedbackText = generateFeedback(candidate.name, scoreDetails, matchingResults, normalizedAts);

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
            atsDetails: normalizedAts,
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

async function processAtsCheck({ sheetUrl, masterSheetUrl, resumeUrl, resumeText, operationName = '' }, onProgress) {
  const { evaluateAtsRubric } = require('../engine/atsRubricEvaluator');

  // Case 1: Google Sheet URL provided
  if (sheetUrl && sheetUrl.trim().length > 0) {
    const sheetInfo = await getSheetData(sheetUrl, 'ats');
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
          let textContent = '';
          let fetchError = null;

          try {
            if (candidate.resumeLink) {
              textContent = await fetchResumeText(candidate.resumeLink);
            } else {
              fetchError = 'Resume link missing in candidate row';
            }
          } catch (err) {
            fetchError = err.message || 'Failed to download resume';
          }

          let rubricResult;
          if (fetchError) {
            rubricResult = evaluateAtsRubric('');
            rubricResult.feedback = { summary: 'Fetch Error: ' + fetchError };
            if (!rubricResult.recommendations) rubricResult.recommendations = [];
            rubricResult.recommendations.unshift({
              severity: 'CRITICAL',
              title: 'Resume Access Error',
              message: fetchError
            });
          } else {
            rubricResult = evaluateAtsRubric(textContent);
          }

          const scoreVal = rubricResult.ats_score !== undefined ? rubricResult.ats_score : (rubricResult.totalScore || 0);
          const itemGrade = rubricResult.grade || (scoreVal >= 80 ? 'ATS Friendly' : (scoreVal >= 60 ? 'Needs Work' : 'High Risk'));

          const resultItem = {
            ...rubricResult,
            name: candidate.name || 'Applicant',
            email: candidate.email || 'N/A',
            phone: candidate.phone || 'N/A',
            resumeLink: candidate.resumeLink || '',
            ats_score: scoreVal,
            atsScore: scoreVal,
            totalScore: scoreVal,
            matchScore: scoreVal,
            finalScore: scoreVal,
            grade: itemGrade,
            category: itemGrade,
            criticalFlag: scoreVal < 60,
            feedback: rubricResult.feedback?.summary || (itemGrade + ' (' + scoreVal + '/100 Marks)')
          };

          return { candidate, resultItem };
        })
      );

      chunkResults.forEach(({ candidate, resultItem }, idx) => {
        results.push(resultItem);
        const itemResult = {
          columns: {
            'ATS Score (%)': resultItem.atsScore,
            'ATS Category': resultItem.grade,
            'Critical Flag': resultItem.criticalFlag ? 'CRITICAL MISSING' : 'OK',
            'Feedback Summary': resultItem.feedback
          }
        };
        updateItems.push({ rowIndex: candidate.rowIndex, result: itemResult });

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

      try {
        const chunkUpdates = chunkResults.map(cr => ({
          rowIndex: cr.candidate.rowIndex,
          result: {
            columns: {
              'ATS Score (%)': cr.resultItem.atsScore,
              'ATS Category': cr.resultItem.grade,
              'Critical Flag': cr.resultItem.criticalFlag ? 'CRITICAL MISSING' : 'OK',
              'Feedback Summary': cr.resultItem.feedback
            }
          }
        }));
        await batchUpdateCandidateResults(spreadsheetId, sheetName, colMap, chunkUpdates);
      } catch (chunkErr) {
        console.error('Incremental candidate sheet update failed:', chunkErr.message);
      }
    }

    try {
      await sortSheetByFinalScore(spreadsheetId, sheetName, colMap, 'ATS Score (%)');
    } catch (sortErr) {
      console.error('Failed to sort candidate sheet:', sortErr.message);
    }

    const targetMasterUrl = masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL || sheetUrl;
    const opName = operationName || ('ATS_Check_' + sheetName);

    try {
      if (targetMasterUrl) {
        await writeBatchToMasterDatabase(targetMasterUrl, opName, results);
        await logOperationToMasterSheet(targetMasterUrl, opName, sheetName, total, results);
      }
    } catch (masterErr) {
      console.error('Failed to log ATS check to Master Sheet:', masterErr.message);
    }

    return { total, results };
  }

  // Case 2: Single Direct Resume Link or Text provided
  if ((resumeUrl && resumeUrl.trim().length > 0) || (resumeText && resumeText.trim().length > 0)) {
    let textToEval = resumeText || '';
    let fetchError = null;

    if (resumeUrl && !textToEval) {
      try {
        textToEval = await fetchResumeText(resumeUrl);
      } catch (err) {
        fetchError = err.message;
      }
    }

    let rubricResult = evaluateAtsRubric(fetchError ? '' : textToEval);
    if (fetchError) {
      rubricResult.feedback = { summary: 'Fetch Error: ' + fetchError };
    }

    const scoreVal = rubricResult.ats_score !== undefined ? rubricResult.ats_score : (rubricResult.totalScore || 0);
    const itemGrade = rubricResult.grade || (scoreVal >= 80 ? 'ATS Friendly' : (scoreVal >= 60 ? 'Needs Work' : 'High Risk'));

    const singleItem = {
      ...rubricResult,
      email: 'N/A',
      phone: 'N/A',
      ats_score: scoreVal,
      atsScore: scoreVal,
      totalScore: scoreVal,
      matchScore: scoreVal,
      finalScore: scoreVal,
      grade: itemGrade,
      category: itemGrade,
      criticalFlag: scoreVal < 60,
      feedback: rubricResult.feedback?.summary || (itemGrade + ' (' + scoreVal + '/100 Marks)')
    };

    const targetMasterUrl = masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL;
    if (targetMasterUrl) {
      try {
        const opName = operationName || 'ATS_Check_Single';
        await writeBatchToMasterDatabase(targetMasterUrl, opName, [singleItem]);
      } catch (err) {
        console.error('Failed to log single ATS check:', err.message);
      }
    }

    return { total: 1, results: [singleItem] };
  }

  throw new Error('Please provide either a Candidate Google Sheet URL or a Direct Resume Link / Text.');
}

async function processGithubCheck({ sheetUrl, masterSheetUrl, githubUrl, operationName = '' }, userEmail, onProgress) {
  const { evaluateGithubProfile, extractGithubUsername } = require('../engine/githubChecker');
  const { saveGithubCheckToSheet } = require('../config/googleSheets');

  // Case 1: Google Sheet URL provided
  if (sheetUrl && sheetUrl.trim().length > 0) {
    const sheetInfo = await getSheetData(sheetUrl, 'github');
    const { spreadsheetId, sheetName, colMap, candidates } = sheetInfo;

    if (!candidates || candidates.length === 0) {
      throw new Error('No candidate rows found in the Google Sheet.');
    }

    const total = candidates.length;
    const results = new Array(total);
    const updateBuffer = [];

    if (onProgress) {
      onProgress({ completed: 0, total, status: 'started' });
    }

    // High performance concurrency worker pool (40 parallel workers to finish 1000 candidates in < 120s)
    const CONCURRENCY = Math.min(40, total);
    let nextIndex = 0;
    let completedCount = 0;
    let lastProgressTime = 0;

    async function githubWorker() {
      while (true) {
        const i = nextIndex++;
        if (i >= total) break;

        const candidate = candidates[i];
        let targetGithub = '';
        const candidateValues = Object.values(candidate.rawRowData || {}).join(' ');

        // 1. Direct candidate.githubLink from detected GitHub column
        if (candidate.githubLink) {
          const val = candidate.githubLink.trim();
          const ghColMatch = val.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
          if (ghColMatch) {
            targetGithub = `https://github.com/${ghColMatch[1]}`;
          } else if (val.includes('github.com')) {
            targetGithub = val.startsWith('http') ? val : `https://${val}`;
          } else if (/^[a-zA-Z0-9_-]{3,39}$/.test(val) && !/^(n\/a|none|null|undefined|no|yes)$/i.test(val)) {
            targetGithub = val;
          }
        }

        // 2. Fallback: match from full row values or resumeLink
        if (!targetGithub) {
          const ghMatch = candidateValues.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
          if (ghMatch) {
            targetGithub = `https://github.com/${ghMatch[1]}`;
          } else if (candidate.resumeLink && candidate.resumeLink.includes('github.com')) {
            targetGithub = candidate.resumeLink.startsWith('http') ? candidate.resumeLink : `https://${candidate.resumeLink}`;
          } else {
            const handleMatch = candidateValues.match(/@([a-zA-Z0-9_-]{3,39})/);
            if (handleMatch) {
              targetGithub = handleMatch[1];
            }
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
          ? passedList.map((b) => `• ${b.title || b.criterion} (+${b.score !== undefined ? b.score : (b.earnedPoints || 0)}/${b.maxScore !== undefined ? b.maxScore : (b.maxPoints || 0)})`).join('\n')
          : 'None';
        const missingItemsStr = missingList.length > 0 
          ? missingList.map((b) => `• ${b.title || b.criterion} (${b.score !== undefined ? b.score : (b.earnedPoints || 0)}/${b.maxScore !== undefined ? b.maxScore : (b.maxPoints || 0)})`).join('\n')
          : '🎉 Everything Present (0 Missing)';

        const item = {
          ...evalResult,
          name: candidate.name || evalResult.name,
          email: candidate.email || 'N/A',
          phone: candidate.phone || 'N/A',
          presentItems: presentItemsStr,
          missingItems: missingItemsStr
        };

        results[i] = item;

        updateBuffer.push({
          rowIndex: candidate.rowIndex,
          result: {
            columns: {
              'GitHub Score (60)': item.totalScore,
              'GitHub Percentage (%)': `${item.percentage}%`,
              'GitHub Status': item.grade,
              'GitHub Feedback': `GitHub Check (${item.totalScore}/60 Marks - ${item.grade}). ${item.publicRepos} Repos, ${item.followers} Followers. Profile: ${item.profileUrl}`,
              'GitHub Present Items (কী কী আছে)': item.presentItems,
              'GitHub Missing Items (কী কী নাই)': item.missingItems
            }
          }
        });

        completedCount++;

        if (onProgress) {
          onProgress({
            completed: completedCount,
            total,
            currentCandidate: item.name,
            result: item,
            status: 'processing'
          });
        }
      }
    }

    // Run 40 workers in parallel
    const workers = Array.from({ length: CONCURRENCY }, () => githubWorker());
    await Promise.all(workers);

    const finalResults = results.filter(Boolean);

    // Bulk update candidate Google Sheet in optimized batches of 100 rows
    try {
      const sheetBatchSize = 100;
      for (let s = 0; s < updateBuffer.length; s += sheetBatchSize) {
        const batchSlice = updateBuffer.slice(s, s + sheetBatchSize);
        await batchUpdateCandidateResults(spreadsheetId, sheetName, colMap, batchSlice);
      }
    } catch (bulkErr) {
      console.error('Bulk candidate sheet update error for GitHub Check:', bulkErr.message);
    }

    try {
      await sortSheetByFinalScore(spreadsheetId, sheetName, colMap, 'GitHub Score (60)');
    } catch (writeErr) {
      console.error('Failed to sort candidate Google Sheet for GitHub Check:', writeErr.message);
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

async function processLinkedinCheck({ sheetUrl, masterSheetUrl, linkedinUrl, operationName = '' }, userEmail, onProgress) {
  const { evaluateLinkedinProfile, extractLinkedinIdentifier } = require('../engine/linkedinChecker');
  const { saveLinkedinCheckToSheet } = require('../config/googleSheets');

  // Case 1: Google Sheet URL provided (Batch LinkedIn Evaluation)
  if (sheetUrl && sheetUrl.trim().length > 0) {
    const sheetInfo = await getSheetData(sheetUrl, 'linkedin');
    const { spreadsheetId, sheetName, colMap, candidates } = sheetInfo;

    if (!candidates || candidates.length === 0) {
      throw new Error('No candidate rows found in the Google Sheet.');
    }

    const total = candidates.length;
    const results = new Array(total);
    const updateBuffer = [];

    if (onProgress) {
      onProgress({ completed: 0, total, status: 'started' });
    }

    // High performance concurrency worker pool (10 parallel workers to avoid rate limits and timeouts)
    const CONCURRENCY = Math.min(10, total);
    let nextIndex = 0;
    let completedCount = 0;
    let lastProgressTime = 0;

    async function linkedinWorker() {
      while (true) {
        const i = nextIndex++;
        if (i >= total) break;

        const candidate = candidates[i];
        let targetLinkedin = '';
        const candidateValues = Object.values(candidate.rawRowData || {}).join(' ');

        // 1. Direct candidate.linkedinLink from detected LinkedIn column
        if (candidate.linkedinLink) {
          const val = candidate.linkedinLink.trim();
          const liColMatch = val.match(/linkedin\.com\/in\/([a-zA-Z0-9_\-%]+)/i);
          if (liColMatch) {
            targetLinkedin = `https://www.linkedin.com/in/${liColMatch[1]}`;
          } else if (val.includes('linkedin.com')) {
            targetLinkedin = val.startsWith('http') ? val : `https://${val}`;
          } else if (/^[a-zA-Z0-9_\-]+$/.test(val) && val.length >= 3 && val.length <= 45 && !/^(n\/a|none|null|undefined|no|yes)$/i.test(val)) {
            // Direct handle e.g. "mirzaruksana25"
            targetLinkedin = `https://www.linkedin.com/in/${val}`;
          }
        }

        // 2. Fallback: match from full row values or resumeLink
        if (!targetLinkedin) {
          const liMatch = candidateValues.match(/linkedin\.com\/in\/([a-zA-Z0-9_\-%]+)/i);
          if (liMatch) {
            targetLinkedin = `https://www.linkedin.com/in/${liMatch[1]}`;
          } else if (candidate.resumeLink && candidate.resumeLink.includes('linkedin.com')) {
            targetLinkedin = candidate.resumeLink.startsWith('http') ? candidate.resumeLink : `https://${candidate.resumeLink}`;
          } else {
            const inMatch = candidateValues.match(/(?:^|\s)in\/([a-zA-Z0-9_\-%]+)/i);
            if (inMatch) {
              targetLinkedin = `https://www.linkedin.com/in/${inMatch[1]}`;
            }
          }
        }

        let evalResult = null;
        if (!targetLinkedin) {
          evalResult = {
            username: candidate.name || 'N/A',
            name: candidate.name || 'Candidate',
            profileUrl: '#',
            totalScore: 0,
            maxScore: 60,
            percentage: 0,
            grade: 'No LinkedIn Link',
            gradeColor: 'rose',
            passedCount: 0,
            partialCount: 0,
            missingCount: 15,
            breakdown: [{ id: 'missing', title: 'LinkedIn Link Missing', criterion: 'No LinkedIn Profile Link Found', score: 0, maxScore: 60, passed: false, detail: 'No LinkedIn profile URL found in candidate Google Sheet row.' }],
            headline: 'No Profile Found',
            aboutSummary: 'Candidate did not provide a LinkedIn URL in their submission row.'
          };
        } else {
          try {
            evalResult = await evaluateLinkedinProfile(targetLinkedin, candidate);
          } catch (err) {
            evalResult = {
              username: extractLinkedinIdentifier(targetLinkedin) || candidate.name || 'Unknown',
              name: candidate.name || 'Unknown',
              profileUrl: targetLinkedin || '#',
              totalScore: 0,
              maxScore: 60,
              percentage: 0,
              grade: 'Evaluation Error',
              gradeColor: 'rose',
              passedCount: 0,
              partialCount: 0,
              missingCount: 15,
              breakdown: [{ id: 'error', title: 'Evaluation Error', criterion: 'LinkedIn Error', score: 0, maxScore: 60, passed: false, detail: err.message }],
              headline: 'Profile Unavailable',
              aboutSummary: err.message
            };
          }
        }

        const passedList = (evalResult.breakdown || []).filter(b => b.passed);
        const missingList = (evalResult.breakdown || []).filter(b => !b.passed && !b.isBonus);

        const presentItemsStr = passedList.length > 0 
          ? passedList.map((b) => b.isBonus ? `• ${b.title || b.criterion} (+${b.score} Bonus)` : `• ${b.title || b.criterion} (+${b.maxScore}/${b.maxScore})`).join('\n')
          : 'None';
        const missingItemsStr = missingList.length > 0 
          ? missingList.map((b) => `• ${b.title || b.criterion} (0/${b.maxScore})`).join('\n')
          : '🎉 Everything Present (0 Missing)';

        const item = {
          ...evalResult,
          name: candidate.name || evalResult.name,
          email: candidate.email || 'N/A',
          phone: candidate.phone || 'N/A',
          presentItems: presentItemsStr,
          missingItems: missingItemsStr
        };

        results[i] = item;

        updateBuffer.push({
          rowIndex: candidate.rowIndex,
          result: {
            columns: {
              'LinkedIn Score (60)': item.totalScore,
              'LinkedIn Percentage (%)': `${item.percentage}%`,
              'LinkedIn Status': item.grade,
              'LinkedIn Feedback': `LinkedIn Check (${item.totalScore}/60 Marks - ${item.grade}). ${item.headline}. Profile: ${item.profileUrl}`,
              'LinkedIn Present Items (কী কী আছে)': item.presentItems,
              'LinkedIn Missing Items (কী কী নাই)': item.missingItems
            }
          }
        });

        completedCount++;

        if (onProgress) {
          onProgress({
            completed: completedCount,
            total,
            currentCandidate: item.name || 'Candidate Profile',
            status: 'processing',
            result: item
          });
        }
      }
    }

    // Run 30 workers in parallel
    const workers = Array.from({ length: CONCURRENCY }, () => linkedinWorker());
    await Promise.all(workers);

    const finalResults = results.filter(Boolean);

    // Bulk update candidate Google Sheet in optimized batches of 100 rows
    try {
      const sheetBatchSize = 100;
      for (let s = 0; s < updateBuffer.length; s += sheetBatchSize) {
        const batchSlice = updateBuffer.slice(s, s + sheetBatchSize);
        await batchUpdateCandidateResults(spreadsheetId, sheetName, colMap, batchSlice);
      }
    } catch (bulkErr) {
      console.error('Bulk candidate sheet update error for LinkedIn Check:', bulkErr.message);
    }

    try {
      await sortSheetByFinalScore(spreadsheetId, sheetName, colMap, 'LinkedIn Score (60)');
    } catch (writeErr) {
      console.error('Failed to sort candidate Google Sheet for LinkedIn Check:', writeErr.message);
    }

    // Save batch to Master Central Google Sheet
    const targetMasterUrl = masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL || sheetUrl;
    const opName = operationName || `Linkedin_Check_${sheetName}`;
    try {
      await saveLinkedinCheckToSheet(targetMasterUrl, finalResults, opName, userEmail);
    } catch (sheetErr) {
      console.error('Failed to save LinkedIn Check batch to master sheet:', sheetErr.message);
    }

    return { total, results: finalResults };
  }

  // Case 2: Single LinkedIn Profile URL or Username
  if (linkedinUrl && linkedinUrl.trim().length > 0) {
    const evalResult = await evaluateLinkedinProfile(linkedinUrl.trim());
    const passedList = (evalResult.breakdown || []).filter(b => b.passed);
    const missingList = (evalResult.breakdown || []).filter(b => !b.passed && !b.isBonus);

    const presentItemsStr = passedList.length > 0 
      ? passedList.map((b) => b.isBonus ? `• ${b.title || b.criterion} (+${b.score} Bonus)` : `• ${b.title || b.criterion} (+${b.maxScore}/${b.maxScore})`).join('\n')
      : 'None';
    const missingItemsStr = missingList.length > 0 
      ? missingList.map((b) => `• ${b.title || b.criterion} (0/${b.maxScore})`).join('\n')
      : '🎉 Everything Present (0 Missing)';

    const singleItem = {
      ...evalResult,
      email: 'N/A',
      phone: 'N/A',
      presentItems: presentItemsStr,
      missingItems: missingItemsStr
    };

    if (onProgress) {
      onProgress({
        completed: 1,
        total: 1,
        currentCandidate: evalResult.name || evalResult.username,
        status: 'processing',
        result: singleItem
      });
    }

    const targetMasterUrl = masterSheetUrl || process.env.DEFAULT_GOOGLE_SHEET_URL;
    if (targetMasterUrl) {
      try {
        const opName = operationName || `Linkedin_Check_${evalResult.username}`;
        await saveLinkedinCheckToSheet(targetMasterUrl, [singleItem], opName, userEmail);
      } catch (err) {
        console.error('Failed to save single LinkedIn Check to sheet:', err.message);
      }
    }

    return { total: 1, results: [singleItem] };
  }

  throw new Error('Please provide either a Candidate Google Sheet URL or a Direct LinkedIn Profile URL / Username.');
}

module.exports = {
  processScreening,
  processAtsCheck,
  processGithubCheck,
  processLinkedinCheck
};


