const mongoose = require('mongoose');

const inspectionSchema = new mongoose.Schema({
  ref: {
    type: String,
    unique: true
  },
  officerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  geo: {
    lat: Number,
    lng: Number
  },
  capturedAt: {
    type: Date,
    default: Date.now
  },
  images: [{
    originalFileId: mongoose.Schema.Types.ObjectId,
    compressedFileId: mongoose.Schema.Types.ObjectId,
    panel: {
      type: String,
      enum: ['principal', 'side', 'back', 'other']
    },
    metadata: mongoose.Schema.Types.Mixed
  }],
  ocrTokens: [{
    text: String,
    bbox: [Number],
    confidence: Number,
    panel: String
  }],
  extracted: {
    manufacturer: {
      name: String,
      address: String,
      qualifier: String
    },
    genericName: String,
    netQuantity: {
      value: Number,
      unit: String,
      raw: String
    },
    monthYear: {
      // Kept loose: OCR yields either a numeral ('08') or a month name ('Aug').
      month: mongoose.Schema.Types.Mixed,
      year: mongoose.Schema.Types.Mixed,
      raw: String
    },
    mrp: {
      value: Number,
      wording: String,
      raw: String
    },
    consumerCare: {
      name: String,
      address: String,
      phone: String,
      email: String
    },
    dimensions: String,
    additionalInfo: mongoose.Schema.Types.Mixed
  },
  results: [{
    ruleId: String,
    citation: String,
    check: String,
    found: String,
    required: String,
    verdict: {
      type: String,
      // NOT_ASSESSED is distinct from REVIEW: review means the system tried and
      // hesitated; not-assessed means this build never attempts the check.
      enum: ['PASS', 'FAIL', 'REVIEW', 'NOT_APPLICABLE', 'NOT_ASSESSED']
    },
    // The rule modules report a qualitative band ('HIGH'), while OCR-derived
    // results carry a numeric probability - both are stored as written.
    confidence: mongoose.Schema.Types.Mixed,
    evidenceCrop: mongoose.Schema.Types.Mixed,
    measuredValue: mongoose.Schema.Types.Mixed,
    prescribedValue: mongoose.Schema.Types.Mixed,
    overridden: {
      type: Boolean,
      default: false
    },
    overrideVerdict: String,
    note: String,
    overrideReason: String,
    overrideBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    overrideAt: Date
  }],
  verdict: {
    type: String,
    enum: ['compliant', 'non_compliant', 'review', 'draft'],
    default: 'draft'
  },
  status: {
    type: String,
    enum: ['draft', 'extracted', 'under_review', 'adjudicated', 'notice_issued', 'closed'],
    default: 'draft'
  },
  rulePackVersion: String,
  // Client-facing extraction report produced by the Gemini path. Stored whole
  // so the report an officer downloaded can be reproduced exactly later.
  extractionReport: mongoose.Schema.Types.Mixed,
  // Which engine actually read this label: 'gemini' or 'ocr-fallback'. An
  // officer cannot judge how far to trust an extraction without knowing.
  extractionSource: String,
  // Counts, resolved category and scope-gate outcome for the evaluated rows.
  complianceSummary: mongoose.Schema.Types.Mixed,
  remarks: String,
  penalties: {
    total: Number,
    breakdown: [{
      ruleId: String,
      amount: Number
    }]
  },
  attachments: [{
    fileId: mongoose.Schema.Types.ObjectId,
    mimeType: String,
    description: String,
    hash: String
  }]
}, {
  timestamps: true
});

// Auto-generate ref number
inspectionSchema.pre('save', async function(next) {
  if (this.isNew && !this.ref) {
    const count = await mongoose.model('Inspection').countDocuments();
    this.ref = `INS-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Inspection', inspectionSchema);
