/**
 * Dashboard HTTP Basic authentication.
 *
 * @module utils/auth
 */
'use strict';

const crypto = require('crypto');

/**
 * Constant-time string comparison.
 *
 * Both sides are hashed first so that inputs of differing length can be
 * compared without `timingSafeEqual` throwing, and so the comparison itself
 * leaks nothing about the expected length.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Parses an HTTP Basic `Authorization` header.
 *
 * @param {string|undefined} header
 * @returns {{ username: string, password: string }|null}
 */
function parseBasicAuth(header) {
  if (!header || !/^basic\s/i.test(header)) return null;

  try {
    const token = header.slice(header.indexOf(' ') + 1);
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep === -1) return null;

    return {
      username: decoded.slice(0, sep),
      password: decoded.slice(sep + 1),
    };
  } catch {
    return null;
  }
}

/**
 * Reads dashboard auth configuration from the environment.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{ enabled: boolean, username: string, password: string }}
 * @throws {Error} If auth is enabled but no password is configured
 */
function readAuthConfig(env = process.env) {
  const enabled = env.DASHBOARD_AUTH_ENABLED === 'true';
  if (!enabled) {
    return { enabled: false, username: '', password: '' };
  }

  const username = env.DASHBOARD_USERNAME || 'admin';
  const password = env.DASHBOARD_PASSWORD || '';

  // Previously this silently fell back to admin/admin, which meant enabling
  // auth could leave the dashboard effectively open.
  if (!password) {
    throw new Error(
      'DASHBOARD_AUTH_ENABLED=true requires DASHBOARD_PASSWORD to be set. '
      + 'Refusing to start with a default password.'
    );
  }

  return { enabled: true, username, password };
}

/**
 * Builds the dashboard auth middleware.
 *
 * Proxy and health routes are exempt so client applications and orchestrators
 * can reach them without credentials.
 *
 * @param {{ enabled: boolean, username: string, password: string }} config
 * @returns {import('express').RequestHandler}
 */
function createAuthMiddleware(config) {
  const challenge = () => 'Basic realm="InfraSight Dashboard", charset="UTF-8"';

  return function authMiddleware(req, res, next) {
    if (!config.enabled) return next();

    if (req.path.startsWith('/api/proxy') || req.path === '/api/health') {
      return next();
    }

    const credentials = parseBasicAuth(req.headers.authorization);
    if (!credentials) {
      res.setHeader('WWW-Authenticate', challenge());
      return res.status(401).send('Authentication required');
    }

    // Evaluate both comparisons so the response time does not reveal which
    // half was wrong.
    const userOk = safeCompare(credentials.username, config.username);
    const passOk = safeCompare(credentials.password, config.password);

    if (userOk && passOk) {
      return next();
    }

    res.setHeader('WWW-Authenticate', challenge());
    return res.status(401).send('Invalid credentials');
  };
}

module.exports = {
  safeCompare,
  parseBasicAuth,
  readAuthConfig,
  createAuthMiddleware,
};
