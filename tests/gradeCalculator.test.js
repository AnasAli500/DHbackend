const assert = require('assert');
const {
  calculateGrade,
  isGradePassed,
  isPercentagePassed,
  calculateExamResult,
  PASSING_GRADES,
} = require('../utils/gradeCalculator');

console.log('Running Grade & Pass/Fail Rules Tests...\n');

// 1. Verify C- is PASS
assert.strictEqual(calculateGrade(50), 'C-');
assert.strictEqual(isGradePassed('C-'), true, 'C- must be PASS');
assert.strictEqual(isPercentagePassed(50), true, '50% must be PASS (C-)');
console.log('✅ PASS: C- (50%) is verified as PASSing grade.');

// 2. Verify D+ is FAILED
assert.strictEqual(calculateGrade(45), 'D+');
assert.strictEqual(isGradePassed('D+'), false, 'D+ must be FAILED');
assert.strictEqual(isPercentagePassed(45), false, '45% must be FAILED (D+)');
console.log('✅ PASS: D+ (45%) is verified as FAILED grade.');

// 3. Verify all passing grades: A+, A, A-, B+, B, B-, C+, C, C-
const expectedPassing = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'];
expectedPassing.forEach((grade) => {
  assert.strictEqual(
    isGradePassed(grade),
    true,
    `Grade ${grade} must be PASS`
  );
});
console.log(`✅ PASS: All passing grades verified: ${expectedPassing.join(', ')}`);

// 4. Verify all failing grades: D+, D, D-, F
const expectedFailing = ['D+', 'D', 'D-', 'F'];
expectedFailing.forEach((grade) => {
  assert.strictEqual(
    isGradePassed(grade),
    false,
    `Grade ${grade} must be FAILED`
  );
});
console.log(`✅ PASS: All failing grades verified: ${expectedFailing.join(', ')}`);

// 5. User example verification:
// Islamic = C- -> PASS
// Maths = B -> PASS
// English = C -> PASS
// Biology = D -> FAILED
const studentSubjects = [
  { name: 'Islamic', marks: 58, expectedGrade: 'C-', expectedPass: true },
  { name: 'Maths', marks: 78, expectedGrade: 'B', expectedPass: true },
  { name: 'English', marks: 62, expectedGrade: 'C', expectedPass: true },
  { name: 'Biology', marks: 40, expectedGrade: 'D', expectedPass: false },
];

studentSubjects.forEach((sub) => {
  const result = calculateExamResult(sub.marks, 100);
  assert.strictEqual(result.grade, sub.expectedGrade);
  assert.strictEqual(
    result.isPassed,
    sub.expectedPass,
    `${sub.name} (${sub.expectedGrade}) should be ${sub.expectedPass ? 'PASS' : 'FAILED'}`
  );
});
console.log('✅ PASS: Student subject breakdown example verified (Islamic: C- -> PASS, Biology: D -> FAILED).');

// 6. Overall Result Status verification (Saajid: 68%, Overall Grade C+)
const saajidOverallGrade = calculateGrade(68);
assert.strictEqual(saajidOverallGrade, 'C+');
assert.strictEqual(isGradePassed(saajidOverallGrade), true, 'C+ overall grade must be PASS');
console.log('✅ PASS: Saajid overall result (68%, C+) verified as PASSED.');

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
