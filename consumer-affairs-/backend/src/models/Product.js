const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  gtin: {
    type: String,
    index: true,
    sparse: true
  },
  brand: {
    type: String
  },
  genericName: {
    type: String
  },
  category: {
    type: String
  },
  imageHash: {
    type: String
  },
  declarations: {
    type: mongoose.Schema.Types.Mixed
  },
  complianceHistory: [{
    inspectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inspection'
    },
    verdict: {
      type: String
    },
    date: {
      type: Date
    },
    violations: {
      type: Number
    }
  }]
}, {
  timestamps: true
});

productSchema.index({ brand: 'text', genericName: 'text' });

module.exports = mongoose.model('Product', productSchema);
