'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeText,
  calculateExactMatch,
  calculateF1,
  calculateRougeN,
  calculateRougeL,
  calculateBleu,
  calculateRecallAtK,
  calculatePrecisionAtK,
  calculateMRR,
  calculateAllNLP,
} = require('../utils/nlp-eval');

test('nlp-eval: normalizeText lowercases and removes punctuation and articles', () => {
  assert.equal(normalizeText('The Quick, Brown Fox!'), 'quick brown fox');
  assert.equal(normalizeText(''), '');
  assert.equal(normalizeText(null), '');
});

test('nlp-eval: calculateExactMatch', () => {
  assert.equal(calculateExactMatch('The Paris', 'Paris'), 1);
  assert.equal(calculateExactMatch('London', 'Paris'), 0);
});

test('nlp-eval: calculateF1 word overlap', () => {
  assert.equal(calculateF1('blue sky', 'blue sky'), 1.0);
  assert.equal(Math.round(calculateF1('blue sky', 'clear blue sunny sky') * 100) / 100, 0.67);
  assert.equal(calculateF1('', 'non empty'), 0);
});

test('nlp-eval: calculateRougeN and calculateRougeL', () => {
  const gen = 'the cat sat on the mat';
  const ref = 'the cat was on the mat';

  const r1 = calculateRougeN(gen, ref, 1);
  assert.ok(r1 > 0.5);

  const rl = calculateRougeL(gen, ref);
  assert.ok(rl > 0.5);
});

test('nlp-eval: calculateBleu score', () => {
  const gen = 'the quick brown fox jumped over lazy dog';
  const ref = 'the quick brown fox jumps over the lazy dog';

  const score = calculateBleu(gen, ref);
  assert.ok(score > 0);
  assert.equal(calculateBleu('', 'target'), 0);
});

test('nlp-eval: calculateRecallAtK, calculatePrecisionAtK, and calculateMRR', () => {
  const retrieved = ['doc-1', 'doc-2', 'doc-3', 'doc-4'];
  const relevant = ['doc-2', 'doc-5'];

  // Recall@K
  const recall2 = calculateRecallAtK(retrieved, relevant, 2);
  assert.equal(recall2, 0.5); // doc-2 matched out of 2 relevant

  // Precision@K
  const prec2 = calculatePrecisionAtK(retrieved, relevant, 2);
  assert.equal(prec2, 0.5); // 1 relevant out of top 2

  // MRR: doc-2 is at index 1 (rank 2) => 1/2 = 0.5
  const mrr = calculateMRR(retrieved, relevant);
  assert.equal(mrr, 0.5);

  assert.equal(calculateMRR([], relevant), 0);
  assert.equal(calculateMRR(retrieved, ['doc-999']), 0);
});

test('nlp-eval: calculateAllNLP computes complete bundle', () => {
  const all = calculateAllNLP('Paris is beautiful today', 'Paris is beautiful always');
  assert.ok(all.exact_match !== undefined);
  assert.ok(all.f1_score > 0);
  assert.ok(all.rouge_1 > 0);
  assert.ok(all.rouge_2 > 0);
  assert.ok(all.rouge_l > 0);
  assert.ok(all.bleu > 0);

  assert.deepEqual(calculateAllNLP('text', ''), {});
});
