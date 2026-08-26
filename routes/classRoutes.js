const express = require('express');
const {
  getClasses,
  getClass,
  getClassStudents,
  createClass,
  updateClass,
  completeClass,
  deleteClass,
} = require('../controllers/classController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/', authorize('admin', 'teacher'), getClasses);
router.get('/:id/students', authorize('admin', 'teacher'), getClassStudents);
router.get('/:id', authorize('admin', 'teacher'), getClass);
router.post('/', authorize('admin'), createClass);
router.put('/:id/complete', authorize('admin'), completeClass);
router.put('/:id', authorize('admin'), updateClass);
router.delete('/:id', authorize('admin'), deleteClass);

module.exports = router;
