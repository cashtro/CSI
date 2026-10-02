// Example data of the Finances tab for the local demo (scripts/demo-admin.js).
// Every row says « exemple »: client e-mails @exemple.demo, sources and
// suppliers suffixed « (exemple) », notes « Donnée d'exemple ». Nothing here
// is real money. Deterministic (seeded) so the screenshots are stable.

const crypto = require('crypto');
const { monthKey, addMonths, lastDay } = require('../../routes(api)/utils/finances');

const EX = ' (exemple)';
const NOTE = 'Donnée d’exemple';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A paid Checkout session as Stripe stores it, taxes of Québec included.
function session({ id, cents, mode, sub, email, created }) {
  const tps = Math.round(cents * 0.05);
  const tvq = Math.round(cents * 0.09975);
  return {
    id, object: 'checkout.session', mode, payment_status: 'paid', currency: 'cad',
    amount_subtotal: cents, amount_total: cents + tps + tvq,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: tps + tvq },
    subscription: sub || null, invoice: sub ? `in_ex_${id.slice(-8)}` : null,
    customer_details: { email }, created: Math.floor(Date.parse(created) / 1000),
  };
}

function seedFinancesDemo(db, now = new Date()) {
  const t = db.tables;
  const rand = rng(2026);
  const mois = monthKey(now);
  const today = Number(now.toISOString().slice(8, 10));
  const months = [];
  for (let i = 11; i >= 0; i -= 1) months.push(addMonths(mois, -i));

  const clients = ['clinique', 'boulangerie', 'garage', 'studio', 'notaire', 'fleuriste', 'cafe', 'dentiste', 'yoga'].map((n, i) => ({
    userId: `00000000-0000-4000-8000-0000000ec${String(i).padStart(3, '0')}`, email: `${n}@exemple.demo`, username: `${n} (exemple)`, isAdmin: false,
  }));
  t.Users.push(...clients);
  t.bills = t.bills || [];
  t.depenses = [];
  t.objectifs_financiers = [];

  const at = (m, day) => `${m}-${String(day).padStart(2, '0')}T15:00:00.000Z`;
  const dayIn = (m) => (m === mois ? Math.max(1, Math.min(today, 1 + Math.floor(rand() * 27))) : 1 + Math.floor(rand() * 27));

  // Subscriptions: plans at 149 $ and 349 $ a month, one new client every
  // ~2 months, one cancellation along the way.
  const subs = clients.slice(0, 7).map((c, i) => ({
    c, plan: i % 3 === 2 ? 34900 : 14900, start: Math.min(11, Math.floor(i * 1.6)), end: i === 1 ? 7 : 99, id: `sub_ex_${i}`,
  }));
  months.forEach((m, idx) => {
    subs.forEach((s) => {
      if (idx < s.start || idx >= s.end) return;
      const created = at(m, 1);
      const id = `cs_ex_${s.id}_${m.replace('-', '')}`;
      t.bills.push({ id: crypto.randomUUID(), user_id: s.c.userId, source: `Abonnement Pilotage${EX}`, created_at: created, payment_data: session({ id, cents: s.plan, mode: 'subscription', sub: s.id, email: s.c.email, created }) });
    });
    // One-off sales: websites, audits, workshops.
    const count = 1 + Math.floor(rand() * 3) + (idx > 6 ? 1 : 0);
    for (let k = 0; k < count; k += 1) {
      const c = clients[Math.floor(rand() * clients.length)];
      const [label, base] = [['Site vitrine', 240000], ['Audit Loi 25', 90000], ['Atelier IA', 60000], ['Campagne publicitaire', 150000]][Math.floor(rand() * 4)];
      const created = at(m, dayIn(m));
      const id = `cs_ex_${m.replace('-', '')}_${k}`;
      t.bills.push({ id: crypto.randomUUID(), user_id: c.userId, source: `${label}${EX}`, created_at: created, payment_data: session({ id, cents: Math.round((base * (0.8 + rand() * 0.5)) / 100) * 100, mode: 'payment', email: c.email, created }) });
    }
  });

  const dep = (m, day, categorie, fournisseur, montant, opts = {}) => {
    const taxed = opts.taxes !== false;
    t.depenses.push({
      id: crypto.randomUUID(), date: `${m}-${String(day).padStart(2, '0')}`, categorie, fournisseur: `${fournisseur}${EX}`,
      montant, tps: taxed ? Math.round(montant * 5) / 100 : 0, tvq: taxed ? Math.round(montant * 9.975) / 100 : 0,
      recurrente: Boolean(opts.recurrente), piece_jointe: opts.pj || null, note: opts.note || NOTE, created_at: `${m}-01T12:00:00.000Z`,
    });
  };
  months.forEach((m, idx) => {
    const d = (n) => (m === mois ? Math.min(n, today) : n);
    dep(m, d(1), 'outils', 'Google Workspace', 43.2, { recurrente: true, pj: 'https://example.org/exemple/facture-workspace.pdf' });
    dep(m, d(2), 'outils', 'Figma', 34.0, { recurrente: true, taxes: false, note: 'Fournisseur étranger, sans taxes (exemple)' });
    dep(m, d(1), 'ia', 'Abonnement Claude Team', 42.0, { recurrente: true, taxes: false });
    dep(m, d(1), 'salaires', 'Rémunération du fondateur', 1800, { recurrente: true, taxes: false });
    if (m !== mois || today >= 2) dep(m, d(2), 'publicite', 'Meta Ads', Math.round(250 + rand() * 450), {});
    if (idx % 3 === 1) dep(m, d(18), 'sous_traitance', 'Graphiste pigiste', Math.round(600 + rand() * 900), {});
    if (idx % 4 === 0) dep(m, d(22), 'autres', 'Frais bancaires', 18.5, { taxes: false });
  });
  // An unusual expense this month: triggers the alert.
  dep(mois, Math.min(2, today), 'publicite', 'Google Ads, campagne d’automne', 3200, { note: 'Dépense inhabituelle volontaire (exemple)' });

  // AI engine cost (USD) spread over the months; this month above 80 % of
  // the 60 $ US budget, to show the alert.
  // Own model name, so the agent demo's rows (same day) stay untouched.
  t.agent_usage = t.agent_usage || [];
  months.forEach((m, idx) => {
    const usd = m === mois ? 50.2 : Math.round((8 + idx * 3.2 + rand() * 6) * 100) / 100;
    t.agent_usage.push({ day: `${m}-01`, model: 'exemple-finances', calls: Math.round(usd * 40), tokens_in: Math.round(usd * 180000), tokens_out: Math.round(usd * 40000), cost_usd: usd });
  });

  // Targets of the last four months (the current one included).
  [[-3, 6000, 35], [-2, 6500, 35], [-1, 7000, 38], [0, 8000, 40]].forEach(([off, rev, marge]) => {
    t.objectifs_financiers.push({ mois: `${addMonths(mois, off)}-01`, revenu_vise: rev, marge_visee: marge, updated_at: new Date().toISOString() });
  });
  return { mois, fin: lastDay(mois) };
}

module.exports = { seedFinancesDemo };
