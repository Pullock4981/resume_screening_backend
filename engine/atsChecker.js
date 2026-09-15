/**
 * Comprehensive Rule-Based ATS Friendliness & Formatting Checker (0% AI Tokens)
 */
function evaluateATS(resumeText) {
  if (!resumeText || resumeText.trim().length === 0) {
    return {
      atsScore: 0,
      isParseable: false,
      warnings: ['Resume text could not be extracted (scanned image or corrupted file).'],
      checklist: [
        { name: 'Email Present', passed: false, detail: 'Not detected' },
        { name: 'Phone Present', passed: false, detail: 'Not detected' },
        { name: 'LinkedIn/GitHub Link Present', passed: false, detail: 'Not detected' },
        { name: 'Standard Section Headings', passed: false, detail: '0 detected' },
        { name: 'Bulleted Achievements', passed: false, detail: '0 bullets' },
        { name: 'Action Verbs in Bullets', passed: false, detail: 'None' },
        { name: 'Quantifiable Metrics & Numbers', passed: false, detail: 'None' },
        { name: 'No Weak Phrases', passed: true, detail: 'Clean' }
      ],
      details: {
        hasEmail: false,
        hasPhone: false,
        hasLinkedInOrWeb: false,
        sectionHeadersFound: [],
        wordCount: 0,
        bulletCount: 0,
        actionVerbCount: 0,
        hasMetrics: false,
        weakPhrasesFound: []
      }
    };
  }

  const text = resumeText.trim();
  const lowerText = text.toLowerCase();
  const warnings = [];
  let score = 100;
  const checklist = [];

  // 1. Contact Information Checks
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const hasEmail = emailRegex.test(text);

  const phoneRegex = /(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([0-9]{3})\s*\)|([0-9]{3}))\s*(?:[.-]\s*)?)?([0-9]{3})\s*(?:[.-]\s*)?([0-9]{4})|(?:\+?\d{1,4}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/;
  const hasPhone = phoneRegex.test(text);

  const linkRegex = /(linkedin\.com|github\.com|http|https|\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b)/i;
  const hasLinkedInOrWeb = linkRegex.test(text);

  if (!hasEmail) {
    score -= 10;
    warnings.push('No valid email address detected.');
  }
  checklist.push({ name: 'Email Present', passed: hasEmail, detail: hasEmail ? 'Detected' : 'Missing' });

  if (!hasPhone) {
    score -= 10;
    warnings.push('No valid phone number detected.');
  }
  checklist.push({ name: 'Phone Present', passed: hasPhone, detail: hasPhone ? 'Detected' : 'Missing' });

  if (!hasLinkedInOrWeb) {
    score -= 10;
    warnings.push('No LinkedIn/GitHub profile or portfolio link detected.');
  }
  checklist.push({ name: 'LinkedIn/Portfolio Link', passed: hasLinkedInOrWeb, detail: hasLinkedInOrWeb ? 'Detected' : 'Missing' });

  // 2. Standard Section Headers Detection
  const standardHeaders = [
    { name: 'Summary', pattern: /(summary|profile|about\s+me|objective)/i },
    { name: 'Experience', pattern: /(work\s+experience|employment\s+history|experience|career\s+history)/i },
    { name: 'Education', pattern: /(education|academic\s+background|qualifications)/i },
    { name: 'Skills', pattern: /(skills|technical\s+skills|core\s+competencies|technologies)/i },
    { name: 'Projects', pattern: /(projects|key\s+projects|portfolio)/i }
  ];

  const sectionHeadersFound = [];
  standardHeaders.forEach(hdr => {
    if (hdr.pattern.test(text)) {
      sectionHeadersFound.push(hdr.name);
    }
  });

  const headerPass = sectionHeadersFound.length >= 3;
  if (!sectionHeadersFound.includes('Experience')) {
    score -= 10;
    warnings.push('Missing explicit "Experience" or "Work History" section header.');
  }
  if (!sectionHeadersFound.includes('Skills')) {
    score -= 5;
    warnings.push('Missing explicit "Skills" section header.');
  }
  if (!sectionHeadersFound.includes('Education')) {
    score -= 5;
    warnings.push('Missing explicit "Education" section header.');
  }
  checklist.push({
    name: 'Standard Section Headings',
    passed: headerPass,
    detail: `${sectionHeadersFound.length} of 5 detected (${sectionHeadersFound.join(', ') || 'None'})`
  });

  // 3. Bulleted Achievements Detection
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const bulletLines = lines.filter(line => /^([•\-\*▪►\+]|(\d+\.))\s+/.test(line));
  const bulletCount = bulletLines.length;

  const bulletPass = bulletCount >= 3;
  if (!bulletPass) {
    score -= 10;
    warnings.push(`Only ${bulletCount} bulleted line(s) detected. Use plain bullet characters (• or -) at the start of achievement lines.`);
  }
  checklist.push({
    name: 'Bulleted Achievements',
    passed: bulletPass,
    detail: `${bulletCount} plain-text bullet line(s) detected`
  });

  // 4. Strong Action Verbs at Start of Bullets
  const strongActionVerbs = [
    'developed', 'built', 'engineered', 'designed', 'led', 'managed', 'created',
    'implemented', 'architected', 'optimized', 'increased', 'reduced', 'spearheaded',
    'automated', 'delivered', 'deployed', 'formulated', 'coordinated', 'enhanced',
    'scaled', 'transformed', 'analyzed', 'configured', 'launched', 'drove',
    'established', 'resolved', 'negotiated', 'refactored', 'integrated', 'executed'
  ];

  let actionVerbCount = 0;
  bulletLines.forEach(line => {
    const cleanLine = line.replace(/^([•\-\*▪►\+]|(\d+\.))\s+/, '').trim();
    const firstWord = cleanLine.split(/\s+/)[0]?.toLowerCase();
    if (firstWord && strongActionVerbs.includes(firstWord)) {
      actionVerbCount++;
    }
  });

  const verbPass = bulletCount > 0 ? (actionVerbCount / bulletCount) >= 0.3 : actionVerbCount > 0;
  if (!verbPass) {
    score -= 5;
    warnings.push('Fewer than 30% of bullets start with strong action verbs (e.g. Developed, Led, Spearheaded, Optimized).');
  }
  checklist.push({
    name: 'Bullets Start with Action Verbs',
    passed: verbPass,
    detail: `${actionVerbCount} of ${bulletCount} bullets start with strong action verbs`
  });

  // 5. Quantifiable Metrics & Numbers Check
  const metricsRegex = /(\d+%\b|\$\d+|\b\d+\s*(?:k|m|million|billion|users|clients|percent|x|hrs|days|ms)\b)/i;
  const hasMetrics = metricsRegex.test(text);

  if (!hasMetrics) {
    score -= 5;
    warnings.push('No quantifiable numbers or metrics (e.g. %, $, numbers of users/clients) found in achievements.');
  }
  checklist.push({
    name: 'Quantifiable Results/Numbers',
    passed: hasMetrics,
    detail: hasMetrics ? 'Numbers/metrics detected' : 'No quantifiable numbers/metrics found'
  });

  // 6. Weak / Passive Phrases Penalty
  const weakPhrases = [
    'responsible for', 'duties included', 'worked on', 'helped with', 'assisted in', 'tasked with', 'handled'
  ];
  const weakPhrasesFound = [];
  weakPhrases.forEach(phrase => {
    if (lowerText.includes(phrase)) {
      weakPhrasesFound.push(phrase);
    }
  });

  const noWeakPass = weakPhrasesFound.length === 0;
  if (!noWeakPass) {
    score -= Math.min(10, weakPhrasesFound.length * 5);
    warnings.push(`Weak passive phrases detected (${weakPhrasesFound.join(', ')}). Replace with active verbs.`);
  }
  checklist.push({
    name: 'No Weak Passive Phrases',
    passed: noWeakPass,
    detail: noWeakPass ? 'No weak phrases found' : `Weak phrases: ${weakPhrasesFound.join(', ')}`
  });

  // 7. Word Count & Density Check
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  if (wordCount < 150) {
    score -= 20;
    warnings.push(`Resume text is extremely short (${wordCount} words). Minimum recommended is 300 words.`);
  } else if (wordCount < 300) {
    score -= 5;
    warnings.push(`Resume text is short (${wordCount} words). Recommended length is 400 - 1000 words.`);
  } else if (wordCount > 1500) {
    score -= 5;
    warnings.push(`Resume text exceeds 1500 words (${wordCount} words). Recommended length is under 1200 words.`);
  }

  // Cap final score between 0 and 100
  const finalAtsScore = Math.max(0, Math.min(100, score));

  return {
    atsScore: finalAtsScore,
    isParseable: true,
    warnings,
    checklist,
    details: {
      hasEmail,
      hasPhone,
      hasLinkedInOrWeb,
      sectionHeadersFound,
      wordCount,
      bulletCount,
      actionVerbCount,
      hasMetrics,
      weakPhrasesFound
    }
  };
}

module.exports = {
  evaluateATS
};
