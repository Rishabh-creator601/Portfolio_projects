const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  actorEmail: {
    type: String
  },
  action: {
    type: String
  },
  target: {
    type: String
  },
  before: {
    type: mongoose.Schema.Types.Mixed
  },
  after: {
    type: mongoose.Schema.Types.Mixed
  },
  ip: {
    type: String
  },
  userAgent: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Static method for logging
auditLogSchema.statics.logAction = async function(logData) {
  try {
    await this.create(logData);
  } catch (err) {
    console.error('Failed to log audit action:', err);
  }
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
