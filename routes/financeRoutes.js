const express = require('express');
const {
  getAcademicYears,
  getSummary,
  getFees, getFee, createFee, updateFee, deleteFee,
  getStudentBalances, saveDiscount,
  getPayments, getPayment, getStudentPaymentHistory, createPayment, createBulkPayment, deletePayment,
  getExpenses, createExpense, updateExpense, deleteExpense,
} = require('../controllers/financeController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect, authorize('admin'));

// Academic Years
router.get('/academic-years', getAcademicYears);

// Summary
router.get('/summary', getSummary);

// Fee Structure
router.get('/fee-structures', getFees);
router.get('/fee-structures/:id', getFee);
router.post('/fee-structures', createFee);
router.put('/fee-structures/:id', updateFee);
router.delete('/fee-structures/:id', deleteFee);
// Legacy compatibility endpoint aliases
router.get('/fees', getFees);
router.post('/fees', createFee);
router.put('/fees/:id', updateFee);
router.delete('/fees/:id', deleteFee);

// Student Balances & Discounts
router.get('/student-balances', getStudentBalances);
router.post('/discounts', saveDiscount);

// Payments
router.get('/payments', getPayments);
router.get('/payments/student/:studentId', getStudentPaymentHistory);
router.get('/payments/:id', getPayment);
router.post('/payments', createPayment);
router.post('/payments/bulk', createBulkPayment);
router.delete('/payments/:id', deletePayment);

// Expenses
router.get('/expenses', getExpenses);
router.post('/expenses', createExpense);
router.put('/expenses/:id', updateExpense);
router.delete('/expenses/:id', deleteExpense);

module.exports = router;
