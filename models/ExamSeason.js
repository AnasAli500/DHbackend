const mongoose = require('mongoose');

const examSeasonSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, { timestamps: true });

examSeasonSchema.index({ name: 1, categoryId: 1 }, { unique: true });
module.exports = mongoose.model('ExamSeason', examSeasonSchema);
