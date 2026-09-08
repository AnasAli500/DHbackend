const Student = require('../models/Student');
const Enrollment = require('../models/Enrollment');
const Exam = require('../models/Exam');
const Attendance = require('../models/Attendance');
const ProcessedResult = require('../models/ProcessedResult');
const Class = require('../models/Class');
const { generateStudentId } = require('../utils/generateId');
const { getOrCreateActiveEnrollment } = require('../utils/enrollmentHelper');

exports.getStudents = async (req, res) => {
  const { search, gender, classId, status, page = 1, limit = 100 } = req.query;
  const query = {};

  if (gender) query.gender = gender;
  if (classId) query.classId = classId;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { studentId: { $regex: search, $options: 'i' } },
    ];
  }

  const total = await Student.countDocuments(query);
  const isAll = limit === 'All' || limit === 'all' || Number(limit) === 0;
  const parsedLimit = isAll ? 0 : Math.max(1, Number(limit) || 100);
  const parsedPage = Math.max(1, Number(page) || 1);

  let queryExec = Student.find(query)
    .populate({
      path: 'classId',
      select: 'className gradeLevel academicYear category status',
      populate: { path: 'category', select: 'name code academicType' },
    })
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 });

  if (parsedLimit > 0) {
    queryExec = queryExec.skip((parsedPage - 1) * parsedLimit).limit(parsedLimit);
  }

  const students = await queryExec;
  const pages = parsedLimit > 0 ? (Math.ceil(total / parsedLimit) || 1) : 1;

  res.json({ students, total, page: parsedPage, pages });
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

  // Do not allow studentId to be modified
  const updateData = { ...req.body };
  delete updateData.studentId;

  const student = await Student.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true }).populate({
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

  // Check for historical academic records
  const [examCount, attendanceCount, enrollmentCount] = await Promise.all([
    Exam.countDocuments({ studentId: student._id }),
    Attendance.countDocuments({ studentId: student._id }),
    Enrollment.countDocuments({ studentId: student._id }),
  ]);

  if (examCount > 0 || attendanceCount > 0 || enrollmentCount > 1) {
    student.status = 'Inactive';
    await student.save();
    return res.json({ message: 'Student has academic records and was set to Inactive to preserve historical data.' });
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
      const phone = (item.phone || item.Phone || item.telephone || '').toString().trim();
      const motherName = (item.motherName || item['Mother Name'] || item.parent || item.Parent || '').toString().trim();
      const registeredDate = item.registeredDate || item['Registered Date'] || null;
      const dateOfBirth = item.dateOfBirth || item.birthday || item.Birthday || item.DOB || null;
      const birthplace = (item.birthplace || item.Birthplace || '').toString().trim();
      const nationality = (item.nationality || item.Nationality || '').toString().trim();
      const state = (item.state || item.State || item['Student State'] || '').toString().trim();
      const region = (item.region || item.Region || item['Student Region'] || '').toString().trim();
      const district = (item.district || item.District || item['Student District'] || '').toString().trim();
      const village = (item.village || item.Village || item['Student Village'] || '').toString().trim();
      const orphanStatus = (item.orphanStatus || item['Orphan Status'] || '').toString().trim();
      const disabilityStatus = (item.disabilityStatus || item['Disability Status'] || '').toString().trim();
      const guardianName = (item.guardianName || item['Guardian Name'] || '').toString().trim();
      const guardianPhone = (item.guardianPhone || item.parentPhone || item['Guardian Telephone'] || item['Parent Phone'] || '').toString().trim();
      const refugeeStatus = (item.refugeeStatus || item['Refugee Status'] || '').toString().trim();
      const schoolType = (item.schoolType || item.school_type || item.Type || item['School Type'] || '').toString().trim();
      const schoolName = (item.schoolName || item['School Name'] || '').toString().trim();
      const transferStatus = (item.transferStatus || item['Transfer Status'] || '').toString().trim();
      const monthlyFee = item.monthlyFee || item['Monthly Fee'] || 0;
      const admissionFee = item.admissionFee || item['Admission Fee'] || 0;

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
          registeredDate: registeredDate ? new Date(registeredDate) : new Date(),
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          motherName: motherName || 'N/A',
          phone,
          birthplace,
          nationality: nationality || 'Somali',
          address,
          state,
          region,
          district,
          village,
          orphanStatus: orphanStatus.toLowerCase() === 'yes' ? 'Yes' : 'No',
          disabilityStatus: disabilityStatus.toLowerCase() === 'yes' ? 'Yes' : 'No',
          guardianName,
          guardianPhone,
          parentPhone: guardianPhone || phone,
          refugeeStatus: refugeeStatus.toLowerCase() === 'yes' ? 'Yes' : 'No',
          schoolType,
          schoolName,
          transferStatus: transferStatus || 'In Progress',
          monthlyFee: Number(monthlyFee) || 0,
          admissionFee: Number(admissionFee) || 0,
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

