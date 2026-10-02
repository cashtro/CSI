// Finances module, pure calculations (routes(api)/utils/finances.js): MRR,
// margin, Québec taxes, expense validation, alerts, CSV formula guard.
const f = require('../routes(api)/utils/finances');

const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
const price = (unit, interval = 'month', count = 1) => ({ unit_amount: unit, recurring: { interval, interval_count: count } });
const sub = (id, items, extra = {}) => ({ id, status: 'active', customer: `cus_${id}`, created: sec('2026-01-10T12:00:00Z'), items: { data: items }, ...extra });

// A paid Checkout session stored in bills, Québec taxes added by Stripe.
const bill = (id, cents, { mode = 'payment', day = '2026-09-15', sub: s = null, user = 'u1', taxed = true, breakdown = false } = {}) => {
  const tps = taxed ? Math.round(cents * 0.05) : 0;
  const tvq = taxed ? Math.round(cents * 0.09975) : 0;
  return {
    id, user_id: user, source: 'Site', created_at: `${day}T15:00:00Z`,
    payment_data: {
      id: `cs_${id}`, payment_status: 'paid', mode, currency: 'cad', subscription: s,
      amount_subtotal: cents, amount_total: cents + tps + tvq,
      total_details: {
        amount_tax: tps + tvq,
        ...(breakdown ? { breakdown: { taxes: [{ amount: tps, rate: { percentage: 5, display_name: 'TPS' } }, { amount: tvq, rate: { percentage: 9.975, display_name: 'TVQ' } }] } } : {}),
      },
    },
  };
};
const expense = (id, date, categorie, montant, tps = 0, tvq = 0) => f.normalizeExpense({ id, date, categorie, fournisseur: 'F', montant, tps, tvq });

describe('MRR', () => {
  it('normalises every plan to a monthly amount before tax', () => {
    expect(f.monthlyAmount(sub('a', [{ price: price(14900), quantity: 1 }]))).toBe(14900);
    expect(f.monthlyAmount(sub('b', [{ price: price(120000, 'year'), quantity: 1 }]))).toBe(10000);
    expect(f.monthlyAmount(sub('c', [{ price: price(30000, 'month', 3), quantity: 2 }]))).toBe(20000);
    expect(f.monthlyAmount(sub('d', [{ price: price(1000, 'week'), quantity: 1 }]))).toBe(Math.round((1000 * 52) / 12));
    expect(f.monthlyAmount(sub('e', [{ price: { unit_amount: 500 }, quantity: 1 }]))).toBe(0); // one-off price
  });

  it('counts only subscriptions live at the moment (ended ones drop out)', () => {
    const subs = [
      sub('a', [{ price: price(14900) }]),
      sub('b', [{ price: price(34900) }], { status: 'canceled', ended_at: sec('2026-06-01T00:00:00Z') }),
      sub('c', [{ price: price(5000) }], { status: 'incomplete' }),
      sub('d', [{ price: price(9900) }], { created: sec('2026-08-01T00:00:00Z') }),
    ];
    expect(f.mrrAt(subs, sec('2026-05-15T00:00:00Z'))).toBe(14900 + 34900);
    expect(f.mrrAt(subs, sec('2026-07-15T00:00:00Z'))).toBe(14900);
    expect(f.mrrAt(subs, sec('2026-09-15T00:00:00Z'))).toBe(14900 + 9900);
  });

  it('without Stripe, estimates from subscriptions paid in the last 35 days, once per subscription', () => {
    const sales = f.buildSales([
      bill('1', 14900, { mode: 'subscription', sub: 'sub_1', day: '2026-08-01' }),
      bill('2', 14900, { mode: 'subscription', sub: 'sub_1', day: '2026-09-01' }),
      bill('3', 34900, { mode: 'subscription', sub: 'sub_2', day: '2026-09-03' }),
      bill('4', 50000, { mode: 'subscription', sub: 'sub_3', day: '2026-06-01' }), // lapsed
      bill('5', 99900, { day: '2026-09-04' }), // one-off, not MRR
    ]);
    expect(f.mrrFromSales(sales, '2026-09', '2026-10-02')).toBe(14900 + 34900);
  });

  it('cancellation rate: ended during the month over live at its start, null without Stripe', () => {
    const subs = [
      sub('a', [{ price: price(100) }]),
      sub('b', [{ price: price(100) }], { status: 'canceled', ended_at: sec('2026-09-10T12:00:00Z') }),
      sub('c', [{ price: price(100) }]),
      sub('d', [{ price: price(100) }]),
    ];
    expect(f.churnRate(subs, '2026-09')).toBeCloseTo(0.25);
    expect(f.churnRate(null, '2026-09')).toBeNull();
  });
});

describe('sales and margin', () => {
  it('a sale is counted before tax, only when paid', () => {
    const s = f.saleFromBill(bill('1', 100000));
    expect(s).toMatchObject({ ht: 100000, tps: 5000, tvq: 9975, total: 114975, type: 'ponctuel', mois: '2026-09' });
    const unpaid = bill('2', 1000);
    unpaid.payment_data.payment_status = 'unpaid';
    expect(f.saleFromBill(unpaid)).toBeNull();
  });

  it('reads TPS and TVQ from the Stripe tax breakdown when present', () => {
    const s = f.saleFromBill(bill('1', 20000, { breakdown: true }));
    expect(s).toMatchObject({ tps: 1000, tvq: 1995, autresTaxes: 0, ht: 20000 });
    expect(f.classifyTaxLines([{ amount: 1300, rate: { percentage: 13, display_name: 'HST' } }])).toEqual({ tps: 0, tvq: 0, autres: 1300 });
  });

  it('does not count a Stripe invoice twice when its Checkout session is already in bills', () => {
    const b = bill('1', 14900, { mode: 'subscription', sub: 'sub_1', day: '2026-09-01' });
    b.payment_data.invoice = 'in_1';
    const inv = (id, reason, day) => ({ id, status: 'paid', amount_paid: 17131, tax: 2231, subscription: 'sub_1', billing_reason: reason, created: sec(`${day}T12:00:00Z`), currency: 'cad' });
    const sales = f.buildSales([b], [inv('in_1', 'subscription_create', '2026-09-01'), inv('in_2', 'subscription_cycle', '2026-10-01'), inv('in_x', 'subscription_create', '2026-09-01')]);
    expect(sales.map((s) => s.id).sort()).toEqual(['1', 'in_2']);
    expect(sales.find((s) => s.id === 'in_2')).toMatchObject({ ht: 14900, tps: 745, tvq: 1486, origine: 'stripe' });
  });

  it('margin = revenue - expenses - AI cost, in $ and %, with the cash flow taxes included', () => {
    const sales = f.buildSales([bill('1', 500000, { day: '2026-09-10' }), bill('2', 14900, { mode: 'subscription', sub: 's', day: '2026-09-01' })]);
    const expenses = [expense('e1', '2026-09-05', 'publicite', 1000, 50, 99.75), expense('e2', '2026-08-05', 'outils', 999)];
    const ia = f.aiByMonth([{ day: '2026-09-01', cost_usd: 10 }, { day: '2026-09-20', cost_usd: 5 }], 1.4);
    const m = f.monthSummary('2026-09', { sales, expenses, ia });
    expect(m).toMatchObject({ revenus: 514900, recurrents: 14900, ponctuels: 500000, depenses: 100000, ia: 2100, couts: 102100, marge: 412800 });
    expect(m.margePct).toBeCloseTo(412800 / 514900);
    expect(m.encaisse).toBe(Math.round(514900) + 25000 + 49875 + 745 + 1486);
    expect(m.decaisse).toBe(100000 + 5000 + 9975 + 2100);
    expect(m.flux).toBe(m.encaisse - m.decaisse);
    expect(f.monthSummary('2026-07', { sales, expenses, ia }).margePct).toBeNull();
  });

  it('counts distinct paying clients', () => {
    const sales = f.buildSales([bill('1', 100, { user: 'u1' }), bill('2', 100, { user: 'u1' }), bill('3', 100, { user: 'u2' })]);
    expect(f.payingClients('2026-09', sales, null)).toBe(2);
  });
});

describe('Québec taxes', () => {
  it('TPS 5 % and TVQ 9,975 %, rounded to the cent', () => {
    expect(f.quebecTaxes(10000)).toEqual({ tps: 500, tvq: 998 });
    expect(f.quebecTaxes(123456)).toEqual({ tps: 6173, tvq: 12315 });
    const s = f.splitTax(14975);
    expect(s).toEqual({ tps: 5000, tvq: 9975 });
  });

  it('summary: collected on sales minus paid on expenses for the period only', () => {
    const sales = f.buildSales([bill('1', 100000, { day: '2026-07-10' }), bill('2', 100000, { day: '2026-09-10' }), bill('3', 5000, { day: '2026-07-11', taxed: false })]);
    const expenses = [expense('e1', '2026-07-05', 'outils', 200, 10, 19.95), expense('e2', '2026-10-01', 'outils', 999, 49.95, 99.65)];
    const t = f.taxSummary({ sales, expenses, du: '2026-07-01', au: '2026-09-30' });
    expect(t.percues).toEqual({ tps: 10000, tvq: 19950 });
    expect(t.payees).toEqual({ tps: 1000, tvq: 1995 });
    expect(t.net).toEqual({ tps: 9000, tvq: 17955 });
    expect(t.sansTaxe).toBe(1);
  });
});

describe('expense validation', () => {
  const ok = { date: '2026-09-12', categorie: 'outils', fournisseur: '  Figma ', montant: '100.50' };
  it('accepts a valid expense and computes the taxes on request', () => {
    expect(f.parseDepense(ok).depense).toMatchObject({ fournisseur: 'Figma', montant: 100.5, tps: 0, tvq: 0, recurrente: false, piece_jointe: null });
    expect(f.parseDepense({ ...ok, taxes_auto: 'on', recurrente: 'on' }).depense).toMatchObject({ tps: 5.03, tvq: 10.02, recurrente: true });
    expect(f.parseDepense({ ...ok, montant: '12,5' }).depense.montant).toBe(12.5);
  });
  it.each([
    [{ date: '2026-02-30' }, /Date/], [{ categorie: 'cadeaux' }, /Catégorie/], [{ fournisseur: '' }, /fournisseur/],
    [{ montant: '-5' }, /Montant/], [{ montant: '1e3' }, /Montant/], [{ montant: '1.234' }, /Montant/], [{ tps: 'abc' }, /TPS/],
    [{ piece_jointe: 'javascript:alert(1)' }, /https/], [{ piece_jointe: 'http://x.ca/f.pdf' }, /https/],
  ])('refuses %j', (patch, msg) => {
    expect(f.parseDepense({ ...ok, ...patch }).error).toMatch(msg);
  });
  it('monthly targets: month AAAA-MM, revenue >= 0, margin between -100 and 100 %', () => {
    expect(f.parseObjectif({ mois: '2026-10', revenu_vise: '8000', marge_visee: '40' }).objectif).toEqual({ mois: '2026-10-01', revenu_vise: 8000, marge_visee: 40 });
    expect(f.parseObjectif({ mois: '2026-13', revenu_vise: '1', marge_visee: '1' }).error).toMatch(/Mois/);
    expect(f.parseObjectif({ mois: '2026-10', revenu_vise: '-1', marge_visee: '1' }).error).toMatch(/Revenu/);
    expect(f.parseObjectif({ mois: '2026-10', revenu_vise: '1', marge_visee: '150' }).error).toMatch(/Marge/);
  });
});

describe('alerts', () => {
  const money = (c) => `${(c / 100).toFixed(2)} $`;
  const base = { revenus: 100000, couts: 80000, margePct: 0.2 };

  it('margin below target: attention, critical from 10 points or a negative margin', () => {
    const a = f.buildAlerts({ summary: { ...base, margePct: 0.35 }, objectif: { marge_visee: 40 }, aiBudget: null, unusual: [], fmtMoney: money });
    expect(a).toEqual([expect.objectContaining({ id: 'marge', niveau: 'attention' })]);
    const b = f.buildAlerts({ summary: base, objectif: { marge_visee: 40 }, aiBudget: null, unusual: [], fmtMoney: money });
    expect(b[0]).toMatchObject({ niveau: 'critique' });
    expect(b[0].detail).toMatch(/20,0 %.*40,0 %/);
    expect(f.buildAlerts({ summary: { ...base, margePct: 0.5 }, objectif: { marge_visee: 40 }, aiBudget: null, unusual: [], fmtMoney: money })).toEqual([]);
  });

  it('AI cost above 80 % of the budget: attention, critical at 100 %', () => {
    const at = (spentUsd) => f.buildAlerts({ summary: base, objectif: null, aiBudget: { spentUsd, budgetUsd: 60 }, unusual: [], fmtMoney: money });
    expect(at(48)).toEqual([]);
    expect(at(48.5)[0]).toMatchObject({ id: 'ia', niveau: 'attention' });
    expect(at(60)[0]).toMatchObject({ id: 'ia', niveau: 'critique' });
  });

  it('unusual expense: more than 3 times the category median of the last 12 months', () => {
    const list = [
      expense('a', '2026-06-02', 'publicite', 300), expense('b', '2026-07-02', 'publicite', 400), expense('c', '2026-08-02', 'publicite', 350),
      expense('d', '2026-09-02', 'publicite', 1100), expense('e', '2026-09-03', 'publicite', 1000), expense('f', '2026-09-04', 'salaires', 1800),
    ];
    const u = f.unusualExpenses(list, '2026-09');
    expect(u.map((x) => x.depense.id)).toEqual(['d']);
    // No history: only above 2 000 $.
    expect(f.unusualExpenses([expense('g', '2026-09-01', 'autres', 2500), expense('h', '2026-09-01', 'outils', 1500)], '2026-09').map((x) => x.depense.id)).toEqual(['g']);
    const alerts = f.buildAlerts({ summary: base, objectif: null, aiBudget: null, unusual: u, fmtMoney: money });
    expect(alerts[0]).toMatchObject({ id: 'depense-d', niveau: 'attention', titre: 'Dépense inhabituelle' });
  });
});

describe('CSV', () => {
  it('prefixes text cells that a spreadsheet would run as a formula', () => {
    expect(f.csvCell('=HYPERLINK("http://x","clic")')).toBe('"\'=HYPERLINK(""http://x"",""clic"")"');
    expect(f.csvCell('+1+1')).toBe("'+1+1");
    expect(f.csvCell('-2+3')).toBe("'-2+3");
    expect(f.csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(f.csvCell('\t=1')).toBe("'\t=1");
    expect(f.csvCell('Figma')).toBe('Figma');
    expect(f.csvCell('a,b')).toBe('"a,b"');
    expect(f.csvCell(-12.5)).toBe('-12.5'); // numbers computed by the server stay numbers
    expect(f.csvCell(null)).toBe('');
  });

  it('a whole export starts with a BOM and uses CRLF', () => {
    const csv = f.toCsv(['a', 'b'], [['=x', 1]]);
    expect(csv.startsWith('﻿a,b\r\n')).toBe(true);
    expect(csv).toContain("'=x,1");
  });
});

describe('periods', () => {
  it('defaults to the month, swaps reversed dates, ignores invalid ones', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(f.parsePeriod({}, now)).toEqual({ mois: '2026-10', du: '2026-10-01', au: '2026-10-31' });
    expect(f.parsePeriod({ du: '2026-09-30', au: '2026-07-01' }, now)).toMatchObject({ du: '2026-07-01', au: '2026-09-30' });
    expect(f.parsePeriod({ mois: '2026-02', du: 'x' }, now)).toMatchObject({ mois: '2026-02', du: '2026-02-01', au: '2026-02-28' });
    expect(f.monthsBack('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});
