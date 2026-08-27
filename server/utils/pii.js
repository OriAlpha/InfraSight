/**
 * PII masking utility for InfraSight logs.
 *
 * Redacts emails, credit cards (Luhn-validated), phone numbers, US SSNs and
 * API-key-shaped tokens.
 *
 * NOTE: These functions are unconditional — they always mask. Whether masking
 * runs at all is decided by the caller from the resolved `MASK_PII` /
 * `ACTIVE_PII_REDACTION` configuration, so that a value set through the
 * dashboard (stored in the settings table) has the same effect as one set in
 * the environment.
 *
 * @module utils/pii
 */
'use strict';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// 13–19 digits, optionally separated by a single space or dash.
const CARD_REGEX = /\b\d(?:[ -]?\d){12,18}\b/g;
// US Social Security numbers.
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
// US-like and international phone numbers (e.g. +1 123-456-7890 or 1234567890).
// A leading \b would sit before "+", where there is no word boundary, so the
// country code would never be consumed; a lookbehind anchors the match instead.
const PHONE_REGEX = /(?<![\w+])(?:\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{4}\b/g;
// Provider API keys: OpenAI-style (sk-…), AWS access key ids.
const API_KEY_REGEX = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b|\bAKIA[0-9A-Z]{16}\b/g;

/**
 * Luhn checksum, used to avoid redacting arbitrary long digit strings
 * (order ids, timestamps, nonces) that merely look card-shaped.
 *
 * @param {string} digits - Digits only
 * @returns {boolean} True if the sequence passes the Luhn check
 */
function luhnCheck(digits) {
  if (!/^\d+$/.test(digits)) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Replaces PII with redacted placeholders in a string.
 *
 * @param {string} text
 * @returns {string} The masked text (unchanged if `text` is not a string)
 */
function maskString(text) {
  if (typeof text !== 'string' || text.length === 0) return text;

  let masked = text;

  // API keys first — they can contain substrings the later patterns match.
  masked = masked.replace(API_KEY_REGEX, '[API_KEY_REDACTED]');

  masked = masked.replace(EMAIL_REGEX, '[EMAIL_REDACTED]');

  // Cards before phones: the phone pattern would otherwise claim part of a
  // card number. Only redact sequences that actually checksum as a card.
  masked = masked.replace(CARD_REGEX, (match) => {
    const digitsOnly = match.replace(/[-\s]/g, '');
    if (digitsOnly.length >= 13 && digitsOnly.length <= 19 && luhnCheck(digitsOnly)) {
      return '[CARD_REDACTED]';
    }
    return match;
  });

  // SSNs before phones, which would otherwise match the same shape.
  masked = masked.replace(SSN_REGEX, '[SSN_REDACTED]');

  masked = masked.replace(PHONE_REGEX, (match) => {
    const digitsOnly = match.replace(/[-\s().+]/g, '');
    // Don't redact short ids or oversized digit runs.
    if (digitsOnly.length >= 7 && digitsOnly.length <= 15 && /^\d+$/.test(digitsOnly)) {
      return '[PHONE_REDACTED]';
    }
    return match;
  });

  return masked;
}

/**
 * Recursively traverses a value and masks every string it contains.
 *
 * Object keys are left untouched; only values are rewritten.
 *
 * @param {*} val
 * @returns {*} A masked copy of the value
 */
function maskPii(val) {
  if (typeof val === 'string') {
    return maskString(val);
  }

  if (Array.isArray(val)) {
    return val.map(maskPii);
  }

  if (val !== null && typeof val === 'object') {
    const maskedObj = {};
    for (const key of Object.keys(val)) {
      maskedObj[key] = maskPii(val[key]);
    }
    return maskedObj;
  }

  return val;
}

module.exports = {
  maskPii,
  maskString,
  luhnCheck,
};
