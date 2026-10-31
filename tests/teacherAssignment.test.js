const assert = require('assert');
const { processAndValidateAssignments } = require('../controllers/teacherController');

console.log('Running Teacher Subject & Class Assignment Tests...\n');

async function runTests() {
  // Test 1: Mohamed Ali scenario - valid multi-subject and multi-class assignments
  const mohamedAliAssignments = [
    { subject: 'Mathematics', classes: ['6a8fcb25016a6924f2a40f6c', '6a8fd465016a6924f2a417da'] },
    { subject: 'Physics', classes: ['6a8fd94b016a6924f2a41b54', '6a8fda00016a6924f2a41b99'] },
    { subject: 'Chemistry', classes: ['6a8fd465016a6924f2a417da', '6a8fd94b016a6924f2a41b54'] },
  ];

  const processed = await processAndValidateAssignments(mohamedAliAssignments);
  assert.strictEqual(processed.length, 3, 'Should have 3 subjects');
  assert.strictEqual(processed[0].subject, 'Mathematics');
  assert.strictEqual(processed[0].classes.length, 2, 'Mathematics should have 2 classes');
  assert.strictEqual(processed[1].subject, 'Physics');
  assert.strictEqual(processed[1].classes.length, 2, 'Physics should have 2 classes');
  assert.strictEqual(processed[2].subject, 'Chemistry');
  assert.strictEqual(processed[2].classes.length, 2, 'Chemistry should have 2 classes');
  console.log('✅ PASS: Mohamed Ali multi-subject multi-class assignment validated successfully.');

  // Test 2: Prevent duplicate subjects across rows
  const duplicateSubjectAssignments = [
    { subject: 'Mathematics', classes: ['6a8fcb25016a6924f2a40f6c'] },
    { subject: 'mathematics', classes: ['6a8fd465016a6924f2a417da'] },
  ];

  let threwDuplicateSubject = false;
  try {
    await processAndValidateAssignments(duplicateSubjectAssignments);
  } catch (err) {
    threwDuplicateSubject = true;
    assert(err.message.includes('Duplicate subject'), 'Should fail with duplicate subject message');
  }
  assert.strictEqual(threwDuplicateSubject, true, 'Duplicate subject must be rejected');
  console.log('✅ PASS: Duplicate subject assignments are strictly rejected.');

  // Test 3: Deduplicate identical classes within same subject
  const duplicateClassInSubject = [
    { subject: 'Biology', classes: ['6a8fcb25016a6924f2a40f6c', '6a8fcb25016a6924f2a40f6c'] },
  ];
  const processedDedupe = await processAndValidateAssignments(duplicateClassInSubject);
  assert.strictEqual(processedDedupe[0].classes.length, 1, 'Duplicate class IDs within subject should be deduplicated');
  console.log('✅ PASS: Duplicate classes within the same subject are automatically deduplicated.');

  // Test 4: Handles object references { _id }
  const objectIdAssignments = [
    { subject: 'English', classes: [{ _id: '6a8fcb25016a6924f2a40f6c' }, { _id: '6a8fd465016a6924f2a417da' }] },
  ];
  const processedObj = await processAndValidateAssignments(objectIdAssignments);
  assert.strictEqual(processedObj[0].classes.length, 2);
  assert.strictEqual(processedObj[0].classes[0], '6a8fcb25016a6924f2a40f6c');
  console.log('✅ PASS: Object-style class references ({ _id }) are properly resolved.');

  console.log('\n🎉 ALL TEACHER ASSIGNMENT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failure:', err);
  process.exit(1);
});
