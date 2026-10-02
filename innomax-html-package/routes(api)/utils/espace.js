// Espace entreprises: access guards and data loaders shared by the client
// space (espaceCRUD.js), the admin console (adminCRUD.js) and their pages.
//
// Every query runs with the service client and filters on the company id the
// SERVER resolved from the signed-in user, never on an id sent by the browser.
// RLS (db/002_espace_entreprises.sql) is the second wall for direct API calls.

const { createSupabaseAdmin } = require('./supabaseUtil');
const { getValidUser } = require('./auth-middleware');
const { verifyMfaProof, MFA_COOKIE } = require('./twofa');
const logger = require('./logger');

// Display names of the five steps (the database stores the index 0-4).
const ETAPES = ['Reçu', 'Diagnostic', 'En production', 'Révision', 'Livré'];
const STATUTS_MANDAT = ['actif', 'en_pause', 'termine', 'annule'];
const DECISIONS = ['approuve', 'modification_demandee'];
// Deliverable statuses the client never sees: a robot's result waiting for
// PBTM's validation, or refused by PBTM.
const LIVRABLES_INTERNES = ['a_valider', 'refuse'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

function deny(res, page, status, message, view) {
  if (!page) return res.status(status).json({ error: message });
  if (status === 401) return res.redirect('/login');
  return res.status(status).render(view || 'espace-refus', { message });
}

async function getMembership(admin, userId) {
  const { data, error } = await admin
    .from('membres')
    .select('entreprise_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// Signed-in member of a company. Pages without a company still render (with
// an explanation); API calls are refused.
function requireMember({ page = false } = {}) {
  return async (req, res, next) => {
    const { user } = await getValidUser(req, res);
    if (!user) return deny(res, page, 401, 'Connexion requise.');
    const membership = await getMembership(createSupabaseAdmin(), user.id);
    req.user = user;
    req.membership = membership;
    if (!membership && !page) return deny(res, page, 403, "Votre compte n'est rattaché à aucune entreprise.");
    next();
  };
}

// Admin (Users.isAdmin, read with the service key) who passed 2FA in this
// browser (signed 'mfa' cookie set by verify-2fa).
function requireAdmin({ page = false } = {}) {
  return async (req, res, next) => {
    const { user } = await getValidUser(req, res);
    if (!user) return deny(res, page, 401, 'Connexion requise.');
    const { data, error } = await createSupabaseAdmin()
      .from('Users')
      .select('isAdmin')
      .eq('userId', user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.isAdmin !== true) {
      logger.warn(`[admin] refused non-admin user ${user.id} on ${req.method} ${req.originalUrl}`);
      return deny(res, page, 403, 'Accès réservé aux administrateurs.');
    }
    if (!verifyMfaProof(req.cookies && req.cookies[MFA_COOKIE], user.id)) {
      return deny(res, page, 403, 'Double authentification requise : reconnectez-vous avec votre code 2FA.');
    }
    req.user = user;
    next();
  };
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// What a client may see of a Stripe Checkout session stored in bills.
function summarizeBill(bill) {
  const p = bill.payment_data || {};
  const date = bill.created_at || (p.created ? new Date(p.created * 1000).toISOString() : null);
  return {
    id: bill.id,
    date,
    source: bill.source || '',
    type: p.mode === 'subscription' ? 'Abonnement' : 'Achat',
    montant: typeof p.amount_total === 'number' ? p.amount_total / 100 : null,
    devise: String(p.currency || 'cad').toUpperCase(),
    statut: p.payment_status === 'paid' ? 'Payé' : String(p.payment_status || '—'),
    facture: typeof p.invoice === 'string' ? p.invoice : (p.invoice && p.invoice.id) || null,
    reference: typeof p.id === 'string' ? p.id.slice(-10) : '',
  };
}

const byDateDesc = (a, b) => String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || ''));

async function rows(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadEspace(admin, entrepriseId) {
  const [entreprise] = await rows(admin.from('entreprises').select('id, nom, courriel, created_at').eq('id', entrepriseId));
  const membres = await rows(admin.from('membres').select('user_id, role').eq('entreprise_id', entrepriseId));
  const mandats = await rows(admin.from('mandats').select('*').eq('entreprise_id', entrepriseId));
  // A robot's deliverable stays hidden until PBTM validated it (ROBOTS.md).
  const livrables = (await rows(admin.from('livrables').select('*').eq('entreprise_id', entrepriseId)))
    .filter((l) => !LIVRABLES_INTERNES.includes(l.statut));
  const ids = membres.map((m) => m.user_id);
  const bills = ids.length ? await rows(admin.from('bills').select('*').in('user_id', ids).limit(500)) : [];
  const achats = bills.map(summarizeBill).sort(byDateDesc);
  return {
    entreprise: entreprise || null,
    mandats: mandats.sort(byDateDesc),
    livrables: livrables.sort(byDateDesc),
    achats,
    totaux: {
      paye: achats.reduce((sum, a) => sum + (a.statut === 'Payé' && a.montant ? a.montant : 0), 0),
      abonnements: achats.filter((a) => a.type === 'Abonnement').length,
      enAttente: livrables.filter((l) => l.statut === 'en_attente').length,
      mandatsActifs: mandats.filter((m) => m.statut === 'actif').length,
    },
  };
}

async function loadAdmin(admin) {
  const entreprises = await rows(admin.from('entreprises').select('*'));
  const membres = await rows(admin.from('membres').select('*'));
  const users = await rows(admin.from('Users').select('userId, email, username, isAdmin').limit(1000));
  const mandats = await rows(admin.from('mandats').select('*'));
  const livrables = await rows(admin.from('livrables').select('*'));
  const bills = await rows(admin.from('bills').select('*').limit(1000));
  const nomEntreprise = Object.fromEntries(entreprises.map((e) => [e.id, e.nom]));
  const entrepriseDe = Object.fromEntries(membres.map((m) => [m.user_id, m.entreprise_id]));
  const emailDe = Object.fromEntries(users.map((u) => [u.userId, u.email]));
  return {
    entreprises: entreprises
      .map((e) => ({ ...e, membres: membres.filter((m) => m.entreprise_id === e.id).map((m) => ({ ...m, email: emailDe[m.user_id] || m.user_id })) }))
      .sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr')),
    clients: users.map((u) => ({ ...u, entreprise: nomEntreprise[entrepriseDe[u.userId]] || null })),
    paiements: bills
      .map((b) => ({ ...summarizeBill(b), email: emailDe[b.user_id] || null, entreprise: nomEntreprise[entrepriseDe[b.user_id]] || null }))
      .sort(byDateDesc),
    mandats: mandats.map((m) => ({ ...m, entreprise: nomEntreprise[m.entreprise_id] || '—' })).sort(byDateDesc),
    livrables: livrables.map((l) => ({ ...l, entreprise: nomEntreprise[l.entreprise_id] || '—' })).sort(byDateDesc),
  };
}

// Validated mandate from a client form. Returns { mandat } or { error }.
function parseMandat(body) {
  const titre = text(body && body.titre, 200);
  if (!titre) return { error: 'Donnez un titre au mandat.' };
  const description = text(body.description, 5000) || null;
  let budget = null;
  if (body.budget !== undefined && body.budget !== null && body.budget !== '') {
    budget = Number(body.budget);
    if (!Number.isFinite(budget) || budget < 0 || budget > 1e9) return { error: 'Budget invalide.' };
  }
  let echeance = null;
  if (body.echeance) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.echeance) || Number.isNaN(Date.parse(body.echeance))) return { error: 'Date invalide.' };
    echeance = body.echeance;
  }
  return { mandat: { titre, description, budget, echeance } };
}

function isHttpsUrl(v) {
  if (typeof v !== 'string' || v.length > 2000) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

// Display helpers passed to the templates as `fmt`.
const fmt = {
  money(n, devise = 'CAD') {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    try {
      return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: devise }).format(n);
    } catch {
      return `${n.toFixed(2)} ${devise}`;
    }
  },
  // Catalogue price: no cents when the amount is round (349 $, 12,50 $).
  prix(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    const round = Number.isInteger(n);
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: round ? 0 : 2, maximumFractionDigits: round ? 0 : 2 }).format(n);
  },
  jour(d) {
    const t = d ? new Date(d) : null;
    if (!t || Number.isNaN(t.getTime())) return '—';
    // A bare date (échéance) is a calendar day, not a UTC instant.
    const timeZone = /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? 'UTC' : 'America/Toronto';
    return t.toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone });
  },
  statut: {
    actif: '🚀 Actif', en_pause: '⏸️ En pause', termine: '✅ Terminé', annule: '✖️ Annulé',
    en_attente: '👀 À approuver', a_valider: '🕵️ À valider (PBTM)', refuse: '🚫 Refusé (PBTM)', approuve: '🎉 Approuvé', modification_demandee: '✏️ Modification demandée',
  },
  etapeEmoji: ['📝', '🔍', '🛠️', '🔁', '✅'],
  // Greeting by the hour in Québec: morning, afternoon, evening.
  salut(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Toronto' }).formatToParts(now);
    const h = Number((parts.find((p) => p.type === 'hour') || {}).value);
    if (h >= 5 && h < 12) return '☀️ Bonjour';
    if (h >= 12 && h < 18) return '🌤️ Bon après-midi';
    return '🌙 Bonsoir';
  },
};

module.exports = {
  fmt,
  ETAPES, STATUTS_MANDAT, DECISIONS, LIVRABLES_INTERNES,
  isUuid, isHttpsUrl, text, noStore,
  getMembership, requireMember, requireAdmin,
  summarizeBill, loadEspace, loadAdmin, parseMandat,
};
