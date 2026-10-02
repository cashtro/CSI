// Client API of the robots (/api/robots, ROBOTS.md).
//
//   POST /api/robots/:slug/activer          Stripe Checkout (subscription) for a robot
//   POST /api/robots/portail                Stripe billing portal (card, invoices)
//   POST /api/robots/actifs/:id/annuler     billing portal, straight on the cancellation
//   POST /api/robots/actifs/:id/pause       pause or resume (pause_collection)
//   POST /api/robots/actifs/:id/taches      give the robot a task (an agent job)
//   PUT  /api/robots/actifs/:id/consignes   standing instructions of the robot
//
// The company always comes from the server-side membership lookup. Billing
// (activation, portal, pause, cancel) is for the company's owner; any member
// may give tasks. Every write needs the CSRF header; activation and tasks are
// rate limited. A task's result becomes a deliverable that PBTM validates
// before the client sees it (agents/robots.js).

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { requireCsrf } = require('./utils/csrf');
const { getValidUser } = require('./utils/auth-middleware');
const { getMembership, noStore, isUuid, text } = require('./utils/espace');
const robots = require('./utils/robots');
const robotsStripe = require('./utils/robotsStripe');
const { jobPourTache } = require('../agents/robots');
const store = require('../agents/store');

const router = express.Router();
router.use(noStore, requireCsrf);

const limiter = (max, windowMs, message) => rateLimit({
  windowMs, max, message: { error: message }, standardHeaders: true, legacyHeaders: false,
  // Per account once signed in (the guard below runs first), else per IP.
  keyGenerator: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`),
});
const activationLimiter = limiter(10, 10 * 60 * 1000, 'Trop de tentatives d’activation, réessayez dans quelques minutes.');
const tacheLimiter = limiter(10, 60 * 1000, 'Trop de tâches d’un coup, réessayez dans une minute.');

// Signed-in user (no company required) and their membership, if any.
async function signedIn(req, res, next) {
  const { user } = await getValidUser(req, res);
  if (!user) return res.status(401).json({ error: 'Connexion requise.' });
  req.user = user;
  req.membership = await getMembership(createSupabaseAdmin(), user.id);
  next();
}

function member(req, res, next) {
  if (!req.membership) return res.status(403).json({ error: "Votre compte n'est rattaché à aucune entreprise." });
  next();
}

const PROPRIO = 'Seul le propriétaire du compte de l’entreprise peut gérer la facturation des robots.';
function owner(req, res, next) {
  if (!req.membership) return res.status(403).json({ error: "Votre compte n'est rattaché à aucune entreprise." });
  if (req.membership.role !== 'proprietaire') return res.status(403).json({ error: PROPRIO });
  next();
}

// The robots_actifs row :id, only within the caller's company (another
// company's row looks exactly like a missing one).
async function loadActif(req, res, next) {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Robot introuvable.' });
  const { data, error } = await createSupabaseAdmin()
    .from('robots_actifs').select('*').eq('id', req.params.id).eq('entreprise_id', req.membership.entreprise_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return res.status(404).json({ error: 'Robot introuvable.' });
  req.actif = data;
  next();
}

const stripeFailed = (res, what, err) => {
  logger.error(`[robots] stripe ${what} failed:`, err && err.message);
  return res.status(502).json({ error: 'Le paiement n’a pas pu être préparé. Réessayez dans un instant.' });
};

// ------------------------------------------------------------ activation

router.post('/:slug/activer', signedIn, activationLimiter, async (req, res) => {
  const admin = createSupabaseAdmin();
  let offre;
  try {
    offre = await robots.getOffre(admin, req.params.slug);
  } catch (err) {
    logger.error('[robots] offer lookup failed:', err.message);
    return res.status(503).json({ error: 'Le catalogue des robots est indisponible (db/006_robots.sql).' });
  }
  if (!offre) return res.status(404).json({ error: 'Robot introuvable.' });

  let entrepriseId;
  if (req.membership) {
    if (req.membership.role !== 'proprietaire') return res.status(403).json({ error: PROPRIO });
    entrepriseId = req.membership.entreprise_id;
    const { data: deja, error } = await admin.from('robots_actifs').select('id, statut').eq('entreprise_id', entrepriseId).eq('robot', offre.slug);
    if (error) throw new Error(error.message);
    if ((deja || []).some((r) => r.statut !== 'annule')) {
      return res.status(409).json({ error: 'Ce robot est déjà actif pour votre entreprise.', url: '/espace?vue=robots' });
    }
  } else {
    // First robot of a new client: the company is created with the caller as
    // its owner (self-serve), then billed.
    const nom = text(req.body && req.body.entreprise_nom, 200);
    if (!nom) return res.status(400).json({ error: 'Indiquez le nom de votre entreprise.' });
    const { data: ent, error } = await admin.from('entreprises').insert({ nom, courriel: req.user.email || null, created_by: req.user.id }).select('id').single();
    if (error) {
      logger.error('[robots] entreprise insert failed:', error.message);
      return res.status(500).json({ error: "L'entreprise n'a pas pu être créée." });
    }
    const { error: memberError } = await admin.from('membres').insert({ entreprise_id: ent.id, user_id: req.user.id, role: 'proprietaire' });
    if (memberError) {
      await admin.from('entreprises').delete().eq('id', ent.id);
      if (memberError.code === '23505') return res.status(409).json({ error: 'Votre compte vient d’être rattaché à une entreprise : rechargez la page.' });
      logger.error('[robots] membre insert failed:', memberError.message);
      return res.status(500).json({ error: "L'entreprise n'a pas pu être créée." });
    }
    entrepriseId = ent.id;
    logger.info(`[robots] entreprise ${ent.id} created by ${req.user.id} (self-serve)`);
  }

  let session;
  try {
    session = await robotsStripe.createCheckout({ offre, entrepriseId, user: req.user });
  } catch (err) {
    return stripeFailed(res, 'checkout', err);
  }
  logger.info(`[robots] checkout ${session.id} for robot ${offre.slug}, entreprise ${entrepriseId}`);
  res.status(201).json({ url: session.url, id: session.id });
});

// ------------------------------------------------------------ billing

router.post('/portail', signedIn, owner, async (req, res) => {
  const { data, error } = await createSupabaseAdmin()
    .from('robots_actifs').select('stripe_customer_id').eq('entreprise_id', req.membership.entreprise_id);
  if (error) throw new Error(error.message);
  const customer = (data || []).map((r) => r.stripe_customer_id).find(Boolean);
  if (!customer) return res.status(404).json({ error: 'Aucun abonnement Stripe pour votre entreprise.' });
  try {
    const portal = await robotsStripe.createPortal({ customerId: customer });
    res.json({ url: portal.url });
  } catch (err) {
    stripeFailed(res, 'portal', err);
  }
});

router.post('/actifs/:id/annuler', signedIn, owner, loadActif, async (req, res) => {
  const a = req.actif;
  if (a.statut === 'annule') return res.status(409).json({ error: 'Ce robot est déjà annulé.' });
  if (!a.stripe_customer_id || !a.stripe_subscription_id) return res.status(409).json({ error: 'Abonnement Stripe introuvable : écrivez-nous.' });
  try {
    const portal = await robotsStripe.createPortal({ customerId: a.stripe_customer_id, subscriptionId: a.stripe_subscription_id });
    res.json({ url: portal.url });
  } catch (err) {
    stripeFailed(res, 'portal cancel', err);
  }
});

router.post('/actifs/:id/pause', signedIn, owner, loadActif, async (req, res) => {
  const a = req.actif;
  const pause = !(req.body && (req.body.pause === false || req.body.pause === 'false'));
  if (a.statut === 'annule') return res.status(409).json({ error: 'Ce robot est annulé.' });
  if (pause === (a.statut === 'en_pause')) return res.status(409).json({ error: pause ? 'Ce robot est déjà en pause.' : 'Ce robot est déjà actif.' });
  if (!a.stripe_subscription_id) return res.status(409).json({ error: 'Abonnement Stripe introuvable : écrivez-nous.' });
  try {
    await robotsStripe.setPause(a.stripe_subscription_id, pause);
  } catch (err) {
    return stripeFailed(res, 'pause', err);
  }
  const statut = pause ? 'en_pause' : 'actif';
  // The webhook confirms; the page shows the new state right away.
  const { error } = await createSupabaseAdmin().from('robots_actifs').update({ statut, updated_at: new Date().toISOString() })
    .eq('id', a.id).eq('statut', a.statut);
  if (error) logger.error('[robots] local pause update failed:', error.message);
  logger.info(`[robots] robot ${a.id} ${statut} by ${req.user.id}`);
  res.json({ statut });
});

// ------------------------------------------------------------ work

router.post('/actifs/:id/taches', signedIn, member, tacheLimiter, loadActif, async (req, res) => {
  const a = req.actif;
  const demande = text(req.body && req.body.instruction, 4000);
  if (!demande) return res.status(400).json({ error: 'Décrivez la tâche à confier au robot.' });
  if (a.statut !== 'actif') return res.status(409).json({ error: a.statut === 'en_pause' ? 'Ce robot est en pause : réactivez-le pour lui donner une tâche.' : 'Ce robot est annulé.' });
  const admin = createSupabaseAdmin();
  const offre = await robots.getOffre(admin, a.robot, { actifSeulement: false });
  if (!offre) return res.status(409).json({ error: 'Ce robot n’existe plus au catalogue : écrivez-nous.' });
  const utilisees = await robots.tachesDuMois(admin, a.entreprise_id, a.robot);
  if (utilisees >= offre.quota_taches_mois) {
    return res.status(429).json({ error: `Quota du mois atteint (${offre.quota_taches_mois} tâches). Il repart à zéro le 1er du mois.` });
  }
  const { data: ent } = await admin.from('entreprises').select('nom').eq('id', a.entreprise_id).maybeSingle();
  const { kind, payload } = jobPourTache({ offre, demande, entreprise: ent ? ent.nom : null, consignes: a.reglages && a.reglages.consignes });
  const { data, error } = await admin.from('agent_jobs')
    .insert({ kind, payload, status: 'queued', priority: 0, entreprise_id: a.entreprise_id, robot: a.robot, created_by: req.user.id })
    .select('id, status, created_at')
    .single();
  if (error) {
    logger.error('[robots] job insert failed:', error.message);
    return res.status(500).json({ error: "La tâche n'a pas pu être enregistrée." });
  }
  await store.logActivity(admin, { job_id: data.id, agent_id: payload.agent_id || null, kind: 'job_queued', message: `Tâche du robot ${offre.nom} mise en file` });
  logger.info(`[robots] task ${data.id} for robot ${a.robot}, entreprise ${a.entreprise_id}`);
  res.status(201).json({ id: data.id, restantes: Math.max(0, offre.quota_taches_mois - utilisees - 1) });
});

router.put('/actifs/:id/consignes', signedIn, member, loadActif, async (req, res) => {
  const consignes = text(req.body && req.body.consignes, 2000);
  const reglages = { ...(req.actif.reglages || {}), consignes };
  const { error } = await createSupabaseAdmin().from('robots_actifs').update({ reglages, updated_at: new Date().toISOString() }).eq('id', req.actif.id);
  if (error) {
    logger.error('[robots] consignes update failed:', error.message);
    return res.status(500).json({ error: 'Les consignes n’ont pas pu être enregistrées.' });
  }
  res.json({ ok: true });
});

module.exports = router;
