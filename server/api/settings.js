/**
 * Settings Management API router.
 *
 * Mount at: /api/settings
 *
 * @module api/settings
 */
'use strict';

const { Router } = require('express');
const { getConfig, setConfig, clearCache } = require('../utils/config');

const router = Router();

const SENSITIVE_KEYS = [
  'UPSTREAM_API_KEY',
  'DEEPINFRA_API_KEY',
  'ALERT_SLACK_WEBHOOK_URL',
  'ALERT_DISCORD_WEBHOOK_URL',
];

const CONFIG_KEYS = [
  'UPSTREAM_API_BASE',
  'UPSTREAM_PROVIDER',
  'UPSTREAM_API_KEY',
  'ALERT_SLACK_WEBHOOK_URL',
  'ALERT_DISCORD_WEBHOOK_URL',
  'ALERT_LATENCY_THRESHOLD_MS',
  'ALERT_ON_FAILURE',
  'LOG_PAYLOADS',
  'MASK_PII',
  'ACTIVE_PII_REDACTION',
  'BANNED_KEYWORDS',
  'EVALUATOR_MODEL',
  'EVALUATOR_API_BASE',
];

/**
 * Helper to mask sensitive config strings.
 * @param {string} val
 * @returns {string}
 */
function maskValue(val) {
  if (!val) return '';
  if (val.length > 8) {
    return val.substring(0, 4) + '...' + val.substring(val.length - 4);
  }
  return '********';
}

/**
 * GET /api/settings
 * Retrieve current configuration states (both dynamic overrides and environment fallbacks).
 */
router.get('/', async (req, res) => {
  try {
    const settings = {};
    for (const key of CONFIG_KEYS) {
      let val = await getConfig(key);
      if (val && SENSITIVE_KEYS.includes(key)) {
        settings[key] = maskValue(val);
      } else {
        settings[key] = val;
      }
    }
    // Include database type in output for display
    const isPostgres = process.env.DATABASE_URL && (
      process.env.DATABASE_URL.startsWith('postgres://') ||
      process.env.DATABASE_URL.startsWith('postgresql://')
    );
    settings.DATABASE_TYPE = isPostgres ? 'PostgreSQL' : 'SQLite';

    res.json({ data: settings });
  } catch (err) {
    console.error('[settings] GET / error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch settings' } });
  }
});

/**
 * PUT /api/settings
 * Save dynamic overrides to the database.
 * Body: { [key]: value }
 */
router.put('/', async (req, res) => {
  try {
    const updates = req.body || {};
    let savedCount = 0;

    for (const [key, value] of Object.entries(updates)) {
      if (!CONFIG_KEYS.includes(key)) continue;

      // Check if value is a masked placeholder (contains '...')
      // If so, do not save it (user did not modify this sensitive field)
      if (SENSITIVE_KEYS.includes(key) && typeof value === 'string' && value.includes('...')) {
        continue;
      }

      await setConfig(key, value);
      savedCount++;
    }

    // Clear memory config cache to reload new values
    clearCache();

    res.json({ success: true, message: `Successfully updated ${savedCount} settings.` });
  } catch (err) {
    console.error('[settings] PUT / error:', err.message);
    res.status(500).json({ error: { message: 'Failed to update settings: ' + err.message } });
  }
});

module.exports = router;
