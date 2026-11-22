import { User } from '../models/User.js';

export async function requireAuth(req, res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Sign in is required.', code: 'AUTH_REQUIRED' });
    const user = await User.findById(userId);
    if (!user || user.status !== 'active') {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'This account cannot access the workspace.', code: 'ACCOUNT_INACTIVE' });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this action.', code: 'ROLE_FORBIDDEN' });
    }
    next();
  };
}

export function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    organizationName: user.organizationName,
    neighborhood: user.neighborhood
  };
}
