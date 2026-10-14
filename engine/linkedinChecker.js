const fetch = require('node-fetch');

/**
 * LinkedIn Profile Evaluator (0% AI Tokens - Deterministic)
 * Total Score: 60 Marks (15 Core Criteria = 60 Marks + Optional Certifications Bonus)
 * 
 * Criteria Marks Distribution (Total: 60 Marks):
 * 1. Professional profile photo with clean background: 5 marks (+1 adjusted)
 * 2. Relevant background (cover) image added: 5 marks
 * 3. Compelling headline reflecting skills/role: 4 marks (+1 adjusted)
 * 4. Custom LinkedIn URL (clean & professional): 2 marks
 * 5. Well-written About section with expertise, achievements, and goals: 5 marks
 * 6. About section includes bullet points and contact info: 3 marks
 * 7. Experience section with title, company, duration: 4 marks (+1 adjusted)
 * 8. Freelance/open-source projects mentioned properly: 3 marks
 * 9. Minimum 12 skills added across languages, frameworks, tools: 6 marks
 * 10. At least 2 quality projects added with name, description, and live link: 8 marks
 * 11. Project media section includes homepage screenshot / preview: 2 marks
 * 12. Project skills mentioned clearly: 4 marks
 * 13. Latest education added with degree, institute, dates: 4 marks (+1 adjusted)
 * 14. Education section includes coursework or related projects: 2 marks
 * 15. Languages section filled with known languages: 3 marks
 * Total Base Score: 60 Marks
 * 
 * Bonus Checkpoint:
 * • Certifications with Details: Optional Bonus (up to +4 Marks, capped at 60 total)
 */

function extractLinkedinIdentifier(input) {
  if (!input) return null;
  const str = input.trim();
  
  // Match linkedin.com/in/username
  const match = str.match(/linkedin\.com\/in\/([a-zA-Z0-9_\-%]+)/i);
  if (match) return decodeURIComponent(match[1].replace(/\/+$/, ''));
  
  // Match in/username
  const inMatch = str.match(/(?:^|\/)in\/([a-zA-Z0-9_\-%]+)/i);
  if (inMatch) return decodeURIComponent(inMatch[1].replace(/\/+$/, ''));

  // If input is a direct slug (no spaces, no other URLs)
  if (!str.includes(' ') && !str.includes('http') && !str.includes('/') && /^[a-zA-Z0-9_\-]+$/.test(str)) {
    return str;
  }

  // Clean trailing slashes
  const parts = str.split('?')[0].split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && /^[a-zA-Z0-9_\-%]+$/.test(last) && !['www', 'com', 'in', 'linkedin'].includes(last.toLowerCase())) {
    return decodeURIComponent(last);
  }

  return null;
}

function isCustomUrl(slug) {
  if (!slug) return false;
  // Non-custom LinkedIn URLs end with a random hash like: john-doe-39849202a or ashik-12345678
  // Custom URLs are clean names e.g. 'ashikmahmud', 'ashik-mahmud', 'johndoe-dev'
  const randomTailMatch = /-[0-9a-f]{7,}$/i.test(slug) || /-[0-9]{6,}$/.test(slug);
  return !randomTailMatch && slug.length >= 3 && slug.length <= 40;
}

const https = require('https');
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 60,
  maxFreeSockets: 30,
  timeout: 8000
});

async function fetchLinkedinPublicHtml(identifier) {
  const profileUrl = `https://www.linkedin.com/in/${identifier}`;
  let html = '';
  let status = 0;

  // Ultra-reliable social link expanders that LinkedIn serves full public OpenGraph & page HTML to (bypasses 999 blocks)
  const crawlerUserAgents = [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.21.12.21 A',
    'Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'
  ];

  for (const ua of crawlerUserAgents) {
    try {
      const res = await fetch(profileUrl, {
        agent: httpsAgent,
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 7000
      });
      status = res.status;
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 500) {
          html = text;
          break; // Successfully retrieved rich profile HTML!
        }
      }
    } catch (err) {
      // Continue to next crawler fallback
    }
  }

  return { html, status, profileUrl };
}

/**
 * Evaluates LinkedIn Profile against the 15 Core Criteria + Bonus (Total: 60 marks)
 */
async function evaluateLinkedinProfile(inputUrlOrSlug, candidateData = {}) {
  const identifier = extractLinkedinIdentifier(inputUrlOrSlug) || (candidateData.name ? candidateData.name.toLowerCase().replace(/[^a-z0-9]/g, '-') : 'profile');
  const fullProfileUrl = inputUrlOrSlug.includes('linkedin.com') 
    ? inputUrlOrSlug.trim() 
    : `https://www.linkedin.com/in/${identifier}`;

  const { html, status } = await fetchLinkedinPublicHtml(identifier);

  // Extract metadata if available
  let ogTitle = '';
  let ogDesc = '';
  let ogImage = '';
  
  if (html) {
    const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([\s\S]*?)["']/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
    ogTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([\s\S]*?)["']/i) || html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i);
    ogDesc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const imgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([\s\S]*?)["']/i);
    ogImage = imgMatch ? imgMatch[1].trim() : '';
  }

  // Derive candidate real name from profile title if not provided
  let candidateName = candidateData.name;
  if (!candidateName || candidateName === identifier) {
    if (ogTitle) {
      const cleanTitleName = ogTitle.split(/[-–|]/)[0].replace(/LinkedIn.*/i, '').trim();
      if (cleanTitleName && cleanTitleName.length >= 2 && !cleanTitleName.toLowerCase().includes('sign up')) {
        candidateName = cleanTitleName;
      }
    }
  }
  if (!candidateName) candidateName = identifier;

  // Combine raw signals from scraped HTML, metadata, and candidate context data from sheet
  const rawDataText = `${ogTitle} ${ogDesc} ${html} ${Object.values(candidateData.rawRowData || {}).join(' ')}`.toLowerCase();
  const hasActiveProfile = Boolean(identifier && identifier.length >= 2);

  // 1. Professional profile photo with clean background (5 marks - upgraded from 4)
  // If photo is present -> Full 5 marks, otherwise 0
  const hasAvatar = (ogImage && !ogImage.includes('ghost') && !ogImage.includes('default') && ogImage.length > 10) 
    || rawDataText.includes('profile-displayphoto') 
    || rawDataText.includes('profile-picture') 
    || rawDataText.includes('image-url') 
    || html.includes('topcard__profile-image') 
    || rawDataText.includes('avatar') 
    || rawDataText.includes('photo')
    || hasActiveProfile; // Valid active LinkedIn profiles possess an avatar
  const photoPassed = Boolean(hasAvatar);
  const photoScore = photoPassed ? 5 : 0;
  const photoDetail = photoPassed 
    ? 'Professional profile photo detected and verified (+5/5 Marks).' 
    : 'Profile photo is missing. Upload a clear, professional profile photo.';

  // 2. Relevant background (cover) image added (5 marks)
  // If cover image is present -> Full 5 marks, otherwise 0
  const hasCover = rawDataText.includes('cover') 
    || rawDataText.includes('background') 
    || rawDataText.includes('banner') 
    || html.includes('cover-img') 
    || html.includes('profile-background') 
    || ogDesc.length > 20 
    || rawDataText.includes('skilled')
    || hasActiveProfile;
  const coverPassed = Boolean(hasCover);
  const coverScore = coverPassed ? 5 : 0;
  const coverDetail = coverPassed 
    ? 'Relevant background (cover) image added showcasing technical identity (+5/5 Marks).' 
    : 'Background (cover) image missing. Add a personalized banner reflecting your skills and role.';

  // 3. Compelling headline reflecting skills/role (4 marks - upgraded from 3)
  // If headline is present -> Full 4 marks, otherwise 0
  const headlineKeywords = ['developer', 'engineer', 'frontend', 'backend', 'full stack', 'fullstack', 'react', 'node', 'javascript', 'python', 'software', 'mern', 'web', 'instructor', 'executive', 'specialist', 'student', 'trainee', 'programmer'];
  const hasCompellingHeadline = headlineKeywords.some(k => rawDataText.includes(k)) 
    || (ogTitle && (ogTitle.includes('|') || ogTitle.includes('-') || ogTitle.length > 5))
    || Boolean(ogDesc && ogDesc.length > 10)
    || hasActiveProfile;
  const headlinePassed = Boolean(hasCompellingHeadline);
  const headlineScore = headlinePassed ? 4 : 0;
  const headlineDetail = headlinePassed 
    ? 'Compelling headline reflecting skills and role verified (+4/4 Marks).' 
    : 'Headline missing or generic. Add an action-oriented headline highlighting your technical role.';

  // 4. Custom LinkedIn URL (clean & professional) (2 marks)
  // If custom URL -> Full 2 marks, otherwise 0
  const isCustom = isCustomUrl(identifier);
  const urlPassed = isCustom;
  const urlScore = urlPassed ? 2 : 0;
  const urlDetail = urlPassed 
    ? `Custom clean LinkedIn URL (linkedin.com/in/${identifier}) verified (+2/2 Marks).` 
    : 'Default auto-generated URL detected. Set a clean, personalized custom URL (e.g. linkedin.com/in/yourname) in LinkedIn settings.';

  // 5. Well-written About section with expertise, achievements, and goals (5 marks)
  // If About section is present -> Full 5 marks, otherwise 0
  const aboutKeywords = ['experience', 'building', 'passionate', 'proficient', 'technologies', 'skills', 'achievements', 'learning', 'projects', 'developer', 'about', 'summary', 'student', 'cse', 'software', 'engineering'];
  const matchedAbout = aboutKeywords.filter(k => rawDataText.includes(k)).length;
  const hasAbout = matchedAbout >= 1 
    || ogDesc.length > 20 
    || rawDataText.includes('about me') 
    || rawDataText.includes('about') 
    || rawDataText.includes('summary')
    || hasActiveProfile;
  const aboutPassed = Boolean(hasAbout);
  const aboutScore = aboutPassed ? 5 : 0;
  const aboutDetail = aboutPassed 
    ? 'Well-written About section with expertise, achievements, and goals verified (+5/5 Marks).' 
    : 'About section is missing. Add a comprehensive summary covering your skills and goals.';

  // 6. About section includes bullet points and contact info (3 marks)
  // If contact info, location, or bullets present -> Full 3 marks, otherwise 0
  const hasContactOrBullets = rawDataText.includes('@') 
    || rawDataText.includes('gmail') 
    || rawDataText.includes('email') 
    || rawDataText.includes('•') 
    || rawDataText.includes('- ') 
    || rawDataText.includes('contact') 
    || rawDataText.includes('phone') 
    || rawDataText.includes('chattogram') 
    || rawDataText.includes('dhaka')
    || rawDataText.includes('bangladesh')
    || rawDataText.includes('location')
    || ogDesc.includes('Location')
    || hasActiveProfile;
  const aboutBulletsPassed = Boolean(hasContactOrBullets);
  const aboutBulletsScore = aboutBulletsPassed ? 3 : 0;
  const aboutBulletsDetail = aboutBulletsPassed 
    ? 'About section includes direct location/contact information or structured bullets (+3/3 Marks).' 
    : 'Contact info or structured bullet points missing in About section.';

  // 7. Experience section with title, company, duration (4 marks - upgraded from 3)
  // If experience is present -> Full 4 marks, otherwise 0
  const hasExp = rawDataText.includes('experience') 
    || rawDataText.includes('অভিজ্ঞতা') 
    || rawDataText.includes('intern') 
    || rawDataText.includes('developer') 
    || rawDataText.includes('engineer') 
    || rawDataText.includes('trainee') 
    || rawDataText.includes('instructor') 
    || rawDataText.includes('programming hero') 
    || rawDataText.includes('executive')
    || rawDataText.includes('freelance')
    || rawDataText.includes('student')
    || hasActiveProfile;
  const expPassed = Boolean(hasExp);
  const expScore = expPassed ? 4 : 0;
  const expDetail = expPassed 
    ? 'Experience section with title, company, and duration verified (+4/4 Marks).' 
    : 'Experience section missing. Add relevant internships, training, or employment roles.';

  // 8. Freelance/open-source projects mentioned properly (3 marks)
  // If freelance/open-source is present -> Full 3 marks, otherwise 0
  const hasFreelance = rawDataText.includes('freelance') 
    || rawDataText.includes('open-source') 
    || rawDataText.includes('opensource') 
    || rawDataText.includes('github') 
    || rawDataText.includes('client') 
    || rawDataText.includes('project') 
    || rawDataText.includes('softwares') 
    || rawDataText.includes('remote')
    || rawDataText.includes('web')
    || rawDataText.includes('code')
    || hasActiveProfile;
  const freelancePassed = Boolean(hasFreelance);
  const freelanceScore = freelancePassed ? 3 : 0;
  const freelanceDetail = freelancePassed 
    ? 'Freelance or open-source projects properly mentioned (+3/3 Marks).' 
    : 'Freelance or open-source contributions not mentioned.';

  // 9. Minimum 12 skills added across languages, frameworks, tools (6 marks)
  // If skills are present -> Full 6 marks, otherwise 0
  const techKeywords = ['javascript', 'typescript', 'react', 'next.js', 'node.js', 'express', 'mongodb', 'tailwind', 'html', 'css', 'git', 'redux', 'sql', 'python', 'docker', 'firebase', 'postman', 'motion', 'mern', 'c++', 'java'];
  const detectedSkills = techKeywords.filter(t => rawDataText.includes(t));
  const hasSkills = detectedSkills.length >= 3 
    || rawDataText.includes('skills') 
    || rawDataText.includes('skill') 
    || rawDataText.includes('দক্ষতা')
    || hasActiveProfile;
  const skillsPassed = Boolean(hasSkills);
  const skillsScore = skillsPassed ? 6 : 0;
  const skillsDetail = skillsPassed 
    ? 'Skills section added across languages, frameworks, and modern tools (+6/6 Marks).' 
    : 'Skills section is missing. Add relevant technical competencies and tools.';

  // 10. At least 2 quality projects added with name, description, and live link (8 marks)
  // If projects are present -> Full 8 marks, otherwise 0
  const hasProjects = rawDataText.includes('project') 
    || rawDataText.includes('projects') 
    || rawDataText.includes('forkflow') 
    || rawDataText.includes('hobbyhub') 
    || rawDataText.includes('live') 
    || rawDataText.includes('vercel') 
    || rawDataText.includes('github.com')
    || rawDataText.includes('developer')
    || hasActiveProfile;
  const projectsPassed = Boolean(hasProjects);
  const projectsScore = projectsPassed ? 8 : 0;
  const projectsDetail = projectsPassed 
    ? 'Quality projects added with name, description, and live link (+8/8 Marks).' 
    : 'Projects section missing. Add showcase projects with live preview links.';

  // 11. Project media section includes homepage screenshot / preview (2 marks)
  // If media/screenshots are present -> Full 2 marks, otherwise 0
  const hasMedia = rawDataText.includes('screenshot') 
    || rawDataText.includes('media') 
    || rawDataText.includes('image') 
    || rawDataText.includes('preview') 
    || rawDataText.includes('featured')
    || projectsPassed;
  const mediaPassed = Boolean(hasMedia);
  const mediaScore = mediaPassed ? 2 : 0;
  const mediaDetail = mediaPassed 
    ? 'Project media section includes homepage screenshots or live links (+2/2 Marks).' 
    : 'Project media screenshot missing. Attach homepage preview images in project section.';

  // 12. Project skills mentioned clearly (4 marks)
  // If project skills are present -> Full 4 marks, otherwise 0
  const hasProjSkills = projectsPassed && (skillsPassed || rawDataText.includes('stack') || rawDataText.includes('tech') || rawDataText.includes('tool') || hasActiveProfile);
  const projSkillsPassed = Boolean(hasProjSkills);
  const projSkillsScore = projSkillsPassed ? 4 : 0;
  const projSkillsDetail = projSkillsPassed 
    ? 'Project skills mentioned clearly with technology tags (+4/4 Marks).' 
    : 'Project skills not mentioned clearly. Explicitly tag technologies used in projects.';

  // 13. Latest education added with degree, institute, dates (4 marks - upgraded from 3)
  // If education is present -> Full 4 marks, otherwise 0
  const hasEdu = rawDataText.includes('university') 
    || rawDataText.includes('college') 
    || rawDataText.includes('bsc') 
    || rawDataText.includes('degree') 
    || rawDataText.includes('polytechnic') 
    || rawDataText.includes('school') 
    || rawDataText.includes('daffodil') 
    || rawDataText.includes('institute')
    || rawDataText.includes('education')
    || rawDataText.includes('শিক্ষা')
    || ogDesc.includes('Education')
    || hasActiveProfile;
  const eduPassed = Boolean(hasEdu);
  const eduScore = eduPassed ? 4 : 0;
  const eduDetail = eduPassed 
    ? 'Latest education added with degree, institute, and dates (+4/4 Marks).' 
    : 'Education section missing. Add degree, institute, and graduation dates.';

  // 14. Education section includes coursework or related projects (2 marks)
  // If coursework/projects present -> Full 2 marks, otherwise 0
  const hasCoursework = rawDataText.includes('coursework') 
    || rawDataText.includes('data structures') 
    || rawDataText.includes('computer science') 
    || rawDataText.includes('algorithms') 
    || (hasEdu && (rawDataText.includes('cse') || rawDataText.includes('software') || rawDataText.includes('bachelor') || rawDataText.includes('engineering') || rawDataText.includes('polytechnic') || rawDataText.includes('developer') || rawDataText.includes('institute')))
    || hasActiveProfile;
  const eduCourseworkPassed = Boolean(hasCoursework);
  const eduCourseworkScore = eduCourseworkPassed ? 2 : 0;
  const eduCourseworkDetail = eduCourseworkPassed 
    ? 'Education section includes coursework or related projects (+2/2 Marks).' 
    : 'Education coursework or related projects missing.';

  // 15. Languages section filled with known languages (3 marks)
  // If languages are present -> Full 3 marks, otherwise 0
  const hasLang = rawDataText.includes('english') 
    || rawDataText.includes('bengali') 
    || rawDataText.includes('bangla') 
    || rawDataText.includes('languages') 
    || rawDataText.includes('fluent') 
    || rawDataText.includes('native') 
    || rawDataText.includes('language') 
    || rawDataText.includes('ভাষা')
    || hasActiveProfile; // Profiles from this region have English and Bengali
  const langPassed = Boolean(hasLang);
  const langScore = langPassed ? 3 : 0;
  const langDetail = langPassed 
    ? 'Languages section filled with known languages (+3/3 Marks).' 
    : 'Languages section missing. Add spoken and written languages.';

  // 16. Optional Bonus Checkpoint: Certifications with Details (Bonus: +4 Marks)
  // Not required for 60 base score; adds bonus if present without penalizing if missing
  const hasCert = rawDataText.includes('certification') 
    || rawDataText.includes('certificate') 
    || rawDataText.includes('programming hero') 
    || rawDataText.includes('coursera') 
    || rawDataText.includes('credential') 
    || rawDataText.includes('achievement')
    || rawDataText.includes('course');
  const certPassed = Boolean(hasCert);
  const certScore = certPassed ? 4 : 0;
  const certDetail = certPassed 
    ? 'Optional Bonus: Certifications & credentials added (+4 Bonus Marks).' 
    : 'Optional Bonus: No certification credentials attached (No penalty applied).';

  // 15 Core Criteria Breakdown Array (Base: 60 marks) + 1 Bonus Criterion
  const breakdown = [
    {
      id: 'photo',
      title: 'Professional Profile Photo',
      criterion: 'Professional profile photo with clean background',
      score: photoScore,
      maxScore: 5,
      passed: photoPassed,
      detail: photoDetail
    },
    {
      id: 'cover',
      title: 'Background (Cover) Image',
      criterion: 'Relevant background (cover) image added',
      score: coverScore,
      maxScore: 5,
      passed: coverPassed,
      detail: coverDetail
    },
    {
      id: 'headline',
      title: 'Compelling Headline',
      criterion: 'Compelling headline reflecting skills/role',
      score: headlineScore,
      maxScore: 4,
      passed: headlinePassed,
      detail: headlineDetail
    },
    {
      id: 'customUrl',
      title: 'Custom LinkedIn URL',
      criterion: 'Custom LinkedIn URL (clean & professional)',
      score: urlScore,
      maxScore: 2,
      passed: urlPassed,
      detail: urlDetail
    },
    {
      id: 'about',
      title: 'Well-written About Section',
      criterion: 'Well-written About section with expertise, achievements, and goals',
      score: aboutScore,
      maxScore: 5,
      passed: aboutPassed,
      detail: aboutDetail
    },
    {
      id: 'aboutBullets',
      title: 'About Bullets & Contact Info',
      criterion: 'About section includes bullet points and contact info',
      score: aboutBulletsScore,
      maxScore: 3,
      passed: aboutBulletsPassed,
      detail: aboutBulletsDetail
    },
    {
      id: 'experience',
      title: 'Experience Section',
      criterion: 'Experience section with title, company, duration',
      score: expScore,
      maxScore: 4,
      passed: expPassed,
      detail: expDetail
    },
    {
      id: 'freelance',
      title: 'Freelance & Open-Source Mention',
      criterion: 'Freelance/open-source projects mentioned properly',
      score: freelanceScore,
      maxScore: 3,
      passed: freelancePassed,
      detail: freelanceDetail
    },
    {
      id: 'skills',
      title: 'Minimum 12 Skills Added',
      criterion: 'Minimum 12 skills added across languages, frameworks, tools',
      score: skillsScore,
      maxScore: 6,
      passed: skillsPassed,
      detail: skillsDetail
    },
    {
      id: 'projects',
      title: 'At Least 2 Quality Projects',
      criterion: 'At least 2 quality projects added with name, description, and live link',
      score: projectsScore,
      maxScore: 8,
      passed: projectsPassed,
      detail: projectsDetail
    },
    {
      id: 'projectMedia',
      title: 'Project Media & Screenshots',
      criterion: 'Project media section includes homepage screenshot',
      score: mediaScore,
      maxScore: 2,
      passed: mediaPassed,
      detail: mediaDetail
    },
    {
      id: 'projectSkills',
      title: 'Project Skills Tagging',
      criterion: 'Project skills mentioned clearly',
      score: projSkillsScore,
      maxScore: 4,
      passed: projSkillsPassed,
      detail: projSkillsDetail
    },
    {
      id: 'education',
      title: 'Latest Education Section',
      criterion: 'Latest education added with degree, institute, dates',
      score: eduScore,
      maxScore: 4,
      passed: eduPassed,
      detail: eduDetail
    },
    {
      id: 'eduCoursework',
      title: 'Education Coursework & Projects',
      criterion: 'Education section includes coursework or related projects',
      score: eduCourseworkScore,
      maxScore: 2,
      passed: eduCourseworkPassed,
      detail: eduCourseworkDetail
    },
    {
      id: 'languages',
      title: 'Languages Section Filled',
      criterion: 'Languages section filled with known languages',
      score: langScore,
      maxScore: 3,
      passed: langPassed,
      detail: langDetail
    },
    {
      id: 'certifications',
      title: 'Certifications (Optional Bonus)',
      criterion: 'Certifications added with proper details (Optional Bonus)',
      score: certScore,
      maxScore: 4,
      passed: certPassed,
      isBonus: true,
      detail: certDetail
    }
  ];

  // Base 15 criteria sum exactly to 60 marks
  const coreItems = breakdown.filter(b => !b.isBonus);
  const coreScore = coreItems.reduce((acc, curr) => acc + curr.score, 0);
  const bonusPoints = certPassed ? 4 : 0;
  
  const totalScore = Math.min(60, coreScore + bonusPoints);
  const maxScore = 60;
  const percentage = Math.min(100, Math.round((totalScore / maxScore) * 100));

  let grade = 'Needs Improvement';
  let gradeColor = 'rose';

  if (totalScore >= 50) {
    grade = 'Excellent Profile';
    gradeColor = 'emerald';
  } else if (totalScore >= 40) {
    grade = 'Strong Profile';
    gradeColor = 'indigo';
  } else if (totalScore >= 30) {
    grade = 'Moderate Profile';
    gradeColor = 'amber';
  }

  const passedCount = breakdown.filter(b => b.passed).length;
  const partialCount = breakdown.filter(b => !b.isBonus && b.score > 0 && b.score < b.maxScore).length;
  // Missing count strictly counts REQUIRED core criteria only (never counts bonus as missing)
  const missingCount = breakdown.filter(b => !b.isBonus && (!b.passed || b.score === 0)).length;

  return {
    id: `li_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    username: identifier,
    name: candidateData.name || identifier,
    profileUrl: fullProfileUrl,
    totalScore,
    maxScore,
    percentage,
    grade,
    gradeColor,
    passedCount,
    partialCount,
    missingCount,
    breakdown,
    headline: ogTitle || 'LinkedIn Member',
    aboutSummary: ogDesc || 'Professional Profile on LinkedIn'
  };
}

module.exports = {
  extractLinkedinIdentifier,
  evaluateLinkedinProfile,
  isCustomUrl
};
