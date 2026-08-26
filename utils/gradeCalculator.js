const calculatePercentage = (marks, totalMarks) => {
  if (!totalMarks || totalMarks <= 0) return 0;
  return Math.round((marks / totalMarks) * 100);
};

const calculateGrade = (percentage) => {
  if (percentage >= 95) return 'A+';
  if (percentage >= 90) return 'A';
  if (percentage >= 85) return 'A-';
  if (percentage >= 80) return 'B+';
  if (percentage >= 75) return 'B';
  if (percentage >= 70) return 'B-';
  if (percentage >= 65) return 'C+';
  if (percentage >= 60) return 'C';
  if (percentage >= 50) return 'C-';
  if (percentage >= 40) return 'D';
  if (percentage >= 20) return 'E';
  return 'F';
};

const calculateGPA = (percentage) => {
  if (percentage >= 95) return 4.0;
  if (percentage >= 90) return 3.9;
  if (percentage >= 85) return 3.7;
  if (percentage >= 80) return 3.5;
  if (percentage >= 75) return 3.0;
  if (percentage >= 70) return 2.7;
  if (percentage >= 65) return 2.3;
  if (percentage >= 60) return 2.0;
  if (percentage >= 50) return 1.5;
  if (percentage >= 40) return 1.0;
  if (percentage >= 20) return 0.5;
  return 0.0;
};

const getOrdinalPosition = (rank) => {
  if (!rank || rank <= 0) return 'N/A';
  const j = rank % 10;
  const k = rank % 100;
  if (j === 1 && k !== 11) return rank + 'st';
  if (j === 2 && k !== 12) return rank + 'nd';
  if (j === 3 && k !== 13) return rank + 'rd';
  return rank + 'th';
};

const calculateExamResult = (marks, totalMarks) => {
  const percentage = calculatePercentage(marks, totalMarks);
  const grade = calculateGrade(percentage);
  const gpa = calculateGPA(percentage);
  return { percentage, grade, gpa };
};

module.exports = { calculatePercentage, calculateGrade, calculateGPA, getOrdinalPosition, calculateExamResult };
