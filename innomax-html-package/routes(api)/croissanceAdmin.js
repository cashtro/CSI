// Croissance API (/api/admin/croissance), see CROISSANCE.md.
//
// Every route: admin who passed 2FA in this browser (utils/espace
// requireAdmin) and the CSRF double-submit token on mutations. Agent jobs are
// rate limited. Nothing is published or sent from here: agents propose, the
// admin reviews, then applies (CMS) or changes a status by hand.
const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const cms = require('./utils/cms');
const seo = require('./utils/seo');
const { auditSite } = require('./utils/seoAudit');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { requireCsrf } = require('./utils/csrf');
const { requireAdmin, noStore } = require('./utils/espace');
const C = require('./utils/croissance');
const { RESEARCH_MAX_USES } = require('../agents/protocol');

const router = express.Router();

// Same guard as /api/admin/agents: a failed lookup answers 500 instead of
// escaping the middleware.
const adminGuard = requireAdmin();
async function requireAdminMfa(req, res, next) {
  try {
    await adminGuard(req, res, next);
  } catch (err) {
    logger.error('[croissance] admin check failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
}
router.use(noStore, requireAdminMfa, requireCsrf);

const jobLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Trop de demandes aux agents, réessayez dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const db = () => createSupabaseAdmin();
const bad = (res, error) => res.status(400).json({ error });

function fail(res, what, err) {
  if (err instanceof C.CroissanceError) return res.status(err.status).json({ error: err.message });
  logger.error(`[croissance] ${what} failed:`, (err && err.message) || err);
  return res.status(500).json({ error: `Échec : ${what}.` });
}

// The CMS as visitors see it, in French.
async function frenchContent(admin) {
  await cms.ensureLoaded(admin);
  return (k, f) => cms.resolve(k, 'fr', f);
}

async function oneCourse(admin) {
  const { data } = await admin.from('cours').select('*').order('created_at', { ascending: false }).limit(1);
  return (data && data[0]) || null;
}

async function runAudit(admin) {
  return auditSite({ content: await frenchContent(admin), course: await oneCourse(admin) });
}

// Generic CRUD for one table. parse(body, { partial }) → { row } | { error }.
function crud(path, table, parse, { label, onPatch } = {}) {
  router.post(`/${path}`, async (req, res) => {
    const { row, error } = parse(req.body);
    if (error) return bad(res, error);
    const { data, error: dbError } = await db().from(table).insert({ ...row, created_by: req.user.id }).select('id').single();
    if (dbError) return fail(res, `création (${label})`, dbError);
    logger.info(`[croissance] ${table} ${data.id} created by ${req.user.id}`);
    res.status(201).json({ id: data.id });
  });
  router.patch(`/${path}/:id`, async (req, res) => {
    if (!C.isUuid(req.params.id)) return bad(res, 'Identifiant invalide.');
    const { row, error } = parse(req.body, { partial: true });
    if (error) return bad(res, error);
    const patch = { ...row, updated_at: new Date().toISOString() };
    if (onPatch) onPatch(patch);
    const { data, error: dbError } = await db().from(table).update(patch).eq('id', req.params.id).select('id');
    if (dbError) return fail(res, `mise à jour (${label})`, dbError);
    if (!data || !data.length) return res.status(404).json({ error: 'Introuvable.' });
    res.json({ ok: true });
  });
  router.delete(`/${path}/:id`, async (req, res) => {
    if (!C.isUuid(req.params.id)) return bad(res, 'Identifiant invalide.');
    const { error } = await db().from(table).delete().eq('id', req.params.id);
    if (error) return fail(res, `suppression (${label})`, error);
    logger.info(`[croissance] ${table} ${req.params.id} deleted by ${req.user.id}`);
    res.json({ ok: true });
  });
}

// ---------------------------------------------------------------- SEO

router.get('/seo/audit', async (req, res) => {
  try {
    res.json(await runAudit(db()));
  } catch (err) {
    fail(res, 'audit SEO', err);
  }
});

// "Faire corriger par Racine": an order job; the proposal is reviewed in the
// SEO section and applied with /seo/appliquer.
router.post('/seo/racine', jobLimiter, async (req, res) => {
  const page = seo.PAGES.find((p) => p.id === (req.body && req.body.page));
  if (!page) return bad(res, 'Page inconnue.');
  try {
    const admin = db();
    await C.requireAgent(admin, C.AGENTS.racine);
    const audit = await runAudit(admin);
    const auditPage = audit.pages.find((p) => p.id === page.id);
    const job = await C.queueJob(admin, {
      kind: 'order',
      type: 'seo',
      ref: page.id,
      userId: req.user.id,
      payload: { agent_id: C.AGENTS.racine, instruction: C.seoInstruction(page, auditPage), client: null, contexte: null, tier: null },
    });
    res.status(201).json(job);
  } catch (err) {
    fail(res, 'demande à Racine', err);
  }
});

// Applies reviewed SEO texts to the CMS (French). The admin may have edited
// the agent's proposal; the lengths are checked again here.
router.post('/seo/appliquer', async (req, res) => {
  const b = req.body || {};
  const page = seo.PAGES.find((p) => p.id === b.page);
  if (!page) return bad(res, 'Page inconnue.');
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (title.length < 10 || title.length > 70) return bad(res, 'Titre : 10 à 70 caractères (idéal 30 à 65).');
  if (description.length < 50 || description.length > 170) return bad(res, 'Description : 50 à 170 caractères (idéal 70 à 160).');
  try {
    const admin = db();
    for (const [key, value] of [[`seo.${page.id}.title`, title], [`seo.${page.id}.description`, description]]) {
      const { entry, error } = cms.validateEntry({ key, lang: 'fr', type: 'texte', value });
      if (error) return bad(res, error);
      await cms.save(admin, entry, req.user.id);
    }
    if (C.isUuid(b.job_id)) await C.markImported(admin, b.job_id);
    logger.info(`[croissance] seo texts of ${page.id} applied by ${req.user.id}`);
    res.json({ ok: true });
  } catch (err) {
    fail(res, 'application au CMS', err);
  }
});

// ---------------------------------------------------------------- AEO

crud('aeo/questions', 'aeo_questions', C.parseAeo, { label: 'question' });

router.post('/aeo/suggerer', jobLimiter, async (req, res) => {
  try {
    const admin = db();
    await C.requireAgent(admin, C.AGENTS.racine);
    const { data } = await admin.from('aeo_questions').select('question').limit(200);
    const job = await C.queueJob(admin, {
      kind: 'order', type: 'aeo_questions', userId: req.user.id,
      payload: { agent_id: C.AGENTS.racine, instruction: C.aeoQuestionsInstruction((data || []).map((r) => r.question)), client: null, contexte: null, tier: null },
    });
    res.status(201).json(job);
  } catch (err) {
    fail(res, 'suggestion de questions', err);
  }
});

router.post('/aeo/repondre', jobLimiter, async (req, res) => {
  try {
    const admin = db();
    const { data, error } = await admin.from('aeo_questions').select('id, question, statut').eq('statut', 'a_repondre').limit(30);
    if (error) throw new C.CroissanceError(500, C.MISSING_TABLES);
    if (!data || !data.length) return bad(res, 'Aucune question à répondre.');
    await C.requireAgent(admin, C.AGENTS.racine);
    const job = await C.queueJob(admin, {
      kind: 'order', type: 'aeo_reponses', userId: req.user.id,
      payload: { agent_id: C.AGENTS.racine, instruction: C.aeoAnswersInstruction(data), client: null, contexte: null, tier: null },
    });
    res.status(201).json(job);
  } catch (err) {
    fail(res, 'demande de réponses', err);
  }
});

// Publishes a validated answer in the FAQ of its page (CMS faq.<page>).
router.post('/aeo/questions/:id/publier', async (req, res) => {
  if (!C.isUuid(req.params.id)) return bad(res, 'Identifiant invalide.');
  try {
    const admin = db();
    const { data: q } = await admin.from('aeo_questions').select('*').eq('id', req.params.id).maybeSingle();
    if (!q) return res.status(404).json({ error: 'Introuvable.' });
    if (q.statut !== 'validee' || !q.reponse) return res.status(409).json({ error: 'Validez d’abord la réponse (relecture humaine).' });
    const key = `faq.${q.page || 'generale'}`;
    const content = await frenchContent(admin);
    const current = seo.cleanFaq(content(key, q.page === 'generale' || !q.page ? seo.FAQ_GENERALE : []));
    const list = [...current.filter((x) => x.q.toLowerCase() !== q.question.toLowerCase()), { q: q.question, r: q.reponse }];
    const { entry, error } = cms.validateEntry({ key, lang: 'fr', type: 'json', value: JSON.stringify(list) });
    if (error) return bad(res, error);
    await cms.save(admin, entry, req.user.id);
    await admin.from('aeo_questions').update({ statut: 'publiee', updated_at: new Date().toISOString() }).eq('id', q.id);
    logger.info(`[croissance] aeo ${q.id} published in ${key} by ${req.user.id}`);
    res.json({ ok: true, key });
  } catch (err) {
    fail(res, 'publication dans la FAQ', err);
  }
});

// ---------------------------------------------------------------- backlinks

crud('backlinks', 'backlinks', C.parseBacklink, { label: 'backlink' });

// "Trouver des opportunités": web research (read only). Results are added
// as ideas only after the admin imports them.
router.post('/backlinks/opportunites', jobLimiter, async (req, res) => {
  const zone = typeof (req.body && req.body.zone) === 'string' ? req.body.zone.trim().slice(0, 200) : '';
  try {
    const admin = db();
    await C.requireAgent(admin, C.AGENTS.racine);
    const job = await C.queueJob(admin, {
      kind: 'research', type: 'backlinks', userId: req.user.id,
      payload: { agent_id: C.AGENTS.racine, question: C.backlinksQuestion(zone), client: null, contexte: null, tier: null, max_uses: Math.min(5, RESEARCH_MAX_USES) },
    });
    res.status(201).json(job);
  } catch (err) {
    fail(res, 'recherche d’opportunités', err);
  }
});

// Draft of an approach e-mail by Tribune. Never sent by the app.
router.post('/backlinks/:id/approche', jobLimiter, async (req, res) => {
  if (!C.isUuid(req.params.id)) return bad(res, 'Identifiant invalide.');
  try {
    const admin = db();
    const { data: b } = await admin.from('backlinks').select('*').eq('id', req.params.id).maybeSingle();
    if (!b) return res.status(404).json({ error: 'Introuvable.' });
    await C.requireAgent(admin, C.AGENTS.tribune);
    const job = await C.queueJob(admin, {
      kind: 'order', type: 'approche', ref: b.id, userId: req.user.id,
      payload: { agent_id: C.AGENTS.tribune, instruction: C.approcheInstruction(b), client: null, contexte: null, tier: null },
    });
    res.status(201).json(job);
  } catch (err) {
    fail(res, 'rédaction du courriel', err);
  }
});

// ---------------------------------------------------------------- campaigns and contents

crud('campagnes', 'campagnes', C.parseCampagne, { label: 'campagne' });
crud('contenus', 'contenus', C.parseContenu, {
  label: 'contenu',
  // Marking "publié" is the admin's manual act; the date is kept.
  onPatch: (patch) => { if (patch.statut === 'publie') patch.publie_le = new Date().toISOString(); else if (patch.statut) patch.publie_le = null; },
});

// "Générer la campagne": a Council of the marketing agents. Its decision and
// tasks become draft contents when the admin imports the result.
router.post('/campagnes/:id/generer', jobLimiter, async (req, res) => {
  if (!C.isUuid(req.params.id)) return bad(res, 'Identifiant invalide.');
  try {
    const admin = db();
    const { data: c } = await admin.from('campagnes').select('*').eq('id', req.params.id).maybeSingle();
    if (!c) return res.status(404).json({ error: 'Introuvable.' });
    const members = await C.councilFor(admin, c.canaux);
    const job = await C.queueJob(admin, {
      kind: 'debate', type: 'campagne', ref: c.id, userId: req.user.id,
      payload: { sujet: C.campagneSujet(c), contexte: null, client: null, ...members },
    });
    await admin.from('campagnes').update({ job_id: job.id, updated_at: new Date().toISOString() }).eq('id', c.id);
    res.status(201).json(job);
  } catch (err) {
    fail(res, 'génération de la campagne', err);
  }
});

// ---------------------------------------------------------------- media and press releases

crud('medias', 'medias', C.parseMedia, { label: 'média' });
crud('communiques', 'communiques', C.parseCommunique, { label: 'communiqué' });

// A press release drafted by Tribune: the row is created "en rédaction" and
// receives the text when the admin imports the result.
router.post('/communiques/rediger', jobLimiter, async (req, res) => {
  const { row, error } = C.parseCommunique(req.body);
  if (error) return bad(res, error);
  try {
    const admin = db();
    await C.requireAgent(admin, C.AGENTS.tribune);
    const { data, error: dbError } = await admin.from('communiques')
      .insert({ ...row, statut: 'en_redaction', created_by: req.user.id }).select('id').single();
    if (dbError) throw new C.CroissanceError(500, C.MISSING_TABLES);
    const job = await C.queueJob(admin, {
      kind: 'order', type: 'communique', ref: data.id, userId: req.user.id,
      payload: { agent_id: C.AGENTS.tribune, instruction: C.communiqueInstruction(row), client: null, contexte: null, tier: null },
    });
    await admin.from('communiques').update({ job_id: job.id }).eq('id', data.id);
    res.status(201).json({ id: data.id, job });
  } catch (err) {
    fail(res, 'rédaction du communiqué', err);
  }
});

// ---------------------------------------------------------------- jobs

router.post('/jobs/:jobId/importer', async (req, res) => {
  if (!C.isUuid(req.params.jobId)) return bad(res, 'Identifiant invalide.');
  try {
    const out = await C.importJob(db(), req.params.jobId, req.user.id);
    logger.info(`[croissance] job ${req.params.jobId} imported by ${req.user.id}: ${out.imported}`);
    res.json(out);
  } catch (err) {
    fail(res, 'import du résultat', err);
  }
});

// ---------------------------------------------------------------- export

router.get('/export', async (req, res) => {
  const table = String(req.query.table || '');
  const columns = C.EXPORTS[table];
  if (!columns) return bad(res, `Table à exporter : ${Object.keys(C.EXPORTS).join(', ')}.`);
  const { data, error } = await db().from(table).select('*').order('created_at', { ascending: false }).limit(5000);
  if (error) return fail(res, 'export', error);
  logger.info(`[croissance] export ${table} by ${req.user.id}`);
  res.set('Content-Disposition', `attachment; filename="pbtm-${table}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type('text/csv; charset=utf-8').send(C.toCsv(data || [], columns));
});

module.exports = router;
module.exports.runAudit = runAudit;
