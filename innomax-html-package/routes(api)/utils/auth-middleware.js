const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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

// CSRF Protection
const csrfProtection = (req, res, next) => {
  const csrfToken = req.headers['x-csrf-token'];
  const sessionToken = req.cookies['csrf-token'];

  if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
};

// Session timeout middleware
const sessionTimeout = (req, res, next) => {
  const sessionAge = Date.now() - (req.session?.timestamp || 0);
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  if (sessionAge > maxAge) {
    return res.status(401).json({ error: 'Session expired' });
  }
  next();
};

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
    console.error("Authentication error:", err);
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
    secure: process.env.NODE_ENV === 'production',
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
    console.error('User validation error:', error);
    return { user: null, token: null };
  }
}

const checkAdmin = async (req, res, next) => {
  try {
    const { user,token} = await getValidUser(req, res);

    if (!user) {
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }

    const { data: userData, error: userError } = await supabase
      .from('Users')
      .select('isAdmin')
      .eq('userId', user.id)
      .single();

    if (userError || !userData?.isAdmin) {
      return res.status(403).json({ error: 'Accès refusé : admin requis' });
    }
    req.accessToken = token;
    req.user = user;
    next();
  } catch (err) {
    console.error("Erreur checkAdmin:", err);
    res.status(500).json({ error: "Erreur serveur lors de la vérification de l'administrateur" });
  }
};

module.exports = {
  authenticateUser,
  checkAdmin,
  setAuthCookies,
  clearAuthCookies,
  twoFaLimiter,
  authLimiter,
  csrfProtection,
  sessionTimeout,
  getValidUser
};