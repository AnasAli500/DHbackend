const mongoose = require('mongoose');

const processedResultSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment' },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    examSeasonId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSeason', required: true },
    academicYear: { type: String },
    totalMarksObtained: { type: Number, required: true, default: 0 },
    totalMaxMarks: { type: Number, required: true, default: 0 },
    percentage: { type: Number, required: true, default: 0 },
    overallGrade: { type: String, default: 'F' },
    gpa: { type: Number, default: 0 },
    rank: { type: Number, default: 0 },
    position: { type: String, default: 'N/A' },
    passedSubjectsCount: { type: Number, default: 0 },
    failedSubjectsCount: { type: Number, default: 0 },
    missingSubjectsCount: { type: Number, default: 0 },
    isOverallPassed: { type: Boolean, default: false },
    teacherRemarks: { type: String, default: 'Good effort.' },
    principalRemarks: { type: String, default: 'Satisfactory performance.' },
    status: { type: String, enum: ['Draft', 'Processed', 'Published'], default: 'Processed' },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

processedResultSchema.index({ studentId: 1, classId: 1, examSeasonId: 1 }, { unique: true });

module.exports = mongoose.model('ProcessedResult', processedResultSchema);
