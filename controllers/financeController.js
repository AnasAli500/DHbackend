const FeeStructure = require('../models/FeeStructure');
const Payment = require('../models/Payment');
const StudentBalance = require('../models/StudentBalance');
const Expense = require('../models/Expense');
const Student = require('../models/Student');
const Class = require('../models/Class');
const Enrollment = require('../models/Enrollment');
const StudentFinanceProfile = require('../models/StudentFinanceProfile');
const FamilyGroup = require('../models/FamilyGroup');
const FamilyPayment = require('../models/FamilyPayment');
const { generateReceiptNo, generateFamilyReceiptNo } = require('../utils/generateId');


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

// Helper: get effective discount for a student, checking StudentFinanceProfile first
// Returns { financeStatus, discountType, discountValue, discountAmount, isFree }
const getEffectiveDiscount = async (studentId, feeAmount, feeStructureId, bYear, bMonth) => {
  // 1. Check persistent StudentFinanceProfile first as source of truth
  const profile = await StudentFinanceProfile.findOne({ studentId });

  if (profile) {
    if (profile.financeStatus === 'free') {
      return {
        financeStatus: 'free',
        discountType: 'Percentage',
        discountValue: 100,
        discountAmount: feeAmount,
        isFree: true,
        profileExists: true,
      };
    }

    if (profile.financeStatus === 'normal' || Number(profile.discountValue) === 0) {
      return {
        financeStatus: 'normal',
        discountType: 'Fixed',
        discountValue: 0,
        discountAmount: 0,
        isFree: false,
        profileExists: true,
      };
    }

    if (profile.financeStatus === 'discounted' && profile.discountValue > 0) {
      const discountAmount = calculateDiscount(feeAmount, profile.discountType, profile.discountValue);
      return {
        financeStatus: 'discounted',
        discountType: profile.discountType,
        discountValue: profile.discountValue,
        discountAmount,
        isFree: false,
        profileExists: true,
      };
    }
  }

  // 2. Fall back to per-period StudentBalance override if no profile exists
  const balanceRecord = await StudentBalance.findOne({
    studentId,
    feeStructureId,
    ...(bYear != null ? { billingYear: bYear } : {}),
    ...(bMonth != null ? { billingMonth: bMonth } : {}),
  });

  if (balanceRecord && balanceRecord.discountValue > 0) {
    const discountAmount = calculateDiscount(feeAmount, balanceRecord.discountType, balanceRecord.discountValue);
    return {
      financeStatus: 'discounted',
      discountType: balanceRecord.discountType,
      discountValue: balanceRecord.discountValue,
      discountAmount,
      isFree: false,
      profileExists: false,
    };
  }

  // 3. Default: No discount
  return {
    financeStatus: 'normal',
    discountType: 'Fixed',
    discountValue: 0,
    discountAmount: 0,
    isFree: false,
    profileExists: false,
  };
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
    if (classId && classId !== 'All') feeQuery.classId = classId;
    if (feeId) feeQuery._id = feeId;

    let feeStructures = await FeeStructure.find(feeQuery);

    let studentQuery = { status: { $ne: 'Inactive' } };
    if (classId && classId !== 'All') {
      const enrolledStudentIds = await Enrollment.distinct('studentId', { classId, status: { $ne: 'Inactive' } });
      studentQuery.$or = [
        { classId },
        { _id: { $in: enrolledStudentIds } },
      ];
    } else if (academicYear) {
      const classesForYear = await Class.find({ academicYear }).select('_id');
      const classIds = classesForYear.map((c) => c._id);
      const enrolledStudentIds = await Enrollment.distinct('studentId', { classId: { $in: classIds }, status: { $ne: 'Inactive' } });
      studentQuery.$or = [
        { classId: { $in: classIds } },
        { _id: { $in: enrolledStudentIds } },
      ];
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
      let sClassId = student.classId ? student.classId.toString() : null;
      if (!sClassId) {
        const activeEnc = await Enrollment.findOne({ studentId: student._id, status: { $ne: 'Inactive' } });
        if (activeEnc) sClassId = activeEnc.classId.toString();
      }

      // Match relevant fee structures for student's class
      const matchingFees = feeStructures.filter(
        (f) => f.classId && sClassId && f.classId.toString() === sClassId
      );

      for (const fee of matchingFees) {
        const isMonthly = fee.frequency === 'Monthly';
        const bYear = isMonthly ? (Number(billingYear) || new Date().getFullYear()) : null;
        const bMonth = isMonthly ? (billingMonth || 'January') : null;

        // Fetch effective discount using unified helper
        const effectiveDiscount = await getEffectiveDiscount(
          student._id,
          fee.amount,
          fee._id,
          isMonthly ? bYear : null,
          isMonthly ? bMonth : null
        );

        const discAmount = effectiveDiscount.discountAmount;
        const required = effectiveDiscount.isFree ? 0 : Math.max(0, fee.amount - discAmount);

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
    if (classId && classId !== 'All') query.classId = classId;
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

    // Find active student IDs from both direct Student.classId and active Enrollments
    let studentQuery = { status: { $ne: 'Inactive' } };

    if (classId && classId !== 'All') {
      const enrolledStudentIds = await Enrollment.distinct('studentId', { classId, status: { $ne: 'Inactive' } });
      studentQuery.$or = [
        { classId },
        { _id: { $in: enrolledStudentIds } },
      ];
    } else {
      const targetYear = academicYear || feeStructure.academicYear;
      if (targetYear) {
        const classesForYear = await Class.find({ academicYear: targetYear }).select('_id');
        const classIds = classesForYear.map((c) => c._id);
        const enrolledStudentIds = await Enrollment.distinct('studentId', { classId: { $in: classIds }, status: { $ne: 'Inactive' } });
        studentQuery.$or = [
          { classId: { $in: classIds } },
          { _id: { $in: enrolledStudentIds } },
        ];
      }
    }

    if (search) {
      studentQuery.$and = [
        {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { studentId: { $regex: search, $options: 'i' } },
          ],
        },
      ];
    }

    const students = await Student.find(studentQuery).populate('classId', 'className gradeLevel').sort({ name: 1 });

    const results = [];
    let sumOriginal = 0;
    let sumDiscounts = 0;
    let sumRequired = 0;
    let sumPaid = 0;
    let sumPending = 0;
    let sumOverdue = 0;

    for (const student of students) {
      // Use unified discount resolution (StudentFinanceProfile > StudentBalance)
      const effectiveDiscount = await getEffectiveDiscount(
        student._id,
        feeStructure.amount,
        feeStructure._id,
        isMonthly ? bYear : null,
        isMonthly ? bMonth : null
      );

      const { financeStatus, discountType, discountValue, discountAmount, isFree } = effectiveDiscount;
      const amountRequired = isFree ? 0 : Math.max(0, feeStructure.amount - discountAmount);

      // Find payments
      const pmtMatch = {
        studentId: student._id,
        feeId: feeStructure._id,
        ...(isMonthly ? { billingYear: bYear, billingMonth: bMonth } : {}),
      };

      const payments = await Payment.find(pmtMatch).sort({ paymentDate: -1 });
      const paid = payments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
      const pending = Math.max(0, amountRequired - paid);
      const pmtStatus = isFree ? 'Paid' : calculateStatus(amountRequired, paid, feeStructure.dueDate, bMonth, bYear);

      if (!status || status === 'All' || pmtStatus === status) {
        sumOriginal += isFree ? 0 : feeStructure.amount;
        sumDiscounts += discountAmount;
        sumRequired += amountRequired;
        sumPaid += paid;
        sumPending += pending;
        if (pmtStatus === 'Overdue') sumOverdue += pending;

        results.push({
          _id: student._id,
          studentId: student.studentId,
          name: student.name,
          parentPhone: student.parentPhone || student.guardianPhone || '',
          academicYear: student.academicYear || feeStructure.academicYear,
          classId: student.classId,
          familyGroupId: student.familyGroupId || null,
          financeStatus,
          isFree,
          originalFee: isFree ? 0 : feeStructure.amount,
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
    if (classId && classId !== 'All') query.classId = classId;
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
      .populate('studentId', 'name studentId phone parentPhone guardianPhone')
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
      discountType: reqDiscountType,
      discountValue: reqDiscountValue,
      paidAmount,
      paymentMethod = 'Cash',
      referenceNumber = '',
      paymentDate = new Date(),
      note = '',
      allowFreeOverride = false, // admin must explicitly set this to pay a FREE student
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

    // Check FREE status
    const profile = await StudentFinanceProfile.findOne({ studentId });
    if (profile && profile.financeStatus === 'free' && !allowFreeOverride) {
      return res.status(400).json({
        message: 'This student is marked as FREE. No payment is required. Use allowFreeOverride to record an exceptional payment.',
        isFreeStudent: true,
      });
    }

    // Resolve discount: use request values if provided, else use profile/balance
    let discountType = 'Fixed';
    let discountValue = 0;

    if (reqDiscountType !== undefined && reqDiscountValue !== undefined) {
      // Explicit override from request (e.g. admin changed discount in modal)
      discountType = reqDiscountType || 'Fixed';
      discountValue = Number(reqDiscountValue) || 0;
    } else {
      // Auto-load from profile (if not free)
      if (profile && profile.financeStatus === 'discounted' && profile.discountValue > 0) {
        discountType = profile.discountType;
        discountValue = profile.discountValue;
      }
    }

    // Save/update the per-period StudentBalance record for this fee period
    const discountAmount = calculateDiscount(fee.amount, discountType, discountValue);
    const amountRequired = Math.max(0, fee.amount - discountAmount);

    await StudentBalance.findOneAndUpdate(
      { studentId, feeStructureId: feeId, billingYear: bYear, billingMonth: bMonth },
      {
        discountType,
        discountValue,
        discountAmount,
        amountRequired,
        createdBy: req.user._id,
      },
      { upsert: true, new: true }
    );

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
      discountValue,
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

// ══════════════════════════════════════════════════════
// ── Student Finance Profile (Persistent Discount / Free Status) ──
// ══════════════════════════════════════════════════════

exports.getStudentFinanceProfile = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await Student.findById(studentId).select('name studentId familyGroupId');
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const profile = await StudentFinanceProfile.findOne({ studentId })
      .populate('updatedBy', 'name')
      .populate('discountHistory.changedBy', 'name');

    res.json({
      student,
      profile: profile || {
        financeStatus: 'normal',
        discountType: 'Fixed',
        discountValue: 0,
        discountHistory: [],
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Helper: Sync all StudentBalance records for a student when their profile changes
const syncStudentBalancesWithProfile = async (studentId, profile) => {
  const isNormal = !profile || profile.financeStatus === 'normal' || Number(profile.discountValue) === 0;
  const isFree = profile && profile.financeStatus === 'free';
  const discType = profile?.discountType || 'Fixed';
  const discVal = Number(profile?.discountValue) || 0;

  const balances = await StudentBalance.find({ studentId });
  for (const bal of balances) {
    const fee = await FeeStructure.findById(bal.feeStructureId);
    if (!fee) continue;

    let discAmt = 0;
    if (isFree) {
      discAmt = fee.amount;
    } else if (isNormal) {
      discAmt = 0;
    } else {
      discAmt = calculateDiscount(fee.amount, discType, discVal);
    }

    const req = isFree ? 0 : Math.max(0, fee.amount - discAmt);
    bal.discountType = isNormal ? 'Fixed' : discType;
    bal.discountValue = isNormal ? 0 : discVal;
    bal.discountAmount = discAmt;
    bal.amountRequired = req;
    await bal.save();
  }
};

exports.upsertStudentFinanceProfile = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { financeStatus, discountType, discountValue, note } = req.body;

    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const finalStatus = (financeStatus === 'normal' || Number(discountValue) === 0) ? 'normal' : (financeStatus || 'normal');
    const finalVal = finalStatus === 'normal' ? 0 : (Number(discountValue) || 0);

    // Build the history entry
    const historyEntry = {
      financeStatus: finalStatus,
      discountType: discountType || 'Fixed',
      discountValue: finalVal,
      note: note || '',
      changedBy: req.user._id,
      changedAt: new Date(),
    };

    const profile = await StudentFinanceProfile.findOneAndUpdate(
      { studentId },
      {
        financeStatus: finalStatus,
        discountType: discountType || 'Fixed',
        discountValue: finalVal,
        updatedBy: req.user._id,
        $push: { discountHistory: { $each: [historyEntry], $position: 0 } },
      },
      { upsert: true, new: true, runValidators: true }
    )
      .populate('updatedBy', 'name')
      .populate('discountHistory.changedBy', 'name');

    // Sync all existing StudentBalance entries for this student
    await syncStudentBalancesWithProfile(studentId, profile);

    res.json(profile);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.removeStudentDiscount = async (req, res) => {
  try {
    const { studentId } = req.params;

    const historyEntry = {
      financeStatus: 'normal',
      discountType: 'Fixed',
      discountValue: 0,
      note: 'Discount removed',
      changedBy: req.user._id,
      changedAt: new Date(),
    };

    const profile = await StudentFinanceProfile.findOneAndUpdate(
      { studentId },
      {
        financeStatus: 'normal',
        discountType: 'Fixed',
        discountValue: 0,
        updatedBy: req.user._id,
        $push: { discountHistory: { $each: [historyEntry], $position: 0 } },
      },
      { upsert: true, new: true }
    );

    // Sync all existing StudentBalance entries for this student
    await syncStudentBalancesWithProfile(studentId, profile);

    res.json({ message: 'Discount removed successfully', profile });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// ══════════════════════════════════════════════════════
// ── Family Groups ──
// ══════════════════════════════════════════════════════

exports.getFamilyGroups = async (req, res) => {
  try {
    const groups = await FamilyGroup.find()
      .populate('students', 'name studentId classId status')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });
    res.json(groups);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getFamilyGroup = async (req, res) => {
  try {
    const group = await FamilyGroup.findById(req.params.id)
      .populate('students', 'name studentId classId status familyGroupId')
      .populate('createdBy', 'name');
    if (!group) return res.status(404).json({ message: 'Family group not found' });
    res.json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createFamilyGroup = async (req, res) => {
  try {
    const { familyName, studentIds = [] } = req.body;
    if (!familyName) return res.status(400).json({ message: 'Family name is required' });

    const group = await FamilyGroup.create({
      familyName,
      students: studentIds,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    // Update each student's familyGroupId
    if (studentIds.length > 0) {
      await Student.updateMany({ _id: { $in: studentIds } }, { familyGroupId: group._id });
    }

    const populated = await FamilyGroup.findById(group._id)
      .populate('students', 'name studentId classId status')
      .populate('createdBy', 'name');
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateFamilyGroup = async (req, res) => {
  try {
    const { familyName } = req.body;
    const group = await FamilyGroup.findByIdAndUpdate(
      req.params.id,
      { familyName, updatedBy: req.user._id },
      { new: true, runValidators: true }
    ).populate('students', 'name studentId classId status');
    if (!group) return res.status(404).json({ message: 'Family group not found' });
    res.json(group);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteFamilyGroup = async (req, res) => {
  try {
    const group = await FamilyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Family group not found' });

    // Clear familyGroupId from all students in this group
    await Student.updateMany({ familyGroupId: group._id }, { familyGroupId: null });
    await group.deleteOne();

    res.json({ message: 'Family group deleted and students unlinked' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Link two or more students into a family group
exports.linkStudentsAsFamily = async (req, res) => {
  try {
    const studentIdA = req.body.studentIdA || req.body.studentId1;
    const studentIdB = req.body.studentIdB || req.body.studentId2;
    const familyName = req.body.familyName;

    if (!studentIdA || !studentIdB) {
      return res.status(400).json({ message: 'Both studentIdA and studentIdB are required' });
    }
    if (studentIdA.toString() === studentIdB.toString()) {
      return res.status(400).json({ message: 'Cannot link a student to themselves' });
    }

    const [studentA, studentB] = await Promise.all([
      Student.findById(studentIdA),
      Student.findById(studentIdB),
    ]);

    if (!studentA || !studentB) return res.status(404).json({ message: 'One or both students not found' });

    // Check if they're already in the same group
    if (
      studentA.familyGroupId &&
      studentB.familyGroupId &&
      studentA.familyGroupId.toString() === studentB.familyGroupId.toString()
    ) {
      return res.status(409).json({ message: 'Students are already in the same family group' });
    }

    let group;

    if (studentA.familyGroupId) {
      // A already has a group — add B to it
      group = await FamilyGroup.findById(studentA.familyGroupId);
      if (!group.students.map(s => s.toString()).includes(studentIdB.toString())) {
        group.students.push(studentIdB);
        group.updatedBy = req.user._id;
        await group.save();
      }
      // If B was in another group, remove from that group first
      if (studentB.familyGroupId && studentB.familyGroupId.toString() !== group._id.toString()) {
        await FamilyGroup.findByIdAndUpdate(studentB.familyGroupId, { $pull: { students: studentIdB } });
      }
      await Student.findByIdAndUpdate(studentIdB, { familyGroupId: group._id });
    } else if (studentB.familyGroupId) {
      // B already has a group — add A to it
      group = await FamilyGroup.findById(studentB.familyGroupId);
      if (!group.students.map(s => s.toString()).includes(studentIdA.toString())) {
        group.students.push(studentIdA);
        group.updatedBy = req.user._id;
        await group.save();
      }
      await Student.findByIdAndUpdate(studentIdA, { familyGroupId: group._id });
    } else {
      // Neither has a group — create one
      group = await FamilyGroup.create({
        familyName: familyName || `${studentA.name} Family`,
        students: [studentIdA, studentIdB],
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });
      await Student.updateMany({ _id: { $in: [studentIdA, studentIdB] } }, { familyGroupId: group._id });
    }

    const populated = await FamilyGroup.findById(group._id)
      .populate('students', 'name studentId classId status familyGroupId');

    res.status(201).json({ message: 'Students linked as family', group: populated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Remove a student from their family group
exports.unlinkStudentFromFamily = async (req, res) => {
  try {
    const studentId = req.params.studentId || req.body.studentId;

    if (!studentId) return res.status(400).json({ message: 'Student ID is required' });

    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (!student.familyGroupId) return res.status(400).json({ message: 'Student is not in any family group' });

    const group = await FamilyGroup.findById(student.familyGroupId);
    if (group) {
      group.students = group.students.filter(s => s.toString() !== studentId.toString());
      if (group.students.length <= 1) {
        // Dissolve group if 1 or 0 students remain
        await Student.updateMany({ familyGroupId: group._id }, { familyGroupId: null });
        await group.deleteOne();
      } else {
        group.updatedBy = req.user._id;
        await group.save();
      }
    }

    await Student.findByIdAndUpdate(studentId, { familyGroupId: null });

    res.json({ message: 'Student removed from family group' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get a student's family members with their current balance details (for a given fee/period)
exports.getStudentFamily = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { feeId, billingYear, billingMonth, academicYear } = req.query;

    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (!student.familyGroupId) return res.json({ familyGroup: null, members: [] });

    const group = await FamilyGroup.findById(student.familyGroupId)
      .populate({
        path: 'students',
        select: 'name studentId classId status familyGroupId',
        match: { status: { $ne: 'Inactive' } },
        populate: { path: 'classId', select: 'className gradeLevel' }
      });

    if (!group || !group.students || group.students.length < 2) {
      if (group) {
        // Auto-dissolve orphaned group with < 2 active members
        await Student.updateMany({ familyGroupId: group._id }, { familyGroupId: null });
        await group.deleteOne();
      }
      return res.json({ familyGroup: null, members: [] });
    }

    // Load the reference fee structure (from the requesting student) to match by feeType & frequency
    const referenceFee = feeId ? await FeeStructure.findById(feeId) : null;

    // Get balance details for ALL active family members (including requested student)
    const members = [];
    for (const member of group.students) {
      let memberDetails = {
        _id: member._id,
        studentId: member.studentId,
        name: member.name,
        classId: member.classId,
        className: member.classId?.className || '—',
        status: member.status,
        isSelf: member._id.toString() === studentId,
        originalFee: 0,
        discountType: 'Fixed',
        discountValue: 0,
        discountAmount: 0,
        amountRequired: 0,
        paid: 0,
        pending: 0,
        financeStatus: 'normal',
        isFree: false,
      };

      if (feeId && referenceFee) {
        // Find the fee structure that belongs to this member's own class,
        // matching the same feeType and frequency as the reference fee.
        const memberClassId = member.classId?._id || member.classId;
        let memberFee = null;

        if (memberClassId) {
          // Look for a fee structure in the member's own class with same feeType & frequency
          memberFee = await FeeStructure.findOne({
            classId: memberClassId,
            feeType: referenceFee.feeType,
            frequency: referenceFee.frequency,
            academicYear: referenceFee.academicYear,
            status: 'Active',
          });

          // Fallback: match by name if feeType lookup didn't find anything
          if (!memberFee) {
            memberFee = await FeeStructure.findOne({
              classId: memberClassId,
              name: referenceFee.name,
              frequency: referenceFee.frequency,
              academicYear: referenceFee.academicYear,
              status: 'Active',
            });
          }
        }

        // If no class-specific fee found, fall back to the original reference fee
        const fee = memberFee || referenceFee;

        if (fee) {
          const isMonthly = fee.frequency === 'Monthly';
          const bYear = isMonthly ? (Number(billingYear) || new Date().getFullYear()) : null;
          const bMonth = isMonthly ? (billingMonth || null) : null;

          const effectiveDiscount = await getEffectiveDiscount(
            member._id, fee.amount, fee._id, bYear, bMonth
          );

          const amountRequired = effectiveDiscount.isFree ? 0 : Math.max(0, fee.amount - effectiveDiscount.discountAmount);

          const pmtMatch = {
            studentId: member._id,
            feeId: fee._id,
            ...(isMonthly && bYear ? { billingYear: bYear } : {}),
            ...(isMonthly && bMonth ? { billingMonth: bMonth } : {}),
          };

          const payments = await Payment.find(pmtMatch);
          const paid = payments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
          const pending = Math.max(0, amountRequired - paid);

          memberDetails = {
            ...memberDetails,
            feeId: fee._id,
            originalFee: effectiveDiscount.isFree ? 0 : fee.amount,
            discountType: effectiveDiscount.discountType,
            discountValue: effectiveDiscount.discountValue,
            discountAmount: effectiveDiscount.discountAmount,
            amountRequired,
            paid,
            pending,
            financeStatus: effectiveDiscount.financeStatus,
            isFree: effectiveDiscount.isFree,
          };
        }
      }

      members.push(memberDetails);
    }

    // Sort so selected student is first
    members.sort((a, b) => (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0));

    res.json({
      familyGroup: { _id: group._id, familyName: group.familyName },
      members,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Search students for linking as family (by name, studentId, phone)
exports.searchStudentsForFamily = async (req, res) => {
  try {
    const { search, excludeStudentId } = req.query;
    if (!search || search.length < 2) {
      return res.json([]);
    }

    const query = {
      status: { $ne: 'Inactive' },
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { studentId: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { parentPhone: { $regex: search, $options: 'i' } },
        { guardianPhone: { $regex: search, $options: 'i' } },
      ],
    };

    if (excludeStudentId) {
      query._id = { $ne: excludeStudentId };
    }

    const students = await Student.find(query)
      .select('name studentId classId phone parentPhone familyGroupId')
      .populate('classId', 'className gradeLevel')
      .limit(15);

    res.json(students);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ══════════════════════════════════════════════════════
// ── Family Payment (Multi-student) ──
// ══════════════════════════════════════════════════════

exports.createFamilyPayment = async (req, res) => {
  try {
    const {
      allocations, // [{ studentId, classId, feeId, billingYear, billingMonth, academicYear, allocatedAmount }]
      totalPaid,
      paymentMethod = 'Cash',
      referenceNumber = '',
      paymentDate = new Date(),
      note = '',
      familyGroupId = null,
    } = req.body;

    if (!Array.isArray(allocations) || allocations.length === 0) {
      return res.status(400).json({ message: 'No payment allocations provided' });
    }

    const pmtNowTotal = Number(totalPaid);
    if (isNaN(pmtNowTotal) || pmtNowTotal <= 0) {
      return res.status(400).json({ message: 'Total paid amount must be greater than 0' });
    }

    const allocationSum = allocations.reduce((sum, a) => sum + (Number(a.allocatedAmount) || 0), 0);
    if (Math.abs(allocationSum - pmtNowTotal) > 0.01) {
      return res.status(400).json({
        message: `Allocation sum ($${allocationSum.toFixed(2)}) must equal total paid ($${pmtNowTotal.toFixed(2)})`,
      });
    }

    const createdPayments = [];
    const allocationRecords = [];

    for (const item of allocations) {
      const studentId = item.studentId;
      const feeId = item.feeId || req.body.feeId;
      const classId = item.classId || req.body.classId;
      const billingYear = item.billingYear || req.body.billingYear;
      const billingMonth = item.billingMonth || req.body.billingMonth;
      const itemYear = item.academicYear || req.body.academicYear;
      const allocatedAmount = item.allocatedAmount;

      const pmtNow = Number(allocatedAmount) || 0;
      if (pmtNow <= 0) continue; // Skip $0 allocations (e.g. FREE students)

      const student = await Student.findById(studentId);
      if (!student || student.status === 'Inactive') continue;

      const fee = await FeeStructure.findById(feeId);
      if (!fee) continue;

      const isMonthly = fee.frequency === 'Monthly';
      const bYear = isMonthly ? (Number(billingYear) || new Date().getFullYear()) : null;
      const bMonth = isMonthly ? (billingMonth || null) : null;

      // Check if explicit discount or free status was passed for this student in the family payment request
      const reqDiscType = item.discountType;
      const reqDiscValue = item.discountValue !== undefined ? Number(item.discountValue) : undefined;
      const isExplicitFree = item.isFree === true || item.financeStatus === 'free';

      if (isExplicitFree) {
        await StudentFinanceProfile.findOneAndUpdate(
          { studentId },
          { financeStatus: 'free', updatedBy: req.user._id },
          { upsert: true }
        );
      } else if (reqDiscType !== undefined && reqDiscValue !== undefined) {
        await StudentFinanceProfile.findOneAndUpdate(
          { studentId },
          {
            financeStatus: reqDiscValue > 0 ? 'discounted' : 'normal',
            discountType: reqDiscType,
            discountValue: reqDiscValue,
            updatedBy: req.user._id
          },
          { upsert: true }
        );
      }

      const effectiveDiscount = await getEffectiveDiscount(student._id, fee.amount, fee._id, bYear, bMonth);
      const amountRequired = effectiveDiscount.isFree ? 0 : Math.max(0, fee.amount - effectiveDiscount.discountAmount);

      // Get previously paid
      const pmtMatch = {
        studentId,
        feeId,
        ...(isMonthly && bYear ? { billingYear: bYear } : {}),
        ...(isMonthly && bMonth ? { billingMonth: bMonth } : {}),
      };
      const prevPayments = await Payment.find(pmtMatch);
      const previouslyPaid = prevPayments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
      const pendingBefore = Math.max(0, amountRequired - previouslyPaid);

      if (pmtNow > pendingBefore + 0.01) {
        return res.status(400).json({
          message: `Allocation for ${student.name} ($${pmtNow}) exceeds pending balance ($${pendingBefore.toFixed(2)})`,
        });
      }

      const totalPaidAfter = previouslyPaid + pmtNow;
      const remainingBalance = Math.max(0, amountRequired - totalPaidAfter);
      const newStatus = calculateStatus(amountRequired, totalPaidAfter, fee.dueDate, bMonth, bYear);

      // Save/update per-period StudentBalance
      await StudentBalance.findOneAndUpdate(
        { studentId, feeStructureId: feeId, billingYear: bYear, billingMonth: bMonth },
        {
          discountType: effectiveDiscount.discountType,
          discountValue: effectiveDiscount.discountValue,
          discountAmount: effectiveDiscount.discountAmount,
          amountRequired,
          createdBy: req.user._id,
        },
        { upsert: true }
      );

      const receiptNo = await generateReceiptNo(Payment);
      const newPmt = await Payment.create({
        receiptNo,
        studentId,
        classId: classId || student.classId,
        feeId,
        feeName: fee.name,
        academicYear: itemYear || fee.academicYear,
        billingYear: bYear,
        billingMonth: bMonth,
        originalAmount: fee.amount,
        discountType: effectiveDiscount.discountType,
        discountValue: effectiveDiscount.discountValue,
        discountAmount: effectiveDiscount.discountAmount,
        amountRequired,
        previouslyPaid,
        paidAmount: pmtNow,
        balance: remainingBalance,
        paymentMethod,
        referenceNumber,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        status: newStatus,
        note: note ? `[Family Payment] ${note}` : '[Family Payment]',
        recordedBy: req.user._id,
      });

      createdPayments.push(newPmt);
      allocationRecords.push({
        studentId,
        paymentId: newPmt._id,
        allocatedAmount: pmtNow,
      });
    }

    // Determine academic year from first allocation
    const academicYear = allocations[0]?.academicYear || '';

    // Create the umbrella FamilyPayment record
    const receiptGroupNo = await generateFamilyReceiptNo(FamilyPayment);
    const familyPaymentDoc = await FamilyPayment.create({
      receiptGroupNo,
      familyGroupId: familyGroupId || null,
      academicYear,
      totalPaid: pmtNowTotal,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod,
      referenceNumber,
      note,
      allocations: allocationRecords,
      recordedBy: req.user._id,
    });

    res.status(201).json({
      message: `Family payment recorded for ${createdPayments.length} student(s)`,
      familyPayment: familyPaymentDoc,
      payments: createdPayments,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getFamilyPayment = async (req, res) => {
  try {
    const fp = await FamilyPayment.findById(req.params.id)
      .populate('familyGroupId', 'familyName')
      .populate('recordedBy', 'name')
      .populate('allocations.studentId', 'name studentId');
    if (!fp) return res.status(404).json({ message: 'Family payment not found' });
    res.json(fp);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
