const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true },
    registeredDate: { type: Date, default: Date.now },
    name: { type: String, required: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
    dateOfBirth: { type: Date },
    motherName: { type: String, default: '' },
    phone: { type: String },
    birthplace: { type: String, default: '' },
    nationality: { type: String, default: '' },
    address: { type: String },
    state: { type: String, default: '' },
    region: { type: String, default: '' },
    district: { type: String, default: '' },
    village: { type: String, default: '' },
    orphanStatus: { type: String, enum: ['Yes', 'No'], default: 'No' },
    disabilityStatus: { type: String, enum: ['Yes', 'No'], default: 'No' },
    guardianName: { type: String, default: '' },
    guardianPhone: { type: String, default: '' },
    parentPhone: { type: String, default: '' },
    refugeeStatus: { type: String, enum: ['Yes', 'No'], default: 'No' },
    schoolType: { type: String, enum: ['Primary', 'Secondary', ''], default: '' },
    schoolName: { type: String, default: '' },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    transferStatus: { type: String, enum: ['In Progress', 'Completed', ''], default: '' },
    monthlyFee: { type: Number, default: 0 },
    admissionFee: { type: Number, default: 0 },
    hasAccount: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Student', studentSchema);
