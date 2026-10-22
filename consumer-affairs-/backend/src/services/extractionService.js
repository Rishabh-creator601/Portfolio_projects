/**
 * Maps raw OCR tokens onto the 6 statutory declaration heads.
 */
const { toBaseGrams } = require('../utils/unitNormalizer');

const extractDeclarations = (ocrTokens) => {
  const result = {
    manufacturer: { name: null, address: null, qualifier: null, confidence: 0 },
    genericName: { value: null, confidence: 0 },
    netQuantity: { value: null, unit: null, raw: null, confidence: 0 },
    monthYear: { month: null, year: null, raw: null, confidence: 0 },
    mrp: { value: null, wording: null, raw: null, confidence: 0 },
    consumerCare: { name: null, address: null, phone: null, email: null, confidence: 0 },
    dimensions: { value: null, confidence: 0 },
    additionalInfo: []
  };

  const tokens = Array.isArray(ocrTokens) ? ocrTokens : [];
  const fullText = tokens.map((t) => t.text).join(' ');

  // 1. Manufacturer
  const mfgMatch = fullText.match(
    /(?:manufactured by|mfg by|packed by|imported by|mktd by|marketed by)[:\s]+([^.0-9]+(?:\d{1,6}[^.0-9]+)?)/i
  );
  if (mfgMatch) {
    result.manufacturer.qualifier = mfgMatch[0].split(' ')[0].toLowerCase();
    result.manufacturer.name = mfgMatch[1].trim();
    result.manufacturer.confidence = 0.85;
  }

  // An address line is recognised by a PIN code, which is mandatory on Indian packs.
  const addressMatch = fullText.match(/([^,]*(?:,[^,]*){0,3},?\s*\d{6})\b/);
  if (addressMatch) {
    result.manufacturer.address = addressMatch[1].trim();
    if (!result.manufacturer.confidence) result.manufacturer.confidence = 0.7;
  }

  // 2. Generic Name (simple heuristic rejecting brand names)
  const commodityKeywords = [
    'biscuits', 'soap', 'shampoo', 'rice', 'wheat', 'oil', 'flour', 'tea', 'coffee',
    'salt', 'sugar', 'noodles', 'butter', 'milk', 'atta', 'chips', 'water'
  ];
  const genericMatch = tokens.find((t) =>
    commodityKeywords.some((kw) => String(t.text).toLowerCase().includes(kw))
  );
  if (genericMatch) {
    result.genericName.value = genericMatch.text;
    result.genericName.confidence = genericMatch.confidence || 0.9;
  }

  // 3. Net Quantity
  const netQtyMatch = fullText.match(
    /(?:net wt|net weight|net quantity|net vol|volume|qty|net)\.?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|liter|litre|oz)s?/i
  );
  if (netQtyMatch) {
    result.netQuantity.raw = netQtyMatch[0];
    result.netQuantity.value = parseFloat(netQtyMatch[1]);
    result.netQuantity.unit = netQtyMatch[2].toLowerCase();
    result.netQuantity.confidence = 0.95;
  }
  result.netQuantity.hasWhenPackedQualifier = /when packed/i.test(fullText);

  // 4. Month/Year
  const dateMatch = fullText.match(
    /\b(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}|\d{2}\/\d{4}|\d{2}-\d{4})\b/i
  );
  if (dateMatch) {
    result.monthYear.raw = dateMatch[0];
    result.monthYear.confidence = 0.9;
    const parts = dateMatch[0].split(/[\/\-\s]/);
    if (parts.length >= 2) {
      result.monthYear.year = parts[parts.length - 1];
      result.monthYear.month = parts[0];
    }
  }

  // 5. MRP
  const mrpMatch = fullText.match(
    /(?:mrp|maximum retail price)[^0-9₹]*(?:rs\.?|₹|inr)?\s*[:\-]?\s*(\d+(?:\.\d{1,2})?)(?:\s*(?:incl\.?|inclusive)[^.]*taxes)?/i
  );
  if (mrpMatch) {
    result.mrp.raw = mrpMatch[0];
    result.mrp.wording = mrpMatch[0];
    result.mrp.value = parseFloat(mrpMatch[1]);
    result.mrp.confidence = 0.92;
  }

  // 6. Consumer Care
  const phoneMatch = fullText.match(/\b(?:1800[\s-]?\d{3}[\s-]?\d{4}|\d{10,11})\b/);
  const emailMatch = fullText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  const careMatch = fullText.match(/consumer care[^:]*:?\s*([^|]{0,80})/i);
  if (phoneMatch || emailMatch || careMatch) {
    result.consumerCare.name = careMatch ? 'Consumer Care Cell' : null;
    result.consumerCare.phone = phoneMatch ? phoneMatch[0] : null;
    result.consumerCare.email = emailMatch ? emailMatch[0] : null;
    result.consumerCare.address = result.manufacturer.address;
    result.consumerCare.confidence = 0.88;
  }

  result.rawText = fullText;

  // Rule 9(4) works on the scripts present across the declaration block. The
  // OCR engines tag each token; where they have not, detect it here.
  const scripts = new Set();
  for (const token of tokens) {
    const script = token.script || detectScript(String(token.text || ''));
    if (script && script !== 'Other') {
      script.split('+').forEach((s) => scripts.add(s));
    }
  }
  result.detectedScripts = [...scripts];
  result.tokenConfidences = tokens
    .map((t) => t.confidence)
    .filter((c) => typeof c === 'number');

  return result;
};

/** Rule 9(4) permits Hindi in Devanagari script or English. */
const detectScript = (text) => {
  const hasDevanagari = /[ऀ-ॿ]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);

  if (hasDevanagari && hasLatin) return 'Devanagari+Latin';
  if (hasDevanagari) return 'Devanagari';
  if (hasLatin) return 'Latin';
  return 'Other';
};

/**
 * Flattens the extractor output into the shape the Inspection schema stores.
 *
 * `context` carries what the extractor cannot know by itself: the officer's
 * capture answers (which panel, whether the pack is moulded) and the vision
 * service's physical measurements.
 */
const toInspectionExtracted = (extraction, context = {}) => ({
  manufacturer: {
    name: extraction.manufacturer.name,
    address: extraction.manufacturer.address,
    qualifier: extraction.manufacturer.qualifier
  },
  genericName: extraction.genericName.value,
  netQuantity: {
    value: extraction.netQuantity.value,
    unit: extraction.netQuantity.unit,
    raw: extraction.netQuantity.raw
  },
  monthYear: {
    month: extraction.monthYear.month,
    year: extraction.monthYear.year,
    raw: extraction.monthYear.raw
  },
  mrp: {
    value: extraction.mrp.value,
    wording: extraction.mrp.wording,
    raw: extraction.mrp.raw
  },
  consumerCare: {
    name: extraction.consumerCare.name,
    address: extraction.consumerCare.address,
    phone: extraction.consumerCare.phone,
    email: extraction.consumerCare.email
  },
  additionalInfo: {
    rawText: extraction.rawText,
    hasWhenPackedQualifier: Boolean(extraction.netQuantity.hasWhenPackedQualifier),
    confidence: {
      manufacturer: extraction.manufacturer.confidence,
      genericName: extraction.genericName.confidence,
      netQuantity: extraction.netQuantity.confidence,
      monthYear: extraction.monthYear.confidence,
      mrp: extraction.mrp.confidence,
      consumerCare: extraction.consumerCare.confidence
    },
    // Officer capture context and OCR signals.
    panel: context.panel || 'principal',
    isBlownOrMoulded: Boolean(context.isBlownOrMoulded),
    hasStickerOverMRP: Boolean(context.hasStickerOverMRP),
    detectedScripts: context.detectedScripts || extraction.detectedScripts || [],
    tokenConfidences: context.tokenConfidences || extraction.tokenConfidences || [],
    ocrEngine: context.engine || null,
    imageHash: context.imageHash || null,
    // Physical measurements from the vision service, kept verbatim so the
    // checklist can show the officer the number behind every verdict.
    visionMeasurements: context.measurements || null,
    visionWarnings: context.warnings || []
  }
});

/**
 * Adapts a stored inspection document to the flat input the rule modules read.
 */
const toRuleEngineInput = (extracted = {}) => {
  const netQuantity = extracted.netQuantity || {};
  const additional = extracted.additionalInfo || {};

  return {
    manufacturer: extracted.manufacturer || {},
    genericName: extracted.genericName,
    netQuantity: {
      value: netQuantity.value,
      unit: netQuantity.unit,
      raw: netQuantity.raw,
      valueInGrams: toBaseGrams(netQuantity.value, netQuantity.unit),
      hasWhenPackedQualifier: Boolean(additional.hasWhenPackedQualifier)
    },
    monthYear: (extracted.monthYear && extracted.monthYear.raw) || null,
    mrp: (extracted.mrp && (extracted.mrp.wording || extracted.mrp.raw)) || null,
    consumerCare: {
      ...(extracted.consumerCare || {}),
      telephone: extracted.consumerCare && extracted.consumerCare.phone
    },
    dimensions: extracted.dimensions || null,
    hasStickerOverMRP: Boolean(additional.hasStickerOverMRP),
    contrastRatio: additional.contrastRatio,
    detectedScripts: additional.detectedScripts || [],
    tokenConfidences: additional.tokenConfidences || [],
    // Which panel was photographed is the officer's answer at capture, not a
    // segmenter's guess; Rule 8 turns on it.
    panel: additional.panel || 'principal',
    // Rule 7(2) doubles every minimum height, and Rule 9(1)(b) contrast does
    // not apply at all, where the declaration is blown, formed or moulded.
    isBlownOrMoulded: Boolean(additional.isBlownOrMoulded),
    declarations: additional.declarations,
    description: extracted.description || additional.description || null,
    rawText: additional.rawText || ''
  };
};

module.exports = { extractDeclarations, toInspectionExtracted, toRuleEngineInput };
