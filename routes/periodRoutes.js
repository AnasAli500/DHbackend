const express = require('express');
const {
  getPeriods,
  getPeriod,
  createPeriod,
  updatePeriod,
  deletePeriod,
  getMyPeriods,
} = require('../controllers/periodController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/my', authorize('teacher'), getMyPeriods);
router.get('/', authorize('admin', 'teacher'), getPeriods);
router.get('/:id', authorize('admin', 'teacher'), getPeriod);
router.post('/', authorize('admin'), createPeriod);
router.put('/:id', authorize('admin'), updatePeriod);
router.delete('/:id', authorize('admin'), deletePeriod);

module.exports = router;
