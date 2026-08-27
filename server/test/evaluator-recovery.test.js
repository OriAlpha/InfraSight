'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infrasight-recovery-')), 'test.db');
process.env.DB_PATH = DB_FILE;
delete process.env.DATABASE_URL;
// No upstream key: performEvaluation returns early, so recovery can be observed
// without making network calls.
delete process.env.UPSTREAM_API_KEY;
delete process.env.DEEPINFRA_API_KEY;

const db = require('../db');
const { recoverPendingEvaluations, drainEvaluations } = require('../services/evaluator');

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

let counter = 0;
function insert(row) {
  return db.insertRequest({
    id: `rec-${++counter}`,
    model: 'test-model',
    provider: 'test',
    input_messages: [{ role: 'user', content: 'hi' }],
    ...row,
  });
}

test.before(async () => {
  await db.runMigrations();
});

test.after(async () => {
  // Let any pump scheduled by the last push settle before the handle closes,
  // otherwise a late config read reopens the file we are about to delete.
  await drainEvaluations(2000);
  await new Promise((resolve) => setTimeout(resolve, 50));

  await db.closeDb();
  fs.rmSync(path.dirname(DB_FILE), { recursive: true, force: true });
});

test('pending lookup returns successful, unscored, recent requests', async () => {
  await insert({
    id: 'pending-1',
    status: 'success',
    output_message: { role: 'assistant', content: 'answer' },
    created_at: iso(60 * 1000),
  });

  const ids = await db.getPendingEvaluationIds({ since: iso(60 * 60 * 1000) });
  assert.ok(ids.includes('pending-1'));
});

test('pending lookup skips rows that should not be scored', async () => {
  // Already evaluated.
  await insert({ id: 'scored', status: 'success', output_message: { role: 'assistant', content: 'a' }, created_at: iso(60 * 1000) });
  await db.updateEvaluation('scored', { score: 4 });

  // Failed request.
  await insert({ id: 'failed', status: 'error', output_message: null, error_message: 'boom', created_at: iso(60 * 1000) });

  // Succeeded but produced no output.
  await insert({ id: 'no-output', status: 'success', output_message: null, created_at: iso(60 * 1000) });

  // Older than the lookback window.
  await insert({ id: 'ancient', status: 'success', output_message: { role: 'assistant', content: 'a' }, created_at: iso(48 * 60 * 60 * 1000) });

  const ids = await db.getPendingEvaluationIds({ since: iso(60 * 60 * 1000) });

  assert.ok(!ids.includes('scored'), 'already evaluated');
  assert.ok(!ids.includes('failed'), 'failed request');
  assert.ok(!ids.includes('no-output'), 'no output message');
  assert.ok(!ids.includes('ancient'), 'outside the lookback window');
});

test('pending lookup honours the limit', async () => {
  for (let i = 0; i < 5; i++) {
    await insert({ status: 'success', output_message: { role: 'assistant', content: 'a' }, created_at: iso(60 * 1000) });
  }

  const ids = await db.getPendingEvaluationIds({ since: iso(60 * 60 * 1000), limit: 3 });
  assert.equal(ids.length, 3);
});

test('recoverPendingEvaluations re-queues the backlog', async () => {
  const count = await recoverPendingEvaluations({ limit: 50, lookbackHours: 1 });

  assert.ok(count > 0, 'expected a backlog to recover');
  assert.equal(await drainEvaluations(2000), true, 'queue should drain');
});

test('recovery can be turned off with a zero limit', async () => {
  const count = await recoverPendingEvaluations({ limit: 0 });
  assert.equal(count, 0);
});
