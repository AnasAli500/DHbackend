const User = require('../models/User');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Profile = require('../models/Profile');

exports.getUsers = async (req, res) => {
  const { search, role, page = 1, limit = 10 } = req.query;
  const query = {};

  if (role) query.role = role;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const total = await User.countDocuments(query);
  const users = await User.find(query)
    .select('-password')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.json({ users, total, page: Number(page), pages: Math.ceil(total / limit) });
};

exports.createAdmin = async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(400).json({ message: 'Email address is already in use.' });
  }

  const user = await User.create({
    name,
    email,
    password,
    role: role || 'admin',
    createdBy: req.user._id,
  });

  await Profile.create({ userId: user._id });

  res.status(201).json({ message: 'User account created successfully.', user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
};

exports.createStudentAccount = async (req, res) => {
  const { studentId, email, password } = req.body;

  const student = await Student.findOne({ studentId });
  if (!student) {
    return res.status(404).json({ message: 'Student ID not found. Please register the student first.' });
  }

  if (student.hasAccount) {
    return res.status(400).json({ message: 'This student already has a user account.' });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(400).json({ message: 'Email address is already in use.' });
  }

  const user = await User.create({
    name: student.name,
    email,
    password,
    role: 'student',
    studentId: student.studentId,
    createdBy: req.user._id,
  });

  student.hasAccount = true;
  await student.save();
  await Profile.create({ userId: user._id, phone: student.phone, address: student.address });

  res.status(201).json({ message: 'User account created successfully.', user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
};

exports.createTeacherAccount = async (req, res) => {
  const { teacherId, email, password } = req.body;

  const teacher = await Teacher.findOne({ teacherId });
  if (!teacher) {
    return res.status(404).json({ message: 'Teacher ID not found. Please register the teacher first.' });
  }

  if (teacher.hasAccount) {
    return res.status(400).json({ message: 'This teacher already has a user account.' });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(400).json({ message: 'Email address is already in use.' });
  }

  const user = await User.create({
    name: teacher.name,
    email,
    password,
    role: 'teacher',
    teacherId: teacher.teacherId,
    createdBy: req.user._id,
  });

  teacher.hasAccount = true;
  await teacher.save();
  await Profile.create({ userId: user._id, phone: teacher.phone, address: teacher.address });

  res.status(201).json({ message: 'User account created successfully.', user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
};

exports.deleteUser = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  if (user.studentId) {
    await Student.findOneAndUpdate({ studentId: user.studentId }, { hasAccount: false });
  }
  if (user.teacherId) {
    await Teacher.findOneAndUpdate({ teacherId: user.teacherId }, { hasAccount: false });
  }

  await Profile.findOneAndDelete({ userId: user._id });
  await user.deleteOne();

  res.json({ message: 'User deleted successfully' });
};
