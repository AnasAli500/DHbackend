const FeeStructure = require('../models/FeeStructure');
const Payment = require('../models/Payment');
const StudentBalance = require('../models/StudentBalance');
const Expense = require('../models/Expense');
const Student = require('../models/Student');
const Class = require('../models/Class');
const { generateReceiptNo } = require('../utils/generateId');

// Helper to calculate discount amount
const calculateDiscount = (originalFee, discountType, discountValue) => {
  const val = Number(discountValue) || 0;
  if (discountType === 'Percentage') {
    return Math.min(originalFee, (originalFee * val) / 100);
  }
  return Math.min(originalFee, val);
};

// Helper to determine payment status
const calculateStatus = (amountRequired, totalPaid, dueDate, billingMonth, billingYear) => {
  const pending = Math.max(0, amountRequired - totalPaid);
  if (pending <= 0) return 'Paid';
  
  // Check overdue condition
  let isOverdue = false;
  const now = new Date();

  if (dueDate) {
    isOverdue = new Date(dueDate) < now;
  } else if (billingMonth && billingYear) {
    const monthNames = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'
    ];
    const mIdx = monthNames.indexOf(billingMonth.toLowerCase());
    if (mIdx !== -1) {
      // Last moment of the billing month
      const endOfBillingMonth = new Date(Number(billingYear), mIdx + 1, 0, 23, 59, 59);
      isOverdue = endOfBillingMonth < now;
    }
  }

  if (isOverdue && pending > 0) return 'Overdue';
  if (totalPaid > 0) return 'Partial';
  return 'Pending';
};

// ── Academic Years ──

exports.getAcademicYears = async (req, res) => {
  try {
    const years = await Class.distinct('academicYear');
    years.sort((a, b) => b.localeCompare(a));
    res.json({ years });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Summary (Live Computed) ──

exports.getSummary = async (req, res) => {
  try {
    const { academicYear, classId, feeId, billingYear, billingMonth, status } = req.query;

    let feeQuery = { status: 'Active' };
    if (academicYear) feeQuery.academicYear = academicYear;
    if (classId) feeQuery.classId = classId;
    if (feeId) feeQuery._id = feeId;

    let feeStructures = await FeeStructure.find(feeQuery);

    let studentQuery = { status: 'Active' };
    if (classId) {
      studentQuery.classId = classId;
    } else if (academicYear) {
      const classesForYear = await Class.find({ academicYear }).select('_id');
      studentQuery.classId = { $in: classesForYear.map((c) => c._id) };
    }

    const students = await Student.find(studentQuery);
    const studentIds = students.map((s) => s._id);

    let totalStudents = students.length;
    let totalOriginalFees = 0;
    let totalDiscounts = 0;
    let totalAmountRequired = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let overdueAmount = 0;

    // Process all active students in scope
    for (const student of students) {
      // Match relevant fee structures for student's class
      const matchingFees = feeStructures.filter(
        (f) => f.classId && student.classId && f.classId.toString() === student.classId.toString()
      );

      for (const fee of matchingFees) {
        const isMonthly = fee.frequency === 'Monthly';
        const bYear = isMonthly ? (Number(billingYear) || new Date().getFullYear()) : null;
        const bMonth = isMonthly ? (billingMonth || 'January') : null;

        // Fetch discount settings
        const discountRecord = await StudentBalance.findOne({
          studentId: student._id,
          feeStructureId: fee._id,
          ...(isMonthly ? { billingYear: bYear, billingMonth: bMonth } : {}),
        });

        const discType = discountRecord ? discountRecord.discountType : 'Fixed';
        const discValue = discountRecord ? discountRecord.discountValue : 0;
        const discAmount = calculateDiscount(fee.amount, discType, discValue);
        const required = Math.max(0, fee.amount - discAmount);

        // Fetch payments
        const pmtMatch = {
          studentId: student._id,
          feeId: fee._id,
          ...(isMonthly ? { billingYear: bYear, billingMonth: bMonth } : {}),
        };

        const payments = await Payment.find(pmtMatch);
        const paidForPeriod = payments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
        const pendingForPeriod = Math.max(0, required - paidForPeriod);
        const pmtStatus = calculateStatus(required, paidForPeriod, fee.dueDate, bMonth, bYear);

        if (!status || status === 'All' || pmtStatus === status) {
          totalOriginalFees += fee.amount;
          totalDiscounts += discAmount;
          totalAmountRequired += required;
          totalPaid += paidForPeriod;
          totalPending += pendingForPeriod;
          if (pmtStatus === 'Overdue') {
            overdueAmount += pendingForPeriod;
          }
        }
      }
    }

    // Expense summary
    const expenseResult = await Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
    const totalExpenses = expenseResult[0]?.total || 0;

    res.json({
      totalStudents,
      totalOriginalFees,
      totalDiscounts,
      totalAmountRequired,
      totalPaid, // Total Revenue
      totalPending,
      overdueAmount,
      totalExpenses,
      netBalance: totalPaid - totalExpenses,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Fee Structures (Full CRUD) ──

exports.getFees = async (req, res) => {
  try {
    const { academicYear, classId, status } = req.query;
    const query = {};
    if (academicYear) query.academicYear = academicYear;
    if (classId) query.classId = classId;
    if (status) query.status = status;

    const fees = await FeeStructure.find(query)
      .populate('classId', 'className gradeLevel academicYear')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .sort({ createdAt: -1 });

    res.json(fees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getFee = async (req, res) => {
  try {
    const fee = await FeeStructure.findById(req.params.id)
      .populate('classId', 'className gradeLevel academicYear')
      .populate('createdBy', 'name');
    if (!fee) return res.status(404).json({ message: 'Fee structure not found' });
    res.json(fee);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createFee = async (req, res) => {
  try {
    const fee = await FeeStructure.create({
      ...req.body,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    const populated = await FeeStructure.findById(fee._id)
      .populate('classId', 'className gradeLevel academicYear')
      .populate('createdBy', 'name');
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateFee = async (req, res) => {
  try {
    const fee = await FeeStructure.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: req.user._id },
      { new: true, runValidators: true }
    )
      .populate('classId', 'className gradeLevel academicYear')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name');

    if (!fee) return res.status(404).json({ message: 'Fee structure not found' });
    res.json(fee);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteFee = async (req, res) => {
  try {
    const feeId = req.params.id;
    const fee = await FeeStructure.findById(feeId);
    if (!fee) return res.status(404).json({ message: 'Fee structure not found' });

    // Safeguard check §2: Check if payments or discounts reference this fee
    const [paymentCount, discountCount] = await Promise.all([
      Payment.countDocuments({ feeId }),
      StudentBalance.countDocuments({ feeStructureId: feeId }),
    ]);

    if (paymentCount > 0 || discountCount > 0) {
      return res.status(409).json({
        message: 'Cannot delete fee structure because payments or discounts reference it. Please deactivate it instead.',
        canDeactivate: true,
      });
    }

    await fee.deleteOne();
    res.json({ message: 'Fee structure deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Student Balances & Payment Management Engine ──

exports.getStudentBalances = async (req, res) => {
  try {
    const { academicYear, classId, feeId, billingYear, billingMonth, status, search } = req.query;

    if (!classId || !feeId) {
      return res.json({ students: [], feeStructure: null, summary: {} });
    }

    const feeStructure = await FeeStructure.findById(feeId).populate('classId', 'className academicYear');
    if (!feeStructure) {
      return res.status(404).json({ message: 'Fee structure not found' });
    }

    const isMonthly = feeStructure.frequency === 'Monthly';
    const bYear = isMonthly ? (Number(billingYear) || new Date().getFullYear()) : null;
    const bMonth = isMonthly ? (billingMonth || 'January') : null;

    // Find active students in class
    let studentQuery = { classId, status: 'Active' };
    if (search) {
      studentQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { studentId: { $regex: search, $options: 'i' } },
      ];
    }

    const students = await Student.find(studentQuery).sort({ name: 1 });

    const results = [];
    let sumOriginal = 0;
    let sumDiscounts = 0;
    let sumRequired = 0;
    let sumPaid = 0;
    let sumPending = 0;
    let sumOverdue = 0;

    for (const student of students) {
      // Find saved discount
      const discountRecord = await StudentBalance.findOne({
        studentId: student._id,
        feeStructureId: feeStructure._id,
        ...(isMonthly ? { billingYear: bYear, billingMonth: bMonth } : {}),
      });

      const discountType = discountRecord ? discountRecord.discountType : 'Fixed';
      const discountValue = discountRecord ? discountRecord.discountValue : 0;
      const discountAmount = calculateDiscount(feeStructure.amount, discountType, discountValue);
      const amountRequired = Math.max(0, feeStructure.amount - discountAmount);

      // Find payments
      const pmtMatch = {
        studentId: student._id,
        feeId: feeStructure._id,
        ...(isMonthly ? { billingYear: bYear, billingMonth: bMonth } : {}),
      };

      const payments = await Payment.find(pmtMatch).sort({ paymentDate: -1 });
      const paid = payments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
      const pending = Math.max(0, amountRequired - paid);
      const pmtStatus = calculateStatus(amountRequired, paid, feeStructure.dueDate, bMonth, bYear);

      if (!status || status === 'All' || pmtStatus === status) {
        sumOriginal += feeStructure.amount;
        sumDiscounts += discountAmount;
        sumRequired += amountRequired;
        sumPaid += paid;
        sumPending += pending;
        if (pmtStatus === 'Overdue') sumOverdue += pending;

        results.push({
          _id: student._id,
          studentId: student.studentId,
          name: student.name,
          academicYear: student.academicYear || feeStructure.academicYear,
          classId: student.classId,
          originalFee: feeStructure.amount,
          discountType,
          discountValue,
          discountAmount,
          amountRequired,
          paid,
          pending,
          status: pmtStatus,
          payments,
        });
      }
    }

    res.json({
      students: results,
      feeStructure,
      summary: {
        totalStudents: results.length,
        totalOriginalFees: sumOriginal,
        totalDiscounts: sumDiscounts,
        totalAmountRequired: sumRequired,
        totalPaid: sumPaid,
        totalPending: sumPending,
        overdueAmount: sumOverdue,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Save / Upsert Discount for a Student
exports.saveDiscount = async (req, res) => {
  try {
    const { studentId, feeStructureId, billingYear, billingMonth, discountType, discountValue } = req.body;

    const fee = await FeeStructure.findById(feeStructureId);
    if (!fee) return res.status(404).json({ message: 'Fee structure not found' });

    const isMonthly = fee.frequency === 'Monthly';
    const bYear = isMonthly ? (Number(billingYear) || new Date().getFullYear()) : null;
    const bMonth = isMonthly ? (billingMonth || 'January') : null;

    const discountAmount = calculateDiscount(fee.amount, discountType, discountValue);
    const amountRequired = Math.max(0, fee.amount - discountAmount);

    const record = await StudentBalance.findOneAndUpdate(
      {
        studentId,
        feeStructureId,
        billingYear: bYear,
        billingMonth: bMonth,
      },
      {
        discountType: discountType || 'Fixed',
        discountValue: Number(discountValue) || 0,
        discountAmount,
        amountRequired,
        createdBy: req.user._id,
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json(record);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// ── Payments Management ──

exports.getPayments = async (req, res) => {
  try {
    const { status, classId, studentId, feeId, academicYear, search, startDate, endDate, page = 1, limit = 20 } = req.query;
    const query = {};

    if (status && status !== 'All') query.status = status;
    if (classId) query.classId = classId;
    if (studentId) query.studentId = studentId;
    if (feeId) query.feeId = feeId;
    if (academicYear) query.academicYear = academicYear;

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate);
      if (endDate) query.paymentDate.$lte = new Date(endDate);
    }

    if (search) {
      const matchingStudents = await Student.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { studentId: { $regex: search, $options: 'i' } },
        ],
      }).select('_id');

      query.$or = [
        { receiptNo: { $regex: search, $options: 'i' } },
        { referenceNumber: { $regex: search, $options: 'i' } },
        { studentId: { $in: matchingStudents.map((s) => s._id) } },
      ];
    }

    const total = await Payment.countDocuments(query);
    const payments = await Payment.find(query)
      .populate('studentId', 'name studentId phone')
      .populate('classId', 'className gradeLevel academicYear')
      .populate('feeId', 'name amount frequency')
      .populate('recordedBy', 'name')
      .sort({ createdAt: -1, paymentDate: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({ payments, total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('studentId', 'name studentId phone guardianName parentPhone')
      .populate('classId', 'className gradeLevel academicYear')
      .populate('feeId', 'name amount frequency dueDate')
      .populate('recordedBy', 'name');
    if (!payment) return res.status(404).json({ message: 'Payment not found' });
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getStudentPaymentHistory = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { feeId } = req.query;

    const student = await Student.findById(studentId).populate('classId', 'className gradeLevel');
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const query = { studentId };
    if (feeId) query.feeId = feeId;

    const payments = await Payment.find(query)
      .populate('feeId', 'name amount frequency')
      .populate('classId', 'className')
      .populate('recordedBy', 'name')
      .sort({ paymentDate: -1, createdAt: -1 });

    res.json({ student, payments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createPayment = async (req, res) => {
  try {
    const {
      studentId,
      classId,
      feeId,
      academicYear,
      billingYear,
      billingMonth,
      discountType = 'Fixed',
      discountValue = 0,
      paidAmount,
      paymentMethod = 'Cash',
      referenceNumber = '',
      paymentDate = new Date(),
      note = '',
    } = req.body;

    const student = await Student.findById(studentId);
    if (!student || student.status === 'Inactive') {
      return res.status(400).json({ message: 'Cannot record payment for an inactive or non-existent student' });
    }

    const fee = await FeeStructure.findById(feeId);
    if (!fee) return res.status(400).json({ message: 'Invalid Fee Structure selected' });

    const isMonthly = fee.frequency === 'Monthly';
    const bYear = isMonthly ? (Number(billingYear) || new Date().getFullYear()) : null;
    const bMonth = isMonthly ? (billingMonth || 'January') : null;

    // Save discount setting
    await StudentBalance.findOneAndUpdate(
      { studentId, feeStructureId: feeId, billingYear: bYear, billingMonth: bMonth },
      {
        discountType,
        discountValue: Number(discountValue) || 0,
        discountAmount: calculateDiscount(fee.amount, discountType, discountValue),
        amountRequired: Math.max(0, fee.amount - calculateDiscount(fee.amount, discountType, discountValue)),
        createdBy: req.user._id,
      },
      { upsert: true, new: true }
    );

    const discountAmount = calculateDiscount(fee.amount, discountType, discountValue);
    const amountRequired = Math.max(0, fee.amount - discountAmount);

    // Calculate previously paid
    const pmtMatch = {
      studentId,
      feeId,
      ...(isMonthly ? { billingYear: bYear, billingMonth: bMonth } : {}),
    };

    const previousPayments = await Payment.find(pmtMatch);
    const previouslyPaid = previousPayments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
    const pendingBeforePayment = Math.max(0, amountRequired - previouslyPaid);

    const pmtNow = Number(paidAmount);
    if (isNaN(pmtNow) || pmtNow <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than 0' });
    }

    if (pmtNow > pendingBeforePayment + 0.01) {
      return res.status(400).json({
        message: `Payment ($${pmtNow}) cannot exceed pending balance ($${pendingBeforePayment.toFixed(2)})`,
      });
    }

    const totalPaidAfter = previouslyPaid + pmtNow;
    const remainingBalance = Math.max(0, amountRequired - totalPaidAfter);
    const newStatus = calculateStatus(amountRequired, totalPaidAfter, fee.dueDate, bMonth, bYear);

    const receiptNo = await generateReceiptNo(Payment);

    const payment = await Payment.create({
      receiptNo,
      studentId,
      classId: classId || student.classId,
      feeId,
      feeName: fee.name,
      academicYear: academicYear || fee.academicYear,
      billingYear: bYear,
      billingMonth: bMonth,
      originalAmount: fee.amount,
      discountType,
      discountValue: Number(discountValue) || 0,
      discountAmount,
      amountRequired,
      previouslyPaid,
      paidAmount: pmtNow,
      balance: remainingBalance,
      paymentMethod,
      referenceNumber,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      status: newStatus,
      note,
      recordedBy: req.user._id,
    });

    const populated = await Payment.findById(payment._id)
      .populate('studentId', 'name studentId phone')
      .populate('classId', 'className gradeLevel academicYear')
      .populate('feeId', 'name amount frequency')
      .populate('recordedBy', 'name');

    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// ── Bulk Payment ──

exports.createBulkPayment = async (req, res) => {
  try {
    const { payments: items, academicYear, classId, feeId, billingYear, billingMonth, paymentMethod, referenceNumber, paymentDate, note } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'No student payment items provided' });
    }

    const fee = await FeeStructure.findById(feeId);
    if (!fee) return res.status(400).json({ message: 'Fee Structure not found' });

    const isMonthly = fee.frequency === 'Monthly';
    const bYear = isMonthly ? (Number(billingYear) || new Date().getFullYear()) : null;
    const bMonth = isMonthly ? (billingMonth || 'January') : null;

    const createdPayments = [];

    for (const item of items) {
      const pmtNow = Number(item.paymentNow) || 0;
      const studentId = item.studentId;

      // Upsert discount setting for this student
      const discType = item.discountType || 'Fixed';
      const discVal = Number(item.discountValue) || 0;
      const discAmount = calculateDiscount(fee.amount, discType, discVal);
      const amountReq = Math.max(0, fee.amount - discAmount);

      await StudentBalance.findOneAndUpdate(
        { studentId, feeStructureId: feeId, billingYear: bYear, billingMonth: bMonth },
        {
          discountType: discType,
          discountValue: discVal,
          discountAmount: discAmount,
          amountRequired: amountReq,
          createdBy: req.user._id,
        },
        { upsert: true }
      );

      if (pmtNow > 0) {
        // Calculate previously paid
        const pmtMatch = {
          studentId,
          feeId,
          ...(isMonthly ? { billingYear: bYear, billingMonth: bMonth } : {}),
        };
        const prevPayments = await Payment.find(pmtMatch);
        const previouslyPaid = prevPayments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
        const totalPaidAfter = previouslyPaid + pmtNow;
        const remainingBalance = Math.max(0, amountReq - totalPaidAfter);
        const newStatus = calculateStatus(amountReq, totalPaidAfter, fee.dueDate, bMonth, bYear);

        const receiptNo = await generateReceiptNo(Payment);

        const newPmt = await Payment.create({
          receiptNo,
          studentId,
          classId: classId || item.classId,
          feeId,
          feeName: fee.name,
          academicYear: academicYear || fee.academicYear,
          billingYear: bYear,
          billingMonth: bMonth,
          originalAmount: fee.amount,
          discountType: discType,
          discountValue: discVal,
          discountAmount: discAmount,
          amountRequired: amountReq,
          previouslyPaid,
          paidAmount: pmtNow,
          balance: remainingBalance,
          paymentMethod: paymentMethod || 'Cash',
          referenceNumber: referenceNumber || '',
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          status: newStatus,
          note: note || '',
          recordedBy: req.user._id,
        });

        createdPayments.push(newPmt);
      }
    }

    res.status(201).json({
      message: `Bulk payment recorded successfully for ${createdPayments.length} student(s)`,
      count: createdPayments.length,
      payments: createdPayments,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Delete Payment Transaction (Triggers Live Recalculation)
exports.deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ message: 'Payment transaction not found' });

    const { studentId, feeId, billingYear, billingMonth } = payment;

    await payment.deleteOne();

    // Recompute student's updated balance & totals
    const isMonthly = Boolean(billingYear && billingMonth);
    const pmtMatch = {
      studentId,
      feeId,
      ...(isMonthly ? { billingYear, billingMonth } : {}),
    };

    const remainingPayments = await Payment.find(pmtMatch);
    const updatedTotalPaid = remainingPayments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);

    const discountRecord = await StudentBalance.findOne({
      studentId,
      feeStructureId: feeId,
      ...(isMonthly ? { billingYear, billingMonth } : {}),
    });

    const fee = await FeeStructure.findById(feeId);
    let amountRequired = fee ? fee.amount : payment.amountRequired;
    if (discountRecord && fee) {
      const discAmt = calculateDiscount(fee.amount, discountRecord.discountType, discountRecord.discountValue);
      amountRequired = Math.max(0, fee.amount - discAmt);
    }

    const updatedPending = Math.max(0, amountRequired - updatedTotalPaid);
    const updatedStatus = calculateStatus(amountRequired, updatedTotalPaid, fee?.dueDate, billingMonth, billingYear);

    res.json({
      message: 'Payment transaction deleted and student totals recalculated live',
      studentId,
      updatedTotalPaid,
      updatedPending,
      updatedStatus,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Expenses (Existing preserved) ──

exports.getExpenses = async (req, res) => {
  try {
    const { category, page = 1, limit = 10 } = req.query;
    const query = {};
    if (category) query.category = category;

    const total = await Expense.countDocuments(query);
    const expenses = await Expense.find(query)
      .populate('recordedBy', 'name')
      .sort({ date: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({ expenses, total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createExpense = async (req, res) => {
  try {
    const expense = await Expense.create({ ...req.body, recordedBy: req.user._id });
    const populated = await Expense.findById(expense._id).populate('recordedBy', 'name');
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('recordedBy', 'name');
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json(expense);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
