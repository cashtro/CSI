// Server-rendered pages of the client space (/espace) and the admin console
// (/admin/console). Data is loaded here and printed escaped by EJS; the
// browser script (assets/js/espace.js) only sends actions to /api/espace and
// /api/admin, then reloads.
const express = require('express');
const cms = require('./utils/cms');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { requireMember, requireAdmin, noStore, loadEspace, loadAdmin, fmt, ETAPES, STATUTS_MANDAT } = require('./utils/espace');

const router = express.Router();

// Voice dictation (assets/js/dictee.js) needs the microphone. helmet 7 sends
// no Permissions-Policy, so browsers already allow it for the page's own
// origin; say so explicitly on these two pages only, and keep the camera and
// location off.
function allowMicrophone(req, res, next) {
  res.set('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  next();
}

const ADMIN_VUES = ['apercu', 'entreprises', 'clients', 'paiements', 'mandats', 'livrables', 'cms'];
const CLIENT_VUES = ['apercu', 'mandats', 'livrables', 'achats', 'nouveau'];

router.get('/espace', noStore, allowMicrophone, requireMember({ page: true }), async (req, res) => {
  const vue = CLIENT_VUES.includes(req.query.vue) ? req.query.vue : 'apercu';
  const data = req.membership ? await loadEspace(createSupabaseAdmin(), req.membership.entreprise_id) : null;
  res.render('espace-client', { vue, data, fmt, etapes: ETAPES, email: req.user.email || '' });
});

router.get('/admin/console', noStore, allowMicrophone, requireAdmin({ page: true }), async (req, res) => {
  const vue = ADMIN_VUES.includes(req.query.vue) ? req.query.vue : 'apercu';
  const admin = createSupabaseAdmin();
  const data = await loadAdmin(admin);
  let site = { zones: [], extra: [] };
  let cmsError = null;
  try {
    site = await cms.listForAdmin(admin);
  } catch (err) {
    cmsError = 'La table site_content est introuvable : exécutez db/002_espace_entreprises.sql.';
  }
  const langue = req.query.langue === 'en' ? 'en' : 'fr';
  res.render('admin-console', { vue, data, site, cmsError, langue, fmt, etapes: ETAPES, statuts: STATUTS_MANDAT, email: req.user.email || '' });
});

module.exports = router;
