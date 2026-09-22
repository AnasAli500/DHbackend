const mongoose = require('mongoose');

const familyGroupSchema = new mongoose.Schema(
  {
    familyName: { type: String, required: true, trim: true },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FamilyGroup', familyGroupSchema);
