/** ATS 100-Point Master Rubric Evaluator */
const SECTION_NORMALIZER = {
  SUMMARY: ['summary', 'professional summary', 'career summary', 'profile', 'about me', 'executive summary'],
  EXPERIENCE: ['experience', 'work experience', 'professional experience', 'employment history'],
  EDUCATION: ['education', 'academic background', 'educational background', 'qualifications'],
  SKILLS: ['skills', 'technical skills', 'core competencies', 'technical expertise', 'technologies'],
  PROJECTS: ['projects', 'personal projects', 'key projects', 'academic projects', 'software projects'],
  CERTIFICATIONS: ['certifications', 'licenses', 'certificates', 'credentials'],
  ACHIEVEMENTS: ['achievements', 'awards', 'honors', 'accomplishments'],
  PUBLICATIONS: ['publications', 'research papers'],
  VOLUNTEER: ['volunteer experience', 'volunteering'],
  LEADERSHIP: ['leadership', 'extracurricular activities'],
  INTERNSHIP: ['internship', 'internships'],
  AFFILIATIONS: ['professional affiliations', 'memberships'],
  LANGUAGES: ['languages', 'language proficiency'],
  COURSEWORK: ['coursework', 'relevant coursework']
};

const SKILL_ALIASES = { js: 'JavaScript', ts: 'TypeScript', postgres: 'PostgreSQL', postgresql: 'PostgreSQL', reactjs: 'React', nodejs: 'Node.js', py: 'Python', cpp: 'C++', aws: 'AWS', gcp: 'Google Cloud Platform', k8s: 'Kubernetes', mongo: 'MongoDB', nextjs: 'Next.js' };
const STRONG_ACTION_VERBS = new Set(['built', 'developed', 'implemented', 'led', 'automated', 'optimized', 'designed', 'improved', 'reduced', 'increased', 'delivered', 'migrated', 'architected', 'created', 'engineered', 'spearheaded', 'orchestrated', 'accelerated', 'launched', 'refactored']);
const WEAK_PHRASES = ['responsible for', 'duties included', 'worked on', 'helped with', 'assisted with', 'involved in', 'was responsible for', 'handled'];
const UNNECESSARY_PERSONAL_PATTERNS = [{ key: 'dob', str: 'date of birth', label: 'Date of Birth' }, { key: 'marital', str: 'marital status', label: 'Marital Status' }, { key: 'religion', str: 'religion', label: 'Religion' }, { key: 'gender', str: 'gender', label: 'Gender' }, { key: 'parents', str: 'father name', label: 'Parents Details' }, { key: 'nid', str: 'nid', label: 'NID / Passport Information' }, { key: 'nationality', str: 'nationality', label: 'Nationality' }];
const GENERIC_SUMMARY_PHRASES = ['hardworking professional', 'passionate individual', 'team player', 'looking for a challenging opportunity', 'results-driven professional', 'self-motivated team player', 'detail-oriented individual', 'go-getter'];

function evaluateAtsRubric(resumeText, jobDescription, options) {
  const text = String(resumeText || '').trim();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const textLower = text.toLowerCase();

  const contact = extractContactInfo(lines, text);
  const unnecessaryPersonal = detectUnnecessaryPersonalInfo(text);
  const sections = detectSections(lines);

  let contactScore = 0;
  if (contact.email_valid) contactScore += 2;
  if (contact.phone_present) contactScore += 2;
  if (contact.linkedin_url) contactScore += 1;

  let formattingScore = 5;
  if (unnecessaryPersonal.length > 0) {
    formattingScore = Math.max(0, 5 - unnecessaryPersonal.length * 2);
  }
  if (!text || text.length < 50) {
    formattingScore = 0;
  }

  const detectedSectionKeys = Object.keys(sections);
  let sectionScore = 0;
  if (detectedSectionKeys.includes('EXPERIENCE')) sectionScore += 4;
  if (detectedSectionKeys.includes('EDUCATION')) sectionScore += 4;
  if (detectedSectionKeys.includes('SKILLS')) sectionScore += 4;
  if (detectedSectionKeys.includes('PROJECTS') || detectedSectionKeys.includes('SUMMARY')) sectionScore += 3;
  sectionScore = Math.min(15, sectionScore);

  let parsingScore = 0;
  if (text.length >= 200) parsingScore += 10;
  if (text.length >= 500) parsingScore += 10;
  if (lines.length >= 10) parsingScore += 5;
  if (text.length < 100) parsingScore = 0;

  let summaryScore = 0;
  const hasSummary = detectedSectionKeys.includes('SUMMARY') || lines.some(l => /summary|profile|about me/i.test(l));
  if (hasSummary) summaryScore += 10;
  const hasGenericPhrases = GENERIC_SUMMARY_PHRASES.some(p => textLower.includes(p));
  if (hasSummary && !hasGenericPhrases) summaryScore += 10;
  else if (hasSummary) summaryScore += 5;
  if (!text || text.length < 100) summaryScore = 0;

  let bulletScore = 0;
  let actionVerbCount = 0;
  STRONG_ACTION_VERBS.forEach(verb => {
    if (textLower.includes(verb)) actionVerbCount++;
  });
  let weakPhraseCount = 0;
  WEAK_PHRASES.forEach(phrase => {
    if (textLower.includes(phrase)) weakPhraseCount++;
  });
  let numbersCount = (text.match(/\b\d+(?:%|\+|\b)/g) || []).length;

  if (actionVerbCount >= 3) bulletScore += 6;
  else if (actionVerbCount >= 1) bulletScore += 3;
  if (numbersCount >= 2) bulletScore += 6;
  else if (numbersCount >= 1) bulletScore += 3;
  if (weakPhraseCount === 0) bulletScore += 3;
  bulletScore = Math.min(15, bulletScore);

  let skillsScore = 0;
  const detectedSkills = [];
  Object.entries(SKILL_ALIASES).forEach(([alias, skillName]) => {
    if (textLower.includes(alias) || textLower.includes(skillName.toLowerCase())) {
      if (!detectedSkills.includes(skillName)) detectedSkills.push(skillName);
    }
  });
  if (detectedSkills.length >= 5) skillsScore = 15;
  else if (detectedSkills.length >= 3) skillsScore = 12;
  else if (detectedSkills.length >= 1) skillsScore = 8;
  else skillsScore = 3;

  const categoryScores = {
    parsing_structure: { score: parsingScore, max: 25, label: 'Parsing Structure' },
    section_organization: { score: sectionScore, max: 15, label: 'Section Organization' },
    content_summary_quality: { score: summaryScore, max: 20, label: 'Content Summary Quality' },
    experience_bullet_quality: { score: bulletScore, max: 15, label: 'Experience Bullet Quality' },
    skills_relevance: { score: skillsScore, max: 15, label: 'Skills Keyword Relevance' },
    contact_info: { score: contactScore, max: 5, label: 'Contact Professional Info' },
    formatting_risk: { score: formattingScore, max: 5, label: 'Formatting Risk' }
  };

  let totalScore = parsingScore + sectionScore + summaryScore + bulletScore + skillsScore + contactScore + formattingScore;
  totalScore = Math.min(100, Math.max(0, Math.round(totalScore)));

  const recommendations = [];
  if (!contact.email_valid) {
    recommendations.push({ severity: 'CRITICAL', title: 'Missing Valid Email', message: 'No valid email address detected in candidate resume header.' });
  }
  if (!contact.phone_present) {
    recommendations.push({ severity: 'HIGH', title: 'Missing Phone Number', message: 'Contact phone number was missing or unparseable.' });
  }
  if (!contact.linkedin_url) {
    recommendations.push({ severity: 'MEDIUM', title: 'Missing LinkedIn Profile', message: 'Adding a professional LinkedIn profile URL improves recruiter response rate.' });
  }
  if (unnecessaryPersonal.length > 0) {
    recommendations.push({ severity: 'HIGH', title: 'Unnecessary Personal Info', message: 'Remove unnecessary personal info to protect privacy and follow standard ATS guidelines.' });
  }
  if (!detectedSectionKeys.includes('EXPERIENCE')) {
    recommendations.push({ severity: 'CRITICAL', title: 'Missing Work Experience Section', message: 'Standard ATS parsers require an explicit Work Experience or Professional Experience section header.' });
  }
  if (!detectedSectionKeys.includes('SKILLS')) {
    recommendations.push({ severity: 'HIGH', title: 'Missing Technical Skills Section', message: 'Include a dedicated Skills or Technical Skills section for optimal keyword matching.' });
  }
  if (weakPhraseCount > 0) {
    recommendations.push({ severity: 'MEDIUM', title: 'Weak Passive Phrases Found', message: 'Replace passive phrases like responsible for or worked on with strong action verbs (built, engineered, led).' });
  }
  if (numbersCount === 0) {
    recommendations.push({ severity: 'MEDIUM', title: 'Quantifiable Metrics Missing', message: 'Include numbers, percentages, or metrics to demonstrate measurable impact in work experience.' });
  }
  if (recommendations.length === 0) {
    recommendations.push({ severity: 'GOOD', title: 'High ATS Compatibility', message: 'Resume follows standard ATS layout, complete contact details, and clean section headers.' });
  }

  const grade = totalScore >= 80 ? 'ATS Friendly' : (totalScore >= 60 ? 'Needs Work' : 'High Risk');
  const parsingStatus = totalScore >= 80 ? 'PASSED - HIGH ATS COMPATIBILITY' : (totalScore >= 60 ? 'MODERATE ATS COMPATIBILITY' : 'LOW ATS COMPATIBILITY');

  return {
    ats_score: totalScore,
    atsScore: totalScore,
    totalScore: totalScore,
    matchScore: totalScore,
    finalScore: totalScore,
    grade: grade,
    category: grade,
    criticalFlag: totalScore < 60,
    parsing_status: parsingStatus,
    category_scores: categoryScores,
    contact: contact,
    unnecessary_personal_info: unnecessaryPersonal,
    sections: sections,
    reading_order_issues: [],
    section_content_relationships: [],
    skills_analysis: { detected: detectedSkills, rating_risk: false },
    recommendations: recommendations,
    feedback: {
      summary: grade + ' (' + totalScore + '/100 Marks). Key sections: ' + (detectedSectionKeys.join(', ') || 'None') + '. Skills detected: ' + detectedSkills.length + '.'
    }
  };
}

function extractContactInfo(lines, text) {
  const emailMatch = text.match(new RegExp('[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}'));
  const phoneMatch = text.match(new RegExp('(?:\\+?\\d{1,3}[-.\\s]?)?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}'));
  const linkedinMatch = text.match(new RegExp('(?:https?:\\/\\/)?(?:www\\.)?linkedin\\.com\\/in\\/[a-zA-Z0-9_-]+', 'i'));
  return {
    name: lines[0] || 'Candidate',
    email: emailMatch ? emailMatch[0] : null,
    email_valid: Boolean(emailMatch),
    phone: phoneMatch ? phoneMatch[0] : null,
    phone_present: Boolean(phoneMatch),
    linkedin_url: linkedinMatch ? linkedinMatch[0] : null
  };
}

function detectUnnecessaryPersonalInfo(text) {
  const flagged = [];
  UNNECESSARY_PERSONAL_PATTERNS.forEach(item => {
    if (text.toLowerCase().includes(item.str)) flagged.push(item.label);
  });
  return flagged;
}

function detectSections(lines) {
  const sections = {};
  let currentSection = null;
  lines.forEach(line => {
    const cleaned = line.replace(/[^a-zA-Z0-9\\s]/g, '').trim().toLowerCase();
    let matchedKey = null;
    if (cleaned.length < 35) {
      for (const [key, aliases] of Object.entries(SECTION_NORMALIZER)) {
        if (aliases.some(alias => cleaned === alias || cleaned.startsWith(alias + ' '))) {
          matchedKey = key;
          break;
        }
      }
    }
    if (matchedKey) {
      currentSection = matchedKey;
      if (!sections[currentSection]) sections[currentSection] = [];
    } else if (currentSection) {
      sections[currentSection].push(line);
    }
  });
  return sections;
}

module.exports = { evaluateAtsRubric };