/**
 * Dynamic configuration provider for InfraSight.
 * Reads config values from database settings first, falling back to environment variables.
 * Uses an in-memory cache to prevent database query overhead on hot paths.
 *
 * @module utils/config
 */
'use strict';

const db = require('../db');

/** @type {Object<string, string>} */
const CACHE = {};

/**
 * Retrieves a configuration value by key.
 * Checks the dynamic settings database first, then environment variables.
 *
 * @param {string} key
 * @returns {Promise<string>} The configuration value
 */
async function getConfig(key) {
  // Check memory cache
  if (CACHE[key] !== undefined) {
    return CACHE[key];
  }

  try {
    const val = await db.getSetting(key);
    if (val !== null && val !== undefined) {
      CACHE[key] = val;
      return val;
    }
  } catch (err) {
    // Silent fail, fallback to env
  }

  // Environment fallback
  const envVal = process.env[key];
  if (envVal !== undefined) {
    CACHE[key] = envVal;
    return envVal;
  }

  return '';
}

/**
 * Saves a configuration value and updates the memory cache.
 *
 * @param {string} key
 * @param {string} value
 * @returns {Promise<boolean>} Success
 */
async function setConfig(key, value) {
  try {
    const valStr = value != null ? String(value) : '';
    const success = await db.setSetting(key, valStr);
    if (success) {
      CACHE[key] = valStr;
      return true;
    }
  } catch (err) {
    console.error(`[config] Failed to save setting "${key}":`, err.message);
  }
  return false;
}

/**
 * Clears the configuration cache.
 */
function clearCache() {
  for (const k in CACHE) {
    delete CACHE[k];
  }
}

module.exports = {
  getConfig,
  setConfig,
  clearCache
};
