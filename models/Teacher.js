const mongoose = require('mongoose');

const teacherAssignmentSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true },
    classes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  },
  { _id: false }
);

const teacherSchema = new mongoose.Schema(
  {
    teacherId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: { type: String, trim: true, default: '' },
    subject: { type: String, default: '' }, // Joined list of subjects or primary subject for backward compatibility
    subjects: [{ type: String, trim: true }],
    assignments: [teacherAssignmentSchema],
    periodId: { type: mongoose.Schema.Types.ObjectId, ref: 'Period' },
    hasAccount: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Teacher', teacherSchema);
