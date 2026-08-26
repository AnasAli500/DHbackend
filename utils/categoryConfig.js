const CATEGORY_DEFINITIONS = [
  {
    code: 'A',
    name: 'Short Course & Middle School',
    academicType: 'Semester',
    examStructure: [
      { phase: 'Semester 1', examType: 'Monthly 1', totalMarks: 50 },
      { phase: 'Semester 1', examType: 'Midterm', totalMarks: 50 },
      { phase: 'Semester 2', examType: 'Monthly 2', totalMarks: 50 },
      { phase: 'Semester 2', examType: 'Final Exam', totalMarks: 50 },
    ],
  },
  {
    code: 'B',
    name: 'Regular High School',
    academicType: 'Annual',
    examStructure: [
      { phase: 'Annual', examType: 'Monthly 1', totalMarks: 10 },
      { phase: 'Annual', examType: 'Midterm', totalMarks: 40 },
      { phase: 'Annual', examType: 'Monthly 2', totalMarks: 10 },
      { phase: 'Annual', examType: 'Final Exam', totalMarks: 40 },
    ],
  },
  {
    code: 'C',
    name: 'National Examination',
    academicType: 'National',
    examStructure: [
      { phase: 'Course Assessment', examType: 'Monthly 1', totalMarks: 20 },
      { phase: 'Course Assessment', examType: 'Midterm', totalMarks: 60 },
      { phase: 'Course Assessment', examType: 'Monthly 2', totalMarks: 20 },
      { phase: 'National', examType: 'Final Exam', totalMarks: 100 },
    ],
  },
];

module.exports = { CATEGORY_DEFINITIONS };
