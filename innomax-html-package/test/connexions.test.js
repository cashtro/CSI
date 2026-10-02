// "Connecter mes outils" (ROBOTS.md): explicit consent, provider not
// configured -> request to the PBTM team, OAuth state (one-time, this user,
// this browser, unexpired) and PKCE, tokens encrypted at rest, never sent to
// the browser, never logged, withdrawal of consent.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';
process.env.APP_URL = 'https://pbtm.test';
require('./helpers/quiet');

const crypto = require('crypto');
const path = require('path');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

jest.mock('../routes(api)/utils/supabaseUtil', () => require('./helpers/fakeSupabase').module);
const fake = require('./helpers/fakeSupabase');
const cms = require('../routes(api)/utils/cms');
const cx = require('../routes(api)/utils/connexions');
const { encryptSecret } = require('../routes(api)/utils/crypto2fa');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(cookieParser());
app.use(express.json());
app.use(cms.middleware);
app.use(require('../routes(api)/espacePages'));
app.use(require('../routes(api)/connexionsRoutes'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const E_A = '11111111-1111-4111-8111-111111111111';
const E_B = '22222222-2222-4222-8222-222222222222';
const ACCESS = 'ya29.TOKEN-SECRET-ACCESS';
const REFRESH = '1//REFRESH-SECRET';
const OAUTH_ENV = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET', 'MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET', 'META_APP_ID', 'META_APP_SECRET', 'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET'];

function seed(extra = {}) {
  fake.reset({
    tokens: { 'tok-a': { id: 'user-a', email: 'a@acme.ca' }, 'tok-a2': { id: 'user-a2', email: 'e@acme.ca' }, 'tok-b': { id: 'user-b', email: 'b@beta.ca' } },
    tables: {
      Users: [], entreprises: [{ id: E_A, nom: 'Acme' }, { id: E_B, nom: 'Beta' }],
      membres: [
        { id: 'm1', entreprise_id: E_A, user_id: 'user-a', role: 'proprietaire' },
        { id: 'm2', entreprise_id: E_A, user_id: 'user-a2', role: 'membre' },
        { id: 'm3', entreprise_id: E_B, user_id: 'user-b', role: 'proprietaire' },
      ],
      mandats: [], livrables: [], bills: [], site_content: [], robots_offres: [], robots_actifs: [], agent_jobs: [], connexions: [], connexions_etats: [],
      ...extra,
    },
  });
  cms._reset();
}

const CSRF = 'csrf-test-token';
const cookies = (token, extra = []) => [`accessToken=${token}`, `XSRF-TOKEN=${CSRF}`, ...extra].join('; ');
const debut = (f, token, body) => request(app).post(`/connexions/${f}/debut`).set('Cookie', cookies(token)).set('X-CSRF-Token', CSRF).send(body);
const T = () => fake.state.tables;
const logger = require('../routes(api)/utils/logger');

let logs;
beforeEach(() => {
  seed();
  for (const k of OAUTH_ENV) delete process.env[k];
  process.env.TOTP_ENC_KEY = 'cle-de-test-totp';
  logs = [];
  for (const m of ['info', 'warn', 'error']) jest.spyOn(logger, m).mockImplementation((...a) => logs.push(a.map(String).join(' ')));
});
afterEach(() => jest.restoreAllMocks());

const configureGoogle = () => Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: 'gid.apps', GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret' });

describe('consent and requests', () => {
  it('needs the CSRF header, the owner, and an explicit consent', async () => {
    const noCsrf = await request(app).post('/connexions/hubspot/debut').set('Cookie', cookies('tok-a')).send({ consentement: 'on' });
    expect(noCsrf.status).toBe(403);
    expect((await debut('hubspot', 'tok-a2', { consentement: 'on' })).status).toBe(403);
    const noConsent = await debut('hubspot', 'tok-a', {});
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.error).toMatch(/consentement/);
    expect((await debut('inconnu', 'tok-a', { consentement: 'on' })).status).toBe(404);
    expect(T().connexions).toHaveLength(0);
  });

  it('a provider without its environment variables gives the status "demandee" (request to the PBTM team)', async () => {
    expect(cx.isConfigured('hubspot')).toBe(false);
    const res = await debut('hubspot', 'tok-a', { consentement: 'on' });
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('demandee');
    expect(res.body.message).toMatch(/équipe PBTM/);
    expect(res.body.url).toBeUndefined();
    expect(T().connexions[0]).toMatchObject({ entreprise_id: E_A, fournisseur: 'hubspot', statut: 'demandee', consenti_par: 'user-a', portee: cx.FOURNISSEURS.hubspot.permissions });
    expect(T().connexions[0].consenti_at).toBeTruthy();
    expect(T().connexions_etats).toHaveLength(0);
  });

  it('the page shows each tool, its permissions and its status, for the own company only', async () => {
    await debut('hubspot', 'tok-a', { consentement: 'on' });
    await debut('meta', 'tok-b', { consentement: 'on' });
    const res = await request(app).get('/espace?vue=connexions').set('Cookie', cookies('tok-a'));
    expect(res.status).toBe(200);
    for (const f of cx.IDS) expect(res.text).toContain(cx.FOURNISSEURS[f].nom.replace('&', '&amp;'));
    expect(res.text).toContain('Permissions demandées');
    expect(res.text).toContain('Lire vos contacts');
    expect(res.text).toMatch(/cx-hubspot[\s\S]*?Demande envoyée/);
    expect(res.text).not.toMatch(/cx-meta[\s\S]*?Demande envoyée[\s\S]*?cx-hubspot/);
    expect(res.text).toContain('retirer votre autorisation en tout temps');
    expect(res.text).toContain('Annuler la demande');
    expect(res.text).toContain('name="consentement" required');
    expect(res.text).not.toMatch(/style=/);
    expect(res.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(res.text).not.toMatch(/\son[a-z]+=/i);
  });
});

describe('OAuth', () => {
  async function start() {
    configureGoogle();
    const res = await debut('google_workspace', 'tok-a', { consentement: 'on' });
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${cx.STATE_COOKIE}=`));
    return { res, url, state: url.searchParams.get('state'), cookie: cookie && cookie.split(';')[0] };
  }

  it('starts with a one-time state, PKCE (S256) and an httpOnly state cookie', async () => {
    const { url, state, cookie, res } = await start();
    expect(res.body.statut).toBe('redirection');
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('gid.apps');
    expect(url.searchParams.get('redirect_uri')).toBe('https://pbtm.test/connexions/google_workspace/retour');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('gmail.compose');
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(cookie).toBe(`${cx.STATE_COOKIE}=${state}`);
    expect(res.headers['set-cookie'].join(';')).toMatch(/HttpOnly/);
    const row = T().connexions_etats[0];
    expect(row).toMatchObject({ state, entreprise_id: E_A, user_id: 'user-a', fournisseur: 'google_workspace' });
    expect(row.code_verifier).toMatch(/^enc:v1:/);
    const verifier = require('../routes(api)/utils/crypto2fa').decryptSecret(row.code_verifier);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
  });

  it('refuses an invalid state: unknown, not this browser, another user, expired, or replayed', async () => {
    const { state, cookie } = await start();
    const back = (q, token = 'tok-a', c = cookie) => request(app).get(`/connexions/google_workspace/retour?${q}`).set('Cookie', [cookies(token), c].filter(Boolean).join('; '));
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    let r = await back(`code=abc&state=${'x'.repeat(43)}`, 'tok-a', `${cx.STATE_COOKIE}=${'x'.repeat(43)}`);
    expect(r.headers.location).toBe('/espace?vue=connexions&erreur=etat');
    r = await back(`code=abc&state=${state}`, 'tok-a', null); // no state cookie: not the browser that started
    expect(r.headers.location).toBe('/espace?vue=connexions&erreur=etat');
    r = await back(`code=abc&state=${state}`, 'tok-b'); // another company's account
    expect(r.headers.location).toBe('/espace?vue=connexions&erreur=etat');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(T().connexions.find((c) => c.fournisseur === 'google_workspace').jetons).toBeUndefined();

    // The state was consumed by the refused attempt: it never works again.
    r = await back(`code=abc&state=${state}`);
    expect(r.headers.location).toBe('/espace?vue=connexions&erreur=etat');

    const again = await start();
    T().connexions_etats[0].expires_at = new Date(Date.now() - 1000).toISOString();
    r = await back(`code=abc&state=${again.state}`, 'tok-a', again.cookie);
    expect(r.headers.location).toBe('/espace?vue=connexions&erreur=etat');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stores the tokens encrypted, never shows them and never logs them', async () => {
    const { state, cookie } = await start();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, token_type: 'Bearer', scope: 'a b' }),
    });
    const r = await request(app).get(`/connexions/google_workspace/retour?code=le-code&state=${state}`).set('Cookie', [cookies('tok-a'), cookie].join('; '));
    expect(r.headers.location).toBe('/espace?vue=connexions&ok=google_workspace');

    const [tokenUrl, opts] = fetchSpy.mock.calls[0];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const sent = new URLSearchParams(opts.body);
    expect(sent.get('code')).toBe('le-code');
    expect(sent.get('code_verifier')).toBeTruthy();
    expect(sent.get('client_secret')).toBe('gsecret');

    const row = T().connexions.find((c) => c.fournisseur === 'google_workspace');
    expect(row.statut).toBe('connectee');
    expect(row.jetons).toMatch(/^enc:v1:/);
    expect(row.jetons).not.toContain(ACCESS);
    expect(cx.decryptTokens(row.jetons)).toEqual({ access_token: ACCESS, refresh_token: REFRESH, token_type: 'Bearer' });
    expect(row.expire_at).toBeTruthy();
    expect(T().connexions_etats).toHaveLength(0);

    const page = await request(app).get('/espace?vue=connexions&ok=google_workspace').set('Cookie', cookies('tok-a'));
    expect(page.text).toContain('est connecté');
    expect(page.text).not.toContain(ACCESS);
    expect(page.text).not.toContain(REFRESH);
    expect(page.text).not.toContain('enc:v1:');
    expect(logs.join('\n')).not.toMatch(/TOKEN-SECRET|REFRESH-SECRET|le-code|enc:v1|gsecret/);
  });

  it('records an error, without the provider’s answer, when the exchange fails', async () => {
    const { state, cookie } = await start();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', leaked: ACCESS }) });
    const r = await request(app).get(`/connexions/google_workspace/retour?code=x&state=${state}`).set('Cookie', [cookies('tok-a'), cookie].join('; '));
    expect(r.headers.location).toBe('/espace?vue=connexions&erreur=echange&outil=google_workspace');
    const row = T().connexions.find((c) => c.fournisseur === 'google_workspace');
    expect(row).toMatchObject({ statut: 'erreur' });
    expect(row.jetons).toBeUndefined();
    expect(logs.join('\n')).not.toContain(ACCESS);
  });

  it('never stores a token in clear: without TOTP_ENC_KEY the click becomes a request', async () => {
    configureGoogle();
    delete process.env.TOTP_ENC_KEY;
    expect(() => cx.encryptTokens({ access_token: 'x' })).toThrow(/TOTP_ENC_KEY/);
    const res = await debut('google_business', 'tok-a', { consentement: 'on' });
    expect(res.body.statut).toBe('demandee');
    expect(T().connexions_etats).toHaveLength(0);
  });

  it('Shopify asks for a valid shop address', async () => {
    Object.assign(process.env, { SHOPIFY_API_KEY: 'k', SHOPIFY_API_SECRET: 's' });
    expect((await debut('shopify', 'tok-a', { consentement: 'on', compte: 'evil.com' })).status).toBe(400);
    const ok = await debut('shopify', 'tok-a', { consentement: 'on', compte: 'https://ma-boutique.myshopify.com/admin' });
    expect(new URL(ok.body.url).origin).toBe('https://ma-boutique.myshopify.com');
  });
});

describe('website key and withdrawal', () => {
  it('stores the site address and an encrypted key', async () => {
    expect((await debut('site_web', 'tok-a', { consentement: 'on', site: 'http://monsite.ca', cle: 'abcd efgh ijkl' })).status).toBe(400);
    const res = await debut('site_web', 'tok-a', { consentement: 'on', site: 'https://www.monsite.ca/', cle: 'abcd efgh ijkl mnop' });
    expect(res.body.statut).toBe('connectee');
    const row = T().connexions[0];
    expect(row).toMatchObject({ statut: 'connectee', compte: 'https://www.monsite.ca' });
    expect(row.jetons).toMatch(/^enc:v1:/);
    expect(cx.decryptTokens(row.jetons)).toEqual({ cle: 'abcd efgh ijkl mnop' });
    delete process.env.TOTP_ENC_KEY;
    expect((await debut('site_web', 'tok-b', { consentement: 'on', site: 'https://beta.ca', cle: '12345678' })).status).toBe(503);
  });

  it('withdrawing consent erases the row, only for the owner of that company', async () => {
    seed({ connexions: [
      { id: 'c1', entreprise_id: E_A, fournisseur: 'hubspot', statut: 'connectee', jetons: encryptSecret('{"access_token":"t"}') },
      { id: 'c2', entreprise_id: E_B, fournisseur: 'hubspot', statut: 'connectee', jetons: encryptSecret('{"access_token":"t"}') },
    ] });
    const del = (token) => request(app).delete('/api/connexions/hubspot').set('Cookie', cookies(token)).set('X-CSRF-Token', CSRF);
    expect((await del('tok-a2')).status).toBe(403);
    expect((await del('tok-a')).status).toBe(200);
    expect(T().connexions.map((c) => c.id)).toEqual(['c2']);
    expect((await del('tok-a')).status).toBe(404);
  });
});
