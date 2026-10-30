import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import portalRoutes from './routes/portal.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim()),
  credentials: false
}));
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  if (!req.body) req.body = {};
  next();
});
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api', portalRoutes);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.name === 'ValidationError') return res.status(400).json({ message: error.message });
  if (error.code === 11000) return res.status(409).json({ message: 'A record with that value already exists.' });
  if (error.name === 'MulterError' && error.code === 'LIMIT_FILE_SIZE') {
    const maxFileSizeMb = process.env.MAX_FILE_SIZE_MB || (process.env.VERCEL ? '4' : '20');
    return res.status(413).json({ message: `Files may not exceed ${maxFileSizeMb} MB.` });
  }
  console.error(error);
  res.status(500).json({ message: 'An unexpected server error occurred.' });
});

export default app;
