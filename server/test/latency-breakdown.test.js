'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Dynamically import the ES module from client/src/utils/latencyBreakdown.js
let computeLatencyBreakdown;

test.before(async () => {
  const modulePath = path.resolve(__dirname, '../../client/src/utils/latencyBreakdown.js');
  const mod = await import(`file://${modulePath.replace(/\\/g, '/')}`);
  computeLatencyBreakdown = mod.computeLatencyBreakdown;
  assert.equal(typeof computeLatencyBreakdown, 'function');
});

test('computeLatencyBreakdown handles empty, null, undefined, or zero-latency logs gracefully', () => {
  const cases = [null, undefined, {}, { latency_ms: 0 }, { latency_ms: -10 }, { latency_ms: 'abc' }];

  for (const c of cases) {
    const res = computeLatencyBreakdown(c);
    assert.equal(res.gatewayMs, 0);
    assert.equal(res.ttftMs, 0);
    assert.equal(res.decodeMs, 0);
    assert.equal(res.egressMs, 0);
    assert.equal(res.infrasightMs, 0);
    assert.equal(res.upstreamMs, 0);
    assert.equal(res.infrasightPct, 0);
    assert.equal(res.upstreamPct, 0);
    assert.equal(res.tokensPerSec, '0.0');
    assert.equal(res.msPerToken, '—');
    assert.equal(res.promptTokPerSec, 0);
    assert.deepEqual(res.stages, []);
  }
});

test('computeLatencyBreakdown stage durations strictly sum to total latency', () => {
  const latencies = [1, 2, 5, 12, 50, 120, 450, 1250, 5420, 32000];

  for (const lat of latencies) {
    const res = computeLatencyBreakdown({
      latency_ms: lat,
      prompt_tokens: 120,
      completion_tokens: 45
    });

    const sum = res.gatewayMs + res.ttftMs + res.decodeMs + res.egressMs;
    assert.equal(
      sum,
      lat,
      `Stages sum (${sum}) must exactly equal total latency (${lat})`
    );

    assert.equal(
      res.infrasightMs + res.upstreamMs,
      lat,
      `Infrasight + upstream must equal total latency (${lat})`
    );

    assert.equal(res.stages.length, 4);
    assert.ok(!isNaN(res.infrasightPct));
    assert.ok(!isNaN(res.upstreamPct));
  }
});

test('computeLatencyBreakdown honors explicit TTFT from metadata', () => {
  // Test ttft_ms
  const res1 = computeLatencyBreakdown({
    latency_ms: 800,
    prompt_tokens: 50,
    completion_tokens: 100,
    metadata: JSON.stringify({ ttft_ms: 185 })
  });

  assert.equal(res1.ttftMs, 185);
  const ttftStage1 = res1.stages.find(s => s.id === 'ttft');
  assert.ok(ttftStage1);
  assert.equal(ttftStage1.durationMs, 185);
  assert.ok(ttftStage1.detail.includes('Measured'));

  // Test time_to_first_token_ms
  const res2 = computeLatencyBreakdown({
    latency_ms: 800,
    prompt_tokens: 50,
    completion_tokens: 100,
    metadata: { time_to_first_token_ms: 210 }
  });

  assert.equal(res2.ttftMs, 210);
  const ttftStage2 = res2.stages.find(s => s.id === 'ttft');
  assert.ok(ttftStage2);
  assert.equal(ttftStage2.durationMs, 210);

  // If explicit TTFT exceeds remaining budget, clamp gracefully without breaking invariants
  const res3 = computeLatencyBreakdown({
    latency_ms: 200,
    prompt_tokens: 50,
    completion_tokens: 100,
    metadata: { ttft_ms: 9999 }
  });
  const sum3 = res3.gatewayMs + res3.ttftMs + res3.decodeMs + res3.egressMs;
  assert.equal(sum3, 200);
});

test('computeLatencyBreakdown distinguishes Playground sandbox and marks security steps bypassed', () => {
  const playgroundLog = {
    latency_ms: 600,
    prompt_tokens: 80,
    completion_tokens: 60,
    tags: ['playground', 'sandbox'],
    provider: 'DeepInfra'
  };

  const res = computeLatencyBreakdown(playgroundLog);
  const gatewayStage = res.stages.find(s => s.id === 'gateway');
  assert.ok(gatewayStage);
  assert.equal(gatewayStage.name, 'Sandbox Ingress');
  assert.equal(gatewayStage.icon, 'FileCode');

  // Guardrail step is bypassed in playground sandbox
  const guardrailStep = gatewayStage.steps.find(s => s.name.includes('Security Guardrails'));
  assert.ok(guardrailStep);
  assert.equal(guardrailStep.state, 'bypassed');
  assert.ok(guardrailStep.status.includes('Bypassed'));

  // Rate limiter is bypassed in playground sandbox
  const rateLimitStep = gatewayStage.steps.find(s => s.name.includes('Rate Limiter'));
  assert.ok(rateLimitStep);
  assert.equal(rateLimitStep.state, 'bypassed');
});

test('computeLatencyBreakdown displays active proxy security steps for production gateway logs', () => {
  const proxyLog = {
    latency_ms: 750,
    prompt_tokens: 150,
    completion_tokens: 80,
    tags: ['production', 'api'],
    user_id: 'usr_premium_1',
    metadata: JSON.stringify({ pii_redacted: true })
  };

  const res = computeLatencyBreakdown(proxyLog);
  const gatewayStage = res.stages.find(s => s.id === 'gateway');
  assert.ok(gatewayStage);
  assert.equal(gatewayStage.name, 'Gateway & Ingress');
  assert.equal(gatewayStage.icon, 'ShieldCheck');

  const piiStep = gatewayStage.steps.find(s => s.name.includes('PII Luhn & Regex'));
  assert.ok(piiStep);
  assert.equal(piiStep.status, 'Redacted');
  assert.equal(piiStep.state, 'passed');

  const authStep = gatewayStage.steps.find(s => s.name.includes('Auth'));
  assert.ok(authStep);
  assert.equal(authStep.status, 'Authenticated');
});

test('computeLatencyBreakdown handles tool spans correctly', () => {
  const toolLog = {
    latency_ms: 320,
    span_type: 'tool',
    span_name: 'fetch_weather'
  };

  const res = computeLatencyBreakdown(toolLog);
  const gatewayStage = res.stages.find(s => s.id === 'gateway');
  assert.ok(gatewayStage);
  const toolTargetStep = gatewayStage.steps.find(s => s.name === 'Target Tool Function');
  assert.ok(toolTargetStep);
  assert.equal(toolTargetStep.status, 'fetch_weather');
});

test('computeLatencyBreakdown formats error logs without division by zero or broken steps', () => {
  const errorLog = {
    latency_ms: 450,
    status: 'error',
    error_message: '429 Rate limit exceeded by upstream provider',
    prompt_tokens: 50,
    completion_tokens: 0
  };

  const res = computeLatencyBreakdown(errorLog);
  const decodeStage = res.stages.find(s => s.id === 'decode');
  assert.ok(decodeStage);
  assert.equal(decodeStage.name, 'Generation Interrupted');
  assert.equal(decodeStage.status, 'Error');

  const errCauseStep = decodeStage.steps.find(s => s.name === 'Error Cause');
  assert.ok(errCauseStep);
  assert.equal(errCauseStep.state, 'error');
  assert.ok(errCauseStep.status.includes('429 Rate limit'));
});

test('computeLatencyBreakdown handles streaming vs non-streaming logs', () => {
  const streamLog = {
    latency_ms: 500,
    completion_tokens: 60,
    stream: 1
  };
  const streamRes = computeLatencyBreakdown(streamLog);
  const streamDecode = streamRes.stages.find(s => s.id === 'decode');
  assert.equal(streamDecode.name, 'Token Streaming (SSE)');
  const streamDelivery = streamDecode.steps.find(s => s.name === 'Delivery Protocol');
  assert.equal(streamDelivery.status, 'Active SSE Stream');

  const bufferedLog = {
    latency_ms: 500,
    completion_tokens: 60,
    stream: 0
  };
  const buffRes = computeLatencyBreakdown(bufferedLog);
  const buffDecode = buffRes.stages.find(s => s.id === 'decode');
  assert.equal(buffDecode.name, 'Response Buffering');
  const buffDelivery = buffDecode.steps.find(s => s.name === 'Delivery Protocol');
  assert.equal(buffDelivery.status, 'Buffered HTTP');
});

test('computeLatencyBreakdown extracts real evaluation and feedback ratings', () => {
  const scoredLog = {
    latency_ms: 900,
    prompt_tokens: 100,
    completion_tokens: 150,
    evaluation: JSON.stringify({ score: 4.65 }),
    feedback: JSON.stringify({ rating: 5 })
  };

  const res = computeLatencyBreakdown(scoredLog);
  const egressStage = res.stages.find(s => s.id === 'egress');
  assert.ok(egressStage);

  const evalStep = egressStage.steps.find(s => s.name === 'Quality Evaluation Engine');
  assert.ok(evalStep);
  assert.equal(evalStep.status, 'Scored (4.7/5.0)');
  assert.equal(evalStep.state, 'passed');

  const feedbackStep = egressStage.steps.find(s => s.name === 'User Feedback Verification');
  assert.ok(feedbackStep);
  assert.equal(feedbackStep.status, 'Feedback (5★)');
  assert.equal(feedbackStep.state, 'passed');
});

test('computeLatencyBreakdown is immune to malformed JSON in metadata, evaluation and feedback', () => {
  const corruptLog = {
    latency_ms: 650,
    prompt_tokens: 'invalid',
    completion_tokens: null,
    metadata: '{ broken json: true',
    evaluation: '{ not valid json',
    feedback: '{ also broken',
    tags: 12345
  };

  // Must not throw ReferenceError or SyntaxError
  assert.doesNotThrow(() => {
    const res = computeLatencyBreakdown(corruptLog);
    assert.equal(res.stages.length, 4);
    assert.equal(res.gatewayMs + res.ttftMs + res.decodeMs + res.egressMs, 650);
  });
});

test('computeLatencyBreakdown correctly handles guardrail intercepted logs (zero upstream latency/tokens)', () => {
  const guardrailLog = {
    id: '4075d568-0be0-4e37-ace6-79ae5ddcc430',
    latency_ms: 24,
    prompt_tokens: 35,
    completion_tokens: 0,
    output_message: JSON.stringify({
      role: 'assistant',
      content: "Blocked by guardrail: prompt contains forbidden keyword 'insulting employee intelligence'"
    }),
    evaluation: JSON.stringify({
      safety: {
        status: 'unsafe',
        reasoning: "Blocked by guardrail: prompt contains forbidden keyword 'insulting employee intelligence'"
      }
    })
  };

  const res = computeLatencyBreakdown(guardrailLog);

  assert.equal(res.isGuardrailBlocked, true);
  assert.equal(res.blockedKeyword, 'insulting employee intelligence');
  assert.equal(res.upstreamMs, 0, 'Upstream inference must be 0ms when blocked by guardrail');
  assert.equal(res.ttftMs, 0, 'TTFT must be 0ms when blocked by guardrail');
  assert.equal(res.decodeMs, 0, 'Decode must be 0ms when blocked by guardrail');
  assert.equal(res.infrasightMs, 24, 'All latency must belong to InfraSight gateway policy inspection & egress');
  assert.equal(res.infrasightPct, 100);
  assert.equal(res.upstreamPct, 0);

  // Stages sum invariant
  const sum = res.gatewayMs + res.ttftMs + res.decodeMs + res.egressMs;
  assert.equal(sum, 24);

  // Gateway stage verification
  const gateway = res.stages.find(s => s.id === 'gateway');
  assert.ok(gateway);
  assert.equal(gateway.status, 'Blocked');
  const keywordStep = gateway.steps.find(s => s.name === 'Banned Keyword Policy Filter');
  assert.ok(keywordStep);
  assert.equal(keywordStep.state, 'error');
  assert.ok(keywordStep.status.includes('Blocked'));
  assert.ok(keywordStep.status.includes('insulting employee'));

  const routerStep = gateway.steps.find(s => s.name === 'Upstream Provider Router');
  assert.ok(routerStep);
  assert.equal(routerStep.state, 'bypassed');
  assert.ok(routerStep.status.includes('Terminated'));

  // TTFT & Decode stage verification
  const ttft = res.stages.find(s => s.id === 'ttft');
  assert.equal(ttft.status, 'Bypassed');
  assert.equal(ttft.durationMs, 0);

  const decode = res.stages.find(s => s.id === 'decode');
  assert.equal(decode.status, 'Bypassed');
  assert.equal(decode.durationMs, 0);
});
