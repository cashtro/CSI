// Routes de la PWA (PWA.md).
//
//   GET  /manifest.webmanifest   le manifeste (couleurs du BLOC MARQUE)
//   GET  /sw.js                  le service worker, jamais mis en cache longtemps
//   GET  /hors-ligne             page affichée hors ligne (gardée par le SW)
//   GET  /connexion-requise      page affichée hors ligne pour une page privée
//   GET  /api/push/etat          notifications actives ? clé publique VAPID
//   POST /api/push/abonnement    enregistre l'abonnement du navigateur (CSRF)
//   POST /api/push/desabonnement retire un abonnement (CSRF)
//   POST /api/push/test          envoie une notification d'essai à soi-même (CSRF)
//
// middleware : res.locals.pwaCouleurs et res.locals.pwaRole ('admin' avec la
// 2FA, 'client' connecté, null visiteur) pour le sélecteur Vitrine / Cockpit.
const express = require('express');
const pwa = require('./utils/pwa');
const webpush = require('./utils/webpush');
const notifications = require('./utils/notifications');
const logger = require('./utils/logger');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { getValidUser } = require('./utils/auth-middleware');
const { getMembership, noStore } = require('./utils/espace');
const { verifyMfaProof, MFA_COOKIE } = require('./utils/twofa');
const { requireCsrf } = require('./utils/csrf');

const router = express.Router();

let couleursMemo = null;
const couleurs = () => (couleursMemo = couleursMemo || pwa.couleurs());

// Rôle du visiteur. Aucune requête à la base sans cookie de session.
async function roleDe(req, res) {
  if (!req.cookies || !req.cookies.accessToken) return { role: null, user: null };
  const { user } = await getValidUser(req, res);
  if (!user) return { role: null, user: null };
  const admin = createSupabaseAdmin();
  const { data } = await admin.from('Users').select('isAdmin').eq('userId', user.id).maybeSingle();
  if (data && data.isAdmin === true && verifyMfaProof(req.cookies[MFA_COOKIE], user.id)) return { role: 'admin', user, admin };
  let membership = null;
  try {
    membership = await getMembership(admin, user.id);
  } catch {
    membership = null;
  }
  return { role: 'client', user, membership, admin };
}

// Pages où le rôle est déjà connu (elles le passent elles-mêmes à la vue).
const SANS_ROLE = /^\/(api|assets|admin|espace|connexions|demo|sw\.js|manifest\.webmanifest|hors-ligne|connexion-requise)(\/|$)/i;

async function middleware(req, res, next) {
  res.locals.pwaCouleurs = couleurs();
  if (req.method !== 'GET' || SANS_ROLE.test(req.path)) return next();
  try {
    res.locals.pwaRole = (await roleDe(req, res)).role;
  } catch (err) {
    logger.warn('[pwa] rôle illisible :', err.message);
    res.locals.pwaRole = null;
  }
  next();
}

router.get('/manifest.webmanifest', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/manifest+json').send(JSON.stringify(pwa.manifeste(couleurs())));
});

router.get('/sw.js', (req, res) => {
  const sw = pwa.serviceWorker();
  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-cache, max-age=0',
    'Service-Worker-Allowed': '/',
    'X-PBTM-SW-Version': sw.version,
  });
  res.send(sw.source);
});

// Les pages hors ligne ne montrent rien de personnel : elles sont gardées par
// le service worker, téléchargées sans cookie.
router.get('/hors-ligne', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.render('hors-ligne', { pwaCouleurs: couleurs(), pwaRole: null });
});
router.get('/connexion-requise', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.render('connexion-requise', { pwaCouleurs: couleurs(), pwaRole: null });
});

// ------------------------------------------------------------------ push

const api = express.Router();
api.use(noStore);

api.get('/etat', (req, res) => {
  const cfg = webpush.config();
  res.json({ actif: Boolean(cfg), cle: cfg ? cfg.cle : null });
});

api.use(requireCsrf);

// Connexion requise pour tout le reste.
api.use(async (req, res, next) => {
  const qui = await roleDe(req, res);
  if (!qui.user) return res.status(401).json({ error: 'Connexion requise.' });
  req.pwa = qui;
  next();
});

const B64U = /^[A-Za-z0-9_-]+$/;
function lireAbonnement(body) {
  const b = body || {};
  const keys = b.keys || {};
  if (!webpush.endpointPermis(b.endpoint)) return { error: 'Service de notifications non reconnu.' };
  const p = typeof keys.p256dh === 'string' && B64U.test(keys.p256dh) ? webpush.deB64u(keys.p256dh) : null;
  const a = typeof keys.auth === 'string' && B64U.test(keys.auth) ? webpush.deB64u(keys.auth) : null;
  if (!p || p.length !== 65 || p[0] !== 4 || !a || a.length !== 16) return { error: 'Clés de l’abonnement invalides.' };
  return { abonnement: { endpoint: b.endpoint, p256dh: keys.p256dh, auth: keys.auth } };
}

const DESACTIVE = 'Notifications désactivées : les clés VAPID ne sont pas configurées sur le serveur (voir PWA.md).';

api.post('/abonnement', async (req, res) => {
  if (!webpush.actif()) return res.status(503).json({ error: DESACTIVE, actif: false });
  const { abonnement, error } = lireAbonnement(req.body);
  if (error) return res.status(400).json({ error });
  const { role, user, membership, admin } = req.pwa;
  if (role !== 'admin' && !membership) return res.status(403).json({ error: 'Votre compte n’est rattaché à aucune entreprise : rien à vous signaler pour l’instant.' });
  const ligne = {
    ...abonnement,
    user_id: user.id,
    role,
    entreprise_id: role === 'admin' ? null : membership.entreprise_id,
    user_agent: String(req.get('user-agent') || '').slice(0, 300) || null,
  };
  const { error: dbError } = await admin.from(notifications.TABLE).upsert(ligne, { onConflict: 'endpoint' });
  if (dbError) {
    logger.error('[push] abonnement non enregistré :', dbError.message);
    return res.status(500).json({ error: 'Abonnement non enregistré. La table push_abonnements existe-t-elle (db/009_pwa.sql) ?' });
  }
  logger.info(`[push] abonnement ${role} enregistré pour ${user.id}`);
  res.status(201).json({ ok: true, role });
});

api.post('/desabonnement', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 2000) return res.status(400).json({ error: 'Abonnement invalide.' });
  const { error } = await req.pwa.admin.from(notifications.TABLE).delete().eq('endpoint', endpoint).eq('user_id', req.pwa.user.id);
  if (error) return res.status(500).json({ error: 'Désabonnement impossible.' });
  res.json({ ok: true });
});

api.post('/test', async (req, res) => {
  if (!webpush.actif()) return res.json({ actif: false, envoye: 0, message: DESACTIVE });
  const r = await notifications.versUtilisateur(req.pwa.admin, req.pwa.user.id, {
    title: '🔔 Notifications de PBTM', body: 'Ça marche : vous recevrez les prochaines alertes ici.', url: req.pwa.role === 'admin' ? '/admin/console' : '/espace', tag: 'test',
  });
  res.json({ actif: true, envoye: r.envoye, message: r.envoye ? 'Notification envoyée.' : 'Aucun abonnement actif sur ce compte.' });
});

router.use('/api/push', api);

module.exports = router;
module.exports.middleware = middleware;
module.exports.roleDe = roleDe;
module.exports.DESACTIVE = DESACTIVE;
