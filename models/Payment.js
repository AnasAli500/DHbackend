const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, unique: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    feeId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeStructure' },
    feeName: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0 },
    balance: { type: Number, default: 0 },
    paymentDate: { type: Date, required: true, default: Date.now },
    paymentMethod: { type: String, enum: ['Cash', 'Bank Transfer', 'Mobile Money'], required: true },
    status: { type: String, enum: ['Paid', 'Partial', 'Pending'], default: 'Pending' },
    academicYear: { type: String },
    term: { type: String, enum: ['Term 1', 'Term 2', 'Term 3', 'Annual'] },
    note: { type: String },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
