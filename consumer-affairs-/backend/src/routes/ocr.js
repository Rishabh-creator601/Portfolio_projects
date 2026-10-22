const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const { single } = require('../middleware/upload');
const visionClient = require('../services/visionClient');
const { computeImageHash } = require('../services/imageService');

router.use(protect);

// POST /api/ocr/analyze - full vision pipeline: read and measure
router.post('/analyze', single, async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: { message: 'An image file is required', code: 400 } });
    }

    const result = await visionClient.analyze(req.file, {
      panel: req.body.panel || 'principal',
      referenceWidthMm: req.body.referenceWidthMm ? Number(req.body.referenceWidthMm) : undefined,
      referenceKind: req.body.referenceKind,
      isCurvedSurface: req.body.isCurvedSurface === 'true',
      isBlownOrMoulded: req.body.isBlownOrMoulded === 'true',
      languages: req.body.languages ? String(req.body.languages).split(',') : ['en'],
      engine: req.body.engine
    });

    res.status(200).json({
      success: true,
      data: {
        tokens: result.tokens,
        engine: result.engine,
        source: result.source,
        measurements: result.measurements,
        imageHash: result.imageHash || computeImageHash(req.file.buffer),
        processingTime: result.processingTimeMs,
        warnings: result.warnings
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/ocr/read - tokens only, without the measurement stages
router.post('/read', single, async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: { message: 'An image file is required', code: 400 } });
    }

    const result = await visionClient.readTokens(req.file, {
      languages: req.body.languages ? String(req.body.languages).split(',') : ['en'],
      engine: req.body.engine
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// GET /api/ocr/status - which engine is live, and what it can do
router.get('/status', async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await visionClient.status() });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
