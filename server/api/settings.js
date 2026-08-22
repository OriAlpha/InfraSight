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
const { assertSafeUpstreamUrl, assertSafeWebhookUrl } = require('../utils/url-guard');

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
  'MOCK_MODE',
  'STREAM_USAGE_INJECTION',
];

/**
 * Per-key validation for settings that are used to make outbound requests.
 * These are operator-supplied at runtime, so they are checked before they are
 * ever stored.
 *
 * @type {Object<string, (value: string) => void>}
 */
const VALIDATORS = {
  UPSTREAM_API_BASE: (v) => { assertSafeUpstreamUrl(v); },
  EVALUATOR_API_BASE: (v) => { assertSafeUpstreamUrl(v); },
  ALERT_SLACK_WEBHOOK_URL: (v) => { assertSafeWebhookUrl(v, 'Slack webhook URL'); },
  ALERT_DISCORD_WEBHOOK_URL: (v) => { assertSafeWebhookUrl(v, 'Discord webhook URL'); },
  ALERT_LATENCY_THRESHOLD_MS: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error('Latency threshold must be a non-negative number of milliseconds.');
    }
  },
};

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

    // Decide what to write before writing anything, so a rejected value cannot
    // leave the configuration half-applied.
    const pending = [];
    const errors = [];

    for (const [key, value] of Object.entries(updates)) {
      if (!CONFIG_KEYS.includes(key)) continue;

      // A masked placeholder means the user did not touch this sensitive field.
      if (SENSITIVE_KEYS.includes(key) && typeof value === 'string' && value.includes('...')) {
        continue;
      }

      const str = value == null ? '' : String(value).trim();

      // An empty value clears the override and falls back to the environment.
      if (str !== '' && VALIDATORS[key]) {
        try {
          VALIDATORS[key](str);
        } catch (validationErr) {
          errors.push(`${key}: ${validationErr.message}`);
          continue;
        }
      }

      pending.push([key, str]);
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: {
          message: 'Some settings were rejected and nothing was saved.',
          type: 'validation_error',
          details: errors,
        }
      });
    }

    let savedCount = 0;
    for (const [key, value] of pending) {
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
