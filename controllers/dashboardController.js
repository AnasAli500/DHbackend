const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Class = require('../models/Class');
const Period = require('../models/Period');
const Attendance = require('../models/Attendance');
const Exam = require('../models/Exam');

exports.getDashboardStats = async (req, res) => {
  const [totalStudents, totalTeachers, totalClasses, totalPeriods, totalAttendance, totalExams] =
    await Promise.all([
      Student.countDocuments(),
      Teacher.countDocuments(),
      Class.countDocuments(),
      Period.countDocuments(),
      Attendance.countDocuments(),
      Exam.countDocuments(),
    ]);

  res.json({
    totalStudents,
    totalTeachers,
    totalClasses,
    totalPeriods,
    totalAttendance,
    totalExams,
  });
};

exports.getStudentGrowth = async (req, res) => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const growth = await Student.aggregate([
    { $match: { createdAt: { $gte: sixMonthsAgo } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json(growth);
};

exports.getAttendanceAnalytics = async (req, res) => {
  const analytics = await Attendance.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  res.json(analytics);
};

exports.getExamPerformance = async (req, res) => {
  const performance = await Exam.aggregate([
    {
      $group: {
        _id: '$grade',
        count: { $sum: 1 },
        avgMarks: { $avg: '$marks' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json(performance);
};

exports.getClassDistribution = async (req, res) => {
  const distribution = await Student.aggregate([
    { $match: { classId: { $ne: null } } },
    {
      $group: {
        _id: '$classId',
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'classes',
        localField: '_id',
        foreignField: '_id',
        as: 'class',
      },
    },
    { $unwind: '$class' },
    {
      $project: {
        className: '$class.className',
        gradeLevel: '$class.gradeLevel',
        count: 1,
      },
    },
  ]);

  res.json(distribution);
};

exports.getTeacherDashboard = async (req, res) => {
  const teacher = await Teacher.findOne({ teacherId: req.user.teacherId });
  if (!teacher) return res.json({ periods: [], totalStudents: 0 });

  const periods = await Period.find({ teacherId: teacher._id }).populate('classId', 'className');
  const classIds = periods.map((p) => p.classId?._id).filter(Boolean);
  const totalStudents = await Student.countDocuments({ classId: { $in: classIds } });
  const totalExams = await Exam.countDocuments({ teacherId: teacher._id });
  const totalAttendance = await Attendance.countDocuments({
    periodId: { $in: periods.map((p) => p._id) },
  });

  res.json({ periods, totalStudents, totalExams, totalAttendance });
};

exports.getStudentDashboard = async (req, res) => {
  const student = await Student.findOne({ studentId: req.user.studentId }).populate('classId', 'className gradeLevel');
  if (!student) return res.json({ student: null, attendance: [], exams: [] });

  const attendance = await Attendance.find({ studentId: student._id })
    .populate('periodId', 'subject')
    .sort({ date: -1 })
    .limit(10);

  const exams = await Exam.find({ studentId: student._id })
    .populate('periodId', 'subject')
    .sort({ examDate: -1 })
    .limit(10);

  const presentCount = await Attendance.countDocuments({ studentId: student._id, status: 'Present' });
  const totalCount = await Attendance.countDocuments({ studentId: student._id });

  res.json({
    student,
    attendance,
    exams,
    attendanceRate: totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0,
  });
};
