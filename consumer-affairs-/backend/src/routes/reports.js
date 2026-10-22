const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const audit = require('../middleware/audit');
const Report = require('../models/Report');
const Inspection = require('../models/Inspection');
const { getGridFSBucket } = require('../config/db');
const { EXTRACTION_MODE } = require('../config/env');
const { computeHash } = require('../utils/hashUtils');
const { buildPayload, renderPayload, availableFormats } = require('../services/reportPayload');

const MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json'
};

// Public route - verify a report from its QR token, without exposing the file.
router.get('/verify/:qrToken', async (req, res, next) => {
  try {
    const report = await Report.findOne({ qrToken: req.params.qrToken }).populate(
      'inspectionId',
      'ref verdict status createdAt'
    );

    if (!report) {
      return res.status(404).json({
        success: false,
        error: { message: 'No report matches this verification token', code: 404 }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        isValid: true,
        format: report.format,
        issuedAt: report.issuedAt,
        hash: report.hash,
        inspectionRef:
          report.inspectionRef || (report.inspectionId && report.inspectionId.ref) || null,
        verdict: report.verdict || (report.inspectionId && report.inspectionId.verdict) || null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.use(protect);
router.use(audit);

/** Shape returned to the repository list - never includes the whole payload. */
const toListItem = (report) => ({
  _id: report._id,
  inspectionId: report.inspectionId,
  inspectionRef: report.inspectionRef,
  productLabel: report.productLabel,
  verdict: report.verdict,
  format: report.format,
  hash: report.hash,
  issuedAt: report.issuedAt,
  issuedBy: report.issuedBy,
  ownerId: report.ownerId,
  kind: report.payload && report.payload.kind,
  summary: (report.payload && report.payload.summary) || null,
  availableFormats: availableFormats(report.payload),
  qrToken: report.qrToken
});

// POST /api/reports/generate/:inspectionId - stores the report as JSON
router.post(
  '/generate/:inspectionId',
  authorize('controller', 'senior_inspector', 'legal_officer'),
  async (req, res, next) => {
    try {
      const inspection = await Inspection.findById(req.params.inspectionId).populate('productId');
      if (!inspection) {
        return res
          .status(404)
          .json({ success: false, error: { message: 'Inspection not found', code: 404 } });
      }

      const isExtraction = EXTRACTION_MODE === 'gemini';

      if (isExtraction && !inspection.extractionReport) {
        return res.status(409).json({
          success: false,
          error: {
            message:
              'This inspection has no extraction yet. Capture an image first, then ' +
              'download the report.',
            code: 409
          }
        });
      }

      const qrToken = crypto.randomBytes(16).toString('hex');
      const verifyUrl = `${req.protocol}://${req.get('host')}/api/reports/verify/${qrToken}`;

      const payload = buildPayload({
        inspection,
        product: inspection.productId,
        kind: isExtraction ? 'extraction' : 'compliance',
        issuedBy: req.user,
        verifyUrl
      });

      // The hash covers the stored JSON, so tampering with the record is
      // detectable even though no binary is kept.
      const hash = computeHash(Buffer.from(JSON.stringify(payload)));

      const report = await Report.create({
        inspectionId: inspection._id,
        payload,
        inspectionRef: payload.summary.ref,
        verdict: payload.summary.verdict,
        productLabel: payload.summary.productLabel,
        format: 'json',
        hash,
        issuedBy: req.user._id,
        // Filed under the inspecting officer where known, so it shows up in
        // their repository rather than only the issuer's.
        ownerId: inspection.officerId || req.user._id,
        qrToken
      });

      res.status(201).json({
        success: true,
        data: { ...toListItem(report), verifyUrl }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/reports/mine - the signed-in officer's own reports
router.get('/mine', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

    const filter = { ownerId: req.user._id };
    if (req.query.verdict) filter.verdict = req.query.verdict;
    if (req.query.search) {
      filter.$or = [
        { inspectionRef: new RegExp(String(req.query.search).trim(), 'i') },
        { productLabel: new RegExp(String(req.query.search).trim(), 'i') }
      ];
    }

    const [reports, total] = await Promise.all([
      Report.find(filter)
        .sort('-issuedAt')
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('issuedBy', 'displayName')
        .lean(),
      Report.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: reports.map(toListItem),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/inspection/:inspectionId - reports already issued
router.get('/inspection/:inspectionId', async (req, res, next) => {
  try {
    const reports = await Report.find({ inspectionId: req.params.inspectionId })
      .sort('-issuedAt')
      .populate('issuedBy', 'displayName')
      .lean();

    res.status(200).json({ success: true, data: reports.map(toListItem) });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/:id - the stored JSON itself
router.get('/:id', async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('issuedBy', 'displayName email role')
      .lean();

    if (!report) {
      return res
        .status(404)
        .json({ success: false, error: { message: 'Report not found', code: 404 } });
    }

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/:id/download?format=pdf - rendered from the stored JSON
router.get('/:id/download', async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.id).populate('inspectionId', 'ref');

    if (!report) {
      return res
        .status(404)
        .json({ success: false, error: { message: 'Report not found', code: 404 } });
    }

    const refName =
      report.inspectionRef || (report.inspectionId && report.inspectionId.ref) || 'report';

    // Reports issued before JSON storage still only exist as a GridFS blob.
    if (!report.payload) {
      if (!report.fileId) {
        return res
          .status(404)
          .json({ success: false, error: { message: 'Report file not found', code: 404 } });
      }

      res.set('Content-Type', MIME_TYPES[report.format] || 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${refName}.${report.format}"`);
      res.set('X-Report-Hash', report.hash || '');

      const stream = getGridFSBucket().openDownloadStream(report.fileId);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(404).json({
            success: false,
            error: { message: 'Report file could not be read', code: 404 }
          });
        } else {
          res.end();
        }
      });
      return stream.pipe(res);
    }

    const format = String(req.query.format || 'pdf').toLowerCase();
    const allowed = availableFormats(report.payload);

    if (format === 'json') {
      res.set('Content-Type', 'application/json');
      res.set('Content-Disposition', `attachment; filename="${refName}.json"`);
      res.set('X-Report-Hash', report.hash || '');
      return res.status(200).send(JSON.stringify(report.payload, null, 2));
    }

    if (!allowed.includes(format)) {
      return res.status(400).json({
        success: false,
        error: {
          message: `This report can be downloaded as: ${allowed.join(', ')}`,
          code: 400
        }
      });
    }

    const buffer = await renderPayload(report.payload, format);

    res.set('Content-Type', MIME_TYPES[format]);
    res.set('Content-Disposition', `attachment; filename="${refName}.${format}"`);
    // The hash of the JSON of record, not of this particular rendering: the
    // same payload always certifies the same content whatever format it takes.
    res.set('X-Report-Hash', report.hash || '');
    res.set('X-Report-Source', 'json-payload');

    return res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
