const express = require('express');
const {
  getAcademicYears,
  getClasses,
  getClassDetails,
  getSeasons,
  getSubjects,
  getExamTypes,
  getClassResults,
  getStudentExamDetails,
  getPublicStudentResult,
} = require('../controllers/viewExamResultsController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Public route (unauthenticated)
router.get('/public-search', getPublicStudentResult);

router.use(protect);

router.get('/academic-years', authorize('admin', 'teacher', 'student'), getAcademicYears);
router.get('/classes', authorize('admin', 'teacher', 'student'), getClasses);
router.get('/class-details/:classId', authorize('admin', 'teacher', 'student'), getClassDetails);
router.get('/seasons', authorize('admin', 'teacher', 'student'), getSeasons);
router.get('/subjects', authorize('admin', 'teacher', 'student'), getSubjects);
router.get('/types', authorize('admin', 'teacher', 'student'), getExamTypes);
router.get('/results', authorize('admin', 'teacher'), getClassResults);
router.get('/student/:studentId', authorize('admin', 'teacher', 'student'), getStudentExamDetails);

module.exports = router;
