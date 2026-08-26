const express = require('express');
const {
  getStudentReport,
  getTeacherReport,
  getAttendanceReport,
  getExamReport,
  getClassReport,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect, authorize('admin'));

router.get('/students', getStudentReport);
router.get('/teachers', getTeacherReport);
router.get('/attendance', getAttendanceReport);
router.get('/exams', getExamReport);
router.get('/classes', getClassReport);

module.exports = router;
