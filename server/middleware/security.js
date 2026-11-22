export function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const expectedOrigin = `${req.protocol}://${req.get('host')}`;
    if (new URL(origin).origin !== expectedOrigin) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed.', code: 'ORIGIN_FORBIDDEN' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.', code: 'ORIGIN_INVALID' });
  }
  next();
}
