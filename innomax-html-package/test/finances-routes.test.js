// Finances tab and API: admin + 2FA only, CSRF on every mutation, expense
// CRUD, revenue never taken from the browser, CSV formula guard, page
// rendered without inline script or style and with escaped text.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';
require('./helpers/quiet');

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

jest.mock('../routes(api)/utils/supabaseUtil', () => require('./helpers/fakeSupabase').module);
const fake = require('./helpers/fakeSupabase');
const cms = require('../routes(api)/utils/cms');
const { signMfaProof } = require('../routes(api)/utils/twofa');
const { monthKey } = require('../routes(api)/utils/finances');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(cookieParser());
app.use(express.json());
app.use(cms.middleware);
app.use('/api/admin/finances', require('../routes(api)/financesAdmin'));
app.use(require('../routes(api)/espacePages'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const DEP_ID = '22222222-2222-4222-8222-222222222222';
const mois = monthKey(new Date());
const CSRF = 'csrf-test-token';
let adminCookie;
let noMfaCookie;
beforeAll(() => {
  adminCookie = `accessToken=tok-admin; mfa=${signMfaProof('user-admin', Date.now() + 600000)}; XSRF-TOKEN=${CSRF}`;
  noMfaCookie = `accessToken=tok-admin; XSRF-TOKEN=${CSRF}`;
});

const paidBill = (id, cents, day) => ({
  id, user_id: 'user-a', source: 'Site <b>vitrine</b>', created_at: `${day}T15:00:00.000Z`,
  payment_data: { id: `cs_${id}`, mode: 'payment', payment_status: 'paid', currency: 'cad', amount_subtotal: cents, amount_total: cents + Math.round(cents * 0.14975), total_details: { amount_tax: Math.round(cents * 0.14975) } },
});

beforeEach(() => {
  fake.reset({
    tokens: { 'tok-admin': { id: 'user-admin', email: 'admin@pbtm.ca' }, 'tok-a': { id: 'user-a', email: 'a@acme.ca' } },
    tables: {
      Users: [{ userId: 'user-admin', email: 'admin@pbtm.ca', isAdmin: true }, { userId: 'user-a', email: 'a@acme.ca', isAdmin: false }],
      entreprises: [], membres: [], mandats: [], livrables: [], site_content: [],
      bills: [paidBill('b1', 100000, `${mois}-01`)],
      depenses: [{ id: DEP_ID, date: `${mois}-01`, categorie: 'publicite', fournisseur: '=HYPERLINK("https://evil.example","x") <script>', montant: 200, tps: 10, tvq: 19.95, recurrente: false, piece_jointe: null, note: '@SUM(A1)' }],
      objectifs_financiers: [{ mois: `${mois}-01`, revenu_vise: 5000, marge_visee: 80 }],
      agent_usage: [{ day: `${mois}-01`, model: 'm', cost_usd: 55 }],
      agent_settings: [{ id: 1, monthly_budget_usd: 60 }],
    },
  });
  cms._reset();
});

const asAdmin = (r) => r.set('Cookie', adminCookie).set('X-CSRF-Token', CSRF);
const validDepense = { date: `${mois}-03`, categorie: 'outils', fournisseur: 'Figma', montant: '30', taxes_auto: 'on' };

describe('access', () => {
  const routes = [
    ['get', '/api/admin/finances/resume'],
    ['get', '/api/admin/finances/export?type=depenses'],
    ['post', '/api/admin/finances/depenses'],
    ['put', `/api/admin/finances/depenses/${DEP_ID}`],
    ['delete', `/api/admin/finances/depenses/${DEP_ID}`],
    ['put', '/api/admin/finances/objectifs'],
  ];

  it.each(routes)('%s %s -> 401 without a session', async (method, url) => {
    const res = await request(app)[method](url).set('Cookie', `XSRF-TOKEN=${CSRF}`).set('X-CSRF-Token', CSRF).send({});
    expect(res.status).toBe(401);
  });

  it.each(routes)('%s %s -> 403 for a non-admin', async (method, url) => {
    const res = await request(app)[method](url).set('Cookie', `accessToken=tok-a; XSRF-TOKEN=${CSRF}`).set('X-CSRF-Token', CSRF).send(validDepense);
    expect(res.status).toBe(403);
    expect(fake.state.tables.depenses).toHaveLength(1);
  });

  it.each(routes)('%s %s -> 403 for an admin without the 2FA proof', async (method, url) => {
    const res = await request(app)[method](url).set('Cookie', noMfaCookie).set('X-CSRF-Token', CSRF).send(validDepense);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Double authentification/);
  });

  it('the page is refused to visitors, non-admins and an admin without 2FA', async () => {
    const visitor = await request(app).get('/admin/console?vue=finances');
    expect(visitor.status).toBe(302);
    const member = await request(app).get('/admin/console?vue=finances').set('Cookie', 'accessToken=tok-a');
    expect(member.status).toBe(403);
    expect(member.text).not.toContain('finances.js');
    const noMfa = await request(app).get('/admin/console?vue=finances').set('Cookie', 'accessToken=tok-admin');
    expect(noMfa.status).toBe(403);
  });
});

describe('expenses CRUD with CSRF', () => {
  it('refuses a mutation without the CSRF header, or with a wrong one', async () => {
    const none = await request(app).post('/api/admin/finances/depenses').set('Cookie', adminCookie).send(validDepense);
    expect(none.status).toBe(403);
    expect(none.body.error).toMatch(/CSRF/);
    const wrong = await request(app).delete(`/api/admin/finances/depenses/${DEP_ID}`).set('Cookie', adminCookie).set('X-CSRF-Token', 'other');
    expect(wrong.status).toBe(403);
    expect(fake.state.tables.depenses).toHaveLength(1);
  });

  it('creates, edits and deletes an expense; taxes computed by the server', async () => {
    const created = await asAdmin(request(app).post('/api/admin/finances/depenses')).send({ ...validDepense, id: 'forced', created_by: 'someone-else' });
    expect(created.status).toBe(201);
    const row = fake.state.tables.depenses.find((d) => d.id === created.body.id);
    expect(row).toMatchObject({ fournisseur: 'Figma', montant: 30, tps: 1.5, tvq: 2.99, created_by: 'user-admin' });
    expect(created.body.id).not.toBe('forced');

    const edited = await asAdmin(request(app).put(`/api/admin/finances/depenses/${created.body.id}`)).send({ ...validDepense, taxes_auto: undefined, montant: '45.10', tps: '0', tvq: '0', recurrente: 'on' });
    expect(edited.status).toBe(200);
    expect(fake.state.tables.depenses.find((d) => d.id === created.body.id)).toMatchObject({ montant: 45.1, tps: 0, recurrente: true });

    const missing = await asAdmin(request(app).put('/api/admin/finances/depenses/33333333-3333-4333-8333-333333333333')).send(validDepense);
    expect(missing.status).toBe(404);

    const deleted = await asAdmin(request(app).delete(`/api/admin/finances/depenses/${created.body.id}`));
    expect(deleted.status).toBe(200);
    expect(fake.state.tables.depenses.map((d) => d.id)).toEqual([DEP_ID]);
  });

  it('validates the input and the id', async () => {
    const bad = await asAdmin(request(app).post('/api/admin/finances/depenses')).send({ ...validDepense, piece_jointe: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    const badId = await asAdmin(request(app).delete('/api/admin/finances/depenses/not-a-uuid'));
    expect(badId.status).toBe(400);
  });

  it('saves a monthly target (upsert by month)', async () => {
    const res = await asAdmin(request(app).put('/api/admin/finances/objectifs')).send({ mois, revenu_vise: '9000', marge_visee: '35' });
    expect(res.status).toBe(200);
    expect(fake.state.tables.objectifs_financiers).toEqual([expect.objectContaining({ mois: `${mois}-01`, revenu_vise: 9000, marge_visee: 35 })]);
  });
});

describe('revenue is computed on the server', () => {
  it('no route accepts a revenue amount', async () => {
    for (const url of ['/api/admin/finances/revenus', '/api/admin/finances/ventes', '/api/admin/finances/kpi']) {
      const res = await asAdmin(request(app).post(url)).send({ montant: 999999 });
      expect(res.status).toBe(404);
    }
  });

  it('the summary comes from bills, expenses and agent_usage, with the alerts', async () => {
    const res = await asAdmin(request(app).get('/api/admin/finances/resume?montant=999999&revenus=1'));
    expect(res.status).toBe(200);
    expect(res.body.kpi).toMatchObject({ revenus: 100000, depenses: 20000, clients: 1 });
    expect(res.body.kpi.ia).toBe(Math.round(55 * 1.38 * 100));
    expect(res.body.taxes.percues).toEqual({ tps: 5000, tvq: 9975 });
    expect(res.body.alertes.map((a) => a.id)).toEqual(expect.arrayContaining(['marge', 'ia']));
  });
});

describe('CSV export', () => {
  it('neutralises formulas in text cells', async () => {
    const res = await asAdmin(request(app).get(`/api/admin/finances/export?type=depenses&du=${mois}-01&au=${mois}-28`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="finances-depenses-/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('"\'=HYPERLINK(');
    expect(res.text).toContain("'@SUM(A1)");
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(res.text).not.toMatch(/(^|,)@SUM/m);
  });

  it('exports revenue, invoices and taxes; refuses an unknown type', async () => {
    for (const type of ['revenus', 'factures', 'taxes']) {
      const res = await asAdmin(request(app).get(`/api/admin/finances/export?type=${type}`));
      expect(res.status).toBe(200);
    }
    const taxes = await asAdmin(request(app).get('/api/admin/finances/export?type=taxes'));
    expect(taxes.text).toMatch(/À valider par ton comptable/);
    expect((await asAdmin(request(app).get('/api/admin/finances/export?type=Users'))).status).toBe(400);
  });
});

describe('Finances page', () => {
  it('renders for an admin with 2FA, without inline script, style or handlers', async () => {
    const res = await request(app).get('/admin/console?vue=finances').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('<script src="/assets/js/finances.js" defer></script>');
    expect(res.text).toContain('<link rel="stylesheet" href="/assets/css/finances.css">');
    expect(res.text).toMatch(/href="\/admin\/console\?vue=finances" aria-current="page"/);
    expect(res.text).not.toMatch(/style=/);
    expect(res.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(res.text).not.toMatch(/\son[a-z]+=/i);
    expect(res.text).toContain('À valider par ton comptable');
    expect(res.text).toContain('Coût IA au-dessus de 80 % du budget');
  });

  it('escapes stored text', async () => {
    const res = await request(app).get('/admin/console?vue=finances').set('Cookie', adminCookie);
    expect(res.text).toContain('&lt;script&gt;');
    expect(res.text).not.toContain('<script>');
    expect(res.text).toContain('Site &lt;b&gt;vitrine&lt;/b&gt;');
  });

  it('explains how to create the tables when db/007 was not run', async () => {
    const { loadFinances } = require('../routes(api)/utils/finances');
    const q = (table) => {
      const result = ['depenses', 'objectifs_financiers'].includes(table)
        ? { data: null, error: { message: 'relation does not exist' } }
        : { data: [], error: null };
      const chain = { select: () => chain, limit: () => chain, eq: () => chain, then: (res, rej) => Promise.resolve(result).then(res, rej) };
      return chain;
    };
    const fin = await loadFinances({ from: q });
    expect(fin.tableManquante).toMatch(/db\/007_finances\.sql/);
    expect(fin.kpi.revenus).toBe(0);
  });

  it('other tabs do not load the finances assets', async () => {
    const res = await request(app).get('/admin/console?vue=paiements').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('finances.js');
  });
});

describe('finances assets', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'css', 'finances.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'finances.js'), 'utf8');

  it('the stylesheet uses theme tokens only', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(code).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|lab)\(/i);
    expect(code).not.toMatch(/:\s*(white|black|red|blue|green|gold|yellow|orange|gray|grey)\b/i);
    expect(code).toContain('@media (max-width: 760px)');
    expect(code).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('the script writes text with textContent only', () => {
    const code = js.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(code).not.toMatch(/\beval\(|new Function|\bconsole\./);
  });
});
