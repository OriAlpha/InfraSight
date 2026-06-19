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
const { getDb, runMigrations, getRequests } = require('./db');
const { seedModels } = require('./db/seed-models');

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

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

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

// JSON body parser with 10MB limit (for large prompt/response payloads)
app.use(express.json({ limit: '10mb' }));

// Optional Basic Authentication (applied globally, bypassing /api/proxy and /api/health)
const authMiddleware = (req, res, next) => {
  const authEnabled = process.env.DASHBOARD_AUTH_ENABLED === 'true';
  if (!authEnabled) {
    return next();
  }

  // Bypass proxy and health requests
  if (req.path.startsWith('/api/proxy') || req.path === '/api/health') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="InfraSight Dashboard"');
    return res.status(401).send('Authentication required');
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    const username = parts[0];
    const password = parts.slice(1).join(':');

    const expectedUsername = process.env.DASHBOARD_USERNAME || 'admin';
    const expectedPassword = process.env.DASHBOARD_PASSWORD || 'admin';

    if (username === expectedUsername && password === expectedPassword) {
      return next();
    }
  } catch {
    // fall through
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="InfraSight Dashboard"');
  return res.status(401).send('Invalid credentials');
};

app.use(authMiddleware);

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
    try {
      const result = await getRequests({ page: 1, limit: 1 });
      totalRequests = result.total || 0;
    } catch (dbErr) {
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

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      dbSize,
      database: databaseType,
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
// Startup
// ---------------------------------------------------------------------------

/**
 * Initializes the database, seeds models, and starts listening.
 */
async function start() {
  try {
    // Initialize database and run schema migrations
    await runMigrations();
    console.log('[server] Database initialized.');

    // Seed model pricing data
    seedModels();
    console.log('[server] Model data seeded.');

    app.listen(PORT, () => {
      console.log(`[server] InfraSight server running on http://localhost:${PORT}`);
      console.log(`[server] Proxy endpoint: http://localhost:${PORT}/api/proxy`);
      console.log(`[server] Health check:   http://localhost:${PORT}/api/health`);
      console.log(`[server] Client URL:     ${CLIENT_URL}`);
    });
  } catch (err) {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
