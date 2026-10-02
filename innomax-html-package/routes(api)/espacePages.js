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
const ADMIN_VUES = ['apercu', 'entreprises', 'clients', 'paiements', 'mandats', 'livrables', 'cms', ...AGENT_VUES, 'croissance'];

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
  const agentVue = AGENT_VUES.includes(vue);
  const agentData = agentVue ? await loadAgentsForForms(admin) : { agents: [], agentsError: null };
  const croissance = vue === 'croissance' ? await loadCroissance(admin, req.query) : null;
  res.render('admin-console', {
    vue, data, site, cmsError, langue, fmt, etapes: ETAPES, statuts: STATUTS_MANDAT, email: req.user.email || '', croissance,
    agentVue, agents: agentData.agents, agentsError: agentData.agentsError, teams: catalog.TEAMS, defaultResearchAgent: catalog.DEFAULT_RESEARCH_AGENT,
  });
});

module.exports = router;
module.exports.AGENT_VUES = AGENT_VUES;
