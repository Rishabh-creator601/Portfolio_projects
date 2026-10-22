const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const Inspection = require('../models/Inspection');

// Every authenticated officer may read their console; field inspectors simply
// see the same figures scoped by the filters they are allowed to apply.
router.use(protect);

const RULE_LABELS = {
  R6_1_A: 'Rule 6(1)(a) Name & Address',
  R6_1_B: 'Rule 6(1)(b) Generic Name',
  R6_1_C: 'Rule 6(1)(c) Net Quantity',
  R6_1_D: 'Rule 6(1)(d) Month & Year',
  R6_1_E: 'Rule 6(1)(e) Retail Sale Price',
  R6_2: 'Rule 6(2) Consumer Care',
  R6_3: 'Rule 6(3) Sticker over MRP',
  R7_2_T1: 'Rule 7(2) Numeral Height',
  R7_2_T2: 'Rule 7(2) Panel Area Height',
  R7_3: 'Rule 7(3) Letter Proportions',
  R8_1: 'Rule 8(1) Clear Space',
  R9_1_A: 'Rule 9(1)(a) Legibility',
  R9_1_B: 'Rule 9(1)(b) Contrast',
  R9_2: 'Rule 9(2) Read Through Liquid',
  R9_4: 'Rule 9(4) Language',
  R11_2: 'Rule 11(2) When Packed',
  R12_2: 'Rule 12(2) Unit Class',
  R12_6: 'Rule 12(6) Misleading Wording',
  R13_2: 'Rule 13(2) Unit Subdivision'
};

// GET /api/dashboard/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [totalScanned, pendingReview, nonCompliant, compliant, penaltyAgg] = await Promise.all([
      Inspection.countDocuments(),
      Inspection.countDocuments({ status: 'under_review' }),
      Inspection.countDocuments({ verdict: 'non_compliant' }),
      Inspection.countDocuments({ verdict: 'compliant' }),
      Inspection.aggregate([{ $group: { _id: null, total: { $sum: '$penalties.total' } } }])
    ]);

    const adjudicated = compliant + nonCompliant;
    const complianceRate = adjudicated > 0 ? (compliant / adjudicated) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        totalScanned,
        pendingReview,
        totalViolations: nonCompliant,
        complianceRate: Number(complianceRate.toFixed(1)),
        penaltyExposure: (penaltyAgg[0] && penaltyAgg[0].total) || 0
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/violations - most frequently failed rules
router.get('/violations', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 6, 20);

    const violations = await Inspection.aggregate([
      { $unwind: '$results' },
      { $match: { 'results.verdict': 'FAIL' } },
      {
        $group: {
          _id: '$results.ruleId',
          count: { $sum: 1 },
          citation: { $first: '$results.citation' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: limit }
    ]);

    res.status(200).json({
      success: true,
      data: violations.map((v) => ({
        ruleId: v._id,
        citation: v.citation,
        rule: RULE_LABELS[v._id] || v.citation || v._id,
        count: v.count
      }))
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/trends - monthly compliance rate
router.get('/trends', async (req, res, next) => {
  try {
    const months = Math.min(Number(req.query.months) || 12, 24);
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const rows = await Inspection.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          total: { $sum: 1 },
          compliant: { $sum: { $cond: [{ $eq: ['$verdict', 'compliant'] }, 1, 0] } },
          nonCompliant: { $sum: { $cond: [{ $eq: ['$verdict', 'non_compliant'] }, 1, 0] } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const byKey = new Map(rows.map((r) => [`${r._id.year}-${r._id.month}`, r]));
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trends = [];

    for (let i = 0; i < months; i += 1) {
      const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
      const row = byKey.get(`${d.getFullYear()}-${d.getMonth() + 1}`);
      const total = row ? row.total : 0;
      const compliant = row ? row.compliant : 0;
      const adjudicated = compliant + (row ? row.nonCompliant : 0);

      trends.push({
        name: labels[d.getMonth()],
        month: `${labels[d.getMonth()]} ${d.getFullYear()}`,
        total,
        compliant,
        nonCompliant: row ? row.nonCompliant : 0,
        rate: adjudicated > 0 ? Number(((compliant / adjudicated) * 100).toFixed(1)) : 0
      });
    }

    res.status(200).json({ success: true, data: trends });
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/pending
router.get('/pending', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const pending = await Inspection.find({ status: { $in: ['under_review', 'extracted'] } })
      .sort('-createdAt')
      .limit(limit)
      .populate('officerId', 'displayName email role')
      .populate('productId', 'brand genericName category');

    res.status(200).json({
      success: true,
      data: pending.map((i) => ({
        _id: i._id,
        ref: i.ref,
        product: i.productId
          ? `${i.productId.brand || ''} ${i.productId.genericName || ''}`.trim()
          : i.extracted && i.extracted.genericName,
        reason: (i.results || []).some((r) => r.verdict === 'REVIEW')
          ? 'Automated check needs officer review'
          : 'Awaiting adjudication',
        officer: i.officerId && i.officerId.displayName,
        date: i.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/recent
router.get('/recent', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const recent = await Inspection.find()
      .sort('-createdAt')
      .limit(limit)
      .populate('officerId', 'displayName email')
      .populate('productId', 'brand genericName');

    res.status(200).json({
      success: true,
      data: recent.map((i) => ({
        _id: i._id,
        ref: i.ref,
        product: i.productId
          ? `${i.productId.brand || ''} ${i.productId.genericName || ''}`.trim()
          : (i.extracted && i.extracted.genericName) || 'Unidentified product',
        verdict: i.verdict,
        officer: i.officerId && i.officerId.displayName,
        date: i.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
