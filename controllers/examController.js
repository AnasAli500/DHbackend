const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Period = require('../models/Period');
const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const Class = require('../models/Class');
const ExamSeason = require('../models/ExamSeason');
const ExamStructure = require('../models/ExamStructure');
const ProcessedResult = require('../models/ProcessedResult');
const Settings = require('../models/Settings');
const Enrollment = require('../models/Enrollment');
const { getOrCreateActiveEnrollment } = require('../utils/enrollmentHelper');
const { calculateExamResult, calculatePercentage, calculateGrade, calculateGPA, getOrdinalPosition, isGradePassed } = require('../utils/gradeCalculator');

const getExamStructure = async (classId, examSeasonId, examStructureId) => {
  const cls = await Class.findById(classId).populate('category');
  if (!cls) return { error: 'Class not found' };
  if (!cls.category) return { error: 'This class has no category. Edit the class and select a category before creating exams.' };

  const season = await ExamSeason.findOne({ _id: examSeasonId, categoryId: cls.category._id, status: 'Active' });
  if (!season) return { error: 'The selected exam season is not allowed for this class category' };
  const structure = await ExamStructure.findOne({ _id: examStructureId, categoryId: cls.category._id, seasonId: season._id, status: 'Active' });
  if (!structure) return { error: 'The selected exam type is not allowed for this class category and season' };
  return { cls, structure };
};

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

const assertTeacherPeriodAccess = async (user, periodId) => {
  if (user.role !== 'teacher') return true;
  const periodIds = await getTeacherPeriodIds(user);
  return periodIds.includes(periodId.toString());
};

const assertTeacherOwnsPeriod = async (user, classId, teacherId) => {
  if (user.role !== 'teacher') return true;
  const teacher = await getTeacherDoc(user);
  if (!teacher || teacher._id.toString() !== teacherId) return false;
  const period = await Period.findOne({ classId, teacherId });
  return !!period;
};

exports.getExams = async (req, res) => {
  const { studentId, classId, periodId, teacherId, examType, academicYear, page = 1, limit = 10 } = req.query;
  const query = {};

  if (studentId) query.studentId = studentId;
  if (classId) query.classId = classId;
  if (periodId) query.periodId = periodId;
  if (teacherId) query.teacherId = teacherId;
  if (examType) query.examType = examType;

  if (academicYear && !classId) {
    const classIds = await Class.distinct('_id', { academicYear });
    query.classId = { $in: classIds };
  }

  if (req.user.role === 'teacher') {
    const teacher = await getTeacherDoc(req.user);
    if (teacher) query.teacherId = teacher._id;
  }

  if (req.user.role === 'student') {
    const student = await Student.findOne({ studentId: req.user.studentId });
    if (student) {
      query.studentId = student._id;
      // Only show published exams to students
      query.status = 'Published';
    }
  }

  const total = await Exam.countDocuments(query);
  const exams = await Exam.find(query)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className gradeLevel academicYear')
    .populate('periodId', 'periodName subject')
    .populate('teacherId', 'name teacherId')
    .sort({ examDate: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.json({ exams, total, page: Number(page), pages: Math.ceil(total / limit) });
};

exports.getExamSetup = async (req, res) => {
  const { classId, seasonId } = req.query;
  if (!classId) return res.status(400).json({ message: 'Class is required' });

  const cls = await Class.findById(classId).populate('category', 'name academicType code');
  if (!cls) return res.status(404).json({ message: 'Class not found' });
  if (!cls.category) return res.status(400).json({ message: 'This class has no category. Update the class first.' });

  const seasons = await ExamSeason.find({ categoryId: cls.category._id, status: 'Active' }).sort({ name: 1 });
  let subjectsQuery = { classId };
  if (req.user.role === 'teacher') {
    const teacher = await getTeacherDoc(req.user);
    subjectsQuery.teacherId = teacher?._id || null;
  }
  const subjects = await Period.find(subjectsQuery).populate('teacherId', 'name teacherId subject').sort({ subject: 1 });
  const structures = seasonId
    ? await ExamStructure.find({ categoryId: cls.category._id, seasonId, status: 'Active' }).sort({ examType: 1 })
    : [];

  res.json({ category: cls.category, seasons, subjects, structures });
};

exports.getTeachersByClass = async (req, res) => {
  const { classId } = req.params;
  const cls = await Class.findById(classId).populate('classTeacher', 'name teacherId subject');
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  const periods = await Period.find({ classId }).populate('teacherId', 'name teacherId subject');
  const teacherMap = new Map();
  periods.forEach((p) => {
    if (p.teacherId) teacherMap.set(p.teacherId._id.toString(), p.teacherId);
  });

  if (cls.classTeacher) teacherMap.set(cls.classTeacher._id.toString(), cls.classTeacher);

  let teachers = Array.from(teacherMap.values());

  if (teachers.length === 0) {
    teachers = await Teacher.find().select('name teacherId subject').sort({ name: 1 });
  }

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

exports.getPeriodsByClassTeacher = async (req, res) => {
  const { classId, teacherId } = req.query;

  if (!classId || !teacherId) {
    return res.status(400).json({ message: 'Class and teacher are required' });
  }

  if (req.user.role === 'teacher') {
    const allowed = await assertTeacherOwnsPeriod(req.user, classId, teacherId);
    if (!allowed) {
      return res.status(403).json({ message: 'You can only manage exams for your assigned subjects and periods' });
    }
  }

  const teacher = await Teacher.findById(teacherId);

  let periods = await Period.find({ classId, teacherId })
    .populate('classId', 'className')
    .populate('teacherId', 'name teacherId subject')
    .sort({ subject: 1 });

  if (periods.length === 0 && teacher && teacher.subject) {
    periods = await Period.find({ classId, subject: teacher.subject })
      .populate('classId', 'className')
      .populate('teacherId', 'name teacherId subject')
      .sort({ subject: 1 });

    for (const p of periods) {
      if (p.teacherId?._id?.toString() !== teacherId && req.user.role === 'admin') {
        p.teacherId = teacher._id;
        await p.save();
      }
    }
  }

  if (periods.length === 0 && teacher) {
    const subjectName = teacher.subject || 'General Subject';
    const newPeriod = await Period.create({
      periodName: `${subjectName} Period`,
      subject: subjectName,
      teacherId: teacher._id,
      classId,
      createdBy: req.user._id,
    });
    periods = [await Period.findById(newPeriod._id).populate('classId', 'className').populate('teacherId', 'name teacherId subject')];
  }

  res.json({ periods });
};

exports.getExamSheet = async (req, res) => {
  const { classId, teacherId, periodId, examType, examName, examDate, totalMarks, examSeasonId, examStructureId } = req.query;

  if (!classId || !teacherId || !periodId || !examDate) {
    return res.status(400).json({ message: 'Class, teacher, period, and exam date are required' });
  }

  const period = await Period.findById(periodId);
  if (!period) return res.status(404).json({ message: 'Period not found' });

  if (period.classId.toString() !== classId) {
    return res.status(400).json({ message: 'Period does not match the selected class' });
  }

  if (req.user.role === 'admin' && period.teacherId.toString() !== teacherId) {
    period.teacherId = teacherId;
    await period.save();
  } else if (req.user.role === 'teacher') {
    const allowed = await assertTeacherPeriodAccess(req.user, periodId);
    if (!allowed) {
      return res.status(403).json({ message: 'You can only manage exams for your assigned subjects and periods' });
    }
  }

  const students = await Student.find({ classId }).sort({ name: 1 });

  // Primary search: by examSeasonId + examStructureId + periodId (most reliable)
  let existing = [];
  if (examSeasonId && examStructureId) {
    existing = await Exam.find({ classId, periodId, examSeasonId, examStructureId });
  }

  // Fallback: search by date + examName (original behavior)
  if (existing.length === 0) {
    const examQuery = {
      classId,
      teacherId,
      periodId,
      examDate: { $gte: startOfDay(examDate), $lte: endOfDay(examDate) },
    };
    if (examType) examQuery.examType = examType;
    if (examName) examQuery.examName = examName;
    existing = await Exam.find(examQuery);
  }

  // Sort existing exams by updatedAt desc & marks desc so latest updated mark is prioritized
  existing.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt) || b.marks - a.marks);

  // Recalculate grade with latest grading scale when loading
  const marksMap = Object.fromEntries(
    existing.map((e) => {
      const recalcGrade = calculateGrade(e.percentage);
      return [
        e.studentId.toString(),
        {
          marks: e.marks,
          examId: e._id,
          grade: recalcGrade,
          percentage: e.percentage,
          attendance: e.attendance || 'Present',
          remarks: e.remarks || '',
          status: e.status || 'Draft',
        },
      ];
    })
  );

  const sheet = students.map((s) => ({
    _id: s._id,
    studentId: s.studentId,
    name: s.name,
    marks: marksMap[s._id.toString()]?.marks ?? '',
    grade: marksMap[s._id.toString()]?.grade ?? '',
    percentage: marksMap[s._id.toString()]?.percentage ?? '',
    attendance: marksMap[s._id.toString()]?.attendance ?? 'Present',
    remarks: marksMap[s._id.toString()]?.remarks ?? '',
    status: marksMap[s._id.toString()]?.status ?? 'Draft',
    examId: marksMap[s._id.toString()]?.examId ?? null,
  }));

  const classWithCategory = await Class.findById(classId).populate('category');
  if (!classWithCategory?.category) {
    return res.status(400).json({ message: 'This class has no category. Select a category in Class Management first.' });
  }

  res.json({
    students: sheet,
    category: classWithCategory.category,
    examStructure: classWithCategory.category.examStructure,
    totalMarks: totalMarks ? Number(totalMarks) : existing[0]?.totalMarks || 100,
  });
};

exports.bulkSaveExams = async (req, res) => {
  const { classId, teacherId, periodId, examSeasonId, examStructureId, examName, examDate, records } = req.body;

  if (!classId || !teacherId || !periodId || !examSeasonId || !examStructureId || !examName || !examDate || !records?.length) {
    return res.status(400).json({ message: 'Class, teacher, period, exam details, and student records are required' });
  }

  const allowed = await assertTeacherPeriodAccess(req.user, periodId);
  if (!allowed) {
    return res.status(403).json({ message: 'You can only manage exams for your assigned subjects and periods' });
  }

  const structureResult = await getExamStructure(classId, examSeasonId, examStructureId);
  if (structureResult.error) return res.status(400).json({ message: structureResult.error });
  const totalMarks = structureResult.structure.maxMarks;
  const season = await ExamSeason.findById(examSeasonId);

  const period = await Period.findById(periodId);
  if (!period) return res.status(404).json({ message: 'Period not found' });

  if (period.classId.toString() !== classId) {
    return res.status(400).json({ message: 'Period does not match the selected class' });
  }

  if (req.user.role === 'admin' && period.teacherId.toString() !== teacherId) {
    period.teacherId = teacherId;
    await period.save();
  }

  const dayStart = startOfDay(examDate);
  const dayEnd = endOfDay(examDate);

  // Check if exams for this season & class are already Published (lock edits unless admin unpublishes)
  const existingPublished = await ProcessedResult.findOne({ classId, examSeasonId, status: 'Published' });
  if (existingPublished && req.user.role !== 'admin') {
    return res.status(400).json({ message: 'Exam results for this season are Published and locked against modifications.' });
  }

  const results = [];

  for (const record of records) {
    if (record.marks === '' || record.marks === null || record.marks === undefined) continue;

    const enrollment = await getOrCreateActiveEnrollment(record.studentId, classId, req.user._id);

    const marks = Number(record.marks);
    if (Number.isNaN(marks) || marks < 0 || marks > totalMarks) {
      return res.status(400).json({ message: `Marks must be between 0 and ${totalMarks}` });
    }

    const { percentage, grade, gpa } = calculateExamResult(marks, Number(totalMarks));
    const isPassed = percentage >= 50;
    const attendance = record.attendance || 'Present';
    const remarks = record.remarks || '';

    let existing = null;
    if (record.examId) {
      existing = await Exam.findById(record.examId);
    }
    if (!existing && examSeasonId && examStructureId) {
      existing = await Exam.findOne({
        studentId: record.studentId,
        classId,
        periodId,
        examSeasonId,
        examStructureId,
      });
    }
    if (!existing && examSeasonId && examStructureId) {
      existing = await Exam.findOne({
        studentId: record.studentId,
        classId,
        examSeasonId,
        examStructureId,
      });
    }
    if (!existing && examSeasonId) {
      existing = await Exam.findOne({
        studentId: record.studentId,
        classId,
        periodId,
        examSeasonId,
      });
    }
    if (!existing) {
      existing = await Exam.findOne({
        studentId: record.studentId,
        classId,
        examName,
      });
    }
    if (!existing) {
      existing = await Exam.findOne({
        studentId: record.studentId,
        periodId,
        examDate: { $gte: dayStart, $lte: dayEnd },
      });
    }

    if (existing) {
      if (existing.status === 'Published' && req.user.role !== 'admin') {
        return res.status(400).json({ message: 'Cannot edit published exam records.' });
      }
      existing.marks = marks;
      existing.totalMarks = totalMarks;
      existing.percentage = percentage;
      existing.grade = grade;
      existing.gpa = gpa;
      existing.isPassed = isPassed;
      existing.attendance = attendance;
      existing.remarks = remarks;
      existing.status = 'Draft';
      existing.examSeasonId = examSeasonId;
      existing.examStructureId = examStructureId;
      existing.examPhase = season.name;
      existing.examType = structureResult.structure.examType;
      existing.classId = classId;
      if (enrollment) existing.enrollmentId = enrollment._id;
      existing.teacherId = teacherId;
      existing.createdBy = req.user._id;
      await existing.save();

      // Clean up any duplicate records for this student, class, period, and season/structure
      await Exam.deleteMany({
        _id: { $ne: existing._id },
        studentId: record.studentId,
        classId,
        periodId,
        examSeasonId,
        examStructureId,
      });

      results.push(existing);
    } else {
      const created = await Exam.create({
        studentId: record.studentId,
        enrollmentId: enrollment?._id,
        classId,
        teacherId,
        periodId,
        examSeasonId,
        examStructureId,
        examPhase: season.name,
        examType: structureResult.structure.examType,
        examName,
        marks,
        totalMarks,
        percentage,
        grade,
        gpa,
        isPassed,
        attendance,
        remarks,
        status: 'Draft',
        examDate: dayStart,
        createdBy: req.user._id,
      });
      results.push(created);
    }
  }

  // Auto-sync ProcessedResult if processed results exist for this class & season
  await recalculateProcessedResultsInternal(classId, examSeasonId, req.user._id);

  res.status(201).json({ message: 'Exam results saved and updated successfully', count: results.length });
};

const recalculateProcessedResultsInternal = async (classId, examSeasonId, userId) => {
  if (!classId || !examSeasonId) return;
  try {
    const existingCount = await ProcessedResult.countDocuments({ classId, examSeasonId });
    if (existingCount === 0) return;

    const cls = await Class.findById(classId);
    if (!cls) return;
    const season = await ExamSeason.findById(examSeasonId);
    if (!season) return;

    const students = await Student.find({ classId }).sort({ name: 1 });
    if (students.length === 0) return;

    const periods = await Period.find({ classId });
    const exams = await Exam.find({ classId, examSeasonId }).sort({ updatedAt: -1 });
    if (exams.length === 0) return;

    const existingProcessedDoc = await ProcessedResult.findOne({ classId, examSeasonId });
    const currentStatus = existingProcessedDoc?.status || 'Processed';

    const studentSummaries = [];

    for (const student of students) {
      const studentExams = exams.filter((e) => e.studentId.toString() === student._id.toString());
      const deduplicatedMap = new Map();
      studentExams.forEach((e) => {
        const key = `${e.periodId.toString()}_${e.examStructureId?.toString() || e.examType}`;
        if (!deduplicatedMap.has(key)) {
          deduplicatedMap.set(key, e);
        }
      });
      const uniqueStudentExams = Array.from(deduplicatedMap.values());

      let totalMarksObtained = 0;
      let totalMaxMarks = 0;
      let totalGpa = 0;
      let passedSubjectsCount = 0;
      let failedSubjectsCount = 0;

      uniqueStudentExams.forEach((e) => {
        totalMarksObtained += e.marks;
        totalMaxMarks += e.totalMarks;
        totalGpa += e.gpa || 0;
        if (e.percentage >= 50) {
          passedSubjectsCount++;
        } else {
          failedSubjectsCount++;
        }
      });

      const percentage = totalMaxMarks > 0 ? Math.round((totalMarksObtained / totalMaxMarks) * 100) : 0;
      const overallGrade = calculateGrade(percentage);
      const gpa = uniqueStudentExams.length > 0 ? Number((totalGpa / uniqueStudentExams.length).toFixed(2)) : 0;
      const missingSubjectsCount = Math.max(0, periods.length - uniqueStudentExams.length);
      const isOverallPassed = isGradePassed(overallGrade) || percentage >= 50;

      let teacherRemarks = 'Good performance.';
      if (percentage >= 80) teacherRemarks = 'Excellent work! Keep it up.';
      else if (percentage >= 70) teacherRemarks = 'Very good performance.';
      else if (percentage >= 50) teacherRemarks = 'Satisfactory performance.';
      else teacherRemarks = 'Needs improvement and extra support.';

      const enrollment = await getOrCreateActiveEnrollment(student._id, classId, userId);

      studentSummaries.push({
        studentId: student._id,
        enrollmentId: enrollment?._id,
        classId,
        examSeasonId,
        academicYear: cls.academicYear || '2025/2026',
        totalMarksObtained,
        totalMaxMarks,
        percentage,
        overallGrade,
        gpa,
        passedSubjectsCount,
        failedSubjectsCount,
        missingSubjectsCount,
        isOverallPassed,
        teacherRemarks,
        principalRemarks: isOverallPassed ? 'Promoted / Passed' : 'Requires Retake / Support',
        status: currentStatus,
        processedBy: userId,
      });
    }

    studentSummaries.sort((a, b) => b.totalMarksObtained - a.totalMarksObtained);
    studentSummaries.forEach((item, index) => {
      item.rank = index + 1;
      item.position = getOrdinalPosition(index + 1);
    });

    for (const summary of studentSummaries) {
      await ProcessedResult.findOneAndUpdate(
        { studentId: summary.studentId, classId: summary.classId, examSeasonId: summary.examSeasonId },
        { $set: summary },
        { upsert: true, new: true }
      );
    }
  } catch (err) {
    console.error('Error auto-recalculating processed results:', err);
  }
};

// Process Class-wide Exam Results for a Season
exports.processExamResults = async (req, res) => {
  const { classId, examSeasonId, academicYear } = req.body;

  if (!classId || !examSeasonId) {
    return res.status(400).json({ message: 'Class and Exam Season are required to process results' });
  }

  const cls = await Class.findById(classId);
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  const season = await ExamSeason.findById(examSeasonId);
  if (!season) return res.status(404).json({ message: 'Exam Season not found' });

  const students = await Student.find({ classId }).sort({ name: 1 });
  if (students.length === 0) {
    return res.status(400).json({ message: 'No students found in this class' });
  }

  const periods = await Period.find({ classId });
  const exams = await Exam.find({ classId, examSeasonId });

  if (exams.length === 0) {
    return res.status(400).json({ message: 'No exam marks found for this class and season. Enter marks first.' });
  }

  const studentSummaries = [];

  for (const student of students) {
    const studentExams = exams.filter((e) => e.studentId.toString() === student._id.toString());

    let totalMarksObtained = 0;
    let totalMaxMarks = 0;
    let totalGpa = 0;
    let passedSubjectsCount = 0;
    let failedSubjectsCount = 0;

    studentExams.forEach((e) => {
      totalMarksObtained += e.marks;
      totalMaxMarks += e.totalMarks;
      totalGpa += e.gpa || 0;
      if (e.percentage >= 50) {
        passedSubjectsCount++;
      } else {
        failedSubjectsCount++;
      }
    });

    const percentage = totalMaxMarks > 0 ? Math.round((totalMarksObtained / totalMaxMarks) * 100) : 0;
    const overallGrade = calculateGrade(percentage);
    const gpa = studentExams.length > 0 ? Number((totalGpa / studentExams.length).toFixed(2)) : 0;
    const missingSubjectsCount = Math.max(0, periods.length - studentExams.length);
    const isOverallPassed = isGradePassed(overallGrade) || percentage >= 50;

    let teacherRemarks = 'Good performance.';
    if (percentage >= 80) teacherRemarks = 'Excellent work! Keep it up.';
    else if (percentage >= 70) teacherRemarks = 'Very good performance.';
    else if (percentage >= 50) teacherRemarks = 'Satisfactory performance.';
    else teacherRemarks = 'Needs improvement and extra support.';

    const enrollment = await getOrCreateActiveEnrollment(student._id, classId, req.user._id);

    studentSummaries.push({
      studentId: student._id,
      enrollmentId: enrollment?._id,
      classId,
      examSeasonId,
      academicYear: academicYear || cls.academicYear || '2025/2026',
      totalMarksObtained,
      totalMaxMarks,
      percentage,
      overallGrade,
      gpa,
      passedSubjectsCount,
      failedSubjectsCount,
      missingSubjectsCount,
      isOverallPassed,
      teacherRemarks,
      principalRemarks: isOverallPassed ? 'Promoted / Passed' : 'Requires Retake / Support',
      status: 'Processed',
      processedBy: req.user._id,
    });
  }

  // Calculate Ranks & Positions
  studentSummaries.sort((a, b) => b.totalMarksObtained - a.totalMarksObtained);
  studentSummaries.forEach((item, index) => {
    item.rank = index + 1;
    item.position = getOrdinalPosition(index + 1);
  });

  // Save to ProcessedResult DB
  for (const summary of studentSummaries) {
    await ProcessedResult.findOneAndUpdate(
      { studentId: summary.studentId, classId: summary.classId, examSeasonId: summary.examSeasonId },
      { $set: summary },
      { upsert: true, new: true }
    );
  }

  // Update Exam statuses to Processed
  await Exam.updateMany({ classId, examSeasonId }, { $set: { status: 'Processed' } });

  res.json({ message: 'Exam results processed successfully', processedCount: studentSummaries.length });
};

// Publish Exam Results
exports.publishExamResults = async (req, res) => {
  const { classId, examSeasonId } = req.body;

  if (!classId || !examSeasonId) {
    return res.status(400).json({ message: 'Class and Exam Season are required' });
  }

  const processed = await ProcessedResult.find({ classId, examSeasonId });
  if (processed.length === 0) {
    return res.status(400).json({ message: 'Cannot publish. Please Process Results for this class and season first.' });
  }

  await ProcessedResult.updateMany(
    { classId, examSeasonId },
    { $set: { status: 'Published', publishedBy: req.user._id } }
  );

  await Exam.updateMany({ classId, examSeasonId }, { $set: { status: 'Published' } });

  res.json({ message: 'Exam results published successfully!' });
};

// Unpublish Exam Results (Admin only)
exports.unpublishExamResults = async (req, res) => {
  const { classId, examSeasonId } = req.body;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only Administrators can unpublish exam results.' });
  }

  await ProcessedResult.updateMany({ classId, examSeasonId }, { $set: { status: 'Processed' } });
  await Exam.updateMany({ classId, examSeasonId }, { $set: { status: 'Processed' } });

  res.json({ message: 'Exam results unpublished. Edits are now unlocked.' });
};

// Get Processed Results for a Class & Season
exports.getProcessedResults = async (req, res) => {
  const { classId, examSeasonId } = req.query;

  if (!classId || !examSeasonId) {
    return res.status(400).json({ message: 'Class and Exam Season are required' });
  }

  const results = await ProcessedResult.find({ classId, examSeasonId })
    .populate('studentId', 'name studentId gender photo')
    .sort({ rank: 1 });

  res.json({ results });
};

// Get Result Card Data for Student Report Card
exports.getResultCardData = async (req, res) => {
  const { studentId, seasonId } = req.params;

  const student = await Student.findById(studentId).populate('classId');
  if (!student) return res.status(404).json({ message: 'Student not found' });

  const season = await ExamSeason.findById(seasonId);
  if (!season) return res.status(404).json({ message: 'Exam Season not found' });

  const classObj = await Class.findById(student.classId).populate('category');
  const settings = (await Settings.findOne()) || {
    schoolName: 'School Management System',
    schoolAddress: 'Mogadishu, Somalia',
    schoolPhone: '+252 61 000 0000',
    schoolEmail: 'info@school.edu.so',
  };

  const processed = await ProcessedResult.findOne({ studentId, examSeasonId: seasonId });
  const studentExams = await Exam.find({ studentId, examSeasonId: seasonId })
    .populate('periodId', 'periodName subject')
    .populate('teacherId', 'name')
    .sort({ examDate: 1 });

  const attendanceSummary = {
    present: studentExams.filter((e) => e.attendance === 'Present').length,
    absent: studentExams.filter((e) => e.attendance === 'Absent').length,
    excused: studentExams.filter((e) => e.attendance === 'Excused').length,
    late: studentExams.filter((e) => e.attendance === 'Late').length,
  };

  res.json({
    school: settings,
    student: {
      _id: student._id,
      studentId: student.studentId,
      name: student.name,
      gender: student.gender,
      className: classObj?.className || 'N/A',
      categoryName: classObj?.category?.name || 'N/A',
      academicYear: classObj?.academicYear || '2025/2026',
    },
    season: { _id: season._id, name: season.name },
    processed: processed || null,
    subjectExams: studentExams.map((e) => ({
      _id: e._id,
      subject: e.periodId?.subject || e.examName,
      teacher: e.teacherId?.name || 'N/A',
      examType: e.examType,
      marks: e.marks,
      totalMarks: e.totalMarks,
      percentage: e.percentage,
      grade: e.grade,
      gpa: e.gpa,
      attendance: e.attendance,
      remarks: e.remarks,
    })),
    attendanceSummary,
  });
};

// Analytics & Reports Endpoint
exports.getExamAnalytics = async (req, res) => {
  const { classId, seasonId } = req.query;
  const query = {};
  if (classId) query.classId = classId;
  if (seasonId) query.examSeasonId = seasonId;

  const processedResults = await ProcessedResult.find(query).populate('studentId', 'name studentId').populate('classId', 'className');
  const exams = await Exam.find(query).populate('periodId', 'subject').populate('studentId', 'name');

  const totalStudents = processedResults.length;
  const passedStudents = processedResults.filter((r) => r.isOverallPassed).length;
  const failedStudents = totalStudents - passedStudents;
  const passRate = totalStudents > 0 ? Math.round((passedStudents / totalStudents) * 100) : 0;

  // Grade Distribution
  const gradeCount = { 'A+': 0, A: 0, B: 0, C: 0, D: 0, F: 0 };
  exams.forEach((e) => {
    if (gradeCount[e.grade] !== undefined) gradeCount[e.grade]++;
  });

  // Top Students
  const topStudents = [...processedResults]
    .sort((a, b) => b.totalMarksObtained - a.totalMarksObtained)
    .slice(0, 10)
    .map((r) => ({
      name: r.studentId?.name || 'N/A',
      studentId: r.studentId?.studentId || 'N/A',
      className: r.classId?.className || 'N/A',
      totalMarks: r.totalMarksObtained,
      percentage: r.percentage,
      grade: r.overallGrade,
      rank: r.position,
    }));

  res.json({
    totalStudents,
    passedStudents,
    failedStudents,
    passRate,
    gradeCount,
    topStudents,
  });
};

exports.createExam = async (req, res) => {
  const { studentId, classId, periodId, marks, examSeasonId, examStructureId, examName, examDate } = req.body;

  if (!examSeasonId || !examStructureId || !examName) {
    return res.status(400).json({ message: 'Exam season, exam type, and name are required' });
  }

  const structureResult = await getExamStructure(classId, examSeasonId, examStructureId);
  if (structureResult.error) return res.status(400).json({ message: structureResult.error });
  const totalMarks = structureResult.structure.maxMarks;

  if (marks > totalMarks) {
    return res.status(400).json({ message: `Marks cannot exceed total marks (${totalMarks})` });
  }

  const allowed = await assertTeacherPeriodAccess(req.user, periodId);
  if (!allowed) {
    return res.status(403).json({ message: 'You can only manage exams for your assigned subjects and periods' });
  }

  const period = await Period.findById(periodId);
  if (!period) return res.status(404).json({ message: 'Period not found' });
  if (period.classId.toString() !== classId) {
    return res.status(400).json({ message: 'Period does not match the selected class' });
  }

  const teacher = req.user.role === 'teacher'
    ? await getTeacherDoc(req.user)
    : await Teacher.findById(period.teacherId);

  if (!teacher) return res.status(400).json({ message: 'Teacher not found for this period' });

  const { percentage, grade, gpa } = calculateExamResult(Number(marks), Number(totalMarks));

  const exam = await Exam.create({
    studentId,
    classId,
    periodId,
    teacherId: teacher._id,
    examSeasonId,
    examStructureId,
    examPhase: (await ExamSeason.findById(examSeasonId)).name,
    examType: structureResult.structure.examType,
    examName,
    marks,
    totalMarks,
    percentage,
    grade,
    gpa,
    isPassed: percentage >= 50,
    examDate,
    createdBy: req.user._id,
  });

  const populated = await Exam.findById(exam._id)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className')
    .populate('periodId', 'periodName subject')
    .populate('teacherId', 'name');

  res.status(201).json(populated);
};

exports.updateExam = async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(404).json({ message: 'Exam not found' });

  if (exam.status === 'Published' && req.user.role !== 'admin') {
    return res.status(400).json({ message: 'Published exam records cannot be modified.' });
  }

  const allowed = await assertTeacherPeriodAccess(req.user, exam.periodId);
  if (!allowed) {
    return res.status(403).json({ message: 'You can only manage exams for your assigned subjects and periods' });
  }

  let totalMarks = req.body.totalMarks ?? exam.totalMarks;
  if (req.body.examSeasonId !== undefined || req.body.examStructureId !== undefined || req.body.classId !== undefined) {
    const structureResult = await getExamStructure(req.body.classId ?? exam.classId, req.body.examSeasonId ?? exam.examSeasonId, req.body.examStructureId ?? exam.examStructureId);
    if (structureResult.error) return res.status(400).json({ message: structureResult.error });
    totalMarks = structureResult.structure.maxMarks;
    req.body.totalMarks = totalMarks;
    req.body.examType = structureResult.structure.examType;
    const season = await ExamSeason.findById(req.body.examSeasonId ?? exam.examSeasonId);
    req.body.examPhase = season.name;
  }
  if (req.body.marks !== undefined) {
    if (req.body.marks > totalMarks) {
      return res.status(400).json({ message: `Marks cannot exceed total marks (${totalMarks})` });
    }
    const { percentage, grade, gpa } = calculateExamResult(Number(req.body.marks), Number(totalMarks));
    req.body.percentage = percentage;
    req.body.grade = grade;
    req.body.gpa = gpa;
    req.body.isPassed = percentage >= 50;
  }

  const updated = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    .populate('studentId', 'name studentId')
    .populate('classId', 'className')
    .populate('periodId', 'periodName subject')
    .populate('teacherId', 'name');

  if (updated && updated.classId && updated.examSeasonId) {
    await recalculateProcessedResultsInternal(updated.classId, updated.examSeasonId, req.user._id);
  }

  res.json(updated);
};

exports.deleteExam = async (req, res) => {
  if (req.user.role === 'teacher') {
    return res.status(403).json({ message: 'Teachers cannot delete exam records' });
  }

  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(404).json({ message: 'Exam not found' });
  await exam.deleteOne();
  res.json({ message: 'Exam deleted successfully' });
};

exports.getClassSubjectsForImport = async (req, res) => {
  try {
    const { classId, examSeasonId, examStructureId } = req.query;
    if (!classId) return res.status(400).json({ message: 'classId is required' });

    const cls = await Class.findById(classId).populate('category');
    if (!cls) return res.status(404).json({ message: 'Class not found' });
    if (!cls.category) return res.status(400).json({ message: 'This class has no category. Update the class first.' });

    // Validate season & structure if provided
    let maxMarks = 100;
    let examType = '';
    let seasonName = '';
    if (examSeasonId && examStructureId) {
      const season = await ExamSeason.findOne({ _id: examSeasonId, categoryId: cls.category._id, status: 'Active' });
      if (!season) return res.status(400).json({ message: 'Exam season not valid for this class category' });
      const structure = await ExamStructure.findOne({ _id: examStructureId, categoryId: cls.category._id, seasonId: season._id, status: 'Active' });
      if (!structure) return res.status(400).json({ message: 'Exam type not valid for this class category and season' });
      maxMarks = structure.maxMarks;
      examType = structure.examType;
      seasonName = season.name;
    }

    // Fetch all periods (subjects) for this class
    let periodsQuery = { classId };
    if (req.user.role === 'teacher') {
      const teacher = await getTeacherDoc(req.user);
      if (teacher) periodsQuery.teacherId = teacher._id;
    }
    const periods = await Period.find(periodsQuery)
      .populate('teacherId', 'name teacherId subject')
      .sort({ subject: 1 });

    // Fetch all students in this class
    const students = await Student.find({ classId }).sort({ name: 1 }).select('studentId name _id');

    return res.json({
      subjects: periods.map((p) => ({
        _id: p._id,
        subject: p.subject || p.periodName,
        periodName: p.periodName,
        teacherId: p.teacherId,
        maxMarks,
      })),
      maxMarks,
      examType,
      seasonName,
      students: students.map((s) => ({ _id: s._id, studentId: s.studentId, name: s.name })),
    });
  } catch (err) {
    console.error('Error in getClassSubjectsForImport:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

exports.importAllSubjectsMarks = async (req, res) => {
  try {
    const {
      classId,
      examSeasonId,
      examStructureId,
      examName,
      examDate,
      overwriteExisting = true,
      records, // [{ studentId, studentName, subjectMarks: { SubjectName: mark, ... } }]
    } = req.body;

    // ── Basic param validation ──────────────────────────────────────────────
    if (!classId || !examSeasonId || !examStructureId || !examName || !examDate || !records?.length) {
      return res.status(400).json({
        success: false,
        message: 'classId, examSeasonId, examStructureId, examName, examDate, and records are required',
      });
    }

    // ── Validate class, season, structure ──────────────────────────────────
    const structureResult = await getExamStructure(classId, examSeasonId, examStructureId);
    if (structureResult.error) return res.status(400).json({ success: false, message: structureResult.error });
    const { cls, structure } = structureResult;
    const totalMarks = structure.maxMarks;
    const season = await ExamSeason.findById(examSeasonId);

    // ── Check publish lock ─────────────────────────────────────────────────
    const existingPublished = await ProcessedResult.findOne({ classId, examSeasonId, status: 'Published' });
    if (existingPublished && req.user?.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Exam results for this season are Published and locked against modifications.',
      });
    }

    // ── Fetch all subjects (periods) for this class ────────────────────────
    const allPeriods = await Period.find({ classId }).populate('teacherId', 'name teacherId subject');
    const subjectMap = new Map(); // subjectName.toUpperCase() → period doc
    allPeriods.forEach((p) => {
      const key = (p.subject || p.periodName).toUpperCase().trim();
      subjectMap.set(key, p);
    });

    // ── Fetch all students in this class ──────────────────────────────────
    const classStudents = await Student.find({ classId });
    const studentByDisplayId = new Map();
    const studentByMongoId = new Map();
    const studentByName = new Map();
    classStudents.forEach((st) => {
      if (st.studentId) studentByDisplayId.set(st.studentId.toString().trim().toUpperCase(), st);
      studentByMongoId.set(st._id.toString(), st);
      if (st.name) studentByName.set(st.name.toString().trim().toUpperCase(), st);
    });

    // ── Per-record validation pass ─────────────────────────────────────────
    const validatedRecords = []; // { student, subjectMarks: [{ period, marks, teacherId }] }
    const errors = [];
    const seenStudentIds = new Set();
    let rowNum = 0;

    // Collect all subject column names from the first record
    const firstRecord = records[0];
    const subjectColumns = Object.keys(firstRecord.subjectMarks || {});

    // Validate that all subject columns exist for this class
    const unknownSubjects = [];
    const periodForSubject = new Map(); // subjectColName → period doc
    for (const colName of subjectColumns) {
      const period = subjectMap.get(colName.toUpperCase().trim());
      if (!period) {
        unknownSubjects.push(colName);
      } else {
        periodForSubject.set(colName, period);
      }
    }
    if (unknownSubjects.length > 0) {
      return res.status(400).json({
        success: false,
        message: `The following subject columns are not assigned to this class: ${unknownSubjects.join(', ')}`,
      });
    }

    for (const record of records) {
      rowNum++;
      const inputId = (record.studentId || '').toString().trim();
      const inputName = (record.studentName || '').toString().trim();

      if (!inputId) {
        errors.push({ row: rowNum, studentId: '', message: 'Student ID is required' });
        continue;
      }

      const key = inputId.toUpperCase();
      if (seenStudentIds.has(key)) {
        errors.push({ row: rowNum, studentId: inputId, message: `Duplicate Student ID ${inputId}` });
        continue;
      }
      seenStudentIds.add(key);

      // Look up student
      let student = studentByDisplayId.get(key) ||
        (mongoose.Types.ObjectId.isValid(inputId) ? studentByMongoId.get(inputId) : null);
      if (!student) {
        // Try global lookup to distinguish "not found" vs "wrong class"
        const global = await Student.findOne({
          $or: [
            { studentId: new RegExp(`^${inputId}$`, 'i') },
            ...(mongoose.Types.ObjectId.isValid(inputId) ? [{ _id: inputId }] : []),
          ],
        });
        if (!global) {
          errors.push({ row: rowNum, studentId: inputId, message: `Student ${inputId} not found` });
        } else {
          errors.push({ row: rowNum, studentId: inputId, message: `Student ${inputId} does not belong to the selected class` });
        }
        continue;
      }

      // Name match check (warn but don't block — just flag)
      if (inputName && student.name.trim().toLowerCase() !== inputName.toLowerCase()) {
        errors.push({ row: rowNum, studentId: inputId, message: `Name '${inputName}' does not match student record '${student.name}'` });
        continue;
      }

      // Validate each subject mark
      const subjectMarksValidated = [];
      let rowHasError = false;
      for (const colName of subjectColumns) {
        const rawMark = record.subjectMarks[colName];
        const period = periodForSubject.get(colName);

        if (rawMark === '' || rawMark === null || rawMark === undefined) {
          errors.push({ row: rowNum, studentId: inputId, message: `Subject '${colName}': mark is missing` });
          rowHasError = true;
          continue;
        }
        const markNum = Number(rawMark);
        if (Number.isNaN(markNum)) {
          errors.push({ row: rowNum, studentId: inputId, message: `Subject '${colName}': mark must be a number` });
          rowHasError = true;
          continue;
        }
        if (markNum < 0) {
          errors.push({ row: rowNum, studentId: inputId, message: `Subject '${colName}': mark cannot be negative` });
          rowHasError = true;
          continue;
        }
        if (markNum > totalMarks) {
          errors.push({ row: rowNum, studentId: inputId, message: `Subject '${colName}': ${markNum} exceeds max marks ${totalMarks}` });
          rowHasError = true;
          continue;
        }

        // Check for existing mark in DB
        const existingExam = await Exam.findOne({
          studentId: student._id,
          classId,
          periodId: period._id,
          examSeasonId,
          examStructureId,
        });
        if (existingExam && !overwriteExisting) {
          errors.push({ row: rowNum, studentId: inputId, message: `Subject '${colName}': student already has marks for this exam` });
          rowHasError = true;
          continue;
        }

        subjectMarksValidated.push({
          period,
          marks: markNum,
          existingExam: existingExam || null,
          teacherId: period.teacherId?._id || period.teacherId,
        });
      }

      if (!rowHasError && subjectMarksValidated.length === subjectColumns.length) {
        validatedRecords.push({ student, subjectMarksValidated });
      }
    }

    // If there are errors, return them without saving
    if (errors.length > 0) {
      return res.status(422).json({
        success: false,
        message: `Validation failed: ${errors.length} error(s) found. No records were saved.`,
        errors,
        summary: {
          totalStudents: records.length,
          totalSubjects: subjectColumns.length,
          valid: validatedRecords.length,
          invalid: errors.length,
        },
      });
    }

    // ── Bulk save ─────────────────────────────────────────────────────────
    const importedRecords = [];

    for (const { student, subjectMarksValidated } of validatedRecords) {
      const enrollment = await getOrCreateActiveEnrollment(student._id, classId, req.user?._id);
      const studentResult = [];

      for (const { period, marks, existingExam, teacherId } of subjectMarksValidated) {
        const { percentage, grade, gpa } = calculateExamResult(marks, totalMarks);
        const isPassed = percentage >= 50;

        if (existingExam) {
          existingExam.marks = marks;
          existingExam.totalMarks = totalMarks;
          existingExam.percentage = percentage;
          existingExam.grade = grade;
          existingExam.gpa = gpa;
          existingExam.isPassed = isPassed;
          existingExam.attendance = 'Present';
          existingExam.status = 'Draft';
          existingExam.examName = examName;
          existingExam.examDate = examDate;
          await existingExam.save();

          // Remove any duplicate exam records for same student/period/season/structure
          await Exam.deleteMany({
            _id: { $ne: existingExam._id },
            studentId: student._id,
            classId,
            periodId: period._id,
            examSeasonId,
            examStructureId,
          });

          studentResult.push({ subject: period.subject || period.periodName, marks, percentage, grade, examId: existingExam._id });
        } else {
          const created = await Exam.create({
            studentId: student._id,
            enrollmentId: enrollment?._id,
            classId,
            examSeasonId,
            examStructureId,
            periodId: period._id,
            teacherId: teacherId || (allPeriods[0]?.teacherId?._id || allPeriods[0]?.teacherId),
            examPhase: season ? season.name : '',
            examType: structure.examType,
            examName,
            marks,
            totalMarks,
            percentage,
            grade,
            gpa,
            isPassed,
            examDate,
            attendance: 'Present',
            remarks: '',
            status: 'Draft',
            createdBy: req.user?._id,
          });
          studentResult.push({ subject: period.subject || period.periodName, marks, percentage, grade, examId: created._id });
        }
      }

      importedRecords.push({
        studentId: student._id,
        studentDisplayId: student.studentId,
        studentName: student.name,
        subjects: studentResult,
      });
    }

    // ── Post-import: recalculate processed results if they exist ──────────
    try {
      await recalculateProcessedResultsInternal(classId, examSeasonId, req.user?._id);
    } catch (e) {
      console.warn('recalculateProcessedResultsInternal failed after multi-subject import:', e.message);
    }

    return res.json({
      success: true,
      message: `Import complete: ${importedRecords.length} students × ${subjectColumns.length} subjects = ${importedRecords.length * subjectColumns.length} marks saved.`,
      summary: {
        totalStudents: importedRecords.length,
        totalSubjects: subjectColumns.length,
        totalMarks: importedRecords.length * subjectColumns.length,
        valid: importedRecords.length,
        invalid: 0,
      },
      records: importedRecords,
      errors: [],
    });
  } catch (globalErr) {
    console.error('Error in importAllSubjectsMarks:', globalErr);
    return res.status(500).json({
      success: false,
      message: globalErr.message || 'Server error during multi-subject marks import',
    });
  }
};

exports.importExamMarks = async (req, res) => {
  try {
    const { classId, teacherId, periodId, examSeasonId, examStructureId, examName, examDate, records, overwriteExisting = true } = req.body;

    if (!classId || !teacherId || !periodId || !examSeasonId || !examStructureId || !examName || !records?.length) {
      return res.status(400).json({ success: false, message: 'Class, teacher, period, exam details, and student records are required' });
    }

    const allowed = await assertTeacherPeriodAccess(req.user, periodId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'You can only manage exams for your assigned subjects and periods' });
    }

    const structureResult = await getExamStructure(classId, examSeasonId, examStructureId);
    if (structureResult.error) return res.status(400).json({ success: false, message: structureResult.error });
    const totalMarks = structureResult.structure.maxMarks;
    const season = await ExamSeason.findById(examSeasonId);

    const period = await Period.findById(periodId);
    if (!period) return res.status(404).json({ success: false, message: 'Period not found' });

    if (period.classId.toString() !== classId) {
      return res.status(400).json({ success: false, message: 'Period does not match the selected class' });
    }

    const existingPublished = await ProcessedResult.findOne({ classId, examSeasonId, status: 'Published' });
    if (existingPublished && req.user?.role !== 'admin') {
      return res.status(400).json({ success: false, message: 'Exam results for this season are Published and locked against modifications.' });
    }

    const classStudents = await Student.find({ classId });
    const studentMap = new Map();
    classStudents.forEach((st) => {
      if (st.studentId) studentMap.set(st.studentId.toString().trim().toUpperCase(), st);
      if (st.name) studentMap.set(st.name.toString().trim().toUpperCase(), st);
      studentMap.set(st._id.toString(), st);
    });

    const importedRecords = [];
    const errors = [];
    const seenStudentIds = new Set();
    let rowNum = 0;

    for (const record of records) {
      rowNum++;
      const inputStudentId = (record.studentId || record.StudentId || record['Student ID'] || record['Adm No'] || record.studentName || record.name || '').toString().trim();
      const rawMarks = record.marks !== undefined ? record.marks : record.Marks;
      const attendance = record.attendance || record.Attendance || 'Present';
      const remarks = record.remarks || record.Remarks || '';

      if (!inputStudentId) {
        errors.push({ row: rowNum, studentId: '', message: 'Student ID is required' });
        continue;
      }

      const key = inputStudentId.toUpperCase();
      if (seenStudentIds.has(key)) {
        errors.push({ row: rowNum, studentId: inputStudentId, message: 'Duplicate Student ID in file' });
        continue;
      }
      seenStudentIds.add(key);

      const student = studentMap.get(key) || (mongoose.Types.ObjectId.isValid(inputStudentId) ? studentMap.get(inputStudentId) : null);

      if (!student) {
        const otherStudent = await Student.findOne({
          $or: [
            { studentId: new RegExp(`^${inputStudentId}$`, 'i') },
            { name: new RegExp(`^${inputStudentId}$`, 'i') },
            ...(mongoose.Types.ObjectId.isValid(inputStudentId) ? [{ _id: inputStudentId }] : []),
          ],
        });
        if (!otherStudent) {
          errors.push({ row: rowNum, studentId: inputStudentId, message: 'Student not found' });
        } else {
          errors.push({ row: rowNum, studentId: inputStudentId, message: 'Student does not belong to selected class' });
        }
        continue;
      }

      if (rawMarks === '' || rawMarks === null || rawMarks === undefined) {
        errors.push({ row: rowNum, studentId: inputStudentId, message: 'Marks are required' });
        continue;
      }

      const marks = Number(rawMarks);
      if (Number.isNaN(marks)) {
        errors.push({ row: rowNum, studentId: inputStudentId, message: 'Marks must be a valid number' });
        continue;
      }

      if (marks < 0) {
        errors.push({ row: rowNum, studentId: inputStudentId, message: 'Marks cannot be negative' });
        continue;
      }

      if (marks > totalMarks) {
        errors.push({ row: rowNum, studentId: inputStudentId, message: `Marks ${marks} cannot be greater than maximum ${totalMarks}` });
        continue;
      }

      let existingExam = await Exam.findOne({
        studentId: student._id,
        classId,
        periodId,
        examSeasonId,
        examStructureId,
      });

      if (existingExam && !overwriteExisting) {
        errors.push({ row: rowNum, studentId: inputStudentId, message: `Student ${student.studentId || student.name} already has marks for this exam.` });
        continue;
      }

      const enrollment = await getOrCreateActiveEnrollment(student._id, classId, req.user?._id);
      const { percentage, grade, gpa } = calculateExamResult(marks, Number(totalMarks));
      const isPassed = percentage >= 50;

      if (existingExam) {
        existingExam.marks = marks;
        existingExam.totalMarks = totalMarks;
        existingExam.percentage = percentage;
        existingExam.grade = grade;
        existingExam.gpa = gpa;
        existingExam.isPassed = isPassed;
        existingExam.attendance = attendance;
        existingExam.remarks = remarks;
        existingExam.status = 'Draft';
        await existingExam.save();
      } else {
        existingExam = await Exam.create({
          studentId: student._id,
          enrollmentId: enrollment?._id,
          classId,
          examSeasonId,
          examStructureId,
          periodId,
          teacherId,
          examPhase: season ? season.name : '',
          examType: structureResult.structure.examType,
          examName,
          marks,
          totalMarks,
          percentage,
          grade,
          gpa,
          isPassed,
          examDate,
          attendance,
          remarks,
          status: 'Draft',
          createdBy: req.user?._id,
        });
      }

      importedRecords.push({
        examId: existingExam._id,
        studentId: student._id,
        studentDisplayId: student.studentId,
        studentName: student.name,
        marks,
        attendance,
        percentage,
        grade,
      });
    }

    return res.json({
      success: true,
      message: `Exam marks import complete: ${importedRecords.length} imported/updated, ${errors.length} failed.`,
      summary: {
        total: records.length,
        imported: importedRecords.length,
        failed: errors.length,
      },
      records: importedRecords,
      errors,
    });
  } catch (globalErr) {
    console.error('Error in importExamMarks controller:', globalErr);
    return res.status(500).json({
      success: false,
      message: globalErr.message || 'Server error during exam marks import',
    });
  }
};

