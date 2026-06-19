/**
 * PII Masking utility for InfraSight logs.
 * Redacts emails, credit cards, and phone numbers from logs if MASK_PII is enabled.
 */
'use strict';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Matches US-like phone numbers and international phone numbers (e.g. +1 123-456-7890 or 1234567890)
const PHONE_REGEX = /\b(?:\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{4}\b/g;
// Matches standard 13-19 digit card numbers with potential space or dash separators
const CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

/**
 * Replaces PII with redacted placeholders in a string.
 * @param {string} text
 * @returns {string}
 */
function maskString(text) {
  if (typeof text !== 'string') return text;

  let masked = text;
  
  // Mask emails
  masked = masked.replace(EMAIL_REGEX, '[EMAIL_REDACTED]');
  
  // Mask credit cards
  masked = masked.replace(CARD_REGEX, (match) => {
    // Only redact if it contains mostly digits and looks like a card
    const digitsOnly = match.replace(/[-\s]/g, '');
    if (digitsOnly.length >= 13 && digitsOnly.length <= 19 && !isNaN(Number(digitsOnly))) {
      return '[CARD_REDACTED]';
    }
    return match;
  });

  // Mask phone numbers (avoid masking simple integers/IDs)
  masked = masked.replace(PHONE_REGEX, (match) => {
    const digitsOnly = match.replace(/[-\s().+]/g, '');
    // Ensure we don't accidentally redact standard 4-8 digit IDs/numbers
    if (digitsOnly.length >= 7 && digitsOnly.length <= 15 && !isNaN(Number(digitsOnly))) {
      return '[PHONE_REDACTED]';
    }
    return match;
  });

  return masked;
}

/**
 * Recursively traverses a value and masks any string fields if MASK_PII env is enabled.
 * @param {*} val
 * @returns {*}
 */
function maskPii(val) {
  // Only mask PII when explicitly enabled in environment
  if (process.env.MASK_PII !== 'true') {
    return val;
  }

  if (typeof val === 'string') {
    return maskString(val);
  }

  if (Array.isArray(val)) {
    return val.map(maskPii);
  }

  if (val !== null && typeof val === 'object') {
    const maskedObj = {};
    for (const key of Object.keys(val)) {
      // Avoid masking raw requests/responses if they are objects, but actually we DO want to mask them.
      // However, we must be careful not to corrupt structured fields. Recursion handles it.
      maskedObj[key] = maskPii(val[key]);
    }
    return maskedObj;
  }

  return val;
}

module.exports = {
  maskPii,
  maskString
};
