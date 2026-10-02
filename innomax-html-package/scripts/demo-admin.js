#!/usr/bin/env node
// Local demo of the admin "Agents" tabs, for the founder.
//
//   DEMO_MODE=true node scripts/demo-admin.js
//   then open http://127.0.0.1:3999/demo/connexion (admin)
//   or http://127.0.0.1:3999/demo/client (a client, owner of the demo clinic),
//   and http://127.0.0.1:3999/robots (the public robots page)
//
// Refused when NODE_ENV=production, under PM2, or without DEMO_MODE=true
// (scripts/demo/guard.js). It runs the real routers, views, guards and agent
// engine (worker, budget, protocol) on top of:
//   - the in-memory Supabase of the tests (test/helpers/mock-supabase.js);
//   - a fake Anthropic API (scripts/demo/fake-anthropic.js): answers are
//     simulated and say so, nothing is sent anywhere, nothing is paid;
//   - an admin already signed in with the 2FA proof (/demo/connexion);
//   - a client already signed in (/demo/client) and a FAKE Stripe
//     (scripts/demo/robots.js): "Activer ce robot" ends on a simulated
//     payment, nothing is charged.
// Data lives in memory and is lost when the process stops.

const { demoAllowed } = require('./demo/guard');

const verdict = demoAllowed(process.env);
if (!verdict.ok) {
  // The logger is loaded only after the guard, so nothing else runs.
  require('../routes(api)/utils/logger').error(`[demo] ${verdict.reason}`);
  process.exit(1);
}

// Never touch a real service from the demo: drop every secret-looking
// variable this process inherited, then set the dummy ones it needs.
for (const k of Object.keys(process.env)) {
  if (/KEY|SECRET|TOKEN|PASSWORD|STRIPE|SENDGRID|SUPABASE|DATABASE_URL/i.test(k)) delete process.env[k];
}
Object.assign(process.env, {
  SUPABASE_URL: 'https://demo.invalid',
  SUPABASE_ANON_KEY: 'demo',
  SUPABASE_SERVICE_KEY: 'demo',
  ANTHROPIC_API_KEY: 'demo-fausse-cle',
  AGENTS_ENABLED: 'true',
  AGENTS_REFUSAL_FALLBACK: 'false',
  COOKIE_SECURE: 'false',
  // Throwaway key of this process only: lets the demo encrypt a website key.
  TOTP_ENC_KEY: require('crypto').randomBytes(32).toString('hex'),
  APP_URL: `http://127.0.0.1:${parseInt(process.env.DEMO_PORT, 10) || 3999}`,
});

const crypto = require('crypto');
const path = require('path');
const express = require('express');
require('express-async-errors');
const logger = require('../routes(api)/utils/logger');
const { createMockDb, sqlLikeHandlers } = require('../test/helpers/mock-supabase');

const db = createMockDb({}, sqlLikeHandlers(), {
  uuid: true,
  defaults: {
    agent_jobs: () => ({
      status: 'queued', priority: 0, attempts: 0, max_attempts: 3, run_after: new Date().toISOString(),
      cost_usd: 0, tokens_in: 0, tokens_out: 0, result: null, error: null, locked_by: null, locked_at: null, updated_at: new Date().toISOString(),
    }),
    agent_tasks: () => ({ status: 'a_valider' }),
  },
});
const sessions = {};
db.auth = {
  getUser: async (token) => ({ data: { user: sessions[token] || null }, error: null }),
  refreshSession: async () => ({ data: null, error: { message: 'démo : pas de rafraîchissement' } }),
};
db.storage = { from: () => ({ upload: async () => ({ error: { message: 'démo : envoi de fichiers désactivé' } }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) };

// Every module that asks utils/supabaseUtil for a client gets the demo db.
const supabaseUtil = require.resolve('../routes(api)/utils/supabaseUtil');
require.cache[supabaseUtil] = {
  id: supabaseUtil, filename: supabaseUtil, loaded: true,
  exports: { createSupabaseClient: () => db, createSupabaseAdmin: () => db, createSupabaseClientWithAuth: () => db },
};

// Every require('stripe') of the routes gets the fake Stripe of the demo.
const { seedRobotsDemo, createFakeStripe, CLIENT_ID } = require('./demo/robots');
const stripePath = require.resolve('stripe');
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: createFakeStripe() };

const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { cspReportOnly } = require('../routes(api)/utils/csp');
const { issueCsrfCookie } = require('../routes(api)/utils/csrf');
const { signMfaProof, MFA_COOKIE } = require('../routes(api)/utils/twofa');
const cms = require('../routes(api)/utils/cms');
const { createLLM } = require('../agents/llm');
const { createWorker } = require('../agents/worker');
const { createFakeAnthropic } = require('./demo/fake-anthropic');
const { seedDemo, ADMIN_ID } = require('./demo/data');

const PORT = parseInt(process.env.DEMO_PORT, 10) || 3999;
const HOST = '127.0.0.1';

async function main() {
  await seedDemo(db);
  seedRobotsDemo(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(compression());
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets'), { etag: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  app.use(cookieParser());
  app.use(cspReportOnly);
  app.use(issueCsrfCookie);
  app.use(express.json());
  app.use(cms.middleware);

  // Demo sign-in: an admin session with the 2FA proof, no password.
  app.get(['/', '/demo/connexion'], (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    sessions[token] = { id: ADMIN_ID, email: 'fondateur@demo.local' };
    const opts = { httpOnly: true, sameSite: 'lax', secure: false, path: '/' };
    res.cookie('accessToken', token, opts);
    res.cookie(MFA_COOKIE, signMfaProof(ADMIN_ID, Date.now() + 12 * 3600 * 1000), opts);
    res.redirect('/admin/console?vue=agents');
  });
  // Demo sign-in as a client (owner of the demo clinic), no password.
  app.get('/demo/client', (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    sessions[token] = { id: CLIENT_ID, email: 'proprio@horizon.demo' };
    res.cookie('accessToken', token, { httpOnly: true, sameSite: 'lax', secure: false, path: '/' });
    res.clearCookie(MFA_COOKIE);
    res.redirect('/espace?vue=robots');
  });
  // Fake Stripe pages: the payment is simulated, then Stripe's success_url.
  app.get('/demo/stripe/:id', (req, res) => res.redirect(`/robots/merci?session_id=${encodeURIComponent(req.params.id)}`));
  app.get('/demo/stripe-portail', (req, res) => res.type('text').send('Démo : ici s’ouvrirait le portail client de Stripe (carte, factures, annulation). Revenez à /espace?vue=robots.'));
  app.get('/login', (req, res) => res.type('text').send('Démo : ouvrez /demo/client (client) ou /demo/connexion (admin) pour vous connecter.'));
  app.post('/api/auth/logout', (req, res) => { res.clearCookie('accessToken'); res.clearCookie(MFA_COOKIE); res.json({ ok: true }); });

  app.use('/api/admin/agents', require('../routes(api)/agentsAdmin'));
  app.use('/api/admin/robots', require('../routes(api)/adminRobots'));
  app.use('/api/robots', require('../routes(api)/robotsCRUD'));
  app.use('/api/espace', require('../routes(api)/espaceCRUD'));
  app.use('/api/admin', require('../routes(api)/adminCRUD'));
  app.use(require('../routes(api)/espacePages'));
  app.use(require('../routes(api)/robotsPages'));
  app.use(require('../routes(api)/connexionsRoutes'));
  app.use((req, res) => res.status(404).type('text').send('Introuvable dans la démo.'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error('[demo]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur de la démo' });
  });

  // Three real workers on the fake API: several agents can work at once.
  const fakeFetch = createFakeAnthropic({ delayMs: parseInt(process.env.DEMO_LLM_DELAY_MS, 10) || 1500 });
  const workers = [1, 2, 3].map((n) => createWorker({
    db,
    env: process.env,
    workerId: `demo-${n}`,
    pollMs: 1500,
    llmFactory: (o) => createLLM({ ...o, fetchImpl: fakeFetch }),
  }));
  workers.forEach((w) => w.start());

  // A little life: a short order to a random production agent now and then.
  if (process.env.DEMO_AMBIENT !== 'false') {
    const asks = [
      'Résume en 5 points la page Services de pandorabrains.com.',
      'Propose 3 titres d’infolettre pour octobre.',
      'Liste les questions à poser à un nouveau client PME.',
      'Écris un court message LinkedIn sur le Conseil des agents.',
      'Prépare la liste des vérifications Loi 25 avant une mise en ligne.',
    ];
    const timer = setInterval(() => {
      const pool = db.tables.agents.filter((a) => a.active !== false && a.status !== 'working' && !['planif', 'contra', 'revue'].includes(a.team));
      const a = pool[Math.floor(Math.random() * pool.length)];
      if (!a) return;
      db.from('agent_jobs').insert({ kind: 'order', payload: { agent_id: a.id, instruction: asks[Math.floor(Math.random() * asks.length)] }, created_by: ADMIN_ID })
        .select('id').single()
        .then(({ data }) => db.from('agent_activity').insert({ job_id: data.id, agent_id: a.id, kind: 'job_queued', message: 'Ordre mis en file (démo automatique)' }));
    }, parseInt(process.env.DEMO_AMBIENT_MS, 10) || 25000);
    timer.unref();
  }

  const server = app.listen(PORT, HOST, () => {
    logger.info(`[demo] Démo prête : http://${HOST}:${PORT}/demo/connexion (admin), /demo/client (client), /robots (vitrine). Données en mémoire, réponses et paiements simulés.`);
  });
  const stop = async () => {
    await Promise.all(workers.map((w) => w.stop().catch(() => {})));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  logger.error('[demo] démarrage impossible :', err.message);
  process.exit(1);
});
