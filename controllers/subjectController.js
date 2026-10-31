const Subject = require('../models/Subject');
const Period = require('../models/Period');

// ─── Fixed subject list ────────────────────────────────────────────────────────
// Shared (appear in both Primary and Secondary) → level: 'Both'
// Primary only                                  → level: 'Primary'
// Secondary only                                → level: 'Secondary'
const FIXED_SUBJECTS = [
  // ── Shared (Both levels) ──────────────────────────────
  { name: 'Somali',      code: 'SOM',  level: 'Both' },
  { name: 'Islamic',     code: 'ISLM', level: 'Both' },
  { name: 'Arabic',      code: 'ARAB', level: 'Both' },
  { name: 'English',     code: 'ENG',  level: 'Both' },

  // ── Primary only ──────────────────────────────────────
  { name: 'Xisaab',     code: 'XIS',  level: 'Primary' },
  { name: 'Saynis',     code: 'SAY',  level: 'Primary' },
  { name: 'CB',         code: 'CB',   level: 'Primary' },
  { name: 'Technology', code: 'TECH', level: 'Primary' },

  // ── Secondary only ────────────────────────────────────
  { name: 'Mathematics', code: 'MATH', level: 'Secondary' },
  { name: 'Physics',     code: 'PHY',  level: 'Secondary' },
  { name: 'Chemistry',   code: 'CHEM', level: 'Secondary' },
  { name: 'Biology',     code: 'BIO',  level: 'Secondary' },
  { name: 'Geography',   code: 'GEO',  level: 'Secondary' },
  { name: 'History',     code: 'HIST', level: 'Secondary' },
  { name: 'Physical',    code: 'PHYS', level: 'Secondary' },
  { name: 'Business',    code: 'BUS',  level: 'Secondary' },
];

// ─── Sync DB to FIXED_SUBJECTS ────────────────────────────────────────────────
// • Insert missing subjects
// • Remove any subject NOT in the fixed list (unless it is in use by a period)
const syncSubjects = async () => {
  try {
    // 1. Upsert every fixed subject
    for (const sub of FIXED_SUBJECTS) {
      const exists = await Subject.findOne({
        name: { $regex: `^${sub.name}$`, $options: 'i' },
      });
      if (!exists) {
        await Subject.create({ ...sub, status: 'Active' }).catch(() => {});
      } else if (exists.level !== sub.level) {
        // Correct the level if it was wrong
        await Subject.updateOne({ _id: exists._id }, { level: sub.level });
      }
    }

    // 2. Delete any subject that is NOT in the fixed list and not in use
    const fixedNames = FIXED_SUBJECTS.map((s) => s.name.toLowerCase());
    const allSubjects = await Subject.find({});
    for (const sub of allSubjects) {
      if (!fixedNames.includes(sub.name.toLowerCase())) {
        const inUse = await Period.exists({ subject: sub.name });
        if (!inUse) {
          await sub.deleteOne();
        }
      }
    }
  } catch (err) {
    console.error('Error syncing subjects:', err.message);
  }
};

// ─── GET /subjects ─────────────────────────────────────────────────────────────
exports.getSubjects = async (req, res, next) => {
  try {
    await syncSubjects();

    const { search, status, level } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) query.name = { $regex: search, $options: 'i' };
    if (level && level !== 'All') {
      query.$or = [{ level }, { level: 'Both' }];
    }

    const subjects = await Subject.find(query).sort({ name: 1 });
    res.json({ subjects });
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
