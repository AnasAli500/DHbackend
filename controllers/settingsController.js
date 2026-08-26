const Settings = require('../models/Settings');
const fs = require('fs');
const path = require('path');

exports.getSettings = async (req, res) => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  res.json(settings);
};

exports.getPublicSettings = async (req, res) => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  res.json({
    schoolName: settings.schoolName,
    schoolLogo: settings.schoolLogo,
    schoolAddress: settings.schoolAddress,
    schoolPhone: settings.schoolPhone,
    schoolEmail: settings.schoolEmail,
    theme: settings.theme,
  });
};

exports.updateSettings = async (req, res) => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create(req.body);
  } else {
    settings = await Settings.findByIdAndUpdate(settings._id, req.body, { new: true });
  }
  res.json(settings);
};

exports.uploadLogo = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image file uploaded' });
  }

  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }

  // Delete old logo file if exists in uploads directory
  if (settings.schoolLogo && settings.schoolLogo.startsWith('/uploads/')) {
    const oldPath = path.join(__dirname, '..', settings.schoolLogo);
    if (fs.existsSync(oldPath)) {
      try {
        fs.unlinkSync(oldPath);
      } catch (err) {
        console.error('Error removing old logo file:', err);
      }
    }
  }

  const logoUrl = `/uploads/${req.file.filename}`;
  settings.schoolLogo = logoUrl;
  await settings.save();

  res.json(settings);
};

exports.deleteLogo = async (req, res) => {
  let settings = await Settings.findOne();
  if (settings && settings.schoolLogo) {
    if (settings.schoolLogo.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '..', settings.schoolLogo);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (err) {
          console.error('Error removing logo file:', err);
        }
      }
    }
    settings.schoolLogo = '';
    await settings.save();
  }
  res.json(settings);
};

exports.updateTheme = async (req, res) => {
  const { theme } = req.body;
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({ theme });
  else settings = await Settings.findByIdAndUpdate(settings._id, { theme }, { new: true });
  res.json(settings);
};

