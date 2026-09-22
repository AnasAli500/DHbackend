const mongoose = require('mongoose');

const allocationSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
    allocatedAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const familyPaymentSchema = new mongoose.Schema(
  {
    // Unique group receipt number e.g. FP-000001
    receiptGroupNo: { type: String, required: true, unique: true },
    // Optional — not required if students are not formally in a FamilyGroup
    familyGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'FamilyGroup', default: null },
    academicYear: { type: String, required: true },
    totalPaid: { type: Number, required: true, min: 0 },
    paymentDate: { type: Date, required: true, default: Date.now },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'Bank Transfer', 'Mobile Money', 'Other'],
      default: 'Cash',
    },
    referenceNumber: { type: String, default: '' },
    note: { type: String, default: '' },
    // One entry per student in this payment
    allocations: { type: [allocationSchema], default: [] },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FamilyPayment', familyPaymentSchema);
