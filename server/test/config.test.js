'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infrasight-config-test-')), 'test.db');
process.env.DB_PATH = DB_FILE;
delete process.env.DATABASE_URL;

const db = require('../db');
const { getConfig, setConfig, clearCache } = require('../utils/config');

test.before(async () => {
  await db.runMigrations();
});

test.after(async () => {
  await db.closeDb();
  fs.rmSync(path.dirname(DB_FILE), { recursive: true, force: true });
});

test('config: retrieves value from DB and caches it', async () => {
  clearCache();
  await db.setSetting('TEST_KEY_DB', 'val-from-db');

  const val1 = await getConfig('TEST_KEY_DB');
  assert.equal(val1, 'val-from-db');

  // Change DB directly without clearing cache — cache should still return val1
  await db.setSetting('TEST_KEY_DB', 'new-db-val');
  const valCached = await getConfig('TEST_KEY_DB');
  assert.equal(valCached, 'val-from-db');

  // Clearing cache allows fresh read
  clearCache();
  const valFresh = await getConfig('TEST_KEY_DB');
  assert.equal(valFresh, 'new-db-val');
});

test('config: falls back to process.env when not in DB', async () => {
  clearCache();
  process.env.TEST_ENV_ONLY = 'env-value';

  const val = await getConfig('TEST_ENV_ONLY');
  assert.equal(val, 'env-value');
  delete process.env.TEST_ENV_ONLY;
});

test('config: returns empty string when key is absent in both DB and env', async () => {
  clearCache();
  const val = await getConfig('COMPLETELY_ABSENT_KEY_12345');
  assert.equal(val, '');
});

test('config: setConfig persists to DB and updates memory cache', async () => {
  clearCache();
  const ok = await setConfig('DYNAMIC_PORT', '9000');
  assert.equal(ok, true);

  const readBack = await getConfig('DYNAMIC_PORT');
  assert.equal(readBack, '9000');
});
