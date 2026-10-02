const crypto = require('crypto');
const logger = require('./logger');
const rateLimit = require('express-rate-limit');
const { createSupabaseClient, createSupabaseAdmin } = require('./supabaseUtil');
const { cookieSecure } = require('./cookies');

// Stateless server-side client (no persisted/auto-refreshed session) to avoid
// cross-request auth identity bleed. Requests pass their JWT explicitly.
const supabase = createSupabaseClient();

// Rate limiting for different endpoints
const twoFaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many 2FA attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// NOTE: a custom `csrfProtection` and a `sessionTimeout` middleware previously
// lived here. Both were exported but never used anywhere:
//   - `csrfProtection` was a second, dead CSRF implementation (the app uses the
//     `csurf` instance in server.js) that gave a false sense of protection.
//   - `sessionTimeout` read `req.session`, but express-session is not configured,
//     so it was inert.
// Removed to avoid misleading, dead security code. A single, real CSRF strategy
// applied across state-changing routes is tracked separately (audit H1).

// Enhanced authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const { user, token } = await getValidUser(req, res);
    

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    // Check for suspicious activity
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    
    // Log authentication attempt

    req.user = user;
    req.accessToken = token;
    next();
  } catch (err) {
    logger.error("Authentication error:", err);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Shared cookie attributes. `secure` is env-driven (was hardcoded true, which
// broke cookies over http in dev). Clears MUST reuse the same
// path/domain/secure/sameSite or the browser won't remove them — that mismatch
// was the bug (logout/validate cleared with different options).
function cookieBaseOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: cookieSecure(),
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

// Enhanced cookie settings
function setAuthCookies(res, accessToken, refreshToken, rememberMe) {
  const base = cookieBaseOptions();
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

  res.cookie('accessToken', accessToken, { ...base, maxAge });
  res.cookie('refreshToken', refreshToken, { ...base, maxAge });

  // Set CSRF token
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf-token', csrfToken, { ...base, maxAge: 24 * 60 * 60 * 1000 });
}

// Clear all auth cookies using the SAME attributes they were set with.
function clearAuthCookies(res) {
  const base = cookieBaseOptions();
  res.clearCookie('accessToken', base);
  res.clearCookie('refreshToken', base);
  res.clearCookie('csrf-token', base);
  res.clearCookie('mfa', base); // second-factor proof, see utils/twofa
}

// Mark this browser as having passed the second factor (admin console gate).
function setMfaProof(res, userId, rememberMe) {
  const { signMfaProof, MFA_COOKIE } = require('./twofa');
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  res.cookie(MFA_COOKIE, signMfaProof(userId, Date.now() + maxAge), { ...cookieBaseOptions(), maxAge });
}

// Enhanced user validation
async function getValidUser(req, res) {
  let token = req.cookies.accessToken || req.headers.authorization?.split(' ')[1];


  if (!token) return { user: null, token: null };

  try {
    let { data: { user }, error } = await supabase.auth.getUser(token);

    if (!user && req.cookies.refreshToken) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: req.cookies.refreshToken
      });
 
      if (refreshError || !refreshed?.session) {
        // Clear invalid tokens
        clearAuthCookies(res);
        return { user: null, token: null };
      }

      setAuthCookies(res, refreshed.session.access_token, refreshed.session.refresh_token, true);
      return {
        user: refreshed.session.user,
        token: refreshed.session.access_token
      };
    }

    return { user, token };
  } catch (error) {
    logger.error('User validation error:', error);
    return { user: null, token: null };
  }
}

// Admin routes of the legacy dashboard (products, lotteries, portfolio,
// teacher requests...). Same rule as the admin console (utils/espace):
// Users.isAdmin read with the service key, AND the signed 'mfa' cookie that
// verify-2fa sets once this browser passed the code. A Supabase JWT alone
// (obtained with the public anon key and the password) is not enough.
const checkAdmin = async (req, res, next) => {
  try {
    const { user,token} = await getValidUser(req, res);

    if (!user) {
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }

    const { data: userData, error: userError } = await createSupabaseAdmin()
      .from('Users')
      .select('isAdmin')
      .eq('userId', user.id)
      .maybeSingle();

    if (userError || userData?.isAdmin !== true) {
      return res.status(403).json({ error: 'Accès refusé : admin requis' });
    }
    const { verifyMfaProof, MFA_COOKIE } = require('./twofa');
    if (!verifyMfaProof(req.cookies && req.cookies[MFA_COOKIE], user.id)) {
      return res.status(403).json({ error: 'Double authentification requise : reconnectez-vous avec votre code 2FA.' });
    }
    req.accessToken = token;
    req.user = user;
    next();
  } catch (err) {
    logger.error("Erreur checkAdmin:", err);
    res.status(500).json({ error: "Erreur serveur lors de la vérification de l'administrateur" });
  }
};

module.exports = {
  authenticateUser,
  checkAdmin,
  setAuthCookies,
  clearAuthCookies,
  setMfaProof,
  twoFaLimiter,
  authLimiter,
  getValidUser
};