const express = require('express');
const {
  getExams,
  getExamSetup,
  getTeachersByClass,
  getPeriodsByClassTeacher,
  getExamSheet,
  createExam,
  bulkSaveExams,
  processExamResults,
  publishExamResults,
  unpublishExamResults,
  getProcessedResults,
  getResultCardData,
  getExamAnalytics,
  updateExam,
  deleteExam,
  importExamMarks,
  getClassSubjectsForImport,
  importAllSubjectsMarks,
} = require('../controllers/examController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/teachers/:classId', authorize('admin', 'teacher'), getTeachersByClass);
router.get('/periods', authorize('admin', 'teacher'), getPeriodsByClassTeacher);
router.get('/sheet', authorize('admin', 'teacher'), getExamSheet);
router.get('/setup', authorize('admin', 'teacher'), getExamSetup);
router.get('/processed', authorize('admin', 'teacher', 'student'), getProcessedResults);
router.get('/result-card/:studentId/:seasonId', authorize('admin', 'teacher', 'student'), getResultCardData);
router.get('/analytics', authorize('admin', 'teacher'), getExamAnalytics);

router.get('/', authorize('admin', 'teacher', 'student'), getExams);
router.post('/bulk', authorize('admin', 'teacher'), bulkSaveExams);
router.post('/import-marks', authorize('admin', 'teacher'), importExamMarks);
router.get('/class-subjects', authorize('admin', 'teacher'), getClassSubjectsForImport);
router.post('/import-all-subjects', authorize('admin', 'teacher'), importAllSubjectsMarks);
router.post('/process', authorize('admin', 'teacher'), processExamResults);
router.post('/publish', authorize('admin'), publishExamResults);
router.post('/unpublish', authorize('admin'), unpublishExamResults);

router.post('/', authorize('admin', 'teacher'), createExam);
router.put('/:id', authorize('admin', 'teacher'), updateExam);
router.delete('/:id', authorize('admin'), deleteExam);

module.exports = router;
