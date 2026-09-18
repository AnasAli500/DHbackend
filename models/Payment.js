const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, unique: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    feeId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeStructure', required: true },
    feeName: { type: String, required: true },
    academicYear: { type: String, required: true },
    billingYear: { type: Number, default: null },
    billingMonth: { type: String, default: null },
    originalAmount: { type: Number, required: true, min: 0 },
    discountType: { type: String, enum: ['Fixed', 'Percentage'], default: 'Fixed' },
    discountValue: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    amountRequired: { type: Number, required: true, min: 0 },
    previouslyPaid: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, required: true, min: 0 }, // Current payment amount
    balance: { type: Number, default: 0, min: 0 }, // Remaining pending balance
    paymentDate: { type: Date, required: true, default: Date.now },
    paymentMethod: { type: String, enum: ['Cash', 'Bank Transfer', 'Mobile Money', 'Other'], default: 'Cash' },
    referenceNumber: { type: String, default: '' },
    status: { type: String, enum: ['Paid', 'Partial', 'Pending', 'Overdue'], default: 'Pending' },
    term: { type: String, default: '' },
    note: { type: String, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);

