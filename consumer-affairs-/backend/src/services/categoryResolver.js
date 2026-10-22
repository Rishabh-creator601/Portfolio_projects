const { loadCategories } = require('./ruleEngine');

/**
 * Resolves a product category from the extracted generic name.
 *
 * The category is what decides which exemptions apply, so getting it wrong
 * changes the verdict: date marking on a soft drink is governed by FSSAI, a
 * bidi pack owes neither a date nor an MRP, and a cosmetic falls under the
 * Drugs and Cosmetics Rules. Section 4 of the PCR checklist carves the baseline
 * up this way.
 *
 * This is lexicon matching over a name a human can read, not a trained
 * classifier. The categories are legal, not visual -- a bidi pack and a biscuit
 * pack look alike and differ only in which rules reach them -- so a classifier
 * would be guessing at something the label already states.
 */

// Keyword -> category id. Ordered most specific first within each group, since
// the first match wins and "milk powder" must beat "milk".
const KEYWORD_MAP = [
  // --- 4.1 Food ---
  ['baby food', 'baby_food'],
  ['infant', 'baby_food'],
  ['weaning', 'baby_food'],
  ['milk powder', 'milk_powder'],
  ['biscuit', 'biscuits_bread'],
  ['cookie', 'biscuits_bread'],
  ['bread', 'biscuits_bread'],
  ['rusk', 'biscuits_bread'],
  ['bakery', 'biscuits_bread'],
  ['atta', 'cereals_pulses'],
  ['maida', 'cereals_pulses'],
  ['suji', 'cereals_pulses'],
  ['rawa', 'cereals_pulses'],
  ['flour', 'cereals_pulses'],
  ['rice', 'cereals_pulses'],
  ['wheat', 'cereals_pulses'],
  ['pulses', 'cereals_pulses'],
  ['dal', 'cereals_pulses'],
  ['tea', 'tea_coffee'],
  ['coffee', 'tea_coffee'],
  ['edible oil', 'edible_oil'],
  ['sunflower oil', 'edible_oil'],
  ['mustard oil', 'edible_oil'],
  ['groundnut oil', 'edible_oil'],
  ['vanaspati', 'edible_oil'],
  ['ghee', 'edible_oil'],
  ['butter oil', 'edible_oil'],
  ['salt', 'salt'],
  ['carbonated', 'aerated_beverage'],
  ['aerated', 'aerated_beverage'],
  ['soft drink', 'aerated_beverage'],
  ['cola', 'aerated_beverage'],
  ['soda', 'aerated_beverage'],
  ['energy drink', 'aerated_beverage'],
  ['fruit drink', 'aerated_beverage'],
  ['juice', 'aerated_beverage'],
  ['packaged drinking water', 'packaged_water'],
  ['mineral water', 'packaged_water'],
  ['drinking water', 'packaged_water'],
  ['whisky', 'alcoholic_beverage'],
  ['rum', 'alcoholic_beverage'],
  ['vodka', 'alcoholic_beverage'],
  ['beer', 'alcoholic_beverage'],
  ['wine', 'alcoholic_beverage'],
  ['liquor', 'alcoholic_beverage'],
  ['curd', 'curd_sweets_sauces'],
  ['yoghurt', 'curd_sweets_sauces'],
  ['yogurt', 'curd_sweets_sauces'],
  ['honey', 'curd_sweets_sauces'],
  ['syrup', 'curd_sweets_sauces'],
  ['sauce', 'curd_sweets_sauces'],
  ['ketchup', 'curd_sweets_sauces'],
  ['jam', 'curd_sweets_sauces'],
  ['rasgulla', 'curd_sweets_sauces'],
  ['gulab jamun', 'curd_sweets_sauces'],
  ['ice cream', 'ice_cream'],
  ['frozen dessert', 'ice_cream'],

  // --- 4.2 Chemical and cosmetic ---
  ['shampoo', 'cosmetics'],
  ['conditioner', 'cosmetics'],
  ['lotion', 'cosmetics'],
  ['perfume', 'cosmetics'],
  ['deodorant', 'cosmetics'],
  ['face cream', 'cosmetics'],
  ['cosmetic', 'cosmetics'],
  ['toilet soap', 'toilet_soap'],
  ['bathing bar', 'toilet_soap'],
  ['bath soap', 'toilet_soap'],
  ['laundry soap', 'toilet_soap'],
  ['detergent cake', 'toilet_soap'],
  ['detergent powder', 'detergent_powder'],
  ['detergent', 'detergent_powder'],
  ['aerosol', 'aerosols_chemicals'],
  ['acid', 'aerosols_chemicals'],
  ['liquid chemical', 'aerosols_chemicals'],
  ['lpg', 'lpg_cylinder'],
  ['liquefied petroleum', 'lpg_cylinder'],
  ['paint', 'paints_varnishes'],
  ['varnish', 'paints_varnishes'],
  ['enamel', 'paints_varnishes'],

  // --- 4.3 Engineering and textile ---
  ['garment', 'ready_made_garments'],
  ['shirt', 'ready_made_garments'],
  ['trouser', 'ready_made_garments'],
  ['saree', 'textiles_by_piece'],
  ['fabric', 'textiles_by_piece'],
  ['textile', 'textiles_by_piece'],
  ['cement', 'cement_fertiliser'],
  ['fertiliser', 'cement_fertiliser'],
  ['fertilizer', 'cement_fertiliser'],

  // --- 4.4 Special ---
  ['bidi', 'bidi'],
  ['beedi', 'bidi'],
  ['incense', 'bidi'],
  ['agarbatti', 'bidi'],
  ['seed', 'seeds']
];

/**
 * Resolve a category from the generic name, brand and any other label text.
 *
 * Returns the matched id plus how it was matched, because an officer reviewing
 * a verdict should be able to see why a particular exemption was applied.
 */
function resolveCategory({ genericName, brandName, extraText = '', explicitCategory } = {}) {
  const categories = loadCategories();
  const known = new Set(categories.map((c) => c.id));

  // An explicit category always wins: an officer or a product record beats a
  // keyword guess.
  if (explicitCategory && known.has(explicitCategory)) {
    return { categoryId: explicitCategory, matchedOn: 'explicit', confidence: 'HIGH' };
  }

  const haystack = [genericName, brandName, extraText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!haystack.trim()) {
    return {
      categoryId: 'unknown',
      matchedOn: null,
      confidence: 'LOW',
      note: 'No generic name was read, so no category exemptions could be applied.'
    };
  }

  for (const [keyword, categoryId] of KEYWORD_MAP) {
    if (!haystack.includes(keyword)) continue;

    // Only claim a category the rule pack actually knows about; otherwise the
    // exemption lookup silently falls through to the baseline.
    if (!known.has(categoryId)) {
      return {
        categoryId: 'unknown',
        matchedOn: keyword,
        confidence: 'LOW',
        note:
          `"${keyword}" points to category "${categoryId}", which is not yet in ` +
          'categories.json. The baseline rules were applied instead.'
      };
    }

    return {
      categoryId,
      matchedOn: keyword,
      // A keyword match on the generic name is good evidence, not proof: the
      // officer can override it.
      confidence: genericName && genericName.toLowerCase().includes(keyword) ? 'HIGH' : 'MEDIUM'
    };
  }

  return {
    categoryId: 'unknown',
    matchedOn: null,
    confidence: 'LOW',
    note:
      `No category matched "${genericName || 'the extracted text'}". The baseline ` +
      'declarations were checked without category exemptions.'
  };
}

module.exports = { resolveCategory, KEYWORD_MAP };
