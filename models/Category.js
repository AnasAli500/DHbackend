const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, unique: true },
    academicType: { type: String, required: true, enum: ['Semester', 'Annual', 'National'] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', categorySchema);
