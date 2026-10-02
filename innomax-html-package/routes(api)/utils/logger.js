// Minimal, dependency-free structured logger.
//
// - Level-gated via LOG_LEVEL (error < warn < info < debug; default "info").
// - Each line is timestamped and tagged with its level.
// - `redact()` scrubs obvious secret/PII fields before you log an object, so
//   tokens/passwords/emails don't leak into logs (an audit finding).
//
// Mirrors the console API (info/warn/error/debug) so it's a drop-in replacement.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configured = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[configured] !== undefined ? LEVELS[configured] : LEVELS.info;

const SECRET_KEY = /(token|secret|password|authorization|api[-_]?key|access_token|refresh_token|email)/i;

function redact(value, depth = 0) {
  if (value == null || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function emit(level, args) {
  if (LEVELS[level] > threshold) return;
  const prefix = `${new Date().toISOString()} [${level.toUpperCase()}]`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(prefix, ...args);
}

module.exports = {
  error: (...args) => emit('error', args),
  warn: (...args) => emit('warn', args),
  info: (...args) => emit('info', args),
  debug: (...args) => emit('debug', args),
  redact,
  _threshold: threshold,
};
