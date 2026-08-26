require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const { ensureFixedCategories } = require('./controllers/categoryController');

const app = express();

connectDB().then(async () => {
  try {
    await ensureFixedCategories();
    console.log('Fixed class categories are ready');
  } catch (error) {
    console.error(`Unable to initialize class categories: ${error.message}`);
  }
});

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://d-hfrontend.vercel.app',
  'https://www.dhambaalschool.com',
  'https://dhambaalschool.com',
];

const envOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Custom domain + Vercel production/preview deployments
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'dhambaalschool.com' ||
      hostname === 'www.dhambaalschool.com' ||
      hostname.endsWith('.dhambaalschool.com') ||
      hostname === 'd-hfrontend.vercel.app' ||
      (hostname.endsWith('.vercel.app') && hostname.includes('d-hfrontend')) ||
      hostname.endsWith('-anasali500s-projects.vercel.app')
    );
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/teachers', require('./routes/teacherRoutes'));
app.use('/api/classes', require('./routes/classRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/periods', require('./routes/periodRoutes'));
app.use('/api/attendance', require('./routes/attendanceRoutes'));
app.use('/api/exams', require('./routes/examRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/promotion', require('./routes/promotionRoutes'));
app.use('/api/finance', require('./routes/financeRoutes'));
app.use('/api/exam-results', require('./routes/viewExamResultsRoutes'));

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
