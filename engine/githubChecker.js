const fetch = require('node-fetch');

/**
 * GitHub Profile & Pinned Repos Evaluator (0% AI Tokens - Deterministic)
 * Total Score: 60 Marks
 */

function extractGithubUsername(input) {
  if (!input) return null;
  const str = input.trim();
  // If string contains spaces and no github.com or @handle, it's not a valid username
  if (str.includes(' ') && !str.includes('github.com') && !str.includes('@')) {
    return null;
  }
  const match = str.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
  if (match) return match[1];
  
  const handleMatch = str.match(/@([a-zA-Z0-9_-]+)/);
  if (handleMatch) return handleMatch[1];

  const parts = str.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  const cleaned = last ? last.replace('@', '').trim() : '';
  return /^[a-zA-Z0-9_-]+$/.test(cleaned) ? cleaned : null;
}

async function fetchGithubData(username) {
  const headers = {
    'User-Agent': 'NexScanner-Github-Checker',
    'Accept': 'application/vnd.github.v3+json'
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  // 1. Fetch User Profile Data
  const userRes = await fetch(`https://api.github.com/users/${username}`, { headers });
  if (userRes.status === 403 || userRes.status === 429) {
    const remaining = userRes.headers.get('x-ratelimit-remaining');
    throw new Error(`GitHub API Rate Limit Exceeded (${remaining || 0} remaining). Please wait a few minutes or set GITHUB_TOKEN in backend/.env for 5,000 req/hr.`);
  }
  if (!userRes.ok) {
    throw new Error(`GitHub user '${username}' not found or profile inaccessible.`);
  }
  const userData = await userRes.json();

  // 2. Fetch User Profile README (raw from main or master branch)
  let profileReadme = '';
  try {
    const readmeRes = await fetch(`https://raw.githubusercontent.com/${username}/${username}/main/README.md`);
    if (readmeRes.ok) {
      profileReadme = await readmeRes.text();
    } else {
      const readmeResMaster = await fetch(`https://raw.githubusercontent.com/${username}/${username}/master/README.md`);
      if (readmeResMaster.ok) {
        profileReadme = await readmeResMaster.text();
      }
    }
  } catch (e) {
    profileReadme = '';
  }

  // 3. Fetch Public Repositories (up to 30)
  let repos = [];
  try {
    const reposRes = await fetch(`https://api.github.com/users/${username}/repos?sort=pushed&per_page=30`, { headers });
    if (reposRes.ok) {
      repos = await reposRes.json();
      // Exclude profile readme repo from project repo counts
      repos = repos.filter(r => r.name.toLowerCase() !== username.toLowerCase());
    }
  } catch (e) {
    repos = [];
  }

  // Sort repos so that repos with descriptions / live homepages / stars come FIRST
  const sortedRepos = [...repos].sort((a, b) => {
    const aDesc = a.description && a.description.trim().length > 3 ? 1 : 0;
    const bDesc = b.description && b.description.trim().length > 3 ? 1 : 0;
    const aHome = a.homepage && a.homepage.startsWith('http') ? 1 : 0;
    const bHome = b.homepage && b.homepage.startsWith('http') ? 1 : 0;
    const scoreA = (aDesc * 3) + (aHome * 2) + ((a.stargazers_count || 0) * 0.5);
    const scoreB = (bDesc * 3) + (bHome * 2) + ((b.stargazers_count || 0) * 0.5);
    return scoreB - scoreA;
  });

  // 4. Fetch README for top 3-4 repos
  const topRepos = sortedRepos.slice(0, 4);
  for (const repo of topRepos) {
    let repoReadme = '';
    try {
      const rRes = await fetch(`https://raw.githubusercontent.com/${username}/${repo.name}/main/README.md`);
      if (rRes.ok) {
        repoReadme = await rRes.text();
      } else {
        const rResMaster = await fetch(`https://raw.githubusercontent.com/${username}/${repo.name}/master/README.md`);
        if (rResMaster.ok) {
          repoReadme = await rResMaster.text();
        }
      }
    } catch (e) {}
    repo.readmeText = repoReadme;
  }

  return { userData, profileReadme, repos, topRepos };
}

async function evaluateGithubProfile(inputUrlOrUsername) {
  const username = extractGithubUsername(inputUrlOrUsername);
  if (!username) {
    throw new Error('Invalid GitHub URL or username provided.');
  }

  const { userData, profileReadme, repos, topRepos } = await fetchGithubData(username);

  const breakdown = [];

  // Criteria 1: Appropriate, professional profile image (6 Marks)
  const hasAvatar = userData.avatar_url && !userData.avatar_url.includes('identicon') && !userData.avatar_url.includes('gravatar');
  const avatarScore = hasAvatar ? 6 : 0;
  breakdown.push({
    title: 'Professional Profile Image',
    score: avatarScore,
    maxScore: 6,
    passed: hasAvatar,
    detail: hasAvatar ? 'Custom profile image is set.' : 'Missing or default GitHub avatar image.'
  });

  // Criteria 2: Current location listed (2 Marks)
  const hasLocation = Boolean(userData.location && userData.location.trim().length > 0);
  const locationScore = hasLocation ? 2 : 0;
  breakdown.push({
    title: 'Current Location Listed',
    score: locationScore,
    maxScore: 2,
    passed: hasLocation,
    detail: hasLocation ? `Location listed: "${userData.location}"` : 'No location specified on GitHub profile.'
  });

  // Criteria 3: Professional email address and contact number provided (2 Marks)
  const emailInProfile = userData.email || '';
  const emailInReadme = (profileReadme.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [])[0] || '';
  const phoneInReadme = (profileReadme.match(/(\+?\d{1,4}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/) || [])[0] || '';
  const hasContact = Boolean(emailInProfile || emailInReadme || phoneInReadme);
  const contactScore = hasContact ? 2 : 0;
  breakdown.push({
    title: 'Email & Contact Info Provided',
    score: contactScore,
    maxScore: 2,
    passed: hasContact,
    detail: hasContact ? `Contact info found: ${emailInProfile || emailInReadme || phoneInReadme}` : 'No public email or phone contact found in profile or README.'
  });

  // Criteria 4: Banner Image in Profile README (2 Marks)
  const hasBannerImage = /!\[.*?\]\(.*?\)|<img.*?src=.*?>/i.test(profileReadme) && (profileReadme.includes('header') || profileReadme.includes('banner') || profileReadme.includes('assets') || profileReadme.includes('svg') || profileReadme.includes('gif') || profileReadme.includes('png') || profileReadme.includes('jpg'));
  const bannerScore = hasBannerImage ? 2 : (profileReadme.length > 50 ? 1 : 0);
  breakdown.push({
    title: 'Profile README Banner Image',
    score: bannerScore,
    maxScore: 2,
    passed: bannerScore > 0,
    detail: bannerScore === 2 ? 'Header/Banner image or graphic badge found in profile README.' : bannerScore === 1 ? 'Profile README exists but no explicit banner image tag found.' : 'No profile README or banner image found.'
  });

  // Criteria 5: Name & Designation (4 Marks)
  const hasName = Boolean(userData.name && userData.name.trim().length > 0);
  const hasDesignation = /developer|engineer|stack|frontend|backend|fullstack|student|software|designer|architect|programmer|coder/i.test(userData.bio || '') || /developer|engineer|stack|frontend|backend|fullstack|student|software|designer|architect|programmer/i.test(profileReadme);
  let nameDesigScore = 0;
  if (hasName && hasDesignation) nameDesigScore = 4;
  else if (hasName || hasDesignation) nameDesigScore = 2;
  breakdown.push({
    title: 'Name & Professional Designation',
    score: nameDesigScore,
    maxScore: 4,
    passed: nameDesigScore === 4,
    detail: `Name: "${userData.name || 'Not Set'}", Designation detected: ${hasDesignation ? 'Yes' : 'No'}.`
  });

  // Criteria 6: About Me Section (4 Marks)
  const hasAboutMe = /about\s*me|bio|who\s*i\s*am|introduction|hi\s*there|hello/i.test(profileReadme) || (userData.bio && userData.bio.length > 15);
  const aboutScore = hasAboutMe ? 4 : 0;
  breakdown.push({
    title: 'About Me Section',
    score: aboutScore,
    maxScore: 4,
    passed: hasAboutMe,
    detail: hasAboutMe ? 'About Me section / Bio introduction provided.' : 'Missing About Me section in profile README.'
  });

  // Criteria 7: Current Activities (2 Marks)
  const hasActivities = /working\s*on|learning|exploring|building|currently|contributing|interested\s*in/i.test(profileReadme) || /working|learning|exploring|building/i.test(userData.bio || '');
  const activityScore = hasActivities ? 2 : 0;
  breakdown.push({
    title: 'Current Activities & Focus',
    score: activityScore,
    maxScore: 2,
    passed: hasActivities,
    detail: hasActivities ? 'Current learning / project activities mentioned.' : 'No current activities or exploration topics listed.'
  });

  // Criteria 8: Skills Section - with icons, categorized (8 Marks)
  const hasSkillIcons = /skillicons|shields\.io|devicon|svg|badge|img\.shields/i.test(profileReadme) || (profileReadme.includes('<img') && /react|js|ts|node|python|css|html|git|docker/i.test(profileReadme));
  const hasSkillHeader = /skills|tech\s*stack|tools|technologies|languages/i.test(profileReadme);
  let skillsScore = 0;
  if (hasSkillHeader && hasSkillIcons) skillsScore = 8;
  else if (hasSkillHeader || hasSkillIcons) skillsScore = 4;
  breakdown.push({
    title: 'Skills Section (Categorized with Icons)',
    score: skillsScore,
    maxScore: 8,
    passed: skillsScore === 8,
    detail: skillsScore === 8 ? 'Categorized skills section with visual icons/badges detected.' : skillsScore === 4 ? 'Skills header or text list found, but icon badges missing.' : 'No Skills section found in profile README.'
  });

  // Criteria 9: Social Links (4 Marks)
  const hasSocials = Boolean(userData.blog || userData.twitter_username) || /linkedin|twitter|facebook|medium|portfolio|dev\.to|youtube|instagram/i.test(profileReadme);
  const socialScore = hasSocials ? 4 : 0;
  breakdown.push({
    title: 'Social & Portfolio Links',
    score: socialScore,
    maxScore: 4,
    passed: hasSocials,
    detail: hasSocials ? 'Social media / Portfolio links provided.' : 'No social or portfolio links attached.'
  });

  // Criteria 10: GitHub Stats (2 Marks)
  const hasStats = /github-readme-stats|streak-stats|top-langs|github-readme-streak-stats|metrics|github_stats/i.test(profileReadme) || userData.public_repos > 5;
  const statsScore = hasStats ? 2 : 0;
  breakdown.push({
    title: 'GitHub Stats & Contributions',
    score: statsScore,
    maxScore: 2,
    passed: hasStats,
    detail: hasStats ? `GitHub stats widget or active contributions (${userData.public_repos} public repos).` : 'No GitHub stats widget or low public activity.'
  });

  // Criteria 11: Pinned Repositories (4 Marks)
  const repoCount = repos.length;
  let pinnedScore = 0;
  if (repoCount >= 2) pinnedScore = 4;
  else if (repoCount === 1) pinnedScore = 2;
  breakdown.push({
    title: 'Pinned / Featured Repositories (≥2)',
    score: pinnedScore,
    maxScore: 4,
    passed: pinnedScore === 4,
    detail: `${repoCount} public repositories available.`
  });

  // Criteria 12: Project Description in Repositories (8 Marks)
  const reposWithDesc = repos.filter(r => r.description && r.description.trim().length > 3).length;
  let descScore = reposWithDesc >= 1 ? 8 : 0;
  breakdown.push({
    title: 'Project Description in Repositories',
    score: descScore,
    maxScore: 8,
    passed: descScore === 8,
    detail: descScore === 8 ? `${reposWithDesc} repository has clear project description.` : 'No project description found in repositories.'
  });

  // Criteria 13: Live Project Link in Repositories (4 Marks)
  const reposWithLiveLink = repos.filter(r => Boolean(r.homepage && r.homepage.startsWith('http')) || (r.readmeText && /https?:\/\/[^\s"']+\.(vercel\.app|netlify\.app|github\.io|render\.com|heroku\.com|com|io|org)/i.test(r.readmeText))).length;
  let liveScore = 0;
  if (reposWithLiveLink >= 1) liveScore = 4;
  breakdown.push({
    title: 'Live Project Demo Links',
    score: liveScore,
    maxScore: 4,
    passed: liveScore === 4,
    detail: reposWithLiveLink >= 1 ? `${reposWithLiveLink} repository has working live project demo link.` : 'No live project demo URL found in repositories.'
  });

  // Criteria 14: Technologies Used (4 Marks)
  const reposWithTech = repos.filter(r => (r.language || (r.topics && r.topics.length > 0) || (r.readmeText && /react|node|javascript|typescript|python|html|css|express|mongodb|sql|next/i.test(r.readmeText)))).length;
  let techScore = reposWithTech >= 1 ? 4 : 0;
  breakdown.push({
    title: 'Technologies & Tech Stack Specified',
    score: techScore,
    maxScore: 4,
    passed: techScore === 4,
    detail: techScore === 4 ? `${reposWithTech} repository explicitly states tech stack and primary language.` : 'No tech stack specified in repositories.'
  });

  // Criteria 15: README File Quality (4 Marks)
  const reposWithGoodReadme = topRepos.filter(r => {
    const rm = r.readmeText || '';
    if (rm.length < 50) return false;
    const hasOverview = /overview|about|description|project|feature|usage|install|setup|run/i.test(rm);
    return hasOverview || rm.length > 150;
  }).length;
  let readmeQualityScore = reposWithGoodReadme >= 1 ? 4 : 0;
  breakdown.push({
    title: 'Repository README File Quality',
    score: readmeQualityScore,
    maxScore: 4,
    passed: readmeQualityScore === 4,
    detail: readmeQualityScore === 4 ? `${reposWithGoodReadme} repository has a structured README with setup guidelines or overview.` : 'Repository README files are short or missing.'
  });

  // Calculate Total Score out of 60
  const totalScore = breakdown.reduce((sum, item) => sum + item.score, 0);
  const percentage = Math.round((totalScore / 60) * 100);

  let grade = 'Needs Work';
  let gradeColor = 'rose';

  if (totalScore >= 50) {
    grade = 'Excellent Profile';
    gradeColor = 'emerald';
  } else if (totalScore >= 40) {
    grade = 'Strong Profile';
    gradeColor = 'cyan';
  } else if (totalScore >= 30) {
    grade = 'Moderate Profile';
    gradeColor = 'amber';
  } else {
    grade = 'Needs Improvement';
    gradeColor = 'rose';
  }

  return {
    username,
    name: userData.name || username,
    avatarUrl: userData.avatar_url || '',
    profileUrl: userData.html_url || `https://github.com/${username}`,
    bio: userData.bio || '',
    location: userData.location || '',
    publicRepos: userData.public_repos || 0,
    followers: userData.followers || 0,
    following: userData.following || 0,
    totalScore,
    maxScore: 60,
    percentage,
    grade,
    gradeColor,
    breakdown,
    topRepos: topRepos.map(r => ({
      name: r.name,
      url: r.html_url,
      description: r.description || 'No description',
      language: r.language || 'N/A',
      homepage: r.homepage || '',
      stars: r.stargazers_count || 0
    }))
  };
}

module.exports = {
  extractGithubUsername,
  evaluateGithubProfile
};
