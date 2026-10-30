// backend/models/index.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { 
    type: String, 
    enum: ['MASTER', 'ADMIN', 'USER', 'CUSTOMER', 'CUSTOMER_SUB'], 
    default: 'USER' 
  },
  companyName: { type: String, trim: true, default: '' }, // Enforces Row-Level Security (RLS)
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Tracks the 5 sub-user limit
  resetOtp: { type: String },
  resetOtpExpiry: { type: Date }
}, { timestamps: true });

const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true, minimize: false });

const settingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  customers: [String],
  departments: [String],
  metricsTargets: { type: mongoose.Schema.Types.Mixed },
  uploadConfig: { type: mongoose.Schema.Types.Mixed },
  fieldGovernance: { type: mongoose.Schema.Types.Mixed },
  adminSettingsEvents: [mongoose.Schema.Types.Mixed],
  deletionEvents: [mongoose.Schema.Types.Mixed]
}, { timestamps: true, minimize: false });

const counterSchema = new mongoose.Schema({
  _id: String,
  sequence: { type: Number, default: 0 }
});

const notificationSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, index: true },
  message: { type: String, required: true },
  ticketId: { type: String },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, expires: 5184000 } // 60-Day TTL
});

export const User = mongoose.model('User', userSchema);
export const Ticket = mongoose.model('Ticket', ticketSchema);
export const Settings = mongoose.model('Settings', settingsSchema);
export const Counter = mongoose.model('Counter', counterSchema);
export const Notification = mongoose.model('Notification', notificationSchema);