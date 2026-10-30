// backend/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { User } from '../models/index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Configure Gmail SMTP Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
  
  // Includes companyName (empty string '' for internal staff, or the specific company for CUSTOMER/CUSTOMER_SUB)
  res.json({ 
    token, 
    user: { 
      id: user.id, 
      name: user.name, 
      email: user.email, 
      role: user.role, 
      companyName: user.companyName || '' 
    } 
  });
});

router.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Email is required.' });

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ message: 'No account found with that email address.' });

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);
  
  // Set OTP and 10-minute expiration in database
  user.resetOtp = hashedOtp;
  user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  // Send Email
  try {
    await transporter.sendMail({
      from: `"FCPL Portal" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Your Password Reset OTP',
      html: `<h3>Password Reset Request</h3>
             <p>Hello ${user.name},</p>
             <p>Your One-Time Password (OTP) to reset your account password is:</p>
             <h2 style="color: #1A365D; letter-spacing: 2px;">${otp}</h2>
             <p>This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>`
    });
    res.json({ message: 'OTP sent successfully to your email.' });
  } catch (error) {
    console.error("Email send error:", error);
    res.status(500).json({ message: 'Failed to send OTP email. Check server configuration.' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) return res.status(400).json({ message: 'Email, OTP, and new password are required.' });

  if (newPassword.length < 8) return res.status(400).json({ message: 'New password must be at least 8 characters long.' });

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !user.resetOtp || !user.resetOtpExpiry) {
    return res.status(400).json({ message: 'Invalid request or OTP not requested.' });
  }

  if (new Date() > user.resetOtpExpiry) {
    return res.status(400).json({ message: 'Your OTP has expired. Please request a new one.' });
  }

  const isOtpValid = await bcrypt.compare(otp.trim(), user.resetOtp);
  if (!isOtpValid) {
    return res.status(400).json({ message: 'Invalid OTP.' });
  }

  // Update password and clear OTP
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.resetOtp = undefined;
  user.resetOtpExpiry = undefined;
  await user.save();

  res.json({ message: 'Password has been reset successfully. You can now log in.' });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;