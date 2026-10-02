// Finances API of the admin console (/api/admin/finances, FINANCES.md).
// Admin who passed 2FA (utils/espace.requireAdmin), CSRF header on every
// mutation. Only expenses and monthly targets are written from the browser;
// revenue is always computed on the server from bills and Stripe.
const express = require('express');
const logger = require('./utils/logger');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { requireCsrf } = require('./utils/csrf');
const { requireAdmin, noStore, isUuid, fmt } = require('./utils/espace');
const finances = require('./utils/finances');
const { fetchStripeFinance } = require('./utils/finances-stripe');

const router = express.Router();
router.use(noStore, requireCsrf, requireAdmin());

function failed(res, what, err) {
  logger.error(`[finances] ${what} failed:`, err.message || err);
  return res.status(500).json({ error: `Échec : ${what}.` });
}

const money = (cents) => fmt.money(cents / 100);

async function load(req) {
  return finances.loadFinances(createSupabaseAdmin(), {
    mois: req.query.mois, du: req.query.du, au: req.query.au,
    stripe: await fetchStripeFinance(),
    usdToCad: process.env.FINANCES_USD_CAD,
    fmtMoney: money,
  });
}

// ---------------------------------------------------------------- Read

// KPIs, alerts and taxes of a month as JSON.
router.get('/resume', async (req, res) => {
  const fin = await load(req);
  res.json({ periode: fin.periode, kpi: fin.kpi, alertes: fin.alerts, taxes: fin.taxes, serie: fin.serie });
});

// CSV of a table for the chosen period: revenus | depenses | factures | taxes.
router.get('/export', async (req, res) => {
  const type = String(req.query.type || '');
  if (!['revenus', 'depenses', 'factures', 'taxes'].includes(type)) return res.status(400).json({ error: 'Export inconnu.' });
  const fin = await load(req);
  const csv = finances.csvFor(type, fin);
  logger.info(`[finances] export ${type} ${fin.periode.du}..${fin.periode.au} by ${req.user.id}`);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="finances-${type}-${fin.periode.du}-${fin.periode.au}.csv"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(csv);
});

// ---------------------------------------------------------------- Expenses

router.post('/depenses', async (req, res) => {
  const { depense, error } = finances.parseDepense(req.body);
  if (error) return res.status(400).json({ error });
  const { data, error: dbError } = await createSupabaseAdmin()
    .from('depenses')
    .insert({ ...depense, created_by: req.user.id })
    .select('id')
    .single();
  if (dbError) return failed(res, 'ajout de la dépense', dbError);
  logger.info(`[finances] depense ${data.id} added by ${req.user.id}`);
  res.status(201).json({ id: data.id });
});

// Full replacement: the edit form sends every field.
router.put('/depenses/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const { depense, error } = finances.parseDepense(req.body);
  if (error) return res.status(400).json({ error });
  const admin = createSupabaseAdmin();
  const { data: existing, error: readError } = await admin.from('depenses').select('id').eq('id', req.params.id).maybeSingle();
  if (readError) return failed(res, 'lecture de la dépense', readError);
  if (!existing) return res.status(404).json({ error: 'Dépense introuvable.' });
  const { error: dbError } = await admin.from('depenses').update({ ...depense, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  if (dbError) return failed(res, 'modification de la dépense', dbError);
  logger.info(`[finances] depense ${req.params.id} updated by ${req.user.id}`);
  res.json({ ok: true });
});

router.delete('/depenses/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const { error } = await createSupabaseAdmin().from('depenses').delete().eq('id', req.params.id);
  if (error) return failed(res, 'suppression de la dépense', error);
  logger.info(`[finances] depense ${req.params.id} deleted by ${req.user.id}`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Targets

router.put('/objectifs', async (req, res) => {
  const { objectif, error } = finances.parseObjectif(req.body);
  if (error) return res.status(400).json({ error });
  const { error: dbError } = await createSupabaseAdmin()
    .from('objectifs_financiers')
    .upsert({ ...objectif, updated_at: new Date().toISOString(), updated_by: req.user.id }, { onConflict: 'mois' });
  if (dbError) return failed(res, "enregistrement de l'objectif", dbError);
  logger.info(`[finances] objectif ${objectif.mois} saved by ${req.user.id}`);
  res.json({ ok: true });
});

router.delete('/objectifs/:mois', async (req, res) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.params.mois)) return res.status(400).json({ error: 'Mois invalide.' });
  const { error } = await createSupabaseAdmin().from('objectifs_financiers').delete().eq('mois', `${req.params.mois}-01`);
  if (error) return failed(res, "suppression de l'objectif", error);
  res.json({ ok: true });
});

module.exports = router;
