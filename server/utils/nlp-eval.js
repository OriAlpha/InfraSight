/**
 * NLP and Retrieval evaluation metrics utilities.
 *
 * @module utils/nlp-eval
 */
'use strict';

/**
 * Normalizes text by lowercasing, stripping punctuation, removing articles,
 * and normalizing whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"]/g, '') // strip punctuation
    .replace(/\b(a|an|the)\b/g, '') // strip articles (English)
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim();
}

/**
 * Calculates Exact Match (EM) score.
 * @param {string} generated
 * @param {string} expected
 * @returns {number} 1 if exact match after normalization, 0 otherwise
 */
function calculateExactMatch(generated, expected) {
  return normalizeText(generated) === normalizeText(expected) ? 1 : 0;
}

/**
 * Calculates word-level F1 score.
 * @param {string} generated
 * @param {string} expected
 * @returns {number} F1 score between 0.0 and 1.0
 */
function calculateF1(generated, expected) {
  const gTokens = normalizeText(generated).split(' ').filter(Boolean);
  const eTokens = normalizeText(expected).split(' ').filter(Boolean);
  if (gTokens.length === 0 || eTokens.length === 0) return 0;

  // Compute token overlap frequencies
  const gFreq = {};
  for (const t of gTokens) gFreq[t] = (gFreq[t] || 0) + 1;

  let overlap = 0;
  for (const t of eTokens) {
    if (gFreq[t] > 0) {
      overlap++;
      gFreq[t]--;
    }
  }

  const precision = overlap / gTokens.length;
  const recall = overlap / eTokens.length;
  if (precision + recall === 0) return 0;
  
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Helper to build n-grams from a list of tokens.
 * @param {string[]} tokens
 * @param {number} n
 * @returns {string[]}
 */
function getNGrams(tokens, n) {
  const ngrams = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/**
 * Calculates ROUGE-N recall score.
 * @param {string} generated
 * @param {string} expected
 * @param {number} n - n-gram size (1 or 2)
 * @returns {number} Recall score between 0.0 and 1.0
 */
function calculateRougeN(generated, expected, n) {
  const gTokens = normalizeText(generated).split(' ').filter(Boolean);
  const eTokens = normalizeText(expected).split(' ').filter(Boolean);
  if (gTokens.length < n || eTokens.length < n) return 0;

  const gNGrams = getNGrams(gTokens, n);
  const eNGrams = getNGrams(eTokens, n);

  const gFreq = {};
  for (const ng of gNGrams) gFreq[ng] = (gFreq[ng] || 0) + 1;

  let overlap = 0;
  for (const ng of eNGrams) {
    if (gFreq[ng] > 0) {
      overlap++;
      gFreq[ng]--;
    }
  }

  return overlap / eNGrams.length;
}

/**
 * Calculates ROUGE-L (Longest Common Subsequence) recall score.
 * @param {string} generated
 * @param {string} expected
 * @returns {number} ROUGE-L score between 0.0 and 1.0
 */
function calculateRougeL(generated, expected) {
  const gTokens = normalizeText(generated).split(' ').filter(Boolean);
  const eTokens = normalizeText(expected).split(' ').filter(Boolean);
  if (gTokens.length === 0 || eTokens.length === 0) return 0;

  // DP algorithm to find length of LCS
  const dp = Array(gTokens.length + 1).fill(0).map(() => Array(eTokens.length + 1).fill(0));
  for (let i = 1; i <= gTokens.length; i++) {
    for (let j = 1; j <= eTokens.length; j++) {
      if (gTokens[i - 1] === eTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcsLen = dp[gTokens.length][eTokens.length];
  return lcsLen / eTokens.length;
}

/**
 * Calculates BLEU score (BLEU-4 with equal weights).
 * @param {string} generated
 * @param {string} expected
 * @returns {number} BLEU score between 0.0 and 1.0
 */
function calculateBleu(generated, expected) {
  const gTokens = normalizeText(generated).split(' ').filter(Boolean);
  const eTokens = normalizeText(expected).split(' ').filter(Boolean);
  if (gTokens.length === 0 || eTokens.length === 0) return 0;

  const precisions = [];
  const weights = [0.25, 0.25, 0.25, 0.25];

  for (let n = 1; n <= 4; n++) {
    if (gTokens.length < n || eTokens.length < n) {
      precisions.push(0);
      continue;
    }
    const gNGrams = getNGrams(gTokens, n);
    const eNGrams = getNGrams(eTokens, n);

    const eFreq = {};
    for (const ng of eNGrams) eFreq[ng] = (eFreq[ng] || 0) + 1;

    let overlap = 0;
    for (const ng of gNGrams) {
      if (eFreq[ng] > 0) {
        overlap++;
        eFreq[ng]--;
      }
    }
    precisions.push(overlap / gNGrams.length);
  }

  let logSum = 0;
  let validNGramsCount = 0;
  for (let i = 0; i < precisions.length; i++) {
    if (precisions[i] > 0) {
      logSum += weights[i] * Math.log(precisions[i]);
      validNGramsCount++;
    }
  }
  if (validNGramsCount === 0) return 0;

  const geometricMean = Math.exp(logSum);

  // Brevity Penalty
  const c = gTokens.length;
  const r = eTokens.length;
  const bp = c > r ? 1.0 : Math.exp(1 - r / c);

  return bp * geometricMean;
}

/**
 * Calculates Recall@K.
 * @param {string[]|number[]} retrievedIds
 * @param {string[]|number[]} relevantIds
 * @param {number} [k] - Optional cut-off
 * @returns {number} Recall score between 0.0 and 1.0
 */
function calculateRecallAtK(retrievedIds, relevantIds, k = null) {
  if (!Array.isArray(retrievedIds) || !Array.isArray(relevantIds) || relevantIds.length === 0) return 0;
  const limit = k !== null ? Math.min(k, retrievedIds.length) : retrievedIds.length;
  const retrievedSubset = retrievedIds.slice(0, limit);
  const relevantSet = new Set(relevantIds.map(String));
  
  let matches = 0;
  for (const id of retrievedSubset) {
    if (relevantSet.has(String(id))) matches++;
  }
  return matches / relevantIds.length;
}

/**
 * Calculates Precision@K.
 * @param {string[]|number[]} retrievedIds
 * @param {string[]|number[]} relevantIds
 * @param {number} [k] - Optional cut-off
 * @returns {number} Precision score between 0.0 and 1.0
 */
function calculatePrecisionAtK(retrievedIds, relevantIds, k = null) {
  if (!Array.isArray(retrievedIds) || !Array.isArray(relevantIds) || retrievedIds.length === 0) return 0;
  const limit = k !== null ? Math.min(k, retrievedIds.length) : retrievedIds.length;
  const retrievedSubset = retrievedIds.slice(0, limit);
  const relevantSet = new Set(relevantIds.map(String));
  
  let matches = 0;
  for (const id of retrievedSubset) {
    if (relevantSet.has(String(id))) matches++;
  }
  return matches / limit;
}

/**
 * Calculates Mean Reciprocal Rank (MRR).
 * @param {string[]|number[]} retrievedIds
 * @param {string[]|number[]} relevantIds
 * @returns {number} MRR score
 */
function calculateMRR(retrievedIds, relevantIds) {
  if (!Array.isArray(retrievedIds) || !Array.isArray(relevantIds) || retrievedIds.length === 0 || relevantIds.length === 0) return 0;
  const relevantSet = new Set(relevantIds.map(String));
  
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(String(retrievedIds[i]))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Calculates all NLP alignment metrics.
 * @param {string} generated
 * @param {string} expected
 * @returns {Object}
 */
function calculateAllNLP(generated, expected) {
  if (!expected) return {};
  return {
    exact_match: calculateExactMatch(generated, expected),
    f1_score: calculateF1(generated, expected),
    rouge_1: calculateRougeN(generated, expected, 1),
    rouge_2: calculateRougeN(generated, expected, 2),
    rouge_l: calculateRougeL(generated, expected),
    bleu: calculateBleu(generated, expected),
  };
}

module.exports = {
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
};
