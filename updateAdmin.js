require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");
const Profile = require("./models/Profile");

// Direct shard connection (bypasses SRV DNS lookup)
const MONGO_URI =
  process.env.MONGODB_URI ||
  "mongodb://dhambaal1122:Vxa55Y3YunQ9UiMC@ac-zkh0uyr-shard-00-00.ndqhefs.mongodb.net:27017,ac-zkh0uyr-shard-00-01.ndqhefs.mongodb.net:27017,ac-zkh0uyr-shard-00-02.ndqhefs.mongodb.net:27017/?tls=true&authSource=admin&retryWrites=true&w=majority&appName=Dhambaal";

const NEW_NAME     = "anas";
const NEW_EMAIL    = "anas@gmail.com";
const NEW_PASSWORD = "anas1122";
const ROLE         = "admin";

const run = async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
    console.log("Connected to MongoDB");

    // Check if user with this email already exists
    const existing = await User.findOne({ email: NEW_EMAIL });

    if (existing) {
      // Update all fields
      existing.name     = NEW_NAME;
      existing.email    = NEW_EMAIL;
      existing.password = NEW_PASSWORD; // bcrypt-hashed by pre-save hook
      existing.role     = ROLE;
      await existing.save();
      console.log("✅ User already existed — updated successfully!");
    } else {
      // Create brand-new user
      const newUser = await User.create({
        name:     NEW_NAME,
        email:    NEW_EMAIL,
        password: NEW_PASSWORD,
        role:     ROLE,
      });
      // Ensure profile exists
      const existingProfile = await Profile.findOne({ userId: newUser._id });
      if (!existingProfile) {
        await Profile.create({ userId: newUser._id });
      }
      console.log("✅ New user created successfully!");
    }

    console.log(`   Name:     ${NEW_NAME}`);
    console.log(`   Email:    ${NEW_EMAIL}`);
    console.log(`   Password: ${NEW_PASSWORD}`);
    console.log(`   Role:     ${ROLE}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
};

run();
