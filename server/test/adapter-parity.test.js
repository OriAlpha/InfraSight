'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Requiring these does not open a connection — pg only builds a Pool on first
// getDb(), and better-sqlite3 only opens a file on first getDb().
const sqliteAdapter = require('../db/sqlite');
const postgresAdapter = require('../db/postgres');

/**
 * The two adapters are hand-mirrored, which is exactly how PostgreSQL mode came
 * to be unstartable: a helper existed on one side and not the other. This is a
 * structural guard that runs everywhere, with no database required.
 */
test('both adapters expose the same public surface', () => {
  const sqliteKeys = Object.keys(sqliteAdapter).sort();
  const postgresKeys = Object.keys(postgresAdapter).sort();

  const onlyInSqlite = sqliteKeys.filter((k) => !postgresKeys.includes(k));
  const onlyInPostgres = postgresKeys.filter((k) => !sqliteKeys.includes(k));

  assert.deepEqual(onlyInSqlite, [], `exported only by the SQLite adapter: ${onlyInSqlite.join(', ')}`);
  assert.deepEqual(onlyInPostgres, [], `exported only by the PostgreSQL adapter: ${onlyInPostgres.join(', ')}`);
});

test('every exported adapter member is callable', () => {
  for (const [name, value] of Object.entries(sqliteAdapter)) {
    assert.equal(typeof value, 'function', `sqlite.${name} should be a function`);
  }
  for (const [name, value] of Object.entries(postgresAdapter)) {
    assert.equal(typeof value, 'function', `postgres.${name} should be a function`);
  }
});

test('matching exports declare comparable arity', () => {
  // Guards against a signature drifting on one side only (e.g. an adapter
  // quietly dropping an options argument).
  const mismatches = [];

  for (const name of Object.keys(sqliteAdapter)) {
    const a = sqliteAdapter[name].length;
    const b = postgresAdapter[name].length;
    if (a !== b) mismatches.push(`${name}: sqlite takes ${a}, postgres takes ${b}`);
  }

  assert.deepEqual(mismatches, [], mismatches.join('; '));
});

// ---------------------------------------------------------------------------
// Behavioural checks — only run when a PostgreSQL instance is available.
// CI provides one; locally these skip.
// ---------------------------------------------------------------------------

const PG_URL = process.env.TEST_DATABASE_URL;

test('PostgreSQL adapter round-trips a request and reports analytics', { skip: !PG_URL && 'TEST_DATABASE_URL not set' }, async () => {
  process.env.DATABASE_URL = PG_URL;

  await postgresAdapter.runMigrations();

  const id = `parity-${Date.now()}`;
  const createdAt = new Date().toISOString();

  await postgresAdapter.insertRequest({
    id,
    model: 'parity-model',
    provider: 'test',
    input_messages: [{ role: 'user', content: 'hello' }],
    output_message: { role: 'assistant', content: 'hi' },
    prompt_tokens: 5,
    completion_tokens: 7,
    total_tokens: 12,
    estimated_cost: 0.0001,
    latency_ms: 42,
    status: 'success',
    created_at: createdAt,
  });

  const row = await postgresAdapter.getRequestById(id);
  assert.ok(row, 'inserted request should be readable');
  assert.equal(row.model, 'parity-model');
  assert.equal(Number(row.total_tokens), 12);

  const range = {
    startDate: new Date(Date.now() - 60_000).toISOString(),
    endDate: new Date(Date.now() + 60_000).toISOString(),
  };

  const latency = await postgresAdapter.getLatencyStats(range);
  assert.ok(Array.isArray(latency.data));
  for (const point of latency.data) {
    assert.equal(typeof point.p50, 'number', 'percentiles must be numbers, not pg strings');
    assert.equal(typeof point.avg, 'number');
  }

  const analytics = await postgresAdapter.getEvaluationAnalytics(range);
  for (const section of ['production', 'userFeedback', 'rag', 'nlp', 'hallucination', 'agent']) {
    assert.ok(analytics[section], `missing section: ${section}`);
  }
  assert.equal(typeof analytics.production.totalRequests, 'number');
  assert.ok(analytics.production.totalRequests >= 1);

  await postgresAdapter.deleteRequest(id);
  await postgresAdapter.closeDb();
});

test('PostgreSQL seeding is idempotent', { skip: !PG_URL && 'TEST_DATABASE_URL not set' }, async () => {
  process.env.DATABASE_URL = PG_URL;

  // Regression: seedModels() used to call the better-sqlite3 sync API on a
  // pg.Pool, so the server could never start against PostgreSQL.
  const { seedModels } = require('../db/seed-models');

  const first = await seedModels();
  const second = await seedModels();

  assert.equal(second.inserted, 0, 'a second seed must not re-insert models');
  assert.ok(first.inserted + first.skipped > 0);

  await postgresAdapter.closeDb();
});
