// Client (entreprise member) read access to agent jobs, mounted at /api/agents.
//
// A client only ever sees jobs whose entreprise_id belongs to one of their
// entreprises, and only the deliverable (never cost, payload or internal
// debate). Read-only: clients cannot create or cancel jobs.
//
// Membership comes from the espace's own table, public.membres (db/002), read
// with the service key through getMembership (utils/espace). A user belongs to
// at most one entreprise. The entreprise is always resolved on the server from
// the signed-in user, never taken from the request.

const express = require('express');
const { authenticateUser } = require('./utils/auth-middleware');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { getMembership } = require('./utils/espace');
const logger = require('./utils/logger');

const router = express.Router();
let adminDb;
const db = () => {
  if (!adminDb) adminDb = createSupabaseAdmin();
  return adminDb;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function memberEntreprises(userId) {
  const membership = await getMembership(db(), userId);
  return membership && membership.entreprise_id ? [membership.entreprise_id] : [];
}

// Membership lookup failures answer 500 instead of escaping the handler.
async function entreprisesOr500(req, res) {
  try {
    return await memberEntreprises(req.user.id);
  } catch (err) {
    logger.error('[agents] membership lookup failed:', err.message);
    res.status(500).json({ error: 'Lecture impossible' });
    return null;
  }
}

function canReadJob(job, entrepriseIds) {
  return Boolean(job && job.entreprise_id && entrepriseIds.includes(job.entreprise_id));
}

// A robot's result (job.robot set) is never served here: it becomes a
// deliverable that PBTM validates first, then shows in /espace (ROBOTS.md).
function clientView(job) {
  const r = job.result || {};
  const robot = Boolean(job.robot || (job.payload && job.payload.robot));
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    created_at: job.created_at,
    finished_at: job.finished_at,
    livrable: job.status === 'done' && !robot ? (r.texte || (r.decision && r.decision.decision) || null) : null,
  };
}

// '*' rather than a column list: the robot column (db/006) may not exist yet;
// only clientView's fields ever leave the server.
const COLUMNS = '*';

router.get('/jobs', authenticateUser, async (req, res) => {
  const ids = await entreprisesOr500(req, res);
  if (!ids) return undefined;
  if (!ids.length) return res.json([]);
  const { data, error } = await db().from('agent_jobs').select(COLUMNS).in('entreprise_id', ids)
    .order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  res.json((data || []).filter((j) => canReadJob(j, ids)).map(clientView));
});

router.get('/jobs/:id', authenticateUser, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Introuvable' });
  const ids = await entreprisesOr500(req, res);
  if (!ids) return undefined;
  if (!ids.length) return res.status(404).json({ error: 'Introuvable' });
  const { data, error } = await db().from('agent_jobs').select(COLUMNS).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  // 404 rather than 403 so a job id from another entreprise reveals nothing.
  if (!canReadJob(data, ids)) return res.status(404).json({ error: 'Introuvable' });
  res.json(clientView(data));
});

module.exports = router;
module.exports.canReadJob = canReadJob;
module.exports.clientView = clientView;
module.exports.memberEntreprises = memberEntreprises;
