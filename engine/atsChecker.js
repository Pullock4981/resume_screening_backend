const { evaluateAtsRubric } = require('./atsRubricEvaluator.js');

async function evaluateATS(resumeText, jobDescription = '') {
  const rubricReport = evaluateAtsRubric(resumeText, jobDescription);
  return {
    success: true,
    ats_score: rubricReport.ats_score,
    parsing_status: rubricReport.parsing_status,
    score: rubricReport.ats_score,
    category_scores: rubricReport.category_scores,
    contact: rubricReport.contact,
    unnecessary_personal_info: rubricReport.unnecessary_personal_info,
    sections: rubricReport.sections,
    reading_order_issues: rubricReport.reading_order_issues,
    section_content_relationships: rubricReport.section_content_relationships,
    summary_analysis: rubricReport.summary_analysis,
    bullet_analysis: rubricReport.bullet_analysis,
    skills_analysis: rubricReport.skills_analysis,
    job_match: rubricReport.job_match,
    formatting_risks: rubricReport.formatting_risks,
    recommendations: rubricReport.recommendations
  };
}

module.exports = { evaluateATS, checkAtsScore: evaluateATS };