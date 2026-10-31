const Subject = require('../models/Subject');
const Period = require('../models/Period');
const Teacher = require('../models/Teacher');

// Helper to seed subjects if none exist in the database
const ensureInitialSubjects = async () => {
  try {
    const count = await Subject.countDocuments();
    if (count === 0) {
      // Find any distinct subjects from Period collection
      const periodSubjects = await Period.distinct('subject');
      const teacherSubjects = await Teacher.distinct('subject');

      const rawList = [...periodSubjects, ...teacherSubjects];
      const normalizedSet = new Set();

      rawList.forEach((sub) => {
        if (!sub) return;
        // Split composite subjects like "Math / phy" or "Tarabiyo/Carabi" if needed, or clean up
        const parts = sub.includes('/') ? sub.split('/') : [sub];
        parts.forEach((p) => {
          const trimmed = p.trim();
          if (trimmed.length > 1) {
            normalizedSet.add(trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
          }
        });
      });

      // Default high school / middle school curriculum subjects if nothing yet
      const defaultSubjects = [
        'Arabic',
        'Biology',
        'Business',
        'Chemistry',
        'English',
        'Geography',
        'History',
        'Islamic Studies',
        'Mathematics',
        'Physics',
        'Science',
        'Social Studies',
        'Somali',
        'Technology',
      ];

      defaultSubjects.forEach((s) => normalizedSet.add(s));

      const docsToInsert = Array.from(normalizedSet).map((name) => ({
        name,
        code: name.slice(0, 4).toUpperCase(),
        status: 'Active',
      }));

      await Subject.insertMany(docsToInsert, { ordered: false }).catch(() => {});
    }
  } catch (err) {
    console.error('Error ensuring initial subjects:', err.message);
  }
};

exports.getSubjects = async (req, res, next) => {
  try {
    await ensureInitialSubjects();

    const { search, status } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) query.name = { $regex: search, $options: 'i' };

    let subjects = await Subject.find(query).sort({ name: 1 });

    // Also include any new distinct subjects from periods that might not be in Subject collection
    const periodSubjects = await Period.distinct('subject');
    const existingNames = new Set(subjects.map((s) => s.name.toLowerCase()));

    for (const pSub of periodSubjects) {
      if (pSub && pSub.trim() && !existingNames.has(pSub.trim().toLowerCase())) {
        try {
          const created = await Subject.create({
            name: pSub.trim(),
            code: pSub.trim().slice(0, 4).toUpperCase(),
            status: 'Active',
          });
          subjects.push(created);
          existingNames.add(created.name.toLowerCase());
        } catch {
          // ignore duplicate race condition
        }
      }
    }

    subjects.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ subjects });
  } catch (error) {
    next(error);
  }
};

exports.createSubject = async (req, res, next) => {
  try {
    const { name, code, description } = req.body;
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
      createdBy: req.user._id,
    });

    res.status(201).json(subject);
  } catch (error) {
    next(error);
  }
};

exports.deleteSubject = async (req, res, next) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) return res.status(404).json({ message: 'Subject not found' });

    // Check if any period is using this subject
    const periodInUse = await Period.exists({ subject: subject.name });
    if (periodInUse) {
      return res.status(400).json({ message: 'Cannot delete subject that is assigned to active classes/periods' });
    }

    await subject.deleteOne();
    res.json({ message: 'Subject deleted successfully' });
  } catch (error) {
    next(error);
  }
};
