'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the adapter at a throwaway database before it is first required.
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infrasight-analytics-')), 'test.db');
process.env.DB_PATH = DB_FILE;
delete process.env.DATABASE_URL;

const db = require('../db');

const DAY_1 = '2026-08-01';
const DAY_2 = '2026-08-02';
const RANGE = { startDate: '2026-07-31T00:00:00.000Z', endDate: '2026-08-03T00:00:00.000Z' };

/**
 * The percentile definition the previous in-memory implementation used.
 * The SQL rewrite must agree with it exactly.
 *
 * @param {number[]} sorted - Ascending latencies
 * @param {number} p - Percentile (0-100)
 * @returns {number}
 */
function referencePercentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

let id = 0;
function insert(row) {
  return db.insertRequest({
    id: `req-${++id}`,
    model: 'test-model',
    provider: 'test',
    input_messages: [{ role: 'user', content: 'hi' }],
    ...row,
  });
}

test.before(async () => {
  await db.runMigrations();

  // Day 1: latencies 1..100. Day 2: a small odd-sized set.
  for (let i = 1; i <= 100; i++) {
    await insert({ latency_ms: i, status: 'success', created_at: `${DAY_1}T10:00:00.000Z`, total_tokens: 10, estimated_cost: 0.001 });
  }
  for (const ms of [5, 10, 15, 20, 25, 30, 35]) {
    await insert({ latency_ms: ms, status: 'success', created_at: `${DAY_2}T10:00:00.000Z`, total_tokens: 20, estimated_cost: 0.002 });
  }

  // Errors are excluded from latency stats but still counted in the overview.
  await insert({ latency_ms: 9999, status: 'error', created_at: `${DAY_1}T11:00:00.000Z`, error_message: 'boom' });
});

test.after(async () => {
  await db.closeDb();
  fs.rmSync(path.dirname(DB_FILE), { recursive: true, force: true });
});

test('SQL latency percentiles match the previous in-memory computation', async () => {
  const { data } = await db.getLatencyStats(RANGE);
  const byDate = Object.fromEntries(data.map((r) => [r.date, r]));

  const day1 = Array.from({ length: 100 }, (_, i) => i + 1);
  const day2 = [5, 10, 15, 20, 25, 30, 35];

  for (const [date, latencies] of [[DAY_1, day1], [DAY_2, day2]]) {
    const row = byDate[date];
    assert.ok(row, `expected a row for ${date}`);

    assert.equal(row.p50, referencePercentile(latencies, 50), `${date} p50`);
    assert.equal(row.p95, referencePercentile(latencies, 95), `${date} p95`);
    assert.equal(row.p99, referencePercentile(latencies, 99), `${date} p99`);

    const expectedAvg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    assert.equal(row.avg, expectedAvg, `${date} avg`);
  }
});

test('latency stats exclude error rows', async () => {
  const { data } = await db.getLatencyStats(RANGE);
  const day1 = data.find((r) => r.date === DAY_1);

  // The 9999ms error row would dominate p99 if it leaked in.
  assert.equal(day1.p99, 99);
});

test('a single-row day reports that row for every percentile', async () => {
  const { data } = await db.getLatencyStats({
    startDate: `${DAY_2}T00:00:00.000Z`,
    endDate: `${DAY_2}T23:59:59.000Z`,
  });

  assert.equal(data.length, 1);
  assert.equal(data[0].p50, referencePercentile([5, 10, 15, 20, 25, 30, 35], 50));
});

test('evaluation analytics production totals come from the full window', async () => {
  const result = await db.getEvaluationAnalytics(RANGE);

  assert.equal(result.production.totalRequests, 108);
  assert.equal(result.production.failedRequests, 1);
  assert.equal(result.production.errorRate, Math.round((1 / 108) * 100 * 100) / 100);

  // 100 rows x 10 tokens + 7 rows x 20 tokens + 0 for the error row.
  assert.equal(result.production.totalTokens, 100 * 10 + 7 * 20);
});

test('evaluation analytics returns every metric section', async () => {
  const result = await db.getEvaluationAnalytics(RANGE);

  for (const section of ['production', 'userFeedback', 'rag', 'nlp', 'hallucination', 'agent']) {
    assert.ok(result[section], `missing section: ${section}`);
  }
});

test('feedback and evaluation JSON is aggregated from the scored rows only', async () => {
  await insert({
    id: 'scored-1',
    latency_ms: 10,
    status: 'success',
    created_at: `${DAY_1}T12:00:00.000Z`,
  });
  await db.updateFeedback('scored-1', { rating: 5, task_success: true });
  await db.updateEvaluation('scored-1', {
    score: 4.5,
    faithfulness: 4,
    answer_relevancy: 5,
    exact_match: 1,
    f1_score: 0.8,
    tool_success_rate: 1,
    iteration_count: 3,
  });

  const result = await db.getEvaluationAnalytics(RANGE);

  assert.equal(result.userFeedback.avgRating, 5);
  assert.equal(result.userFeedback.ratingCount, 1);
  assert.equal(result.userFeedback.taskSuccessRate, 100);
  assert.equal(result.rag.faithfulness, 4);
  assert.equal(result.rag.answerRelevancy, 5);
  assert.equal(result.nlp.exactMatch, 1);
  assert.equal(result.nlp.f1Score, 0.8);
  assert.equal(result.agent.avgIterations, 3);
});

test('an empty window returns zeroed sections rather than NaN', async () => {
  const result = await db.getEvaluationAnalytics({
    startDate: '2020-01-01T00:00:00.000Z',
    endDate: '2020-01-02T00:00:00.000Z',
  });

  assert.equal(result.production.totalRequests, 0);
  assert.equal(result.production.errorRate, 0);
  assert.equal(result.production.avgLatency, 0);
  assert.equal(result.userFeedback.avgRating, 0);
  assert.equal(result.rag.faithfulness, 0);
});

test('getRequests filters accurately by taskType', async () => {
  await insert({
    id: 'req-task-code',
    evaluation: { score: 4.5, task_type: 'code_generation' },
    created_at: `${DAY_1}T12:00:00.000Z`,
    status: 'success',
  });
  await insert({
    id: 'req-task-trans',
    evaluation: { score: 4.8, task_type: 'translation' },
    created_at: `${DAY_1}T12:01:00.000Z`,
    status: 'success',
  });

  const codeRes = await db.getRequests({ taskType: 'code_generation' });
  assert.ok(codeRes.data.some(r => r.id === 'req-task-code'));
  assert.ok(!codeRes.data.some(r => r.id === 'req-task-trans'));

  const transRes = await db.getRequests({ taskType: 'translation' });
  assert.ok(transRes.data.some(r => r.id === 'req-task-trans'));
  assert.ok(!transRes.data.some(r => r.id === 'req-task-code'));
});
