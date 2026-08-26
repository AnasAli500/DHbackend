const express = require('express');
const {
  getDashboardStats,
  getStudentGrowth,
  getAttendanceAnalytics,
  getExamPerformance,
  getClassDistribution,
  getTeacherDashboard,
  getStudentDashboard,
} = require('../controllers/dashboardController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/stats', authorize('admin'), getDashboardStats);
router.get('/student-growth', authorize('admin'), getStudentGrowth);
router.get('/attendance-analytics', authorize('admin'), getAttendanceAnalytics);
router.get('/exam-performance', authorize('admin'), getExamPerformance);
router.get('/class-distribution', authorize('admin'), getClassDistribution);
router.get('/teacher', authorize('teacher'), getTeacherDashboard);
router.get('/student', authorize('student'), getStudentDashboard);

module.exports = router;
