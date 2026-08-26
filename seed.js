require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Settings = require('./models/Settings');
const Profile = require('./models/Profile');
const { ensureFixedCategories } = require('./controllers/categoryController');

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/school_management');
    console.log('Connected to MongoDB');
    await ensureFixedCategories();

    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@school.com';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin12345';

    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('Admin already exists. Fixed categories ensured.');
      process.exit(0);
    }

    const admin = await User.create({
      name: 'System Admin',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
    });

    await Profile.create({ userId: admin._id });
    await Settings.create({
      schoolName: 'Demo High School',
      schoolAddress: '123 Education Street',
      schoolPhone: '+1 234 567 8900',
      schoolEmail: 'info@demohighschool.com',
    });

    console.log('Seed completed!');
    console.log('Admin credentials:');
    console.log(`  Email: ${adminEmail}`);
    console.log(`  Password: ${adminPassword}`);
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error.message);
    process.exit(1);
  }
};

seed();
