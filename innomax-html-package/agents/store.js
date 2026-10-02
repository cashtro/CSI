// Small data helpers shared by the worker, the admin routes and /healthz.

const logger = require('../routes(api)/utils/logger');

const DEFAULT_SETTINGS = Object.freeze({
  id: 1, enabled: false, monthly_budget_usd: 60, model_quick: null, model_default: null, model_complex: null, concurrency: 2,
});

async function getSettings(db) {
  const { data, error } = await db.from('agent_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(`agent_settings illisible : ${error.message}`);
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

function modelsFromSettings(s) {
  return { quick: s.model_quick || null, default: s.model_default || null, complex: s.model_complex || null };
}

async function logActivity(db, { job_id = null, agent_id = null, kind, message = null, data = null }) {
  const { error } = await db.from('agent_activity').insert({ job_id, agent_id, kind, message, data });
  if (error) logger.warn('[agents] activity not recorded:', error.message);
}

async function getAgent(db, id) {
  if (!id) return null;
  const { data, error } = await db.from('agents').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`agents illisible : ${error.message}`);
  return data || null;
}

module.exports = { DEFAULT_SETTINGS, getSettings, modelsFromSettings, logActivity, getAgent };
