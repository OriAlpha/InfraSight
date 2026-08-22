'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { maskString, maskPii, luhnCheck } = require('../utils/pii');

test('luhnCheck accepts valid card numbers and rejects arbitrary digits', () => {
  assert.equal(luhnCheck('4242424242424242'), true);
  assert.equal(luhnCheck('4111111111111111'), true);
  assert.equal(luhnCheck('1234567890123456'), false);
  assert.equal(luhnCheck('not-a-number'), false);
});

test('maskString redacts email addresses', () => {
  assert.equal(
    maskString('write to alice.smith+tag@example.co.uk please'),
    'write to [EMAIL_REDACTED] please'
  );
});

test('maskString redacts Luhn-valid cards with common separators', () => {
  assert.equal(maskString('card 4242424242424242'), 'card [CARD_REDACTED]');
  assert.equal(maskString('card 4242-4242-4242-4242'), 'card [CARD_REDACTED]');
  assert.equal(maskString('card 4242 4242 4242 4242'), 'card [CARD_REDACTED]');
});

test('maskString leaves card-shaped digit runs that fail Luhn alone', () => {
  // Order ids, nonces and timestamps must survive masking intact.
  const text = 'order 1234567890123456 shipped';
  assert.equal(maskString(text), text);
});

test('maskString redacts SSNs before treating them as phone numbers', () => {
  assert.equal(maskString('ssn 123-45-6789'), 'ssn [SSN_REDACTED]');
});

test('maskString redacts phone numbers', () => {
  assert.equal(maskString('call +1 415-555-0132 now'), 'call [PHONE_REDACTED] now');
});

test('maskString redacts provider API keys', () => {
  assert.equal(
    maskString('key sk-abcdefghijklmnopqrstuvwx here'),
    'key [API_KEY_REDACTED] here'
  );
  assert.equal(
    maskString('aws AKIAIOSFODNN7EXAMPLE key'),
    'aws [API_KEY_REDACTED] key'
  );
});

test('maskString leaves short numeric ids untouched', () => {
  assert.equal(maskString('item 42 of 1234'), 'item 42 of 1234');
});

test('maskPii masks nested structures and preserves shape', () => {
  const input = {
    messages: [
      { role: 'user', content: 'reach me at bob@example.com' },
      { role: 'assistant', content: 'noted' },
    ],
    count: 2,
    flagged: false,
    missing: null,
  };

  const masked = maskPii(input);

  assert.equal(masked.messages[0].content, 'reach me at [EMAIL_REDACTED]');
  assert.equal(masked.messages[1].content, 'noted');
  assert.equal(masked.count, 2);
  assert.equal(masked.flagged, false);
  assert.equal(masked.missing, null);
  // Original must not be mutated.
  assert.equal(input.messages[0].content, 'reach me at bob@example.com');
});

test('maskPii does not depend on process.env.MASK_PII', () => {
  const previous = process.env.MASK_PII;
  delete process.env.MASK_PII;
  try {
    assert.equal(maskPii('mail me: dev@example.com'), 'mail me: [EMAIL_REDACTED]');
  } finally {
    if (previous === undefined) delete process.env.MASK_PII;
    else process.env.MASK_PII = previous;
  }
});
