const Teacher = require('../models/Teacher');
const Period = require('../models/Period');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Exam = require('../models/Exam');
const Attendance = require('../models/Attendance');
const { generateTeacherId } = require('../utils/generateId');

// Helper to normalize and validate assignments
const processAndValidateAssignments = async (assignments = []) => {
  if (!Array.isArray(assignments)) {
    throw new Error('Assignments must be an array');
  }

  const cleanedAssignments = [];
  const seenSubjects = new Set();
  const seenPairs = new Set();

  for (const item of assignments) {
    if (!item) continue;
    const subject = (item.subject || '').trim();
    if (!subject) continue; // skip empty subject if any

    const subKey = subject.toLowerCase();
    if (seenSubjects.has(subKey)) {
      throw new Error(`Duplicate subject "${subject}" in assignments. A subject can only be listed once with multiple classes.`);
    }
    seenSubjects.add(subKey);

    const rawClasses = Array.isArray(item.classes) ? item.classes : (item.classId ? [item.classId] : []);
    const validClassIds = [];
    const seenClassesInSubject = new Set();

    for (const c of rawClasses) {
      const cId = (c && c._id ? c._id : c)?.toString().trim();
      if (!cId) continue;

      if (seenClassesInSubject.has(cId)) {
        continue; // deduplicate same class within subject
      }
      seenClassesInSubject.add(cId);

      const pairKey = `${subKey}:::${cId}`;
      if (seenPairs.has(pairKey)) {
        throw new Error(`Duplicate assignment detected for subject "${subject}".`);
      }
      seenPairs.add(pairKey);
      validClassIds.push(cId);
    }

    if (validClassIds.length > 0) {
      cleanedAssignments.push({
        subject,
        classes: validClassIds,
      });
    }
  }

  return cleanedAssignments;
};

// Helper to sync Period documents for a teacher
const syncTeacherPeriods = async (teacher, assignments, userId) => {
  // Desired pairs: { subject, classId }
  const desiredPairs = [];
  assignments.forEach((a) => {
    a.classes.forEach((classId) => {
      desiredPairs.push({
        subject: a.subject,
        classId: classId.toString(),
      });
    });
  });

  const existingPeriods = await Period.find({ teacherId: teacher._id });
  const existingMap = new Map();
  existingPeriods.forEach((p) => {
    const key = `${p.subject.trim().toLowerCase()}:::${p.classId.toString()}`;
    existingMap.set(key, p);
  });

  const desiredSet = new Set();

  // Create or keep desired periods
  let firstPeriodId = null;
  for (const item of desiredPairs) {
    const key = `${item.subject.trim().toLowerCase()}:::${item.classId}`;
    desiredSet.add(key);

    if (existingMap.has(key)) {
      const existing = existingMap.get(key);
      if (!firstPeriodId) firstPeriodId = existing._id;
    } else {
      // Find class info for clean periodName
      const cls = await Class.findById(item.classId);
      const periodName = cls ? `${item.subject} - ${cls.className}` : `${item.subject} Period`;

      const newPeriod = await Period.create({
        periodName,
        subject: item.subject,
        teacherId: teacher._id,
        classId: item.classId,
        createdBy: userId,
      });

      if (!firstPeriodId) firstPeriodId = newPeriod._id;
    }
  }

  // Handle removed assignments
  for (const [key, p] of existingMap.entries()) {
    if (!desiredSet.has(key)) {
      // Check if exams or attendance exist for this period
      const hasExams = await Exam.exists({ periodId: p._id });
      const hasAttendance = await Attendance.exists({ periodId: p._id });

      if (!hasExams && !hasAttendance) {
        await p.deleteOne();
      } else {
        // Disassociate teacher without destroying exam/attendance history
        p.teacherId = null;
        await p.save();
      }
    }
  }

  return firstPeriodId;
};

// Helper to hydrate assignments from Periods for legacy teacher records
const hydrateTeacherAssignments = async (teacherDoc) => {
  const teacherObj = teacherDoc.toObject ? teacherDoc.toObject() : { ...teacherDoc };
  if (!teacherObj.assignments || teacherObj.assignments.length === 0) {
    const periods = await Period.find({ teacherId: teacherObj._id }).populate('classId', 'className gradeLevel academicYear');
    if (periods.length > 0) {
      const subjectMap = new Map();
      periods.forEach((p) => {
        if (!p.subject || !p.classId) return;
        const sub = p.subject.trim();
        if (!subjectMap.has(sub)) {
          subjectMap.set(sub, []);
        }
        subjectMap.get(sub).push(p.classId);
      });

      teacherObj.assignments = Array.from(subjectMap.entries()).map(([subject, classes]) => ({
        subject,
        classes,
      }));
      if (!teacherObj.subjects || teacherObj.subjects.length === 0) {
        teacherObj.subjects = Array.from(subjectMap.keys());
      }
    }
  }
  return teacherObj;
};

exports.getTeachers = async (req, res, next) => {
  try {
    const { search, subject, page = 1, limit = 10 } = req.query;
    const query = {};

    if (subject) {
      query.$or = [
        { subject: { $regex: subject, $options: 'i' } },
        { subjects: { $in: [new RegExp(subject, 'i')] } },
      ];
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { teacherId: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Teacher.countDocuments(query);
    const teachersList = await Teacher.find(query)
      .populate('periodId', 'periodName subject')
      .populate('assignments.classes', 'className gradeLevel academicYear')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Hydrate legacy teachers who had periods but no assignments field
    const teachers = await Promise.all(teachersList.map((t) => hydrateTeacherAssignments(t)));

    res.json({ teachers, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
};

exports.getTeacher = async (req, res, next) => {
  try {
    const teacher = await Teacher.findById(req.params.id)
      .populate('periodId', 'periodName subject')
      .populate('assignments.classes', 'className gradeLevel academicYear');

    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    const hydrated = await hydrateTeacherAssignments(teacher);
    res.json(hydrated);
  } catch (error) {
    next(error);
  }
};

exports.createTeacher = async (req, res, next) => {
  try {
    const { name, gender, phone, email, address, assignments = [] } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Teacher Name is required' });
    }
    if (!gender || !['Male', 'Female', 'Other'].includes(gender)) {
      return res.status(400).json({ message: 'Please select a valid gender' });
    }

    // Validate email format if provided
    if (email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ message: 'Please enter a valid email address' });
      }
    }

    // Validate and process assignments
    let cleanedAssignments = [];
    try {
      cleanedAssignments = await processAndValidateAssignments(assignments);
    } catch (valErr) {
      return res.status(400).json({ message: valErr.message });
    }

    const uniqueSubjects = [...new Set(cleanedAssignments.map((a) => a.subject))];
    const joinedSubject = uniqueSubjects.length > 0 ? uniqueSubjects.join(', ') : (req.body.subject || '');

    const teacherId = await generateTeacherId(Teacher);

    const teacher = new Teacher({
      teacherId,
      name: name.trim(),
      gender,
      phone: phone ? phone.trim() : '',
      email: email ? email.trim().toLowerCase() : '',
      address: address ? address.trim() : '',
      subject: joinedSubject,
      subjects: uniqueSubjects,
      assignments: cleanedAssignments,
      createdBy: req.user._id,
    });

    await teacher.save();

    // Synchronize Period collection
    if (cleanedAssignments.length > 0) {
      const firstPeriodId = await syncTeacherPeriods(teacher, cleanedAssignments, req.user._id);
      if (firstPeriodId) {
        teacher.periodId = firstPeriodId;
        await teacher.save();
      }
    }

    const populatedTeacher = await Teacher.findById(teacher._id)
      .populate('assignments.classes', 'className gradeLevel academicYear')
      .populate('periodId', 'periodName subject');

    res.status(201).json(populatedTeacher);
  } catch (error) {
    next(error);
  }
};

exports.updateTeacher = async (req, res, next) => {
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    const { name, gender, phone, email, address, assignments } = req.body;

    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'Teacher Name cannot be empty' });
      }
      teacher.name = name.trim();
    }

    if (gender !== undefined) {
      if (!['Male', 'Female', 'Other'].includes(gender)) {
        return res.status(400).json({ message: 'Please select a valid gender' });
      }
      teacher.gender = gender;
    }

    if (phone !== undefined) teacher.phone = phone ? phone.trim() : '';
    if (email !== undefined) {
      if (email && email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          return res.status(400).json({ message: 'Please enter a valid email address' });
        }
        teacher.email = email.trim().toLowerCase();
      } else {
        teacher.email = '';
      }
    }
    if (address !== undefined) teacher.address = address ? address.trim() : '';

    if (assignments !== undefined) {
      let cleanedAssignments = [];
      try {
        cleanedAssignments = await processAndValidateAssignments(assignments);
      } catch (valErr) {
        return res.status(400).json({ message: valErr.message });
      }

      teacher.assignments = cleanedAssignments;
      teacher.subjects = [...new Set(cleanedAssignments.map((a) => a.subject))];
      teacher.subject = teacher.subjects.length > 0 ? teacher.subjects.join(', ') : '';

      // Sync Period records
      const firstPeriodId = await syncTeacherPeriods(teacher, cleanedAssignments, req.user._id);
      teacher.periodId = firstPeriodId || null;
    } else if (req.body.subject !== undefined) {
      teacher.subject = req.body.subject;
    }

    await teacher.save();

    const populatedTeacher = await Teacher.findById(teacher._id)
      .populate('assignments.classes', 'className gradeLevel academicYear')
      .populate('periodId', 'periodName subject');

    res.json(populatedTeacher);
  } catch (error) {
    next(error);
  }
};

exports.deleteTeacher = async (req, res, next) => {
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
    if (teacher.hasAccount) {
      return res.status(400).json({ message: 'Cannot delete teacher with active user account' });
    }

    // Clean up periods or disassociate
    const periods = await Period.find({ teacherId: teacher._id });
    for (const p of periods) {
      const hasExams = await Exam.exists({ periodId: p._id });
      const hasAttendance = await Attendance.exists({ periodId: p._id });
      if (!hasExams && !hasAttendance) {
        await p.deleteOne();
      } else {
        p.teacherId = null;
        await p.save();
      }
    }

    await teacher.deleteOne();
    res.json({ message: 'Teacher deleted successfully' });
  } catch (error) {
    next(error);
  }
};

exports.processAndValidateAssignments = processAndValidateAssignments;

