const Student = require('../models/Student');
const Enrollment = require('../models/Enrollment');
const Exam = require('../models/Exam');
const Attendance = require('../models/Attendance');
const ProcessedResult = require('../models/ProcessedResult');
const Class = require('../models/Class');
const { generateStudentId } = require('../utils/generateId');
const { getOrCreateActiveEnrollment } = require('../utils/enrollmentHelper');

exports.getStudents = async (req, res) => {
  const { search, gender, classId, page = 1, limit = 10 } = req.query;
  const query = {};

  if (gender) query.gender = gender;
  if (classId) query.classId = classId;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { studentId: { $regex: search, $options: 'i' } },
    ];
  }

  const total = await Student.countDocuments(query);
  const students = await Student.find(query)
    .populate({
      path: 'classId',
      select: 'className gradeLevel academicYear category status',
      populate: { path: 'category', select: 'name code academicType' },
    })
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.json({ students, total, page: Number(page), pages: Math.ceil(total / limit) });
};

exports.getStudent = async (req, res) => {
  const student = await Student.findById(req.params.id).populate({
    path: 'classId',
    select: 'className gradeLevel academicYear category status',
    populate: { path: 'category', select: 'name code academicType' },
  });
  if (!student) return res.status(404).json({ message: 'Student not found' });

  // Ensure active enrollment exists
  if (student.classId) {
    await getOrCreateActiveEnrollment(student._id, student.classId._id || student.classId, req.user._id);
  }

  res.json(student);
};

exports.createStudent = async (req, res) => {
  const studentId = await generateStudentId(Student);
  const student = await Student.create({ ...req.body, studentId, createdBy: req.user._id });

  if (student.classId) {
    await getOrCreateActiveEnrollment(student._id, student.classId, req.user._id);
  }

  const populated = await Student.findById(student._id).populate({
    path: 'classId',
    select: 'className gradeLevel academicYear category status',
    populate: { path: 'category', select: 'name code academicType' },
  });

  res.status(201).json(populated);
};

exports.updateStudent = async (req, res) => {
  const oldStudent = await Student.findById(req.params.id);
  if (!oldStudent) return res.status(404).json({ message: 'Student not found' });

  const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).populate({
    path: 'classId',
    select: 'className gradeLevel academicYear category status',
    populate: { path: 'category', select: 'name code academicType' },
  });

  // If classId changed or was set
  if (req.body.classId && req.body.classId.toString() !== (oldStudent.classId ? oldStudent.classId.toString() : '')) {
    await getOrCreateActiveEnrollment(student._id, req.body.classId, req.user._id);
  }

  res.json(student);
};

exports.getAcademicHistory = async (req, res) => {
  const { id } = req.params;
  const student = await Student.findById(id).populate({
    path: 'classId',
    select: 'className gradeLevel academicYear category status',
    populate: { path: 'category', select: 'name code academicType' },
  });

  if (!student) return res.status(404).json({ message: 'Student not found' });

  // If student has a classId, ensure active enrollment exists
  if (student.classId) {
    await getOrCreateActiveEnrollment(student._id, student.classId._id || student.classId, req.user._id);
  }

  // Fetch all enrollments
  let enrollments = await Enrollment.find({ studentId: id })
    .populate({
      path: 'classId',
      select: 'className gradeLevel academicYear category status',
      populate: { path: 'category', select: 'name code academicType' },
    })
    .sort({ createdAt: -1, academicYear: -1 });

  // Fetch exams, results, attendance
  const exams = await Exam.find({ studentId: id })
    .populate('classId', 'className gradeLevel academicYear')
    .populate('periodId', 'subject periodName')
    .populate('examSeasonId', 'name')
    .sort({ examDate: -1 });

  const results = await ProcessedResult.find({ studentId: id })
    .populate('classId', 'className gradeLevel academicYear')
    .populate('examSeasonId', 'name')
    .sort({ createdAt: -1 });

  const attendance = await Attendance.find({ studentId: id })
    .populate('classId', 'className gradeLevel academicYear')
    .populate('teacherId', 'name')
    .sort({ date: -1 });

  res.json({
    student,
    currentClass: student.classId,
    enrollments,
    exams,
    results,
    attendance,
  });
};

exports.deleteStudent = async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(404).json({ message: 'Student not found' });

  if (student.hasAccount) {
    return res.status(400).json({ message: 'Cannot delete student with active user account' });
  }

  // Check for historical academic records to prevent cascade deletion
  const [examCount, attendanceCount, enrollmentCount] = await Promise.all([
    Exam.countDocuments({ studentId: student._id }),
    Attendance.countDocuments({ studentId: student._id }),
    Enrollment.countDocuments({ studentId: student._id }),
  ]);

  if (examCount > 0 || attendanceCount > 0 || enrollmentCount > 1) {
    return res.status(400).json({
      message: `Cannot delete student because permanent academic records exist (${examCount} exams, ${attendanceCount} attendance records, ${enrollmentCount} enrollments). Preserve history instead.`,
    });
  }

  await Enrollment.deleteMany({ studentId: student._id });
  await student.deleteOne();
  res.json({ message: 'Student deleted successfully' });
};

exports.exportStudents = async (req, res) => {
  const students = await Student.find().populate('classId', 'className gradeLevel');
  res.json(students);
};

exports.importStudents = async (req, res) => {
  try {
    const rawStudents = req.body.students || req.body;
    if (!Array.isArray(rawStudents) || rawStudents.length === 0) {
      return res.status(400).json({ success: false, message: 'No student records provided' });
    }

    const allClasses = await Class.find();
    const classMap = new Map();
    allClasses.forEach((c) => {
      if (c && c.className) {
        classMap.set(c.className.toString().trim().toLowerCase(), c._id);
      }
    });

    const importedStudents = [];
    const errors = [];
    let rowNum = 0;

    for (const item of rawStudents) {
      rowNum++;
      const name = (item.name || item.Name || '').toString().trim();
      const rawGender = (item.gender || item.Gender || '').toString().trim();
      const className = (item.class || item.Class || item.className || item.ClassName || '').toString().trim();
      const address = (item.address || item.Address || '').toString().trim();
      const phone = (item.phone || item.Phone || '').toString().trim();
      const parent = (item.parent || item.Parent || item.parentName || item.ParentName || item.motherName || '').toString().trim();
      const parentPhone = (item.parentPhone || item.ParentPhone || item.Parent_Phone || '').toString().trim();

      if (!name) {
        errors.push({ row: rowNum, message: 'Name is required' });
        continue;
      }

      const formattedGender = rawGender ? (rawGender.charAt(0).toUpperCase() + rawGender.slice(1).toLowerCase()) : '';
      if (!['Male', 'Female'].includes(formattedGender)) {
        errors.push({ row: rowNum, message: `Gender must be Male or Female (got "${rawGender || 'empty'}")` });
        continue;
      }

      if (!className) {
        errors.push({ row: rowNum, message: 'Class is required' });
        continue;
      }

      const classId = classMap.get(className.toLowerCase());
      if (!classId) {
        errors.push({ row: rowNum, message: `Class "${className}" not found` });
        continue;
      }

      try {
        const studentId = await generateStudentId(Student);
        const newStudent = await Student.create({
          studentId,
          name,
          gender: formattedGender,
          classId,
          address,
          phone,
          motherName: parent || 'N/A',
          parentPhone,
          createdBy: req.user?._id,
        });

        await getOrCreateActiveEnrollment(newStudent._id, classId, req.user?._id);

        importedStudents.push({
          _id: newStudent._id,
          studentId: newStudent.studentId,
          name: newStudent.name,
          gender: newStudent.gender,
          className,
        });
      } catch (err) {
        errors.push({ row: rowNum, message: err.message || 'Failed to insert student' });
      }
    }

    return res.json({
      success: true,
      message: `Import complete: ${importedStudents.length} imported, ${errors.length} failed.`,
      summary: {
        total: rawStudents.length,
        imported: importedStudents.length,
        failed: errors.length,
      },
      students: importedStudents,
      errors,
    });
  } catch (globalErr) {
    console.error('Error in importStudents controller:', globalErr);
    return res.status(500).json({
      success: false,
      message: globalErr.message || 'Server error during student import',
    });
  }
};

