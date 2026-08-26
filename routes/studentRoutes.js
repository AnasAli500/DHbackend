const express = require('express');
const {
  getStudents,
  getStudent,
  createStudent,
  updateStudent,
  deleteStudent,
  exportStudents,
  getAcademicHistory,
  importStudents,
} = require('../controllers/studentController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/', authorize('admin', 'teacher'), getStudents);
router.get('/export', authorize('admin'), exportStudents);
router.get('/academic-history/:id', authorize('admin', 'teacher', 'student'), getAcademicHistory);
router.get('/:id', authorize('admin', 'teacher'), getStudent);
router.post('/import', authorize('admin'), importStudents);
router.post('/', authorize('admin'), createStudent);
router.put('/:id', authorize('admin'), updateStudent);
router.delete('/:id', authorize('admin'), deleteStudent);

module.exports = router;
