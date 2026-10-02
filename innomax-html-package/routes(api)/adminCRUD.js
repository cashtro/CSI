// Admin console API (/api/admin): companies, members, mandates, deliverables
// and the site CMS. Every route requires an admin who passed 2FA
// (utils/espace.requireAdmin) and a CSRF token.
const express = require('express');
const crypto = require('crypto');
const logger = require('./utils/logger');
const upload = require('./utils/multerConfig');
const cms = require('./utils/cms');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { requireCsrf } = require('./utils/csrf');
const {
  requireAdmin, noStore, isUuid, isHttpsUrl, text, parseMandat, ETAPES, STATUTS_MANDAT,
} = require('./utils/espace');

const router = express.Router();
router.use(noStore, requireCsrf, requireAdmin());

const CMS_BUCKET = process.env.CMS_BUCKET || 'site-content';

// A refused file (wrong type, too big) is the admin's mistake, not a 500.
const imageUpload = (req, res, next) =>
  upload.single('image')(req, res, (err) => (err ? res.status(400).json({ error: err.message }) : next()));

function failed(res, what, err) {
  logger.error(`[admin] ${what} failed:`, err.message || err);
  return res.status(500).json({ error: `Échec : ${what}.` });
}

// ---------------------------------------------------------------- Companies

router.post('/entreprises', async (req, res) => {
  const nom = text(req.body && req.body.nom, 200);
  const courriel = text(req.body && req.body.courriel, 200) || null;
  if (!nom) return res.status(400).json({ error: "Nom de l'entreprise requis." });
  const { data, error } = await createSupabaseAdmin()
    .from('entreprises')
    .insert({ nom, courriel, created_by: req.user.id })
    .select('id')
    .single();
  if (error) return failed(res, "création de l'entreprise", error);
  logger.info(`[admin] entreprise ${data.id} created by ${req.user.id}`);
  res.status(201).json({ id: data.id });
});

// Attach an existing account (by e-mail) to a company.
router.post('/entreprises/:id/membres', async (req, res) => {
  const { id } = req.params;
  const email = text(req.body && req.body.email, 320);
  const role = req.body && req.body.role === 'proprietaire' ? 'proprietaire' : 'membre';
  if (!isUuid(id) || !email) return res.status(400).json({ error: 'Entreprise et courriel requis.' });
  const admin = createSupabaseAdmin();
  const { data: user, error } = await admin.from('Users').select('userId').eq('email', email).maybeSingle();
  if (error) return failed(res, 'recherche du compte', error);
  if (!user) return res.status(404).json({ error: "Aucun compte avec ce courriel. La personne doit d'abord s'inscrire." });
  const { error: insertError } = await admin.from('membres').insert({ entreprise_id: id, user_id: user.userId, role });
  if (insertError) {
    if (insertError.code === '23505') return res.status(409).json({ error: 'Ce compte est déjà rattaché à une entreprise.' });
    return failed(res, 'ajout du membre', insertError);
  }
  logger.info(`[admin] user ${user.userId} added to entreprise ${id}`);
  res.status(201).json({ ok: true });
});

router.delete('/membres/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const { error } = await createSupabaseAdmin().from('membres').delete().eq('id', req.params.id);
  if (error) return failed(res, 'retrait du membre', error);
  logger.info(`[admin] membre ${req.params.id} removed by ${req.user.id}`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Mandates

router.post('/mandats', async (req, res) => {
  const entrepriseId = req.body && req.body.entreprise_id;
  if (!isUuid(entrepriseId)) return res.status(400).json({ error: 'Choisissez une entreprise.' });
  const { mandat, error } = parseMandat(req.body);
  if (error) return res.status(400).json({ error });
  const { data, error: dbError } = await createSupabaseAdmin()
    .from('mandats')
    .insert({ ...mandat, entreprise_id: entrepriseId, created_by: req.user.id, statut: 'actif', etape: 0 })
    .select('id')
    .single();
  if (dbError) return failed(res, 'création du mandat', dbError);
  res.status(201).json({ id: data.id });
});

router.patch('/mandats/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const patch = {};
  const { statut, etape } = req.body || {};
  if (statut !== undefined) {
    if (!STATUTS_MANDAT.includes(statut)) return res.status(400).json({ error: 'Statut invalide.' });
    patch.statut = statut;
  }
  if (etape !== undefined) {
    const n = Number(etape);
    if (!Number.isInteger(n) || n < 0 || n >= ETAPES.length) return res.status(400).json({ error: 'Étape invalide.' });
    patch.etape = n;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier.' });
  patch.updated_at = new Date().toISOString();
  const { error } = await createSupabaseAdmin().from('mandats').update(patch).eq('id', req.params.id);
  if (error) return failed(res, 'mise à jour du mandat', error);
  logger.info(`[admin] mandat ${req.params.id} updated by ${req.user.id}`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Deliverables

// Deposit a deliverable for a client. The mandate, when given, must belong to
// the same company.
router.post('/livrables', async (req, res) => {
  const b = req.body || {};
  const titre = text(b.titre, 200);
  if (!isUuid(b.entreprise_id) || !titre) return res.status(400).json({ error: 'Entreprise et titre requis.' });
  if (b.url && !isHttpsUrl(b.url)) return res.status(400).json({ error: 'Le lien doit commencer par https://.' });
  const admin = createSupabaseAdmin();
  let mandatId = null;
  if (b.mandat_id) {
    if (!isUuid(b.mandat_id)) return res.status(400).json({ error: 'Mandat invalide.' });
    const { data: mandat } = await admin.from('mandats').select('id').eq('id', b.mandat_id).eq('entreprise_id', b.entreprise_id).maybeSingle();
    if (!mandat) return res.status(400).json({ error: "Ce mandat n'appartient pas à cette entreprise." });
    mandatId = mandat.id;
  }
  const { data, error } = await admin
    .from('livrables')
    .insert({
      entreprise_id: b.entreprise_id,
      mandat_id: mandatId,
      titre,
      description: text(b.description, 5000) || null,
      url: b.url || null,
      produit_par: text(b.produit_par, 120) || null,
      statut: 'en_attente',
      created_by: req.user.id,
    })
    .select('id')
    .single();
  if (error) return failed(res, 'dépôt du livrable', error);
  logger.info(`[admin] livrable ${data.id} deposited for entreprise ${b.entreprise_id}`);
  res.status(201).json({ id: data.id });
});

// ---------------------------------------------------------------- Site CMS

router.put('/cms', async (req, res) => {
  const { entry, error } = cms.validateEntry(req.body);
  if (error) return res.status(400).json({ error });
  try {
    await cms.save(createSupabaseAdmin(), entry, req.user.id);
  } catch (err) {
    return failed(res, 'sauvegarde du contenu', err);
  }
  logger.info(`[admin] cms ${entry.lang}:${entry.key} saved by ${req.user.id}`);
  res.json({ ok: true });
});

// Back to the template's default text.
router.delete('/cms', async (req, res) => {
  const { key, lang } = req.body || {};
  if (typeof key !== 'string' || !cms.LANGS.includes(lang)) return res.status(400).json({ error: 'Clé ou langue invalide.' });
  try {
    await cms.remove(createSupabaseAdmin(), key, lang);
  } catch (err) {
    return failed(res, 'réinitialisation du contenu', err);
  }
  res.json({ ok: true });
});

// Upload an image (raster only, see multerConfig) and point a CMS key at it.
router.post('/cms/image', imageUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choisissez une image.' });
  if (!upload.matchesImageSignature(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({ error: "Le contenu du fichier ne correspond pas à une image JPEG, PNG, WebP, GIF ou AVIF." });
  }
  const { key, lang = 'fr' } = req.body || {};
  const check = cms.validateEntry({ key, lang, type: 'image', value: 'assets/placeholder.png' });
  if (check.error) return res.status(400).json({ error: check.error });

  const admin = createSupabaseAdmin();
  const name = `cms/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${upload.extensionFor(req.file.mimetype)}`;
  const { error: uploadError } = await admin.storage
    .from(CMS_BUCKET)
    .upload(name, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (uploadError) return failed(res, "envoi de l'image", uploadError);
  const { data: { publicUrl } } = admin.storage.from(CMS_BUCKET).getPublicUrl(name);

  const { entry, error } = cms.validateEntry({ key, lang, type: 'image', value: publicUrl });
  if (error) return res.status(400).json({ error });
  try {
    await cms.save(admin, entry, req.user.id);
  } catch (err) {
    return failed(res, "enregistrement de l'image", err);
  }
  logger.info(`[admin] cms image ${lang}:${key} uploaded by ${req.user.id}`);
  res.status(201).json({ url: publicUrl });
});

module.exports = router;
