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
const { calculateGrade, getOrdinalPosition, isGradePassed } = require('../utils/gradeCalculator');

// Helper to get teacher model for current user
const getTeacherDoc = async (user) => {
  if (user.role !== 'teacher') return null;
  return Teacher.findOne({ teacherId: user.teacherId });
};

// Helper to check if teacher has access to classId
const isTeacherAssignedToClass = async (user, classId) => {
  if (user.role !== 'teacher') return true;
  const teacher = await getTeacherDoc(user);
  if (!teacher) return false;

  const cls = await Class.findById(classId);
  if (cls && cls.classTeacher && cls.classTeacher.toString() === teacher._id.toString()) {
    return true;
  }

  const periodCount = await Period.countDocuments({ classId, teacherId: teacher._id });
  return periodCount > 0;
};

// Helper to match exam types flexibly (e.g. "Midterm" vs "Midterm (60 marks)")
const isExamTypeMatch = (type1, type2) => {
  if (!type1 || !type2) return false;
  const t1 = String(type1).toLowerCase().trim();
  const t2 = String(type2).toLowerCase().trim();
  if (t1 === t2) return true;
  const c1 = t1.replace(/\s*\([^)]*\)/g, '').trim();
  const c2 = t2.replace(/\s*\([^)]*\)/g, '').trim();
  if (c1 && c2 && c1 === c2) return true;
  return t1.includes(c2) || t2.includes(c1);
};

// Helper to check teacher subject access
const getTeacherAssignedSubjects = async (user, classId) => {
  if (user.role !== 'teacher') return null; // null means no restriction (admin)
  const teacher = await getTeacherDoc(user);
  if (!teacher) return [];

  const periods = await Period.find({ classId, teacherId: teacher._id });
  const subjects = periods.map(p => p.subject);

  // If teacher is classTeacher, allow all subjects or teacher's periods
  const cls = await Class.findById(classId);
  if (cls && cls.classTeacher && cls.classTeacher.toString() === teacher._id.toString()) {
    const allClassPeriods = await Period.find({ classId });
    return [...new Set(allClassPeriods.map(p => p.subject))];
  }

  return [...new Set(subjects)];
};

// Helper to resolve selected exam types list and label
const resolveSelectedExamTypes = async (classCategoryId, seasonId, examTypeParam) => {
  const structures = await ExamStructure.find({
    categoryId: classCategoryId,
    seasonId,
    status: 'Active',
  }).sort({ examType: 1 });

  const allAvailableTypes = structures.map(s => s.examType);
  const typeMaxMap = {};
  structures.forEach(s => {
    typeMaxMap[s.examType] = s.maxMarks;
  });

  let selectedTypes = [];
  let isFullExam = false;

  if (!examTypeParam || examTypeParam === 'FULL_EXAM' || examTypeParam === 'ALL') {
    selectedTypes = [...allAvailableTypes];
    isFullExam = true;
  } else if (typeof examTypeParam === 'string') {
    selectedTypes = examTypeParam.split(',').map(t => t.trim()).filter(Boolean);
    if (selectedTypes.length === allAvailableTypes.length && allAvailableTypes.every(t => selectedTypes.includes(t))) {
      isFullExam = true;
    }
  } else if (Array.isArray(examTypeParam)) {
    selectedTypes = examTypeParam;
    if (selectedTypes.length === allAvailableTypes.length && allAvailableTypes.every(t => selectedTypes.includes(t))) {
      isFullExam = true;
    }
  }

  // Filter & map to valid types belonging to this season/category using flexible matching
  selectedTypes = selectedTypes
    .map(t => allAvailableTypes.find(avail => isExamTypeMatch(avail, t)) || (allAvailableTypes.includes(t) ? t : null))
    .filter(Boolean);
  selectedTypes = [...new Set(selectedTypes)];

  if (selectedTypes.length === 0) {
    selectedTypes = [...allAvailableTypes];
    isFullExam = true;
  } else if (selectedTypes.length === allAvailableTypes.length) {
    isFullExam = true;
  }

  const label = isFullExam
    ? 'Full Exam'
    : selectedTypes.length === 1
      ? selectedTypes[0]
      : selectedTypes.join(' + ');

  const totalMaxMarks = selectedTypes.reduce((sum, t) => sum + (typeMaxMap[t] || 0), 0);

  return {
    structures,
    allAvailableTypes,
    selectedTypes,
    isFullExam,
    isCombined: selectedTypes.length > 1,
    combinedExamLabel: label,
    totalMaxMarks,
    typeMaxMap,
  };
};

// GET /api/exam-results/academic-years
exports.getAcademicYears = async (req, res) => {
  try {
    const classYears = await Class.distinct('academicYear');
    const enrollmentYears = await Enrollment.distinct('academicYear');
    const combinedYears = [...new Set([...classYears, ...enrollmentYears])].filter(Boolean);
    const sortedYears = combinedYears.sort().reverse();
    if (sortedYears.length === 0) {
      const currentYear = new Date().getFullYear().toString();
      return res.json({ years: [currentYear] });
    }
    res.json({ years: sortedYears });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/exam-results/classes
exports.getClasses = async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = {};
    if (academicYear) query.academicYear = academicYear;

    if (req.user.role === 'teacher') {
      const teacher = await getTeacherDoc(req.user);
      if (!teacher) {
        return res.json({ classes: [] });
      }
      const periodClassIds = await Period.distinct('classId', { teacherId: teacher._id });
      const teacherClassIds = await Class.distinct('_id', { classTeacher: teacher._id });
      const combinedIds = [...new Set([...periodClassIds.map(id => id.toString()), ...teacherClassIds.map(id => id.toString())])];
      query._id = { $in: combinedIds };
    }

    const classes = await Class.find(query)
      .populate('category', 'name code academicType')
      .sort({ className: 1 });

    res.json({ classes });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/exam-results/class-details/:classId
exports.getClassDetails = async (req, res) => {
  try {
    const { classId } = req.params;
    const hasAccess = await isTeacherAssignedToClass(req.user, classId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'You are not authorized to view results for this class' });
    }

    const cls = await Class.findById(classId).populate('category', 'name code academicType');
    if (!cls) {
      return res.status(404).json({ message: 'Class not found' });
    }

    const totalStudents = await Student.countDocuments({ classId });

    res.json({
      classInfo: {
        _id: cls._id,
        className: cls.className,
        gradeLevel: cls.gradeLevel,
        academicYear: cls.academicYear,
        category: cls.category,
        totalStudents,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/exam-results/seasons
exports.getSeasons = async (req, res) => {
  try {
    const { classId } = req.query;
    let query = { status: 'Active' };

    if (classId) {
      const cls = await Class.findById(classId).populate('category');
      if (cls && cls.category) {
        query.categoryId = cls.category._id;
      }
    }

    const seasons = await ExamSeason.find(query).sort({ name: 1 });
    res.json({ seasons });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/exam-results/subjects
exports.getSubjects = async (req, res) => {
  try {
    const { classId } = req.query;
    let periodsQuery = {};
    if (classId) periodsQuery.classId = classId;

    if (req.user.role === 'teacher' && classId) {
      const allowedSubjects = await getTeacherAssignedSubjects(req.user, classId);
      if (allowedSubjects && allowedSubjects.length > 0) {
        periodsQuery.subject = { $in: allowedSubjects };
      }
    }

    const periods = await Period.find(periodsQuery).select('subject periodName').sort({ subject: 1 });
    const uniqueSubjects = [...new Set(periods.map(p => p.subject))];

    res.json({ subjects: uniqueSubjects });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/exam-results/types
exports.getExamTypes = async (req, res) => {
  try {
    const { classId, seasonId } = req.query;
    const query = { status: 'Active' };

    if (seasonId) query.seasonId = seasonId;
    if (classId) {
      const cls = await Class.findById(classId);
      if (cls && cls.category) query.categoryId = cls.category;
    }

    const structures = await ExamStructure.find(query).sort({ examType: 1 });
    const totalSeasonMaxMarks = structures.reduce((sum, s) => sum + s.maxMarks, 0);

    res.json({ examTypes: structures, totalSeasonMaxMarks });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/exam-results/results (Supports Combined Exam Types)
exports.getClassResults = async (req, res) => {
  try {
    const { classId, seasonId, subject, examType, search } = req.query;

    if (!classId || !seasonId || !examType) {
      return res.status(400).json({ message: 'classId, seasonId, and examType are required' });
    }

    const hasAccess = await isTeacherAssignedToClass(req.user, classId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this class' });
    }

    // Teacher subject permissions
    const allowedSubjects = await getTeacherAssignedSubjects(req.user, classId);
    if (req.user.role === 'teacher' && allowedSubjects) {
      if (subject && subject !== 'ALL' && !allowedSubjects.includes(subject)) {
        return res.status(403).json({ message: 'Access denied to this subject' });
      }
    }

    // Fetch class and category
    const cls = await Class.findById(classId).populate('category');
    if (!cls) return res.status(404).json({ message: 'Class not found' });

    // Resolve combined exam types
    const {
      selectedTypes,
      isCombined,
      isFullExam,
      combinedExamLabel,
      totalMaxMarks,
      typeMaxMap
    } = await resolveSelectedExamTypes(cls.category._id, seasonId, examType);

    // Fetch all students who are currently in class or were enrolled/had exams in classId
    const enrolledStudents = await Enrollment.distinct('studentId', { classId });
    const examStudents = await Exam.distinct('studentId', { classId, examSeasonId: seasonId });
    const allStudentIdsInClass = [...new Set([...enrolledStudents.map(id => id.toString()), ...examStudents.map(id => id.toString())])];

    let studentQuery = {
      $or: [
        { classId },
        { _id: { $in: allStudentIdsInClass } }
      ]
    };
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      studentQuery = {
        $and: [
          studentQuery,
          {
            $or: [
              { name: searchRegex },
              { studentId: searchRegex }
            ]
          }
        ]
      };
    }
    const students = await Student.find(studentQuery).sort({ name: 1 });
    const totalClassStudents = students.length;

    // Fetch periods for class
    let periodQuery = { classId };
    if (req.user.role === 'teacher' && allowedSubjects) {
      periodQuery.subject = { $in: allowedSubjects };
    }
    const periods = await Period.find(periodQuery);
    const subjectList = [...new Set(periods.map(p => p.subject))];

    const seasonDoc = await ExamSeason.findById(seasonId);

    // Fetch exams matching class, season
    const examQuery = {
      classId,
      $or: [
        { examSeasonId: seasonId },
        ...(seasonDoc ? [{ examPhase: seasonDoc.name }] : [])
      ]
    };

    let exams = await Exam.find(examQuery).populate('periodId', 'subject').populate('studentId', 'name studentId');

    const isAllSubjects = !subject || subject === 'ALL';

    if (!isAllSubjects) {
      const subjRegex = new RegExp(`^${subject.trim()}$`, 'i');
      exams = exams.filter(e => e.periodId && e.periodId.subject && subjRegex.test(e.periodId.subject));
    }

    if (!isAllSubjects) {
      // SINGLE SUBJECT VIEW (Combined across selected exam types for this subject)
      const rows = [];

      for (const student of students) {
        const studentExams = exams.filter(e =>
          e.studentId && e.studentId._id.toString() === student._id.toString()
        );
        if (studentExams.length === 0) continue;

        const examTypeMarks = {};
        let totalObtained = 0;
        let totalMax = 0;

        selectedTypes.forEach(t => {
          const matchingExams = studentExams.filter(e => isExamTypeMatch(e.examType, t));
          matchingExams.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt) || b.marks - a.marks);
          const match = matchingExams[0];
          if (match) {
            examTypeMarks[t] = match.marks;
            totalObtained += match.marks;
            totalMax += match.totalMarks;
          } else {
            examTypeMarks[t] = null;
            totalMax += (typeMaxMap[t] || 0);
          }
        });

        const percentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(2)) : 0;
        const grade = calculateGrade(percentage);
        const isPassed = percentage >= 50;

        rows.push({
          studentId: student._id,
          name: student.name,
          admissionNumber: student.studentId,
          subject,
          examTypeMarks,
          marksObtained: totalObtained,
          maximumMarks: totalMax,
          totalDisplay: `${totalObtained}`,
          percentage,
          grade,
          status: isPassed ? 'Pass' : 'Fail',
        });
      }

      // Rank by percentage / marksObtained
      rows.sort((a, b) => b.percentage - a.percentage || b.marksObtained - a.marksObtained);
      rows.forEach((r, idx) => {
        r.rank = idx + 1;
      });

      // Class Summary calculations
      const totalStudents = rows.length;
      let averageMarks = 0;
      let highestScore = 0;
      let lowestScore = 0;
      let passCount = 0;
      let failCount = 0;

      if (totalStudents > 0) {
        const percentages = rows.map(r => r.percentage);
        const sumPct = percentages.reduce((acc, val) => acc + val, 0);
        averageMarks = Number((sumPct / totalStudents).toFixed(1));
        highestScore = Math.max(...percentages);
        lowestScore = Math.min(...percentages);
        passCount = rows.filter(r => r.status === 'Pass').length;
        failCount = rows.filter(r => r.status === 'Fail').length;
      }

      const passPercentage = totalStudents > 0 ? Number(((passCount / totalStudents) * 100).toFixed(1)) : 0;

      return res.json({
        viewType: 'single',
        subjectName: subject,
        selectedExamTypes: selectedTypes,
        isCombined,
        isFullExam,
        combinedExamLabel,
        totalMaxMarks,
        classInfo: {
          className: cls.className,
          gradeLevel: cls.gradeLevel,
          category: cls.category?.name || 'N/A',
          academicYear: cls.academicYear,
          totalStudents: totalClassStudents,
        },
        summary: {
          totalStudents,
          averageMarks: `${averageMarks}%`,
          highestScore: `${highestScore}%`,
          lowestScore: `${lowestScore}%`,
          passCount,
          failCount,
          passPercentage: `${passPercentage}%`,
        },
        results: rows,
      });

    } else {
      // ALL SUBJECTS VIEW (Combined across selected exam types for ALL subjects)
      const studentRows = [];

      for (const student of students) {
        const studentExams = exams.filter(e =>
          e.studentId && e.studentId._id.toString() === student._id.toString()
        );
        if (studentExams.length === 0) continue;

        const subjectMarks = {};
        let totalObtained = 0;
        let totalMax = 0;

        subjectList.forEach(subj => {
          const subjExams = studentExams.filter(e => e.periodId && e.periodId.subject === subj);
          let subjObtained = 0;
          let subjMax = 0;

          if (subjExams.length > 0) {
            selectedTypes.forEach(t => {
              const matchingExams = subjExams.filter(e => isExamTypeMatch(e.examType, t));
              matchingExams.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt) || b.marks - a.marks);
              const match = matchingExams[0];
              if (match) {
                subjObtained += match.marks;
                subjMax += match.totalMarks;
              } else {
                subjMax += (typeMaxMap[t] || 0);
              }
            });

            subjectMarks[subj] = {
              obtained: subjObtained,
              max: subjMax,
              display: `${subjObtained}`,
            };
            totalObtained += subjObtained;
            totalMax += subjMax;
          } else {
            subjectMarks[subj] = { obtained: 0, max: totalMaxMarks, display: '-' };
          }
        });

        const avgPercentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(2)) : 0;
        const grade = calculateGrade(avgPercentage);
        const isPassed = avgPercentage >= 50;

        studentRows.push({
          studentId: student._id,
          name: student.name,
          admissionNumber: student.studentId,
          subjectMarks,
          totalObtained,
          totalMax,
          totalDisplay: `${totalObtained}`,
          averagePercentage: avgPercentage,
          averageDisplay: `${avgPercentage}%`,
          grade,
          status: isPassed ? 'Pass' : 'Fail',
        });
      }

      // Rank by averagePercentage / totalObtained
      studentRows.sort((a, b) => b.averagePercentage - a.averagePercentage || b.totalObtained - a.totalObtained);
      studentRows.forEach((r, idx) => {
        r.rank = idx + 1;
      });

      // Class Summary calculations
      const totalStudents = studentRows.length;
      let averageMarks = 0;
      let highestScore = 0;
      let lowestScore = 0;
      let passCount = 0;
      let failCount = 0;

      if (totalStudents > 0) {
        const pcts = studentRows.map(r => r.averagePercentage);
        const sumPct = pcts.reduce((acc, val) => acc + val, 0);
        averageMarks = Number((sumPct / totalStudents).toFixed(1));
        highestScore = Math.max(...pcts);
        lowestScore = Math.min(...pcts);
        passCount = studentRows.filter(r => r.status === 'Pass').length;
        failCount = studentRows.filter(r => r.status === 'Fail').length;
      }

      const passPercentage = totalStudents > 0 ? Number(((passCount / totalStudents) * 100).toFixed(1)) : 0;

      return res.json({
        viewType: 'all',
        subjects: subjectList,
        selectedExamTypes: selectedTypes,
        isCombined,
        isFullExam,
        combinedExamLabel,
        totalMaxMarks,
        classInfo: {
          className: cls.className,
          gradeLevel: cls.gradeLevel,
          category: cls.category?.name || 'N/A',
          academicYear: cls.academicYear,
          totalStudents: totalClassStudents,
        },
        summary: {
          totalStudents,
          averageMarks: `${averageMarks}%`,
          highestScore: `${highestScore}%`,
          lowestScore: `${lowestScore}%`,
          passCount,
          failCount,
          passPercentage: `${passPercentage}%`,
        },
        results: studentRows,
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/exam-results/student/:studentId (Supports Combined Exam Breakdown)
exports.getStudentExamDetails = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { classId, seasonId, examType, subject } = req.query;

    let student = null;
    const cleanId = String(studentId).trim();

    if (cleanId === 'me') {
      if (req.user.studentId) {
        student = await Student.findOne({ studentId: req.user.studentId }).populate('classId');
        if (!student && mongoose.Types.ObjectId.isValid(req.user.studentId)) {
          student = await Student.findById(req.user.studentId).populate('classId');
        }
      }
      if (!student) {
        student = await Student.findOne({ createdBy: req.user._id }).populate('classId');
      }
    } else {
      if (mongoose.Types.ObjectId.isValid(cleanId)) {
        student = await Student.findById(cleanId).populate('classId');
      }
      if (!student) {
        student = await Student.findOne({ studentId: cleanId }).populate('classId');
      }
      if (!student) {
        student = await Student.findOne({ studentId: { $regex: new RegExp(`^${cleanId}$`, 'i') } }).populate('classId');
      }
    }

    if (!student) {
      return res.status(404).json({ message: 'Ardayga rool lambarkan leh ma jiro (Student record not found)' });
    }

    const effectiveClassId = classId || student.classId?._id;
    if (!effectiveClassId) {
      return res.status(400).json({ message: 'Student class not found' });
    }

    // Permission check for teacher
    const hasAccess = await isTeacherAssignedToClass(req.user, effectiveClassId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'You are not authorized to view results for this student' });
    }

    const allowedSubjects = await getTeacherAssignedSubjects(req.user, effectiveClassId);
    if (req.user.role === 'teacher' && allowedSubjects && subject && subject !== 'ALL' && !allowedSubjects.includes(subject)) {
      return res.status(403).json({ message: 'You are not authorized to view this subject result' });
    }

    const cls = await Class.findById(effectiveClassId).populate('category');
    const season = seasonId ? await ExamSeason.findById(seasonId) : null;
    const settings = (await Settings.findOne()) || {
      schoolName: 'School Management System',
      schoolAddress: '123 Education Street',
      schoolPhone: '+1 234 567 8900',
      schoolEmail: 'info@demohighschool.com',
    };

    // Resolve selected exam types
    const {
      selectedTypes,
      isCombined,
      isFullExam,
      combinedExamLabel,
      totalMaxMarks,
      typeMaxMap
    } = seasonId
      ? await resolveSelectedExamTypes(cls.category._id, seasonId, examType)
      : { selectedTypes: [], isCombined: false, isFullExam: false, combinedExamLabel: examType || 'All', totalMaxMarks: 100, typeMaxMap: {} };

    // Query student exams
    const examQuery = {
      studentId: student._id,
      classId: effectiveClassId,
    };
    if (seasonId) examQuery.examSeasonId = seasonId;
    if (selectedTypes.length > 0) examQuery.examType = { $in: selectedTypes };

    let studentExams = await Exam.find(examQuery)
      .populate('periodId', 'subject periodName')
      .populate('teacherId', 'name')
      .sort({ examDate: 1 });

    // Filter teacher allowed subjects or specific subject filter
    if (req.user.role === 'teacher' && allowedSubjects) {
      studentExams = studentExams.filter(e => e.periodId && allowedSubjects.includes(e.periodId.subject));
    }
    if (subject && subject !== 'ALL') {
      studentExams = studentExams.filter(e => e.periodId && e.periodId.subject === subject);
    }

    // Calculate class rank among entire class for this combined selection
    let classRank = null;
    let totalClassStudents = await Student.countDocuments({ classId: effectiveClassId });

    if (seasonId && selectedTypes.length > 0) {
      const allClassExams = await Exam.find({
        classId: effectiveClassId,
        examSeasonId: seasonId,
        examType: { $in: selectedTypes }
      });

      const studentMap = {};

      allClassExams.forEach(e => {
        const sId = e.studentId.toString();
        if (!studentMap[sId]) {
          studentMap[sId] = { obtained: 0, max: 0 };
        }
        studentMap[sId].obtained += e.marks;
        studentMap[sId].max += e.totalMarks;
      });

      const rankedStudents = Object.keys(studentMap).map(sId => ({
        sId,
        percentage: studentMap[sId].max > 0 ? Math.round((studentMap[sId].obtained / studentMap[sId].max) * 100) : 0,
        obtained: studentMap[sId].obtained,
      }));

      rankedStudents.sort((a, b) => b.percentage - a.percentage || b.obtained - a.obtained);
      const studentRankIdx = rankedStudents.findIndex(r => r.sId === student._id.toString());
      if (studentRankIdx !== -1) {
        classRank = studentRankIdx + 1;
      }
    }

    // Subject & Exam Breakdown Results
    const subjectResultsMap = {};

    studentExams.forEach(e => {
      const subjName = e.periodId ? e.periodId.subject : 'N/A';
      if (!subjectResultsMap[subjName]) {
        subjectResultsMap[subjName] = {
          subject: subjName,
          examBreakdown: [],
          totalObtained: 0,
          totalMax: 0,
        };
      }

      subjectResultsMap[subjName].examBreakdown.push({
        examType: e.examType,
        marksObtained: e.marks,
        maxMarks: e.totalMarks,
        percentage: `${e.percentage}%`,
        grade: e.grade,
        status: e.isPassed ? 'Pass' : 'Fail',
      });

      subjectResultsMap[subjName].totalObtained += e.marks;
      subjectResultsMap[subjName].totalMax += e.totalMarks;
    });

    const subjectResultsList = Object.values(subjectResultsMap).map(s => {
      const pct = s.totalMax > 0 ? Number(((s.totalObtained / s.totalMax) * 100).toFixed(1)) : 0;
      const grade = calculateGrade(pct);
      const isPassed = pct >= 50;

      return {
        subject: s.subject,
        examBreakdown: s.examBreakdown,
        marksObtained: s.totalObtained,
        maxMarks: s.totalMax,
        percentage: `${pct}%`,
        pctValue: pct,
        grade,
        status: isPassed ? 'Pass' : 'Fail',
      };
    });

    // Total summary statistics across all subject exams
    let totalMarksObtained = 0;
    let summaryTotalMaxMarks = 0;
    let passedCount = 0;
    let failedCount = 0;

    subjectResultsList.forEach(s => {
      totalMarksObtained += s.marksObtained;
      summaryTotalMaxMarks += s.maxMarks;
      if (s.status === 'Pass') passedCount++;
      else failedCount++;
    });

    const averagePct = summaryTotalMaxMarks > 0 ? Number(((totalMarksObtained / summaryTotalMaxMarks) * 100).toFixed(1)) : 0;
    const overallGrade = calculateGrade(averagePct);

    // SONEB National Exam Passing Rule:
    // 1- Student sits for at least 7 subjects
    // 2- Top 7 subjects average must not be lower than C- (50%)
    let overallStatus = 'N/A';
    let decision = 'N/A';

    if (subjectResultsList.length >= 7) {
      const pcts = subjectResultsList.map(s => s.pctValue || 0).sort((a, b) => b - a);
      const top7 = pcts.slice(0, 7);
      const top7Avg = top7.reduce((sum, v) => sum + v, 0) / 7;
      const isTop7Passed = top7Avg >= 50;

      overallStatus = isTop7Passed ? 'PASS' : 'FAIL';
      decision = isTop7Passed ? 'Gudbay' : 'Dhacay';
    } else if (subjectResultsList.length > 0) {
      const isPassed = averagePct >= 50 && failedCount === 0;
      overallStatus = isPassed ? 'PASS' : 'FAIL';
      decision = isPassed ? 'Gudbay' : 'Dhacay';
    }

    res.json({
      school: settings,
      studentInfo: {
        _id: student._id,
        name: student.name,
        admissionNumber: student.studentId,
        classId: cls?._id,
        className: cls?.className || 'N/A',
        gradeLevel: cls?.gradeLevel || 'N/A',
        category: cls?.category?.name || 'N/A',
        categoryId: cls?.category?._id,
        academicYear: cls?.academicYear || '2026',
      },
      examDetails: {
        seasonName: season?.name || 'All Seasons',
        examTypeLabel: combinedExamLabel,
        selectedTypes,
        isCombined,
        isFullExam,
        subjectFilter: subject || 'All Subjects',
      },
      summary: {
        totalSubjects: subjectResultsList.length,
        totalMarks: `${totalMarksObtained}`,
        totalMarksObtained,
        totalMaxMarks,
        average: `${averagePct}%`,
        averagePct,
        overallGrade,
        passed: passedCount,
        failed: failedCount,
        overallStatus,
        classRank: classRank ? `${classRank} / ${totalClassStudents}` : 'N/A',
        rankValue: classRank,
        totalClassStudents,
      },
      subjectResults: subjectResultsList,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/exam-results/public-search
exports.getPublicStudentResult = async (req, res) => {
  try {
    const { rollNumber } = req.query;

    if (!rollNumber || !String(rollNumber).trim()) {
      return res.status(400).json({ message: 'Roll Number / Student ID is required.' });
    }

    const cleanId = String(rollNumber).trim();

    // Find student by studentId (case-insensitive regex)
    let student = await Student.findOne({
      studentId: { $regex: new RegExp(`^${cleanId}$`, 'i') }
    }).populate('classId');

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const classObj = await Class.findById(student.classId?._id || student.classId).populate('category');

    // Fetch published processed results
    const publishedProcessed = await ProcessedResult.find({
      studentId: student._id,
      status: 'Published',
    }).populate('examSeasonId').populate('classId').sort({ updatedAt: -1 });

    // Fetch published individual subject exams
    const publishedExams = await Exam.find({
      studentId: student._id,
      status: 'Published',
    }).populate('periodId', 'subject periodName').populate('examSeasonId', 'name').sort({ examDate: 1 });

    if (publishedProcessed.length === 0 && publishedExams.length === 0) {
      return res.status(404).json({ message: 'Result not available.' });
    }

    // Get school settings
    const settings = (await Settings.findOne()) || {
      schoolName: 'School Management System',
      schoolAddress: '123 Education Street',
      schoolPhone: '+1 234 567 8900',
      schoolEmail: 'info@demohighschool.com',
    };

    // Construct subject breakdown
    const subjectResultsMap = {};
    publishedExams.forEach(e => {
      const subjName = e.periodId ? e.periodId.subject : e.examName || 'N/A';
      if (!subjectResultsMap[subjName]) {
        subjectResultsMap[subjName] = {
          subject: subjName,
          marksObtained: 0,
          maxMarks: 0,
          examBreakdown: [],
        };
      }
      subjectResultsMap[subjName].examBreakdown.push({
        examType: e.examType,
        marksObtained: e.marks,
        maxMarks: e.totalMarks,
        percentage: `${e.percentage}%`,
        grade: e.grade,
        status: e.isPassed ? 'Pass' : 'Fail',
      });
      subjectResultsMap[subjName].marksObtained += e.marks;
      subjectResultsMap[subjName].maxMarks += e.totalMarks;
    });

    const subjectResultsList = Object.values(subjectResultsMap).map(s => {
      const pct = s.maxMarks > 0 ? Number(((s.marksObtained / s.maxMarks) * 100).toFixed(1)) : 0;
      const grade = calculateGrade(pct);
      const isPassed = isGradePassed(grade) || pct >= 50;
      return {
        subject: s.subject,
        examBreakdown: s.examBreakdown,
        marksObtained: s.marksObtained,
        maxMarks: s.maxMarks,
        percentage: `${pct}%`,
        grade,
        status: isPassed ? 'Pass' : 'Fail',
      };
    });

    // Summary calculation
    let totalMarksObtained = 0;
    let summaryTotalMaxMarks = 0;
    let passedCount = 0;
    let failedCount = 0;

    subjectResultsList.forEach(s => {
      totalMarksObtained += s.marksObtained;
      summaryTotalMaxMarks += s.maxMarks;
      if (s.status === 'Pass') passedCount++;
      else failedCount++;
    });

    const latestProcessed = publishedProcessed[0] || null;

    const percentage = latestProcessed
      ? latestProcessed.percentage
      : summaryTotalMaxMarks > 0
        ? Number(((totalMarksObtained / summaryTotalMaxMarks) * 100).toFixed(1))
        : 0;

    const overallGrade = latestProcessed ? latestProcessed.overallGrade : calculateGrade(percentage);
    const isOverallPassed = isGradePassed(overallGrade) || percentage >= 50;
    const overallStatus = isOverallPassed ? 'PASS' : 'FAIL';

    res.json({
      school: settings,
      studentInfo: {
        _id: student._id,
        name: student.name,
        admissionNumber: student.studentId,
        className: classObj?.className || 'N/A',
        gradeLevel: classObj?.gradeLevel || 'N/A',
        academicYear: classObj?.academicYear || 'N/A',
        category: classObj?.category?.name || 'N/A',
      },
      summary: {
        totalMarksObtained: latestProcessed ? latestProcessed.totalMarksObtained : totalMarksObtained,
        totalMaxMarks: latestProcessed ? latestProcessed.totalMaxMarks : summaryTotalMaxMarks,
        percentage: `${percentage}%`,
        pctValue: percentage,
        overallGrade,
        gpa: latestProcessed ? latestProcessed.gpa : 0,
        rank: latestProcessed?.position || (latestProcessed?.rank ? `#${latestProcessed.rank}` : 'N/A'),
        isOverallPassed,
        overallStatus,
        status: isOverallPassed ? 'PASSED' : 'FAILED',
        teacherRemarks: latestProcessed?.teacherRemarks || (isOverallPassed ? 'Good performance.' : 'Needs improvement.'),
        principalRemarks: latestProcessed?.principalRemarks || (isOverallPassed ? 'Passed' : 'Requires Retake'),
        totalSubjects: subjectResultsList.length,
        passedSubjectsCount: latestProcessed ? latestProcessed.passedSubjectsCount : passedCount,
        failedSubjectsCount: latestProcessed ? latestProcessed.failedSubjectsCount : failedCount,
        seasonName: latestProcessed?.examSeasonId?.name || publishedExams[0]?.examSeasonId?.name || 'Exam Season',
      },
      subjectResults: subjectResultsList,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

