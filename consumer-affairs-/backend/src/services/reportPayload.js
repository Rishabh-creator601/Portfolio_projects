const { generatePDF, generateDOCX, generateXLSX } = require('./reportService');
const {
  generateExtractionPDF,
  generateExtractionXLSX
} = require('./extractionReportService');

/**
 * Reports are persisted as JSON, not as rendered documents.
 *
 * `buildPayload` freezes everything a renderer needs into a plain object at the
 * moment of issue, so the PDF a user downloads next year reflects the
 * inspection as it was certified - not as the inspection document has since
 * been edited. `renderPayload` turns that frozen JSON back into a file on
 * demand, which is why no binary is stored anywhere.
 */

const PAYLOAD_VERSION = 1;

/** Strips mongoose internals so the snapshot is a plain, storable object. */
const plain = (doc) => {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return JSON.parse(JSON.stringify(obj));
};

const effectiveVerdict = (r) =>
  r && r.overridden && r.overrideVerdict ? r.overrideVerdict : r && r.verdict;

const productLabelOf = (product) =>
  product
    ? `${product.brand || ''} ${product.genericName || ''}`.trim() || 'Unidentified product'
    : 'Unidentified product';

/**
 * Snapshot of one inspection, ready to re-render. `kind` records which document
 * family it belongs to, because an extraction report and a compliance
 * certificate are rendered by different services.
 */
function buildPayload({ inspection, product, kind, issuedBy, verifyUrl }) {
  const snapshot = plain(inspection) || {};
  const productSnapshot = plain(product);
  const results = Array.isArray(snapshot.results) ? snapshot.results : [];

  return {
    version: PAYLOAD_VERSION,
    kind, // 'compliance' | 'extraction'
    generatedAt: new Date().toISOString(),
    verifyUrl: verifyUrl || null,
    issuedBy: issuedBy
      ? {
          _id: String(issuedBy._id),
          displayName: issuedBy.displayName,
          email: issuedBy.email,
          role: issuedBy.role,
          jurisdiction: issuedBy.jurisdiction
        }
      : null,
    inspection: snapshot,
    product: productSnapshot,
    summary: {
      ref: snapshot.ref || null,
      verdict: effectiveVerdict(snapshot) || null,
      status: snapshot.status || null,
      productLabel: productLabelOf(productSnapshot),
      // Counts are computed once here so the repository list never has to walk
      // the rule results again. The schema calls this array `results`.
      ruleCount: results.length,
      failedRules: results.filter((r) => effectiveVerdict(r) === 'FAIL').length,
      // The schema field is `penalties`; `penalty` is tolerated because older
      // records and some fixtures use the singular.
      penaltyTotal:
        (snapshot.penalties && snapshot.penalties.total) ||
        (snapshot.penalty && snapshot.penalty.total) ||
        0
    }
  };
}

/**
 * Re-renders a stored payload. The renderers read plain properties, so the
 * snapshot can be handed to them exactly as it came out of MongoDB.
 */
async function renderPayload(payload, format) {
  if (!payload) throw new Error('This report has no stored JSON payload');

  const { inspection, product, kind, verifyUrl } = payload;

  if (kind === 'extraction') {
    const extraction = inspection && inspection.extractionReport;
    if (!extraction) throw new Error('The stored payload has no extraction report');

    if (format === 'pdf') return generateExtractionPDF(inspection, extraction);
    if (format === 'xlsx') return Buffer.from(await generateExtractionXLSX(inspection, extraction));
    throw new Error('Extraction reports are available as PDF or XLSX');
  }

  if (format === 'pdf') return generatePDF(inspection, product, { verifyUrl });
  if (format === 'docx') return generateDOCX(inspection, product);
  if (format === 'xlsx') return Buffer.from(await generateXLSX(inspection, product));

  throw new Error(`Unsupported render format: ${format}`);
}

/** Which formats a given stored report can actually be rendered into. */
function availableFormats(payload) {
  if (!payload) return [];
  return payload.kind === 'extraction' ? ['pdf', 'xlsx'] : ['pdf', 'docx', 'xlsx'];
}

module.exports = { PAYLOAD_VERSION, buildPayload, renderPayload, availableFormats, plain };
