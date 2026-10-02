// Central environment validation + boot-safety.
const logger = require('./logger');
//
// Several modules build SDK clients at import time
// (`require('stripe')(KEY)`, `createClient(URL, KEY)`), which THROW when the
// credential is missing — crashing the whole server at startup. This module
// runs before any route is required and:
//   1. reports every missing required var with a clear, single warning, and
//   2. installs obviously-invalid sentinel values so the SDK constructors do
//      not throw. The app then boots in a clearly DEGRADED mode: pages render,
//      but any live Supabase/Stripe call fails loudly instead of silently.
//
// Real credentials come from Cloud Agent Secrets or a root-level .env.

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLIC_KEY',
  'APP_URL',
];

const missingEnv = REQUIRED.filter((key) => !process.env[key]);

// Not fatal, but the site is unsafe or partly broken without them, so the
// boot log says so on every start:
//   STRIPE_WEBHOOK_SECRET  without it /webhook answers 503 and a payment whose
//                          buyer closes the tab is never fulfilled;
//   TOTP_ENC_KEY           2FA secrets stored in clear, and the 2FA proof
//                          (mfa cookie) changes at every restart;
//   SENDGRID_API_KEY / SENDGRID_EMAIL / OWNER_EMAIL  order e-mails are lost.
const RECOMMENDED = ['STRIPE_WEBHOOK_SECRET', 'TOTP_ENC_KEY', 'SENDGRID_API_KEY', 'SENDGRID_EMAIL', 'OWNER_EMAIL'];
const missingRecommended = RECOMMENDED.filter((key) => !process.env[key]);

// Settings that weaken security when set this way in production.
const warnings = [];
if (process.env.COOKIE_SECURE === 'false') warnings.push('COOKIE_SECURE=false: auth cookies are sent over plain http.');
if (process.env.APP_URL && !/^https:\/\//.test(process.env.APP_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(process.env.APP_URL)) {
  warnings.push('APP_URL is not https: Stripe and e-mail links will use plain http.');
}
if (process.env.CSRF_ENFORCE !== 'true') warnings.push('CSRF_ENFORCE is not "true": the CSRF check on legacy /api routes is off.');

// Non-throwing sentinels for the vars consumed by SDK constructors at import
// time. They are deliberately invalid so a real network call fails clearly.
const SENTINELS = {
  SUPABASE_URL: 'https://missing-config.invalid',
  SUPABASE_ANON_KEY: 'missing-anon-key',
  SUPABASE_SERVICE_KEY: 'missing-service-key',
  STRIPE_SECRET_KEY: 'sk_test_missing_config',
};

for (const [key, sentinel] of Object.entries(SENTINELS)) {
  if (!process.env[key]) process.env[key] = sentinel;
}

// Production runs with NODE_ENV=development (see README), so NODE_ENV cannot
// tell a live site from a laptop. Degraded boot is therefore opt-in: without
// ALLOW_DEGRADED_BOOT=true a missing credential stops the server instead of
// serving a site whose logins and payments all fail.
const allowDegraded = process.env.ALLOW_DEGRADED_BOOT === 'true' || process.env.NODE_ENV === 'test';

if (missingEnv.length > 0 && !allowDegraded) {
  logger.error(
    `[config] Missing required env vars: ${missingEnv.join(', ')}. ` +
      'Refusing to start. Set them in .env, or set ALLOW_DEGRADED_BOOT=true for local/CI runs.'
  );
  process.exit(1);
}

if (missingEnv.length > 0) {
  logger.warn(
    `[config] Missing required env vars: ${missingEnv.join(', ')}. ` +
      'Booting in DEGRADED mode — pages render, but live Supabase/Stripe/SendGrid ' +
      'calls will fail. Set these via Cloud Agent Secrets or a root-level .env.'
  );
}

if (missingRecommended.length > 0 && process.env.NODE_ENV !== 'test') {
  logger.warn(`[config] Recommended env vars not set: ${missingRecommended.join(', ')} (see AUDIT-PLATEFORME.md).`);
}
if (process.env.NODE_ENV !== 'test') for (const w of warnings) logger.warn(`[config] ${w}`);

module.exports = {
  REQUIRED,
  RECOMMENDED,
  missingEnv,
  missingRecommended,
  warnings,
  isDegraded: missingEnv.length > 0,
};
