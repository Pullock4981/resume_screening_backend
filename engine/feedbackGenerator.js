/**
 * Rule-Based Dynamic Feedback Text Generator (0% AI Tokens)
 */
function generateFeedback(candidateName, scoreDetails, matchingResults, atsResults) {
  const { finalScore, category, criticalFlag, criticalMissing } = scoreDetails;
  const { mustHaveResults, niceToHaveResults } = matchingResults;
  const { atsScore, warnings } = atsResults;

  const matchedMustHave = mustHaveResults.filter(r => r.status !== 'Missing').map(r => r.name);
  const missingMustHave = mustHaveResults.filter(r => r.status === 'Missing').map(r => r.name);
  const matchedNiceToHave = niceToHaveResults.filter(r => r.status !== 'Missing').map(r => r.name);

  let summaryParts = [];

  // Tier-specific evaluation feedback message
  let tierFeedback = '';
  if (finalScore >= 85) {
    tierFeedback = '🟢 Good to Go (85%+ Match): Excellent candidate! Resume strongly satisfies core JD requirements and is recommended for immediate interview.';
  } else if (finalScore >= 70) {
    tierFeedback = '🟡 Waiting List (70-84% Match): Solid candidate. Meets most key JD requirements with minor gaps. Kept on waiting list for secondary review.';
  } else if (finalScore >= 50) {
    tierFeedback = '🟠 Partial Match (50-69% Match): Candidate possesses some relevant skills but misses several core competencies required in JD.';
  } else if (finalScore >= 30) {
    tierFeedback = '🔴 Weak Fit (30-49% Match): Candidate meets very few JD requirements and has major skill gaps.';
  } else {
    tierFeedback = '❌ Critical Mismatch (<30% Match): Resume lacks almost all required skills and qualifications specified in the JD.';
  }

  summaryParts.push(tierFeedback);

  // Critical Missing Warning
  if (criticalFlag && criticalMissing.length > 0) {
    summaryParts.push(`⚠️ Critical Missing Skill(s): ${criticalMissing.join(', ')}.`);
  }

  // Matched vs Missing Skills breakdown text
  if (matchedMustHave.length > 0) {
    summaryParts.push(`Matched Skills: ${matchedMustHave.join(', ')}.`);
  }
  if (missingMustHave.length > 0 && finalScore < 85) {
    summaryParts.push(`Missing Skills: ${missingMustHave.join(', ')}.`);
  }
  if (matchedNiceToHave.length > 0) {
    summaryParts.push(`Bonus Skills: ${matchedNiceToHave.join(', ')}.`);
  }

  // ATS Formatting Note
  summaryParts.push(`ATS Format Score: ${atsScore}%.`);
  if (warnings && warnings.length > 0) {
    summaryParts.push(`Formatting Notes: ${warnings.slice(0, 2).join(' ')}`);
  }

  return summaryParts.join(' ');
}

module.exports = {
  generateFeedback
};
