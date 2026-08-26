const Enrollment = require('../models/Enrollment');
const Class = require('../models/Class');
const Student = require('../models/Student');

/**
 * Ensures a student has an active enrollment record for their current class.
 */
const getOrCreateActiveEnrollment = async (studentId, classId, userId = null) => {
  if (!studentId || !classId) return null;

  let activeEnrollment = await Enrollment.findOne({
    studentId,
    classId,
    status: 'Active',
  });

  if (!activeEnrollment) {
    const cls = await Class.findById(classId);
    if (!cls) return null;

    activeEnrollment = await Enrollment.create({
      studentId,
      classId,
      academicYear: cls.academicYear || new Date().getFullYear().toString(),
      startDate: new Date(),
      status: 'Active',
      promotionStatus: 'Pending',
      createdBy: userId,
    });
  }

  return activeEnrollment;
};

/**
 * Closes an active enrollment for a student.
 */
const closeEnrollment = async (studentId, classId, promotionStatus = 'Promoted', endDate = new Date()) => {
  const query = { studentId, status: 'Active' };
  if (classId) query.classId = classId;

  const enrollment = await Enrollment.findOne(query);
  if (enrollment) {
    let finalStatus = 'Completed';
    if (promotionStatus === 'Transferred') finalStatus = 'Transferred';
    if (promotionStatus === 'Withdrawn') finalStatus = 'Withdrawn';
    if (promotionStatus === 'Repeating') finalStatus = 'Completed';

    enrollment.status = finalStatus;
    enrollment.promotionStatus = promotionStatus;
    enrollment.endDate = endDate;
    await enrollment.save();
  }
  return enrollment;
};

/**
 * Moves a student from one class to another cleanly maintaining history.
 */
const moveStudentToClass = async ({
  studentId,
  fromClassId,
  toClassId,
  academicYear,
  promotionStatus = 'Promoted',
  userId = null,
}) => {
  const targetClass = await Class.findById(toClassId);
  if (!targetClass) {
    throw new Error(`Target class not found`);
  }

  const targetAcademicYear = academicYear || targetClass.academicYear;

  // 1. Close old enrollment
  await closeEnrollment(studentId, fromClassId, promotionStatus);

  // 2. Create new active enrollment for target class
  const newEnrollment = await Enrollment.create({
    studentId,
    classId: toClassId,
    academicYear: targetAcademicYear,
    startDate: new Date(),
    status: 'Active',
    promotionStatus: 'Pending',
    createdBy: userId,
  });

  // 3. Update student's current classId
  await Student.findByIdAndUpdate(studentId, { classId: toClassId });

  return newEnrollment;
};

module.exports = {
  getOrCreateActiveEnrollment,
  closeEnrollment,
  moveStudentToClass,
};
