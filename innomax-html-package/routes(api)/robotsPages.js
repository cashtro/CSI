// Public pages of the robots (ROBOTS.md).
//
//   GET /robots                 the shop window, open to everyone
//   GET /robots/:slug/activer   activation: sign in (or sign up) first, then
//                               confirm and go to Stripe Checkout
//   GET /robots/merci           Stripe's success_url: confirms the session with
//                               Stripe (idempotent, like the webhook) and opens
//                               the client's robots
//
// Data are printed escaped by EJS; the forms are sent by assets/js/espace.js.

const express = require('express');
const logger = require('./utils/logger');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { getValidUser } = require('./utils/auth-middleware');
const { getMembership, noStore, fmt } = require('./utils/espace');
const robots = require('./utils/robots');
const robotsStripe = require('./utils/robotsStripe');
const { fulfillCheckoutSession } = require('./utils/fulfill');

const router = express.Router();

router.get('/robots', async (req, res) => {
  const { offres } = await robots.loadCatalogue(createSupabaseAdmin());
  res.set('Cache-Control', 'no-cache');
  res.render('robots', {
    offres,
    fmt,
    annule: typeof req.query.annule === 'string' && robots.SLUG.test(req.query.annule) ? req.query.annule : null,
  });
});

router.get('/robots/merci', noStore, async (req, res) => {
  const id = typeof req.query.session_id === 'string' && /^cs_[A-Za-z0-9_]{6,200}$/.test(req.query.session_id) ? req.query.session_id : null;
  if (!id) return res.redirect('/espace?vue=robots');
  try {
    const session = await robotsStripe.retrieveCheckout(id);
    if (session && session.metadata && session.metadata.type === 'robot') {
      const result = await fulfillCheckoutSession(session);
      logger.info(`[robots] success_url ${id}: ${result.status}`);
      const slug = robots.SLUG.test(String(session.metadata.robot)) ? session.metadata.robot : '';
      return res.redirect(`/espace?vue=robots&bienvenue=${encodeURIComponent(slug)}`);
    }
  } catch (err) {
    // The webhook will finish the job; the client sees the robot shortly.
    logger.error('[robots] success_url confirmation failed:', err.message);
  }
  res.redirect('/espace?vue=robots&bienvenue=1');
});

router.get('/robots/:slug/activer', noStore, async (req, res) => {
  const admin = createSupabaseAdmin();
  let offre = null;
  try {
    offre = await robots.getOffre(admin, req.params.slug);
  } catch (err) {
    logger.warn('[robots] offer lookup failed:', err.message);
  }
  if (!offre) return res.status(404).render('404', { currentPage: req.originalUrl });
  const { user } = await getValidUser(req, res);
  if (!user) return res.redirect(`/login?next=${encodeURIComponent(`/robots/${offre.slug}/activer`)}`);
  const membership = await getMembership(admin, user.id);
  let deja = false;
  if (membership) {
    const { data } = await admin.from('robots_actifs').select('statut').eq('entreprise_id', membership.entreprise_id).eq('robot', offre.slug);
    deja = (data || []).some((r) => r.statut !== 'annule');
  }
  res.render('robot-activer', { offre, fmt, email: user.email || '', membership, deja });
});

module.exports = router;
