const mongoose = require('mongoose');

const examSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment' },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    examSeasonId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSeason', required: true },
    examStructureId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamStructure', required: true },
    periodId: { type: mongoose.Schema.Types.ObjectId, ref: 'Period', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    examPhase: { type: String, required: true, trim: true },
    examType: { type: String, required: true, trim: true },
    examName: { type: String, required: true, trim: true },
    marks: { type: Number, required: true, min: 0 },
    totalMarks: { type: Number, required: true, min: 1 },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    grade: { type: String, required: true },
    examDate: { type: Date, required: true },
    attendance: { type: String, enum: ['Present', 'Absent', 'Excused', 'Late'], default: 'Present' },
    remarks: { type: String, default: '' },
    status: { type: String, enum: ['Draft', 'Processed', 'Published'], default: 'Draft' },
    gpa: { type: Number, default: 0 },
    isPassed: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

examSchema.index({ studentId: 1, periodId: 1, examName: 1, examDate: 1 }, { unique: true });

module.exports = mongoose.model('Exam', examSchema);
