// Vitrine publique de PBTM (PWA.md).
//
//   GET /                 la nouvelle page d'accueil (views/accueil.ejs)
//   GET /ancien-accueil   l'ancienne (home4), gardée pour référence, non indexée
//
// Monter après cms.middleware, seo.middleware et le middleware de pwaRoutes.
const express = require('express');
const logger = require('./utils/logger');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { fmt } = require('./utils/espace');
const vitrine = require('./utils/vitrine');

const router = express.Router();

router.get('/', async (req, res) => {
  const v = await vitrine.charger(createSupabaseAdmin(), res.locals.content);
  // La page dépend du rôle (sélecteur Vitrine / Cockpit) : pas de cache partagé.
  res.set('Cache-Control', 'no-cache');
  res.vary('Cookie');
  res.render('accueil', { vitrine: v, fmt, currentPage: '/' });
});

router.get('/ancien-accueil', async (req, res) => {
  const admin = createSupabaseAdmin();
  let courses = [];
  let lotteries = [];
  try {
    const { data } = await admin.from('cours').select('*').order('created_at', { ascending: false }).limit(3);
    courses = data || [];
    const { data: draws } = await admin.from('Lottery').select('*').gt('lotteryTime', new Date().toISOString()).order('created_at', { ascending: true }).limit(3);
    lotteries = draws || [];
  } catch (err) {
    logger.error('[vitrine] ancien accueil :', err.message);
  }
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.render('home4', { currentPage: '/', courses, lotteries, pixelId: res.locals.pixelId || '' });
});

module.exports = router;
