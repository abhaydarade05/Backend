import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

export async function authenticate(req, res, next) {
  try {
    const authorization = req.headers.authorization;
    const queryToken = req.path.startsWith('/files/') ? req.query.token : null;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : queryToken;
    if (!token) return res.status(401).json({ message: 'Authentication is required.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).select('_id name email role');
    if (!user) return res.status(401).json({ message: 'This account no longer exists.' });
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Your session is invalid or has expired. Please sign in again.' });
    }
    next(error);
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action.' });
    }
    next();
  };
}
