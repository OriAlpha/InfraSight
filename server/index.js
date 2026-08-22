/**
 * InfraSight Server — Main entry point.
 *
 * Express application that serves the LLM observability platform API
 * and proxies requests to a configurable OpenAI-compatible upstream provider.
 *
 * @module index
 */
'use strict';

const path = require('path');
const fs = require('fs');

// Load environment variables from the project root .env
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const { runMigrations, getRequests, closeDb } = require('./db');
const { seedModels } = require('./db/seed-models');
const { readAuthConfig, createAuthMiddleware } = require('./utils/auth');
const { createRateLimiter } = require('./utils/rate-limit');
const { drainEvaluations } = require('./services/evaluator');

// Route modules
const proxyRouter = require('./proxy');
const logsRouter = require('./api/logs');
const analyticsRouter = require('./api/analytics');
const conversationsRouter = require('./api/conversations');
const modelsRouter = require('./api/models');
const promptsRouter = require('./api/prompts');
const tracesRouter = require('./api/traces');
const settingsRouter = require('./api/settings');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || '10mb';
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 15000;

// Validate auth configuration before wiring any middleware — an enabled-but-
// unconfigured dashboard must not fall back to a default password.
let authConfig;
try {
  authConfig = readAuthConfig();
} catch (err) {
  console.error('[server] Configuration error:', err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Required for correct client IPs (and therefore rate limiting) when deployed
// behind a reverse proxy or ingress.
if (process.env.TRUST_PROXY) {
  const trustProxy = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? parseInt(trustProxy, 10) : trustProxy);
}

/**
 * Baseline response hardening. The dashboard is a self-contained SPA, so it
 * needs no third-party origins beyond the inline styles the chart library emits.
 */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    + "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "
    + "object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
  );
  next();
});

// CORS — allow the Vite dev server and any configured client URL
app.use(cors({
  origin: [CLIENT_URL, 'http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Conversation-Id',
    'X-User-Id',
    'X-Trace-Id',
    'X-Span-Id',
    'X-Parent-Span-Id',
    'X-Span-Name',
    'X-Span-Type'
  ],
  credentials: true,
}));

// JSON body parser (large prompt/response payloads)
app.use(express.json({ limit: MAX_BODY_SIZE }));

// Rate limiting: the dashboard API and the proxy have very different traffic
// shapes, so they get independent budgets. Proxy limiting is opt-in.
app.use(createRateLimiter({
  name: 'dashboard API',
  max: parseInt(process.env.API_RATE_LIMIT, 10) || 600,
  skip: (req) => !req.path.startsWith('/api/') || req.path.startsWith('/api/proxy'),
}));

app.use(createRateLimiter({
  name: 'proxy',
  max: parseInt(process.env.PROXY_RATE_LIMIT, 10) || 0,
  skip: (req) => !req.path.startsWith('/api/proxy'),
}));

// Optional Basic Authentication (bypasses /api/proxy and /api/health)
app.use(createAuthMiddleware(authConfig));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Upstream LLM proxy
app.use('/api/proxy', proxyRouter);

// CRUD / management APIs
app.use('/api/logs', logsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/traces', tracesRouter);
app.use('/api/settings', settingsRouter);

/**
 * GET /api/health
 * Health check endpoint. Returns uptime, DB file size, and total logged requests.
 */
app.get('/api/health', async (req, res) => {
  try {
    const isPostgres = process.env.DATABASE_URL && (
      process.env.DATABASE_URL.startsWith('postgres://') ||
      process.env.DATABASE_URL.startsWith('postgresql://')
    );

    let totalRequests = 0;
    let databaseOk = true;
    try {
      const result = await getRequests({ page: 1, limit: 1 });
      totalRequests = result.total || 0;
    } catch (dbErr) {
      databaseOk = false;
      console.error('[health] Database count query error:', dbErr.message);
    }

    // Get database size indicator
    let dbSize = 0;
    let databaseType = 'SQLite';

    if (isPostgres) {
      databaseType = 'PostgreSQL';
    } else {
      const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'data', 'infrasight.db');
      try {
        const stat = fs.statSync(dbPath);
        dbSize = stat.size;
      } catch {
        // DB file may not exist yet
      }
    }

    res.status(databaseOk ? 200 : 503).json({
      status: databaseOk ? 'ok' : 'degraded',
      uptime: process.uptime(),
      dbSize,
      database: databaseType,
      databaseOk,
      totalRequests,
    });
  } catch (err) {
    console.error('[health] Error:', err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Static file serving (production)
// ---------------------------------------------------------------------------

const clientDistPath = path.resolve(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // SPA fallback — serve index.html for non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    } else {
      res.status(404).json({ error: { message: 'API endpoint not found' } });
    }
  });
} else {
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.status(404).json({
        message: 'Client not built. Run the client build or use the dev server at ' + CLIENT_URL,
      });
    } else {
      res.status(404).json({ error: { message: 'API endpoint not found' } });
    }
  });
}

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// ---------------------------------------------------------------------------
// Startup / shutdown
// ---------------------------------------------------------------------------

/** @type {import('http').Server | null} */
let server = null;
let shuttingDown = false;

/**
 * Closes the listener, lets in-flight evaluations finish, and releases the
 * database handle so SQLite can checkpoint its WAL cleanly.
 *
 * @param {string} signal - The signal that triggered the shutdown
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[server] ${signal} received — shutting down gracefully.`);

  // Hard stop if something refuses to settle.
  const forceExit = setTimeout(() => {
    console.error('[server] Shutdown timed out — forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('[server] Stopped accepting new connections.');
    }

    const drained = await drainEvaluations(Math.floor(SHUTDOWN_TIMEOUT_MS / 2));
    if (!drained) {
      console.warn('[server] Background evaluations still pending at shutdown.');
    }

    await closeDb();
    console.log('[server] Database closed.');
  } catch (err) {
    console.error('[server] Error during shutdown:', err.message);
  }

  clearTimeout(forceExit);
  process.exit(0);
}

/**
 * Logs configuration that is easy to get wrong on a shared deployment.
 */
function logStartupWarnings() {
  if (!authConfig.enabled) {
    console.warn(
      '[server] Dashboard authentication is DISABLED. Anyone who can reach this '
      + 'port can read logged prompts and change the upstream provider. '
      + 'Set DASHBOARD_AUTH_ENABLED=true before exposing it beyond localhost.'
    );
  }

  if (process.env.NODE_ENV === 'production' && process.env.LOG_PAYLOADS !== 'false') {
    console.log('[server] Payload logging is on. Set LOG_PAYLOADS=false to store telemetry only.');
  }
}

/**
 * Initializes the database, seeds models, and starts listening.
 */
async function start() {
  try {
    // Initialize database and run schema migrations
    await runMigrations();
    console.log('[server] Database initialized.');

    // Seed model pricing data
    await seedModels();
    console.log('[server] Model data seeded.');

    server = app.listen(PORT, () => {
      console.log(`[server] InfraSight server running on http://localhost:${PORT}`);
      console.log(`[server] Proxy endpoint: http://localhost:${PORT}/api/proxy`);
      console.log(`[server] Health check:   http://localhost:${PORT}/api/health`);
      console.log(`[server] Client URL:     ${CLIENT_URL}`);
      logStartupWarnings();
    });

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  }
}

// Only listen when run directly, so tests can import the app.
if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
module.exports.shutdown = shutdown;
