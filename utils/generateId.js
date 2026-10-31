const Counter = require("../models/Counter");

const generateStudentId = async (Student) => {
  let counter = await Counter.findById("studentId");
  const students = await Student.find({ studentId: /^(?:DH|STU)\d+$/i }, { studentId: 1 });

  let maxSeq = 0;
  for (const st of students) {
    if (st.studentId) {
      const match = st.studentId.match(/^(?:DH|STU)(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxSeq) maxSeq = num;
      }
    }
  }

  if (!counter || counter.seq < maxSeq) {
    await Counter.findOneAndUpdate(
      { _id: "studentId" },
      { seq: maxSeq },
      { upsert: true, new: true }
    );
  }

  const updatedCounter = await Counter.findOneAndUpdate(
    { _id: "studentId" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  let candidateId = `DH${String(updatedCounter.seq).padStart(6, "0")}`;
  while (await Student.exists({ studentId: candidateId })) {
    const nextCounter = await Counter.findOneAndUpdate(
      { _id: "studentId" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    candidateId = `DH${String(nextCounter.seq).padStart(6, "0")}`;
  }

  return candidateId;
};

const generateTeacherId = async (Teacher) => {
  let counter = await Counter.findById("teacherId");
  const teachers = await Teacher.find({ teacherId: /^TCH\d+$/i }, { teacherId: 1 });

  let maxSeq = 0;
  for (const t of teachers) {
    if (t.teacherId) {
      const match = t.teacherId.match(/^TCH(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxSeq) maxSeq = num;
      }
    }
  }

  if (!counter || counter.seq < maxSeq) {
    await Counter.findOneAndUpdate(
      { _id: "teacherId" },
      { seq: maxSeq },
      { upsert: true, new: true }
    );
  }

  const updatedCounter = await Counter.findOneAndUpdate(
    { _id: "teacherId" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  let candidateId = `TCH${String(updatedCounter.seq).padStart(5, "0")}`;
  while (await Teacher.exists({ teacherId: candidateId })) {
    const nextCounter = await Counter.findOneAndUpdate(
      { _id: "teacherId" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    candidateId = `TCH${String(nextCounter.seq).padStart(5, "0")}`;
  }

  return candidateId;
};

const generateReceiptNo = async (Payment) => {
  let counter = await Counter.findById("receiptNo");
  const payments = await Payment.find({ receiptNo: /^REC\d+$/i }, { receiptNo: 1 });

  let maxSeq = 0;
  for (const p of payments) {
    if (p.receiptNo) {
      const match = p.receiptNo.match(/^REC(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxSeq) maxSeq = num;
      }
    }
  }

  if (!counter || counter.seq < maxSeq) {
    await Counter.findOneAndUpdate(
      { _id: "receiptNo" },
      { seq: maxSeq },
      { upsert: true, new: true }
    );
  }

  const updatedCounter = await Counter.findOneAndUpdate(
    { _id: "receiptNo" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  let candidateId = `REC${String(updatedCounter.seq).padStart(5, "0")}`;
  while (await Payment.exists({ receiptNo: candidateId })) {
    const nextCounter = await Counter.findOneAndUpdate(
      { _id: "receiptNo" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    candidateId = `REC${String(nextCounter.seq).padStart(5, "0")}`;
  }

  return candidateId;
};

const generateFamilyReceiptNo = async (FamilyPayment) => {
  let counter = await Counter.findById("familyReceiptNo");
  const payments = await FamilyPayment.find({ receiptGroupNo: /^FP-?\d+$/i }, { receiptGroupNo: 1 });

  let maxSeq = 0;
  for (const p of payments) {
    if (p.receiptGroupNo) {
      const match = p.receiptGroupNo.match(/^FP-?(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxSeq) maxSeq = num;
      }
    }
  }

  if (!counter || counter.seq < maxSeq) {
    await Counter.findOneAndUpdate(
      { _id: "familyReceiptNo" },
      { seq: maxSeq },
      { upsert: true, new: true }
    );
  }

  const updatedCounter = await Counter.findOneAndUpdate(
    { _id: "familyReceiptNo" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  let candidateId = `FP${String(updatedCounter.seq).padStart(5, "0")}`;
  while (await FamilyPayment.exists({ receiptGroupNo: candidateId })) {
    const nextCounter = await Counter.findOneAndUpdate(
      { _id: "familyReceiptNo" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    candidateId = `FP${String(nextCounter.seq).padStart(5, "0")}`;
  }

  return candidateId;
};

module.exports = { generateStudentId, generateTeacherId, generateReceiptNo, generateFamilyReceiptNo };
