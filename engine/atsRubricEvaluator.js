const skillsDict = require('../data/skillsDictionary.json');

/**
 * 100-Point ATS Rubric Evaluator Engine
 * 
 * Category Breakdown (Total = 100 Points):
 * 1. Contact info (15 pts): Email (5), Phone (5), LinkedIn/Portfolio (5)
 * 2. Essential sections (25 pts): Summary (5), Experience (8), Education (6), Skills (6)
 * 3. Keyword match (25 pts): % of job keywords found in the resume, scaled to 25
 * 4. Action verbs & impact (15 pts): Strong verbs (8) + quantified results: %, $, numbers (7)
 * 5. Formatting & readability (10 pts): Optimal length (4), bullet usage (3), date consistency (3)
 * 6. ATS parseability (10 pts): Standard headings (4), low non-ASCII noise (3), text extracted (3)
 * 
 * Grades: 85+ Excellent · 70–84 Strong · 55–69 Moderate · 40–54 Needs Work · <40 Poor
 */

function evaluateAtsRubric(resumeText, jdText = '') {
  if (!resumeText || resumeText.trim().length === 0) {
    return {
      totalScore: 0,
      grade: 'Poor',
      gradeColor: 'rose',
      isParseable: false,
      breakdown: {
        contactInfo: { score: 0, max: 15, details: ['Resume text unreadable or empty (-15 pts)'] },
        essentialSections: { score: 0, max: 25, details: ['No section headers detected (-25 pts)'] },
        keywordMatch: { score: 0, max: 25, details: ['No keywords matched (-25 pts)'] },
        actionVerbsImpact: { score: 0, max: 15, details: ['No action verbs or metrics detected (-15 pts)'] },
        formattingReadability: { score: 0, max: 10, details: ['Unreadable formatting (-10 pts)'] },
        atsParseability: { score: 0, max: 10, details: ['Failed text extraction (-10 pts)'] }
      },
      feedback: {
        summary: 'Critical Error: Resume text could not be extracted from file (scanned image or unreadable document).',
        strengths: [],
        improvements: ['Ensure resume is saved as a parseable PDF or DOCX file with readable text.'],
        recommendation: 'Re-upload resume in a standard text-based PDF or Word format.'
      }
    };
  }

  const text = resumeText.trim();
  const lowerText = text.toLowerCase();

  // -------------------------------------------------------------
  // Category 1: Contact Info (15 Points)
  // Email (5), Phone (5), LinkedIn/Portfolio (5)
  // -------------------------------------------------------------
  let contactScore = 0;
  const contactDetails = [];

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const hasEmail = emailRegex.test(text);
  if (hasEmail) {
    contactScore += 5;
    contactDetails.push('Email detected (+5 pts)');
  } else {
    contactDetails.push('Missing email address (-5 pts)');
  }

  const phoneRegex = /(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([0-9]{3})\s*\)|([0-9]{3}))\s*(?:[.-]\s*)?)?([0-9]{3})\s*(?:[.-]\s*)?([0-9]{4})|(?:\+?\d{1,4}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/;
  const hasPhone = phoneRegex.test(text);
  if (hasPhone) {
    contactScore += 5;
    contactDetails.push('Phone number detected (+5 pts)');
  } else {
    contactDetails.push('Missing phone number (-5 pts)');
  }

  const linkRegex = /(linkedin\.com|github\.com|portfolio|http|https|\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b)/i;
  const hasLinkedInOrWeb = linkRegex.test(text);
  if (hasLinkedInOrWeb) {
    contactScore += 5;
    contactDetails.push('LinkedIn / Portfolio / GitHub link detected (+5 pts)');
  } else {
    contactDetails.push('Missing LinkedIn or portfolio link (-5 pts)');
  }

  // -------------------------------------------------------------
  // Category 2: Essential Sections (25 Points)
  // Summary (5), Experience (8), Education (6), Skills (6)
  // -------------------------------------------------------------
  let sectionScore = 0;
  const sectionDetails = [];

  const hasSummaryHeader = /(summary|profile|about\s+me|objective)/i.test(text);
  if (hasSummaryHeader) {
    sectionScore += 5;
    sectionDetails.push('Summary / Objective section header found (+5 pts)');
  } else {
    sectionDetails.push('Missing "Summary" or "Profile" section (-5 pts)');
  }

  const hasExpHeader = /(work\s+experience|employment\s+history|experience|career\s+history)/i.test(text);
  if (hasExpHeader) {
    sectionScore += 8;
    sectionDetails.push('Work Experience section header found (+8 pts)');
  } else {
    sectionDetails.push('Missing "Experience" or "Work History" section (-8 pts)');
  }

  const hasEduHeader = /(education|academic\s+background|qualifications)/i.test(text);
  if (hasEduHeader) {
    sectionScore += 6;
    sectionDetails.push('Education section header found (+6 pts)');
  } else {
    sectionDetails.push('Missing "Education" section (-6 pts)');
  }

  const hasSkillsHeader = /(skills|technical\s+skills|core\s+competencies|technologies)/i.test(text);
  if (hasSkillsHeader) {
    sectionScore += 6;
    sectionDetails.push('Skills section header found (+6 pts)');
  } else {
    sectionDetails.push('Missing "Skills" section (-6 pts)');
  }

  // -------------------------------------------------------------
  // Category 3: Keyword Match (25 Points)
  // Technical & Domain Industry Keyword Density (No JD required)
  // -------------------------------------------------------------
  let keywordScore = 0;
  const keywordDetails = [];
  let matchedKeywords = [];

  skillsDict.skills.forEach(skill => {
    const isPresent = skill.aliases.some(alias => new RegExp(`(?:^|[^a-zA-Z0-9\\#\\+\\.\\-])${escapeRegExp(alias)}(?:$|[^a-zA-Z0-9\\#\\+\\.\\-])`, 'i').test(lowerText));
    if (isPresent) {
      matchedKeywords.push(skill.name);
    }
  });

  const count = matchedKeywords.length;
  if (count >= 8) {
    keywordScore = 25;
    keywordDetails.push(`Excellent keyword density (${count} tech/domain skills detected) (+25/25 pts)`);
  } else if (count >= 5) {
    keywordScore = 20;
    keywordDetails.push(`Good keyword density (${count} tech/domain skills detected) (+20/25 pts)`);
  } else if (count >= 3) {
    keywordScore = 15;
    keywordDetails.push(`Moderate keyword density (${count} tech/domain skills detected) (+15/25 pts)`);
  } else if (count >= 1) {
    keywordScore = 10;
    keywordDetails.push(`Low keyword density (${count} tech skill detected) (+10/25 pts)`);
  } else {
    keywordScore = 5;
    keywordDetails.push('Very low keyword density (no standard tech/domain skills detected) (-20 pts)');
  }

  // -------------------------------------------------------------
  // Category 4: Action Verbs & Impact (15 Points)
  // Strong verbs (8) + quantified results: %, $, numbers (7)
  // -------------------------------------------------------------
  let actionImpactScore = 0;
  const actionImpactDetails = [];

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const bulletLines = lines.filter(line => /^([•\-\*▪►\+]|(\d+\.))\s+/.test(line));

  const strongActionVerbs = [
    'developed', 'built', 'engineered', 'designed', 'led', 'managed', 'created',
    'implemented', 'architected', 'optimized', 'increased', 'reduced', 'spearheaded',
    'automated', 'delivered', 'deployed', 'formulated', 'coordinated', 'enhanced',
    'scaled', 'transformed', 'analyzed', 'configured', 'launched', 'drove',
    'established', 'resolved', 'negotiated', 'refactored', 'integrated', 'executed'
  ];

  let actionVerbCount = 0;
  const targetLines = bulletLines.length > 0 ? bulletLines : lines;
  targetLines.forEach(line => {
    const cleanLine = line.replace(/^([•\-\*▪►\+]|(\d+\.))\s+/, '').trim();
    const firstWord = cleanLine.split(/\s+/)[0]?.toLowerCase();
    if (firstWord && strongActionVerbs.includes(firstWord)) {
      actionVerbCount++;
    }
  });

  if (actionVerbCount >= 5) {
    actionImpactScore += 8;
    actionImpactDetails.push(`Strong action verbs found in ${actionVerbCount} achievement statements (+8 pts)`);
  } else if (actionVerbCount >= 2) {
    actionImpactScore += 5;
    actionImpactDetails.push(`Moderate action verbs found (${actionVerbCount} detected) (+5 pts)`);
  } else if (actionVerbCount === 1) {
    actionImpactScore += 2;
    actionImpactDetails.push('Only 1 strong action verb detected (+2 pts)');
  } else {
    actionImpactDetails.push('No strong action verbs found at bullet start (-8 pts)');
  }

  // Quantified metrics check: %, $, numbers
  const metricsRegex = /(\d+%\b|\$\d+|\b\d+\s*(?:k|m|million|billion|users|clients|percent|x|hrs|days|ms|projects|teams)\b)/gi;
  const metricsMatches = text.match(metricsRegex) || [];
  if (metricsMatches.length >= 3) {
    actionImpactScore += 7;
    actionImpactDetails.push(`Excellent quantified metrics found (${metricsMatches.length} metrics: %, $, numbers) (+7 pts)`);
  } else if (metricsMatches.length >= 1) {
    actionImpactScore += 4;
    actionImpactDetails.push(`Some quantified metrics found (${metricsMatches.length} metric) (+4 pts)`);
  } else {
    actionImpactDetails.push('No quantified metrics (%, $, numbers) found (-7 pts)');
  }

  // -------------------------------------------------------------
  // Category 5: Formatting & Readability (10 Points)
  // Optimal length (4), bullet usage (3), date consistency (3)
  // -------------------------------------------------------------
  let formatScore = 0;
  const formatDetails = [];

  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount >= 350 && wordCount <= 1200) {
    formatScore += 4;
    formatDetails.push(`Optimal word count (${wordCount} words) (+4 pts)`);
  } else if ((wordCount >= 200 && wordCount < 350) || (wordCount > 1200 && wordCount <= 1600)) {
    formatScore += 2;
    formatDetails.push(`Sub-optimal word count (${wordCount} words) (+2 pts)`);
  } else {
    formatDetails.push(`Word count out of range (${wordCount} words) (-4 pts)`);
  }

  if (bulletLines.length >= 3) {
    formatScore += 3;
    formatDetails.push(`Good bullet point usage (${bulletLines.length} bullet lines detected) (+3 pts)`);
  } else if (bulletLines.length >= 1) {
    formatScore += 1;
    formatDetails.push('Few bullet points detected (+1 pt)');
  } else {
    formatDetails.push('No bullet points detected (-3 pts)');
  }

  // Date consistency check (e.g. 2020 - 2024, Jan 2021 - Present)
  const dateRangeRegex = /(?:\d{4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\s*(?:–|-|to)\s*(?:Present|Current|\d{4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/gi;
  const hasDateRanges = dateRangeRegex.test(text);
  if (hasDateRanges) {
    formatScore += 3;
    formatDetails.push('Consistent employment date ranges detected (+3 pts)');
  } else {
    formatDetails.push('Missing or inconsistent date format in work history (-3 pts)');
  }

  // -------------------------------------------------------------
  // Category 6: ATS Parseability (10 Points)
  // Standard headings (4), low non-ASCII noise (3), text extracted (3)
  // -------------------------------------------------------------
  let atsScore = 0;
  const atsDetails = [];

  let standardHeadersCount = 0;
  if (hasSummaryHeader) standardHeadersCount++;
  if (hasExpHeader) standardHeadersCount++;
  if (hasEduHeader) standardHeadersCount++;
  if (hasSkillsHeader) standardHeadersCount++;

  if (standardHeadersCount >= 3) {
    atsScore += 4;
    atsDetails.push(`Standard ATS section headings present (${standardHeadersCount}/4 headers) (+4 pts)`);
  } else if (standardHeadersCount >= 1) {
    atsScore += 2;
    atsDetails.push(`Partial standard section headings (${standardHeadersCount}/4 headers) (+2 pts)`);
  } else {
    atsDetails.push('Non-standard or missing section headings (-4 pts)');
  }

  // Low non-ASCII noise check
  const nonAsciiCount = (text.match(/[^\x00-\x7F]/g) || []).length;
  const nonAsciiRatio = nonAsciiCount / text.length;
  if (nonAsciiRatio < 0.05) {
    atsScore += 3;
    atsDetails.push('Clean plain-text formatting (low non-ASCII noise) (+3 pts)');
  } else {
    atsDetails.push('High non-ASCII / special character noise detected (-3 pts)');
  }

  // Text extraction check
  if (text.length > 100) {
    atsScore += 3;
    atsDetails.push('Successfully extracted text content (+3 pts)');
  } else {
    atsDetails.push('Extracted text is very brief (-3 pts)');
  }

  // -------------------------------------------------------------
  // Calculate Total Score (0 - 100) & Grade Assignment
  // 85+ Excellent · 70–84 Strong · 55–69 Moderate · 40–54 Needs Work · <40 Poor
  // -------------------------------------------------------------
  const totalScore = Math.max(0, Math.min(100,
    contactScore + sectionScore + keywordScore + actionImpactScore + formatScore + atsScore
  ));

  let grade = 'Poor';
  let gradeColor = 'rose';

  if (totalScore >= 85) {
    grade = 'Excellent';
    gradeColor = 'emerald';
  } else if (totalScore >= 70) {
    grade = 'Strong';
    gradeColor = 'cyan';
  } else if (totalScore >= 55) {
    grade = 'Moderate';
    gradeColor = 'amber';
  } else if (totalScore >= 40) {
    grade = 'Needs Work';
    gradeColor = 'orange';
  } else {
    grade = 'Poor';
    gradeColor = 'rose';
  }

  // -------------------------------------------------------------
  // Generate Precise General Feedback
  // -------------------------------------------------------------
  const strengths = [];
  const improvements = [];

  if (contactScore === 15) strengths.push('Complete contact details (Email, Phone, and LinkedIn/Portfolio).');
  else improvements.push('Add missing contact info (LinkedIn/Portfolio or Phone number).');

  if (sectionScore >= 20) strengths.push('Well-structured essential section headings (Summary, Experience, Education, Skills).');
  else improvements.push('Use standard, clear section headings (e.g. "Work Experience", "Education", "Skills").');

  if (keywordScore >= 18) strengths.push(`High keyword match (${keywordScore}/25 pts).`);
  else improvements.push('Incorporate more relevant technical skills and industry keywords throughout your experience.');

  if (actionImpactScore >= 12) strengths.push('Great use of strong action verbs and quantified metrics (%, $, numbers).');
  else improvements.push('Start achievement bullets with strong action verbs (e.g. Led, Built, Spearheaded) and add measurable results (%, $, user counts).');

  if (formatScore >= 8) strengths.push('Clean layout with optimal word count and bullet points.');
  else improvements.push('Format work experience into bullet points and maintain consistent date formatting (e.g., Jan 2022 – Present).');

  if (atsScore >= 8) strengths.push('High ATS parseability and clean document structure.');
  else improvements.push('Avoid non-standard characters, tables, or image headers to improve ATS parsing.');

  const feedbackSummary = `Resume earned a total ATS Rubric score of ${totalScore}/100 (${grade} Grade). ${
    totalScore >= 70
      ? 'The candidate demonstrates strong ATS formatting and content alignment.'
      : 'The resume needs structural and keyword enhancements to pass automated ATS filters.'
  }`;

  return {
    totalScore,
    grade,
    gradeColor,
    isParseable: true,
    breakdown: {
      contactInfo: { score: contactScore, max: 15, details: contactDetails },
      essentialSections: { score: sectionScore, max: 25, details: sectionDetails },
      keywordMatch: { score: keywordScore, max: 25, details: keywordDetails, matchedKeywords, missingKeywords: [] },
      actionVerbsImpact: { score: actionImpactScore, max: 15, details: actionImpactDetails },
      formattingReadability: { score: formatScore, max: 10, details: formatDetails },
      atsParseability: { score: atsScore, max: 10, details: atsDetails }
    },
    feedback: {
      summary: feedbackSummary,
      strengths,
      improvements,
      recommendation: totalScore >= 70 ? 'Ready for job submission.' : 'Apply recommended changes to boost score above 80+.'
    }
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  evaluateAtsRubric
};
