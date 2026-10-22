const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const audit = require('../middleware/audit');
const RulePack = require('../models/RulePack');
const rulePackFallback = require('../data/rulePack_v1.json');
const categories = require('../data/categories.json');

router.use(protect);

const fallbackRules = Array.isArray(rulePackFallback)
  ? rulePackFallback
  : rulePackFallback.rules || [];

/** Serves the active DB pack, falling back to the bundled v1 pack. */
async function activeRules() {
  const pack = await RulePack.findOne({ isActive: true });
  if (pack && pack.rules && pack.rules.length > 0) {
    return { version: pack.version, rules: pack.rules };
  }
  return { version: '1.0.0', rules: fallbackRules };
}

// GET /api/rules
router.get('/', async (req, res, next) => {
  try {
    const { version, rules } = await activeRules();
    const { search, severity, automationLevel } = req.query;

    let filtered = rules;

    if (search) {
      const q = String(search).toLowerCase();
      filtered = filtered.filter((r) =>
        [r.id, r.citation, r.subject, r.description]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q))
      );
    }
    if (severity) filtered = filtered.filter((r) => r.severity === severity);
    if (automationLevel) filtered = filtered.filter((r) => r.automationLevel === automationLevel);

    res.status(200).json({ success: true, data: filtered, meta: { version, total: filtered.length } });
  } catch (error) {
    next(error);
  }
});

// GET /api/rules/categories - category exemptions and deltas
router.get('/categories', (req, res) => {
  res.status(200).json({ success: true, data: categories });
});

// GET /api/rules/checklist/:inspectionId - rules applicable to one inspection
router.get('/checklist/:inspectionId', async (req, res, next) => {
  try {
    const Inspection = require('../models/Inspection');
    const inspection = await Inspection.findById(req.params.inspectionId).populate(
      'productId',
      'category'
    );

    if (!inspection) {
      return res
        .status(404)
        .json({ success: false, error: { message: 'Inspection not found', code: 404 } });
    }

    const categoryId = (inspection.productId && inspection.productId.category) || 'unknown';
    const { version, rules } = await activeRules();

    // Drop rules whose applicability excludes this product category.
    const applicable = rules.filter((r) => {
      const excluded = (r.applicability && r.applicability.excludeCategories) || [];
      return !excluded.includes(categoryId);
    });

    res.status(200).json({ success: true, data: applicable, meta: { version, categoryId } });
  } catch (error) {
    next(error);
  }
});

// GET /api/rules/packs
router.get('/packs', authorize('legal_officer', 'controller', 'auditor'), async (req, res, next) => {
  try {
    const packs = await RulePack.find().sort('-createdAt');
    res.status(200).json({ success: true, data: packs });
  } catch (error) {
    next(error);
  }
});

// POST /api/rules/packs
router.post('/packs', authorize('legal_officer'), audit, async (req, res, next) => {
  try {
    if (!req.body.version) {
      return res
        .status(400)
        .json({ success: false, error: { message: 'A pack version is required', code: 400 } });
    }

    const pack = await RulePack.create({ ...req.body, isActive: false, createdBy: req.user._id });
    res.status(201).json({ success: true, data: pack });
  } catch (error) {
    next(error);
  }
});

// PUT /api/rules/packs/:version/activate
router.put('/packs/:version/activate', authorize('legal_officer'), audit, async (req, res, next) => {
  try {
    const pack = await RulePack.findOne({ version: req.params.version });
    if (!pack) {
      return res
        .status(404)
        .json({ success: false, error: { message: 'Rule pack not found', code: 404 } });
    }

    await RulePack.updateMany({}, { isActive: false });
    pack.isActive = true;
    await pack.save();

    res.status(200).json({ success: true, data: pack });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
