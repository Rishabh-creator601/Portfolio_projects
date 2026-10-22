/**
 * Spelling check over the product description and declaration text.
 *
 * Two jobs, per the rule validation matrix:
 *   1. a labelling-quality signal on the description itself;
 *   2. an OCR-quality signal -- a cluster of short nonsense words is far more
 *      likely to be a bad read than a manufacturer who cannot spell.
 *
 * It carries no penalty. Misspelling a description is not an offence under the
 * Rules, so this reports as a minor advisory and never contributes to the
 * Rule 32 penalty exposure.
 */

// A general English dictionary would flag half the words on an Indian food
// pack. The lexicon below is the statutory and commodity vocabulary the
// declarations actually use; anything outside it is reported as unrecognised
// rather than as definitely wrong.
const STATUTORY_TERMS = [
  'maximum', 'retail', 'price', 'mrp', 'inclusive', 'incl', 'all', 'taxes', 'tax',
  'net', 'weight', 'wt', 'quantity', 'qty', 'volume', 'vol', 'gross',
  'manufactured', 'manufacture', 'manufacturer', 'packed', 'packer', 'packaged',
  'imported', 'importer', 'marketed', 'marketer', 'by', 'for', 'at',
  'month', 'year', 'date', 'mfg', 'mfd', 'pkd', 'exp', 'expiry', 'best', 'before', 'use',
  'consumer', 'care', 'customer', 'complaint', 'complaints', 'contact', 'helpline', 'toll', 'free',
  'address', 'email', 'phone', 'telephone', 'website', 'www',
  'batch', 'code', 'lot', 'serial', 'number', 'no', 'nos',
  'when', 'packed', 'minimum', 'average', 'approximately', 'about',
  'ingredients', 'nutritional', 'information', 'allergen', 'contains', 'storage', 'store',
  'cool', 'dry', 'place', 'away', 'from', 'direct', 'sunlight', 'refrigerate', 'after', 'opening',
  'vegetarian', 'non', 'veg', 'fssai', 'licence', 'license',
  'india', 'indian', 'made', 'product', 'of', 'origin', 'country'
];

const UNITS = [
  'g', 'gm', 'gms', 'gram', 'grams', 'kg', 'kgs', 'kilogram', 'kilograms',
  'ml', 'millilitre', 'milliliter', 'l', 'ltr', 'litre', 'liter', 'litres', 'liters',
  'cm', 'centimetre', 'centimeter', 'm', 'metre', 'meter', 'mm',
  'pc', 'pcs', 'piece', 'pieces', 'unit', 'units', 'pack', 'packs', 'packet', 'sachet'
];

const CURRENCY = ['rs', 'rupees', 'rupee', 'inr', 'paise'];

const COMMODITIES = [
  'biscuit', 'biscuits', 'bread', 'butter', 'cheese', 'milk', 'curd', 'ghee', 'paneer',
  'tea', 'coffee', 'sugar', 'salt', 'rice', 'wheat', 'flour', 'atta', 'maida', 'suji', 'rava',
  'dal', 'pulses', 'oil', 'refined', 'sunflower', 'mustard', 'groundnut', 'coconut', 'olive',
  'vanaspati', 'noodles', 'pasta', 'chips', 'namkeen', 'snacks', 'chocolate', 'candy', 'sweets',
  'jam', 'honey', 'sauce', 'ketchup', 'pickle', 'masala', 'spices', 'turmeric', 'chilli',
  'soap', 'detergent', 'shampoo', 'conditioner', 'lotion', 'cream', 'powder', 'paste',
  'toothpaste', 'perfume', 'deodorant', 'sanitizer', 'handwash', 'cosmetic', 'cosmetics',
  'water', 'juice', 'beverage', 'drink', 'soda', 'cement', 'fertiliser', 'fertilizer',
  'bidi', 'incense', 'agarbatti', 'paint', 'varnish', 'yarn', 'garment', 'garments'
];

// Company forms and address words. Flagging "Pvt Ltd" on every Indian pack
// would train an officer to ignore the advisory entirely.
const ENTITY_TERMS = [
  'pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'co', 'corp', 'corporation',
  'company', 'industries', 'enterprises', 'foods', 'products', 'brands', 'group',
  'works', 'mills', 'traders', 'agencies', 'exports', 'imports', 'international',
  'road', 'street', 'lane', 'marg', 'nagar', 'colony', 'sector', 'phase', 'plot',
  'block', 'floor', 'building', 'estate', 'industrial', 'area', 'park', 'town',
  'city', 'district', 'state', 'pin', 'post', 'village', 'taluka', 'tehsil',
  'delhi', 'mumbai', 'kolkata', 'chennai', 'bengaluru', 'bangalore', 'hyderabad',
  'pune', 'ahmedabad', 'surat', 'jaipur', 'lucknow', 'kanpur', 'nagpur', 'indore'
];

const DESCRIPTORS = [
  'fresh', 'pure', 'natural', 'organic', 'premium', 'classic', 'original', 'special',
  'gold', 'silver', 'royal', 'super', 'extra', 'double', 'rich', 'creamy', 'crispy', 'crunchy',
  'sweet', 'salted', 'roasted', 'fried', 'baked', 'instant', 'ready', 'eat', 'cook',
  'new', 'improved', 'value', 'family', 'economy', 'jumbo', 'mini', 'small', 'large', 'medium'
];

const LEXICON = new Set(
  [...STATUTORY_TERMS, ...UNITS, ...CURRENCY, ...COMMODITIES, ...DESCRIPTORS, ...ENTITY_TERMS].map((w) =>
    w.toLowerCase()
  )
);

/**
 * Words commonly mangled on packs or by OCR, mapped to the correct spelling.
 * Each is a real substitution seen on Indian retail packaging.
 */
const KNOWN_CORRECTIONS = {
  maximam: 'maximum',
  maximun: 'maximum',
  maxinum: 'maximum',
  retial: 'retail',
  retall: 'retail',
  pirce: 'price',
  prlce: 'price',
  inclusiv: 'inclusive',
  inclusve: 'inclusive',
  taxs: 'taxes',
  taxess: 'taxes',
  quantiy: 'quantity',
  quantitiy: 'quantity',
  quntity: 'quantity',
  weigth: 'weight',
  wieght: 'weight',
  manufactered: 'manufactured',
  manufactureed: 'manufactured',
  manufacutred: 'manufactured',
  manufaturer: 'manufacturer',
  pakced: 'packed',
  packd: 'packed',
  consumor: 'consumer',
  consumar: 'consumer',
  custmer: 'customer',
  adress: 'address',
  addres: 'address',
  telephon: 'telephone',
  ingridients: 'ingredients',
  ingredents: 'ingredients',
  vegitarian: 'vegetarian',
  storege: 'storage',
  bisciut: 'biscuit',
  bisuits: 'biscuits',
  choclate: 'chocolate',
  chocalate: 'chocolate'
};

const MIN_WORD_LENGTH = 3;

/** Levenshtein distance, capped for speed -- only short edits are of interest. */
function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }

    if (rowMin > max) return max + 1;
    previous = current;
  }

  return previous[b.length];
}

/**
 * How far a candidate may be from the word and still be a plausible correction.
 *
 * Scaled to the word, because a flat distance of 2 is meaningless on a short
 * one: "plq" is two edits from "ml", which is no use to anybody. Requiring a
 * closer match on short words is also what lets isLikelyOCRError tell garbage
 * apart from a real misspelling.
 */
function maxDistanceFor(word) {
  if (word.length <= 4) return 1;
  if (word.length <= 7) return 2;
  return 3;
}

function suggest(word, limit = 3) {
  if (KNOWN_CORRECTIONS[word]) return [KNOWN_CORRECTIONS[word]];

  const max = maxDistanceFor(word);
  const scored = [];

  for (const candidate of LEXICON) {
    // A candidate much shorter than the word is not a correction of it.
    if (Math.abs(candidate.length - word.length) > max) continue;

    const distance = editDistance(word, candidate, max);
    if (distance <= max) scored.push({ candidate, distance });
  }

  return scored
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((s) => s.candidate);
}

/**
 * Check a block of text.
 *
 * Returns the misspellings with suggestions, a 0-1 quality score, and whether
 * the pattern looks like an OCR failure rather than a labelling error.
 */
function checkSpelling(text) {
  if (!text || typeof text !== 'string') {
    return { misspellings: [], score: 1, checkedWords: 0, likelyOCRError: false };
  }

  const words = text
    .split(/\s+/)
    .map((word, index) => ({ raw: word, index, clean: word.replace(/[^a-zA-Z]/g, '').toLowerCase() }))
    .filter((w) => w.clean.length >= MIN_WORD_LENGTH);

  const misspellings = [];

  for (const word of words) {
    if (LEXICON.has(word.clean)) continue;

    const correction = KNOWN_CORRECTIONS[word.clean];
    const suggestions = correction ? [correction] : suggest(word.clean);

    misspellings.push({
      word: word.clean,
      original: word.raw,
      position: word.index,
      suggestions,
      // A near-miss of a known term is a probable misspelling; a word with no
      // near neighbour is more likely a brand name than an error.
      certainty: correction ? 'high' : suggestions.length > 0 ? 'medium' : 'low'
    });
  }

  const confident = misspellings.filter((m) => m.certainty !== 'low');
  const score = words.length > 0 ? (words.length - confident.length) / words.length : 1;

  return {
    misspellings,
    score: Number(score.toFixed(3)),
    checkedWords: words.length,
    likelyOCRError: isLikelyOCRError(misspellings)
  };
}

/**
 * A cluster of short unrecognised words with no plausible correction is the
 * signature of a bad OCR read, not of bad spelling.
 */
function isLikelyOCRError(misspellings) {
  if (misspellings.length < 3) return false;

  const shortAndUnplaceable = misspellings.filter(
    (m) => m.word.length <= 5 && m.suggestions.length === 0
  );

  return shortAndUnplaceable.length >= 3 && shortAndUnplaceable.length / misspellings.length > 0.5;
}

/**
 * The SPELL row for the compliance checklist.
 *
 * Advisory only: severity minor, no penalty, and it never fails an inspection.
 */
function evaluateSpelling(extracted = {}) {
  const parts = [
    extracted.genericName,
    extracted.manufacturer && extracted.manufacturer.name,
    extracted.manufacturer && extracted.manufacturer.address,
    extracted.description,
    extracted.rawText
  ].filter((p) => typeof p === 'string' && p.trim());

  const text = parts.join(' ');
  const result = checkSpelling(text);

  if (result.checkedWords === 0) {
    return {
      ruleId: 'SPELL',
      citation: 'Advisory',
      check: 'Description spelling',
      found: 'No description text to check',
      required: 'Legible, correctly spelled descriptive text',
      verdict: 'NOT_APPLICABLE',
      confidence: 'HIGH',
      note: 'Advisory only; carries no penalty under the Rules.',
      spellCheck: result
    };
  }

  const confident = result.misspellings.filter((m) => m.certainty === 'high');

  let verdict = 'PASS';
  let note = 'Advisory only; carries no penalty under the Rules.';

  if (result.likelyOCRError) {
    verdict = 'REVIEW';
    note =
      'A cluster of unreadable words suggests a poor OCR read rather than a labelling ' +
      'error. Re-capture the panel or correct the tokens before relying on this extraction.';
  } else if (confident.length > 0) {
    verdict = 'REVIEW';
    note =
      `${confident.length} probable misspelling(s) in the description. Advisory only; ` +
      'carries no penalty under the Rules.';
  }

  return {
    ruleId: 'SPELL',
    citation: 'Advisory',
    check: 'Description spelling',
    found:
      result.misspellings.length > 0
        ? `${result.misspellings.length} unrecognised word(s): ${result.misspellings
            .slice(0, 5)
            .map((m) => m.word)
            .join(', ')}`
        : `${result.checkedWords} words checked, none unrecognised`,
    required: 'Legible, correctly spelled descriptive text',
    verdict,
    confidence: result.score > 0.9 ? 'HIGH' : 'MEDIUM',
    measuredValue: `${(result.score * 100).toFixed(0)}% recognised`,
    note,
    spellCheck: result
  };
}

module.exports = { checkSpelling, isLikelyOCRError, evaluateSpelling, suggest, LEXICON };
