// Unified CSRF protection (double-submit cookie pattern).
//
// Replaces the split/contradictory setup (a `csurf` instance used only for
// /api/csrf-token + a dead custom middleware) with ONE mechanism:
//   - issueCsrfCookie: sets a readable `XSRF-TOKEN` cookie the frontend echoes
//     back in an `X-CSRF-Token` header.
//   - csrfGuard: on state-changing methods, requires header == cookie.
//
// Rollout safety:
//   - Enforced ONLY when CSRF_ENFORCE=true, so it can ship dark and be enabled
//     after the frontend is confirmed to echo the token on staging.
//   - Skips safe methods (GET/HEAD/OPTIONS).
//   - Skips Bearer-authenticated requests: a cross-site attacker cannot set the
//     Authorization header, so those requests aren't CSRF-vulnerable (this keeps
//     the token-header dashboard flows working).

const crypto = require('crypto');
const { cookieSecure } = require('./cookies');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_COOKIE = 'XSRF-TOKEN';

function issueCsrfCookie(req, res, next) {
  if (!req.cookies || !req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // must be readable by JS to echo back in a header
      sameSite: 'Lax',
      secure: cookieSecure(),
      path: '/',
    });
    if (req.cookies) req.cookies[CSRF_COOKIE] = token; // available same-request
  }
  next();
}

function csrfGuard(req, res, next) {
  if (process.env.CSRF_ENFORCE !== 'true') return next(); // dark by default
  return requireCsrf(req, res, next);
}

// Same check, always enforced. Used by routes whose frontend was written to
// send the token from day one (espace entreprises, admin console).
function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const authz = req.headers['authorization'] || '';
  if (authz.startsWith('Bearer ')) return next(); // not CSRF-vulnerable

  const headerToken = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
  const cookieToken = req.cookies && req.cookies[CSRF_COOKIE];
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
}

module.exports = { issueCsrfCookie, csrfGuard, requireCsrf, CSRF_COOKIE };
