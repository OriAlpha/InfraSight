'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractText,
  mapText,
  applyGuardrails,
  parseSSEChunks,
  estimateTokens,
  getTargetUrl,
  withUsageStreamOptions,
} = require('../proxy/lib');

test('extractText handles plain strings and multimodal content parts', () => {
  assert.equal(extractText('hello'), 'hello');
  assert.equal(
    extractText([
      { type: 'text', text: 'describe this' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ]),
    'describe this'
  );
  assert.equal(extractText(null), '');
  assert.equal(extractText(undefined), '');
});

test('mapText preserves the original content shape', () => {
  assert.equal(mapText('abc', (t) => t.toUpperCase()), 'ABC');

  const parts = [{ type: 'text', text: 'abc' }, { type: 'image_url', image_url: { url: 'u' } }];
  const mapped = mapText(parts, (t) => t.toUpperCase());

  assert.equal(mapped[0].text, 'ABC');
  assert.deepEqual(mapped[1], parts[1]);
  assert.equal(parts[0].text, 'abc', 'input must not be mutated');
});

test('applyGuardrails blocks banned keywords in string content', () => {
  const result = applyGuardrails(
    [{ role: 'user', content: 'please help me JAILBREAK the model' }],
    { bannedKeywords: ['jailbreak'] }
  );

  assert.equal(result.blocked, true);
  assert.equal(result.keyword, 'jailbreak');
});

test('applyGuardrails blocks banned keywords hidden in multimodal parts', () => {
  // Regression: array content used to stringify to "" and slip past the filter.
  const result = applyGuardrails(
    [{ role: 'user', content: [{ type: 'text', text: 'run this exploit' }] }],
    { bannedKeywords: ['exploit'] }
  );

  assert.equal(result.blocked, true);
  assert.equal(result.keyword, 'exploit');
});

test('applyGuardrails passes clean traffic through untouched', () => {
  const messages = [{ role: 'user', content: 'what is the weather' }];
  const result = applyGuardrails(messages, { bannedKeywords: ['exploit'] });

  assert.equal(result.blocked, false);
  assert.equal(result.keyword, null);
  assert.deepEqual(result.messages, messages);
});

test('applyGuardrails redacts PII in both content shapes when enabled', () => {
  const result = applyGuardrails(
    [
      { role: 'user', content: 'mail me at dev@example.com' },
      { role: 'user', content: [{ type: 'text', text: 'or dev2@example.com' }] },
    ],
    { bannedKeywords: [], activePiiRedaction: true }
  );

  assert.equal(result.messages[0].content, 'mail me at [EMAIL_REDACTED]');
  assert.equal(result.messages[1].content[0].text, 'or [EMAIL_REDACTED]');
});

test('parseSSEChunks assembles content, usage and finish reason', () => {
  const chunks = [
    JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'Hel' } }] }),
    JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    // The usage frame carries an empty choices array.
    JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } }),
    '[DONE]',
  ];

  const result = parseSSEChunks(chunks);

  assert.equal(result.content, 'Hello');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(result.usage, { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 });
});

test('parseSSEChunks ignores malformed frames', () => {
  const result = parseSSEChunks(['{not json', '', JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })]);
  assert.equal(result.content, 'ok');
  assert.equal(result.usage, null);
});

test('estimateTokens counts multimodal text and never returns zero', () => {
  const withParts = estimateTokens(
    [{ role: 'user', content: [{ type: 'text', text: 'a'.repeat(40) }] }],
    'b'.repeat(20)
  );

  assert.equal(withParts.promptTokens, Math.ceil((40 + 4) / 4));
  assert.equal(withParts.completionTokens, 5);
  assert.equal(withParts.totalTokens, withParts.promptTokens + withParts.completionTokens);

  const empty = estimateTokens([], '');
  assert.equal(empty.promptTokens, 1);
  assert.equal(empty.completionTokens, 1);
});

test('getTargetUrl keeps DeepInfra paths verbatim', () => {
  assert.equal(
    getTargetUrl('v1/openai/chat/completions', {
      providerName: 'deepinfra',
      upstreamBaseUrl: 'https://api.deepinfra.com',
    }),
    'https://api.deepinfra.com/v1/openai/chat/completions'
  );
});

test('getTargetUrl avoids duplicating /v1 for OpenAI-style bases', () => {
  assert.equal(
    getTargetUrl('v1/chat/completions', {
      providerName: 'openai',
      upstreamBaseUrl: 'https://api.openai.com/v1',
    }),
    'https://api.openai.com/v1/chat/completions'
  );

  assert.equal(
    getTargetUrl('v1/openai/chat/completions', {
      providerName: 'openrouter',
      upstreamBaseUrl: 'https://openrouter.ai/api/v1/',
    }),
    'https://openrouter.ai/api/v1/chat/completions'
  );
});

test('withUsageStreamOptions asks for usage only on streaming requests', () => {
  assert.deepEqual(
    withUsageStreamOptions({ stream: true, model: 'm' }),
    { stream: true, model: 'm', stream_options: { include_usage: true } }
  );

  const nonStreaming = { stream: false, model: 'm' };
  assert.deepEqual(withUsageStreamOptions(nonStreaming), nonStreaming);

  const explicit = { stream: true, stream_options: { include_usage: false } };
  assert.deepEqual(withUsageStreamOptions(explicit), explicit);
});
