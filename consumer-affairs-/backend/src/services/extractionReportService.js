const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

/**
 * Client-facing extraction report.
 *
 * Reports what was read off the label and what could not be found. It is
 * deliberately not a compliance certificate: whether a missing declaration is a
 * breach depends on the product category and its exemptions, which the rule
 * engine decides and which is inactive in this build. "Not found" is a fact
 * about the photograph; "non-compliant" would be a legal conclusion.
 */

const CYAN_DEEP = '#083344';
const CYAN = '#0E7490';
const FOUND = '#047857';
const MISSING = '#A61B1B';
const MUTED = '#64748B';

const value = (v) => (v === null || v === undefined || v === '' ? null : String(v));

const VERDICT_COLOUR = {
  PASS: FOUND,
  FAIL: MISSING,
  REVIEW: '#9A5B08',
  NOT_APPLICABLE: MUTED,
  NOT_ASSESSED: MUTED
};

const VERDICT_LABEL = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  REVIEW: 'REVIEW',
  NOT_APPLICABLE: 'N/A',
  NOT_ASSESSED: 'NOT ASSESSED'
};

const effectiveVerdict = (r) => (r.overridden && r.overrideVerdict ? r.overrideVerdict : r.verdict);

/**
 * Renders the compliance checklist into an open PDF document.
 *
 * Kept separate from the extraction sections so the same report can carry both:
 * what was read, and what the rule pack made of it.
 */
function renderComplianceSection(doc, inspection, summary) {
  const results = inspection.results || [];
  if (results.length === 0) return;

  doc.addPage();
  doc.fontSize(15).fillColor(CYAN_DEEP).text('Compliance assessment');
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      'Verdicts produced by the deterministic rule pack over the extracted declarations. ' +
        'The model read the label; these findings come from pure functions over that reading.'
    );
  doc.moveDown(0.6);

  if (summary) {
    doc.fontSize(10).fillColor('#0F172A');
    doc.text(
      `Category: ${summary.categoryName || summary.category || 'unclassified'}` +
        (summary.categoryMatchedOn ? ` (matched on "${summary.categoryMatchedOn}")` : '')
    );
    doc.text(
      `Passed ${summary.passed}   Failed ${summary.failed}   ` +
        `Review ${summary.review}   Not applicable ${summary.notApplicable}   ` +
        `Not assessed ${summary.notAssessed || 0}`
    );

    if (summary.inScope === false && summary.scope) {
      doc.moveDown(0.3);
      doc
        .fontSize(10)
        .fillColor(MISSING)
        .text(`Outside Chapter II - ${summary.scope.citation}: ${summary.scope.reason}`);
    }
    doc.moveDown(0.6);
  }

  for (const result of results) {
    const verdict = effectiveVerdict(result);

    doc.fontSize(9).fillColor(CYAN).text(result.citation || result.ruleId, { continued: true });
    doc.fillColor('#0F172A').text(`  ${result.check || ''}`, { continued: true });
    doc
      .fillColor(VERDICT_COLOUR[verdict] || '#0F172A')
      .text(`   [${VERDICT_LABEL[verdict] || verdict}]`);

    if (result.found) {
      doc.fontSize(8).fillColor('#334155').text(`     Found: ${String(result.found).slice(0, 150)}`);
    }
    if (result.required) {
      doc.fontSize(8).fillColor(MUTED).text(`     Required: ${String(result.required).slice(0, 150)}`);
    }
    if (result.note) {
      doc.fontSize(8).fillColor(MUTED).text(`     ${String(result.note).slice(0, 220)}`);
    }
    if (result.overridden) {
      doc
        .fontSize(8)
        .fillColor(CYAN_DEEP)
        .text(`     Officer override: ${result.overrideReason || ''}`);
    }
    doc.moveDown(0.25);
  }

  const penalty = (inspection.penalties && inspection.penalties.total) || 0;
  doc.moveDown(0.5);
  doc
    .fontSize(12)
    .fillColor(penalty > 0 ? MISSING : CYAN_DEEP)
    .text(`Penalty exposure (Rule 32): Rs. ${penalty}`);

  doc.moveDown(0.4);
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      'Rules prescribing a measurement in millimetres - Rule 7(2), Rule 7(3), Rule 8(1) - ' +
        'and the Rule 9(1)(b) contrast ratio are reported as NOT ASSESSED. This path reads ' +
        'the label but does not measure it. Capture the panel with a scale reference to ' +
        'decide those.',
      { align: 'justify' }
    );
}

function nutritionRows(nutrition) {
  if (!nutrition) return [];

  const rows = [
    ['Energy', nutrition.energy_kcal, 'kcal'],
    ['Protein', nutrition.protein_g, 'g'],
    ['Carbohydrate', nutrition.carbohydrate_g, 'g'],
    ['— total sugars', nutrition.total_sugars_g, 'g'],
    ['— added sugars', nutrition.added_sugars_g, 'g'],
    ['Total fat', nutrition.total_fat_g, 'g'],
    ['— saturated fat', nutrition.saturated_fat_g, 'g'],
    ['— trans fat', nutrition.trans_fat_g, 'g'],
    ['Cholesterol', nutrition.cholesterol_mg, 'mg'],
    ['Sodium', nutrition.sodium_mg, 'mg']
  ];

  return rows.filter(([, amount]) => amount !== null && amount !== undefined);
}

async function generateExtractionPDF(inspection, report, { includeCompliance = true } = {}) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks = [];

  const finished = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const summary = (report && report.summary) || {};

  // --- header ---
  doc.rect(0, 0, doc.page.width, 84).fill(CYAN_DEEP);
  const hasVerdicts = includeCompliance && (inspection.results || []).length > 0;
  doc
    .fillColor('#FFFFFF')
    .fontSize(19)
    .text(hasVerdicts ? 'Label Compliance Report' : 'Label Extraction Report', 50, 30);
  doc
    .fontSize(9)
    .fillColor('#A5F3FC')
    .text('LM-Verify · what the label says, read from the photograph', 50, 56);

  doc.fillColor('#0F172A').fontSize(10);
  doc.y = 104;

  // --- inspection meta ---
  doc.fontSize(13).fillColor(CYAN_DEEP).text('Inspection');
  doc.moveDown(0.3).fontSize(10).fillColor('#0F172A');
  doc.text(`Reference: ${inspection.ref}`);
  doc.text(`Product: ${summary.product || 'Unidentified'}`);
  if (summary.brand) doc.text(`Brand: ${summary.brand}`);
  if (summary.packageType) {
    doc.text(
      `Package: ${summary.packageType}${summary.packageMaterial ? ` (${summary.packageMaterial})` : ''}`
    );
  }
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`);
  doc.text(`Extraction model: ${summary.model || 'n/a'}`);
  if (summary.imageHash) doc.text(`Image SHA-256: ${summary.imageHash}`);
  doc.moveDown();

  // --- completeness ---
  doc.fontSize(13).fillColor(CYAN_DEEP).text('Declarations located');
  doc.moveDown(0.3).fontSize(10).fillColor('#0F172A');
  doc.text(
    `${summary.declarationsFound ?? 0} of ${summary.declarationsTotal ?? 7} ` +
      `mandatory declarations were found on this image (${summary.completenessPercent ?? 0}%).`
  );
  doc.moveDown();

  // --- Rule 6 declarations ---
  doc.fontSize(13).fillColor(CYAN_DEEP).text('Statutory declarations (Rule 6)');
  doc.moveDown(0.4);

  for (const row of (report && report.declarations) || []) {
    const present = row.status === 'found';
    doc.fontSize(9).fillColor(CYAN).text(row.citation, { continued: true });
    doc.fillColor('#0F172A').text(`  ${row.label}`);
    doc
      .fontSize(10)
      .fillColor(present ? '#0F172A' : MISSING)
      .text(`    ${present ? row.value : 'Not found on this image'}`);
    doc.moveDown(0.25);
  }

  doc.moveDown(0.5);

  // --- FSSAI particulars ---
  doc.fontSize(13).fillColor(CYAN_DEEP).text('Food labelling particulars');
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text('FSSAI Labelling and Display Regulations, 2020 — a separate statute from these Rules.');
  doc.moveDown(0.4);

  for (const row of (report && report.fssai) || []) {
    if (row.key === 'nutrition') continue; // rendered as its own table below
    const present = row.status === 'found';
    doc
      .fontSize(10)
      .fillColor(present ? '#0F172A' : MUTED)
      .text(`  ${row.label}: ${present ? String(row.value).slice(0, 220) : 'not found'}`);
    doc.moveDown(0.2);
  }

  // --- nutrition table ---
  const rows = nutritionRows(report && report.nutrition);
  if (rows.length > 0) {
    doc.moveDown(0.6);
    doc.fontSize(13).fillColor(CYAN_DEEP).text('Nutrition panel');
    const basis = report.nutrition.basis || report.nutrition.serving_size;
    if (basis) doc.fontSize(9).fillColor(MUTED).text(`Basis: ${basis}`);
    doc.moveDown(0.4);

    for (const [label, amount, unit] of rows) {
      doc.fontSize(10).fillColor('#0F172A').text(`  ${label}`, { continued: true });
      doc.fillColor(CYAN_DEEP).text(`   ${amount} ${unit}`, { align: 'left' });
      doc.moveDown(0.15);
    }
  }

  // --- detected regions ---
  const detections = (report && report.detections) || [];
  if (detections.length > 0) {
    doc.moveDown(0.6);
    doc.fontSize(13).fillColor(CYAN_DEEP).text('Regions located on the image');
    doc.moveDown(0.3);
    for (const detection of detections) {
      const box = detection.box;
      const where = box ? `x${box.x}, y${box.y}, ${box.width}×${box.height} px` : 'normalised only';
      doc
        .fontSize(9)
        .fillColor('#0F172A')
        .text(`  ${String(detection.region).replace(/_/g, ' ')} — ${where}`);
    }
  }

  // --- legibility issues ---
  const issues = (report && report.legibilityIssues) || [];
  if (issues.length > 0) {
    doc.moveDown(0.6);
    doc.fontSize(13).fillColor(CYAN_DEEP).text('Could not be read');
    doc.moveDown(0.3);
    for (const issue of issues) {
      doc.fontSize(9).fillColor(MISSING).text(`  • ${issue}`);
    }
  }

  // --- compliance checklist ---
  if (includeCompliance && (inspection.results || []).length > 0) {
    renderComplianceSection(doc, inspection, inspection.complianceSummary);
  }

  // --- disclaimer ---
  doc.moveDown(1);
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text(report && report.disclaimer ? report.disclaimer : '', { align: 'justify' });

  doc.moveDown(1.5);
  doc.fontSize(10).fillColor('#0F172A').text('_______________________', { align: 'right' });
  doc.text('Authorised Officer', { align: 'right' });

  doc.end();
  return finished;
}

async function generateExtractionXLSX(inspection, report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LM-Verify';
  workbook.created = new Date();

  const summary = (report && report.summary) || {};

  const sheet = workbook.addWorksheet('Declarations');
  sheet.columns = [
    { header: 'Citation', key: 'citation', width: 16 },
    { header: 'Declaration', key: 'label', width: 34 },
    { header: 'Value read', key: 'value', width: 56 },
    { header: 'Status', key: 'status', width: 12 }
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of (report && report.declarations) || []) {
    sheet.addRow({
      citation: row.citation,
      label: row.label,
      value: row.value || '',
      status: row.status === 'found' ? 'Found' : 'Not found'
    });
  }

  const food = workbook.addWorksheet('Food labelling');
  food.columns = [
    { header: 'Particular', key: 'label', width: 30 },
    { header: 'Value', key: 'value', width: 70 }
  ];
  food.getRow(1).font = { bold: true };
  for (const row of (report && report.fssai) || []) {
    if (row.key === 'nutrition') continue;
    food.addRow({ label: row.label, value: value(row.value) || 'not found' });
  }

  const rows = nutritionRows(report && report.nutrition);
  if (rows.length > 0) {
    const nutrition = workbook.addWorksheet('Nutrition');
    nutrition.columns = [
      { header: 'Nutrient', key: 'nutrient', width: 26 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Unit', key: 'unit', width: 10 }
    ];
    nutrition.getRow(1).font = { bold: true };
    nutrition.addRow({ nutrient: 'Basis', amount: report.nutrition.basis || '', unit: '' });
    for (const [label, amount, unit] of rows) {
      nutrition.addRow({ nutrient: label, amount, unit });
    }
  }

  const results = inspection.results || [];
  if (results.length > 0) {
    const compliance = workbook.addWorksheet('Compliance');
    compliance.columns = [
      { header: 'Rule', key: 'rule', width: 14 },
      { header: 'Citation', key: 'citation', width: 22 },
      { header: 'Check', key: 'check', width: 40 },
      { header: 'Found', key: 'found', width: 46 },
      { header: 'Required', key: 'required', width: 40 },
      { header: 'Verdict', key: 'verdict', width: 16 },
      { header: 'Note', key: 'note', width: 60 }
    ];
    compliance.getRow(1).font = { bold: true };

    for (const result of results) {
      compliance.addRow({
        rule: result.ruleId,
        citation: result.citation,
        check: result.check,
        found: result.found,
        required: result.required,
        verdict: VERDICT_LABEL[effectiveVerdict(result)] || effectiveVerdict(result),
        note: result.note || ''
      });
    }

    const cs = inspection.complianceSummary || {};
    compliance.addRow({});
    compliance.addRow({ rule: 'Category', citation: cs.categoryName || cs.category || '' });
    compliance.addRow({
      rule: 'Totals',
      citation: `pass ${cs.passed ?? ''} / fail ${cs.failed ?? ''} / review ${cs.review ?? ''} / ` +
        `n-a ${cs.notApplicable ?? ''} / not assessed ${cs.notAssessed ?? ''}`
    });
    compliance.addRow({
      rule: 'Penalty',
      citation: `Rs ${(inspection.penalties && inspection.penalties.total) || 0} (Rule 32)`
    });
  }

  const meta = workbook.addWorksheet('About');
  meta.columns = [
    { header: 'Property', key: 'prop', width: 28 },
    { header: 'Value', key: 'val', width: 80 }
  ];
  meta.getRow(1).font = { bold: true };
  meta.addRow({ prop: 'Inspection ref', val: inspection.ref });
  meta.addRow({ prop: 'Product', val: summary.product || '' });
  meta.addRow({ prop: 'Extraction model', val: summary.model || '' });
  meta.addRow({ prop: 'Image SHA-256', val: summary.imageHash || '' });
  meta.addRow({ prop: 'Declarations found', val: `${summary.declarationsFound}/${summary.declarationsTotal}` });
  meta.addRow({ prop: 'Declarations found', val: `${summary.declarationsFound}/${summary.declarationsTotal}` });
  if ((inspection.results || []).length > 0) {
    meta.addRow({
      prop: 'Not assessed',
      val:
        'Rules 7(2), 7(3), 8(1) and 9(1)(b) prescribe millimetres or a measured contrast ' +
        'ratio. This path reads the label but does not measure it.'
    });
  }
  meta.addRow({ prop: 'Disclaimer', val: (report && report.disclaimer) || '' });

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateExtractionPDF, generateExtractionXLSX };
