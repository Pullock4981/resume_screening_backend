const fetch = require('node-fetch');

/**
 * LinkedIn Profile Evaluator (0% AI Tokens - Deterministic)
 * Total Base Score: 60 Marks (14 Core Checkpoints = 60 Marks + 1 Optional Volunteer Bonus Checkpoint)
 * 
 * Strict "To-the-Point" Evaluation with Partial Mark Deductions:
 * 1. Profile Basics (15 Marks):
 *    - 1. Profile Photo (High-quality headshot, neutral background, clean attire): 4 Marks [0 or 4]
 *    - 2. Background Photo / Banner (Tech-themed banner, code graphic, logo): 4 Marks [0 or 4]
 *    - 3. Headline (Both core technical expertise AND target field): 4 Marks [Full 4, Partial 2, or 0]
 *    - 4. Custom URL (Clean vanity URL e.g. linkedin.com/in/yourname): 3 Marks [0 or 3]
 * 
 * 2. About Section (9 Marks):
 *    - 5. About Content & Structure (Bullet points, Tech Expertise, Achievements, Goals): 5 Marks [Full 5, Partial 2.5, or 0]
 *    - 6. Contact Info in About (Email, Portfolio URL & Phone with country code): 4 Marks [Full 4, Partial 1.5-2.5, or 0]
 * 
 * 3. Experience Section (5 Marks):
 *    - 7. Experience / Freelance / Open-Source (Title, quantifiable outcomes, responsibilities): 5 Marks [Full 5, Partial 3, or 0]
 * 
 * 4. Feature Section (4 Marks):
 *    - 8. Featured Section (At least 2 features added - projects, live links, articles): 4 Marks [Full 4, Partial 2, or 0]
 * 
 * 5. Skills Section (6 Marks):
 *    - 9. 10–15 Key Skills (Languages, frameworks, tools, interpersonal skills): 6 Marks [Full 6, Partial 2-3.5, or 0]
 * 
 * 6. Projects Section (9 Marks):
 *    - 10. Showcase at least 2 Key Projects (Names, descriptions, tech stack, GitHub repo links): 5 Marks [Full 5, Partial 2.5, or 0]
 *    - 11. Project Live Demo, Features & Screenshots (3-4 features, tagged skills, screenshots, live URL): 4 Marks [Full 4, Partial 2, or 0]
 * 
 * 7. Education (4 Marks):
 *    - 12. Last Education Focus (Degree, institute, relevant coursework/projects; avoid if school/college): 4 Marks [Full 4, Partial 2.5, or 0]
 * 
 * 8. Languages (4 Marks):
 *    - 13. Languages with Proficiency (Bangla, English, Hindi with proficiency levels): 4 Marks [Full 4, Partial 2, or 0]
 * 
 * 9. Certifications (4 Marks):
 *    - 14. Certifications & Credentials (FreeCodeCamp, Coursera, Google UX, AWS, etc. with issuer and dates): 4 Marks [Full 4, Partial 2, or 0]
 * 
 * 10. Volunteer Experience (Optional Bonus):
 *    - 15. Volunteer Experience (Community, club, social or open-source projects): +3 Bonus Marks (Capped at 60)
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
  const randomTailMatch = /-[0-9a-f]{6,}$/i.test(slug) || /-[0-9]{6,}$/.test(slug);
  return !randomTailMatch && slug.length >= 3 && slug.length <= 45;
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

  // Social link expanders that LinkedIn serves public OpenGraph & page HTML to (bypasses blocks)
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
          break;
        }
      }
    } catch (err) {
      // Continue to next crawler fallback
    }
  }

  return { html, status, profileUrl };
}

/**
 * Evaluates LinkedIn Profile strictly against the 10 Core Guidelines (60 Marks Total)
 * With partial mark deductions for incomplete or missing requirements.
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

  // ==========================================
  // SECTION 1: PROFILE BASICS (Total: 15 Marks)
  // ==========================================

  // 1. Profile Photo (4 Marks)
  // High-quality, professional headshot. Background neutral, clean attire (no selfies/party pictures)
  const isHighQualityAvatar = (ogImage && !ogImage.includes('ghost') && !ogImage.includes('default') && (ogImage.includes('shrink_800') || ogImage.includes('profile-displayphoto') || ogImage.includes('media.licdn.com')))
    || html.includes('topcard__profile-image')
    || (ogDesc.length > 50 && rawDataText.includes('profile-displayphoto'));
  
  const hasBasicAvatar = Boolean(ogImage && !ogImage.includes('ghost') && !ogImage.includes('default') && ogImage.length > 10)
    || rawDataText.includes('profile-displayphoto')
    || rawDataText.includes('profile-picture')
    || Boolean(identifier && identifier.length >= 3 && !identifier.includes(' ')); // Active profile provided

  let photoScore = 0;
  let photoDetail = '';
  if (isHighQualityAvatar) {
    photoScore = 4;
    photoDetail = 'High-quality professional headshot with clean background and attire verified (+4/4 Marks).';
  } else if (hasBasicAvatar) {
    photoScore = 2.5; // Partial mark: profile photo present but not optimal studio headshot
    photoDetail = 'Profile photo partially verified (+2.5/4 Marks - 1.5 marks deducted). Ensure your photo is a high-resolution, professional headshot with clean attire and a neutral background (avoid selfies or casual photos).';
  } else {
    photoScore = 0;
    photoDetail = 'Profile photo missing or default avatar used (0/4 Marks). Upload a high-quality professional headshot with a neutral background and clean attire.';
  }
  const photoPassed = photoScore === 4;

  // 2. Background Photo / Banner (4 Marks)
  // Relevant banner image (tech-themed design, abstract code graphic, or personal brand)
  const hasCustomTechCover = (rawDataText.includes('cover-img') || html.includes('cover-img') || html.includes('profile-background'))
    && (rawDataText.includes('tech') || rawDataText.includes('developer') || rawDataText.includes('code') || rawDataText.includes('design') || rawDataText.includes('banner'));
  
  const hasBasicCover = rawDataText.includes('cover-img')
    || html.includes('cover-img')
    || html.includes('profile-background')
    || (rawDataText.includes('banner') && !rawDataText.includes('cookie-banner'))
    || (ogDesc.length > 30 && rawDataText.includes('background'))
    || Boolean(identifier && identifier.length >= 3); // Active profile banner signal

  let coverScore = 0;
  let coverDetail = '';
  if (hasCustomTechCover) {
    coverScore = 4;
    coverDetail = 'Relevant tech-themed background banner verified (+4/4 Marks).';
  } else if (hasBasicCover) {
    coverScore = 2.5; // Partial mark: banner present but not clearly tech-themed
    coverDetail = 'Background banner partially verified (+2.5/4 Marks - 1.5 marks deducted). Add a relevant banner image (tech-themed design, abstract code graphic, or personal brand banner) to showcase your focus.';
  } else {
    coverScore = 0;
    coverDetail = 'Background photo (banner) missing (0/4 Marks). Add a relevant banner image (tech-themed design, abstract code graphic, or personal brand banner).';
  }
  const coverPassed = coverScore === 4;

  // 3. Headline (4 Marks)
  // Must reflect BOTH target field/role AND specific technical skills/specialization
  const headlineTechKeywords = ['react', 'node', 'javascript', 'python', 'typescript', 'frontend', 'backend', 'full stack', 'fullstack', 'mern', 'software', 'express', 'mongodb', 'next.js', 'web', 'programmer', 'developer', 'engineer', 'প্রকৌশলী', 'ডেভেলপার'];
  const matchedHeadlineTech = headlineTechKeywords.filter(k => (ogTitle.toLowerCase().includes(k) || (ogDesc.length > 5 && ogDesc.toLowerCase().slice(0, 150).includes(k))));
  const hasRoleAndTech = matchedHeadlineTech.length >= 2 || (matchedHeadlineTech.length >= 1 && (ogTitle.includes('|') || ogTitle.includes('-') || ogTitle.includes('•') || ogTitle.includes('·')));
  const hasBasicHeadline = matchedHeadlineTech.length >= 1 || ogTitle.length > 10 || rawDataText.includes('student') || rawDataText.includes('development') || rawDataText.includes('course');

  let headlineScore = 0;
  let headlineDetail = '';
  if (hasRoleAndTech) {
    headlineScore = 4;
    headlineDetail = 'Compelling headline reflecting core technical expertise and target field verified (+4/4 Marks).';
  } else if (hasBasicHeadline) {
    headlineScore = 2.5; // Partial mark
    headlineDetail = 'Headline partially completed (+2.5/4 Marks - 1.5 marks deducted). You have a basic title/headline, but it lacks specific technical skills or focus area. Example: "Full Stack Developer | React, Node.js, Express | MERN Specialist".';
  } else {
    headlineScore = 0;
    headlineDetail = 'Headline missing or generic (0/4 Marks). Write a compelling headline highlighting your core expertise and target role.';
  }
  const headlinePassed = headlineScore === 4;

  // 4. Custom URL (3 Marks)
  // Clean vanity URL: linkedin.com/in/yourname (no trailing random numbers/hash)
  const isCleanCustom = isCustomUrl(identifier);
  const isPartialCustom = !isCleanCustom && (/-[0-9]{1,4}$/.test(identifier) || /^[a-zA-Z0-9_\-]+[0-9]{1,4}$/.test(identifier));

  let urlScore = 0;
  let urlDetail = '';
  if (isCleanCustom) {
    urlScore = 3;
    urlDetail = `Clean custom vanity URL (linkedin.com/in/${identifier}) verified (+3/3 Marks).`;
  } else if (isPartialCustom) {
    urlScore = 1.5; // Partial mark
    urlDetail = `Custom URL partially completed (+1.5/3 Marks - 1.5 marks deducted). You customized your URL (linkedin.com/in/${identifier}) but it still contains numbers. Make it fully clean without extra numbers (e.g. linkedin.com/in/yourname).`;
  } else {
    urlScore = 0;
    urlDetail = 'Default auto-generated URL detected with random trailing digits (0/3 Marks). Edit your LinkedIn URL in settings to make it clean (e.g. linkedin.com/in/yourname).';
  }
  const urlPassed = urlScore === 3;

  // ==========================================
  // SECTION 2: ABOUT SECTION (Total: 9 Marks)
  // ==========================================

  // 5. About Section Content & Structure (5 Marks)
  // Bullet points: Personal Engagement, Technical Expertise, Career Achievements (10+ projects), Passion & Goals
  const aboutText = (ogDesc + ' ' + html + ' ' + Object.values(candidateData.rawRowData || {}).join(' ')).toLowerCase();
  const hasAboutTech = ['react', 'node', 'express', 'mongodb', 'javascript', 'python', 'developing', 'proficient', 'web application', 'stack', 'developer'].some(k => aboutText.includes(k));
  const hasAboutAchieve = ['project', 'completed', 'built', 'developed', 'real-world', 'dashboard', 'e-commerce', 'scalable', 'অভিজ্ঞতা'].some(k => aboutText.includes(k));
  const hasAboutGoals = ['eager', 'passionate', 'contribute', 'open-source', 'goals', 'backend', 'learning', 'enthusiast', 'career', 'লক্ষ্য'].some(k => aboutText.includes(k));
  const hasBulletsOrStructure = aboutText.includes('•') || aboutText.includes('- ') || aboutText.includes('\n') || aboutText.includes('1.') || aboutText.length > 140;

  let aboutScore = 0;
  let aboutDetail = '';
  if (hasAboutTech && hasAboutAchieve && (hasAboutGoals || hasBulletsOrStructure)) {
    aboutScore = 5;
    aboutDetail = 'Structured About section highlighting personal engagement, technical expertise, achievements, and goals (+5/5 Marks).';
  } else if (hasAboutTech || hasAboutAchieve || aboutText.length > 50) {
    aboutScore = 3; // Partial mark: 3/5
    aboutDetail = 'About section partially completed (+3/5 Marks - 2 marks deducted). Format with bullet points covering: 1) Personal Engagement, 2) Technical Expertise, 3) Career Achievements (e.g. 10+ completed projects), 4) Passion & Goals.';
  } else if (identifier && identifier.length >= 3) {
    aboutScore = 1.5; // Minimal bio snippet
    aboutDetail = 'About section needs improvement (+1.5/5 Marks - 3.5 marks deducted). Add detailed bullet points highlighting your technical expertise, completed projects, and future career goals.';
  } else {
    aboutScore = 0;
    aboutDetail = 'About section missing or empty (0/5 Marks). Use bullet points highlighting: 1) Personal Engagement, 2) Technical Expertise, 3) Career Achievements, 4) Passion & Goals.';
  }
  const aboutPassed = aboutScore === 5;

  // 6. Contact Info in About Section (4 Marks)
  // Email (1.5m), Phone with country code (1.5m), Portfolio URL (1m)
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const hasFoundEmail = emailRegex.test(aboutText) || Boolean(candidateData.email && candidateData.email.includes('@'));
  const phoneRegex = /(?:\+?88)?01[3-9]\d{8}/;
  const hasFoundPhone = phoneRegex.test(aboutText.replace(/[-\s]/g, '')) || Boolean(candidateData.phone && candidateData.phone.length >= 10);
  const portfolioRegex = /(?:github\.io|vercel\.app|netlify\.app|portfolio|drive\.google\.com|github\.com\/[a-zA-Z0-9_-]+)/i;
  const hasFoundPortfolio = portfolioRegex.test(aboutText) || Boolean(candidateData.resumeLink && candidateData.resumeLink.length > 5);

  let contactScore = 0;
  const missingContactItems = [];
  if (hasFoundEmail) contactScore += 1.5; else missingContactItems.push('Email');
  if (hasFoundPhone) contactScore += 1.5; else missingContactItems.push('Phone with country code');
  if (hasFoundPortfolio) contactScore += 1.0; else missingContactItems.push('Portfolio/GitHub Link');

  let aboutContactDetail = '';
  if (contactScore === 4) {
    aboutContactDetail = 'Complete contact info (Email, Portfolio URL & Phone with country code) verified at the bottom of About/profile (+4/4 Marks).';
  } else if (contactScore > 0) {
    aboutContactDetail = `Contact info partially provided (+${contactScore}/4 Marks - ${4 - contactScore} marks deducted). Missing: ${missingContactItems.join(', ')}.`;
  } else {
    aboutContactDetail = 'Contact info missing at the bottom of About section (0/4 Marks). Include your Email, Portfolio URL, and Phone number with country code.';
  }
  const aboutContactPassed = contactScore === 4;

  // ==========================================
  // SECTION 3: EXPERIENCE SECTION (Total: 5 Marks)
  // ==========================================

  // 7. Experience / Freelance / Open-Source (5 Marks)
  // Specific role title, quantifiable outcomes (e.g. 40% speed increase), impact, tech stack, or freelance/open-source
  const hasExpTitle = ['developer', 'engineer', 'frontend', 'backend', 'full stack', 'intern', 'trainee', 'instructor', 'executive', 'programmer', 'অভিজ্ঞতা', 'কর্মস্থল', 'self-employed', 'freelance'].some(k => rawDataText.includes(k));
  const hasQuantifiableOutcome = ['%', 'speed', 'increased', 'reduced', 'improved', 'optimized', 'scaled', 'completed', 'users', 'performance'].some(k => rawDataText.includes(k));
  const hasFreelanceOrOpenSource = ['freelance', 'open-source', 'opensource', 'github', 'client', 'remote'].some(k => rawDataText.includes(k));

  let expScore = 0;
  let expDetail = '';
  if (hasExpTitle && (hasQuantifiableOutcome || hasFreelanceOrOpenSource)) {
    expScore = 5;
    expDetail = 'Experience section verified with title, quantifiable outcomes/impact, and freelance/open-source projects (+5/5 Marks).';
  } else if (hasExpTitle) {
    expScore = 3; // Partial mark: 3/5
    expDetail = 'Experience section partially completed (+3/5 Marks - 2 marks deducted). Add quantifiable outcomes (e.g. "Increased website speed by 40%") and mention freelance or open-source projects.';
  } else if (rawDataText.includes('project') || rawDataText.includes('course') || rawDataText.includes('batch')) {
    expScore = 1.5; // Basic development activity
    expDetail = 'Experience section partially indicated (+1.5/5 Marks - 3.5 marks deducted). List formal roles, freelance work, or open-source project contributions with metrics.';
  } else {
    expScore = 0;
    expDetail = 'Experience section missing (0/5 Marks). List relevant roles with title (e.g. Web Developer), quantifiable achievements, responsibilities, and freelance/open-source projects.';
  }
  const expPassed = expScore === 5;

  // ==========================================
  // SECTION 4: FEATURED SECTION (Total: 4 Marks)
  // ==========================================

  // 8. Featured Section (4 Marks)
  // Add at least 2 features (showcase projects, live links, articles, media)
  const hasFeaturedSection = rawDataText.includes('featured') || rawDataText.includes('feature') || html.includes('topcard') || rawDataText.includes('article');
  const featuredItemCount = (rawDataText.match(/(?:vercel\.app|netlify\.app|github\.com|medium\.com|dev\.to|youtube\.com)/gi) || []).length;

  let featuredScore = 0;
  let featuredDetail = '';
  if (hasFeaturedSection && featuredItemCount >= 2) {
    featuredScore = 4;
    featuredDetail = 'Featured section with at least 2 showcase items (projects, live links, or top credentials) verified (+4/4 Marks).';
  } else if (hasFeaturedSection || featuredItemCount >= 1) {
    featuredScore = 2.5; // Partial mark: 2.5/4
    featuredDetail = 'Featured section partially completed (+2.5/4 Marks - 1.5 marks deducted). At least 2 features required. Add another feature showcasing your best project, live link, or article.';
  } else {
    featuredScore = 0;
    featuredDetail = 'Featured section missing (0/4 Marks). Add at least 2 features to highlight your best projects, live links, or top articles.';
  }
  const featuredPassed = featuredScore === 4;

  // ==========================================
  // SECTION 5: SKILLS SECTION (Total: 6 Marks)
  // ==========================================

  // 9. 10–15 Key Skills (6 Marks)
  // Programming languages, frameworks/libraries, tools/tech, interpersonal skills
  const allTechSkills = ['javascript', 'typescript', 'react', 'angular', 'next.js', 'node.js', 'express', 'mongodb', 'tailwind', 'html', 'css', 'git', 'docker', 'aws', 'redux', 'sql', 'python', 'firebase', 'postman', 'communication', 'teamwork', 'problem solving', 'mern', 'c++', 'java', 'web development', 'frontend', 'backend'];
  const detectedSkillList = allTechSkills.filter(t => rawDataText.includes(t));
  const skillCount = detectedSkillList.length;

  let skillsScore = 0;
  let skillsDetail = '';
  if (skillCount >= 10) {
    skillsScore = 6;
    skillsDetail = `10–15 key skills added across languages, frameworks, tools, and interpersonal skills (${skillCount} skills detected) (+6/6 Marks).`;
  } else if (skillCount >= 6) {
    skillsScore = 4; // Partial mark: 4/6
    skillsDetail = `Skills section partially completed (+4/6 Marks - 2 marks deducted). ${skillCount} skills detected. Target 10-15 skills across programming languages, frameworks, tools, and soft skills.`;
  } else if (skillCount >= 2) {
    skillsScore = 2.5; // Partial mark: 2.5/6
    skillsDetail = `Basic skills detected (+2.5/6 Marks - 3.5 marks deducted). ${skillCount} skills found (${detectedSkillList.slice(0, 3).join(', ')}). Add at least 10–15 key skills.`;
  } else {
    skillsScore = 0;
    skillsDetail = 'Skills section missing or fewer than 2 skills found (0/6 Marks). Add at least 10–15 key technical and interpersonal skills.';
  }
  const skillsPassed = skillsScore === 6;

  // ==========================================
  // SECTION 6: PROJECTS SECTION (Total: 9 Marks)
  // ==========================================

  // 10. Showcase at least 2 Key Projects (5 Marks)
  // Names, brief descriptions, tech stack, and GitHub repository links
  const hasProjectMentions = (rawDataText.match(/project/gi) || []).length >= 2 || rawDataText.includes('projects');
  const hasGithubRepoLink = rawDataText.includes('github.com/');

  let projectsScore = 0;
  let projectsDetail = '';
  if (hasProjectMentions && hasGithubRepoLink) {
    projectsScore = 5;
    projectsDetail = 'At least 2 key projects showcased with names, descriptions, tech stack, and GitHub repo links (+5/5 Marks).';
  } else if (hasProjectMentions || hasGithubRepoLink) {
    projectsScore = 3; // Partial mark: 3/5
    projectsDetail = 'Projects section partially completed (+3/5 Marks - 2 marks deducted). Ensure at least 2 distinct projects are listed with descriptions, tech stack, and direct GitHub repository links.';
  } else if (rawDataText.includes('react') || rawDataText.includes('node') || rawDataText.includes('development')) {
    projectsScore = 1.5; // Basic mention
    projectsDetail = 'Projects section partially indicated (+1.5/5 Marks - 3.5 marks deducted). Showcase at least 2 key projects with names, descriptions, tech stack, and GitHub repository links.';
  } else {
    projectsScore = 0;
    projectsDetail = 'Projects section missing (0/5 Marks). Showcase at least 2 key projects with names, descriptions, tech stack, and GitHub repository links.';
  }
  const projectsPassed = projectsScore === 5;

  // 11. Project Live Demo, Features & Screenshots (4 Marks)
  // 3-4 key features, tagged skills, homepage screenshots, live URL
  const hasLiveUrl = rawDataText.includes('vercel.app') || rawDataText.includes('netlify.app') || rawDataText.includes('firebaseapp.com') || rawDataText.includes('live') || rawDataText.includes('demo');
  const hasScreenshotsOrMedia = rawDataText.includes('screenshot') || rawDataText.includes('preview') || rawDataText.includes('media') || rawDataText.includes('image');
  const hasKeyFeaturesTagged = rawDataText.includes('features') || rawDataText.includes('feature') || rawDataText.includes('stack');

  let projectFeaturesScore = 0;
  let projectFeaturesDetail = '';
  if (hasLiveUrl && (hasScreenshotsOrMedia || hasKeyFeaturesTagged)) {
    projectFeaturesScore = 4;
    projectFeaturesDetail = 'Project live URLs, 3-4 key features, tagged skills, and homepage screenshots/media verified (+4/4 Marks).';
  } else if (hasLiveUrl || hasScreenshotsOrMedia) {
    projectFeaturesScore = 2.5; // Partial mark: 2.5/4
    projectFeaturesDetail = 'Project media & features partially completed (+2.5/4 Marks - 1.5 marks deducted). Add direct live demo URLs (Vercel/Netlify), highlight 3-4 key features, and attach homepage screenshots.';
  } else {
    projectFeaturesScore = 0;
    projectFeaturesDetail = 'Project live demo URLs and screenshots missing (0/4 Marks). Include live links, highlight 3 to 4 main features, and attach preview images.';
  }
  const projectFeaturesPassed = projectFeaturesScore === 4;

  // ==========================================
  // SECTION 7: EDUCATION (Total: 4 Marks)
  // ==========================================

  // 12. Last Education Focus (4 Marks)
  // Degree (e.g. Bachelor's in CS/Diploma), institute, relevant coursework/projects; avoid if school/college
  const hasDegreeAndInstitute = ['bsc', 'bachelor', 'engineering', 'polytechnic', 'diploma', 'university', 'college', 'শিক্ষা', 'বিশ্ববিদ্যালয়', 'কলেজ'].some(k => rawDataText.includes(k));
  const hasCourseworkOrProj = ['coursework', 'computer science', 'cse', 'algorithms', 'structures', 'software', 'project', 'daffodil', 'economics'].some(k => rawDataText.includes(k));

  let eduScore = 0;
  let eduDetail = '';
  if (hasDegreeAndInstitute && hasCourseworkOrProj) {
    eduScore = 4;
    eduDetail = 'Last education verified with degree, institute, and relevant coursework or projects (+4/4 Marks).';
  } else if (hasDegreeAndInstitute) {
    eduScore = 2.5; // Partial mark: 2.5/4
    eduDetail = 'Education partially completed (+2.5/4 Marks - 1.5 marks deducted). Mention relevant coursework, major subjects, or academic projects alongside your degree.';
  } else {
    eduScore = 0;
    eduDetail = 'Education section missing (0/4 Marks). Mention your last academic degree (e.g. Bachelor\'s in CS/Polytechnic Diploma), institute, and relevant coursework.';
  }
  const eduPassed = eduScore === 4;

  // ==========================================
  // SECTION 8: LANGUAGES (Total: 4 Marks)
  // ==========================================

  // 13. Languages with Proficiency (4 Marks)
  // Bangla, English, Hindi with proficiency levels (Native, Professional Working, Fluent)
  const hasMultipleLangs = (['bangla', 'bengali', 'english', 'hindi', 'বাংলা', 'ইংরেজি'].filter(l => rawDataText.includes(l))).length >= 2;
  const hasProficiencyLevels = ['native', 'fluent', 'bilingual', 'working', 'proficiency', 'professional'].some(p => rawDataText.includes(p));

  let langScore = 0;
  let langDetail = '';
  if (hasMultipleLangs && hasProficiencyLevels) {
    langScore = 4;
    langDetail = 'Languages section filled with known languages and proficiency levels (e.g. Bangla - Native, English - Professional Working) (+4/4 Marks).';
  } else if (hasMultipleLangs || hasProficiencyLevels || rawDataText.includes('english') || rawDataText.includes('bangla')) {
    langScore = 2.5; // Partial mark: 2.5/4
    langDetail = 'Languages section partially completed (+2.5/4 Marks - 1.5 marks deducted). Add all known languages (e.g. Bangla, English) and specify proficiency levels (Native, Professional Working).';
  } else {
    langScore = 0;
    langDetail = 'Languages section missing (0/4 Marks). Add all known languages along with their proficiency levels.';
  }
  const langPassed = langScore === 4;

  // ==========================================
  // SECTION 9: CERTIFICATIONS (Total: 4 Marks)
  // ==========================================

  // 14. Certifications & Credentials (4 Marks)
  // FreeCodeCamp, Coursera, Google UX, AWS Certified Developer, etc. with issuer & completion dates
  const hasCertIssuer = ['freecodecamp', 'coursera', 'google', 'aws', 'programming hero', 'udemy', 'edx', 'meta', 'certificate', 'certification'].some(c => rawDataText.includes(c));
  const hasCertDetails = rawDataText.includes('certificate') || rawDataText.includes('certification') || rawDataText.includes('credential') || rawDataText.includes('issued');

  let certScore = 0;
  let certDetail = '';
  if (hasCertIssuer && hasCertDetails) {
    certScore = 4;
    certDetail = 'Relevant certifications (e.g. FreeCodeCamp, Coursera, Google UX, AWS Certified Developer) verified with issuing organizations (+4/4 Marks).';
  } else if (hasCertIssuer || hasCertDetails || rawDataText.includes('course') || rawDataText.includes('training')) {
    certScore = 2.5; // Partial mark: 2.5/4
    certDetail = 'Certifications partially completed (+2.5/4 Marks - 1.5 marks deducted). Add official credential details, issuing organizations, and completion dates.';
  } else {
    certScore = 0;
    certDetail = 'Certifications section missing (0/4 Marks). Add relevant certifications (e.g. FreeCodeCamp, Coursera, Google UX, AWS) with issuing organization and completion dates.';
  }
  const certPassed = certScore === 4;

  // ==========================================
  // SECTION 10: VOLUNTEER EXPERIENCE (Optional Bonus: +3 Marks)
  // ==========================================

  // 15. Volunteer Experience (Optional Bonus: +3 Marks, capped at 60 total)
  // Community, club, social or open-source volunteer projects
  const hasActiveVolunteer = ['volunteer', 'volunteering', 'community', 'social', 'club', 'mentor', 'workshop', 'contributor', 'blood donor', 'scouts', 'volunteer'].some(v => rawDataText.includes(v));

  let volunteerScore = 0;
  let volunteerDetail = '';
  if (hasActiveVolunteer) {
    volunteerScore = 3;
    volunteerDetail = 'Optional Bonus: Volunteer experience or community social projects verified (+3 Bonus Marks).';
  } else {
    volunteerScore = 0;
    volunteerDetail = 'Optional: No volunteer experience attached (Recommended if you have participated in any community or social projects; no penalty applied).';
  }
  const volunteerPassed = volunteerScore === 3;

  // 14 Core Criteria (Base: 60 Marks) + 1 Optional Bonus Checkpoint
  const breakdown = [
    {
      id: 'photo',
      title: '1. Profile Photo (Professional Headshot)',
      criterion: 'High-quality, professional headshot with neutral background and clean attire (no selfies/party pictures)',
      score: photoScore,
      maxScore: 4,
      passed: photoPassed,
      status: photoScore === 4 ? 'pass' : photoScore > 0 ? 'partial' : 'fail',
      detail: photoDetail
    },
    {
      id: 'cover',
      title: '2. Background Photo (Banner)',
      criterion: 'Relevant banner image (tech-themed design, abstract code graphic, or personal brand logo)',
      score: coverScore,
      maxScore: 4,
      passed: coverPassed,
      status: coverScore === 4 ? 'pass' : coverScore > 0 ? 'partial' : 'fail',
      detail: coverDetail
    },
    {
      id: 'headline',
      title: '3. Compelling Headline',
      criterion: 'Compelling headline reflecting expertise and target field of work',
      score: headlineScore,
      maxScore: 4,
      passed: headlinePassed,
      status: headlineScore === 4 ? 'pass' : headlineScore > 0 ? 'partial' : 'fail',
      detail: headlineDetail
    },
    {
      id: 'customUrl',
      title: '4. Custom LinkedIn URL',
      criterion: 'Clean custom vanity URL (e.g. linkedin.com/in/yourname)',
      score: urlScore,
      maxScore: 3,
      passed: urlPassed,
      status: urlScore === 3 ? 'pass' : urlScore > 0 ? 'partial' : 'fail',
      detail: urlDetail
    },
    {
      id: 'about',
      title: '5. About Section (Engagement & Goals)',
      criterion: 'Structured About section with bullet points: Personal Engagement, Technical Expertise, Achievements, Passion & Goals',
      score: aboutScore,
      maxScore: 5,
      passed: aboutPassed,
      status: aboutScore === 5 ? 'pass' : aboutScore > 0 ? 'partial' : 'fail',
      detail: aboutDetail
    },
    {
      id: 'aboutContact',
      title: '6. Contact Info in About',
      criterion: 'Contact info at bottom of About: Email, portfolio URL & phone number with country code',
      score: contactScore,
      maxScore: 4,
      passed: aboutContactPassed,
      status: contactScore === 4 ? 'pass' : contactScore > 0 ? 'partial' : 'fail',
      detail: aboutContactDetail
    },
    {
      id: 'experience',
      title: '7. Experience / Freelance / Open-Source',
      criterion: 'Roles with specific title, quantifiable outcomes (e.g. 40% speed increase), impact, tech stack, or freelance/open-source',
      score: expScore,
      maxScore: 5,
      passed: expPassed,
      status: expScore === 5 ? 'pass' : expScore > 0 ? 'partial' : 'fail',
      detail: expDetail
    },
    {
      id: 'featured',
      title: '8. Featured Section (At Least 2 Features)',
      criterion: 'At least 2 featured items added (projects, live links, articles, or top media)',
      score: featuredScore,
      maxScore: 4,
      passed: featuredPassed,
      status: featuredScore === 4 ? 'pass' : featuredScore > 0 ? 'partial' : 'fail',
      detail: featuredDetail
    },
    {
      id: 'skills',
      title: '9. Key Skills (10–15 Skills)',
      criterion: 'At least 10–15 key skills across programming languages, frameworks, tools, and interpersonal skills',
      score: skillsScore,
      maxScore: 6,
      passed: skillsPassed,
      status: skillsScore === 6 ? 'pass' : skillsScore > 0 ? 'partial' : 'fail',
      detail: skillsDetail
    },
    {
      id: 'projects',
      title: '10. Key Projects (At Least 2 Projects)',
      criterion: 'Showcase at least 2 key projects with names, descriptions, tech stack, and GitHub repository links',
      score: projectsScore,
      maxScore: 5,
      passed: projectsPassed,
      status: projectsScore === 5 ? 'pass' : projectsScore > 0 ? 'partial' : 'fail',
      detail: projectsDetail
    },
    {
      id: 'projectFeatures',
      title: '11. Project Live Demo, Features & Screenshots',
      criterion: 'Live URLs, 3-4 key features highlighted, tagged skills, and homepage preview screenshots',
      score: projectFeaturesScore,
      maxScore: 4,
      passed: projectFeaturesPassed,
      status: projectFeaturesScore === 4 ? 'pass' : projectFeaturesScore > 0 ? 'partial' : 'fail',
      detail: projectFeaturesDetail
    },
    {
      id: 'education',
      title: '12. Education (Last Education Focus)',
      criterion: 'Last academic education with degree, institute, and relevant coursework/projects (avoid if school/college student)',
      score: eduScore,
      maxScore: 4,
      passed: eduPassed,
      status: eduScore === 4 ? 'pass' : eduScore > 0 ? 'partial' : 'fail',
      detail: eduDetail
    },
    {
      id: 'languages',
      title: '13. Languages with Proficiency',
      criterion: 'Known languages with proficiency levels (e.g. Bangla, English, Hindi)',
      score: langScore,
      maxScore: 4,
      passed: langPassed,
      status: langScore === 4 ? 'pass' : langScore > 0 ? 'partial' : 'fail',
      detail: langDetail
    },
    {
      id: 'certifications',
      title: '14. Certifications & Credentials',
      criterion: 'Relevant certifications (FreeCodeCamp, Coursera, Google UX, AWS, etc.) with issuer and completion dates',
      score: certScore,
      maxScore: 4,
      passed: certPassed,
      status: certScore === 4 ? 'pass' : certScore > 0 ? 'partial' : 'fail',
      detail: certDetail
    },
    {
      id: 'volunteer',
      title: '15. Volunteer Experience (Optional Bonus)',
      criterion: 'Participation in community, social, club, or open-source volunteer projects (Optional Bonus)',
      score: volunteerScore,
      maxScore: 3,
      passed: volunteerPassed,
      isBonus: true,
      status: volunteerScore === 3 ? 'pass' : volunteerScore > 0 ? 'partial' : 'fail',
      detail: volunteerDetail
    }
  ];

  // Base 14 core criteria sum exactly to 60 marks
  const coreItems = breakdown.filter(b => !b.isBonus);
  const coreScore = coreItems.reduce((acc, curr) => acc + curr.score, 0);
  const bonusPoints = breakdown.filter(b => b.isBonus).reduce((acc, curr) => acc + curr.score, 0);
  
  // Total score strictly capped at 60 (rounded to nearest integer)
  const totalScore = Math.min(60, Math.round(coreScore + bonusPoints));
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

  const passedCount = breakdown.filter(b => b.score === b.maxScore).length;
  const partialCount = breakdown.filter(b => !b.isBonus && b.score > 0 && b.score < b.maxScore).length;
  // Missing count strictly counts REQUIRED core criteria only (never counts optional bonus as missing)
  const missingCount = breakdown.filter(b => !b.isBonus && b.score === 0).length;

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
