'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { safeCompare, parseBasicAuth, readAuthConfig, createAuthMiddleware } = require('../utils/auth');

/** Minimal Express-like response double. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function run(middleware, req) {
  const res = makeRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('safeCompare matches equal strings and rejects differing lengths', () => {
  assert.equal(safeCompare('hunter2', 'hunter2'), true);
  assert.equal(safeCompare('hunter2', 'hunter3'), false);
  assert.equal(safeCompare('short', 'a-much-longer-secret'), false);
  assert.equal(safeCompare('', ''), true);
});

test('parseBasicAuth decodes credentials, including colons in the password', () => {
  const header = 'Basic ' + Buffer.from('admin:pa:ss:word').toString('base64');
  assert.deepEqual(parseBasicAuth(header), { username: 'admin', password: 'pa:ss:word' });
});

test('parseBasicAuth rejects other schemes and malformed values', () => {
  assert.equal(parseBasicAuth('Bearer sk-123'), null);
  assert.equal(parseBasicAuth(undefined), null);
  assert.equal(parseBasicAuth('Basic ' + Buffer.from('nocolon').toString('base64')), null);
});

test('readAuthConfig refuses to enable auth without a password', () => {
  assert.throws(
    () => readAuthConfig({ DASHBOARD_AUTH_ENABLED: 'true' }),
    /requires DASHBOARD_PASSWORD/
  );

  assert.throws(
    () => readAuthConfig({ DASHBOARD_AUTH_ENABLED: 'true', DASHBOARD_USERNAME: 'admin' }),
    /requires DASHBOARD_PASSWORD/
  );
});

test('readAuthConfig returns a disabled config when auth is off', () => {
  assert.deepEqual(readAuthConfig({}), { enabled: false, username: '', password: '' });
});

test('auth middleware is a no-op when disabled', () => {
  const middleware = createAuthMiddleware({ enabled: false, username: '', password: '' });
  const { nextCalled } = run(middleware, { path: '/api/logs', headers: {} });
  assert.equal(nextCalled, true);
});

test('auth middleware challenges unauthenticated dashboard requests', () => {
  const middleware = createAuthMiddleware({ enabled: true, username: 'admin', password: 's3cret' });
  const { res, nextCalled } = run(middleware, { path: '/api/logs', headers: {} });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.headers['www-authenticate'], /^Basic realm=/);
});

test('auth middleware accepts correct credentials and rejects wrong ones', () => {
  const middleware = createAuthMiddleware({ enabled: true, username: 'admin', password: 's3cret' });

  const good = 'Basic ' + Buffer.from('admin:s3cret').toString('base64');
  assert.equal(run(middleware, { path: '/api/logs', headers: { authorization: good } }).nextCalled, true);

  const badPass = 'Basic ' + Buffer.from('admin:wrong').toString('base64');
  assert.equal(run(middleware, { path: '/api/logs', headers: { authorization: badPass } }).nextCalled, false);

  const badUser = 'Basic ' + Buffer.from('root:s3cret').toString('base64');
  assert.equal(run(middleware, { path: '/api/logs', headers: { authorization: badUser } }).nextCalled, false);
});

test('auth middleware exempts proxy and health routes', () => {
  const middleware = createAuthMiddleware({ enabled: true, username: 'admin', password: 's3cret' });

  assert.equal(run(middleware, { path: '/api/proxy/v1/chat/completions', headers: {} }).nextCalled, true);
  assert.equal(run(middleware, { path: '/api/health', headers: {} }).nextCalled, true);
});
