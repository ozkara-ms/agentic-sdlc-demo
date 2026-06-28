// S6 NEGATIVE variant: rejects but with the WRONG status (403, not 401). The rubric's status
// assert must catch it (missing-key-not-rejected) — proving status-exactness, not just "some block".
export default function wrongStatus(req, res, next) {
  if (req.method === 'POST' && req.path === '/shorten' && !req.headers['x-api-key']) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return next();
}
