// The agent tabs of /admin/console: admin + 2FA only, rendered without inline
// script or style (CSP), wired to the static script and stylesheet, and the
// stylesheet uses theme tokens only.
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
const { AGENT_VUES } = require('../routes(api)/espacePages');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(cookieParser());
app.use(cms.middleware);
app.use(require('../routes(api)/espacePages'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const ENT = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  fake.reset({
    tokens: { 'tok-admin': { id: 'user-admin', email: 'admin@pandora.ca' }, 'tok-a': { id: 'user-a', email: 'a@acme.ca' } },
    tables: {
      Users: [{ userId: 'user-admin', email: 'admin@pandora.ca', isAdmin: true }, { userId: 'user-a', email: 'a@acme.ca', isAdmin: false }],
      entreprises: [{ id: ENT, nom: 'Acme <Inc>' }],
      membres: [{ id: 'm', entreprise_id: ENT, user_id: 'user-a', role: 'proprietaire' }],
      mandats: [], livrables: [], bills: [], site_content: [],
      agents: [
        { id: 'conseil-strategie', name: 'Cap', team: 'conseil', role: 'Consultant <b>stratégie</b>', active: true },
        { id: 'contenu-strategie', name: 'Plume', team: 'contenu', role: 'Directrice de contenu', active: true },
      ],
    },
  });
  cms._reset();
});

let adminCookie;
beforeAll(() => { adminCookie = `accessToken=tok-admin; mfa=${signMfaProof('user-admin', Date.now() + 60000)}`; });

describe('agent tabs of the admin console', () => {
  it('lists the five tabs', () => {
    expect(AGENT_VUES).toEqual(['agents', 'conseil', 'travail', 'recherche', 'reglages-agents']);
  });

  it.each(AGENT_VUES)('%s: refused to visitors, non-admins and an admin without the 2FA proof', async (vue) => {
    const visitor = await request(app).get(`/admin/console?vue=${vue}`);
    expect(visitor.status).toBe(302);
    expect(visitor.headers.location).toBe('/login');
    const member = await request(app).get(`/admin/console?vue=${vue}`).set('Cookie', 'accessToken=tok-a');
    expect(member.status).toBe(403);
    expect(member.text).not.toContain('agents-console.js');
    const noMfa = await request(app).get(`/admin/console?vue=${vue}`).set('Cookie', 'accessToken=tok-admin');
    expect(noMfa.status).toBe(403);
    expect(noMfa.text).toMatch(/Double authentification/);
  });

  it.each(AGENT_VUES)('%s: renders for an admin with 2FA, without inline script or style', async (vue) => {
    const res = await request(app).get(`/admin/console?vue=${vue}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain(`data-agents-vue="${vue}"`);
    expect(res.text).toContain('<script src="/assets/js/agents-console.js" defer></script>');
    expect(res.text).toContain('<link rel="stylesheet" href="/assets/css/agents-console.css">');
    expect(res.text).not.toMatch(/style=/);
    expect(res.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(res.text).not.toMatch(/\son[a-z]+=/i);
    // The nav shows every agent tab, the current one marked.
    for (const v of AGENT_VUES) expect(res.text).toContain(`href="/admin/console?vue=${v}"`);
    expect(res.text).toMatch(new RegExp(`href="/admin/console\\?vue=${vue}" aria-current="page"`));
  });

  it('escapes agent and company names in the forms', async () => {
    const res = await request(app).get('/admin/console?vue=agents').set('Cookie', adminCookie);
    expect(res.text).toContain('Consultant &lt;b&gt;stratégie&lt;/b&gt;');
    expect(res.text).toContain('Acme &lt;Inc&gt;');
    expect(res.text).not.toContain('<b>stratégie</b>');
  });

  it('preselects Cap for research and offers dictation on the large fields', async () => {
    const res = await request(app).get('/admin/console?vue=recherche').set('Cookie', adminCookie);
    expect(res.text).toMatch(/<option value="conseil-strategie" selected>Cap/);
    expect(res.text).toMatch(/<input id="ag-r-q"[^>]*data-dictee/);
    expect(res.headers['permissions-policy']).toBe('microphone=(self), camera=(), geolocation=()');
    const order = await request(app).get('/admin/console?vue=agents').set('Cookie', adminCookie);
    expect(order.text).toMatch(/<textarea id="ag-o-text"[^>]*data-dictee/);
    const council = await request(app).get('/admin/console?vue=conseil').set('Cookie', adminCookie);
    expect(council.text).toMatch(/<textarea id="ag-c-sujet"[^>]*data-dictee/);
  });

  it('offers the starting agents in the settings, with the count read from the seed file', async () => {
    const res = await request(app).get('/admin/console?vue=reglages-agents').set('Cookie', adminCookie);
    expect(res.text).toContain(`Importer les ${require('../agents/catalog').seedCount()} agents de départ`);
    expect(res.text).toContain('Importer les 49 agents de départ');
    expect(res.text).toContain('Arrêt d’urgence');
  });

  it('names the brand from brandName only (PBTM by default), never Pandora', async () => {
    for (const vue of AGENT_VUES) {
      const res = await request(app).get(`/admin/console?vue=${vue}`).set('Cookie', adminCookie);
      expect(res.text).toContain('data-brand="PBTM"');
      expect(res.text.replace(/pandorabrains/gi, '')).not.toMatch(/Pandora/);
    }
    app.locals.brandName = 'Nova & Co';
    try {
      const res = await request(app).get('/admin/console?vue=agents').set('Cookie', adminCookie);
      expect(res.text).toContain('data-brand="Nova &amp; Co"');
      expect(res.text).toContain('Pour Nova &amp; Co (aucun client précis)');
    } finally {
      delete app.locals.brandName;
    }
  });

  it('groups the admin tabs in Entreprise, Agents and Croissance, with a phone menu', async () => {
    const res = await request(app).get('/admin/console?vue=recherche').set('Cookie', adminCookie);
    const desk = res.text.slice(res.text.indexOf('class="wrap tabs-groupes"'), res.text.indexOf('class="wrap tabs-menu"'));
    const groups = [...desk.matchAll(/<span class="tab-group-label" id="tg-\d">([^<]+)<\/span>([\s\S]*?)<\/div>\s*<\/div>/g)]
      .map((m) => [m[1], [...m[2].matchAll(/\?vue=([a-z-]+)/g)].map((x) => x[1])]);
    expect(groups).toEqual([
      ['Entreprise', ['apercu', 'entreprises', 'clients', 'paiements', 'finances', 'mandats', 'livrables']],
      ['Agents', ['agents', 'conseil', 'travail', 'recherche', 'robots', 'reglages-agents']],
      ['Croissance', ['croissance', 'cms']],
    ]);
    expect(res.text).toMatch(/<details class="wrap tabs-menu">/);
    expect(res.text).toMatch(/tab-group is-current" role="group" aria-labelledby="tg-1"/);
    expect((res.text.match(/href="\/admin\/console\?vue=recherche" aria-current="page"/g) || []).length).toBe(2);
  });

  it('other tabs do not load the agent script', async () => {
    const res = await request(app).get('/admin/console?vue=mandats').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('agents-console.js');
  });
});

describe('agent tab assets', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'css', 'agents-console.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'agents-console.js'), 'utf8');

  it('the stylesheet writes no colour by hand, only theme tokens', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(code).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|lab)\(/i);
    expect(code).not.toMatch(/:\s*(white|black|red|blue|green|gold|yellow|orange|gray|grey)\b/i);
    expect(code).toContain('@media (prefers-reduced-motion: reduce)');
    expect(code).toContain('@media (max-width: 760px)');
  });

  it('the script writes text with textContent only and keeps https links only', () => {
    const code = js.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(code).not.toMatch(/\bconsole\./);
    expect(code).not.toMatch(/\beval\(|new Function/);
    expect(js).toMatch(/protocol === 'https:'/);
    expect(js).toMatch(/new EventSource\(API \+ '\/stream'\)/);
    expect(js).toMatch(/'\/activity\?after='/);
  });
});
