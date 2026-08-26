const nodemailer = require('nodemailer');

const createTransporter = () => {
  if (!process.env.EMAIL_USER) return null;
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const sendResetEmail = async (email, resetToken) => {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`Reset token for ${email}: ${resetToken}`);
    return;
  }

  const frontendBase = (process.env.FRONTEND_URL || 'https://www.dhambaalschool.com')
    .split(',')
    .map((origin) => origin.trim())
    .find(Boolean);
  const resetUrl = `${frontendBase}/reset-password/${resetToken}`;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Password Reset - School Management System',
    html: `
      <h2>Password Reset Request</h2>
      <p>Click the link below to reset your password:</p>
      <a href="${resetUrl}">${resetUrl}</a>
      <p>This link expires in 1 hour.</p>
    `,
  });
};

module.exports = { sendResetEmail };
