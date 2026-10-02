// Admin API for the agent engine, mounted at /api/admin/agents.
//
// Every route: admin role (checkAdmin) + 2FA enabled on the account
// (require2fa). Mutations: always-on CSRF double-submit (requireCsrf), and
// rate limits on job creation and import. See MOTEUR-AGENTS.md.

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { checkAdmin } = require('./utils/auth-middleware');
const { requireCsrf } = require('./utils/csrf');
const { get2fa } = require('./utils/twofa');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { getRange } = require('./utils/pagination');
const store = require('../agents/store');
const { createBudget, monthStart } = require('../agents/budget');
const { MAX_PROPOSERS, MAX_CHALLENGERS } = require('../agents/protocol');

const router = express.Router();

let adminDb;
const db = () => {
  if (!adminDb) adminDb = createSupabaseAdmin();
  return adminDb;
};

// Admins must have an enabled authenticator. Login already forces 2FA on
// privileged accounts (utils/twofa); this refuses an admin whose 2FA row is
// missing or disabled, e.g. a session minted before the policy existed.
async function require2fa(req, res, next) {
  try {
    const row = await get2fa(db(), req.user.id);
    if (!row || !row.enabled) return res.status(403).json({ error: 'Double authentification requise' });
    next();
  } catch (err) {
    logger.error('[agents] 2FA check failed:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
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

router.use(checkAdmin, require2fa, requireCsrf);

// ------------------------------------------------------------ validation

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = /^[a-z0-9][a-z0-9.\-]{1,80}$/;
const AGENT_ID = /^[\p{L}\p{N}_.\-]{1,100}$/u;
const TIERS = ['quick', 'default', 'complex'];
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
  await store.logActivity(db(), { job_id: data.id, kind: 'job_queued', message: `${kind === 'debate' ? 'Conseil' : 'Ordre'} mis en file` });
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
    if (!['order', 'debate'].includes(req.query.kind)) return bad(res, 'kind invalide');
    q = q.eq('kind', req.query.kind);
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
let openStreams = 0;

router.get('/stream', async (req, res) => {
  if (openStreams >= MAX_STREAMS) return res.status(503).json({ error: 'Trop de flux ouverts' });
  openStreams += 1;
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  // compression() buffers responses; flush after each event.
  const send = (chunk) => { res.write(chunk); if (typeof res.flush === 'function') res.flush(); };

  let lastId = parseInt(req.get('Last-Event-ID'), 10);
  let closed = false;
  let polling = false;

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
  const pollTimer = setInterval(poll, 2000);
  const pingTimer = setInterval(() => send(': ping\n\n'), 15000);
  req.on('close', () => {
    closed = true;
    openStreams -= 1;
    clearInterval(pollTimer);
    clearInterval(pingTimer);
  });
});

// ------------------------------------------------------------ import / export

const ENGINES = ['claude', 'maison'];

function slug(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

// Accepts the artifact's field names (French or English).
function normaliseAgent(a, i) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { error: `agent ${i + 1} : objet attendu` };
  const name = a.name ?? a.nom;
  if (!isText(name, 200)) return { error: `agent ${i + 1} : name requis` };
  const id = a.id != null ? String(a.id) : slug(name);
  if (!AGENT_ID.test(id)) return { error: `agent ${i + 1} : id invalide` };
  const text = (v, max) => (v == null ? null : String(v).slice(0, max));
  const tools = a.tools ?? a.outils ?? [];
  const engine = a.engine ?? a.moteur ?? 'claude';
  if (!ENGINES.includes(engine)) return { error: `agent ${i + 1} : engine doit être claude ou maison` };
  const model = a.model ?? a.modele ?? null;
  if (model != null && !(TIERS.includes(model) || MODEL.test(model))) return { error: `agent ${i + 1} : model invalide` };
  if (!sizeOk(tools, 5000)) return { error: `agent ${i + 1} : tools trop volumineux` };
  const active = a.active ?? a.actif;
  return {
    row: {
      id,
      name: String(name).slice(0, 200),
      team: text(a.team ?? a.equipe, 200),
      role: text(a.role ?? a.rôle, 4000),
      method: text(a.method ?? a.methode ?? a.méthode, 8000),
      tools: Array.isArray(tools) ? tools : [tools],
      engine,
      model,
      active: active === undefined ? true : Boolean(active),
      updated_at: new Date().toISOString(),
    },
  };
}

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
  const rows = [];
  const errors = [];
  list.forEach((a, i) => {
    const r = normaliseAgent(a, i);
    if (r.error) errors.push(r.error); else rows.push(r.row);
  });
  if (errors.length) return res.status(400).json({ error: 'Import refusé', details: errors.slice(0, 50) });
  const ids = rows.map((r) => r.id);
  if (new Set(ids).size !== ids.length) return bad(res, 'Identifiants en double dans l’import');
  const { error } = await db().from('agents').upsert(rows, { onConflict: 'id' });
  if (error) {
    logger.error('[agents] import failed:', error.message);
    return res.status(500).json({ error: 'Import impossible' });
  }
  await store.logActivity(db(), { kind: 'import', message: `${rows.length} agent(s) importé(s)` });
  res.json({ imported: rows.length });
});

module.exports = router;
module.exports.require2fa = require2fa;
module.exports.normaliseAgent = normaliseAgent;
