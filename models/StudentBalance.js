const mongoose = require('mongoose');

const studentBalanceSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    feeStructureId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeStructure', required: true },
    billingYear: { type: Number, default: null }, // e.g., 2026 for Monthly fees
    billingMonth: { type: String, default: null }, // e.g., 'September' for Monthly fees
    discountType: { type: String, enum: ['Fixed', 'Percentage'], default: 'Fixed' },
    discountValue: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    amountRequired: { type: Number, default: 0, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

studentBalanceSchema.index({ studentId: 1, feeStructureId: 1, billingYear: 1, billingMonth: 1 }, { unique: true });

module.exports = mongoose.model('StudentBalance', studentBalanceSchema);
