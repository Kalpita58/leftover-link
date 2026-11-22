import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { User } from '../models/User.js';
import { publicUser, requireAuth } from '../middleware/auth.js';

const router = Router();
const signInLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again later.' } });
const registrationLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many account attempts. Try again later.' } });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', registrationLimit, async (req, res) => {
  const { name, email, password, role, organizationName = '', neighborhood = '' } = req.body || {};
  if (!['consumer', 'restaurant'].includes(role)) return res.status(400).json({ error: 'Choose a consumer or restaurant account.' });
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) return res.status(400).json({ error: 'Enter a name between 2 and 100 characters.' });
  if (typeof email !== 'string' || !emailPattern.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) return res.status(400).json({ error: 'Password must be at least 12 characters.' });
  if (role === 'restaurant' && (typeof organizationName !== 'string' || organizationName.trim().length < 2)) return res.status(400).json({ error: 'Enter your restaurant name.' });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const status = role === 'restaurant' ? 'pending' : 'active';
    const user = await User.create({
      name: name.trim(), email: email.trim().toLowerCase(), passwordHash, role, status,
      organizationName: role === 'restaurant' ? organizationName.trim() : '',
      neighborhood: typeof neighborhood === 'string' ? neighborhood.trim().slice(0, 120) : ''
    });
    if (status === 'active') {
      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.userId = String(user._id);
      return res.status(201).json({ user: publicUser(user), message: 'Account created.' });
    }
    return res.status(201).json({ user: publicUser(user), message: 'Restaurant application received. An administrator must approve it before sign-in.' });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' });
    throw error;
  }
});

router.post('/login', signInLimit, async (req, res) => {
  const { email, password, role, remember = false } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Email and password are required.' });
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (role && role !== user.role) return res.status(403).json({ error: `This account is registered as ${user.role}.`, code: 'ROLE_MISMATCH' });
  if (user.status === 'pending') return res.status(403).json({ error: 'Your restaurant application is waiting for administrator approval.', code: 'ACCOUNT_PENDING' });
  if (user.status !== 'active') return res.status(403).json({ error: 'This account is not active.', code: 'ACCOUNT_INACTIVE' });
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = String(user._id);
  req.session.cookie.maxAge = remember === true ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60 * 8;
  res.json({ user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/logout', (req, res, next) => {
  if (!req.session) return res.status(204).end();
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('leftover.sid');
    res.status(204).end();
  });
});

export default router;
