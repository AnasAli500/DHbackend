const express = require('express');
const { getSubjects, createSubject, deleteSubject } = require('../controllers/subjectController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/', authorize('admin', 'teacher'), getSubjects);
router.post('/', authorize('admin'), createSubject);
router.delete('/:id', authorize('admin'), deleteSubject);

module.exports = router;
