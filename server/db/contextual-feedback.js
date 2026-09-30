'use strict';

/**
 * Contextual feedback and evaluation helper.
 * Generates human feedback comments and AI evaluation reasoning tailored
 * specifically to the user prompt content and task type.
 *
 * @module db/contextual-feedback
 */

/**
 * Returns a human-written, contextually relevant feedback comment tailored to the prompt topic and rating.
 *
 * @param {string} promptText - User query or prompt text
 * @param {string} taskType - Task classification (e.g. question_answering, code_generation)
 * @param {number} rating - 1 to 5 star rating
 * @param {string} [groundTruth=''] - Expected reference answer
 * @returns {string}
 */
function getContextualFeedback(promptText, taskType, rating, groundTruth = '') {
  const p = (promptText || '').toLowerCase();

  if (rating >= 4) {
    if (rating === 5) {
      return 'Highly accurate answer matching expected output perfectly.';
    }
    return 'Good response, followed instructions with minor formatting or style adjustments needed.';
  }

  // --- Specific prompt keywords ---
  if (p.includes('markdown table') || p.includes('in a table') || p.includes('as a table')) {
    if (rating === 1) return 'Violated prompt constraints: refused to output markdown table as requested.';
    if (rating === 2) return 'Table formatting was broken with misaligned columns.';
  }

  if (p.includes('timescaledb') || p.includes('partitioned table') || p.includes('hypertables')) {
    if (rating === 1) return 'Incorrectly stated TimescaleDB does not support standard SQL queries or chunk hypertables.';
    if (rating === 2) return 'Missed explaining hypertable columnar compression benefits and automated retention policies.';
    return 'Accurate answer, but could elaborate on chunk sizing best practices.';
  }

  if (p.includes('sql and nosql') || p.includes('sql databases') || p.includes('relational')) {
    if (rating === 1) return 'Factually inaccurate; claimed SQL databases cannot support indexes and conflated document stores with relational tables.';
    if (rating === 2) return 'Overly high-level; omitted ACID transaction guarantees, schema rigidity, and horizontal scaling tradeoffs.';
    return 'Adequate summary, but could be more concise on horizontal sharding vs vertical scaling.';
  }

  if (p.includes('telemetry events') || p.includes('20,000') || p.includes('20000')) {
    if (rating === 1) return 'Recommended monolithic single-node SQL database which would suffer severe write locking at 20k events/sec.';
    if (rating === 2) return 'Did not explain write throughput bottlenecks or WAL contention for high-velocity ingest.';
    return 'Correct store choice, but missed explaining buffer pool configuration.';
  }

  if (p.includes('sentiment and urgency') || p.includes('production database is failing')) {
    if (rating === 1) return 'Classified critical production outage as low urgency and positive sentiment.';
    if (rating === 2) return 'Correct negative sentiment, but categorized urgency as medium instead of critical.';
    return 'Accurate classification, but could output JSON with confidence score.';
  }

  if (p.includes('charged twice') || (p.includes('invoice') && p.includes('intent'))) {
    if (rating === 1) return 'Misclassified billing dispute as feature request with invalid category schema.';
    if (rating === 2) return 'Correct billing category, but missing confidence rating and reasoning fields.';
    return 'Accurate intent detection, though reasoning could be more concise.';
  }

  if (p.includes('workspace settings') || p.includes('team workspace')) {
    if (rating === 1) return 'Provided misleading instructions to a non-existent menu section.';
    if (rating === 2) return 'Helpful directions, but lacked a direct link to the team management sub-tab.';
    return 'Friendly response, but could enumerate specific permissions.';
  }


  if (p.includes('binary search') && (p.includes('insertion index') || p.includes('insert index'))) {
    if (rating === 1) return 'Incorrect return value: returned -1 instead of the left pointer insertion index.';
    if (rating === 2) return 'Solution worked but omitted explanation of why the left pointer represents the sorted insertion point.';
    return 'Working code, but could mention potential integer overflow in (left + right) / 2.';
  }

  if (p.includes('binary search')) {
    if (rating === 1) return 'Code contains infinite loop bug: integer division not floored and pointers do not advance properly.';
    if (rating === 2) return 'Implementation missed empty array edge case and type validation.';
    return 'Clean code, but variable naming could be more descriptive.';
  }

  if (p.includes('time complexity') || p.includes('space complexity') || p.includes('complexity')) {
    if (rating === 1) return 'Stated time complexity as O(n) instead of O(log n).';
    if (rating === 2) return 'Missed auxiliary space complexity breakdown and best-case analysis.';
    return 'Correct Big-O, but lacked mathematical justification for logarithmic reduction.';
  }

  if (p.includes('france') || p.includes('capital of france') || p.includes('paris')) {
    if (rating === 1) return 'Factually wrong population statistics and cited outdated figures.';
    if (rating === 2) return 'Did not clearly separate municipal city population (~2.1M) from the greater metropolitan area (~12M).';
    return 'Accurate facts, but could be presented with fewer filler words.';
  }

  if (p.includes('quantum computing') || p.includes('10 year old')) {
    if (rating === 1) return 'Failed persona instructions: used advanced linear algebra and quantum mechanics jargon instead of simple language for a child.';
    if (rating === 2) return 'Superposition analogy was still too abstract and confusing for a young audience.';
    return 'Good simple explanation, though could use a more engaging real-world metaphor.';
  }

  if (p.includes('regex') || (p.includes('parse') && p.includes('log lines'))) {
    if (rating === 1) return 'Regex pattern failed to compile with invalid escape sequences and matched zero sample log lines.';
    if (rating === 2) return 'Pattern is too brittle; fails if request paths contain query parameters or spaces.';
    return 'Working regex script, but missing named capture groups for easier parsing.';
  }

  if (p.includes('most frequently requested') || p.includes('top 5')) {
    if (rating === 1) return 'Script crashed with KeyError when parsing paths and did not sort frequencies.';
    if (rating === 2) return 'Sub-optimal manual dictionary loop instead of using standard collections.Counter.most_common(5).';
    return 'Solution works, but lacks handling for empty log files.';
  }

  if (p.includes('coffee shop') || p.includes('beach')) {
    if (rating === 1) return 'Suggested generic corporate names with zero coastal or beach nautical themes.';
    if (rating === 2) return 'Names were cliché and lacked memorable brand differentiation.';
    return 'Decent name suggestions, but could offer more diverse stylistic options.';
  }

  if (p.includes('translate') || p.includes('french') || p.includes('votre commande')) {
    if (rating === 1) return 'Grammatically broken French with incorrect gender agreements and wrong future tense.';
    if (rating === 2) return 'Translation was overly literal and clunky; lacked natural native phrasing.';
    return 'Accurate translation, though slightly stiff for modern French customer support.';
  }

  if (p.includes('formal') || p.includes('polite') || p.includes('enterprise clients')) {
    if (rating === 1) return 'Used informal French ("tu" instead of "vous") and casual conversational slang.';
    if (rating === 2) return 'Sounded slightly stiff rather than polished enterprise business correspondence.';
    return 'Appropriate formal tone, though could be more concise.';
  }

  if (p.includes('504 gateway timeout') || p.includes('technical warning')) {
    if (rating === 1) return 'Failed to simplify; repeated raw socket error codes without explaining issue to end-users.';
    if (rating === 2) return 'Customer message was overly robotic and lacked clear instructions on retrying.';
    return 'Helpful paraphrase, though phrasing could be slightly warmer.';
  }

  if (p.includes('delivery') || p.includes('fedex') || p.includes('tracking') || p.includes('shipment') || (p.includes('order #98721') && !p.includes('$142.50'))) {
    if (rating === 1) return 'Bot gave contradictory tracking updates and failed to identify current transit status.';
    if (rating === 2) return 'Failed to inform customer that package redirection must be done via FedEx Delivery Manager.';
    return 'Helpful tracking update, though lacked direct portal link.';
  }

  if (p.includes('extract') || p.includes('alice johnson') || p.includes('$142.50') || taskType === 'extraction') {
    if (rating === 1) return 'Failed to extract key fields; produced invalid JSON with unescaped characters.';
    if (rating === 2) return 'Total amount was extracted as string with dollar sign instead of clean numeric float.';
    return 'Valid JSON extraction, though keys did not match requested snake_case schema.';
  }

  if (p.includes('microservices') && p.includes('challenges')) {
    if (rating === 1) return 'Ignored distributed tracing complexity and network failure modes completely.';
    if (rating === 2) return 'Did not explain eventual consistency challenges versus traditional ACID transactions.';
    return 'Good overview of challenges, though could mention service mesh observability.';
  }

  if (p.includes('microservices')) {
    if (rating === 1) return 'Claimed microservices eliminate all network latency and simplify data management.';
    if (rating === 2) return 'Summary was excessively verbose and failed conciseness criteria.';
    return 'Covers main benefits, but could structure points into bullet items.';
  }

  // --- Fallbacks by taskType ---
  if (taskType === 'code_generation') {
    if (rating === 1) return 'Generated code failed runtime execution and lacked essential error checks.';
    if (rating === 2) return 'Sub-optimal implementation with poor time complexity and unhandled null pointer exceptions.';
  }
  if (taskType === 'translation') {
    if (rating === 1) return 'Inaccurate translation that altered the meaning of the source sentence.';
    if (rating === 2) return 'Translation was overly literal and did not sound natural in the target language.';
  }
  if (taskType === 'summarization') {
    if (rating === 1) return 'Summary missed all primary concepts and introduced hallucinated details.';
    if (rating === 2) return 'Response was unnecessarily verbose and failed the conciseness requirement.';
  }
  if (taskType === 'extraction') {
    if (rating === 1) return 'Output contained invalid JSON syntax with missing closing brackets and truncated payload.';
    if (rating === 2) return 'Extracted fields contained formatting inconsistencies requiring manual cleanup.';
  }
  if (taskType === 'question_answering') {
    if (rating === 1) return 'Factually inaccurate answer with contradictory statements and hallucinated claims.';
    if (rating === 2) return 'Answer was superficial and omitted key technical considerations.';
  }
  if (taskType === 'classification') {
    if (rating === 1) return 'Predicted completely wrong intent/sentiment category and omitted required JSON formatting.';
    if (rating === 2) return 'Category label was plausible but confidence was miscalibrated and reasoning lacked justification.';
  }
  if (taskType === 'creative_writing') {
    if (rating === 1) return 'Writing was robotic, cliché, and failed to adhere to the creative narrative prompt.';
    if (rating === 2) return 'Decent prose but lacked vivid descriptions and imaginative flair.';
  }
  if (taskType === 'paraphrase') {
    if (rating === 1) return 'Altered the original meaning significantly and introduced factually inaccurate phrases.';
    if (rating === 2) return 'Paraphrase was too similar to the original input text with minimal lexical variation.';
  }
  if (taskType === 'conversation') {
    if (rating === 1) return 'Response was disconnected from prior conversation context and tone was unnecessarily abrasive.';
    if (rating === 2) return 'Followed the dialogue turn but sounded repetitive and failed to advance the user goal.';
  }

  if (rating === 1) return 'Factually incorrect answer; stated contradictory data and wrong formulas.';
  if (rating === 2) return 'Response was suboptimal, lacked sufficient depth, and missed key details.';
  return 'Acceptable response, but could be significantly more concise and direct.';
}

/**
 * Returns contextual evaluator reasoning tailored to task type and score.
 */
function getContextualReasoning(taskType, rating, evalScore) {
  const formattedTask = (taskType || 'general').replace(/_/g, ' ');
  if (rating === 1) {
    return `AI Judge identified critical factual inaccuracies and schema validation errors in ${formattedTask}.`;
  }
  if (rating === 2) {
    return `AI Judge detected suboptimal adherence to instructions and incomplete coverage for ${formattedTask}.`;
  }
  if (rating === 3) {
    return `AI Judge assessed response for ${formattedTask} as acceptable with moderate room for conciseness and precision improvements.`;
  }
  if (evalScore >= 4.5) {
    return `AI Judge assessed response for ${formattedTask}. Instructions were followed rigorously with high factual precision and clarity.`;
  }
  return `AI Judge assessed response for ${formattedTask}. Output met criteria with solid accuracy and clear presentation.`;
}

module.exports = {
  getContextualFeedback,
  getContextualReasoning,
};
