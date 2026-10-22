const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  inspectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inspection',
    required: true
  },
  // The report is stored as structured JSON, not as a rendered document. PDF,
  // DOCX and XLSX are produced on demand from `payload` at download time, so
  // one stored record can be re-rendered in any format and stays queryable.
  payload: {
    type: mongoose.Schema.Types.Mixed
  },
  // Denormalised from the payload so the repository list needs no joins.
  inspectionRef: {
    type: String,
    index: true
  },
  // Mirrors the inspection-level verdict vocabulary, which is distinct from the
  // per-rule PASS/FAIL/REVIEW scale used inside ruleResults.
  verdict: {
    type: String,
    enum: ['compliant', 'non_compliant', 'review', 'draft']
  },
  productLabel: {
    type: String
  },
  // 'json' is what new reports are stored as; the document formats remain for
  // records issued before the payload migration, which still live in GridFS.
  format: {
    type: String,
    enum: ['json', 'pdf', 'docx', 'xlsx'],
    default: 'json'
  },
  // Legacy: only set on reports that predate JSON storage.
  fileId: {
    type: mongoose.Schema.Types.ObjectId // GridFS ID
  },
  // The officer this report belongs to in the repository. issuedBy records who
  // pressed generate; ownerId is who it is filed under, and they can differ if a
  // Controller issues a report on another officer's inspection.
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  hash: {
    type: String // SHA-256
  },
  issuedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  issuedAt: {
    type: Date,
    default: Date.now
  },
  qrToken: {
    type: String,
    unique: true,
    sparse: true
  }
}, {
  timestamps: true
});

// Repository listing: a user's reports, newest first.
reportSchema.index({ ownerId: 1, issuedAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
