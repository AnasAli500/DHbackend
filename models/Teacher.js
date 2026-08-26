const mongoose = require('mongoose');

const teacherSchema = new mongoose.Schema(
  {
    teacherId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
    phone: { type: String },
    address: { type: String },
    subject: { type: String, required: true },
    periodId: { type: mongoose.Schema.Types.ObjectId, ref: 'Period' },
    hasAccount: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Teacher', teacherSchema);
