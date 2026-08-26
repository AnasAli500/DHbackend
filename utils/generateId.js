const Counter = require("../models/Counter");

const generateStudentId = async (Student) => {
  // Check if studentId counter document exists
  let counter = await Counter.findById("studentId");
  if (!counter) {
    // Sync sequence with highest numeric STU ID in database
    const students = await Student.find({ studentId: /^STU\d+$/i })
      .sort({ studentId: -1 })
      .limit(100);

    let maxSeq = 0;
    for (const st of students) {
      if (st.studentId) {
        const match = st.studentId.match(/^STU(\d+)$/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxSeq) maxSeq = num;
        }
      }
    }
    await Counter.create({ _id: "studentId", seq: maxSeq });
  }

  const updatedCounter = await Counter.findOneAndUpdate(
    { _id: "studentId" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );

  return `DH${String(updatedCounter.seq).padStart(6, "0")}`;
};

const generateTeacherId = async (Teacher) => {
  const count = await Teacher.countDocuments();
  return `TCH${String(count + 1).padStart(5, "0")}`;
};

const generateReceiptNo = async (Payment) => {
  const count = await Payment.countDocuments();
  return `REC${String(count + 1).padStart(5, "0")}`;
};

module.exports = { generateStudentId, generateTeacherId, generateReceiptNo };
