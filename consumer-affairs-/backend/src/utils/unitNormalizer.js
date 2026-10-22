function normalizeUnit(value, unit) {
  if (!unit) return { value, unit: null, isStandard: false };
  const u = unit.toLowerCase().trim();

  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(u)) return { value, unit: 'g', isStandard: true };
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(u)) return { value, unit: 'kg', isStandard: true };
  if (['ml', 'mls', 'millilitre', 'milliliter'].includes(u)) return { value, unit: 'ml', isStandard: true };
  if (['l', 'ltr', 'litre', 'liter'].includes(u)) return { value, unit: 'L', isStandard: true };
  if (['cm', 'cms', 'centimetre', 'centimeter'].includes(u)) return { value, unit: 'cm', isStandard: true };
  if (['m', 'meter', 'metre'].includes(u)) return { value, unit: 'm', isStandard: true };
  if (['u', 'n', 'no', 'nos', 'number', 'pieces', 'pc', 'pcs'].includes(u)) return { value, unit: 'U', isStandard: true };

  return { value, unit: u, isStandard: false };
}

function checkProhibitedUnits(unit) {
  if (!unit) return false;
  const u = unit.toLowerCase().trim();
  return ['dozen', 'score', 'gross', 'great gross'].includes(u);
}

/**
 * Rule 7 Table I is indexed by net weight in grams. Volume is treated at unit
 * density, which is how the Table is applied to liquids in practice.
 */
function toBaseGrams(value, unit) {
  const normalized = normalizeUnit(value, unit);
  if (typeof value !== 'number' || Number.isNaN(value)) return null;

  switch (normalized.unit) {
    case 'g':
    case 'ml':
      return value;
    case 'kg':
    case 'L':
      return value * 1000;
    default:
      return null;
  }
}

module.exports = {
  normalizeUnit,
  checkProhibitedUnits,
  toBaseGrams
};
