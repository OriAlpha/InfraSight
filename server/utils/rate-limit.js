/**
 * Dependency-free fixed-window rate limiter.
 *
 * Counters live in process memory, so limits are per-instance. That is enough
 * to blunt scripted abuse of a single-node deployment; a multi-replica setup
 * behind a load balancer should rate limit at the ingress instead.
 *
 * @module utils/rate-limit
 */
'use strict';

/**
 * Creates rate-limiting middleware.
 *
 * @param {Object} [opts]
 * @param {number} [opts.max=600] - Requests allowed per window. 0 disables the limiter.
 * @param {number} [opts.windowMs=60000] - Window length in milliseconds
 * @param {(req: import('express').Request) => boolean} [opts.skip] - Return true to bypass
 * @param {string} [opts.name='api'] - Label used in the error message
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter(opts = {}) {
  const { max = 600, windowMs = 60000, skip, name = 'api' } = opts;

  if (!max || max <= 0) {
    return function rateLimitDisabled(_req, _res, next) { next(); };
  }

  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  // Drop expired buckets so the map cannot grow without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (typeof sweep.unref === 'function') sweep.unref();

  return function rateLimit(req, res, next) {
    if (skip && skip(req)) return next();

    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({
        error: {
          message: `Too many ${name} requests. Try again in a moment.`,
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
        }
      });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
