// S6 NEGATIVE variant: no auth check — missing key flows through and gets 201. Rubric must catch
// (missing-key-not-rejected).
export default function noAuth(req, res, next) { return next(); }
