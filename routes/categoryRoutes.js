const express = require('express');
const { getCategories } = require('../controllers/categoryController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(protect);
router.get('/', authorize('admin', 'teacher'), getCategories);

module.exports = router;
