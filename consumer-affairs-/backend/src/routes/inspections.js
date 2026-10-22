const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const audit = require('../middleware/audit');
const { array, single } = require('../middleware/upload');
const Inspection = require('../models/Inspection');
const Product = require('../models/Product');
const { getGridFSBucket } = require('../config/db');
const { analyzeImage } = require('../services/ocrStub');
const {
  extractDeclarations,
  toInspectionExtracted,
  toRuleEngineInput
} = require('../services/extractionService');
const { evaluateCompliance } = require('../services/ruleEngine');
const visionClient = require('../services/visionClient');
const { EXTRACTION_MODE } = require('../config/env');
const { evaluateExtraction, deriveVerdict } = require('../services/geminiCompliance');

router.use(protect);
router.use(audit);

const notFound = (res) =>
  res.status(404).json({ success: false, error: { message: 'Inspection not found', code: 404 } });

/** Field inspectors may only act on inspections they raised. */
const canEdit = (inspection, user) =>
  user.role !== 'field_inspector' || inspection.officerId.equals(user._id);

const forbidden = (res) =>
  res.status(403).json({
    success: false,
    error: { message: 'You may only modify inspections you raised', code: 403 }
  });

// POST /api/inspections
router.post('/', authorize('field_inspector', 'senior_inspector', 'controller'), async (req, res, next) => {
  try {
    const { productId, geo, ocrTokens } = req.body;

    const inspection = await Inspection.create({
      officerId: req.user._id,
      productId: productId || undefined,
      geo,
      ocrTokens: Array.isArray(ocrTokens) ? ocrTokens : []
    });

    res.status(201).json({ success: true, data: inspection });
  } catch (error) {
    next(error);
  }
});

// GET /api/inspections
router.get('/', async (req, res, next) => {
  try {
    const { status, verdict, officerId, search } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const query = {};
    if (status) query.status = status;
    if (verdict) query.verdict = verdict;
    if (officerId) query.officerId = officerId;
    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.ref = { $regex: safe, $options: 'i' };
    }

    // A field inspector's list is scoped to their own work.
    if (req.user.role === 'field_inspector') query.officerId = req.user._id;

    const [items, total] = await Promise.all([
      Inspection.find(query)
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('officerId', 'displayName email role')
        .populate('productId', 'brand genericName category'),
      Inspection.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: items,
      meta: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/inspections/:id
router.get('/:id', async (req, res, next) => {
  try {
    const inspection = await Inspection.findById(req.params.id)
      .populate('officerId', 'displayName email role jurisdiction')
      .populate('productId');

    if (!inspection) return notFound(res);
    res.status(200).json({ success: true, data: inspection });
  } catch (error) {
    next(error);
  }
});

// POST /api/inspections/:id/vision - capture an image and extract from it
//
// EXTRACTION_MODE decides what runs:
//
//   "gemini"  the model transcribes the label and locates its regions. The OCR
//             engines, the millimetre measurement stages and the rule engine
//             are dormant -- no verdicts are produced, only what was read.
//   "legacy"  the original OCR + Sauvola/connected-components pipeline, which
//             measures glyph heights and feeds the statutory rule engine.
//
// The dormant path is left in the codebase and simply not called.
router.post(
  '/:id/vision',
  authorize('field_inspector', 'senior_inspector', 'controller'),
  single,
  async (req, res, next) => {
    try {
      const inspection = await Inspection.findById(req.params.id);
      if (!inspection) return notFound(res);
      if (!canEdit(inspection, req.user)) return forbidden(res);

      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, error: { message: 'An image file is required', code: 400 } });
      }

      // --- active path: Gemini extraction ---------------------------------
      if (EXTRACTION_MODE === 'gemini') {
        const result = await visionClient.extract(req.file, { buildReport: true });

        if (!result) {
          return res.status(503).json({
            success: false,
            error: {
              message:
                'The extraction service is unavailable. Nothing was read from this image, ' +
                'so no extraction has been recorded against the inspection.',
              code: 503
            }
          });
        }

        inspection.extracted = result.declarations;
        inspection.extractionReport = result.report;
        inspection.extractionSource = result.source;
        inspection.ocrTokens = [];
        inspection.status = 'extracted';
        // No verdicts in this mode: the rule engine is dormant, and an empty
        // results array is honest where a fabricated one would not be.
        inspection.results = [];
        inspection.verdict = 'draft';
        inspection.penalties = { total: 0, breakdown: [] };
        await inspection.save();

        return res.status(200).json({
          success: true,
          data: inspection,
          meta: {
            mode: result.mode || 'gemini',
            source: result.source,
            engine: result.engine,
            keyUsed: result.keyUsed,
            usage: result.usage,
            regionsDetected: result.detections.length,
            imageHash: result.imageHash,
            warnings: result.warnings || []
          }
        });
      }

      // --- dormant path: OCR + millimetre measurement ----------------------
      const result = await visionClient.analyze(req.file, {
        panel: req.body.panel || 'principal',
        referenceWidthMm: req.body.referenceWidthMm ? Number(req.body.referenceWidthMm) : undefined,
        referenceKind: req.body.referenceKind,
        isCurvedSurface: req.body.isCurvedSurface === 'true',
        isBlownOrMoulded: req.body.isBlownOrMoulded === 'true',
        languages: req.body.languages ? String(req.body.languages).split(',') : ['en']
      });

      const extraction = extractDeclarations(result.tokens);

      inspection.ocrTokens = result.tokens;
      inspection.extracted = toInspectionExtracted(extraction, {
        panel: req.body.panel || 'principal',
        isBlownOrMoulded: req.body.isBlownOrMoulded === 'true',
        engine: result.engine,
        imageHash: result.imageHash,
        measurements: result.measurements,
        warnings: result.warnings
      });
      inspection.status = 'extracted';
      await inspection.save();

      res.status(200).json({
        success: true,
        data: inspection,
        meta: {
          mode: 'legacy',
          engine: result.engine,
          source: result.source,
          processingTimeMs: result.processingTimeMs,
          warnings: result.warnings
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/inspections/:id/extract - map already-read tokens onto the six heads
router.put(
  '/:id/extract',
  authorize('field_inspector', 'senior_inspector', 'controller'),
  async (req, res, next) => {
    try {
      const inspection = await Inspection.findById(req.params.id);
      if (!inspection) return notFound(res);
      if (!canEdit(inspection, req.user)) return forbidden(res);

      // Use tokens supplied by the client, those already stored, or the OCR sidecar stub.
      let tokens = Array.isArray(req.body.ocrTokens) ? req.body.ocrTokens : inspection.ocrTokens;
      if (!tokens || tokens.length === 0) {
        tokens = analyzeImage().tokens;
      }

      const extraction = extractDeclarations(tokens);
      const existing = (inspection.extracted && inspection.extracted.additionalInfo) || {};

      inspection.ocrTokens = tokens;
      inspection.extracted = toInspectionExtracted(extraction, {
        panel: req.body.panel || existing.panel,
        isBlownOrMoulded:
          req.body.isBlownOrMoulded !== undefined
            ? Boolean(req.body.isBlownOrMoulded)
            : existing.isBlownOrMoulded,
        // Measurements are not re-derived here; a re-tag must not silently
        // discard what the vision pass measured from the original capture.
        measurements: existing.visionMeasurements,
        engine: existing.ocrEngine,
        imageHash: existing.imageHash,
        warnings: existing.visionWarnings
      });
      inspection.status = 'extracted';
      await inspection.save();

      res.status(200).json({ success: true, data: inspection });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/inspections/:id/evaluate - deterministic rule engine pass
router.put('/:id/evaluate', async (req, res, next) => {
  try {
    // Gemini mode evaluates the *extraction* against the same deterministic rule
    // pack. The model transcribed the label; these verdicts come from pure
    // functions over that transcription, so a finding stays reproducible.
    //
    // The geometry rules (7(2), 7(3), 8(1), 9(1)(b)) are reported NOT_ASSESSED:
    // they prescribe millimetres, and an extraction carries no measurement.
    if (EXTRACTION_MODE === 'gemini') {
      const current = await Inspection.findById(req.params.id).populate('productId', 'category');
      if (!current) return notFound(res);
      if (!canEdit(current, req.user)) return forbidden(res);

      if (!current.extracted || !current.extracted.genericName) {
        return res.status(409).json({
          success: false,
          error: {
            message:
              'This inspection has no extraction yet. Capture an image first, then evaluate.',
            code: 409
          }
        });
      }

      const evaluation = evaluateExtraction(current.extracted, {
        categoryId:
          req.body.categoryId || (current.productId && current.productId.category) || undefined
      });

      current.results = evaluation.results;
      current.verdict = deriveVerdict(evaluation);
      current.penalties = {
        total: evaluation.penaltyExposure.total,
        breakdown: evaluation.penaltyExposure.breakdown.map((b) => ({
          ruleId: b.ruleId,
          amount: b.penalty
        }))
      };
      current.rulePackVersion = evaluation.summary.rulePackVersion;
      current.status = 'under_review';
      current.complianceSummary = {
        ...evaluation.summary,
        inScope: evaluation.inScope,
        scope: evaluation.scope,
        categoryMatchedOn: evaluation.category.matchedOn,
        categoryConfidence: evaluation.category.confidence,
        categoryNote: evaluation.category.note
      };
      await current.save();

      return res.status(200).json({
        success: true,
        data: current,
        meta: {
          mode: 'gemini',
          evaluated: true,
          inScope: evaluation.inScope,
          category: evaluation.category,
          summary: evaluation.summary,
          note:
            'Verdicts are produced by the deterministic rule pack over the extracted ' +
            'declarations. Rules prescribing millimetres are reported as not assessed, ' +
            'because this path reads the label but does not measure it.'
        }
      });
    }

    const inspection = await Inspection.findById(req.params.id).populate('productId', 'category');
    if (!inspection) return notFound(res);
    if (!canEdit(inspection, req.user)) return forbidden(res);

    const categoryId =
      req.body.categoryId || (inspection.productId && inspection.productId.category) || 'unknown';

    // Measurements come from the vision pass stored on the inspection. A caller
    // may override them (re-measuring with a better capture), but nothing is
    // invented here: with no measurements, the geometry rules return REVIEW.
    const additional = (inspection.extracted && inspection.extracted.additionalInfo) || {};
    const measurements =
      req.body.measurements || req.body.calibrationData || additional.visionMeasurements || null;

    const evaluation = evaluateCompliance(
      toRuleEngineInput(inspection.extracted),
      inspection.rulePackVersion || '1.0.0',
      categoryId,
      measurements
    );

    inspection.results = evaluation.results;
    inspection.penalties = {
      total: evaluation.penaltyExposure.total,
      breakdown: evaluation.penaltyExposure.breakdown.map((b) => ({
        ruleId: b.ruleId,
        amount: b.penalty
      }))
    };
    inspection.rulePackVersion = '1.0.0';

    const hasFail = evaluation.results.some((r) => r.verdict === 'FAIL');
    const hasReview = evaluation.results.some((r) => r.verdict === 'REVIEW');

    inspection.verdict = hasFail ? 'non_compliant' : hasReview ? 'review' : 'compliant';
    inspection.status = 'under_review';
    await inspection.save();

    res.status(200).json({ success: true, data: inspection });
  } catch (error) {
    next(error);
  }
});

// PUT /api/inspections/:id/override - officer overrides a single rule verdict
router.put('/:id/override', authorize('senior_inspector', 'controller'), async (req, res, next) => {
  try {
    const { ruleId, overrideVerdict, overrideReason } = req.body;

    if (!ruleId || !['PASS', 'FAIL', 'REVIEW', 'NOT_APPLICABLE'].includes(overrideVerdict)) {
      return res.status(400).json({
        success: false,
        error: { message: 'ruleId and a valid overrideVerdict are required', code: 400 }
      });
    }

    if (!overrideReason || String(overrideReason).trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: { message: 'An override reason of at least 10 characters is required', code: 400 }
      });
    }

    const inspection = await Inspection.findById(req.params.id);
    if (!inspection) return notFound(res);

    const result = inspection.results.find((r) => r.ruleId === ruleId);
    if (!result) {
      return res
        .status(404)
        .json({ success: false, error: { message: `No result for rule ${ruleId}`, code: 404 } });
    }

    result.overridden = true;
    result.overrideVerdict = overrideVerdict;
    result.overrideReason = String(overrideReason).trim();
    result.overrideBy = req.user._id;
    result.overrideAt = new Date();

    // Penalty exposure follows the effective verdict after overrides.
    const effective = (r) => (r.overridden ? r.overrideVerdict : r.verdict);
    const failing = inspection.results.filter((r) => effective(r) === 'FAIL');
    inspection.penalties = {
      total: failing.reduce((sum, r) => sum + (r.ruleId === 'R31_2' ? 4000 : 2000), 0),
      breakdown: failing.map((r) => ({ ruleId: r.ruleId, amount: r.ruleId === 'R31_2' ? 4000 : 2000 }))
    };

    await inspection.save();
    res.status(200).json({ success: true, data: inspection });
  } catch (error) {
    next(error);
  }
});

// PUT /api/inspections/:id/adjudicate
router.put('/:id/adjudicate', authorize('controller', 'senior_inspector'), async (req, res, next) => {
  try {
    const { verdict, remarks } = req.body;

    if (!['compliant', 'non_compliant', 'review'].includes(verdict)) {
      return res.status(400).json({
        success: false,
        error: { message: 'verdict must be compliant, non_compliant or review', code: 400 }
      });
    }

    const inspection = await Inspection.findById(req.params.id);
    if (!inspection) return notFound(res);

    inspection.verdict = verdict;
    inspection.remarks = remarks;
    inspection.status = 'adjudicated';
    await inspection.save();

    if (inspection.productId) {
      await Product.findByIdAndUpdate(inspection.productId, {
        $push: {
          complianceHistory: {
            inspectionId: inspection._id,
            verdict,
            date: new Date(),
            violations: inspection.results.filter((r) => r.verdict === 'FAIL').length
          }
        }
      });
    }

    res.status(200).json({ success: true, data: inspection });
  } catch (error) {
    next(error);
  }
});

// POST /api/inspections/:id/attachments
router.post('/:id/attachments', array, async (req, res, next) => {
  try {
    const inspection = await Inspection.findById(req.params.id);
    if (!inspection) return notFound(res);
    if (!canEdit(inspection, req.user)) return forbidden(res);

    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: { message: 'At least one image is required', code: 400 } });
    }

    const bucket = getGridFSBucket();
    const { computeHash } = require('../utils/hashUtils');

    const uploads = req.files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const stream = bucket.openUploadStream(file.originalname, { contentType: file.mimetype });
          stream.on('error', reject);
          stream.on('finish', () =>
            resolve({
              fileId: stream.id,
              mimeType: file.mimetype,
              description: file.originalname,
              hash: computeHash(file.buffer)
            })
          );
          stream.end(file.buffer);
        })
    );

    inspection.attachments.push(...(await Promise.all(uploads)));
    await inspection.save();

    res.status(201).json({ success: true, data: inspection });
  } catch (error) {
    next(error);
  }
});

// PUT /api/inspections/:id/status
router.put('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['draft', 'extracted', 'under_review', 'adjudicated', 'notice_issued', 'closed'];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { message: `status must be one of: ${allowed.join(', ')}`, code: 400 }
      });
    }

    const inspection = await Inspection.findById(req.params.id);
    if (!inspection) return notFound(res);
    if (!canEdit(inspection, req.user)) return forbidden(res);

    inspection.status = status;
    await inspection.save();

    res.status(200).json({ success: true, data: inspection });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
