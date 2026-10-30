// backend/routes/portal.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import mongoose from 'mongoose';
import multer from 'multer';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { Counter, Settings, Ticket, User } from '../models/index.js';
import { defaultSettings } from '../config/defaults.js';
import { getAtlasStorage } from '../services/atlasStorage.js';

const router = Router();
const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || (process.env.VERCEL ? 4 : 20));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileSizeMb * 1024 * 1024 } });
const admin = requireRoles('MASTER', 'ADMIN');
const allowedSettings = ['customers', 'departments', 'metricsTargets', 'uploadConfig', 'fieldGovernance'];
const fileTypes = ['IMAGE', 'PDF', 'EXCEL'];

function serializeTicket(ticket) {
  return { ...ticket.data, id: ticket.ticketId, _id: ticket.id };
}

async function getSettings() {
  return Settings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { ...defaultSettings, adminSettingsEvents: [], deletionEvents: [] } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

function collectFileIds(value, ids = new Set()) {
  if (!value || typeof value !== 'object') return ids;
  if (!Array.isArray(value) && typeof value.id === 'string' && value.url?.startsWith('/api/files/')) {
    ids.add(value.id);
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectFileIds(child, ids);
  }
  return ids;
}

async function removeStoredFiles(fileIds) {
  const objectIds = [...new Set(fileIds)]
    .filter(id => mongoose.isValidObjectId(id))
    .map(id => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) return;
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  const existingFiles = await bucket.find({ _id: { $in: objectIds } }).toArray();
  await Promise.all(existingFiles.map(file => bucket.delete(file._id)));
}

router.use(authenticate);

router.get('/bootstrap', async (req, res) => {
  const isCustomerRole = req.user.role && req.user.role.startsWith('CUSTOMER');

  // If role is CUSTOMER or CUSTOMER_SUB, only return their company's tickets.
  // Otherwise (MASTER, ADMIN, USER), return all tickets just like before.
  const ticketQuery = isCustomerRole
    ? { 'data.customer': req.user.companyName }
    : {};

  // Isolate user list for customers so they only see their own company sub-accounts
  const userQuery = isCustomerRole
    ? { companyName: req.user.companyName, role: { $in: ['CUSTOMER', 'CUSTOMER_SUB'] } }
    : {};

  const [settings, tickets, users] = await Promise.all([
    getSettings(),
    Ticket.find(ticketQuery).sort({ createdAt: -1 }),
    User.find(userQuery).select('name email role companyName').sort({ name: 1 })
  ]);

  res.json({
    tickets: tickets.map(serializeTicket),
    users,
    customers: settings.customers,
    departments: settings.departments,
    metricsTargets: settings.metricsTargets,
    uploadConfig: settings.uploadConfig,
    fieldGovernance: settings.fieldGovernance,
    adminSettingsEvents: isCustomerRole ? [] : settings.adminSettingsEvents,
    deletionEvents: isCustomerRole ? [] : settings.deletionEvents
  });
});

router.get('/storage/atlas', admin, async (req, res) => {
  try {
    res.json(await getAtlasStorage());
  } catch (error) {
    const status = error.message.includes('is not configured') ? 503 : 502;
    res.status(status).json({ message: error.message });
  }
});

router.put('/settings', admin, async (req, res) => {
  const updates = {};
  for (const key of allowedSettings) {
    if (Object.hasOwn(req.body, key)) updates[key] = req.body[key];
  }
  if (!Object.keys(updates).length) return res.status(400).json({ message: 'No supported settings were provided.' });
  if (Object.hasOwn(updates, 'customers') && (!Array.isArray(updates.customers) || updates.customers.some(value => typeof value !== 'string'))) {
    return res.status(400).json({ message: 'Customers must be a list of names.' });
  }
  if (Object.hasOwn(updates, 'departments') && (!Array.isArray(updates.departments) || updates.departments.some(value => typeof value !== 'string'))) {
    return res.status(400).json({ message: 'Departments must be a list of names.' });
  }
  if (Object.hasOwn(updates, 'metricsTargets') && (!updates.metricsTargets || typeof updates.metricsTargets !== 'object' || Object.values(updates.metricsTargets).some(value => !Number.isFinite(Number(value)) || Number(value) < 0))) {
    return res.status(400).json({ message: 'SLA targets must be non-negative numbers.' });
  }
  if (Object.hasOwn(updates, 'uploadConfig')) {
    const maximumBytes = maxFileSizeMb * 1024 * 1024;
    const invalidLimit = Object.values(updates.uploadConfig).some(stage =>
      !stage || fileTypes.some(type => {
        const rule = stage[type];
        const bytes = Number(rule?.size) * (rule?.unit === 'MB' ? 1024 * 1024 : 1024);
        return typeof rule?.enabled !== 'boolean' ||
          !Number.isFinite(bytes) ||
          bytes <= 0 ||
          !['KB', 'MB'].includes(rule.unit) ||
          bytes > maximumBytes;
      })
    );
    if (invalidLimit) {
      return res.status(400).json({ message: `Upload limits must be positive and cannot exceed ${maxFileSizeMb} MB.` });
    }
  }
  const settings = await getSettings();
  Object.assign(settings, updates);
  await settings.save();
  res.json({ message: 'Settings saved.' });
});

router.post('/logs/admin', admin, async (req, res) => {
  const action = String(req.body.action || '').trim();
  if (!action) return res.status(400).json({ message: 'An audit action is required.' });
  const settings = await getSettings();
  settings.adminSettingsEvents.push({
    timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    name: req.user.name,
    email: req.user.email,
    action
  });
  await settings.save();
  res.status(201).json({ message: 'Admin event recorded.' });
});

router.post('/users', admin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = String(req.body.role || 'USER').toUpperCase();
  const companyName = String(req.body.companyName || '').trim();

  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'A valid name and email are required.' });
  }
  if (!['USER', 'ADMIN', 'MASTER', 'CUSTOMER'].includes(role)) {
    return res.status(400).json({ message: 'Invalid user role.' });
  }
  if (role === 'CUSTOMER' && !companyName) {
    return res.status(400).json({ message: 'Please select a Company Name for this CUSTOMER account.' });
  }
  if (role === 'MASTER' && req.user.role !== 'MASTER') {
    return res.status(403).json({ message: 'Only a Master Admin can create another Master Admin.' });
  }
  if (await User.exists({ email })) {
    return res.status(409).json({ message: 'A user with this email already exists.' });
  }

  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  const user = await User.create({
    name,
    email,
    role,
    companyName: role === 'CUSTOMER' ? companyName : '',
    passwordHash: await bcrypt.hash(temporaryPassword, 12)
  });

  res.status(201).json({
    user: { _id: user._id, id: user.id, name, email, role, companyName: user.companyName },
    temporaryPassword
  });
});

router.delete('/users/:id', admin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user ID.' });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (user.role === 'MASTER') return res.status(403).json({ message: 'Master Admin accounts cannot be deleted here.' });
  await user.deleteOne();
  res.json({ message: 'User deleted.' });
});

// PRIMARY CUSTOMER ONLY: Add up to 5 secondary CUSTOMER_SUB users
router.post('/customer/sub-users', async (req, res) => {
  if (req.user.role !== 'CUSTOMER') {
    return res.status(403).json({ message: 'Only primary CUSTOMER accounts can add secondary users.' });
  }

  const existingSubCount = await User.countDocuments({
    companyName: req.user.companyName,
    role: 'CUSTOMER_SUB'
  });

  if (existingSubCount >= 5) {
    return res.status(400).json({ message: 'Limit reached: You can only add up to 5 secondary customer users.' });
  }

  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'A valid name and email are required.' });
  }
  if (await User.exists({ email })) {
    return res.status(409).json({ message: 'A user with this email already exists.' });
  }

  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  const subUser = await User.create({
    name,
    email,
    role: 'CUSTOMER_SUB',
    companyName: req.user.companyName,
    invitedBy: req.user._id || req.user.id,
    passwordHash: await bcrypt.hash(temporaryPassword, 12)
  });

  res.status(201).json({
    user: {
      _id: subUser._id,
      id: subUser.id,
      name: subUser.name,
      email: subUser.email,
      role: subUser.role,
      companyName: subUser.companyName
    },
    temporaryPassword
  });
});

// PRIMARY CUSTOMER ONLY: Remove a secondary CUSTOMER_SUB user
router.delete('/customer/sub-users/:id', async (req, res) => {
  if (req.user.role !== 'CUSTOMER') {
    return res.status(403).json({ message: 'Unauthorized.' });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid user ID.' });
  }
  const target = await User.findOne({
    _id: req.params.id,
    companyName: req.user.companyName,
    role: 'CUSTOMER_SUB'
  });
  if (!target) return res.status(404).json({ message: 'Team member not found.' });

  await target.deleteOne();
  res.json({ message: 'Team member removed.' });
});

router.get('/tickets/next-id', admin, async (req, res) => {
  const year = new Date().getFullYear();
  const counter = await Counter.findByIdAndUpdate(
    `tickets-${year}`,
    { $inc: { sequence: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  res.json({ id: `FC/${year}-${String(year + 1).slice(-2)}/${String(counter.sequence).padStart(2, '0')}` });
});

router.get('/tickets', async (req, res) => {
  const isCustomerRole = req.user.role && req.user.role.startsWith('CUSTOMER');
  const filter = isCustomerRole ? { 'data.customer': req.user.companyName } : {};
  const tickets = await Ticket.find(filter).sort({ createdAt: -1 });
  res.json({ tickets: tickets.map(serializeTicket) });
});

router.post('/tickets', admin, async (req, res) => {
  const ticket = { ...req.body };
  delete ticket._id;
  if (!ticket.customer || !ticket.initiationDate || !ticket.responseDate) {
    return res.status(400).json({ message: 'Customer, initiation date, and response date are required.' });
  }
  const requestedId = String(ticket.id || '');
  const requestedIdParts = requestedId.match(/^FC\/(\d{4})-\d{2}\/(\d+)$/);
  const reservedCounter = requestedIdParts
    ? await Counter.findById(`tickets-${requestedIdParts[1]}`)
    : null;
  if (
    requestedIdParts &&
    requestedIdParts[1] === String(new Date().getFullYear()) &&
    reservedCounter &&
    reservedCounter.sequence >= Number(requestedIdParts[2]) &&
    !await Ticket.exists({ ticketId: requestedId })
  ) {
    ticket.id = requestedId;
  } else {
    const year = new Date().getFullYear();
    const counter = await Counter.findByIdAndUpdate(
      `tickets-${year}`,
      { $inc: { sequence: 1 } },
      { returnDocument: 'after', upsert: true }
    );
    ticket.id = `FC/${year}-${String(year + 1).slice(-2)}/${String(counter.sequence).padStart(2, '0')}`;
  }
  const created = await Ticket.create({ ticketId: ticket.id, data: ticket });
  res.status(201).json({ ticket: serializeTicket(created) });
});

router.put('/tickets/:id', async (req, res) => {
  if (req.user.role && req.user.role.startsWith('CUSTOMER')) {
    return res.status(403).json({ message: 'Customer accounts are read-only.' });
  }
  const ticket = await Ticket.findOne({ ticketId: req.params.id });
  if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
  const assigned = (ticket.data.team || []).some(member => member.name === req.user.name);
  if (!['MASTER', 'ADMIN'].includes(req.user.role) && !assigned) {
    return res.status(403).json({ message: 'Only an assigned team member or administrator can update this ticket.' });
  }
  const next = { ...req.body, id: ticket.ticketId };
  delete next._id;
  const stageChanged = next.stage !== ticket.data.stage;
  const closing = next.status === 'CLOSED' && ticket.data.status !== 'CLOSED';
  const isTeamLeader = (ticket.data.team || []).some(member => member.name === req.user.name && member.role === 'Leader');
  if (!['MASTER', 'ADMIN'].includes(req.user.role) && JSON.stringify(next.team || []) !== JSON.stringify(ticket.data.team || [])) {
    return res.status(403).json({ message: 'Only an administrator or team lead can change team assignments.' });
  }
  if (closing && next.stage !== 'D8') {
    return res.status(400).json({ message: 'A ticket can only be closed from stage D8.' });
  }
  if (stageChanged || closing) {
    if (!['MASTER', 'ADMIN'].includes(req.user.role) && !isTeamLeader) {
      return res.status(403).json({ message: 'Only an administrator or assigned team lead can approve stage changes.' });
    }
    const stages = ['D0', 'D1_D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];
    if (stageChanged && stages.indexOf(next.stage) !== stages.indexOf(ticket.data.stage) + 1) {
      return res.status(400).json({ message: 'Tickets must move one stage at a time.' });
    }
  }
  const previousFiles = collectFileIds(ticket.data);
  const currentFiles = collectFileIds(next);
  ticket.data = next;
  await ticket.save();
  await removeStoredFiles([...previousFiles].filter(id => !currentFiles.has(id)));
  res.json({ ticket: serializeTicket(ticket) });
});

router.delete('/tickets', admin, async (req, res) => {
  if (!Array.isArray(req.body.tickets) || req.body.tickets.length === 0) {
    return res.status(400).json({ message: 'Select at least one ticket to delete.' });
  }
  const requestedIds = req.body.tickets.map(ticket => String(ticket.id || ''));
  const existingTickets = await Ticket.find({ ticketId: { $in: requestedIds } });
  const result = await Ticket.deleteMany({ ticketId: { $in: requestedIds } });
  await removeStoredFiles(existingTickets.flatMap(ticket => [...collectFileIds(ticket.data)]));
  if (existingTickets.length) {
    const settings = await getSettings();
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    settings.deletionEvents.push(...existingTickets.map(({ ticketId, data }) => ({
      timestamp,
      adminName: req.user.name,
      adminEmail: req.user.email,
      queryId: ticketId,
      customer: data.customer || '',
      fcplPartNo: data.fcplPartNo || '',
      initiationDate: data.initiationDate || '',
      responseDate: data.responseDate || ''
    })));
    await settings.save();
  }
  res.json({ deletedCount: result.deletedCount });
});

router.post('/files', upload.single('file'), async (req, res) => {
  if (req.user.role && req.user.role.startsWith('CUSTOMER')) {
    return res.status(403).json({ message: 'Customer accounts cannot upload files.' });
  }
  if (!req.file) return res.status(400).json({ message: 'Choose a file to upload.' });
  const configKey = String(req.body.configKey || '');
  const type = String(req.body.type || '').toUpperCase();
  if (!['IMAGE', 'PDF', 'EXCEL'].includes(type)) return res.status(400).json({ message: 'Unsupported file type.' });
  const settings = await getSettings();
  const rule = settings.uploadConfig?.[configKey]?.[type];
  if (!rule?.enabled) return res.status(403).json({ message: 'Uploads of this file type are disabled for this workflow step.' });

  const bytesAllowed = Number(rule.size) * (rule.unit === 'MB' ? 1024 * 1024 : 1024);
  if (!Number.isFinite(bytesAllowed) || req.file.size > bytesAllowed) {
    return res.status(413).json({ message: `The file exceeds the configured ${rule.size}${rule.unit} limit.` });
  }
  const isImage = req.file.mimetype.startsWith('image/');
  const extension = path.extname(req.file.originalname).toLowerCase();
  const isPdf = req.file.mimetype === 'application/pdf' || extension === '.pdf';
  const isExcel = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(req.file.mimetype) ||
    ['.xls', '.xlsx'].includes(extension);
  if ((type === 'IMAGE' && !isImage) || (type === 'PDF' && !isPdf) || (type === 'EXCEL' && !isExcel)) {
    return res.status(400).json({ message: 'The selected file does not match the chosen file type.' });
  }

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  const fileId = new mongoose.Types.ObjectId();
  const stream = bucket.openUploadStreamWithId(fileId, req.file.originalname, {
    contentType: req.file.mimetype,
    metadata: { uploadedBy: req.user.id, uploadedAt: new Date() }
  });
  stream.end(req.file.buffer);
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  res.status(201).json({
    file: { id: fileId.toString(), name: req.file.originalname, type: req.file.mimetype, url: `/api/files/${fileId}` }
  });
});

router.get('/files/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid file ID.' });
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  const files = await bucket.find({ _id: new mongoose.Types.ObjectId(req.params.id) }).toArray();
  if (!files.length) return res.status(404).json({ message: 'File not found.' });
  res.set('Content-Type', files[0].contentType || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(files[0].filename)}`);
  bucket.openDownloadStream(files[0]._id).pipe(res);
});

router.delete('/files/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid file ID.' });
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  const fileId = new mongoose.Types.ObjectId(req.params.id);
  const files = await bucket.find({ _id: fileId }).toArray();
  if (!files.length) return res.status(404).json({ message: 'File not found.' });
  if (files[0].metadata?.uploadedBy !== req.user.id && !['MASTER', 'ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ message: 'You cannot delete a file uploaded by another user.' });
  }
  await bucket.delete(fileId);
  res.status(204).end();
});

export default router;