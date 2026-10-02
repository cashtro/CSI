// Agent catalogue: validation of agent rows (import route, seed script) and
// the 38 starting agents of the "Centre de commande" (db/seed_agents.json).
//
// seedAgents() is idempotent by id: it inserts the agents that are missing and
// leaves the existing ones alone (an admin may have edited them), unless
// force is set, which rewrites their descriptive fields. It never touches
// status / current_task, which belong to the worker.

const fs = require('fs');
const path = require('path');

const SEED_FILE = path.join(__dirname, '..', '..', 'db', 'seed_agents.json');
const AGENT_ID = /^[\p{L}\p{N}_.\-]{1,100}$/u;
const MODEL = /^[a-z0-9][a-z0-9.\-]{1,80}$/;
const TIERS = ['quick', 'default', 'complex'];
const ENGINES = ['claude', 'maison'];

// Teams of the Centre de commande. delib = deliberation rooms (Council).
const TEAMS = [
  { key: 'infra', name: 'Infra et modernisation', short: 'Infra', emoji: '🛡️' },
  { key: 'contenu', name: 'Contenu et média', short: 'Contenu', emoji: '✍️' },
  { key: 'web', name: 'Web et automatisations', short: 'Web', emoji: '🧩' },
  { key: 'ventes', name: 'Ventes et formation', short: 'Ventes', emoji: '🤝' },
  { key: 'studio', name: 'Studio création et 3D', short: 'Studio', emoji: '🎬' },
  { key: 'conseil', name: 'Conseil affaires et marketing', short: 'Conseil', emoji: '🧭' },
  { key: 'marketing', name: 'Marketing et croissance', short: 'Marketing', emoji: '📣' },
  { key: 'planif', name: 'Planification', short: 'Planif', emoji: '🗂️', delib: true },
  { key: 'contra', name: 'Contradicteurs', short: 'Contra', emoji: '😈', delib: true },
  { key: 'revue', name: 'Révision et consensus', short: 'Revue', emoji: '✅', delib: true },
];

// Default research agent: Cap, the strategy consultant.
const DEFAULT_RESEARCH_AGENT = 'conseil-strategie';

const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const sizeOk = (v, max) => v == null || JSON.stringify(v).length <= max;

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

// Validates a list. Returns { rows } or { errors }.
function normaliseList(list) {
  const rows = [];
  const errors = [];
  (list || []).forEach((a, i) => {
    const r = normaliseAgent(a, i);
    if (r.error) errors.push(r.error); else rows.push(r.row);
  });
  if (!errors.length) {
    const ids = rows.map((r) => r.id);
    if (new Set(ids).size !== ids.length) errors.push('Identifiants en double');
  }
  return errors.length ? { errors } : { rows };
}

function loadSeed(file = SEED_FILE) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(data) ? data : data.agents;
  if (!Array.isArray(list)) throw new Error('seed_agents.json : { "agents": [...] } attendu');
  return list;
}

// -> { inserted, updated, skipped, total }
async function seedAgents(db, list, { force = false } = {}) {
  const { rows, errors } = normaliseList(list);
  if (errors) throw new Error(`Agents invalides : ${errors.slice(0, 5).join(' ; ')}`);
  const { data, error } = await db.from('agents').select('id').in('id', rows.map((r) => r.id));
  if (error) throw new Error(`agents illisible : ${error.message}`);
  const existing = new Set((data || []).map((r) => r.id));
  const missing = rows.filter((r) => !existing.has(r.id));
  const present = rows.filter((r) => existing.has(r.id));
  if (missing.length) {
    const { error: e } = await db.from('agents').insert(missing.map((r) => ({ ...r, status: 'idle' })));
    if (e) throw new Error(`insertion impossible : ${e.message}`);
  }
  if (force && present.length) {
    const { error: e } = await db.from('agents').upsert(present, { onConflict: 'id' });
    if (e) throw new Error(`mise à jour impossible : ${e.message}`);
  }
  return { inserted: missing.length, updated: force ? present.length : 0, skipped: force ? 0 : present.length, total: rows.length };
}

module.exports = {
  TEAMS, DEFAULT_RESEARCH_AGENT, SEED_FILE, AGENT_ID, MODEL, TIERS, ENGINES,
  slug, normaliseAgent, normaliseList, loadSeed, seedAgents,
};
