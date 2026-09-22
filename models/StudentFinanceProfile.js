const mongoose = require('mongoose');

const discountHistorySchema = new mongoose.Schema(
  {
    financeStatus: { type: String, enum: ['normal', 'discounted', 'free'], default: 'normal' },
    discountType: { type: String, enum: ['Fixed', 'Percentage'], default: 'Fixed' },
    discountValue: { type: Number, default: 0 },
    note: { type: String, default: '' },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const studentFinanceProfileSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      unique: true,
    },
    // 'normal' = no discount applied
    // 'discounted' = fixed or percentage discount applied
    // 'free' = 100% free, amountRequired = 0 for all fees
    financeStatus: {
      type: String,
      enum: ['normal', 'discounted', 'free'],
      default: 'normal',
    },
    discountType: { type: String, enum: ['Fixed', 'Percentage'], default: 'Fixed' },
    discountValue: { type: Number, default: 0, min: 0 },
    // History of all changes to this student's finance profile
    discountHistory: { type: [discountHistorySchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudentFinanceProfile', studentFinanceProfileSchema);
