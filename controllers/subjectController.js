const Subject = require('../models/Subject');
const Period = require('../models/Period');

// ─── STRICT fixed subject list ─────────────────────────────────────────────────
const FIXED_SUBJECTS = [
  // Shared — appear under BOTH Primary and Secondary filters
  { name: 'Somali',      code: 'SOM',  level: 'Both' },
  { name: 'Islamic',     code: 'ISLM', level: 'Both' },
  { name: 'Arabic',      code: 'ARAB', level: 'Both' },
  { name: 'English',     code: 'ENG',  level: 'Both' },

  // Primary only
  { name: 'Xisaab',     code: 'XIS',  level: 'Primary' },
  { name: 'Saynis',     code: 'SAY',  level: 'Primary' },
  { name: 'CB',         code: 'CB',   level: 'Primary' },
  { name: 'Technology', code: 'TECH', level: 'Primary' },

  // Secondary only
  { name: 'Mathematics', code: 'MATH', level: 'Secondary' },
  { name: 'Physics',     code: 'PHY',  level: 'Secondary' },
  { name: 'Chemistry',   code: 'CHEM', level: 'Secondary' },
  { name: 'Biology',     code: 'BIO',  level: 'Secondary' },
  { name: 'Geography',   code: 'GEO',  level: 'Secondary' },
  { name: 'History',     code: 'HIST', level: 'Secondary' },
  { name: 'Physical',    code: 'PHYS', level: 'Secondary' },
  { name: 'Business',    code: 'BUS',  level: 'Secondary' },
];

const FIXED_NAMES = FIXED_SUBJECTS.map((s) => s.name.toLowerCase());

// ─── Sync: upsert fixed subjects, delete everything else ──────────────────────
const syncSubjects = async () => {
  try {
    // 1. Upsert each fixed subject
    for (const sub of FIXED_SUBJECTS) {
      const exists = await Subject.findOne({
        name: { $regex: `^${sub.name}$`, $options: 'i' },
      });
      if (!exists) {
        await Subject.create({ ...sub, status: 'Active' }).catch(() => {});
      } else {
        // Always correct the level & status
        await Subject.updateOne(
          { _id: exists._id },
          { level: sub.level, status: 'Active', name: sub.name }
        );
      }
    }

    // 2. Force-delete EVERY subject not in the fixed list
    await Subject.deleteMany({
      name: { $nin: FIXED_SUBJECTS.map((s) => s.name) },
    });
  } catch (err) {
    console.error('Error syncing subjects:', err.message);
  }
};

// ─── GET /subjects ─────────────────────────────────────────────────────────────
exports.getSubjects = async (req, res, next) => {
  try {
    await syncSubjects();

    const { search, level } = req.query;

    // Start from the fixed list (order preserved)
    let subjects = FIXED_SUBJECTS.map((s) => ({ ...s, status: 'Active' }));

    // Apply search filter
    if (search) {
      const re = new RegExp(search, 'i');
      subjects = subjects.filter((s) => re.test(s.name));
    }

    // Apply level filter
    if (level && level !== 'All') {
      subjects = subjects.filter((s) => s.level === level || s.level === 'Both');
    }

    // Fetch real DB docs so _id is included (needed for subject selection)
    const dbDocs = await Subject.find({
      name: { $in: subjects.map((s) => s.name) },
    }).sort({ name: 1 });

    res.json({ subjects: dbDocs });
  } catch (error) {
    next(error);
  }
};

// ─── POST /subjects ────────────────────────────────────────────────────────────
exports.createSubject = async (req, res, next) => {
  try {
    const { name, code, description, level } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Subject name is required' });
    }

    const trimmedName = name.trim();
    const existing = await Subject.findOne({
      name: { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });

    if (existing) {
      return res.status(400).json({ message: `Subject "${existing.name}" already exists` });
    }

    const subject = await Subject.create({
      name: trimmedName,
      code: (code || trimmedName.slice(0, 4)).trim().toUpperCase(),
      description: description || '',
      status: 'Active',
      level: level || 'Both',
      createdBy: req.user._id,
    });

    res.status(201).json(subject);
  } catch (error) {
    next(error);
  }
};

// ─── DELETE /subjects/:id ──────────────────────────────────────────────────────
exports.deleteSubject = async (req, res, next) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) return res.status(404).json({ message: 'Subject not found' });

    const periodInUse = await Period.exists({ subject: subject.name });
    if (periodInUse) {
      return res.status(400).json({
        message: 'Cannot delete subject that is assigned to active classes/periods',
      });
    }

    await subject.deleteOne();
    res.json({ message: 'Subject deleted successfully' });
  } catch (error) {
    next(error);
  }
};
