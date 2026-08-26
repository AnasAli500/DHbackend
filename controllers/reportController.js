const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Attendance = require('../models/Attendance');
const Exam = require('../models/Exam');
const Class = require('../models/Class');

exports.getStudentReport = async (req, res) => {
  const { classId, gender } = req.query;
  const query = {};
  if (classId) query.classId = classId;
  if (gender) query.gender = gender;

  const students = await Student.find(query).populate('classId', 'className gradeLevel');
  res.json({ title: 'Student Report', data: students, generatedAt: new Date() });
};

exports.getTeacherReport = async (req, res) => {
  const { subject } = req.query;
  const query = {};
  if (subject) query.subject = subject;

  const teachers = await Teacher.find(query).populate('periodId', 'periodName subject');
  res.json({ title: 'Teacher Report', data: teachers, generatedAt: new Date() });
};

exports.getAttendanceReport = async (req, res) => {
  const { classId, startDate, endDate } = req.query;
  const query = {};
  if (classId) query.classId = classId;
  if (startDate && endDate) {
    query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  const attendance = await Attendance.find(query)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className')
    .populate('periodId', 'periodName subject');

  res.json({ title: 'Attendance Report', data: attendance, generatedAt: new Date() });
};

exports.getExamReport = async (req, res) => {
  const { classId, periodId } = req.query;
  const query = {};
  if (classId) query.classId = classId;
  if (periodId) query.periodId = periodId;

  const exams = await Exam.find(query)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className')
    .populate('periodId', 'periodName subject')
    .populate('teacherId', 'name');

  res.json({ title: 'Exam Report', data: exams, generatedAt: new Date() });
};

exports.getClassReport = async (req, res) => {
  const { status } = req.query;
  const query = {};
  if (status) query.status = status;

  const classes = await Class.find(query).populate('classTeacher', 'name');
  const report = await Promise.all(
    classes.map(async (cls) => {
      const studentCount = await Student.countDocuments({ classId: cls._id });
      return { ...cls.toObject(), studentCount };
    })
  );

  res.json({ title: 'Class Report', data: report, generatedAt: new Date() });
};
