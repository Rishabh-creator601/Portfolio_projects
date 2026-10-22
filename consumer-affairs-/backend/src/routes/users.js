const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const audit = require('../middleware/audit');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { validate, updateUserSchema } = require('../utils/validators');

router.use(protect);
router.use(authorize('controller', 'auditor'));
router.use(audit);

// GET /api/users
router.get('/', async (req, res, next) => {
  try {
    const { role, isActive, search } = req.query;
    const query = {};

    if (role) query.role = role;
    if (isActive === 'true' || isActive === 'false') query.isActive = isActive === 'true';
    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { email: { $regex: safe, $options: 'i' } },
        { displayName: { $regex: safe, $options: 'i' } }
      ];
    }

    const users = await User.find(query).sort('displayName');
    res.status(200).json({ success: true, data: users.map((u) => u.toSafeJSON()) });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/:id
router.get('/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: { message: 'User not found', code: 404 } });
    }
    res.status(200).json({ success: true, data: user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/:id
router.put('/:id', authorize('controller'), validate(updateUserSchema), async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: { message: 'User not found', code: 404 } });
    }

    // A controller must not be able to lock themselves out of the console.
    if (user._id.equals(req.user._id) && (req.body.role || req.body.isActive === false)) {
      return res.status(400).json({
        success: false,
        error: { message: 'You cannot change your own role or deactivate your own account', code: 400 }
      });
    }

    const before = user.toSafeJSON();
    Object.assign(user, req.body);

    // Revoke live sessions when access is reduced or removed.
    if (req.body.role !== undefined || req.body.isActive === false) {
      user.tokenVersion += 1;
      user.refreshTokenHash = undefined;
    }

    await user.save();

    AuditLog.logAction({
      actor: req.user._id,
      actorEmail: req.user.email,
      action: 'user.update',
      target: `user:${user._id}`,
      before,
      after: user.toSafeJSON(),
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }).catch(() => {});

    res.status(200).json({ success: true, data: user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/users/:id - soft delete, revoking any live session
router.delete('/:id', authorize('controller'), async (req, res, next) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: { message: 'You cannot deactivate your own account', code: 400 }
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false }, $inc: { tokenVersion: 1 }, $unset: { refreshTokenHash: 1 } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, error: { message: 'User not found', code: 404 } });
    }

    res.status(200).json({ success: true, data: user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/:id/audit
router.get('/:id/audit', async (req, res, next) => {
  try {
    const logs = await AuditLog.find({ actor: req.params.id }).sort('-timestamp').limit(50);
    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
