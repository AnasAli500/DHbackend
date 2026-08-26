const Class = require('../models/Class');
const Category = require('../models/Category');
const Student = require('../models/Student');
const Enrollment = require('../models/Enrollment');
const Exam = require('../models/Exam');
const Attendance = require('../models/Attendance');
const { ensureFixedCategories } = require('./categoryController');

exports.getClasses = async (req, res) => {
  const { search, status, page = 1, limit = 10 } = req.query;
  const query = {};

  if (status) query.status = status;
  if (search) {
    query.$or = [
      { className: { $regex: search, $options: 'i' } },
      { gradeLevel: { $regex: search, $options: 'i' } },
    ];
  }

  await ensureFixedCategories();
  const total = await Class.countDocuments(query);
  const rawClasses = await Class.find(query)
    .populate('classTeacher', 'name teacherId')
    .populate('category', 'code name academicType')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const classes = await Promise.all(
    rawClasses.map(async (c) => {
      const studentCount = await Student.countDocuments({ classId: c._id });
      const enrollmentCount = await Enrollment.countDocuments({ classId: c._id });
      const obj = c.toObject();
      obj.studentCount = Math.max(studentCount, enrollmentCount);
      return obj;
    })
  );

  res.json({ classes, total, page: Number(page), pages: Math.ceil(total / limit) });
};

exports.getClass = async (req, res) => {
  const cls = await Class.findById(req.params.id)
    .populate('classTeacher', 'name teacherId')
    .populate('category', 'code name academicType');
  if (!cls) return res.status(404).json({ message: 'Class not found' });
  res.json(cls);
};

exports.getClassStudents = async (req, res) => {
  const { id } = req.params;
  const cls = await Class.findById(id).populate('category', 'code name academicType');
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  // Get active current students
  const currentStudents = await Student.find({ classId: id });
  // Get enrollment history for this class
  const enrollments = await Enrollment.find({ classId: id })
    .populate('studentId')
    .sort({ status: 1, createdAt: -1 });

  res.json({
    class: cls,
    currentStudents,
    enrollments,
    totalStudents: Math.max(currentStudents.length, enrollments.length),
  });
};

exports.createClass = async (req, res) => {
  await ensureFixedCategories();
  const category = await Category.findById(req.body.category);
  if (!category) return res.status(400).json({ message: 'Please select a valid category' });
  const cls = await Class.create({ ...req.body, createdBy: req.user._id });
  await cls.populate('category', 'code name academicType');
  res.status(201).json(cls);
};

exports.updateClass = async (req, res) => {
  if (!req.body.category) return res.status(400).json({ message: 'Category is required' });
  const category = await Category.findById(req.body.category);
  if (!category) return res.status(400).json({ message: 'Please select a valid category' });
  const cls = await Class.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!cls) return res.status(404).json({ message: 'Class not found' });
  res.json(cls);
};

exports.completeClass = async (req, res) => {
  const cls = await Class.findById(req.params.id);
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  cls.status = 'Completed';
  await cls.save();

  // Close active enrollments for this class
  await Enrollment.updateMany(
    { classId: cls._id, status: 'Active' },
    { status: 'Completed', endDate: new Date() }
  );

  res.json({
    message: `Class ${cls.className} (${cls.gradeLevel}) marked as Completed. All historical data remains accessible permanently.`,
    class: cls,
  });
};

exports.deleteClass = async (req, res) => {
  const cls = await Class.findById(req.params.id);
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  const [examCount, attendanceCount, enrollmentCount] = await Promise.all([
    Exam.countDocuments({ classId: cls._id }),
    Attendance.countDocuments({ classId: cls._id }),
    Enrollment.countDocuments({ classId: cls._id }),
  ]);

  if (examCount > 0 || attendanceCount > 0 || enrollmentCount > 0) {
    return res.status(400).json({
      message: `Cannot delete class because permanent academic records exist (${examCount} exams, ${attendanceCount} attendance records, ${enrollmentCount} student enrollments). Keep class as Completed for historical records instead.`,
    });
  }

  await cls.deleteOne();
  res.json({ message: 'Class deleted successfully' });
};
