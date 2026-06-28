// S6 GOOD variant: require x-api-key on POST /shorten → 401 + JSON {error} when missing.
export default function apiKeyGuard(req, res, next) {
  if (req.method === 'POST' && req.path === '/shorten') {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'missing x-api-key' });
  }
  return next();
}
