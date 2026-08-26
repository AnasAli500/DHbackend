const express = require('express');
const {
  getSummary,
  getFees, createFee, updateFee, deleteFee,
  getPayments, getPayment, createPayment, updatePayment, deletePayment,
  getExpenses, createExpense, updateExpense, deleteExpense,
} = require('../controllers/financeController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect, authorize('admin'));

router.get('/summary', getSummary);

router.get('/fees', getFees);
router.post('/fees', createFee);
router.put('/fees/:id', updateFee);
router.delete('/fees/:id', deleteFee);

router.get('/payments', getPayments);
router.get('/payments/:id', getPayment);
router.post('/payments', createPayment);
router.put('/payments/:id', updatePayment);
router.delete('/payments/:id', deletePayment);

router.get('/expenses', getExpenses);
router.post('/expenses', createExpense);
router.put('/expenses/:id', updateExpense);
router.delete('/expenses/:id', deleteExpense);

module.exports = router;
