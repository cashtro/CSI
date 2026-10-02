// Admin API of the robots (/api/admin/robots, ROBOTS.md): the catalogue and
// the validation of the robots' deliverables. Same guard as the rest of the
// console: admin (Users.isAdmin) who passed 2FA in this browser, plus CSRF.
//
//   POST /api/admin/robots                         create an offer
//   PUT  /api/admin/robots/:slug                   edit an offer (activate, order…)
//   POST /api/admin/robots/seed                    add the 6 starting robots that are missing
//   POST /api/admin/robots/livrables/:id/validation  publish to the client or refuse

const express = require('express');
const logger = require('./utils/logger');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { requireCsrf } = require('./utils/csrf');
const { requireAdmin, noStore, isUuid, text } = require('./utils/espace');
const robots = require('./utils/robots');

const router = express.Router();
router.use(noStore, requireCsrf, requireAdmin());

function failed(res, what, err) {
  logger.error(`[admin robots] ${what} failed:`, err.message || err);
  return res.status(500).json({ error: `Échec : ${what}.` });
}

router.post('/', async (req, res) => {
  const { offre, error } = robots.parseOffre(req.body);
  if (error) return res.status(400).json({ error });
  const now = new Date().toISOString();
  const { error: dbError } = await createSupabaseAdmin().from('robots_offres').insert({ ...offre, created_at: now, updated_at: now });
  if (dbError) {
    if (dbError.code === '23505') return res.status(409).json({ error: 'Un robot porte déjà cet identifiant.' });
    return failed(res, 'création du robot', dbError);
  }
  logger.info(`[admin robots] offer ${offre.slug} created by ${req.user.id}`);
  res.status(201).json({ slug: offre.slug });
});

router.post('/seed', async (req, res) => {
  try {
    const r = await robots.seedRobots(createSupabaseAdmin());
    logger.info(`[admin robots] seed: ${r.ajoutes} added by ${req.user.id}`);
    res.json(r);
  } catch (err) {
    failed(res, 'import des robots de départ', err);
  }
});

router.put('/:slug', async (req, res) => {
  if (!robots.SLUG.test(req.params.slug)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const body = { ...(req.body || {}) };
  delete body.slug; // the identifier never changes (subscriptions point at it)
  // A form posts every field; an unchecked "actif" box is simply absent.
  if (body.nom !== undefined && body.actif === undefined) body.actif = false;
  const { offre, error } = robots.parseOffre(body, { partial: true });
  if (error) return res.status(400).json({ error });
  if (!Object.keys(offre).length) return res.status(400).json({ error: 'Rien à modifier.' });
  const admin = createSupabaseAdmin();
  const { data, error: dbError } = await admin.from('robots_offres')
    .update({ ...offre, updated_at: new Date().toISOString() }).eq('slug', req.params.slug).select('slug');
  if (dbError) return failed(res, 'mise à jour du robot', dbError);
  if (!data || !data.length) return res.status(404).json({ error: 'Robot introuvable.' });
  logger.info(`[admin robots] offer ${req.params.slug} updated by ${req.user.id}`);
  res.json({ ok: true });
});

// A robot's deliverable: 'a_valider' -> 'en_attente' (the client sees it and
// decides) or 'refuse' (never shown). The text may be corrected first.
router.post('/livrables/:id/validation', async (req, res) => {
  const { id } = req.params;
  const decision = req.body && req.body.decision;
  if (!isUuid(id) || !['publier', 'refuser'].includes(decision)) return res.status(400).json({ error: 'Décision invalide.' });
  const patch = { statut: decision === 'publier' ? 'en_attente' : 'refuse' };
  if (decision === 'publier' && typeof req.body.contenu === 'string') {
    const contenu = req.body.contenu.trim().slice(0, 100000);
    if (!contenu) return res.status(400).json({ error: 'Le livrable ne peut pas être vide.' });
    patch.contenu = contenu;
  }
  const titre = text(req.body && req.body.titre, 200);
  if (decision === 'publier' && titre) patch.titre = titre;
  // Conditional on the status: of two clicks, only the first one counts.
  const { data, error } = await createSupabaseAdmin().from('livrables').update(patch).eq('id', id).eq('statut', 'a_valider').select('id');
  if (error) return failed(res, 'validation du livrable', error);
  if (!data || !data.length) return res.status(409).json({ error: 'Ce livrable n’est plus à valider.' });
  logger.info(`[admin robots] livrable ${id} ${patch.statut} by ${req.user.id}`);
  res.json({ statut: patch.statut });
});

module.exports = router;
