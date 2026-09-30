'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  getDb,
  runMigrations,
  getRequests,
  getTraces,
  insertRequest,
  updateFeedback,
  getRequestById,
  closeDb,
} = require('../db');

test('feedback and model filtering test suite', async (t) => {
  // Ensure migrations and tables are initialized
  runMigrations();
  const db = getDb();

  await t.test('getRequests filters by feedback=negative correctly', () => {
    const res = getRequests({ feedback: 'negative', limit: 20 });
    assert.ok(res.total > 0, 'Should find negative feedback requests');
    assert.ok(res.data.length > 0, 'Should return data rows for negative feedback');

    for (const row of res.data) {
      assert.ok(row.feedback, 'Row must have feedback');
      const fb = typeof row.feedback === 'string' ? JSON.parse(row.feedback) : row.feedback;
      const isNegative =
        fb.score === -1 ||
        (fb.rating != null && fb.rating <= 2) ||
        (fb.task_success === false && fb.rating != null && fb.rating <= 3);
      assert.ok(
        isNegative,
        `Expected row ${row.id} to be negative, got score=${fb.score}, rating=${fb.rating}, task_success=${fb.task_success}`
      );
    }
  });

  await t.test('getRequests filters by feedback=positive correctly', () => {
    const res = getRequests({ feedback: 'positive', limit: 20 });
    assert.ok(res.total > 0, 'Should find positive feedback requests');
    assert.ok(res.data.length > 0, 'Should return data rows for positive feedback');

    for (const row of res.data) {
      assert.ok(row.feedback, 'Row must have feedback');
      const fb = typeof row.feedback === 'string' ? JSON.parse(row.feedback) : row.feedback;
      const isPositive = fb.score === 1 || (fb.rating != null && fb.rating >= 4);
      assert.ok(
        isPositive,
        `Expected row ${row.id} to be positive, got score=${fb.score}, rating=${fb.rating}`
      );
    }
  });

  await t.test('getRequests matches models by full ID and short slug name', () => {
    const fullRes = getRequests({ model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', limit: 5 });
    const shortRes = getRequests({ model: 'Meta-Llama-3.1-8B-Instruct', limit: 5 });

    assert.ok(fullRes.total > 0, 'Should find requests for full model ID');
    assert.equal(
      shortRes.total,
      fullRes.total,
      `Short slug count (${shortRes.total}) must match full ID count (${fullRes.total})`
    );

    // Test DeepSeek
    const dsFull = getRequests({ model: 'deepseek-ai/DeepSeek-V3', limit: 5 });
    const dsShort = getRequests({ model: 'DeepSeek-V3', limit: 5 });
    assert.ok(dsFull.total > 0, 'Should find requests for deepseek-ai/DeepSeek-V3');
    assert.equal(
      dsShort.total,
      dsFull.total,
      `DeepSeek short count (${dsShort.total}) must match full count (${dsFull.total})`
    );

    // Test Qwen
    const qFull = getRequests({ model: 'Qwen/Qwen2.5-72B-Instruct', limit: 5 });
    const qShort = getRequests({ model: 'Qwen2.5-72B-Instruct', limit: 5 });
    assert.ok(qFull.total > 0, 'Should find requests for Qwen');
    assert.equal(
      qShort.total,
      qFull.total,
      `Qwen short count (${qShort.total}) must match full count (${qFull.total})`
    );
  });

  await t.test('getTraces filters by full model ID and short slug name', async () => {
    const fullTraces = await getTraces({ model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', limit: 10 });
    const shortTraces = await getTraces({ model: 'Meta-Llama-3.1-8B-Instruct', limit: 10 });

    assert.equal(
      shortTraces.total,
      fullTraces.total,
      `getTraces count for short slug (${shortTraces.total}) must match full ID (${fullTraces.total})`
    );
  });

  await t.test('updateFeedback preserves ratings, scores and comments correctly', async () => {
    const testId = 'test-fb-' + Date.now();
    await insertRequest({
      id: testId,
      model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      input_messages: [{ role: 'user', content: 'Testing feedback update' }],
      output_message: { role: 'assistant', content: 'Test response' },
      status: 'success',
      latency_ms: 100,
    });

    // Update with negative feedback
    await updateFeedback(testId, {
      score: -1,
      rating: 1,
      comment: 'Hallucinated nonexistent parameters',
      task_success: false,
    });

    const updated = await getRequestById(testId);
    assert.ok(updated, 'Updated row should exist');
    const fb = typeof updated.feedback === 'string' ? JSON.parse(updated.feedback) : updated.feedback;
    assert.equal(fb.score, -1);
    assert.equal(fb.rating, 1);
    assert.equal(fb.task_success, false);
    assert.equal(fb.comment, 'Hallucinated nonexistent parameters');

    // Query with feedback=negative should find this row
    const negQuery = getRequests({ feedback: 'negative', search: 'Testing feedback update' });
    assert.ok(negQuery.total >= 1, 'Should find test row in negative feedback query');

    // Clean up test row
    db.prepare('DELETE FROM requests WHERE id = ?').run(testId);
  });
});
