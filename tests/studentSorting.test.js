const assert = require('assert');

// Test student sorting logic
const testStudents = [
  { name: 'Zaki Ahmed' },
  { name: 'Ahmed Ali' },
  { name: 'Mohamed Hassan' },
  { name: 'Abdi Noor' },
  { name: 'abdi noor' },
  { name: 'AHMED ALI' }
];

const sorted = [...testStudents].sort((a, b) =>
  (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true })
);

const names = sorted.map(s => s.name.toLowerCase());
console.log('Sorted names:', sorted.map(s => s.name));

// Verify ascending order
for (let i = 0; i < names.length - 1; i++) {
  assert(
    names[i].localeCompare(names[i + 1]) <= 0,
    `Order violation between "${names[i]}" and "${names[i + 1]}"`
  );
}

console.log('✅ Student sorting unit test passed successfully!');
