// Admin API for the agent engine, mounted at /api/admin/agents.
//
// Every route: the same guard as the admin console (requireAdmin in
// utils/espace): Users.isAdmin read with the service key AND the signed "mfa"
// cookie that verify-2fa sets once THIS browser passed the code. Having 2FA
// enabled on the account is not enough: a Supabase token minted directly with
// the anon key never went through the code. Mutations: always-on CSRF
// double-submit (requireCsrf), and rate limits on job creation and import.
// See MOTEUR-AGENTS.md.

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { requireCsrf } = require('./utils/csrf');
const { requireAdmin, noStore } = require('./utils/espace');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { getRange } = require('./utils/pagination');
const store = require('../agents/store');
const { createBudget, monthStart } = require('../agents/budget');
const { MAX_PROPOSERS, MAX_CHALLENGERS, RESEARCH_MAX_USES, webSearchTool } = require('../agents/protocol');
const { createLLM } = require('../agents/llm');
const catalog = require('../agents/catalog');

const router = express.Router();

let adminDb;
const db = () => {
  if (!adminDb) adminDb = createSupabaseAdmin();
  return adminDb;
};

// Admin role + second-factor proof for this browser (see the header). A
// lookup failure answers 500 instead of escaping the middleware.
const adminGuard = requireAdmin();
async function requireAdminMfa(req, res, next) {
  try {
    await adminGuard(req, res, next);
  } catch (err) {
    logger.error('[agents] admin check failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
}

const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Trop de demandes, réessayez dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const importLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Trop d’imports, réessayez plus tard.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(noStore, requireAdminMfa, requireCsrf);

// ------------------------------------------------------------ validation

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const { MODEL, AGENT_ID, TIERS } = catalog;
const KINDS = ['order', 'debate', 'research'];
const KIND_LABEL = { order: 'Ordre', debate: 'Conseil', research: 'Recherche' };
const STATUSES = ['queued', 'running', 'done', 'error', 'cancelled', 'budget_refused'];

function bad(res, msg) { return res.status(400).json({ error: msg }); }
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const sizeOk = (v, max) => v == null || JSON.stringify(v).length <= max;
const idList = (v, max) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && AGENT_ID.test(x));

async function unknownAgents(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const { data, error } = await db().from('agents').select('id').in('id', unique);
  if (error) throw new Error(error.message);
  const found = new Set((data || []).map((r) => r.id));
  return unique.filter((id) => !found.has(id));
}

function common(body) {
  if (body.entreprise_id != null && !(typeof body.entreprise_id === 'string' && UUID.test(body.entreprise_id))) return 'entreprise_id invalide';
  if (body.priority != null && !(Number.isInteger(body.priority) && body.priority >= -10 && body.priority <= 10)) return 'priority doit être un entier entre -10 et 10';
  if (!sizeOk(body.client, 20000)) return 'client trop volumineux (20 000 caractères max)';
  if (body.contexte != null && !(typeof body.contexte === 'string' && body.contexte.length <= 20000)) return 'contexte invalide (texte, 20 000 caractères max)';
  return null;
}

async function insertJob(req, res, kind, payload) {
  const row = {
    kind,
    payload,
    priority: req.body.priority || 0,
    entreprise_id: req.body.entreprise_id || null,
    created_by: req.user.id,
  };
  const { data, error } = await db().from('agent_jobs').insert(row).select('id, kind, status, created_at').single();
  if (error) {
    logger.error('[agents] job insert failed:', error.message);
    return res.status(500).json({ error: 'Création impossible' });
  }
  await store.logActivity(db(), { job_id: data.id, agent_id: payload.agent_id || null, kind: 'job_queued', message: `${KIND_LABEL[kind]} mis en file` });
  return res.status(201).json(data);
}

// ------------------------------------------------------------ jobs

const LIST_COLUMNS = 'id, kind, status, priority, attempts, max_attempts, cost_usd, tokens_in, tokens_out, error, entreprise_id, created_by, created_at, started_at, finished_at, payload';

router.get('/jobs', async (req, res) => {
  const { from, to } = getRange(req.query, { defaultLimit: 50, maxLimit: 200 });
  let q = db().from('agent_jobs').select(LIST_COLUMNS).order('created_at', { ascending: false }).range(from, to);
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) return bad(res, 'status invalide');
    q = q.eq('status', req.query.status);
  }
  if (req.query.kind) {
    if (!KINDS.includes(req.query.kind)) return bad(res, 'kind invalide');
    q = q.eq('kind', req.query.kind);
  }
  if (req.query.agent_id) {
    if (!AGENT_ID.test(String(req.query.agent_id))) return bad(res, 'agent_id invalide');
    q = q.eq('payload->>agent_id', String(req.query.agent_id));
  }
  if (req.query.entreprise_id) {
    if (!UUID.test(String(req.query.entreprise_id))) return bad(res, 'entreprise_id invalide');
    q = q.eq('entreprise_id', String(req.query.entreprise_id));
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  res.json(data || []);
});

router.post('/jobs/order', createLimiter, async (req, res) => {
  const b = req.body || {};
  if (!isText(b.agent_id, 100) || !AGENT_ID.test(b.agent_id)) return bad(res, 'agent_id requis');
  if (!isText(b.instruction, 8000)) return bad(res, 'instruction requise (8 000 caractères max)');
  if (b.tier != null && !TIERS.includes(b.tier)) return bad(res, 'tier invalide');
  const err = common(b);
  if (err) return bad(res, err);
  const missing = await unknownAgents([b.agent_id]);
  if (missing.length) return bad(res, `Agent inconnu : ${missing.join(', ')}`);
  return insertJob(req, res, 'order', {
    agent_id: b.agent_id, instruction: b.instruction, client: b.client ?? null, contexte: b.contexte ?? null, tier: b.tier || null,
  });
});

router.post('/jobs/council', createLimiter, async (req, res) => {
  const b = req.body || {};
  if (!isText(b.sujet, 4000)) return bad(res, 'sujet requis (4 000 caractères max)');
  if (!idList(b.proposeurs, MAX_PROPOSERS) || b.proposeurs.length < 1) return bad(res, `proposeurs : 1 à ${MAX_PROPOSERS} identifiants d’agents`);
  const contradicteurs = b.contradicteurs == null ? [] : b.contradicteurs;
  if (!idList(contradicteurs, MAX_CHALLENGERS)) return bad(res, `contradicteurs : au plus ${MAX_CHALLENGERS}`);
  const votants = b.votants == null ? [] : b.votants;
  if (!idList(votants, 12)) return bad(res, 'votants : au plus 12');
  for (const k of ['planificateur', 'arbitre', 'reviseur']) {
    if (b[k] != null && !(typeof b[k] === 'string' && AGENT_ID.test(b[k]))) return bad(res, `${k} invalide`);
  }
  const err = common(b);
  if (err) return bad(res, err);
  const missing = await unknownAgents([...b.proposeurs, ...contradicteurs, ...votants, b.planificateur, b.arbitre, b.reviseur]);
  if (missing.length) return bad(res, `Agent(s) inconnu(s) : ${missing.join(', ')}`);
  return insertJob(req, res, 'debate', {
    sujet: b.sujet,
    contexte: b.contexte ?? null,
    client: b.client ?? null,
    proposeurs: b.proposeurs,
    contradicteurs,
    votants,
    planificateur: b.planificateur || null,
    arbitre: b.arbitre || null,
    reviseur: b.reviseur || null,
  });
});

// Web research by one agent (read only: Anthropic's server-side web search).
// Refused up front when the month's budget cannot cover one worst-case
// research; the worker checks again before each call.
router.post('/jobs/research', createLimiter, async (req, res) => {
  const b = req.body || {};
  if (!isText(b.question, 2000)) return bad(res, 'question requise (2 000 caractères max)');
  const agentId = b.agent_id == null || b.agent_id === '' ? catalog.DEFAULT_RESEARCH_AGENT : b.agent_id;
  if (typeof agentId !== 'string' || !AGENT_ID.test(agentId)) return bad(res, 'agent_id invalide');
  if (b.max_uses != null && !(Number.isInteger(b.max_uses) && b.max_uses >= 1 && b.max_uses <= RESEARCH_MAX_USES)) {
    return bad(res, `max_uses entre 1 et ${RESEARCH_MAX_USES}`);
  }
  if (b.tier != null && !TIERS.includes(b.tier)) return bad(res, 'tier invalide');
  const err = common(b);
  if (err) return bad(res, err);
  const missing = await unknownAgents([agentId]);
  if (missing.length) return bad(res, `Agent inconnu : ${missing.join(', ')}`);

  const settings = await store.getSettings(db());
  const budget = await createBudget({ db: db(), getSettings: async () => settings }).status();
  const estimate = createLLM({ apiKey: null, models: () => store.modelsFromSettings(settings) }).estimateCost({
    tier: b.tier || 'default',
    messages: [{ role: 'user', content: b.question }],
    tools: [webSearchTool(process.env, b.max_uses)],
  });
  if (budget.spent + estimate > budget.budget) {
    return res.status(402).json({
      error: `Budget mensuel atteint : ${budget.spent.toFixed(2)} $ dépensés sur ${budget.budget.toFixed(2)} $. Une recherche peut coûter jusqu’à ${estimate.toFixed(2)} $.`,
    });
  }
  return insertJob(req, res, 'research', {
    agent_id: agentId, question: b.question, client: b.client ?? null, contexte: b.contexte ?? null, tier: b.tier || null, max_uses: b.max_uses || null,
  });
});

router.get('/jobs/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'id invalide');
  const { data, error } = await db().from('agent_jobs').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  if (!data) return res.status(404).json({ error: 'Introuvable' });
  const { data: activity } = await db().from('agent_activity').select('id, kind, message, agent_id, created_at')
    .eq('job_id', req.params.id).order('id', { ascending: true }).limit(200);
  res.json({ ...data, activity: activity || [] });
});

router.post('/jobs/:id/cancel', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'id invalide');
  const { data, error } = await db().from('agent_jobs')
    .update({ status: 'cancelled', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.params.id).in('status', ['queued', 'running']).select('id, status');
  if (error) return res.status(500).json({ error: 'Annulation impossible' });
  if (!data || !data.length) return res.status(409).json({ error: 'Ce travail n’est plus annulable' });
  await store.logActivity(db(), { job_id: req.params.id, kind: 'job_cancel_requested', message: 'Annulation demandée' });
  res.json(data[0]);
});

router.get('/tasks', async (req, res) => {
  const { from, to } = getRange(req.query, { defaultLimit: 100, maxLimit: 200 });
  let q = db().from('agent_tasks').select('*').order('created_at', { ascending: false }).range(from, to);
  if (req.query.job_id) {
    if (!UUID.test(req.query.job_id)) return bad(res, 'job_id invalide');
    q = q.eq('job_id', req.query.job_id);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  res.json(data || []);
});

// ------------------------------------------------------------ agents & activity

router.get('/agents', async (req, res) => {
  const { data, error } = await db().from('agents')
    .select('id, name, team, role, method, tools, engine, model, active, status, current_task, updated_at').order('team').order('name');
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  res.json({ teams: catalog.TEAMS, agents: data || [] });
});

// Console KPIs: agents at work, jobs running / queued, Councils that reached
// consensus.
router.get('/summary', async (req, res) => {
  const count = (status) => db().from('agent_jobs').select('id', { count: 'exact', head: true }).eq('status', status);
  const [running, queued, agents, debates] = await Promise.all([
    count('running'),
    count('queued'),
    db().from('agents').select('id, status, active'),
    db().from('agent_jobs').select('result').eq('kind', 'debate').eq('status', 'done').order('created_at', { ascending: false }).limit(500),
  ]);
  if (running.error || queued.error || agents.error || debates.error) return res.status(500).json({ error: 'Lecture impossible' });
  const list = agents.data || [];
  res.json({
    agents: list.filter((a) => a.active !== false).length,
    working: list.filter((a) => a.status === 'working').length,
    running: running.count || 0,
    queued: queued.count || 0,
    consensus: (debates.data || []).filter((d) => d.result && d.result.consensus === true).length,
  });
});

// Emergency stop: engine off and every queued or running job cancelled (a
// running job stops at its next step, see the worker).
router.post('/emergency-stop', async (req, res) => {
  const now = new Date().toISOString();
  const { error: e1 } = await db().from('agent_settings').upsert({ id: 1, enabled: false, updated_at: now, updated_by: req.user.id }).select('id').single();
  if (e1) return res.status(500).json({ error: 'Arrêt impossible' });
  const { data, error: e2 } = await db().from('agent_jobs')
    .update({ status: 'cancelled', finished_at: now, updated_at: now }).in('status', ['queued', 'running']).select('id');
  if (e2) return res.status(500).json({ error: 'Moteur arrêté, mais les travaux n’ont pas pu être annulés' });
  const cancelled = (data || []).length;
  logger.warn(`[agents] emergency stop by ${req.user.id}: ${cancelled} job(s) cancelled`);
  await store.logActivity(db(), { kind: 'emergency_stop', message: `Arrêt d’urgence : moteur coupé, ${cancelled} travail(s) annulé(s)` });
  res.json({ enabled: false, cancelled });
});

// Polling fallback of the live stream: activity after the given id.
router.get('/activity', async (req, res) => {
  const after = parseInt(req.query.after, 10);
  let q = db().from('agent_activity').select('id, job_id, agent_id, kind, message, created_at');
  q = Number.isFinite(after) && after >= 0 ? q.gt('id', after).order('id', { ascending: true }).limit(100)
    : q.order('id', { ascending: false }).limit(40);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  const rows = data || [];
  res.json(Number.isFinite(after) && after >= 0 ? rows : rows.reverse());
});

// The starting agents (db/seed_agents.json). Missing ones are added;
// existing ones are left as the admin edited them.
router.post('/seed', importLimiter, async (req, res) => {
  let result;
  try {
    result = await catalog.seedAgents(db(), catalog.loadSeed());
  } catch (err) {
    logger.error('[agents] seed failed:', err.message);
    return res.status(500).json({ error: 'Import des agents de départ impossible' });
  }
  await store.logActivity(db(), { kind: 'import', message: `Agents de départ : ${result.inserted} ajouté(s), ${result.skipped} déjà présent(s)` });
  res.json(result);
});

// ------------------------------------------------------------ settings & usage

router.get('/settings', async (req, res) => {
  const s = await store.getSettings(db());
  res.json({ ...s, env_enabled: process.env.AGENTS_ENABLED === 'true', api_key_configured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

router.put('/settings', async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return bad(res, 'enabled doit être true ou false');
    patch.enabled = b.enabled;
  }
  if (b.monthly_budget_usd !== undefined) {
    const n = Number(b.monthly_budget_usd);
    if (!Number.isFinite(n) || n < 0 || n > 10000) return bad(res, 'monthly_budget_usd entre 0 et 10 000');
    patch.monthly_budget_usd = n;
  }
  for (const k of ['model_quick', 'model_default', 'model_complex']) {
    if (b[k] === undefined) continue;
    if (b[k] !== null && !(typeof b[k] === 'string' && MODEL.test(b[k]))) return bad(res, `${k} invalide`);
    patch[k] = b[k];
  }
  if (b.concurrency !== undefined) {
    if (!(Number.isInteger(b.concurrency) && b.concurrency >= 1 && b.concurrency <= 6)) return bad(res, 'concurrency entre 1 et 6');
    patch.concurrency = b.concurrency;
  }
  if (!Object.keys(patch).length) return bad(res, 'Aucun réglage fourni');
  const { data, error } = await db().from('agent_settings')
    .upsert({ id: 1, ...patch, updated_at: new Date().toISOString(), updated_by: req.user.id }).select('*').single();
  if (error) return res.status(500).json({ error: 'Enregistrement impossible' });
  logger.info(`[agents] settings changed by ${req.user.id}: ${Object.keys(patch).join(', ')}`);
  await store.logActivity(db(), { kind: 'settings', message: `Réglages modifiés : ${Object.keys(patch).join(', ')}` });
  res.json(data);
});

router.get('/usage', async (req, res) => {
  const start = monthStart();
  const { data, error } = await db().from('agent_usage').select('*').gte('day', start).order('day', { ascending: true });
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  const budget = await createBudget({ db: db(), getSettings: () => store.getSettings(db()) }).status();
  const rows = data || [];
  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  res.json({
    month: start,
    budget_usd: budget.budget,
    spent_usd: Number(budget.spent.toFixed(4)),
    remaining_usd: Number(budget.remaining.toFixed(4)),
    totals: { calls: sum('calls'), tokens_in: sum('tokens_in'), tokens_out: sum('tokens_out') },
    rows,
  });
});

// ------------------------------------------------------------ live stream (SSE)

const MAX_STREAMS = 20;
// A stream is closed by the server after this long; EventSource reconnects
// on its own (with Last-Event-ID), so a forgotten tab cannot hold a slot.
const STREAM_MAX_MS = parseInt(process.env.AGENTS_STREAM_MAX_MS, 10) || 30 * 60 * 1000;
let openStreams = 0;

router.get('/stream', async (req, res) => {
  if (openStreams >= MAX_STREAMS) return res.status(503).json({ error: 'Trop de flux ouverts' });
  openStreams += 1;

  let lastId = parseInt(req.get('Last-Event-ID'), 10);
  let closed = false;
  let polling = false;
  let pollTimer = null;
  let pingTimer = null;
  let lifeTimer = null;

  // Registered BEFORE the first (async) poll: a client that leaves during it
  // must still release its slot and never leave timers running.
  const cleanup = () => {
    if (closed) return;
    closed = true;
    openStreams -= 1;
    clearInterval(pollTimer);
    clearInterval(pingTimer);
    clearTimeout(lifeTimer);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  // compression() buffers responses; flush after each event.
  const send = (chunk) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(chunk);
      if (typeof res.flush === 'function') res.flush();
    } catch (err) {
      cleanup();
    }
  };

  async function poll() {
    if (closed || polling) return;
    polling = true;
    try {
      let q = db().from('agent_activity').select('id, job_id, agent_id, kind, message, created_at');
      q = Number.isFinite(lastId) ? q.gt('id', lastId).order('id', { ascending: true }).limit(100)
        : q.order('id', { ascending: false }).limit(20); // first connection: recent history
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = Number.isFinite(lastId) ? (data || []) : (data || []).reverse();
      for (const row of rows) {
        send(`id: ${row.id}\nevent: activity\ndata: ${JSON.stringify(row)}\n\n`);
        lastId = row.id;
      }
      if (!Number.isFinite(lastId)) lastId = 0;
    } catch (err) {
      logger.warn('[agents] stream poll failed:', err.message);
    } finally {
      polling = false;
    }
  }

  send('retry: 5000\n\n');
  await poll();
  if (closed) return;
  pollTimer = setInterval(poll, 2000);
  pingTimer = setInterval(() => send(': ping\n\n'), 15000);
  lifeTimer = setTimeout(() => res.end(), STREAM_MAX_MS);
  if (lifeTimer.unref) lifeTimer.unref();
});

// ------------------------------------------------------------ import / export

const { normaliseAgent } = catalog;

router.get('/export', async (req, res) => {
  const { data, error } = await db().from('agents')
    .select('id, name, team, role, method, tools, engine, model, active').order('team').order('name');
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  res.set('Content-Disposition', 'attachment; filename="agents-pandora.json"');
  res.json({ version: 1, exported_at: new Date().toISOString(), agents: data || [] });
});

router.post('/import', importLimiter, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : req.body && req.body.agents;
  if (!Array.isArray(list) || !list.length) return bad(res, 'Envoyez { "agents": [...] }');
  if (list.length > 200) return bad(res, '200 agents au maximum par import');
  const { rows, errors } = catalog.normaliseList(list);
  if (errors && errors[0] === 'Identifiants en double') return bad(res, 'Identifiants en double dans l’import');
  if (errors) return res.status(400).json({ error: 'Import refusé', details: errors.slice(0, 50) });
  const { error } = await db().from('agents').upsert(rows, { onConflict: 'id' });
  if (error) {
    logger.error('[agents] import failed:', error.message);
    return res.status(500).json({ error: 'Import impossible' });
  }
  await store.logActivity(db(), { kind: 'import', message: `${rows.length} agent(s) importé(s)` });
  res.json({ imported: rows.length });
});

module.exports = router;
module.exports.requireAdminMfa = requireAdminMfa;
module.exports.normaliseAgent = normaliseAgent;
module.exports._openStreams = () => openStreams;
