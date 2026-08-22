'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../utils/rate-limit');

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function call(middleware, ip = '1.2.3.4', path = '/api/logs') {
  const res = makeRes();
  let nextCalled = false;
  middleware({ ip, path, socket: {} }, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('a max of 0 disables limiting entirely', () => {
  const limiter = createRateLimiter({ max: 0 });
  for (let i = 0; i < 50; i++) {
    assert.equal(call(limiter).nextCalled, true);
  }
});

test('requests are allowed up to the limit and rejected after it', () => {
  const limiter = createRateLimiter({ max: 3, windowMs: 60000 });

  for (let i = 0; i < 3; i++) {
    assert.equal(call(limiter).nextCalled, true, `request ${i + 1} should pass`);
  }

  const blocked = call(limiter);
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.body.error.code, 'rate_limit_exceeded');
  assert.ok(blocked.res.headers['retry-after']);
});

test('budgets are tracked per client address', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 60000 });

  call(limiter, '10.0.0.1');
  call(limiter, '10.0.0.1');
  assert.equal(call(limiter, '10.0.0.1').nextCalled, false);

  // A different caller still has its full budget.
  assert.equal(call(limiter, '10.0.0.2').nextCalled, true);
});

test('the window resets once it elapses', async () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 30 });

  assert.equal(call(limiter).nextCalled, true);
  assert.equal(call(limiter).nextCalled, false);

  await new Promise((resolve) => setTimeout(resolve, 45));

  assert.equal(call(limiter).nextCalled, true, 'budget should be replenished');
});

test('skip bypasses the limiter without consuming budget', () => {
  const limiter = createRateLimiter({
    max: 1,
    skip: (req) => req.path.startsWith('/api/proxy'),
  });

  for (let i = 0; i < 10; i++) {
    assert.equal(call(limiter, '1.2.3.4', '/api/proxy/v1/chat/completions').nextCalled, true);
  }

  // The skipped traffic did not eat into the budget for other routes.
  assert.equal(call(limiter, '1.2.3.4', '/api/logs').nextCalled, true);
});

test('rate limit headers advertise the remaining budget', () => {
  const limiter = createRateLimiter({ max: 5, windowMs: 60000 });
  const { res } = call(limiter);

  assert.equal(res.headers['ratelimit-limit'], '5');
  assert.equal(res.headers['ratelimit-remaining'], '4');
  assert.ok(Number(res.headers['ratelimit-reset']) > 0);
});
