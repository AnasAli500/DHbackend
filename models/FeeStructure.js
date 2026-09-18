const mongoose = require('mongoose');

const feeStructureSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // Fee Type / Name
    feeType: { type: String, default: 'Monthly Tuition Fee' },
    amount: { type: Number, required: true, min: 0 },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, required: true },
    frequency: {
      type: String,
      enum: ['Monthly', 'Termly', 'Annually', 'One Time'],
      default: 'Monthly',
    },
    term: { type: String, enum: ['Term 1', 'Term 2', 'Term 3', 'Annual', 'N/A'], default: 'N/A' },
    dueDate: { type: Date },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    description: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FeeStructure', feeStructureSchema);

