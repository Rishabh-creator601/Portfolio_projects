const mongoose = require('mongoose');

const rulePackSchema = new mongoose.Schema({
  version: {
    type: String,
    unique: true,
    required: true
  },
  effectiveFrom: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  rules: [{
    id: String,
    citation: String,
    subject: String,
    description: String,
    applicability: mongoose.Schema.Types.Mixed,
    predicate: String,
    severity: {
      type: String,
      enum: ['critical', 'major', 'minor']
    },
    penaltyAmount: Number,
    automationLevel: {
      type: String,
      enum: ['full', 'assisted', 'flagged']
    }
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('RulePack', rulePackSchema);
