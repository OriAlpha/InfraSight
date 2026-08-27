'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSafeUrl,
  assertSafeUpstreamUrl,
  assertSafeWebhookUrl,
  isPrivateHost,
} = require('../utils/url-guard');

test('isPrivateHost recognises loopback and RFC1918 space', () => {
  for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1']) {
    assert.equal(isPrivateHost(host), true, `${host} should be private`);
  }
  for (const host of ['api.openai.com', '8.8.8.8', '172.32.0.1', '11.0.0.1']) {
    assert.equal(isPrivateHost(host), false, `${host} should be public`);
  }
});

test('assertSafeUrl rejects non-http protocols', () => {
  assert.throws(() => assertSafeUrl('file:///etc/passwd'), /must use http or https/);
  assert.throws(() => assertSafeUrl('gopher://example.com'), /must use http or https/);
});

test('assertSafeUrl rejects values that are not absolute URLs', () => {
  assert.throws(() => assertSafeUrl('api.openai.com/v1'), /not a valid absolute URL/);
  assert.throws(() => assertSafeUrl(''), /non-empty string/);
});

test('upstream URLs may not target instance metadata', () => {
  assert.throws(() => assertSafeUpstreamUrl('http://169.254.169.254/latest/meta-data/'), /instance-metadata/);
  assert.throws(() => assertSafeUpstreamUrl('http://metadata.google.internal/'), /instance-metadata/);
});

test('upstream URLs allow local providers by default', () => {
  // Ollama, vLLM and Docker service names are supported setups.
  assert.equal(assertSafeUpstreamUrl('http://localhost:11434/v1').port, '11434');
  assert.equal(assertSafeUpstreamUrl('https://api.openai.com/v1').hostname, 'api.openai.com');
});

test('BLOCK_PRIVATE_UPSTREAM turns off local providers', () => {
  const previous = process.env.BLOCK_PRIVATE_UPSTREAM;
  process.env.BLOCK_PRIVATE_UPSTREAM = 'true';
  try {
    assert.throws(() => assertSafeUpstreamUrl('http://localhost:11434/v1'), /private or loopback/);
    assert.equal(assertSafeUpstreamUrl('https://api.openai.com/v1').protocol, 'https:');
  } finally {
    if (previous === undefined) delete process.env.BLOCK_PRIVATE_UPSTREAM;
    else process.env.BLOCK_PRIVATE_UPSTREAM = previous;
  }
});

test('webhook URLs require https and a public host', () => {
  assert.throws(() => assertSafeWebhookUrl('http://hooks.slack.com/services/x'), /must use https/);
  assert.throws(() => assertSafeWebhookUrl('https://127.0.0.1/hook'), /private or loopback/);
  assert.equal(assertSafeWebhookUrl('https://hooks.slack.com/services/x').hostname, 'hooks.slack.com');
});
