const express = require('express');
const {
  getAttendance,
  getTeachersByClass,
  getAttendanceSheet,
  recordAttendance,
  bulkRecordAttendance,
  updateAttendance,
  deleteAttendance,
} = require('../controllers/attendanceController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/teachers/:classId', authorize('admin', 'teacher'), getTeachersByClass);
router.get('/sheet', authorize('admin', 'teacher'), getAttendanceSheet);
router.get('/', authorize('admin', 'teacher', 'student'), getAttendance);
router.post('/', authorize('admin', 'teacher'), recordAttendance);
router.post('/bulk', authorize('admin', 'teacher'), bulkRecordAttendance);
router.put('/:id', authorize('admin', 'teacher'), updateAttendance);
router.delete('/:id', authorize('admin'), deleteAttendance);

module.exports = router;
