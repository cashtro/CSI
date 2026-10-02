// Second-factor policy shared by every sign-in path (password, OAuth).
//
// - An account with an enabled 2FA row is always challenged for a code.
// - An account with no 2FA row is asked to set one up.
// - An account whose 2FA was turned off signs in without a code, unless it is
//   an admin or a teacher: privileged accounts must always have 2FA.
//
// Setup secrets are minted by the server and bound to the temp session with an
// HMAC "setup token", so verify-2fa never trusts a secret the client invents.
// A token minted for "rotate" (current code proven) may replace an enabled
// secret; a token minted for "new" may not.

const crypto = require('crypto');
const logger = require('./logger');

let ephemeralKey;

function setupKey() {
  const raw = process.env.TWOFA_SETUP_KEY || process.env.TOTP_ENC_KEY;
  if (raw) return crypto.createHash('sha256').update(`twofa-setup:${raw}`).digest();
  if (!ephemeralKey) {
    // Tokens then only survive inside this process (fine for a single PM2 fork).
    logger.warn('TWOFA_SETUP_KEY/TOTP_ENC_KEY not set: 2FA setup tokens use a per-process key.');
    ephemeralKey = crypto.randomBytes(32);
  }
  return ephemeralKey;
}

function signSetup(tempSessionId, secret, mode) {
  return crypto.createHmac('sha256', setupKey()).update(`${mode}:${tempSessionId}:${secret}`).digest('hex');
}

// Returns "new", "rotate", or null when the token does not match.
function setupMode(tempSessionId, secret, token) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const got = Buffer.from(token, 'hex');
  for (const mode of ['new', 'rotate']) {
    const want = Buffer.from(signSetup(tempSessionId, secret, mode), 'hex');
    if (crypto.timingSafeEqual(want, got)) return mode;
  }
  return null;
}

async function get2fa(admin, userId) {
  const { data, error } = await admin
    .from('Users_2fa')
    .select('enabled, secret')
    .eq('userId', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function isPrivileged(admin, userId) {
  const { data, error } = await admin
    .from('Users')
    .select('isAdmin, isTeacher')
    .eq('userId', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return Boolean(data && (data.isAdmin || data.isTeacher));
}

// What a freshly authenticated user must do next: "challenge", "setup" or "none".
async function secondFactorStep(admin, userId) {
  const row = await get2fa(admin, userId);
  if (row && row.enabled) return 'challenge';
  if (!row) return 'setup';
  return (await isPrivileged(admin, userId)) ? 'setup' : 'none';
}

// Proof that THIS browser passed the second factor. A Supabase JWT alone does
// not prove it: anyone with the public anon key can sign in to Supabase
// directly and paste the token into a cookie. verify-2fa sets this cookie
// (httpOnly, signed with the server key), and the admin console requires it.
const MFA_COOKIE = 'mfa';

function signMfaProof(userId, expiresAt) {
  const mac = crypto.createHmac('sha256', setupKey()).update(`mfa:${userId}:${expiresAt}`).digest('hex');
  return `${expiresAt}.${mac}`;
}

function verifyMfaProof(value, userId, now = Date.now()) {
  if (typeof value !== 'string' || !userId) return false;
  const match = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(value);
  if (!match || Number(match[1]) < now) return false;
  const want = Buffer.from(signMfaProof(userId, match[1]).split('.')[1], 'hex');
  return crypto.timingSafeEqual(want, Buffer.from(match[2], 'hex'));
}

module.exports = {
  signSetup, setupMode, get2fa, isPrivileged, secondFactorStep,
  MFA_COOKIE, signMfaProof, verifyMfaProof,
};
