// Client (entreprise member) read access to agent jobs, mounted at /api/agents.
//
// A client only ever sees jobs whose entreprise_id belongs to one of their
// entreprises, and only the deliverable (never cost, payload or internal
// debate). Read-only: clients cannot create or cancel jobs.
//
// TODO(espace-entreprises): this branch has no entreprise membership model
// yet, so memberEntreprises() returns [] and these routes answer an empty
// list / 404 for everyone. When the espace-entreprises branch lands, make it
// read the membership table (same one as the RLS policy in
// db/003_moteur_agents.sql: entreprise_membres(entreprise_id, user_id)) and
// reuse that branch's ownership helper instead of this placeholder.

const express = require('express');
const { authenticateUser } = require('./utils/auth-middleware');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');

const router = express.Router();
let adminDb;
const db = () => {
  if (!adminDb) adminDb = createSupabaseAdmin();
  return adminDb;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// eslint-disable-next-line no-unused-vars
async function memberEntreprises(userId) {
  return []; // TODO(espace-entreprises): see the header comment.
}

function canReadJob(job, entrepriseIds) {
  return Boolean(job && job.entreprise_id && entrepriseIds.includes(job.entreprise_id));
}

function clientView(job) {
  const r = job.result || {};
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    created_at: job.created_at,
    finished_at: job.finished_at,
    livrable: job.status === 'done' ? (r.texte || (r.decision && r.decision.decision) || null) : null,
  };
}

const COLUMNS = 'id, kind, status, entreprise_id, result, created_at, finished_at';

router.get('/jobs', authenticateUser, async (req, res) => {
  const ids = await memberEntreprises(req.user.id);
  if (!ids.length) return res.json([]);
  const { data, error } = await db().from('agent_jobs').select(COLUMNS).in('entreprise_id', ids)
    .order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: 'Lecture impossible' });
  res.json((data || []).filter((j) => canReadJob(j, ids)).map(clientView));
});

router.get('/jobs/:id', authenticateUser, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Introuvable' });
  const ids = await memberEntreprises(req.user.id);
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
