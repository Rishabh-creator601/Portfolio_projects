const fs = require('fs');
const path = require('path');
const {
  evaluateRule6,
  evaluateRule7,
  evaluateRule8,
  evaluateRule9,
  evaluateRule11,
  evaluateRule12,
  evaluateRule13
} = require('./rules');
const { evaluateSpelling } = require('./spellCheckService');
const { calculatePenalty } = require('../utils/penaltyCalculator');

const categoriesPath = path.join(__dirname, '../data/categories.json');

let cachedCategories = null;

function loadCategories() {
  if (cachedCategories) return cachedCategories;

  try {
    cachedCategories = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));
  } catch (err) {
    console.warn(`Could not load categories.json (${err.message}); using baseline rules only.`);
    cachedCategories = [];
  }

  return cachedCategories;
}

/**
 * Deterministic evaluation of one extraction against the Rules.
 *
 * Pure functions over JSON: the same input always produces the same verdicts,
 * with no model in the loop. The vision service reads and measures; everything
 * that decides compliance happens here, which is what makes a finding
 * reproducible and defensible months later.
 *
 * @param {object} extractedData  declarations, normalised
 * @param {string} rulePackVersion
 * @param {string} categoryId
 * @param {object} measurements   vision-service metrics, or the legacy
 *                                `{ isCalibrated }` shape
 */
function evaluateCompliance(extractedData, rulePackVersion, categoryId, measurements) {
  const categories = loadCategories();
  const category = categories.find((c) => c.id === categoryId) || {
    id: categoryId || 'unknown',
    whenPackedAllowed: false,
    exemptions: {}
  };

  const results = [
    ...evaluateRule6(extractedData, category),
    ...evaluateRule7(extractedData, category, measurements),
    ...evaluateRule8(extractedData, category, measurements),
    ...evaluateRule9(extractedData, category, measurements),
    ...evaluateRule11(extractedData, category),
    ...evaluateRule12(extractedData, category),
    ...evaluateRule13(extractedData),
    // Advisory: a labelling-quality signal that doubles as an OCR-quality one.
    // Carries no penalty.
    evaluateSpelling(extractedData)
  ];

  const violations = results.filter((r) => r.verdict === 'FAIL');
  const needsReview = results.filter((r) => r.verdict === 'REVIEW');
  const penalty = calculatePenalty(violations);

  return {
    results,
    violations,
    needsReview,
    penaltyExposure: penalty,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.verdict === 'PASS').length,
      failed: violations.length,
      review: needsReview.length,
      notApplicable: results.filter((r) => r.verdict === 'NOT_APPLICABLE').length,
      category: category.id,
      rulePackVersion: rulePackVersion || '1.0.0'
    }
  };
}

module.exports = { evaluateCompliance, loadCategories };
