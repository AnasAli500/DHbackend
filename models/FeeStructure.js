const mongoose = require('mongoose');

const feeStructureSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    academicYear: { type: String, required: true },
    term: { type: String, enum: ['Term 1', 'Term 2', 'Term 3', 'Annual'], required: true },
    dueDate: { type: Date },
    description: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FeeStructure', feeStructureSchema);
