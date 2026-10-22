const AuditLog = require('../models/AuditLog');

const audit = (req, res, next) => {
  // Fire and forget
  res.on('finish', () => {
    try {
      const actorId = req.user ? req.user._id : null;
      const actorEmail = req.user ? req.user.email : 'anonymous';
      
      AuditLog.logAction({
        actor: actorId,
        actorEmail,
        action: `${req.method} ${req.originalUrl}`,
        target: 'API',
        ip: req.ip,
        userAgent: req.get('User-Agent')
      }).catch(err => console.error('Audit log failed:', err));
    } catch (err) {
      console.error('Audit middleware error:', err);
    }
  });
  
  next();
};

module.exports = audit;
