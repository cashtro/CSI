// Encryption-at-rest for TOTP (2FA) secrets.
//
// Secrets were stored in plaintext in Users_2fa.secret (audit finding). This
// wraps them with AES-256-GCM using a key derived from TOTP_ENC_KEY.
//
// Backward-compatible: decryptSecret() returns the input unchanged when it isn't
// in our encrypted format, so pre-existing plaintext secrets keep verifying and
// get re-encrypted the next time they're written. If no key is configured,
// encryptSecret() stores plaintext (degraded, logged by callers) so the app
// still boots — set TOTP_ENC_KEY in any environment that handles real secrets.

const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function getKey() {
  const raw = process.env.TOTP_ENC_KEY;
  if (!raw) return null;
  // Derive a stable 32-byte key from whatever form the env var takes.
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encryptSecret(plain) {
  if (plain == null) return plain;
  const key = getKey();
  if (!key) return plain; // no key configured -> store as-is (degraded)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptSecret(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored; // plaintext (legacy)
  const key = getKey();
  if (!key) throw new Error('TOTP_ENC_KEY is required to decrypt a stored 2FA secret');
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encryptSecret, decryptSecret, isEncrypted };
