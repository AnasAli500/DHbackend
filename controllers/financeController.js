const FeeStructure = require('../models/FeeStructure');
const Payment = require('../models/Payment');
const Expense = require('../models/Expense');
const { generateReceiptNo } = require('../utils/generateId');

const calcPaymentFields = (amount, paidAmount) => {
  const balance = Math.max(0, amount - paidAmount);
  let status = 'Pending';
  if (balance === 0) status = 'Paid';
  else if (paidAmount > 0) status = 'Partial';
  return { balance, status };
};

// ── Summary ──

exports.getSummary = async (req, res) => {
  const [collectedResult, expenseResult, pendingCount, recentPayments, expenseBreakdown] = await Promise.all([
    Payment.aggregate([{ $group: { _id: null, total: { $sum: '$paidAmount' } } }]),
    Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
    Payment.countDocuments({ status: { $in: ['Pending', 'Partial'] } }),
    Payment.find()
      .populate('studentId', 'name studentId')
      .populate('classId', 'className')
      .sort({ createdAt: -1 })
      .limit(5),
    Expense.aggregate([
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  const totalCollected = collectedResult[0]?.total || 0;
  const totalExpenses = expenseResult[0]?.total || 0;

  res.json({
    totalCollected,
    totalExpenses,
    netBalance: totalCollected - totalExpenses,
    pendingFees: pendingCount,
    recentPayments,
    expenseBreakdown: expenseBreakdown.map((e) => ({ category: e._id, amount: e.total })),
  });
};

// ── Fee Structures ──

exports.getFees = async (req, res) => {
  const fees = await FeeStructure.find()
    .populate('classId', 'className gradeLevel')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 });
  res.json(fees);
};

exports.createFee = async (req, res) => {
  const fee = await FeeStructure.create({ ...req.body, createdBy: req.user._id });
  const populated = await FeeStructure.findById(fee._id)
    .populate('classId', 'className gradeLevel')
    .populate('createdBy', 'name');
  res.status(201).json(populated);
};

exports.updateFee = async (req, res) => {
  const fee = await FeeStructure.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    .populate('classId', 'className gradeLevel')
    .populate('createdBy', 'name');
  if (!fee) return res.status(404).json({ message: 'Fee structure not found' });
  res.json(fee);
};

exports.deleteFee = async (req, res) => {
  const fee = await FeeStructure.findByIdAndDelete(req.params.id);
  if (!fee) return res.status(404).json({ message: 'Fee structure not found' });
  res.json({ message: 'Fee structure deleted' });
};

// ── Payments ──

exports.getPayments = async (req, res) => {
  const { status, classId, studentId, page = 1, limit = 10 } = req.query;
  const query = {};
  if (status) query.status = status;
  if (classId) query.classId = classId;
  if (studentId) query.studentId = studentId;

  const total = await Payment.countDocuments(query);
  const payments = await Payment.find(query)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className')
    .populate('feeId', 'name amount')
    .populate('recordedBy', 'name')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.json({ payments, total, page: Number(page), pages: Math.ceil(total / limit) });
};

exports.getPayment = async (req, res) => {
  const payment = await Payment.findById(req.params.id)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className gradeLevel')
    .populate('feeId', 'name amount')
    .populate('recordedBy', 'name');
  if (!payment) return res.status(404).json({ message: 'Payment not found' });
  res.json(payment);
};

exports.createPayment = async (req, res) => {
  const receiptNo = await generateReceiptNo(Payment);
  const { amount, paidAmount } = req.body;
  const { balance, status } = calcPaymentFields(Number(amount), Number(paidAmount));

  const payment = await Payment.create({
    ...req.body,
    receiptNo,
    balance,
    status,
    recordedBy: req.user._id,
  });

  const populated = await Payment.findById(payment._id)
    .populate('studentId', 'name studentId')
    .populate('classId', 'className')
    .populate('feeId', 'name amount')
    .populate('recordedBy', 'name');
  res.status(201).json(populated);
};

exports.updatePayment = async (req, res) => {
  const existing = await Payment.findById(req.params.id);
  if (!existing) return res.status(404).json({ message: 'Payment not found' });

  const amount = req.body.amount !== undefined ? Number(req.body.amount) : existing.amount;
  const paidAmount = req.body.paidAmount !== undefined ? Number(req.body.paidAmount) : existing.paidAmount;
  const { balance, status } = calcPaymentFields(amount, paidAmount);

  const payment = await Payment.findByIdAndUpdate(
    req.params.id,
    { ...req.body, balance, status },
    { new: true, runValidators: true }
  )
    .populate('studentId', 'name studentId')
    .populate('classId', 'className')
    .populate('feeId', 'name amount')
    .populate('recordedBy', 'name');
  res.json(payment);
};

exports.deletePayment = async (req, res) => {
  const payment = await Payment.findByIdAndDelete(req.params.id);
  if (!payment) return res.status(404).json({ message: 'Payment not found' });
  res.json({ message: 'Payment deleted' });
};

// ── Expenses ──

exports.getExpenses = async (req, res) => {
  const { category, page = 1, limit = 10 } = req.query;
  const query = {};
  if (category) query.category = category;

  const total = await Expense.countDocuments(query);
  const expenses = await Expense.find(query)
    .populate('recordedBy', 'name')
    .sort({ date: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.json({ expenses, total, page: Number(page), pages: Math.ceil(total / limit) });
};

exports.createExpense = async (req, res) => {
  const expense = await Expense.create({ ...req.body, recordedBy: req.user._id });
  const populated = await Expense.findById(expense._id).populate('recordedBy', 'name');
  res.status(201).json(populated);
};

exports.updateExpense = async (req, res) => {
  const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    .populate('recordedBy', 'name');
  if (!expense) return res.status(404).json({ message: 'Expense not found' });
  res.json(expense);
};

exports.deleteExpense = async (req, res) => {
  const expense = await Expense.findByIdAndDelete(req.params.id);
  if (!expense) return res.status(404).json({ message: 'Expense not found' });
  res.json({ message: 'Expense deleted' });
};
