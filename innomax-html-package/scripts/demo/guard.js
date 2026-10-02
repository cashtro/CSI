// The local demo (scripts/demo-admin.js) fakes Supabase and signs in an admin
// with 2FA without a password. It must never run in production: it starts
// only when DEMO_MODE is exactly "true" AND NODE_ENV is not "production".
// Nothing in server.js loads the demo.
//
// Production at Pandora runs with NODE_ENV=development (see README), so the
// guard also refuses under PM2 (pm_id set), which is how the site runs. The
// demo never reads .env, wipes every secret-looking variable from its own
// process, fakes Supabase and Anthropic, and listens on 127.0.0.1 only.

function demoAllowed(env = process.env) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return { ok: false, reason: 'Mode démo refusé : NODE_ENV=production. La démo ne tourne jamais en production.' };
  }
  if (env.pm_id !== undefined) {
    return { ok: false, reason: 'Mode démo refusé sous PM2 : la démo se lance à la main, sur un poste de développement.' };
  }
  if (env.DEMO_MODE !== 'true') {
    return { ok: false, reason: 'Mode démo refusé : lancez avec DEMO_MODE=true (et jamais en production).' };
  }
  return { ok: true, reason: null };
}

module.exports = { demoAllowed };
