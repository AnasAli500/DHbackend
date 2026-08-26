const mongoose = require('mongoose');

const examStructureSchema = new mongoose.Schema({
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  seasonId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSeason', required: true },
  examType: { type: String, required: true, trim: true },
  maxMarks: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, { timestamps: true });

examStructureSchema.index({ categoryId: 1, seasonId: 1, examType: 1 }, { unique: true });
module.exports = mongoose.model('ExamStructure', examStructureSchema);
