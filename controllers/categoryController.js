const Category = require('../models/Category');
const ExamSeason = require('../models/ExamSeason');
const ExamStructure = require('../models/ExamStructure');
const { CATEGORY_DEFINITIONS } = require('../utils/categoryConfig');

const ensureFixedCategories = async () => {
  const categories = await Promise.all(CATEGORY_DEFINITIONS.map((category) => Category.findOneAndUpdate(
    { code: category.code },
    { $set: category },
    { upsert: true, new: true, runValidators: true }
  )));

  for (const category of categories) {
    const definition = CATEGORY_DEFINITIONS.find((item) => item.code === category.code);
    const seasonNames = [...new Set(definition.examStructure.map((item) => item.phase))];
    for (const name of seasonNames) {
      const season = await ExamSeason.findOneAndUpdate(
        { name, categoryId: category._id },
        { $set: { name, categoryId: category._id, status: 'Active' } },
        { upsert: true, new: true, runValidators: true }
      );
      for (const item of definition.examStructure.filter((structure) => structure.phase === name)) {
        await ExamStructure.findOneAndUpdate(
          { categoryId: category._id, seasonId: season._id, examType: item.examType },
          { $set: { categoryId: category._id, seasonId: season._id, examType: item.examType, maxMarks: item.totalMarks, status: 'Active' } },
          { upsert: true, new: true, runValidators: true }
        );
      }
    }
  }
};

exports.getCategories = async (_req, res) => {
  await ensureFixedCategories();
  const categories = await Category.find().sort({ code: 1 });
  res.json({ categories });
};

exports.ensureFixedCategories = ensureFixedCategories;
