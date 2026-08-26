const Attendance = require('../models/Attendance');
const Period = require('../models/Period');
const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const Class = require('../models/Class');
const { getOrCreateActiveEnrollment } = require('../utils/enrollmentHelper');

const startOfDay = (dateStr) => {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (dateStr) => {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
};

const getTeacherDoc = async (user) => {
  if (user.role !== 'teacher') return null;
  return Teacher.findOne({ teacherId: user.teacherId });
};

const getTeacherPeriodIds = async (user) => {
  const teacher = await getTeacherDoc(user);
  if (!teacher) return [];
  const periods = await Period.find({ teacherId: teacher._id });
  return periods.map((p) => p._id.toString());
};

const findPeriodForClassTeacher = async (classId, teacherId) => {
  return Period.findOne({ classId, teacherId });
};

exports.getTeachersByClass = async (req, res) => {
  const { classId } = req.params;
  const cls = await Class.findById(classId);
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  const periods = await Period.find({ classId }).populate('teacherId', 'name teacherId subject');
  const teacherMap = new Map();
  periods.forEach((p) => {
    if (p.teacherId) teacherMap.set(p.teacherId._id.toString(), p.teacherId);
  });

  let teachers = Array.from(teacherMap.values());

  if (req.user.role === 'teacher') {
    const teacher = await getTeacherDoc(req.user);
    if (teacher) {
      teachers = teachers.filter((t) => t._id.toString() === teacher._id.toString());
    } else {
      teachers = [];
    }
  }

  res.json({ teachers });
};

exports.getAttendanceSheet = async (req, res) => {
  const { classId, teacherId, date } = req.query;

  if (!classId || !teacherId || !date) {
    return res.status(400).json({ message: 'Class, teacher, and date are required' });
  }

  if (req.user.role === 'teacher') {
    const teacher = await getTeacherDoc(req.user);
    if (!teacher || teacher._id.toString() !== teacherId) {
      return res.status(403).json({ message: 'You can only record attendance for your assigned classes' });
    }
  }

  const period = await findPeriodForClassTeacher(classId, teacherId);
  if (!period && req.user.role === 'teacher') {
    return res.status(403).json({ message: 'You are not assigned to this class' });
  }

  const students = await Student.find({ classId }).sort({ name: 1 });
  const existing = await Attendance.find({
    classId,
    teacherId,
    date: { $gte: startOfDay(date), $lte: endOfDay(date) },
  });

  const statusMap = Object.fromEntries(existing.map((a) => [a.studentId.toString(), { status: a.status, attendanceId: a._id }]));

  const sheet = students.map((s) => ({
    _id: s._id,
    studentId: s.studentId,
    name: s.name,
    status: statusMap[s._id.toString()]?.status || 'Present',
    attendanceId: statusMap[s._id.toString()]?.attendanceId || null,
  }));

  res.json({ students: sheet, periodId: period?._id || null });
};

exports.getAttendance = async (req, res) => {
  const { studentId, classId, teacherId, date, status, page = 1, limit = 20 } = req.query;
  const query = {};

  if (studentId) query.studentId = studentId;
  if (classId) query.classId = classId;
  if (teacherId) query.teacherId = teacherId;
  if (status) query.status = status;
  if (date) {
    query.date = { $gte: startOfDay(date), $lte: endOfDay(date) };
  }

  if (req.user.role === 'teacher') {
    const teacher = await getTeacherDoc(req.user);
    if (teacher) query.teacherId = teacher._id;
  }

  if (req.user.role === 'student') {
    const student = await Student.findOne({ studentId: req.user.studentId });
    if (student) query.studentId = student._id;
  }

  const total = await Attendance.countDocuments(query);
  const attendance = await Attendance.find(query)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className gradeLevel')
    .populate('teacherId', 'name teacherId')
    .populate('recordedBy', 'name role')
    .sort({ date: -1, createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.json({ attendance, total, page: Number(page), pages: Math.ceil(total / limit) });
};

exports.recordAttendance = async (req, res) => {
  const { studentId, classId, teacherId, periodId, date, status, remarks } = req.body;

  if (req.user.role === 'teacher') {
    const teacher = await getTeacherDoc(req.user);
    if (!teacher || teacher._id.toString() !== teacherId) {
      return res.status(403).json({ message: 'You can only record attendance for your assigned classes' });
    }
  }

  let resolvedPeriodId = periodId;
  if (!resolvedPeriodId) {
    const period = await findPeriodForClassTeacher(classId, teacherId);
    resolvedPeriodId = period?._id;
  }

  const enrollment = await getOrCreateActiveEnrollment(studentId, classId, req.user._id);

  const dayStart = startOfDay(date);
  const existing = await Attendance.findOne({ studentId, classId, teacherId, date: { $gte: dayStart, $lte: endOfDay(date) } });

  if (existing) {
    existing.status = status;
    if (remarks !== undefined) existing.remarks = remarks;
    existing.recordedBy = req.user._id;
    if (enrollment) existing.enrollmentId = enrollment._id;
    if (resolvedPeriodId) existing.periodId = resolvedPeriodId;
    await existing.save();
    const populated = await Attendance.findById(existing._id)
      .populate('studentId', 'name studentId')
      .populate('classId', 'className gradeLevel academicYear')
      .populate('teacherId', 'name')
      .populate('recordedBy', 'name');
    return res.json(populated);
  }

  const record = await Attendance.create({
    studentId,
    enrollmentId: enrollment?._id,
    classId,
    teacherId,
    periodId: resolvedPeriodId,
    date: dayStart,
    status,
    remarks: remarks || '',
    recordedBy: req.user._id,
  });

  const populated = await Attendance.findById(record._id)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className gradeLevel academicYear')
    .populate('teacherId', 'name')
    .populate('recordedBy', 'name');

  res.status(201).json(populated);
};

exports.bulkRecordAttendance = async (req, res) => {
  const { classId, teacherId, date, records } = req.body;

  if (!classId || !teacherId || !date || !records?.length) {
    return res.status(400).json({ message: 'Class, teacher, date, and records are required' });
  }

  if (req.user.role === 'teacher') {
    const teacher = await getTeacherDoc(req.user);
    if (!teacher || teacher._id.toString() !== teacherId) {
      return res.status(403).json({ message: 'You can only record attendance for your assigned classes' });
    }
  }

  const period = await findPeriodForClassTeacher(classId, teacherId);
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const results = [];

  for (const record of records) {
    const enrollment = await getOrCreateActiveEnrollment(record.studentId, classId, req.user._id);

    const existing = await Attendance.findOne({
      studentId: record.studentId,
      classId,
      teacherId,
      date: { $gte: dayStart, $lte: dayEnd },
    });

    if (existing) {
      existing.status = record.status;
      if (record.remarks !== undefined) existing.remarks = record.remarks;
      existing.recordedBy = req.user._id;
      if (enrollment) existing.enrollmentId = enrollment._id;
      if (period) existing.periodId = period._id;
      await existing.save();
      results.push(existing);
    } else {
      const created = await Attendance.create({
        studentId: record.studentId,
        enrollmentId: enrollment?._id,
        classId,
        teacherId,
        periodId: period?._id,
        date: dayStart,
        status: record.status,
        remarks: record.remarks || '',
        recordedBy: req.user._id,
      });
      results.push(created);
    }
  }

  res.status(201).json({ message: 'Attendance saved successfully', count: results.length, records: results });
};

exports.updateAttendance = async (req, res) => {
  const { status } = req.body;
  const record = await Attendance.findById(req.params.id);
  if (!record) return res.status(404).json({ message: 'Attendance record not found' });

  if (req.user.role === 'teacher') {
    const teacher = await getTeacherDoc(req.user);
    if (!teacher || record.teacherId.toString() !== teacher._id.toString()) {
      return res.status(403).json({ message: 'You can only edit your own attendance records' });
    }
  }

  record.status = status;
  record.recordedBy = req.user._id;
  await record.save();

  const populated = await Attendance.findById(record._id)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className')
    .populate('teacherId', 'name')
    .populate('recordedBy', 'name');

  res.json(populated);
};

exports.deleteAttendance = async (req, res) => {
  if (req.user.role === 'teacher') {
    return res.status(403).json({ message: 'Teachers cannot delete attendance records' });
  }

  const record = await Attendance.findById(req.params.id);
  if (!record) return res.status(404).json({ message: 'Attendance record not found' });
  await record.deleteOne();
  res.json({ message: 'Attendance record deleted' });
};
