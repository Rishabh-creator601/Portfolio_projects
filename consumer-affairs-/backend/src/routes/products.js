const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const audit = require('../middleware/audit');
const Product = require('../models/Product');
const Inspection = require('../models/Inspection');

router.use(protect);
router.use(audit);

// GET /api/products
router.get('/', async (req, res, next) => {
  try {
    const { search, category, verdict } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const query = {};

    // Regex rather than $text so partial GTIN and brand fragments both match.
    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { brand: { $regex: safe, $options: 'i' } },
        { genericName: { $regex: safe, $options: 'i' } },
        { gtin: { $regex: safe, $options: 'i' } }
      ];
    }
    if (category) query.category = category;
    if (verdict) query['complianceHistory.verdict'] = verdict;

    const [items, total] = await Promise.all([
      Product.find(query)
        .sort('-updatedAt')
        .skip((page - 1) * limit)
        .limit(limit),
      Product.countDocuments(query)
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

// GET /api/products/categories - distinct categories currently in the repository
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await Product.distinct('category');
    res.status(200).json({ success: true, data: categories.filter(Boolean).sort() });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: { message: 'Product not found', code: 404 } });
    }
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/:id/history
router.get('/:id/history', async (req, res, next) => {
  try {
    const inspections = await Inspection.find({ productId: req.params.id })
      .sort('-createdAt')
      .populate('officerId', 'displayName');

    res.status(200).json({ success: true, data: inspections });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
