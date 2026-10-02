// Finances module of the admin console (FINANCES.md).
//
// Every amount is computed HERE, on the server, from the stored records:
//   - sales: Stripe Checkout sessions kept in public.bills (webhook), plus the
//     paid Stripe invoices of renewals when the Stripe API is reachable;
//   - expenses: public.depenses (entered by the admin, db/007_finances.sql);
//   - AI cost: public.agent_usage (agent engine, US dollars);
//   - targets: public.objectifs_financiers.
// The browser never sends a revenue amount. Money is handled in integer cents
// to avoid floating-point drift; months follow Québec time.

// Same rules as utils/espace (text, isHttpsUrl), kept here so this module
// loads without a Supabase client (pure functions, demo data, tests).
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function isHttpsUrl(v) {
  if (typeof v !== 'string' || v.length > 2000) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

const TZ = 'America/Toronto';
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const CATEGORIES = ['outils', 'ia', 'publicite', 'sous_traitance', 'salaires', 'autres'];
const CATEGORIE_LABEL = {
  outils: 'Outils', ia: 'IA', publicite: 'Publicité', sous_traitance: 'Sous-traitance', salaires: 'Salaires', autres: 'Autres',
};
const ACTIVE_SUB = ['active', 'trialing', 'past_due'];
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// ------------------------------------------------------------------ dates

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function dayKey(d) {
  if (typeof d === 'string' && DAY_RE.test(d)) return d;
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}
const monthKey = (d) => { const k = dayKey(d); return k ? k.slice(0, 7) : null; };

function isValidDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
}

function addMonths(mois, n) {
  const [y, m] = mois.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
function lastDay(mois) {
  const [y, m] = mois.split('-').map(Number);
  return `${mois}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
function monthsBack(mois, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(addMonths(mois, -i));
  return out;
}
const moisCourt = (mois) => `${MOIS_COURTS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(2, 4)}`;
const moisLong = (mois) => `${MOIS_LONGS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`;
const inPeriod = (day, du, au) => Boolean(day) && day >= du && day <= au;

// Period of the tables, taxes and CSV export (?du=&au=), one month by default.
function parsePeriod(q = {}, now = new Date()) {
  const mois = MONTH_RE.test(q.mois || '') ? q.mois : monthKey(now);
  let du = isValidDay(q.du) ? q.du : `${mois}-01`;
  let au = isValidDay(q.au) ? q.au : lastDay(mois);
  if (du > au) [du, au] = [au, du];
  return { mois, du, au };
}

// Shortcuts offered above the tables.
function periodPresets(now = new Date()) {
  const m = monthKey(now);
  const y = m.slice(0, 4);
  const q = Math.floor((Number(m.slice(5, 7)) - 1) / 3);
  const qStart = `${y}-${String(q * 3 + 1).padStart(2, '0')}`;
  return [
    { id: 'mois', label: 'Ce mois', du: `${m}-01`, au: lastDay(m) },
    { id: 'precedent', label: 'Mois dernier', du: `${addMonths(m, -1)}-01`, au: lastDay(addMonths(m, -1)) },
    { id: 'trimestre', label: 'Ce trimestre', du: `${qStart}-01`, au: lastDay(addMonths(qStart, 2)) },
    { id: 'annee', label: 'Cette année', du: `${y}-01-01`, au: `${y}-12-31` },
    { id: '12mois', label: '12 derniers mois', du: `${addMonths(m, -11)}-01`, au: lastDay(m) },
  ];
}

// ------------------------------------------------------------------ money

const toCents = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

// Québec sales taxes on an amount before tax (cents), each rounded to the cent.
function quebecTaxes(htCents) {
  const tps = Math.round(htCents * TPS_RATE);
  const tvq = Math.round(htCents * TVQ_RATE);
  return { tps, tvq };
}

// Split a combined tax amount (cents) into TPS and TVQ by their rates.
function splitTax(taxCents) {
  const tps = Math.round((taxCents * TPS_RATE) / (TPS_RATE + TVQ_RATE));
  return { tps, tvq: taxCents - tps };
}

// Tax lines of a Stripe object: total_details.breakdown.taxes (Checkout) or
// total_tax_amounts / total_taxes (invoices). Unrecognised rates (HST of
// another province...) go to `autres`.
function classifyTaxLines(lines) {
  const out = { tps: 0, tvq: 0, autres: 0 };
  for (const l of lines) {
    const amount = Number(l && l.amount) || 0;
    const rate = (l && (l.rate || l.tax_rate || (l.tax_rate_details && l.tax_rate_details.tax_rate))) || {};
    const pct = Number(rate.percentage !== undefined ? rate.percentage : rate.effective_percentage);
    const name = String(rate.display_name || rate.tax_type || '').toUpperCase();
    if (pct === 5 || /\b(GST|TPS)\b/.test(name)) out.tps += amount;
    else if (Math.abs(pct - 9.975) < 0.001 || /\b(QST|TVQ)\b/.test(name)) out.tvq += amount;
    else out.autres += amount;
  }
  return out;
}

function taxesOf(totalTax, lines) {
  if (Array.isArray(lines) && lines.length) return classifyTaxLines(lines);
  if (isInt(totalTax) && totalTax > 0) return { ...splitTax(totalTax), autres: 0 };
  return { tps: 0, tvq: 0, autres: 0 };
}

// ------------------------------------------------------------------ sales

// A paid Checkout session stored in bills -> one sale, or null.
function saleFromBill(bill, emailDe = {}) {
  const p = (bill && bill.payment_data) || {};
  if (p.payment_status !== 'paid' || !isInt(p.amount_total)) return null;
  const details = p.total_details || {};
  const taxKnown = isInt(details.amount_tax);
  const tax = taxKnown ? details.amount_tax : 0;
  const t = taxesOf(tax, details.breakdown && details.breakdown.taxes);
  // amount_total = subtotal - discounts + tax, so the amount before tax is:
  const ht = p.amount_total - tax;
  const date = bill.created_at || (p.created ? new Date(p.created * 1000).toISOString() : null);
  const jour = dayKey(date);
  if (!jour) return null;
  const subscription = typeof p.subscription === 'string' ? p.subscription : (p.subscription && p.subscription.id) || null;
  const customer = typeof p.customer === 'string' ? p.customer : (p.customer && p.customer.id) || null;
  return {
    id: String(bill.id),
    origine: 'bills',
    jour,
    mois: jour.slice(0, 7),
    type: p.mode === 'subscription' ? 'abonnement' : 'ponctuel',
    client: bill.user_id || customer || (p.customer_details && p.customer_details.email) || `vente:${bill.id}`,
    email: emailDe[bill.user_id] || (p.customer_details && p.customer_details.email) || null,
    objet: bill.source || '',
    devise: String(p.currency || 'cad').toUpperCase(),
    ht, tps: t.tps, tvq: t.tvq, autresTaxes: t.autres, total: p.amount_total,
    taxeInconnue: !taxKnown,
    abonnement: subscription,
    facture: typeof p.invoice === 'string' ? p.invoice : (p.invoice && p.invoice.id) || null,
    reference: typeof p.id === 'string' ? p.id.slice(-10) : '',
  };
}

// A paid Stripe invoice -> one sale, or null.
function saleFromInvoice(inv) {
  if (!inv || inv.status !== 'paid' || !isInt(inv.amount_paid)) return null;
  const created = inv.status_transitions && inv.status_transitions.paid_at ? inv.status_transitions.paid_at : inv.created;
  const jour = dayKey(new Date(Number(created) * 1000));
  if (!jour) return null;
  const lines = inv.total_taxes || inv.total_tax_amounts;
  const sumLines = Array.isArray(lines) ? lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) : null;
  const tax = isInt(inv.tax) ? inv.tax : sumLines;
  const t = taxesOf(tax || 0, lines);
  const subscription = typeof inv.subscription === 'string' ? inv.subscription : (inv.subscription && inv.subscription.id) || null;
  const customer = typeof inv.customer === 'string' ? inv.customer : (inv.customer && inv.customer.id) || null;
  return {
    id: String(inv.id),
    origine: 'stripe',
    jour,
    mois: jour.slice(0, 7),
    type: subscription ? 'abonnement' : 'ponctuel',
    client: customer || inv.customer_email || `facture:${inv.id}`,
    email: inv.customer_email || null,
    objet: inv.billing_reason === 'subscription_cycle' ? 'Renouvellement' : 'Facture Stripe',
    devise: String(inv.currency || 'cad').toUpperCase(),
    ht: inv.amount_paid - t.tps - t.tvq - t.autres, tps: t.tps, tvq: t.tvq, autresTaxes: t.autres, total: inv.amount_paid,
    taxeInconnue: tax === null || tax === undefined,
    abonnement: subscription,
    facture: inv.id,
    reference: String(inv.number || inv.id).slice(-12),
  };
}

// Sales from bills plus the Stripe invoices not already counted through a
// Checkout session (same invoice id, or the first invoice of a subscription
// that a bill already records).
function buildSales(bills, invoices = [], emailDe = {}) {
  const fromBills = bills.map((b) => saleFromBill(b, emailDe)).filter(Boolean);
  const seenInvoices = new Set(fromBills.map((s) => s.facture).filter(Boolean));
  const seenSubs = new Set(fromBills.map((s) => s.abonnement).filter(Boolean));
  const fromStripe = (invoices || [])
    .filter((inv) => inv && !seenInvoices.has(inv.id))
    .filter((inv) => !(inv.billing_reason === 'subscription_create' && seenSubs.has(typeof inv.subscription === 'string' ? inv.subscription : inv.subscription && inv.subscription.id)))
    .map(saleFromInvoice)
    .filter(Boolean);
  return [...fromBills, ...fromStripe].sort((a, b) => b.jour.localeCompare(a.jour));
}

// ------------------------------------------------------------------ MRR

// Monthly amount (cents, before tax) of a Stripe subscription.
function monthlyAmount(sub) {
  const items = (sub && sub.items && sub.items.data) || [];
  let cents = 0;
  for (const it of items) {
    const price = it.price || it.plan || {};
    const unit = Number(price.unit_amount !== undefined ? price.unit_amount : price.amount) || 0;
    const rec = price.recurring || { interval: price.interval, interval_count: price.interval_count };
    const count = Number(rec.interval_count) || 1;
    const amount = unit * (Number(it.quantity) || 1);
    const perMonth = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[rec.interval];
    if (perMonth === undefined) continue;
    cents += (amount * perMonth) / count;
  }
  return Math.round(cents);
}

const endOf = (sub) => {
  if (sub.ended_at) return Number(sub.ended_at);
  if (sub.status === 'canceled' || sub.status === 'incomplete_expired') return Number(sub.canceled_at || sub.created);
  return null;
};

// MRR at a moment (seconds), from Stripe subscriptions.
function mrrAt(subs, atSec) {
  return subs.reduce((sum, s) => {
    const end = endOf(s);
    const startedSec = Number(s.start_date || s.created);
    const live = startedSec <= atSec && (end === null || end > atSec) && !['incomplete', 'incomplete_expired'].includes(s.status);
    return sum + (live ? monthlyAmount(s) : 0);
  }, 0);
}

const monthEndSec = (mois) => Math.floor(Date.parse(`${lastDay(mois)}T23:59:59-05:00`) / 1000);
const monthStartSec = (mois) => Math.floor(Date.parse(`${mois}-01T00:00:00-05:00`) / 1000);

// Without the Stripe API: a subscription counts in the MRR of a month when it
// was paid in the 35 days before the end of that month (monthly plans).
// Clearly an estimate, labelled as such.
function mrrFromSales(sales, mois, nowDay) {
  const end = mois === (nowDay || '').slice(0, 7) ? nowDay : lastDay(mois);
  const start = new Date(Date.parse(`${end}T12:00:00Z`) - 35 * 86400000).toISOString().slice(0, 10);
  const latest = {};
  for (const s of sales) {
    if (s.type !== 'abonnement' || s.devise !== 'CAD' || s.jour > end || s.jour <= start) continue;
    const key = s.abonnement || s.client;
    if (!latest[key] || latest[key].jour < s.jour) latest[key] = s;
  }
  return Object.values(latest).reduce((sum, s) => sum + s.ht, 0);
}

function mrrSeries(months, { subs, sales, nowDay }) {
  return months.map((m) => {
    if (subs) {
      const at = m === nowDay.slice(0, 7) ? Math.floor(Date.now() / 1000) : monthEndSec(m);
      return { mois: m, mrr: mrrAt(subs, at) };
    }
    return { mois: m, mrr: mrrFromSales(sales, m, nowDay) };
  });
}

// Cancellation rate of a month: subscriptions ended during the month over
// subscriptions live at its start. Needs the Stripe API; null otherwise.
function churnRate(subs, mois) {
  if (!subs) return null;
  const start = monthStartSec(mois);
  const end = monthEndSec(mois);
  const atStart = subs.filter((s) => Number(s.start_date || s.created) < start && (endOf(s) === null || endOf(s) >= start));
  if (!atStart.length) return null;
  const ended = atStart.filter((s) => endOf(s) !== null && endOf(s) <= end).length;
  return ended / atStart.length;
}

// ------------------------------------------------------------------ expenses

function normalizeExpense(r) {
  const jour = dayKey(r.date);
  if (!jour) return null;
  const ht = toCents(r.montant);
  const tps = toCents(r.tps);
  const tvq = toCents(r.tvq);
  return {
    id: r.id,
    jour,
    mois: jour.slice(0, 7),
    categorie: CATEGORIES.includes(r.categorie) ? r.categorie : 'autres',
    fournisseur: r.fournisseur || '',
    ht, tps, tvq, total: ht + tps + tvq,
    recurrente: r.recurrente === true,
    piece_jointe: isHttpsUrl(r.piece_jointe) ? r.piece_jointe : null,
    note: r.note || '',
  };
}

// Validated expense from the admin form. Returns { depense } or { error }.
// Amounts are in dollars with at most 2 decimals; with taxes_auto the TPS and
// TVQ are computed from the amount before tax.
function parseDepense(body) {
  const b = body || {};
  if (!isValidDay(b.date)) return { error: 'Date invalide (AAAA-MM-JJ).' };
  if (!CATEGORIES.includes(b.categorie)) return { error: 'Catégorie invalide.' };
  const fournisseur = text(b.fournisseur, 200);
  if (!fournisseur) return { error: 'Indiquez le fournisseur.' };
  const money = (v, label, required) => {
    if (v === undefined || v === null || v === '') return required ? { error: `${label} requis.` } : { value: 0 };
    const s = String(v).trim().replace(',', '.');
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return { error: `${label} invalide (nombre positif, 2 décimales au plus).` };
    const n = Number(s);
    if (n > 10000000) return { error: `${label} trop élevé.` };
    return { value: n };
  };
  const montant = money(b.montant, 'Montant', true);
  if (montant.error) return { error: montant.error };
  let tps = money(b.tps, 'TPS');
  if (tps.error) return { error: tps.error };
  let tvq = money(b.tvq, 'TVQ');
  if (tvq.error) return { error: tvq.error };
  const auto = b.taxes_auto === true || b.taxes_auto === 'on' || b.taxes_auto === 'true';
  if (auto) {
    const t = quebecTaxes(Math.round(montant.value * 100));
    tps = { value: t.tps / 100 };
    tvq = { value: t.tvq / 100 };
  }
  const pj = typeof b.piece_jointe === 'string' ? b.piece_jointe.trim() : '';
  if (pj && !isHttpsUrl(pj)) return { error: 'La pièce jointe doit être un lien https://.' };
  const recurrente = b.recurrente === true || b.recurrente === 'on' || b.recurrente === 'true';
  return {
    depense: {
      date: b.date, categorie: b.categorie, fournisseur,
      montant: montant.value, tps: tps.value, tvq: tvq.value,
      recurrente, piece_jointe: pj || null, note: text(b.note, 2000) || null,
    },
  };
}

// Validated monthly target. marge_visee is a percentage of revenue.
function parseObjectif(body) {
  const b = body || {};
  if (!MONTH_RE.test(b.mois || '')) return { error: 'Mois invalide (AAAA-MM).' };
  const revenu = Number(String(b.revenu_vise === undefined ? '' : b.revenu_vise).replace(',', '.'));
  if (b.revenu_vise === '' || !Number.isFinite(revenu) || revenu < 0 || revenu > 1e9) return { error: 'Revenu visé invalide.' };
  const marge = Number(String(b.marge_visee === undefined ? '' : b.marge_visee).replace(',', '.'));
  if (b.marge_visee === '' || !Number.isFinite(marge) || marge < -100 || marge > 100) return { error: 'Marge visée invalide (entre -100 et 100 %).' };
  return { objectif: { mois: `${b.mois}-01`, revenu_vise: Math.round(revenu * 100) / 100, marge_visee: Math.round(marge * 100) / 100 } };
}

// ------------------------------------------------------------------ month

// AI engine cost per month in CAD cents (agent_usage is in USD).
function aiByMonth(usage, usdToCad) {
  const out = {};
  for (const r of usage || []) {
    const m = monthKey(r.day);
    if (!m) continue;
    out[m] = (out[m] || 0) + (Number(r.cost_usd) || 0);
  }
  const cad = {};
  for (const [m, usd] of Object.entries(out)) cad[m] = { usd, cents: Math.round(usd * usdToCad * 100) };
  return cad;
}

function monthSummary(mois, { sales, expenses, ia }) {
  const s = sales.filter((x) => x.mois === mois && x.devise === 'CAD');
  const e = expenses.filter((x) => x.mois === mois);
  const sum = (list, k) => list.reduce((t, x) => t + x[k], 0);
  const revenus = sum(s, 'ht');
  const recurrents = sum(s.filter((x) => x.type === 'abonnement'), 'ht');
  const depenses = sum(e, 'ht');
  const iaCents = (ia[mois] && ia[mois].cents) || 0;
  const couts = depenses + iaCents;
  const marge = revenus - couts;
  const encaisse = sum(s, 'total');
  const decaisse = sum(e, 'total') + iaCents;
  return {
    mois, revenus, recurrents, ponctuels: revenus - recurrents,
    depenses, ia: iaCents, iaUsd: (ia[mois] && ia[mois].usd) || 0, couts, marge,
    margePct: revenus > 0 ? marge / revenus : null,
    encaisse, decaisse, flux: encaisse - decaisse,
    ventes: s.length,
  };
}

// Distinct paying clients of a month: a paid sale that month, or a live
// Stripe subscription.
function payingClients(mois, sales, subs) {
  const set = new Set(sales.filter((s) => s.mois === mois).map((s) => s.client));
  if (subs) {
    const at = monthEndSec(mois);
    for (const s of subs) {
      const end = endOf(s);
      if (ACTIVE_SUB.includes(s.status) && Number(s.start_date || s.created) <= at && (end === null || end > at)) {
        set.add(typeof s.customer === 'string' ? s.customer : (s.customer && s.customer.id) || s.id);
      }
    }
  }
  return set.size;
}

// ------------------------------------------------------------------ taxes

function taxSummary({ sales, expenses, du, au }) {
  const s = sales.filter((x) => inPeriod(x.jour, du, au) && x.devise === 'CAD');
  const e = expenses.filter((x) => inPeriod(x.jour, du, au));
  const sum = (list, k) => list.reduce((t, x) => t + x[k], 0);
  const percues = { tps: sum(s, 'tps'), tvq: sum(s, 'tvq') };
  const payees = { tps: sum(e, 'tps'), tvq: sum(e, 'tvq') };
  return {
    du, au,
    ventesTaxables: sum(s, 'ht'),
    achatsHt: sum(e, 'ht'),
    percues, payees,
    net: { tps: percues.tps - payees.tps, tvq: percues.tvq - payees.tvq },
    sansTaxe: s.filter((x) => x.taxeInconnue || x.tps + x.tvq === 0).length,
    autresTaxes: sum(s, 'autresTaxes'),
    horsCad: sales.filter((x) => inPeriod(x.jour, du, au) && x.devise !== 'CAD').length,
  };
}

// ------------------------------------------------------------------ alerts

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

// An expense is unusual when it is more than 3 times the median of its
// category over the 12 previous months (at least 3 earlier expenses), or,
// without that history, when it exceeds 2 000 $ before tax.
function unusualExpenses(expenses, mois) {
  const from = addMonths(mois, -12);
  return expenses
    .filter((e) => e.mois === mois)
    .map((e) => {
      const past = expenses.filter((x) => x.categorie === e.categorie && x.mois < mois && x.mois >= from && x.id !== e.id).map((x) => x.ht);
      if (past.length >= 3) {
        const med = median(past);
        return med > 0 && e.ht > 3 * med ? { depense: e, raison: `plus de 3 fois la médiane de la catégorie (${n1(e.ht / med)} ×)` } : null;
      }
      return e.ht > 200000 ? { depense: e, raison: 'montant élevé sans historique dans la catégorie' } : null;
    })
    .filter(Boolean);
}

const n1 = (x) => x.toLocaleString('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = (x) => x.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// niveau: 'bon' | 'attention' | 'critique'.
function buildAlerts({ summary, objectif, aiBudget, unusual, fmtMoney }) {
  const alerts = [];
  if (objectif && summary.margePct !== null) {
    const vise = Number(objectif.marge_visee) / 100;
    if (summary.margePct < vise) {
      const ecart = (vise - summary.margePct) * 100;
      alerts.push({
        id: 'marge',
        niveau: summary.margePct < 0 || ecart >= 10 ? 'critique' : 'attention',
        titre: 'Marge sous l’objectif',
        detail: `Marge brute de ${n1(summary.margePct * 100)} % pour un objectif de ${n1(vise * 100)} % (écart de ${n1(ecart)} points).`,
      });
    }
  } else if (summary.revenus === 0 && summary.couts > 0) {
    alerts.push({ id: 'marge', niveau: 'critique', titre: 'Aucun revenu ce mois', detail: `Des coûts de ${fmtMoney(summary.couts)} sans revenu encaissé.` });
  }
  if (aiBudget && aiBudget.budgetUsd > 0) {
    const part = aiBudget.spentUsd / aiBudget.budgetUsd;
    if (part > 0.8) {
      alerts.push({
        id: 'ia',
        niveau: part >= 1 ? 'critique' : 'attention',
        titre: 'Coût IA au-dessus de 80 % du budget',
        detail: `${n2(aiBudget.spentUsd)} $ US dépensés sur ${n2(aiBudget.budgetUsd)} $ US (${Math.round(part * 100)} %).`,
      });
    }
  }
  for (const u of unusual) {
    alerts.push({
      id: `depense-${u.depense.id}`,
      niveau: 'attention',
      titre: 'Dépense inhabituelle',
      detail: `${u.depense.fournisseur} (${CATEGORIE_LABEL[u.depense.categorie]}) : ${fmtMoney(u.depense.ht)}, ${u.raison}.`,
    });
  }
  return alerts;
}

// ------------------------------------------------------------------ CSV

// Spreadsheets run a cell that starts with = + - @ (or a tab / carriage
// return) as a formula: prefix such text with an apostrophe. Numbers computed
// by the server are written as plain numbers.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (header, rows) => `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
const dollars = (cents) => Math.round(cents) / 100;

function csvFor(type, fin) {
  const { du, au } = fin.periode;
  if (type === 'revenus') {
    return toCsv(['date', 'client', 'type', 'objet', 'origine', 'devise', 'avant_taxes', 'tps', 'tvq', 'autres_taxes', 'total', 'reference'],
      fin.ventesPeriode.map((s) => [s.jour, s.email || s.client, s.type, s.objet, s.origine, s.devise, dollars(s.ht), dollars(s.tps), dollars(s.tvq), dollars(s.autresTaxes), dollars(s.total), s.reference]));
  }
  if (type === 'depenses') {
    return toCsv(['date', 'categorie', 'fournisseur', 'avant_taxes', 'tps', 'tvq', 'total', 'recurrente', 'piece_jointe', 'note'],
      fin.depensesPeriode.map((e) => [e.jour, CATEGORIE_LABEL[e.categorie], e.fournisseur, dollars(e.ht), dollars(e.tps), dollars(e.tvq), dollars(e.total), e.recurrente ? 'oui' : 'non', e.piece_jointe || '', e.note]));
  }
  if (type === 'factures') {
    return toCsv(['date', 'numero', 'client', 'statut', 'total', 'devise', 'lien'],
      fin.factures.map((f) => [f.jour, f.numero, f.client, f.statut, dollars(f.total), f.devise, f.url || '']));
  }
  if (type === 'taxes') {
    const t = fin.taxes;
    return toCsv(['periode', 'ligne', 'tps', 'tvq'], [
      [`${du} au ${au}`, 'Taxes perçues sur les ventes', dollars(t.percues.tps), dollars(t.percues.tvq)],
      [`${du} au ${au}`, 'Taxes payées sur les dépenses (CTI / RTI)', dollars(t.payees.tps), dollars(t.payees.tvq)],
      [`${du} au ${au}`, 'Net à remettre (négatif = remboursement)', dollars(t.net.tps), dollars(t.net.tvq)],
      [`${du} au ${au}`, 'À valider par ton comptable', '', ''],
    ]);
  }
  return null;
}

// ------------------------------------------------------------------ loader

async function rowsOrMissing(query) {
  const { data, error } = await query;
  if (error) return { rows: [], missing: true, message: error.message };
  return { rows: data || [], missing: false };
}

// Everything the Finances tab shows, computed from the database (and the
// Stripe data when given). opts: { mois, du, au, now, stripe, usdToCad }.
async function loadFinances(admin, opts = {}) {
  const now = opts.now || new Date();
  const periode = parsePeriod(opts, now);
  const usdToCad = Number(opts.usdToCad) > 0 ? Number(opts.usdToCad) : 1.38;
  const [bills, depenses, objectifs, usage, settings, users] = await Promise.all([
    rowsOrMissing(admin.from('bills').select('*').limit(5000)),
    rowsOrMissing(admin.from('depenses').select('*').limit(5000)),
    rowsOrMissing(admin.from('objectifs_financiers').select('*').limit(240)),
    rowsOrMissing(admin.from('agent_usage').select('day, model, cost_usd').limit(5000)),
    rowsOrMissing(admin.from('agent_settings').select('monthly_budget_usd').eq('id', 1)),
    rowsOrMissing(admin.from('Users').select('userId, email').limit(5000)),
  ]);
  const emailDe = Object.fromEntries(users.rows.map((u) => [u.userId, u.email]));
  const stripe = opts.stripe || null;
  const subs = stripe && Array.isArray(stripe.subscriptions) ? stripe.subscriptions : null;
  const invoices = stripe && Array.isArray(stripe.invoices) ? stripe.invoices : [];

  const sales = buildSales(bills.rows, invoices, emailDe);
  const expenses = depenses.rows.map(normalizeExpense).filter(Boolean).sort((a, b) => b.jour.localeCompare(a.jour));
  const ia = aiByMonth(usage.rows, usdToCad);
  const nowDay = dayKey(now);
  const mois = periode.mois;
  const months = monthsBack(mois, 12);
  const ctx = { sales, expenses, ia };

  const serie = months.map((m) => monthSummary(m, ctx));
  const summary = serie[serie.length - 1];
  const mrr = mrrSeries(months, { subs, sales, nowDay });
  const clients = payingClients(mois, sales, subs);

  const objectifsParMois = Object.fromEntries(objectifs.rows.map((o) => [String(o.mois).slice(0, 7), o]));
  const objectif = objectifsParMois[mois] || null;
  const budgetUsd = Number(settings.rows[0] && settings.rows[0].monthly_budget_usd);
  const aiBudget = {
    budgetUsd: Number.isFinite(budgetUsd) ? budgetUsd : 60,
    spentUsd: (ia[mois] && ia[mois].usd) || 0,
  };
  const fmtMoney = opts.fmtMoney || ((c) => `${(c / 100).toFixed(2)} $`);
  const unusual = unusualExpenses(expenses, mois);
  const alerts = buildAlerts({ summary, objectif, aiBudget, unusual, fmtMoney });

  // Breakdown of the month's costs by category (AI engine on its own line).
  const repartition = CATEGORIES.map((c) => ({
    id: c, label: CATEGORIE_LABEL[c], cents: expenses.filter((e) => e.mois === mois && e.categorie === c).reduce((t, e) => t + e.ht, 0),
  }));
  repartition.push({ id: 'moteur', label: 'IA du moteur (agents)', cents: summary.ia });

  const factures = invoices.length
    ? invoices.filter((inv) => inv && inv.id).map((inv) => {
      const jour = dayKey(new Date(Number(inv.created) * 1000));
      return {
        jour, numero: inv.number || inv.id, client: inv.customer_email || inv.customer_name || '—',
        statut: inv.status || '—', total: Number(inv.total) || 0, devise: String(inv.currency || 'cad').toUpperCase(),
        url: isHttpsUrl(inv.hosted_invoice_url) ? inv.hosted_invoice_url : null, origine: 'stripe',
      };
    }).filter((f) => inPeriod(f.jour, periode.du, periode.au))
    : sales.filter((s) => s.facture && inPeriod(s.jour, periode.du, periode.au)).map((s) => ({
      jour: s.jour, numero: s.facture, client: s.email || '—', statut: 'payée', total: s.total, devise: s.devise, url: null, origine: 'bills',
    }));

  const objectifsListe = Object.keys(objectifsParMois).sort().reverse().slice(0, 24).map((m) => {
    const o = objectifsParMois[m];
    const reel = monthSummary(m, ctx);
    const vise = toCents(o.revenu_vise);
    return {
      mois: m, label: moisLong(m), revenuVise: vise, margeVisee: Number(o.marge_visee),
      revenu: reel.revenus, ecart: reel.revenus - vise, margePct: reel.margePct,
      ecartMarge: reel.margePct === null ? null : reel.margePct * 100 - Number(o.marge_visee),
      atteint: reel.revenus >= vise && (reel.margePct !== null && reel.margePct * 100 >= Number(o.marge_visee)),
    };
  });

  const missing = [depenses, objectifs].some((r) => r.missing);
  return {
    periode,
    moisLabel: moisLong(mois),
    presets: periodPresets(now),
    source: { stripe: Boolean(stripe), mrrEstime: !subs, usdToCad },
    tableManquante: missing ? 'Les tables depenses et objectifs_financiers sont introuvables : exécutez db/007_finances.sql.' : null,
    kpi: {
      ...summary,
      mrr: mrr[mrr.length - 1].mrr,
      clients,
      revenuMoyen: clients ? Math.round(summary.revenus / clients) : null,
      churn: churnRate(subs, mois),
    },
    serie: serie.map((m, i) => ({ mois: m.mois, label: moisCourt(m.mois), revenus: m.revenus, couts: m.couts, marge: m.marge, mrr: mrr[i].mrr })),
    repartition,
    objectif: objectif ? { revenuVise: toCents(objectif.revenu_vise), margeVisee: Number(objectif.marge_visee) } : null,
    objectifs: objectifsListe,
    aiBudget,
    alerts,
    taxes: taxSummary({ sales, expenses, du: periode.du, au: periode.au }),
    ventesPeriode: sales.filter((s) => inPeriod(s.jour, periode.du, periode.au)),
    depensesPeriode: expenses.filter((e) => inPeriod(e.jour, periode.du, periode.au)),
    factures,
  };
}

module.exports = {
  TPS_RATE, TVQ_RATE, CATEGORIES, CATEGORIE_LABEL,
  dayKey, monthKey, addMonths, lastDay, monthsBack, moisCourt, moisLong, parsePeriod, periodPresets, isValidDay,
  quebecTaxes, splitTax, classifyTaxLines,
  saleFromBill, saleFromInvoice, buildSales,
  monthlyAmount, mrrAt, mrrFromSales, mrrSeries, churnRate,
  normalizeExpense, parseDepense, parseObjectif,
  aiByMonth, monthSummary, payingClients, taxSummary,
  unusualExpenses, buildAlerts,
  csvCell, toCsv, csvFor,
  loadFinances,
};
