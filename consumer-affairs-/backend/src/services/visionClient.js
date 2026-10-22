const { OCR_SERVICE_URL } = require('../config/env');
const { analyzeImage, getServiceStatus } = require('./ocrStub');

/**
 * Client for the Python vision sidecar.
 *
 * The sidecar reads and measures; it never decides compliance. What comes back
 * is tokens plus physical measurements with a confidence band on each, and the
 * deterministic rule pack in this service turns those into verdicts. That
 * boundary is what makes a finding reproducible and defensible under challenge.
 */

const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS || 30000);

// Gemini extraction is a model round trip, not a local CV pass, so it gets its
// own longer budget: ~10s typical, and the sidecar retries upstream 503s.
const EXTRACT_TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS || 120000);

const isFetchAvailable = () => typeof fetch === 'function' && typeof FormData !== 'undefined';

async function callVision(path, { file, fields = {}, method = 'POST', timeoutMs } = {}) {
  if (!isFetchAvailable()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || VISION_TIMEOUT_MS);

  try {
    const options = { method, signal: controller.signal };

    if (file) {
      const form = new FormData();
      form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) form.append(key, String(value));
      }
      options.body = form;
    }

    const response = await fetch(`${OCR_SERVICE_URL}${path}`, options);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.warn(`Vision service ${path} returned ${response.status}: ${detail.slice(0, 200)}`);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.warn(`Vision service unreachable at ${OCR_SERVICE_URL}${path} (${err.message}).`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalises the sidecar's token shape onto the one the Inspection schema stores. */
function normalizeTokens(tokens = []) {
  return tokens
    .map((token) => {
      // The service returns {box:{x,y,width,height}}; the legacy stub returns bbox[].
      const box = token.box
        ? [token.box.x, token.box.y, token.box.x + token.box.width, token.box.y + token.box.height]
        : token.bbox;

      return {
        text: token.text,
        bbox: box || [],
        confidence: typeof token.confidence === 'number' ? token.confidence : 0,
        panel: token.panel || 'principal',
        script: token.script
      };
    })
    .filter((token) => token.text && token.text.trim());
}

/**
 * Full pipeline: quality gate, rectify, calibrate, read, measure.
 *
 * `options.referenceWidthMm` is what turns Rule 7 from a guess into a
 * measurement. Without it the sidecar still reads the label, but every
 * millimetre-dependent check comes back needing review rather than asserting a
 * verdict the photograph cannot support.
 */
async function analyze(file, options = {}) {
  const payload = await callVision('/analyze', {
    file,
    fields: {
      panel: options.panel || 'principal',
      reference_width_mm: options.referenceWidthMm,
      reference_kind: options.referenceKind || 'reference_card',
      is_curved_surface: Boolean(options.isCurvedSurface),
      is_blown_or_moulded: Boolean(options.isBlownOrMoulded),
      languages: (options.languages || ['en']).join(','),
      engine: options.engine
    }
  });

  if (!payload) {
    // Sidecar down: fall back to the local stub so an inspection can still be
    // raised in the field, flagged so nothing is mistaken for a real reading.
    const stub = analyzeImage();
    return {
      tokens: normalizeTokens(stub.tokens),
      engine: 'local-stub',
      source: 'local-stub',
      measurements: emptyMeasurements(
        'Vision service unavailable; no measurements were taken. Every millimetre-based ' +
          'check on this inspection needs officer review.'
      ),
      warnings: ['Vision service unreachable; a local stub reading was substituted.']
    };
  }

  return {
    tokens: normalizeTokens(payload.tokens),
    engine: payload.engine,
    source: 'vision-service',
    imageHash: payload.image_hash,
    processingTimeMs: payload.processing_time_ms,
    measurements: {
      quality: payload.quality,
      calibration: payload.calibration,
      numeral: payload.numeral_metrics,
      contrast: payload.contrast,
      clearSpace: payload.clear_space,
      panelGeometry: payload.panel_geometry,
      quantityRegion: payload.quantity_region
    },
    warnings: payload.warnings || []
  };
}

function emptyMeasurements(reason) {
  const low = { confidence: 'LOW', notes: [reason] };
  return {
    quality: null,
    calibration: { mm_per_px: null, source: 'none', ...low },
    numeral: { median_digit_height_mm: null, ...low },
    contrast: { ratio: null, ...low },
    clearSpace: { satisfied: null, ...low },
    panelGeometry: { area_cm2: null, confidence: 'LOW' },
    quantityRegion: null
  };
}

/** OCR only, for callers that want tokens without the measurement stages. */
async function readTokens(file, options = {}) {
  const payload = await callVision('/ocr', {
    file,
    fields: { languages: (options.languages || ['en']).join(','), engine: options.engine }
  });

  if (!payload) {
    return { tokens: normalizeTokens(analyzeImage().tokens), engine: 'local-stub', source: 'local-stub' };
  }

  return {
    tokens: normalizeTokens(payload.tokens),
    engine: payload.engine,
    source: 'vision-service',
    processingTimeMs: payload.processing_time_ms
  };
}

/**
 * VLM pass over the two unstructured heads (manufacturer block, generic name).
 * Returns null when no provider is configured, which leaves those heads to the
 * regex tagger and officer review rather than failing the inspection.
 */
async function tagUnstructured(file, tokens = []) {
  const payload = await callVision('/tag', {
    file,
    fields: { tokens: tokens.map((t) => t.text).join('\n') }
  });

  return payload && payload.data ? payload.data : null;
}

/**
 * Gemini label extraction and object detection -- the active path.
 *
 * Returns the transcribed declarations mapped onto the Inspection schema, the
 * located regions with pixel boxes, and a client report. Returns null when the
 * sidecar is unreachable or Gemini is not configured, so the caller can say so
 * rather than silently substituting a worse reading.
 */
async function extract(file, { buildReport = true, model, allowOcrFallback = true } = {}) {
  const payload = await callVision('/extract', {
    file,
    fields: { build_report: String(buildReport), model },
    timeoutMs: EXTRACT_TIMEOUT_MS
  });

  if (payload && payload.data) {
    const { extraction, declarations, report, imageHash, mode } = payload.data;
    const meta = (extraction && extraction._meta) || {};

    return {
      extraction,
      declarations,
      report: report || null,
      imageHash,
      mode,
      detections: (extraction && extraction.detections) || [],
      engine: meta.model || 'gemini',
      source: 'gemini',
      keyUsed: meta.key_used || null,
      usage: meta.usage || null,
      warnings: meta.key_used && meta.key_used !== 'key_1'
        ? [
            `The primary API key could not be used, so this reading was taken on ` +
              `${meta.key_used.replace('_', ' ')}.`
          ]
        : []
    };
  }

  // Every Gemini key failed. Rather than lose the capture, read the label with
  // the local OCR engine instead. The reading is materially worse -- it is the
  // regex tagger over OCR tokens, which is why the model path exists -- so it
  // is flagged at every level: on the result, in the report, and on the record.
  if (!allowOcrFallback) return null;

  return module.exports.extractViaOcr(file);
}

/**
 * Third-tier fallback: local OCR instead of the model.
 *
 * Marked plainly rather than passed off as a model reading. An officer who
 * cannot tell which engine produced an extraction cannot judge how far to
 * trust it, and this one misses small print the model reads comfortably.
 */
async function extractViaOcr(file) {
  // Called through the module export rather than the local binding so the OCR
  // tier can be substituted in a test without a live sidecar.
  const analysis = await module.exports.analyze(file, { languages: ['en'] });
  if (!analysis || !analysis.tokens || analysis.tokens.length === 0) return null;

  const {
    extractDeclarations,
    toInspectionExtracted
  } = require('./extractionService');

  const extraction = extractDeclarations(analysis.tokens);
  const declarations = toInspectionExtracted(extraction, {
    engine: analysis.engine,
    imageHash: analysis.imageHash,
    measurements: analysis.measurements,
    warnings: analysis.warnings
  });

  const degraded =
    'Read by the local OCR engine because no API key could be used. This reading ' +
    'misses small print the model recovers, and every declaration on it should be ' +
    'confirmed against the pack.';

  return {
    extraction: { detections: [], _meta: { model: analysis.engine } },
    declarations,
    report: buildOcrReport(declarations, analysis, degraded),
    imageHash: analysis.imageHash,
    mode: 'ocr-fallback',
    detections: [],
    engine: analysis.engine,
    source: 'ocr-fallback',
    keyUsed: null,
    usage: null,
    warnings: [degraded, ...(analysis.warnings || [])]
  };
}

/** The same report shape the Gemini path produces, built from an OCR reading. */
function buildOcrReport(declarations, analysis, degradedNote) {
  const heads = [
    ['manufacturer_name', 'Rule 6(1)(a)', 'Manufacturer / packer / importer',
      declarations.manufacturer && declarations.manufacturer.name],
    ['manufacturer_address', 'Rule 6(1)(a)', 'Complete address',
      declarations.manufacturer && declarations.manufacturer.address],
    ['generic_name', 'Rule 6(1)(b)', 'Common or generic name', declarations.genericName],
    ['net_quantity', 'Rule 6(1)(c)', 'Net quantity',
      declarations.netQuantity && declarations.netQuantity.value != null
        ? `${declarations.netQuantity.value} ${declarations.netQuantity.unit || ''}`.trim()
        : null],
    ['month_year', 'Rule 6(1)(d)', 'Month and year',
      declarations.monthYear && declarations.monthYear.raw],
    ['mrp', 'Rule 6(1)(e)', 'Retail sale price',
      declarations.mrp && declarations.mrp.raw],
    ['consumer_care', 'Rule 6(2)', 'Consumer care details',
      [declarations.consumerCare && declarations.consumerCare.phone,
       declarations.consumerCare && declarations.consumerCare.email]
        .filter(Boolean)
        .join(' / ') || null]
  ];

  const rows = heads.map(([key, citation, label, value]) => ({
    key,
    citation,
    label,
    value: value || null,
    status: value ? 'found' : 'not_found'
  }));

  const found = rows.filter((r) => r.status === 'found').length;

  return {
    summary: {
      product: declarations.genericName || 'Unidentified product',
      brand: null,
      packageType: null,
      packageMaterial: null,
      declarationsFound: found,
      declarationsTotal: rows.length,
      completenessPercent: Math.round((found / rows.length) * 100),
      extractionConfidence: null,
      regionsDetected: 0,
      imageHash: analysis.imageHash || null,
      model: analysis.engine,
      processingTimeMs: analysis.processingTimeMs || null
    },
    declarations: rows,
    // The model path reads these; OCR does not attempt them.
    fssai: [
      { key: 'nutrition', label: 'Nutrition panel', value: null, status: 'not_found' },
      { key: 'ingredients', label: 'Ingredients list', value: null, status: 'not_found' },
      { key: 'allergen_declaration', label: 'Allergen declaration', value: null, status: 'not_found' },
      { key: 'fssai_licence_number', label: 'FSSAI licence number', value: null, status: 'not_found' },
      { key: 'veg_nonveg_mark', label: 'Veg / non-veg mark', value: null, status: 'not_found' }
    ],
    nutrition: null,
    package: null,
    detections: [],
    legibilityIssues: [degradedNote],
    disclaimer:
      'This is an extraction report, not a compliance determination. ' + degradedNote
  };
}

async function status() {
  const payload = await callVision('/health', { method: 'GET' });

  if (!payload) {
    return {
      status: 'unavailable',
      service: OCR_SERVICE_URL,
      mode: 'local-stub',
      engines: [],
      stub: getServiceStatus()
    };
  }

  return {
    status: payload.status,
    service: OCR_SERVICE_URL,
    version: payload.version,
    mode: payload.status === 'healthy' ? 'vision-service' : 'degraded',
    engines: payload.engines || [],
    capabilities: payload.capabilities || {}
  };
}

module.exports = {
  analyze,
  extract,
  extractViaOcr,
  readTokens,
  tagUnstructured,
  status,
  normalizeTokens
};
