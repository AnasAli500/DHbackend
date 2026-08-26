const Student = require('../models/Student');
const Class = require('../models/Class');
const Enrollment = require('../models/Enrollment');
const { closeEnrollment, moveStudentToClass } = require('../utils/enrollmentHelper');

const GRADE_MAP = {
  'Grade 1': 'Grade 2',
  'Grade 2': 'Grade 3',
  'Grade 3': 'Grade 4',
  'Grade 4': 'Grade 5',
  'Grade 5': 'Grade 6',
  'Grade 6': 'Grade 7',
  'Grade 7': 'Grade 8',
  'Grade 8': 'Grade 9',
  'Grade 9': 'Grade 10',
  'Grade 10': 'Grade 11',
  'Grade 11': 'Grade 12',
};

// GET /api/promotion/students-for-move?classId=...
exports.getStudentsForMove = async (req, res) => {
  const { classId } = req.query;
  if (!classId) {
    return res.status(400).json({ message: 'classId is required' });
  }

  const cls = await Class.findById(classId).populate('category', 'name code academicType');
  if (!cls) {
    return res.status(404).json({ message: 'Class not found' });
  }

  const students = await Student.find({ classId }).sort({ name: 1 });
  const enrollments = await Enrollment.find({ classId, status: 'Active' });
  const enrollmentMap = Object.fromEntries(enrollments.map((e) => [e.studentId.toString(), e]));

  const result = students.map((s) => ({
    _id: s._id,
    studentId: s.studentId,
    name: s.name,
    gender: s.gender,
    promotionStatus: enrollmentMap[s._id.toString()]?.promotionStatus || 'Pending',
    enrollmentId: enrollmentMap[s._id.toString()]?._id || null,
  }));

  res.json({
    class: cls,
    students: result,
    total: result.length,
  });
};

// POST /api/promotion/move-selected
exports.moveSelectedStudents = async (req, res) => {
  const { fromClassId, toClassId, academicYear, students } = req.body;

  if (!fromClassId || !toClassId || !students || !Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ message: 'fromClassId, toClassId, and students array are required' });
  }

  const sourceClass = await Class.findById(fromClassId);
  const targetClass = await Class.findById(toClassId);

  if (!sourceClass || !targetClass) {
    return res.status(404).json({ message: 'Source or target class not found' });
  }

  const targetAcademicYear = academicYear || targetClass.academicYear || new Date().getFullYear().toString();
  let movedCount = 0;

  for (const item of students) {
    const sId = item.studentId || item._id || item;
    const promoStatus = item.promotionStatus || 'Promoted';

    await moveStudentToClass({
      studentId: sId,
      fromClassId,
      toClassId,
      academicYear: targetAcademicYear,
      promotionStatus: promoStatus,
      userId: req.user._id,
    });
    movedCount++;
  }

  res.json({
    message: `Successfully moved ${movedCount} student(s) from ${sourceClass.className} (${sourceClass.gradeLevel}) to ${targetClass.className} (${targetClass.gradeLevel}) for Academic Year ${targetAcademicYear}. Historical records remain untouched.`,
    movedCount,
    fromClass: sourceClass.className,
    toClass: targetClass.className,
  });
};

// Backward compatible endpoint for bulk grade level move
exports.moveStudentsToNextClass = async (req, res) => {
  const { fromGrade, toGrade, academicYear } = req.body;

  const sourceClasses = await Class.find({ gradeLevel: fromGrade });
  const targetClass = await Class.findOne({ gradeLevel: toGrade, status: 'Active' });

  if (!targetClass) {
    return res.status(404).json({ message: `No active class found for ${toGrade}` });
  }

  let totalMoved = 0;
  for (const cls of sourceClasses) {
    const studentsInClass = await Student.find({ classId: cls._id });
    for (const s of studentsInClass) {
      await moveStudentToClass({
        studentId: s._id,
        fromClassId: cls._id,
        toClassId: targetClass._id,
        academicYear: academicYear || targetClass.academicYear,
        promotionStatus: 'Promoted',
        userId: req.user._id,
      });
      totalMoved++;
    }
  }

  res.json({
    message: `Moved ${totalMoved} students from ${fromGrade} to ${toGrade}`,
    moved: totalMoved,
  });
};

exports.promoteStudents = async (req, res) => {
  const { classId, targetClassId, academicYear } = req.body;

  const sourceClass = await Class.findById(classId);
  if (!sourceClass) return res.status(404).json({ message: 'Source class not found' });

  let targetClass;
  if (targetClassId) {
    targetClass = await Class.findById(targetClassId);
  } else {
    const nextGrade = GRADE_MAP[sourceClass.gradeLevel];
    if (!nextGrade) {
      return res.status(400).json({ message: 'No next grade level available' });
    }
    targetClass = await Class.findOne({ gradeLevel: nextGrade, status: 'Active' });
    if (!targetClass) {
      return res.status(404).json({ message: `No active class found for ${nextGrade}` });
    }
  }

  const studentsInClass = await Student.find({ classId: sourceClass._id });
  let totalMoved = 0;

  for (const s of studentsInClass) {
    await moveStudentToClass({
      studentId: s._id,
      fromClassId: sourceClass._id,
      toClassId: targetClass._id,
      academicYear: academicYear || targetClass.academicYear,
      promotionStatus: 'Promoted',
      userId: req.user._id,
    });
    totalMoved++;
  }

  res.json({
    message: `Promoted ${totalMoved} students from ${sourceClass.className} to ${targetClass.className}`,
    promoted: totalMoved,
  });
};

exports.completeAcademicYear = async (req, res) => {
  const { academicYear } = req.body;

  const activeClasses = await Class.find({ academicYear, status: 'Active' });
  const activeClassIds = activeClasses.map((c) => c._id);

  // Close all active enrollments for these classes
  await Enrollment.updateMany(
    { classId: { $in: activeClassIds }, status: 'Active' },
    { status: 'Completed', endDate: new Date() }
  );

  const result = await Class.updateMany(
    { academicYear, status: 'Active' },
    { status: 'Completed' }
  );

  res.json({
    message: `Completed academic year ${academicYear}. ${result.modifiedCount} classes and all student enrollments marked as completed. All historical records remain fully intact.`,
    completed: result.modifiedCount,
  });
};
