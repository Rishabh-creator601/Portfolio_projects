const rulePack = require('../data/rulePack_v1.json');

/**
 * Rule 32 penalty exposure.
 *
 * Amounts come from the rule pack rather than being hard-coded here, so a legal
 * officer changing a penalty edits versioned JSON and does not touch code.
 */
const DEFAULT_PENALTY = 2000;

const rules = Array.isArray(rulePack) ? rulePack : rulePack.rules || [];
const PENALTY_BY_RULE = new Map(
  rules.map((rule) => [rule.id, rule.penaltyAmount != null ? rule.penaltyAmount : DEFAULT_PENALTY])
);

function penaltyFor(ruleId) {
  return PENALTY_BY_RULE.has(ruleId) ? PENALTY_BY_RULE.get(ruleId) : DEFAULT_PENALTY;
}

/**
 * Sums the penalty for the failing rules.
 *
 * Only FAIL contributes. A row reading REVIEW has not been decided, so pricing
 * it would assert a breach the system has explicitly declined to assert.
 */
function calculatePenalty(violations = []) {
  const breakdown = [];
  let total = 0;

  for (const violation of violations) {
    if (violation.verdict !== 'FAIL') continue;

    const amount = penaltyFor(violation.ruleId);
    if (amount <= 0) continue; // advisory rows such as the spelling check

    total += amount;
    breakdown.push({
      ruleId: violation.ruleId,
      penalty: amount,
      amount,
      citation: violation.citation
    });
  }

  return { total, breakdown };
}

module.exports = { calculatePenalty, penaltyFor };
