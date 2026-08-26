const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    schoolName: { type: String, default: 'School Management System' },
    schoolLogo: { type: String },
    schoolAddress: { type: String },
    schoolPhone: { type: String },
    schoolEmail: { type: String },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    emailNotifications: { type: Boolean, default: true },
    attendanceNotifications: { type: Boolean, default: true },
    examNotifications: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Settings', settingsSchema);
