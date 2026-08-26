const express = require('express');
const {
  getUsers,
  createAdmin,
  createStudentAccount,
  createTeacherAccount,
  deleteUser,
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect, authorize('admin'));

router.get('/', getUsers);
router.post('/admin', createAdmin);
router.post('/student', createStudentAccount);
router.post('/teacher', createTeacherAccount);
router.delete('/:id', deleteUser);

module.exports = router;
