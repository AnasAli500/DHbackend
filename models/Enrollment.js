const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, required: true },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    status: {
      type: String,
      enum: ['Active', 'Completed', 'Transferred', 'Withdrawn'],
      default: 'Active',
    },
    promotionStatus: {
      type: String,
      enum: ['Promoted', 'Not Promoted', 'Graduated', 'Transferred', 'Repeating', 'Pending'],
      default: 'Pending',
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

enrollmentSchema.index({ studentId: 1, classId: 1, academicYear: 1 });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
