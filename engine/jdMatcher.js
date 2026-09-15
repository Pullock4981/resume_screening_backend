const skillsDict = require('../data/skillsDictionary.json');

/**
 * Extract target skills and min experience from Job Description
 */
function extractSkillsFromJD(jdText, customMustHave = [], customNiceToHave = [], customMinExp = 0) {
  const jdLower = (jdText || '').toLowerCase();
  
  const mustHave = new Set(customMustHave.map(s => s.trim().toLowerCase()));
  const niceToHave = new Set(customNiceToHave.map(s => s.trim().toLowerCase()));

  // Auto-detect skills from JD text if no custom lists provided
  if (mustHave.size === 0 && niceToHave.size === 0) {
    skillsDict.skills.forEach(skill => {
      const isFound = skill.aliases.some(alias => {
        const regex = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i');
        return regex.test(jdLower);
      });

      if (isFound) {
        if (mustHave.size < 5) {
          mustHave.add(skill.name.toLowerCase());
        } else {
          niceToHave.add(skill.name.toLowerCase());
        }
      }
    });
  }

  // Extract Min Experience Years from JD text if not provided
  let minExperience = Number(customMinExp) || 0;
  if (minExperience === 0) {
    minExperience = extractMinExperienceFromJD(jdText);
  }

  const mapToSkillObj = (skillNameStr) => {
    const matchedDictItem = skillsDict.skills.find(
      s => s.name.toLowerCase() === skillNameStr || s.aliases.includes(skillNameStr)
    );

    if (matchedDictItem) {
      return {
        name: matchedDictItem.name,
        aliases: matchedDictItem.aliases
      };
    }

    return {
      name: capitalizeWord(skillNameStr),
      aliases: [skillNameStr]
    };
  };

  return {
    mustHaveSkills: Array.from(mustHave).map(mapToSkillObj),
    niceToHaveSkills: Array.from(niceToHave).map(mapToSkillObj),
    minExperience
  };
}

/**
 * Extract candidate experience duration in years from resume text
 */
function extractExperienceFromResume(resumeText) {
  if (!resumeText) return 0;

  // 1. Explicit total experience statements
  const explicitRegexes = [
    /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp|working|industry)/i,
    /(?:total|over|around|has)\s+(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i
  ];

  for (const regex of explicitRegexes) {
    const match = resumeText.match(regex);
    if (match && match[1]) {
      const expVal = parseFloat(match[1]);
      if (!isNaN(expVal) && expVal > 0 && expVal <= 30) {
        return expVal;
      }
    }
  }

  // 2. Parse Date Ranges (e.g. 2020 - 2024, Jan 2021 - Present)
  const dateRangeRegex = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December|\d{1,2}[\/\-])?\s*(\d{4})\s*(?:–|-|to|until)\s*(Present|Current|Now|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December|\d{1,2}[\/\-])?\s*(\d{4}))/gi;

  let totalMonths = 0;
  const currentYear = new Date().getFullYear();
  let match;

  while ((match = dateRangeRegex.exec(resumeText)) !== null) {
    const startYear = parseInt(match[1], 10);
    let endYear = currentYear;

    if (match[2] && !/Present|Current|Now/i.test(match[2])) {
      if (match[3]) {
        endYear = parseInt(match[3], 10);
      } else {
        const yrMatch = match[2].match(/\d{4}/);
        if (yrMatch) endYear = parseInt(yrMatch[0], 10);
      }
    }

    if (startYear >= 1990 && startYear <= currentYear && endYear >= startYear && endYear <= currentYear) {
      const diffYears = endYear - startYear;
      if (diffYears >= 0 && diffYears <= 15) {
        totalMonths += (diffYears === 0 ? 1 : diffYears) * 12;
      }
    }
  }

  if (totalMonths > 0) {
    return Math.min(25, Math.round((totalMonths / 12) * 10) / 10);
  }

  return 0;
}

function extractMinExperienceFromJD(jdText) {
  if (!jdText) return 0;
  const regexes = [
    /(\d+)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp|working|relevant)/i,
    /(?:minimum|at\s+least|around|required)\s+(\d+)\s*(?:years?|yrs?)/i,
    /(\d+)\s*(?:years?|yrs?)\s+minimum/i,
    /(\d+)\s*\+\s*(?:years?|yrs?)/i
  ];

  for (const regex of regexes) {
    const match = jdText.match(regex);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > 0 && num <= 20) {
        return num;
      }
    }
  }

  return 0;
}

/**
 * Match Candidate Resume against extracted JD requirements & Experience
 */
function matchResumeToRequirements(resumeText, mustHaveSkills, niceToHaveSkills, minExperience = 0) {
  const candidateExp = extractExperienceFromResume(resumeText);

  if (!resumeText) {
    return {
      candidateExp: 0,
      mustHaveResults: mustHaveSkills.map(s => ({ name: s.name, status: 'Missing', reason: 'Resume text is empty' })),
      niceToHaveResults: niceToHaveSkills.map(s => ({ name: s.name, status: 'Missing', reason: 'Resume text is empty' })),
      criticalMissing: mustHaveSkills.map(s => s.name)
    };
  }

  const resumeLower = resumeText.toLowerCase();

  const evaluateSkillList = (skillList) => {
    return skillList.map(skillObj => {
      let matchedAlias = null;

      for (const alias of skillObj.aliases) {
        const regex = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i');
        if (regex.test(resumeLower)) {
          matchedAlias = alias;
          break;
        }
      }

      if (matchedAlias) {
        return {
          name: skillObj.name,
          status: 'Strong',
          reason: `Found exact keyword/synonym match "${matchedAlias}"`
        };
      }

      for (const alias of skillObj.aliases) {
        if (resumeLower.includes(alias.toLowerCase())) {
          return {
            name: skillObj.name,
            status: 'Moderate',
            reason: `Partial match found for "${alias}"`
          };
        }
      }

      return {
        name: skillObj.name,
        status: 'Missing',
        reason: 'Skill not mentioned in resume'
      };
    });
  };

  const mustHaveResults = evaluateSkillList(mustHaveSkills);
  const niceToHaveResults = evaluateSkillList(niceToHaveSkills);

  // Evaluate Experience Requirement
  if (minExperience > 0) {
    let expStatus = 'Missing';
    let expReason = `No experience detected in resume (Required: ${minExperience}+ years)`;

    if (candidateExp >= minExperience) {
      expStatus = 'Strong';
      expReason = `Candidate has ${candidateExp} years exp (Required: ${minExperience}+ years)`;
    } else if (candidateExp > 0) {
      expStatus = 'Moderate';
      expReason = `Candidate has ${candidateExp} years exp (Slightly under required ${minExperience}+ years)`;
    }

    mustHaveResults.unshift({
      name: `Min ${minExperience}+ Years Experience`,
      status: expStatus,
      reason: expReason
    });
  }

  const criticalMissing = mustHaveResults
    .filter(r => r.status === 'Missing')
    .map(r => r.name);

  return {
    candidateExp,
    minExperience,
    mustHaveResults,
    niceToHaveResults,
    criticalMissing
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalizeWord(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = {
  extractSkillsFromJD,
  extractExperienceFromResume,
  extractMinExperienceFromJD,
  matchResumeToRequirements
};
