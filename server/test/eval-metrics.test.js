'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseJsonColumn, buildProductionSection, reduceEvaluationRows } = require('../db/eval-metrics');

test('parseJsonColumn tolerates strings, objects, null and malformed input', () => {
  assert.deepEqual(parseJsonColumn('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonColumn({ a: 1 }), { a: 1 });
  assert.equal(parseJsonColumn(null), null);
  assert.equal(parseJsonColumn(undefined), null);
  assert.equal(parseJsonColumn('not json'), null);
  // A bare JSON scalar is valid JSON but not a usable metrics object.
  assert.equal(parseJsonColumn('42'), null);
});

test('buildProductionSection derives rates from SQL totals', () => {
  const section = buildProductionSection(
    { totalRequests: 200, failedRequests: 10, totalLatency: 40000, totalCost: 1.23456789, totalTokens: 5000 },
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T01:00:00.000Z'
  );

  assert.equal(section.totalRequests, 200);
  assert.equal(section.failedRequests, 10);
  assert.equal(section.errorRate, 5);
  assert.equal(section.avgLatency, 200);
  assert.equal(section.totalCost, 1.234568);
  assert.equal(section.totalTokens, 5000);
  // 200 requests over one hour.
  assert.equal(section.throughput, 3.33);
});

test('buildProductionSection coerces pg string aggregates', () => {
  // pg returns COUNT/SUM as strings; the API contract is numbers.
  const section = buildProductionSection(
    { totalRequests: '50', failedRequests: '5', totalLatency: '5000', totalCost: '0.5', totalTokens: '100' },
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T01:00:00.000Z'
  );

  assert.equal(section.totalRequests, 50);
  assert.equal(section.errorRate, 10);
  assert.equal(section.avgLatency, 100);
  assert.equal(section.totalTokens, 100);
});

test('small cost totals are not rounded away to zero', () => {
  // Regression: rounding to 1e-4 reported $0 for a window totalling $0.000047,
  // while the overview endpoint reported the real figure.
  const section = buildProductionSection(
    { totalRequests: 8, failedRequests: 0, totalLatency: 800, totalCost: 0.000047, totalTokens: 776 },
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T01:00:00.000Z'
  );

  assert.equal(section.totalCost, 0.000047);
});

test('buildProductionSection returns zeros for an empty window', () => {
  const section = buildProductionSection(
    { totalRequests: 0, failedRequests: 0, totalLatency: 0, totalCost: 0, totalTokens: 0 },
    '2026-08-01T00:00:00.000Z',
    '2026-08-02T00:00:00.000Z'
  );

  assert.equal(section.errorRate, 0);
  assert.equal(section.throughput, 0);
  assert.equal(section.avgLatency, 0);
  assert.ok(!Number.isNaN(section.avgLatency));
});

test('reduceEvaluationRows averages feedback ratings and task success', () => {
  const result = reduceEvaluationRows([
    { feedback: JSON.stringify({ rating: 5, task_success: true }) },
    { feedback: JSON.stringify({ rating: 3, task_success: false }) },
    { feedback: JSON.stringify({ rating: 4, task_success: true }) },
  ]);

  assert.equal(result.userFeedback.avgRating, 4);
  assert.equal(result.userFeedback.ratingCount, 3);
  assert.equal(result.userFeedback.taskSuccessRate, 67);
});

test('reduceEvaluationRows counts each metric family independently', () => {
  const result = reduceEvaluationRows([
    { evaluation: JSON.stringify({ faithfulness: 4, answer_relevancy: 5 }) },
    { evaluation: JSON.stringify({ exact_match: 1, f1_score: 0.9 }) },
    { evaluation: JSON.stringify({ tool_success_rate: 0.5, iteration_count: 6 }) },
    { evaluation: JSON.stringify({ score: 4 }) }, // none of the families
  ]);

  assert.equal(result.rag.faithfulness, 4);
  assert.equal(result.rag.answerRelevancy, 5);
  assert.equal(result.nlp.exactMatch, 1);
  assert.equal(result.nlp.f1Score, 0.9);
  assert.equal(result.agent.toolSuccessRate, 0.5);
  assert.equal(result.agent.avgIterations, 6);
});

test('reduceEvaluationRows ignores unparseable JSON rather than throwing', () => {
  const result = reduceEvaluationRows([
    { feedback: '{broken', evaluation: '{also broken' },
    { feedback: JSON.stringify({ rating: 5 }) },
  ]);

  assert.equal(result.userFeedback.avgRating, 5);
  assert.equal(result.userFeedback.ratingCount, 1);
});

test('reduceEvaluationRows accepts any iterable, including a generator', () => {
  // The SQLite adapter streams rows rather than materialising them.
  function* rows() {
    yield { evaluation: JSON.stringify({ hallucination_rate: 0.2 }) };
    yield { evaluation: JSON.stringify({ hallucination_rate: 0.4 }) };
  }

  const result = reduceEvaluationRows(rows());
  assert.equal(result.hallucination.hallucinationRate, 0.3);
});

test('reduceEvaluationRows zeroes every section for no rows', () => {
  const result = reduceEvaluationRows([]);

  assert.equal(result.userFeedback.avgRating, 0);
  assert.equal(result.rag.faithfulness, 0);
  assert.equal(result.nlp.bleu, 0);
  assert.equal(result.hallucination.hallucinationRate, 0);
  assert.equal(result.agent.goalCompletionRate, 0);
});
