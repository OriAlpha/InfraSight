'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate this test with a throwaway SQLite database
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrasight-raw-test-'));
const DB_FILE = path.join(tempDir, 'test.db');
process.env.DB_PATH = DB_FILE;
delete process.env.DATABASE_URL;

const sqliteAdapter = require('../db/sqlite');

test.before(async () => {
  await sqliteAdapter.runMigrations();
});

test.after(async () => {
  await sqliteAdapter.closeDb();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('insertRequest automatically synthesizes raw_request when omitted', () => {
  const req = sqliteAdapter.insertRequest({
    id: 'test-raw-req-1',
    model: 'meta-llama/Llama-3-70b-instruct',
    provider: 'DeepInfra',
    input_messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }],
    output_text: 'Quantum computing harnesses superposition and entanglement to solve specific problems exponentially faster.',
    prompt_tokens: 15,
    completion_tokens: 18,
    latency_ms: 320,
    status: 'success'
  });

  const row = sqliteAdapter.getRequestById('test-raw-req-1');
  assert.ok(row, 'Row should exist in db');
  assert.ok(row.raw_request, 'raw_request must not be null or empty');

  const parsedReq = JSON.parse(row.raw_request);
  assert.equal(parsedReq.model, 'meta-llama/Llama-3-70b-instruct');
  assert.deepEqual(parsedReq.messages, [{ role: 'user', content: 'Explain quantum computing in one sentence.' }]);
});

test('insertRequest automatically synthesizes raw_response with standard choices schema when omitted', () => {
  const req = sqliteAdapter.insertRequest({
    id: 'test-raw-resp-1',
    model: 'gpt-4o',
    provider: 'OpenAI',
    input_messages: [{ role: 'user', content: 'Hello' }],
    output_text: 'Hello! How can I help you today?',
    prompt_tokens: 10,
    completion_tokens: 9,
    latency_ms: 250,
    status: 'success'
  });

  const row = sqliteAdapter.getRequestById('test-raw-resp-1');
  assert.ok(row, 'Row should exist in db');
  assert.ok(row.raw_response, 'raw_response must not be null or empty');

  const parsedResp = JSON.parse(row.raw_response);
  assert.ok(Array.isArray(parsedResp.choices), 'raw_response should have choices array');
  assert.equal(parsedResp.choices[0].message.content, 'Hello! How can I help you today?');
  assert.equal(parsedResp.model, 'gpt-4o');
  assert.equal(parsedResp.usage.prompt_tokens, 10);
  assert.equal(parsedResp.usage.completion_tokens, 9);
});

test('insertRequest synthesizes error raw_response when status is error', () => {
  const req = sqliteAdapter.insertRequest({
    id: 'test-raw-err-1',
    model: 'claude-3-5-sonnet',
    provider: 'Anthropic',
    input_messages: [{ role: 'user', content: 'Trigger error' }],
    status: 'error',
    error_message: '429 Rate limit exceeded',
    latency_ms: 120
  });

  const row = sqliteAdapter.getRequestById('test-raw-err-1');
  assert.ok(row);
  assert.ok(row.raw_response);

  const parsedErr = JSON.parse(row.raw_response);
  assert.ok(parsedErr.error, 'raw_response for error request should include error object');
  assert.equal(parsedErr.error.message, '429 Rate limit exceeded');
});

test('insertRequest preserves explicit raw_request and raw_response without overwriting', () => {
  const customReq = JSON.stringify({ custom: 'request_data', stream: true });
  const customResp = JSON.stringify({ custom: 'response_data', chunks_count: 42 });

  sqliteAdapter.insertRequest({
    id: 'test-raw-custom-1',
    model: 'mistral-large',
    provider: 'Mistral',
    input_messages: [{ role: 'user', content: 'test' }],
    output_text: 'test response',
    raw_request: customReq,
    raw_response: customResp,
    latency_ms: 150,
    status: 'success'
  });

  const row = sqliteAdapter.getRequestById('test-raw-custom-1');
  assert.equal(row.raw_request, customReq);
  assert.equal(row.raw_response, customResp);
});
