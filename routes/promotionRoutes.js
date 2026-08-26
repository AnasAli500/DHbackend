const express = require('express');
const {
  promoteStudents,
  completeAcademicYear,
  moveStudentsToNextClass,
  getStudentsForMove,
  moveSelectedStudents,
} = require('../controllers/promotionController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect, authorize('admin'));

router.get('/students-for-move', getStudentsForMove);
router.post('/move-selected', moveSelectedStudents);
router.post('/promote', promoteStudents);
router.post('/complete-year', completeAcademicYear);
router.post('/move-class', moveStudentsToNextClass);

module.exports = router;
