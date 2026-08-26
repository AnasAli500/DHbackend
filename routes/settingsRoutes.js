const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  getSettings,
  getPublicSettings,
  updateSettings,
  updateTheme,
  uploadLogo,
  deleteLogo,
} = require('../controllers/settingsController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `logo_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const isImage = file.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.originalname);
    if (!isImage) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  },
});

router.get('/public', getPublicSettings);

router.get('/', protect, getSettings);
router.put('/', protect, authorize('admin'), updateSettings);
router.put('/theme', protect, updateTheme);
router.post(
  '/logo',
  protect,
  authorize('admin'),
  (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || 'Image upload error' });
      }
      next();
    });
  },
  uploadLogo
);
router.delete('/logo', protect, authorize('admin'), deleteLogo);

module.exports = router;


