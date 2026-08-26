const Period = require('../models/Period');
const Teacher = require('../models/Teacher');

exports.getPeriods = async (req, res) => {
  const { search, classId, teacherId, page = 1, limit = 10 } = req.query;
  const query = {};

  if (classId) query.classId = classId;
  if (teacherId) query.teacherId = teacherId;
  if (search) {
    query.$or = [
      { periodName: { $regex: search, $options: 'i' } },
      { subject: { $regex: search, $options: 'i' } },
    ];
  }

  const total = await Period.countDocuments(query);
  const periods = await Period.find(query)
    .populate('teacherId', 'name teacherId subject')
    .populate('classId', 'className gradeLevel')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.json({ periods, total, page: Number(page), pages: Math.ceil(total / limit) });
};

exports.getPeriod = async (req, res) => {
  const period = await Period.findById(req.params.id)
    .populate('teacherId', 'name teacherId')
    .populate('classId', 'className gradeLevel');
  if (!period) return res.status(404).json({ message: 'Period not found' });
  res.json(period);
};

exports.createPeriod = async (req, res) => {
  const period = await Period.create({ ...req.body, createdBy: req.user._id });
  await Teacher.findByIdAndUpdate(req.body.teacherId, { periodId: period._id });
  res.status(201).json(period);
};

exports.updatePeriod = async (req, res) => {
  const period = await Period.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!period) return res.status(404).json({ message: 'Period not found' });
  res.status(200).json(period);
};

exports.deletePeriod = async (req, res) => {
  const period = await Period.findById(req.params.id);
  if (!period) return res.status(404).json({ message: 'Period not found' });
  await period.deleteOne();
  res.json({ message: 'Period deleted successfully' });
};

exports.getMyPeriods = async (req, res) => {
  const teacher = await Teacher.findOne({ teacherId: req.user.teacherId });
  if (!teacher) return res.json({ periods: [] });

  const periods = await Period.find({ teacherId: teacher._id })
    .populate('classId', 'className gradeLevel');
  res.json({ periods });
};
