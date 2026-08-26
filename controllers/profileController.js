const Profile = require('../models/Profile');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

exports.getProfile = async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user._id });
  res.json({
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    phone: profile?.phone || '',
    address: profile?.address || '',
    avatar: profile?.avatar || '',
  });
};

exports.updateProfile = async (req, res) => {
  const { name, phone, address } = req.body;

  if (name) {
    await User.findByIdAndUpdate(req.user._id, { name });
  }

  const profile = await Profile.findOneAndUpdate(
    { userId: req.user._id },
    { phone, address },
    { new: true, upsert: true }
  );

  res.json({
    name: name || req.user.name,
    email: req.user.email,
    role: req.user.role,
    phone: profile.phone,
    address: profile.address,
    avatar: profile.avatar,
  });
};

exports.uploadAvatar = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image uploaded' });
  }

  const avatar = `/uploads/${req.file.filename}`;
  const profile = await Profile.findOneAndUpdate(
    { userId: req.user._id },
    { avatar },
    { new: true, upsert: true }
  );

  res.json({ avatar: profile.avatar });
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }

  const user = await User.findById(req.user._id);
  if (!(await user.matchPassword(currentPassword))) {
    return res.status(400).json({ message: 'Current password is incorrect' });
  }

  user.password = newPassword;
  await user.save();

  res.json({ message: 'Password changed successfully' });
};
