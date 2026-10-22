const PDFDocument = require('pdfkit');
const docx = require('docx');
const ExcelJS = require('exceljs');
const qrcode = require('qrcode');

const VERDICT_COLOR = {
  PASS: '#047857',
  FAIL: '#A61B1B',
  REVIEW: '#9A5B08',
  NOT_APPLICABLE: '#64748B'
};

const effectiveVerdict = (r) => (r.overridden && r.overrideVerdict ? r.overrideVerdict : r.verdict);

const productLabel = (product) =>
  product ? `${product.brand || ''} ${product.genericName || ''}`.trim() || 'Unidentified product' : 'Unidentified product';

const declarationRows = (inspection) => {
  const e = inspection.extracted || {};
  return [
    ['Manufacturer / packer', (e.manufacturer && e.manufacturer.name) || 'Not detected'],
    ['Address', (e.manufacturer && e.manufacturer.address) || 'Not detected'],
    ['Generic name', e.genericName || 'Not detected'],
    [
      'Net quantity',
      e.netQuantity && e.netQuantity.value
        ? `${e.netQuantity.value} ${e.netQuantity.unit || ''}`.trim()
        : 'Not detected'
    ],
    ['Month & year of packing', (e.monthYear && e.monthYear.raw) || 'Not detected'],
    ['Retail sale price', (e.mrp && (e.mrp.wording || e.mrp.raw)) || 'Not detected'],
    [
      'Consumer care',
      [e.consumerCare && e.consumerCare.phone, e.consumerCare && e.consumerCare.email]
        .filter(Boolean)
        .join(' / ') || 'Not detected'
    ]
  ];
};

/**
 * Compliance certificate / violation notice with a verification QR code.
 */
async function generatePDF(inspection, product, { verifyUrl } = {}) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks = [];

  const finished = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.rect(0, 0, doc.page.width, 90).fill('#083344');
  doc.fillColor('#FFFFFF').fontSize(20).text('LM-Verify Compliance Report', 50, 34);
  doc
    .fontSize(9)
    .fillColor('#A5F3FC')
    .text('Legal Metrology (Packaged Commodities) Rules, 2011', 50, 60);

  doc.fillColor('#0F172A').fontSize(11).text('', 50, 120);
  doc.moveDown();

  doc.fontSize(14).fillColor('#083344').text('Inspection');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#0F172A');
  doc.text(`Reference: ${inspection.ref}`);
  doc.text(`Product: ${productLabel(product)}`);
  doc.text(`Category: ${(product && product.category) || 'Not classified'}`);
  doc.text(`Status: ${inspection.status}`);
  doc.text(`Verdict: ${String(inspection.verdict || 'draft').replace(/_/g, ' ')}`);
  doc.text(`Rule pack: v${inspection.rulePackVersion || '1.0.0'}`);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`);
  doc.moveDown();

  doc.fontSize(14).fillColor('#083344').text('Statutory declarations');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#0F172A');
  declarationRows(inspection).forEach(([label, value]) => {
    doc.text(`${label}: `, { continued: true }).fillColor('#334155').text(value).fillColor('#0F172A');
  });
  doc.moveDown();

  doc.fontSize(14).fillColor('#083344').text('Compliance checklist');
  doc.moveDown(0.3);

  (inspection.results || []).forEach((result) => {
    const verdict = effectiveVerdict(result);
    doc.fontSize(9).fillColor('#0E7490').text(result.citation || result.ruleId, { continued: true });
    doc.fillColor('#0F172A').text(`  ${result.check || ''}`, { continued: true });
    doc.fillColor(VERDICT_COLOR[verdict] || '#0F172A').text(`  [${verdict}]`);
    if (result.found) {
      doc.fontSize(8).fillColor('#64748B').text(`    Found: ${result.found}`);
    }
    if (result.overridden) {
      doc.fontSize(8).fillColor('#155E75').text(`    Officer override: ${result.overrideReason || ''}`);
    }
  });

  doc.moveDown();
  doc.fontSize(12).fillColor('#083344');
  doc.text(`Penalty exposure (Rule 32): Rs. ${(inspection.penalties && inspection.penalties.total) || 0}`);

  if (inspection.remarks) {
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#0F172A').text(`Remarks: ${inspection.remarks}`);
  }

  if (verifyUrl) {
    const qrDataUrl = await qrcode.toDataURL(verifyUrl, { margin: 1, width: 240 });
    doc.moveDown();
    const qrY = doc.y;
    doc.image(qrDataUrl, 50, qrY, { width: 90 });
    doc
      .fontSize(8)
      .fillColor('#64748B')
      .text('Scan to verify this report against the LM-Verify evidence chain.', 150, qrY + 30, {
        width: 300
      });
    doc.y = qrY + 100;
  }

  doc.moveDown(2);
  doc.fontSize(10).fillColor('#0F172A').text('_______________________', { align: 'right' });
  doc.text('Authorised Officer', { align: 'right' });

  doc.end();
  return finished;
}

async function generateDOCX(inspection, product) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

  const declarationParagraphs = declarationRows(inspection).map(
    ([label, value]) =>
      new Paragraph({
        children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)]
      })
  );

  const checklistParagraphs = (inspection.results || []).map(
    (result) =>
      new Paragraph({
        children: [
          new TextRun({ text: `${result.citation || result.ruleId} `, bold: true }),
          new TextRun(`${result.check || ''} — ${effectiveVerdict(result)}`)
        ]
      })
  );

  const document = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: 'LM-Verify Compliance Report',
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER
          }),
          new Paragraph({ children: [new TextRun({ text: `Reference: ${inspection.ref}`, bold: true })] }),
          new Paragraph(`Product: ${productLabel(product)}`),
          new Paragraph(`Verdict: ${String(inspection.verdict || 'draft').replace(/_/g, ' ')}`),
          new Paragraph(`Rule pack: v${inspection.rulePackVersion || '1.0.0'}`),
          new Paragraph({ text: 'Statutory declarations', heading: HeadingLevel.HEADING_2 }),
          ...declarationParagraphs,
          new Paragraph({ text: 'Compliance checklist', heading: HeadingLevel.HEADING_2 }),
          ...checklistParagraphs,
          new Paragraph({
            children: [
              new TextRun({
                text: `Penalty exposure (Rule 32): Rs. ${(inspection.penalties && inspection.penalties.total) || 0}`,
                bold: true
              })
            ]
          })
        ]
      }
    ]
  });

  return Packer.toBuffer(document);
}

async function generateXLSX(inspection, product) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LM-Verify';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Property', key: 'prop', width: 28 },
    { header: 'Value', key: 'val', width: 52 }
  ];
  summary.getRow(1).font = { bold: true };

  summary.addRow({ prop: 'Inspection ref', val: inspection.ref });
  summary.addRow({ prop: 'Product', val: productLabel(product) });
  summary.addRow({ prop: 'Category', val: (product && product.category) || 'Not classified' });
  summary.addRow({ prop: 'GTIN', val: (product && product.gtin) || '' });
  summary.addRow({ prop: 'Verdict', val: inspection.verdict });
  summary.addRow({ prop: 'Status', val: inspection.status });
  summary.addRow({ prop: 'Rule pack', val: `v${inspection.rulePackVersion || '1.0.0'}` });
  summary.addRow({
    prop: 'Penalty exposure (INR)',
    val: (inspection.penalties && inspection.penalties.total) || 0
  });
  declarationRows(inspection).forEach(([label, value]) => summary.addRow({ prop: label, val: value }));

  const checklist = workbook.addWorksheet('Compliance Results');
  checklist.columns = [
    { header: 'Rule', key: 'rule', width: 14 },
    { header: 'Citation', key: 'citation', width: 22 },
    { header: 'Check', key: 'check', width: 44 },
    { header: 'Found', key: 'found', width: 36 },
    { header: 'Required', key: 'required', width: 24 },
    { header: 'Verdict', key: 'verdict', width: 18 },
    { header: 'Overridden', key: 'overridden', width: 12 }
  ];
  checklist.getRow(1).font = { bold: true };

  (inspection.results || []).forEach((result) => {
    checklist.addRow({
      rule: result.ruleId,
      citation: result.citation,
      check: result.check,
      found: result.found,
      required: result.required,
      verdict: effectiveVerdict(result),
      overridden: result.overridden ? 'Yes' : 'No'
    });
  });

  return workbook.xlsx.writeBuffer();
}

module.exports = { generatePDF, generateDOCX, generateXLSX };
