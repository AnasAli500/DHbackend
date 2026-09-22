const express = require('express');
const {
  getAcademicYears,
  getSummary,
  getFees, getFee, createFee, updateFee, deleteFee,
  getStudentBalances, saveDiscount,
  getPayments, getPayment, getStudentPaymentHistory, createPayment, createBulkPayment, deletePayment,
  getExpenses, createExpense, updateExpense, deleteExpense,
  // Student Finance Profile (Persistent Discount / Free Status)
  getStudentFinanceProfile, upsertStudentFinanceProfile, removeStudentDiscount,
  // Family Groups
  getFamilyGroups, getFamilyGroup, createFamilyGroup, updateFamilyGroup, deleteFamilyGroup,
  linkStudentsAsFamily, unlinkStudentFromFamily, getStudentFamily, searchStudentsForFamily,
  // Family Payments
  createFamilyPayment, getFamilyPayment,
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

// Student Balances & Discounts (legacy)
router.get('/student-balances', getStudentBalances);
router.post('/discounts', saveDiscount);

// ── Student Finance Profile (Persistent Discount / Free Status) ──
router.get('/student-profile/:studentId', getStudentFinanceProfile);
router.put('/student-profile/:studentId', upsertStudentFinanceProfile);
router.delete('/student-profile/:studentId/discount', removeStudentDiscount);

// ── Family Groups ──
router.get('/family-groups', getFamilyGroups);
router.post('/family-groups', createFamilyGroup);
router.get('/family-groups/:id', getFamilyGroup);
router.put('/family-groups/:id', updateFamilyGroup);
router.delete('/family-groups/:id', deleteFamilyGroup);
router.post('/family-groups/link', linkStudentsAsFamily);
router.post('/family-groups/unlink', unlinkStudentFromFamily);
router.delete('/students/:studentId/unlink-family', unlinkStudentFromFamily);
router.get('/students/:studentId/family', getStudentFamily);
router.get('/students/search-for-family', searchStudentsForFamily);

// Payments
router.get('/payments', getPayments);
router.get('/payments/student/:studentId', getStudentPaymentHistory);
router.get('/payments/:id', getPayment);
router.post('/payments', createPayment);
router.post('/payments/bulk', createBulkPayment);
router.delete('/payments/:id', deletePayment);

// ── Family / Multi-student Payments ──
router.post('/payments/family', createFamilyPayment);
router.get('/family-payments/:id', getFamilyPayment);

// Expenses
router.get('/expenses', getExpenses);
router.post('/expenses', createExpense);
router.put('/expenses/:id', updateExpense);
router.delete('/expenses/:id', deleteExpense);

module.exports = router;
