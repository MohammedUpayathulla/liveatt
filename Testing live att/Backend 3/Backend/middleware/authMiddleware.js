'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'live-att-secret-2026';

// Paths that skip JWT — Pi device routes use COM_KEY; login is public
const EXEMPT = new Set([
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/attendance/log',
  'POST /api/attendance/presence',
  'POST /api/unknown-faces/log',
  'POST /api/cameras/health-update',
  'POST /api/cameras/bbox-frame',
  'GET  /health',
]);

// Pattern-based exemptions (dynamic segments like :id)
// <img> tags cannot send Authorization headers so stream must be public on LAN.
// The cameras list is also public so digital signage displays can load without login.
const EXEMPT_PATTERNS = [
  /^GET \/api\/cameras\/\d+\/stream$/,
  /^GET \/api\/cameras$/,
];

module.exports = function authMiddleware(req, res, next) {
  const key = `${req.method} ${req.originalUrl.split('?')[0]}`;
  if (EXEMPT.has(key)) return next();
  if (EXEMPT_PATTERNS.some((re) => re.test(key))) return next();

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired. Please log in again.' });
  }
};
