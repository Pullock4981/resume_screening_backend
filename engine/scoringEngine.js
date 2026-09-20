/**
 * Deterministic Mathematical Scoring Engine (0% AI Tokens)
 */
function calculateScore(matchingResults, atsResults) {
  const { mustHaveResults, niceToHaveResults, criticalMissing } = matchingResults;
  const { atsScore } = atsResults;

  // 1. Calculate Must-Have Match Ratio
  let mustHaveScore = 0;
  if (mustHaveResults.length > 0) {
    const points = mustHaveResults.reduce((acc, curr) => {
      if (curr.status === 'Strong') return acc + 1.0;
      if (curr.status === 'Moderate') return acc + 0.6;
      return acc;
    }, 0);
    mustHaveScore = (points / mustHaveResults.length) * 100;
  } else {
    mustHaveScore = 100; // Default if no must-have specified
  }

  // 2. Calculate Nice-to-Have Match Ratio
  let niceToHaveScore = 0;
  if (niceToHaveResults.length > 0) {
    const points = niceToHaveResults.reduce((acc, curr) => {
      if (curr.status === 'Strong') return acc + 1.0;
      if (curr.status === 'Moderate') return acc + 0.6;
      return acc;
    }, 0);
    niceToHaveScore = (points / niceToHaveResults.length) * 100;
  } else {
    niceToHaveScore = 100;
  }

  // 3. Match Score (Weighted: Must-Have 70%, Nice-to-Have 30%)
  let matchScore = 0;
  if (mustHaveResults.length > 0 && niceToHaveResults.length > 0) {
    matchScore = (mustHaveScore * 0.7) + (niceToHaveScore * 0.3);
  } else if (mustHaveResults.length > 0) {
    matchScore = mustHaveScore;
  } else {
    matchScore = niceToHaveScore;
  }

  // 4. Overall Final Weighted Score (80% Skill Match + 20% ATS Score)
  let finalScore = Math.round((matchScore * 0.8) + (atsScore * 0.2));

  // Penalty if critical must-have skills are missing
  const criticalFlag = criticalMissing.length > 0;
  if (criticalFlag) {
    // Apply a 10% penalty to final score for missing critical skills
    finalScore = Math.max(0, finalScore - 10);
  }

  // 5. Categorization based on exact percentage brackets
  let category = 'Reject';
  if (finalScore >= 85) {
    category = 'Good to Go';
  } else if (finalScore >= 70) {
    category = 'Waiting List';
  } else if (finalScore >= 50) {
    category = 'Partial Match (50-69%)';
  } else if (finalScore >= 30) {
    category = 'Weak Fit (30-49%)';
  } else {
    category = 'Critical Mismatch (<30%)';
  }

  return {
    matchScore: Math.round(matchScore),
    atsScore: Math.round(atsScore),
    finalScore,
    category,
    criticalFlag,
    criticalMissing
  };
}

module.exports = {
  calculateScore
};
