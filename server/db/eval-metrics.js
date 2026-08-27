/**
 * Shared aggregation for the evaluation analytics endpoint.
 *
 * Both database adapters previously carried their own copy of this reduction.
 * Keeping one implementation here means the SQLite and PostgreSQL backends
 * cannot drift apart on what the dashboard reports, and lets the arithmetic be
 * unit-tested without a database.
 *
 * @module db/eval-metrics
 */
'use strict';

/**
 * Safely parses a JSON column that may be null, a string, or already an object.
 *
 * @param {*} value
 * @returns {Object|null}
 */
function parseJsonColumn(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Builds the `production` section from SQL-computed totals.
 *
 * These come from a single aggregate query rather than from counting rows in
 * memory, so the cost does not grow with the size of the window.
 *
 * @param {Object} totals
 * @param {number} totals.totalRequests
 * @param {number} totals.failedRequests
 * @param {number} totals.totalLatency - Summed latency_ms across the window
 * @param {number} totals.totalCost
 * @param {number} totals.totalTokens
 * @param {string} startDate - ISO string
 * @param {string} endDate - ISO string
 * @returns {Object} The production metrics section
 */
function buildProductionSection(totals, startDate, endDate) {
  const totalRequests = Number(totals.totalRequests) || 0;
  const failedRequests = Number(totals.failedRequests) || 0;
  const totalLatency = Number(totals.totalLatency) || 0;
  const totalCost = Number(totals.totalCost) || 0;
  const totalTokens = Number(totals.totalTokens) || 0;

  const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;

  let throughputMin = 0;
  if (totalRequests > 0) {
    const durationMs = Math.max(1000, new Date(endDate).getTime() - new Date(startDate).getTime());
    throughputMin = totalRequests / (durationMs / 60000);
  }

  const avgLatency = totalRequests > 0 ? totalLatency / totalRequests : 0;

  return {
    totalRequests,
    failedRequests,
    errorRate: Math.round(errorRate * 100) / 100,
    throughput: Math.round(throughputMin * 100) / 100,
    avgLatency: Math.round(avgLatency),
    // Costs are stored rounded to 1e-6; rounding the total to 1e-4 here
    // reported $0 for any window totalling under $0.00005.
    totalCost: Math.round(totalCost * 1e6) / 1e6,
    totalTokens,
  };
}

/**
 * Reduces the rows that actually carry feedback or evaluation JSON into the
 * dashboard's metric sections.
 *
 * Accepts any iterable, so an adapter can stream rows instead of materialising
 * the whole window.
 *
 * @param {Iterable<{ feedback?: *, evaluation?: * }>} rows
 * @returns {{ userFeedback: Object, rag: Object, nlp: Object, hallucination: Object, agent: Object }}
 */
function reduceEvaluationRows(rows) {
  let totalRatings = 0;
  let ratingCount = 0;
  let taskSuccessCount = 0;
  let feedbackCount = 0;

  let ragCount = 0;
  let sumFaithfulness = 0;
  let sumAnswerRelevancy = 0;
  let sumContextPrecision = 0;
  let sumContextRecall = 0;
  let sumContextRelevance = 0;
  let sumRecallAtK = 0;
  let sumPrecisionAtK = 0;
  let sumMRR = 0;

  let nlpCount = 0;
  let sumExactMatch = 0;
  let sumF1Score = 0;
  let sumRouge1 = 0;
  let sumRouge2 = 0;
  let sumRougeL = 0;
  let sumBleu = 0;

  let sumHallucinationRate = 0;
  let hallucinationCount = 0;

  let agentCount = 0;
  let sumToolSuccessRate = 0;
  let sumToolSelectionAccuracy = 0;
  let sumPlanningAccuracy = 0;
  let sumIterationCount = 0;
  let sumGoalCompletionRate = 0;

  for (const row of rows) {
    const f = parseJsonColumn(row.feedback);
    if (f) {
      feedbackCount++;
      if (f.rating != null) {
        totalRatings += Number(f.rating);
        ratingCount++;
      }
      if (f.task_success === true) {
        taskSuccessCount++;
      }
    }

    const ev = parseJsonColumn(row.evaluation);
    if (!ev) continue;

    const hasRAG = ev.faithfulness != null || ev.answer_relevancy != null
      || ev.context_precision != null || ev.context_recall != null || ev.recall_at_k != null;
    if (hasRAG) {
      ragCount++;
      if (ev.faithfulness != null) sumFaithfulness += Number(ev.faithfulness);
      if (ev.answer_relevancy != null) sumAnswerRelevancy += Number(ev.answer_relevancy);
      if (ev.context_precision != null) sumContextPrecision += Number(ev.context_precision);
      if (ev.context_recall != null) sumContextRecall += Number(ev.context_recall);
      if (ev.context_relevance != null) sumContextRelevance += Number(ev.context_relevance);
      if (ev.recall_at_k != null) sumRecallAtK += Number(ev.recall_at_k);
      if (ev.precision_at_k != null) sumPrecisionAtK += Number(ev.precision_at_k);
      if (ev.mrr != null) sumMRR += Number(ev.mrr);
    }

    const hasNLP = ev.exact_match != null || ev.f1_score != null || ev.bleu != null;
    if (hasNLP) {
      nlpCount++;
      if (ev.exact_match != null) sumExactMatch += Number(ev.exact_match);
      if (ev.f1_score != null) sumF1Score += Number(ev.f1_score);
      if (ev.rouge_1 != null) sumRouge1 += Number(ev.rouge_1);
      if (ev.rouge_2 != null) sumRouge2 += Number(ev.rouge_2);
      if (ev.rouge_l != null) sumRougeL += Number(ev.rouge_l);
      if (ev.bleu != null) sumBleu += Number(ev.bleu);
    }

    if (ev.hallucination_rate != null) {
      sumHallucinationRate += Number(ev.hallucination_rate);
      hallucinationCount++;
    }

    const hasAgent = ev.iteration_count != null || ev.tool_success_rate != null;
    if (hasAgent) {
      agentCount++;
      if (ev.tool_success_rate != null) sumToolSuccessRate += Number(ev.tool_success_rate);
      if (ev.tool_selection_accuracy != null) sumToolSelectionAccuracy += Number(ev.tool_selection_accuracy);
      if (ev.planning_accuracy != null) sumPlanningAccuracy += Number(ev.planning_accuracy);
      if (ev.iteration_count != null) sumIterationCount += Number(ev.iteration_count);
      if (ev.goal_completion_rate != null) sumGoalCompletionRate += Number(ev.goal_completion_rate);
    }
  }

  return {
    userFeedback: {
      avgRating: ratingCount > 0 ? Math.round((totalRatings / ratingCount) * 10) / 10 : 0.0,
      ratingCount,
      taskSuccessRate: feedbackCount > 0 ? Math.round((taskSuccessCount / feedbackCount) * 100) : 0,
      accuracy: nlpCount > 0 ? Math.round((sumExactMatch / nlpCount) * 100) : 0,
    },
    rag: {
      faithfulness: ragCount > 0 && sumFaithfulness ? Math.round((sumFaithfulness / ragCount) * 10) / 10 : 0.0,
      answerRelevancy: ragCount > 0 && sumAnswerRelevancy ? Math.round((sumAnswerRelevancy / ragCount) * 10) / 10 : 0.0,
      contextPrecision: ragCount > 0 && sumContextPrecision ? Math.round((sumContextPrecision / ragCount) * 10) / 10 : 0.0,
      contextRecall: ragCount > 0 && sumContextRecall ? Math.round((sumContextRecall / ragCount) * 10) / 10 : 0.0,
      contextRelevance: ragCount > 0 && sumContextRelevance ? Math.round((sumContextRelevance / ragCount) * 10) / 10 : 0.0,
      recallAtK: ragCount > 0 && sumRecallAtK ? Math.round((sumRecallAtK / ragCount) * 100) / 100 : 0.0,
      precisionAtK: ragCount > 0 && sumPrecisionAtK ? Math.round((sumPrecisionAtK / ragCount) * 100) / 100 : 0.0,
      mrr: ragCount > 0 && sumMRR ? Math.round((sumMRR / ragCount) * 100) / 100 : 0.0,
    },
    nlp: {
      exactMatch: nlpCount > 0 ? Math.round((sumExactMatch / nlpCount) * 100) / 100 : 0.0,
      f1Score: nlpCount > 0 ? Math.round((sumF1Score / nlpCount) * 100) / 100 : 0.0,
      rouge1: nlpCount > 0 ? Math.round((sumRouge1 / nlpCount) * 100) / 100 : 0.0,
      rouge2: nlpCount > 0 ? Math.round((sumRouge2 / nlpCount) * 100) / 100 : 0.0,
      rougeL: nlpCount > 0 ? Math.round((sumRougeL / nlpCount) * 100) / 100 : 0.0,
      bleu: nlpCount > 0 ? Math.round((sumBleu / nlpCount) * 100) / 100 : 0.0,
    },
    hallucination: {
      hallucinationRate: hallucinationCount > 0 ? Math.round((sumHallucinationRate / hallucinationCount) * 100) / 100 : 0.0,
      faithfulness: ragCount > 0 && sumFaithfulness ? Math.round((sumFaithfulness / ragCount) * 10) / 10 : 0.0,
    },
    agent: {
      toolSuccessRate: agentCount > 0 ? Math.round((sumToolSuccessRate / agentCount) * 100) / 100 : 0.0,
      toolSelectionAccuracy: agentCount > 0 ? Math.round((sumToolSelectionAccuracy / agentCount) * 100) / 100 : 0.0,
      planningAccuracy: agentCount > 0 ? Math.round((sumPlanningAccuracy / agentCount) * 100) / 100 : 0.0,
      avgIterations: agentCount > 0 ? Math.round((sumIterationCount / agentCount) * 10) / 10 : 0.0,
      goalCompletionRate: agentCount > 0 ? Math.round((sumGoalCompletionRate / agentCount) * 100) / 100 : 0.0,
    }
  };
}

module.exports = {
  parseJsonColumn,
  buildProductionSection,
  reduceEvaluationRows,
};
