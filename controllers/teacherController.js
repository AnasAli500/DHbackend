const Teacher = require('../models/Teacher');
const { generateTeacherId } = require('../utils/generateId');

exports.getTeachers = async (req, res) => {
  const { search, subject, page = 1, limit = 10 } = req.query;
  const query = {};

  if (subject) query.subject = subject;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { teacherId: { $regex: search, $options: 'i' } },
    ];
  }

  const total = await Teacher.countDocuments(query);
  const teachers = await Teacher.find(query)
    .populate('periodId', 'periodName subject')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.json({ teachers, total, page: Number(page), pages: Math.ceil(total / limit) });
};

exports.getTeacher = async (req, res) => {
  const teacher = await Teacher.findById(req.params.id).populate('periodId', 'periodName subject');
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  res.json(teacher);
};

exports.createTeacher = async (req, res) => {
  const teacherId = await generateTeacherId(Teacher);
  const teacher = await Teacher.create({ ...req.body, teacherId, createdBy: req.user._id });
  res.status(201).json(teacher);
};

exports.updateTeacher = async (req, res) => {
  const teacher = await Teacher.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  res.json(teacher);
};

exports.deleteTeacher = async (req, res) => {
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  if (teacher.hasAccount) {
    return res.status(400).json({ message: 'Cannot delete teacher with active user account' });
  }
  await teacher.deleteOne();
  res.json({ message: 'Teacher deleted successfully' });
};
