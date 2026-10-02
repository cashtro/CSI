// Client space API (/api/espace): a company member creates mandates and
// approves deliverables. The company id always comes from the server-side
// membership lookup (utils/espace.requireMember), never from the request.
const express = require('express');
const logger = require('./utils/logger');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { requireCsrf } = require('./utils/csrf');
const { requireMember, noStore, isUuid, text, parseMandat, DECISIONS } = require('./utils/espace');

const router = express.Router();
router.use(noStore, requireCsrf, requireMember());

// New mandate request from the client form.
router.post('/mandats', async (req, res) => {
  const { mandat, error } = parseMandat(req.body);
  if (error) return res.status(400).json({ error });
  const { data, error: dbError } = await createSupabaseAdmin()
    .from('mandats')
    .insert({ ...mandat, entreprise_id: req.membership.entreprise_id, created_by: req.user.id, statut: 'actif', etape: 0 })
    .select('id')
    .single();
  if (dbError) {
    logger.error('[espace] mandat insert failed:', dbError.message);
    return res.status(500).json({ error: "Le mandat n'a pas pu être enregistré." });
  }
  logger.info(`[espace] mandat ${data.id} created by ${req.user.id}`);
  res.status(201).json({ id: data.id });
});

// Approve a deliverable or ask for changes.
router.post('/livrables/:id/decision', async (req, res) => {
  const { id } = req.params;
  const { decision } = req.body || {};
  if (!isUuid(id) || !DECISIONS.includes(decision)) return res.status(400).json({ error: 'Décision invalide.' });
  const commentaire = text(req.body.commentaire, 2000) || null;
  if (decision === 'modification_demandee' && !commentaire) {
    return res.status(400).json({ error: 'Décrivez la modification souhaitée.' });
  }

  const admin = createSupabaseAdmin();
  const entrepriseId = req.membership.entreprise_id;
  const { data: livrable, error } = await admin
    .from('livrables')
    .select('id, statut')
    .eq('id', id)
    .eq('entreprise_id', entrepriseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Another company's deliverable looks exactly like a missing one.
  if (!livrable) return res.status(404).json({ error: 'Livrable introuvable.' });
  if (livrable.statut !== 'en_attente') return res.status(409).json({ error: 'Ce livrable a déjà reçu une décision.' });

  const { error: updateError } = await admin
    .from('livrables')
    .update({ statut: decision, commentaire_client: commentaire, decided_by: req.user.id, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entreprise_id', entrepriseId);
  if (updateError) {
    logger.error('[espace] livrable decision failed:', updateError.message);
    return res.status(500).json({ error: "La décision n'a pas pu être enregistrée." });
  }
  logger.info(`[espace] livrable ${id} ${decision} by ${req.user.id}`);
  res.json({ statut: decision });
});

module.exports = router;
