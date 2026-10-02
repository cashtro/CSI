// Server-rendered pages of the client space (/espace) and the admin console
// (/admin/console). Data is loaded here and printed escaped by EJS; the
// browser script (assets/js/espace.js) only sends actions to /api/espace and
// /api/admin, then reloads.
const express = require('express');
const cms = require('./utils/cms');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { requireMember, requireAdmin, noStore, loadEspace, loadAdmin, fmt, ETAPES, STATUTS_MANDAT } = require('./utils/espace');
const logger = require('./utils/logger');
const catalog = require('../agents/catalog');
const robots = require('./utils/robots');
const cx = require('./utils/connexions');
const finances = require('./utils/finances');
const { fetchStripeFinance } = require('./utils/finances-stripe');

const router = express.Router();

// Voice dictation (assets/js/dictee.js) needs the microphone. helmet 7 sends
// no Permissions-Policy, so browsers already allow it for the page's own
// origin; say so explicitly on these two pages only, and keep the camera and
// location off.
function allowMicrophone(req, res, next) {
  res.set('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  next();
}

// Agent tabs (views/partials/agents/*.ejs, assets/js/agents-console.js): the
// page renders the forms; the script reads /api/admin/agents for live data.
const AGENT_VUES = ['agents', 'conseil', 'travail', 'recherche', 'reglages-agents'];
const ADMIN_VUES = ['apercu', 'entreprises', 'clients', 'paiements', 'finances', 'mandats', 'livrables', 'robots', 'cms', ...AGENT_VUES, 'croissance'];
const ROBOTS_ABSENT = 'Les tables des robots sont introuvables : exécutez db/006_robots.sql.';

// Croissance tab (CROISSANCE.md): SEO audit, AEO, backlinks, campaigns, media.
async function loadCroissance(admin, query) {
  const croissance = require('./utils/croissance');
  const section = croissance.SECTIONS.includes(query.section) ? query.section : 'tableau';
  let audit = null;
  if (section === 'tableau' || section === 'seo') {
    try {
      audit = await require('./croissanceAdmin').runAudit(admin);
    } catch (err) {
      logger.warn('[admin] seo audit failed:', err.message);
    }
  }
  const mois = typeof query.mois === 'string' ? query.mois : '';
  return croissance.loadPage(admin, { section, mois, audit });
}

// Agents for the forms' selects. A missing table (db/003 not run) shows a
// message instead of failing the page.
async function loadAgentsForForms(admin) {
  const { data, error } = await admin.from('agents').select('id, name, team, role, engine, active').order('team').order('name');
  if (error) {
    logger.warn('[admin] agents unreadable:', error.message);
    return { agents: [], agentsError: 'La table agents est introuvable : exécutez db/003_moteur_agents.sql, db/004_protection_comptes.sql puis db/005_recherche_agents.sql.' };
  }
  return { agents: data || [], agentsError: null };
}
const CLIENT_VUES = ['apercu', 'mandats', 'livrables', 'robots', 'connexions', 'achats', 'nouveau'];

// Messages shown after a redirect (Stripe, OAuth). Only known values.
const MESSAGES = {
  etat: { kind: 'error', text: 'Le lien de connexion est invalide ou expiré. Recommencez depuis cette page.' },
  refus: { kind: 'error', text: 'La connexion a été annulée chez le fournisseur. Rien n’a été enregistré.' },
  echange: { kind: 'error', text: 'Le fournisseur n’a pas confirmé la connexion. Réessayez dans un instant.' },
};

// Connections of a company, as the page may show them (never the tokens).
async function loadConnexions(admin, entrepriseId) {
  const { data, error } = await admin.from('connexions').select('id, fournisseur, statut, portee, compte, expire_at, consenti_at, erreur, created_at, updated_at').eq('entreprise_id', entrepriseId);
  if (error) throw new Error(error.message);
  const par = Object.fromEntries((data || []).map((r) => [r.fournisseur, cx.vuePublique(r)]));
  return cx.IDS.map((id) => ({ id, ...cx.FOURNISSEURS[id], oauth: undefined, configure: id === 'site_web' ? cx.canEncrypt() : cx.isConfigured(id) && cx.canEncrypt(), connexion: par[id] || null }));
}

router.get('/espace', noStore, allowMicrophone, requireMember({ page: true }), async (req, res) => {
  const vue = CLIENT_VUES.includes(req.query.vue) ? req.query.vue : 'apercu';
  const admin = createSupabaseAdmin();
  const data = req.membership ? await loadEspace(admin, req.membership.entreprise_id) : null;
  let robotsData = null;
  let connexions = null;
  let robotsError = null;
  if (data && (vue === 'robots' || vue === 'connexions' || vue === 'apercu')) {
    try {
      robotsData = await robots.loadRobotsEspace(admin, req.membership.entreprise_id);
      if (vue === 'connexions') connexions = await loadConnexions(admin, req.membership.entreprise_id);
    } catch (err) {
      logger.warn('[espace] robots unreadable:', err.message);
      robotsError = ROBOTS_ABSENT;
    }
  }
  const q = req.query;
  const flash = MESSAGES[q.erreur] || (typeof q.ok === 'string' && cx.IDS.includes(q.ok)
    ? { kind: 'ok', text: `${cx.FOURNISSEURS[q.ok].nom} est connecté. Vous pouvez retirer cette autorisation en tout temps.` } : null);
  const bienvenue = typeof q.bienvenue === 'string' && (q.bienvenue === '1' || robots.SLUG.test(q.bienvenue))
    ? ((robotsData && robotsData.robots.find((r) => r.robot === q.bienvenue)) || { offre: null }) : null;
  res.render('espace-client', {
    vue, data, fmt, etapes: ETAPES, email: req.user.email || '',
    robotsData, connexions, robotsError, flash, bienvenue,
    proprietaire: Boolean(req.membership && req.membership.role === 'proprietaire'),
  });
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
  const agentVue = AGENT_VUES.includes(vue);
  const agentData = agentVue ? await loadAgentsForForms(admin) : { agents: [], agentsError: null };
  let robotsAdmin = null;
  let robotsError = null;
  if (vue === 'robots') {
    try {
      robotsAdmin = await robots.loadRobotsAdmin(admin);
    } catch (err) {
      logger.warn('[admin] robots unreadable:', err.message);
      robotsError = ROBOTS_ABSENT;
    }
  }
  // Finances tab (FINANCES.md): every amount is computed on the server.
  const fin = vue === 'finances'
    ? await finances.loadFinances(admin, {
      mois: req.query.mois, du: req.query.du, au: req.query.au,
      stripe: await fetchStripeFinance(),
      usdToCad: process.env.FINANCES_USD_CAD,
      fmtMoney: (c) => fmt.money(c / 100),
    })
    : null;
  const croissance = vue === 'croissance' ? await loadCroissance(admin, req.query) : null;
  res.render('admin-console', {
    vue, data, site, cmsError, langue, fmt, etapes: ETAPES, statuts: STATUTS_MANDAT, email: req.user.email || '',
    robotsAdmin, robotsError, fournisseurs: cx.FOURNISSEURS,
    croissance,
    fin, categories: finances.CATEGORIES, categorieLabel: finances.CATEGORIE_LABEL,
    agentVue, agents: agentData.agents, agentsError: agentData.agentsError, teams: catalog.TEAMS, defaultResearchAgent: catalog.DEFAULT_RESEARCH_AGENT,
    seedCount: agentVue ? catalog.seedCount() : 0,
  });
});

module.exports = router;
module.exports.AGENT_VUES = AGENT_VUES;
module.exports.CLIENT_VUES = CLIENT_VUES;
module.exports.ADMIN_VUES = ADMIN_VUES;
