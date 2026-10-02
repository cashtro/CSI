// PWA de PBTM (PWA.md) : manifeste, service worker (règles et comportement
// réel dans un bac à sable), pages hors ligne, nouvelle accueil, sélecteur
// Vitrine / Cockpit, écran « Ce qui demande mon attention », notifications
// push (routes protégées, désactivées sans VAPID, chiffrement RFC 8291).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';
require('./helpers/quiet');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

jest.mock('../routes(api)/utils/supabaseUtil', () => require('./helpers/fakeSupabase').module);

const fake = require('./helpers/fakeSupabase');
const cms = require('../routes(api)/utils/cms');
const seo = require('../routes(api)/utils/seo');
const pwa = require('../routes(api)/utils/pwa');
const R = require('../assets/js/pwa/sw-regles');
const webpush = require('../routes(api)/utils/webpush');
const notifications = require('../routes(api)/utils/notifications');
const cockpit = require('../routes(api)/utils/cockpit');
const robots = require('../routes(api)/utils/robots');
const { signMfaProof } = require('../routes(api)/utils/twofa');

const ROOT = path.join(__dirname, '..');
const CSRF = 'jeton-csrf-de-test';
const E_A = '11111111-1111-4111-8111-111111111111';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.use(cookieParser());
app.use(express.json());
app.use(cms.middleware);
app.use(seo.middleware);
const pwaRoutes = require('../routes(api)/pwaRoutes');
app.use(pwaRoutes.middleware);
app.use(pwaRoutes);
app.use(require('../routes(api)/vitrinePages'));
app.use(require('../routes(api)/espacePages'));
app.use(require('../routes(api)/robotsPages'));
app.use(require('../routes(api)/seoRoutes'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const USERS = {
  'tok-client': { id: 'user-client', email: 'client@acme.ca' },
  'tok-seul': { id: 'user-seul', email: 'seul@nulle-part.ca' },
  'tok-admin': { id: 'user-admin', email: 'admin@pbtm.ca' },
};
const cookies = (token, extra = []) => [`accessToken=${token}`, `XSRF-TOKEN=${CSRF}`, ...extra].join('; ');
const adminCookies = () => cookies('tok-admin', [`mfa=${signMfaProof('user-admin', Date.now() + 60000)}`]);

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
function cleUA() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { ecdh, p256dh: webpush.b64u(ecdh.getPublicKey()), auth: webpush.b64u(crypto.randomBytes(16)) };
}

function seed(extra = {}) {
  fake.reset({
    tokens: USERS,
    tables: {
      Users: [
        { userId: 'user-client', email: 'client@acme.ca', isAdmin: false },
        { userId: 'user-seul', email: 'seul@nulle-part.ca', isAdmin: false },
        { userId: 'user-admin', email: 'admin@pbtm.ca', isAdmin: true },
      ],
      entreprises: [{ id: E_A, nom: 'Acme <Inc>' }],
      membres: [{ id: 'm1', entreprise_id: E_A, user_id: 'user-client', role: 'proprietaire' }],
      robots_offres: robots.ROBOTS_DEPART.map((o) => ({ ...o })),
      cours: [
        { id: 7, nom: 'IA <pour> PME', niveau: 'Débutant', nombre_heures: 6, prix: 149, image_url: 'javascript:alert(1)', created_at: '2026-09-01' },
        { id: 8, nom: 'SEO local', niveau: 'Intermédiaire', nombre_heures: 8, prix: 0, image_url: 'https://cdn.pbtm.test/seo.jpg', created_at: '2026-08-01' },
      ],
      Achat: [{ id_item: 3, title_item: 'Audit SEO express', price_item: 290, description_item: 'Dix priorités.', image_item: null }],
      livrables: [], mandats: [], bills: [],
      ...extra,
    },
  });
}

const VAPID = webpush.genererCles();
const avecVapid = () => Object.assign(process.env, { VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: 'mailto:admin@pbtm.ca' });
const sansVapid = () => { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT; };

beforeEach(() => {
  sansVapid();
  cms._reset();
  notifications._reset();
  seed();
});
afterAll(sansVapid);

const sansScriptNiStyleEnLigne = (html) => {
  expect(html).not.toMatch(/\sstyle="/);
  expect(html).not.toMatch(/\son[a-z]+="/);
  // Seul bloc en ligne permis : les données JSON-LD.
  expect(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
};

// ---------------------------------------------------------------- manifeste

function taillePng(fichier) {
  const buf = fs.readFileSync(fichier);
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe('manifeste', () => {
  it('est servi avec les champs attendus et les couleurs du BLOC MARQUE', async () => {
    const res = await request(app).get('/manifest.webmanifest');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/manifest\+json/);
    const m = JSON.parse(res.text);
    expect(m).toMatchObject({
      name: 'PBTM — Panda Business Tech & Marketing', short_name: 'PBTM', lang: 'fr-CA',
      start_url: '/?source=pwa', scope: '/', display: 'standalone',
    });
    const j = pwa.jetonsMarque();
    expect(m.theme_color).toBe(j.clair.indigo);
    expect(m.background_color).toBe(j.clair['panda-black']);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('déclare des icônes 192, 512 et 512 maskable qui existent avec la bonne taille', () => {
    const m = pwa.manifeste();
    const par = (sizes, purpose) => m.icons.find((i) => i.sizes === sizes && i.purpose === purpose);
    expect(par('192x192', 'any')).toBeTruthy();
    expect(par('512x512', 'any')).toBeTruthy();
    expect(par('512x512', 'maskable')).toBeTruthy();
    for (const i of m.icons) expect(taillePng(pwa.fichierPublic(i.src))).toBe(i.sizes);
    expect(taillePng(pwa.fichierPublic(pwa.ICONES.apple))).toBe('180x180');
    expect(taillePng(pwa.fichierPublic(pwa.ICONES.i96))).toBe('96x96');
  });

  it('déclare des captures large et étroite qui existent', () => {
    const m = pwa.manifeste();
    expect(m.screenshots.map((s) => s.form_factor).sort()).toEqual(['narrow', 'wide']);
    for (const s of m.screenshots) expect(taillePng(pwa.fichierPublic(s.src))).toBe(s.sizes);
  });

  it('propose les quatre raccourcis demandés', () => {
    expect(pwa.manifeste().shortcuts.map((s) => [s.name, s.url])).toEqual([
      ['⚡ Activer un robot', '/robots'],
      ['🎛️ Mon cockpit', '/admin/console'],
      ['🤖 Agents', '/admin/console?vue=agents'],
      ['💰 Finances', '/admin/console?vue=finances'],
    ]);
  });

  it('les pages chargent le manifeste, les couleurs de barre claire et sombre et les réglages iOS', async () => {
    const res = await request(app).get('/');
    const j = pwa.jetonsMarque();
    expect(res.text).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(res.text).toContain(`<meta name="theme-color" media="(prefers-color-scheme: light)" content="${j.clair.frame}">`);
    expect(res.text).toContain(`<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${j.sombre.frame}">`);
    expect(res.text).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(res.text).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/assets/img/pwa/apple-touch-icon.png">');
    expect(res.text).toContain('viewport-fit=cover');
    expect(res.text).toContain('<script src="/assets/js/pwa/pwa.js" defer></script>');
  });
});

// ---------------------------------------------------------------- service worker servi

describe('GET /sw.js', () => {
  it('est du JavaScript, à la racine, sans cache long, avec sa version', async () => {
    const res = await request(app).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache, max-age=0');
    expect(res.headers['cache-control']).not.toMatch(/max-age=[1-9]/);
    expect(res.headers['service-worker-allowed']).toBe('/');
    expect(res.headers['x-pbtm-sw-version']).toMatch(/^[0-9a-f]{12}$/);
    expect(res.text).toContain(`var VERSION = "${res.headers['x-pbtm-sw-version']}";`);
    expect(res.text).not.toMatch(/var (VERSION|COQUILLE) = '?__PBTM_/);
  });

  it('la coquille ne contient que des fichiers qui existent et aucune page privée', () => {
    for (const u of pwa.COQUILLE) {
      expect(R.estPrive(u)).toBe(false);
      if (u.startsWith('/assets/')) expect(fs.existsSync(pwa.fichierPublic(u))).toBe(true);
    }
    expect(pwa.COQUILLE).toEqual(expect.arrayContaining(['/hors-ligne', '/connexion-requise', '/assets/css/pilotage.css', '/assets/js/pwa/pwa.js']));
  });

  it('la version change quand un fichier de la coquille change', () => {
    const v1 = pwa.serviceWorker({ frais: true }).version;
    const css = pwa.fichierPublic('/assets/css/pwa.css');
    const avant = fs.readFileSync(css, 'utf8');
    try {
      fs.writeFileSync(css, `${avant}\n/* test */\n`);
      expect(pwa.serviceWorker({ frais: true }).version).not.toBe(v1);
    } finally {
      fs.writeFileSync(css, avant);
      pwa.serviceWorker({ frais: true });
    }
  });
});

// ---------------------------------------------------------------- règles du SW

describe('règles du service worker (sw-regles.js)', () => {
  const O = 'https://pbtm.test';
  const req = (url, extra = {}) => ({ url: new URL(url, O).href, method: 'GET', headers: {}, ...extra });
  const rep = (extra = {}) => ({ status: 200, redirected: false, type: 'basic', headers: { 'cache-control': 'no-cache' }, ...extra });

  const PRIVEES = [
    '/api/admin/agents/summary', '/api', '/admin', '/admin/console', '/admin/console?vue=finances', '/espace', '/espace?vue=robots',
    '/connexions/google/retour', '/robots/merci?session_id=cs_x', '/robots/redacteur/activer', '/demo/connexion', '/demo/client',
    '/ADMIN/console', '/Espace', '/%61dmin/console', 'https://pbtm.test//admin/console', '/api%2Fadmin', '/dashboard', '/login', '/reset-password',
    '/Purchase-Lottery-Tickets?lotteryId=1', '/%E0%A4%A', '/webhook',
  ];

  it.each(PRIVEES)('%s est privé : jamais copié, même avec une réponse 200', (u) => {
    expect(R.estPrive(u)).toBe(true);
    expect(R.strategie(req(u), O)).toBe('prive');
    expect(R.peutCacher(req(u), rep())).toBe(false);
  });

  it('une requête avec Authorization ou autre que GET passe par le réseau, jamais copiée', () => {
    for (const r of [req('/', { headers: { Authorization: 'Bearer x' } }), req('/faq', { method: 'POST' }), req('/assets/css/pilotage.css', { method: 'PUT' })]) {
      expect(R.strategie(r, O)).toBe('reseau');
      expect(R.peutCacher(r, rep())).toBe(false);
    }
    expect(R.strategie({ url: `${O}/`, method: 'GET', headers: new Headers({ authorization: 'Bearer y' }) }, O)).toBe('reseau');
  });

  it('pages publiques : réseau d’abord ; fichiers statiques : stale-while-revalidate', () => {
    for (const u of ['/', '/?source=pwa', '/robots', '/faq', '/presse', '/education', '/hors-ligne']) expect(R.strategie(req(u), O)).toBe('reseau-dabord');
    for (const u of ['/assets/css/pilotage.css', '/assets/img/pwa/icone-192.png']) expect(R.strategie(req(u), O)).toBe('swr');
    expect(R.strategie(req('/sw.js'), O)).toBe('reseau');
    expect(R.strategie(req('/manifest.webmanifest'), O)).toBe('reseau');
    expect(R.strategie(req('https://fonts.gstatic.com/s/dmsans.woff2'), O)).toBe('swr');
    expect(R.strategie(req('https://js.stripe.com/v3'), O)).toBe('reseau');
  });

  it('ne copie pas une réponse no-store, private, redirigée, en erreur ou opaque', () => {
    const r = req('/faq');
    expect(R.peutCacher(r, rep())).toBe(true);
    expect(R.peutCacher(r, rep({ headers: { 'cache-control': 'no-store' } }))).toBe(false);
    expect(R.peutCacher(r, rep({ headers: { 'cache-control': 'private, max-age=60' } }))).toBe(false);
    expect(R.peutCacher(r, rep({ redirected: true }))).toBe(false);
    expect(R.peutCacher(r, rep({ status: 500 }))).toBe(false);
    expect(R.peutCacher(r, rep({ status: 206 }))).toBe(false);
    expect(R.peutCacher(r, rep({ headers: { vary: '*' } }))).toBe(false);
    expect(R.peutCacher(r, rep({ type: 'opaque', status: 0 }))).toBe(false);
    expect(R.peutCacher(req('https://fonts.googleapis.com/css2?family=DM+Sans'), rep({ type: 'opaque', status: 0 }))).toBe(true);
  });

  it('une notification n’ouvre qu’un chemin du site', () => {
    expect(R.urlSure('/admin/console?vue=robots')).toBe('/admin/console?vue=robots');
    for (const u of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', null]) expect(R.urlSure(u)).toBe('/');
  });
});

// ---------------------------------------------------------------- SW dans un bac à sable

function bacASable({ enLigne = true } = {}) {
  const O = 'https://pbtm.test';
  const ecouteurs = {};
  const appels = [];
  const notifs = [];
  const donnees = new Map();
  const cle = (r) => new URL(typeof r === 'string' ? r : r.url, O).href;
  const ouvrir = (n) => {
    if (!donnees.has(n)) donnees.set(n, new Map());
    const m = donnees.get(n);
    return {
      put: async (r, res) => { m.set(cle(r), res); },
      addAll: async (reqs) => { for (const r of reqs) m.set(cle(r), new Response(`coquille ${new URL(cle(r)).pathname}`)); },
      match: async (r, o) => {
        const k = cle(r);
        if (m.has(k)) return m.get(k);
        if (o && o.ignoreSearch) for (const [kk, v] of m) if (kk.split('?')[0] === k.split('?')[0]) return v;
        return undefined;
      },
    };
  };
  const cachesFaux = {
    donnees,
    open: async (n) => ouvrir(n),
    match: async (r) => {
      for (const n of donnees.keys()) {
        const x = await ouvrir(n).match(r);
        if (x) return x;
      }
      return undefined;
    },
    keys: async () => [...donnees.keys()],
    delete: async (n) => donnees.delete(n),
  };
  const etat = { enLigne };
  const fetchFaux = async (r) => {
    appels.push(cle(r));
    if (!etat.enLigne) throw new TypeError('Failed to fetch');
    const p = new URL(cle(r)).pathname;
    return new Response(`réseau ${p}`, { status: 200, headers: { 'cache-control': p.startsWith('/admin') ? 'no-store' : 'no-cache' } });
  };
  class RequestRelative extends Request {
    constructor(u, o) { super(new URL(typeof u === 'string' ? u : u.url, O), o); }
  }
  const self = {
    location: { origin: O },
    addEventListener: (t, f) => { ecouteurs[t] = f; },
    skipWaiting: jest.fn(),
    clients: { claim: async () => {} },
    registration: { showNotification: async (titre, o) => notifs.push({ titre, ...o }) },
  };
  const ctx = vm.createContext({ self, caches: cachesFaux, fetch: fetchFaux, Request: RequestRelative, Response, Headers, URL, Promise, console, clients: { matchAll: async () => [], openWindow: jest.fn() } });
  vm.runInContext(pwa.serviceWorker({ frais: true }).source, ctx);

  async function evenement(type, data) {
    const attentes = [];
    const ev = { ...data, waitUntil: (p) => attentes.push(p), respondWith: (p) => { ev.reponse = p; } };
    ecouteurs[type](ev);
    const reponse = ev.reponse ? await ev.reponse : undefined;
    await Promise.all(attentes);
    return { reponse, intercepte: Boolean(ev.reponse) };
  }
  const nav = (u, extra = {}) => ({ url: new URL(u, O).href, method: 'GET', mode: 'navigate', headers: new Headers(), ...extra });
  const texte = async (r) => (r ? r.clone().text() : null);
  return { O, ecouteurs, appels, notifs, caches: cachesFaux, etat, evenement, nav, texte, self, ctx };
}

describe('service worker en action (bac à sable vm)', () => {
  it('s’installe en gardant la coquille, puis copie les pages publiques visitées', async () => {
    const sw = bacASable();
    await sw.evenement('install', {});
    const [coquille] = await sw.caches.keys();
    expect(coquille).toMatch(/^pbtm-coquille-[0-9a-f]{12}$/);
    expect(sw.caches.donnees.get(coquille).size).toBe(pwa.COQUILLE.length);
    const { reponse } = await sw.evenement('fetch', { request: sw.nav('/faq') });
    expect(await sw.texte(reponse)).toBe('réseau /faq');
    expect(await sw.caches.keys()).toEqual(expect.arrayContaining([expect.stringMatching(/^pbtm-pages-/)]));
  });

  it('hors ligne : une page déjà visitée revient de sa copie, une autre affiche /hors-ligne', async () => {
    const sw = bacASable();
    await sw.evenement('install', {});
    await sw.evenement('fetch', { request: sw.nav('/') });
    sw.etat.enLigne = false;
    expect(await sw.texte((await sw.evenement('fetch', { request: sw.nav('/') })).reponse)).toBe('réseau /');
    expect(await sw.texte((await sw.evenement('fetch', { request: sw.nav('/?source=pwa') })).reponse)).toBe('réseau /');
    expect(await sw.texte((await sw.evenement('fetch', { request: sw.nav('/presse') })).reponse)).toBe('coquille /hors-ligne');
  });

  it('une page privée n’est jamais copiée, et hors ligne seule « Connexion requise » s’affiche', async () => {
    const sw = bacASable();
    await sw.evenement('install', {});
    for (const u of ['/admin/console', '/espace?vue=robots', '/robots/merci?session_id=cs_x', '/demo/connexion']) {
      const { reponse } = await sw.evenement('fetch', { request: sw.nav(u) });
      expect(await sw.texte(reponse)).toBe(`réseau ${new URL(u, sw.O).pathname}`);
    }
    for (const [n, m] of sw.caches.donnees) {
      if (n.startsWith('pbtm-coquille')) continue;
      for (const k of m.keys()) expect(R.estPrive(k)).toBe(false);
    }
    // Même si une copie existait (ancien SW, autre outil), elle n'est pas servie.
    (await sw.caches.open(R.caches('x').pages)).put('/admin/console', new Response('DONNÉES SECRÈTES'));
    sw.etat.enLigne = false;
    const { reponse } = await sw.evenement('fetch', { request: sw.nav('/admin/console') });
    expect(await sw.texte(reponse)).toBe('coquille /connexion-requise');
  });

  it('ne touche pas aux appels d’API, aux envois POST ni aux requêtes avec Authorization', async () => {
    const sw = bacASable();
    for (const request of [
      { url: `${sw.O}/api/admin/agents/summary`, method: 'GET', mode: 'cors', headers: new Headers() },
      { url: `${sw.O}/faq`, method: 'POST', mode: 'cors', headers: new Headers() },
      { url: `${sw.O}/`, method: 'GET', mode: 'cors', headers: new Headers({ Authorization: 'Bearer x' }) },
    ]) {
      expect((await sw.evenement('fetch', { request })).intercepte).toBe(false);
    }
    expect(sw.appels).toEqual([]);
  });

  it('déconnexion : les copies des pages et des fichiers sont vidées, la coquille reste', async () => {
    const sw = bacASable();
    await sw.evenement('install', {});
    await sw.evenement('fetch', { request: sw.nav('/') });
    await sw.evenement('fetch', { request: { url: `${sw.O}/assets/css/robots.css?v=2`, method: 'GET', mode: 'no-cors', headers: new Headers() } });
    expect((await sw.caches.keys()).length).toBe(3);
    await sw.evenement('message', { data: { type: 'DECONNEXION' } });
    expect((await sw.caches.keys()).every((n) => n.startsWith('pbtm-coquille-'))).toBe(true);
  });

  it('mise à jour sur demande seulement (SKIP_WAITING)', async () => {
    const sw = bacASable();
    await sw.evenement('install', {});
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    await sw.evenement('message', { data: { type: 'SKIP_WAITING' } });
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('MEMORISER ne copie qu’une page publique du site', async () => {
    const sw = bacASable();
    await sw.evenement('message', { data: { type: 'MEMORISER', url: `${sw.O}/admin/console` } });
    await sw.evenement('message', { data: { type: 'MEMORISER', url: 'https://evil.test/' } });
    expect(sw.appels).toEqual([]);
    await sw.evenement('message', { data: { type: 'MEMORISER', url: `${sw.O}/robots` } });
    expect(sw.appels).toEqual([`${sw.O}/robots`]);
  });

  it('affiche une notification push, avec une adresse sûre', async () => {
    const sw = bacASable();
    await sw.evenement('push', { data: { json: () => ({ title: '🕵️ Livrable à valider', body: 'Article', url: 'https://evil.test', tag: 't' }) } });
    expect(sw.notifs[0]).toMatchObject({ titre: '🕵️ Livrable à valider', body: 'Article', data: { url: '/' }, lang: 'fr-CA' });
  });
});

// ---------------------------------------------------------------- pages hors ligne

describe('/hors-ligne et /connexion-requise', () => {
  it('/hors-ligne : jolie page de la marque, illustration SVG, bouton Réessayer, rien de personnel', async () => {
    const res = await request(app).get('/hors-ligne').set('Cookie', adminCookies());
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.text).toContain('Vous êtes hors ligne');
    expect(res.text).toContain('class="ho-illu"');
    expect(res.text).toMatch(/<a class="btn btn--accent" href="" data-reessayer>.*Réessayer<\/a>/);
    expect(res.text).toContain('/assets/css/pilotage.css');
    expect(res.text).not.toContain('admin@pbtm.ca');
    expect(res.text).not.toContain('Mon cockpit');
    sansScriptNiStyleEnLigne(res.text);
  });

  it('/connexion-requise explique que les pages privées ne sont jamais gardées', async () => {
    const res = await request(app).get('/connexion-requise');
    expect(res.text).toContain('Connexion requise');
    expect(res.text).toContain('jamais gardée sur l’appareil');
    sansScriptNiStyleEnLigne(res.text);
  });
});

// ---------------------------------------------------------------- accueil

describe('nouvelle page d’accueil (/)', () => {
  it('rend les robots du catalogue, les cours et la boutique, en français, échappés', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="fr-CA">');
    expect(res.text).toMatch(/<span class="neon-text">PBTM<\/span>/);
    expect(res.text).toContain('href="/robots">⚡ Activer un robot</a>');
    for (const o of robots.ROBOTS_DEPART.filter((x) => x.actif)) expect(res.text).toContain(`href="/robots/${o.slug}/activer"`);
    expect(res.text).toContain('IA &lt;pour&gt; PME');
    expect(res.text).toContain('href="/course-details/7"');
    expect(res.text).toContain('SEO local');
    expect(res.text).toContain('src="https://cdn.pbtm.test/seo.jpg"');
    expect(res.text).not.toContain('javascript:alert');
    expect(res.text).toContain('Audit SEO express');
    for (const id of ['robots', 'formations', 'services', 'nft', 'boutique', 'preuves', 'concours', 'faq', 'contact']) expect(res.text).toContain(`id="${id}"`);
    expect(res.text.match(/class="vt-exemple">Exemple</g).length).toBeGreaterThanOrEqual(6);
    sansScriptNiStyleEnLigne(res.text);
  });

  it('n’offre aucun tirage payant : un concours gratuit « bientôt », sans achat', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain('Concours (bientôt)');
    expect(res.text).toContain('Aucun achat requis');
    expect(res.text).not.toMatch(/luckydraw|Purchase-Lottery|Lottery|billet/i);
    expect(res.text).toContain('Aucune promesse de rendement');
  });

  it('a son SEO complet (seo-head) avec la FAQ en FAQPage', async () => {
    const res = await request(app).get('/');
    const head = res.text.slice(0, res.text.indexOf('</head>'));
    expect((head.match(/<title>/g) || []).length).toBe(1);
    expect(head).toContain('<link rel="canonical" href="https://pandorabrains.com/">');
    const types = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'FAQPage']));
    expect(res.text).toContain('Que fait PBTM ?');
  });

  it('prend ses textes dans le CMS, avec les replis sinon', async () => {
    fake.state.tables.site_content = [{ key: 'accueil.hero.sous_titre', lang: 'fr', type: 'texte', value: 'Texte <du> CMS' }];
    cms.invalidate();
    const res = await request(app).get('/');
    expect(res.text).toContain('Texte &lt;du&gt; CMS');
    expect(res.text).toContain('Un robot qui travaille pour vous');
  });

  it('s’affiche même quand les tables manquent', async () => {
    fake.state.fail = { robots_offres: 'x', cours: 'x', Achat: 'x' };
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Les prochaines formations arrivent bientôt');
    expect(res.text).toContain('La boutique se remplit bientôt');
  });

  it('l’ancienne accueil reste sur /ancien-accueil, non indexée', async () => {
    const res = await request(app).get('/ancien-accueil');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('la barre d’onglets de la vitrine : Accueil, Robots, Formations, Boutique, Compte', async () => {
    const res = await request(app).get('/');
    const barre = /<nav class="pwa-onglets pwa-onglets--vitrine"[\s\S]*?<\/nav>/.exec(res.text)[0];
    expect([...barre.matchAll(/class="pwa-onglet-nom">([^<]+)</g)].map((m) => m[1])).toEqual(['Accueil', 'Robots', 'Formations', 'Boutique', 'Compte']);
    expect(barre).toContain('href="/login"');
  });
});

// ---------------------------------------------------------------- sélecteur

describe('sélecteur Vitrine / Cockpit', () => {
  const selecteur = (html) => (/<nav class="pwa-sections"[\s\S]*?<\/nav>/.exec(html) || [''])[0];

  it('un visiteur ne voit que la vitrine, sans sélecteur', async () => {
    for (const u of ['/', '/robots', '/faq']) {
      const res = await request(app).get(u);
      expect(selecteur(res.text)).toBe('');
      expect(res.text).not.toContain('Mon cockpit');
    }
  });

  it('un client voit Vitrine et Mon espace, jamais le cockpit', async () => {
    for (const u of ['/', '/robots', '/faq', '/espace']) {
      const s = selecteur((await request(app).get(u).set('Cookie', cookies('tok-client'))).text);
      expect(s).toContain('data-sections="client"');
      expect(s).toContain('href="/espace"');
      expect(s).not.toContain('Mon cockpit');
    }
  });

  it('l’admin avec la 2FA voit Vitrine et Mon cockpit', async () => {
    const s = selecteur((await request(app).get('/').set('Cookie', adminCookies())).text);
    expect(s).toContain('data-sections="admin"');
    expect(s).toMatch(/href="\/" aria-current="page"><span aria-hidden="true">🛍️<\/span> Vitrine/);
    expect(s).toContain('href="/admin/console"><span aria-hidden="true">🎛️</span> Mon cockpit');
    const c = selecteur((await request(app).get('/admin/console').set('Cookie', adminCookies())).text);
    expect(c).toContain('href="/admin/console" aria-current="page"');
  });

  it('un admin sans la preuve 2FA n’a pas le cockpit dans le sélecteur', async () => {
    const s = selecteur((await request(app).get('/').set('Cookie', cookies('tok-admin'))).text);
    expect(s).not.toContain('Mon cockpit');
  });
});

// ---------------------------------------------------------------- cockpit

describe('cockpit : ce qui demande mon attention', () => {
  const ilYa = (min) => new Date(Date.now() - min * 60000).toISOString();
  beforeEach(() => seed({
    livrables: [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', entreprise_id: E_A, titre: 'Article <b>', statut: 'a_valider', created_at: ilYa(30) },
      { id: 'aaaaaaaa-0000-4000-8000-000000000002', entreprise_id: E_A, titre: 'Vu', statut: 'approuve', created_at: ilYa(30) },
    ],
    robots_actifs: [
      { id: 'r1', entreprise_id: E_A, robot: 'redacteur', statut: 'actif', created_at: ilYa(60) },
      { id: 'r2', entreprise_id: E_A, robot: 'seo-aeo', statut: 'actif', created_at: ilYa(60 * 24 * 30) },
    ],
    agent_jobs: [
      { id: 'j1', kind: 'debate', status: 'done', payload: { sujet: 'Lancer le robot vidéo ?' }, result: { consensus: true, accord: 0.82 }, finished_at: ilYa(90) },
      { id: 'j2', kind: 'order', status: 'done', payload: {}, result: {}, finished_at: ilYa(90) },
    ],
    agents: [{ id: 'plume', name: 'Plume', team: 'contenu', role: 'Rédactrice', engine: 'claude', active: true }],
    bills: [], depenses: [{ id: 'd1', jour: new Date().toISOString().slice(0, 10), fournisseur: 'Outil', categorie: 'outils', montant_ht: 50000, devise: 'CAD' }],
  }));

  it('rassemble les quatre sources, chacune avec une action en un tap', async () => {
    const { createSupabaseAdmin } = require('../routes(api)/utils/supabaseUtil');
    const { loadAdmin } = require('../routes(api)/utils/espace');
    const db = createSupabaseAdmin();
    const data = await loadAdmin(db);
    const a = await cockpit.attention(db, { livrables: data.livrables, entreprises: data.entreprises });
    const g = Object.fromEntries(a.groupes.map((x) => [x.id, x]));
    expect(g.livrables.total).toBe(1);
    expect(g.livrables.items[0].action.href).toBe('/admin/console?vue=robots#livrable-aaaaaaaa-0000-4000-8000-000000000001');
    expect(g.activations.total).toBe(1);
    expect(g.conseils.items[0]).toMatchObject({ titre: 'Lancer le robot vidéo ?', action: { href: '/admin/console?vue=conseil' } });
    expect(g.conseils.items[0].detail).toContain('accord 82 %');
    expect(g.finances.items.length).toBeGreaterThanOrEqual(0);
    for (const x of a.groupes.flatMap((y) => y.items)) expect(x.action.href).toMatch(/^\/admin\/console\?vue=/);
  });

  it('/admin/console ouvre sur l’écran d’attention, avec la barre d’onglets et le bouton ⚡', async () => {
    const res = await request(app).get('/admin/console').set('Cookie', adminCookies());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ce qui demande mon attention');
    expect(res.text).toContain('Article &lt;b&gt;');
    expect(res.text).toContain('👀 Relire et publier');
    const barre = /<nav class="pwa-onglets pwa-onglets--cockpit"[\s\S]*?<\/nav>/.exec(res.text)[0];
    expect([...barre.matchAll(/class="pwa-onglet-nom">([^<]+)</g)].map((m) => m[1])).toEqual(['Accueil', 'Agents', 'Ventes', 'Croissance', 'Plus']);
    for (const v of ['robots', 'paiements', 'finances']) expect(barre).toContain(`href="/admin/console?vue=${v}"`);
    expect(res.text).toContain('class="pwa-fab" href="/admin/console?vue=agents" data-ordre-ouvrir');
    expect(res.text).toMatch(/<form class="form" data-api="\/api\/admin\/agents\/jobs\/order"/);
    expect(res.text).toMatch(/<textarea id="pwa-ordre-texte"[^>]*data-dictee/);
    expect(res.text).toContain('Les notifications ne sont pas encore activées');
    sansScriptNiStyleEnLigne(res.text);
  });

  it('reste réservé à l’admin avec la 2FA', async () => {
    expect((await request(app).get('/admin/console').set('Cookie', cookies('tok-client'))).status).toBe(403);
    expect((await request(app).get('/admin/console').set('Cookie', cookies('tok-admin'))).status).toBe(403);
  });
});

// ---------------------------------------------------------------- push : routes

describe('routes push', () => {
  const sub = (k = cleUA(), endpoint = ENDPOINT) => ({ endpoint, keys: { p256dh: k.p256dh, auth: k.auth } });

  it('GET /api/push/etat : désactivé sans VAPID, clé publique sinon', async () => {
    expect((await request(app).get('/api/push/etat')).body).toEqual({ actif: false, cle: null });
    avecVapid();
    expect((await request(app).get('/api/push/etat')).body).toEqual({ actif: true, cle: VAPID.publicKey });
  });

  it('sont protégées : CSRF puis connexion', async () => {
    const sansCsrf = await request(app).post('/api/push/abonnement').set('Cookie', 'accessToken=tok-client').send(sub());
    expect(sansCsrf.status).toBe(403);
    const visiteur = await request(app).post('/api/push/abonnement').set('Cookie', `XSRF-TOKEN=${CSRF}`).set('X-CSRF-Token', CSRF).send(sub());
    expect(visiteur.status).toBe(401);
  });

  it('sans VAPID : refus clair (503) et rien n’est enregistré ; le test est un no-op', async () => {
    const res = await request(app).post('/api/push/abonnement').set('Cookie', cookies('tok-client')).set('X-CSRF-Token', CSRF).send(sub());
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('VAPID');
    expect(fake.state.tables.push_abonnements || []).toEqual([]);
    const t = await request(app).post('/api/push/test').set('Cookie', cookies('tok-client')).set('X-CSRF-Token', CSRF).send({});
    expect(t.body).toMatchObject({ actif: false, envoye: 0 });
  });

  it('avec VAPID : enregistre l’abonnement avec le rôle décidé par le serveur', async () => {
    avecVapid();
    const c = await request(app).post('/api/push/abonnement').set('Cookie', cookies('tok-client')).set('X-CSRF-Token', CSRF).send({ ...sub(), role: 'admin' });
    expect(c.status).toBe(201);
    expect(c.body.role).toBe('client');
    const a = await request(app).post('/api/push/abonnement').set('Cookie', adminCookies()).set('X-CSRF-Token', CSRF).send(sub(cleUA(), `${ENDPOINT}-admin`));
    expect(a.body.role).toBe('admin');
    expect(fake.state.tables.push_abonnements.map((r) => [r.user_id, r.role, r.entreprise_id])).toEqual([
      ['user-client', 'client', E_A], ['user-admin', 'admin', null],
    ]);
  });

  it('refuse un service de push inconnu, des clés invalides et un compte sans entreprise', async () => {
    avecVapid();
    const post = (body, tok = 'tok-client') => request(app).post('/api/push/abonnement').set('Cookie', cookies(tok)).set('X-CSRF-Token', CSRF).send(body);
    expect((await post(sub(cleUA(), 'https://127.0.0.1/push'))).status).toBe(400);
    expect((await post(sub(cleUA(), 'http://fcm.googleapis.com/x'))).status).toBe(400);
    expect((await post({ endpoint: ENDPOINT, keys: { p256dh: 'abc', auth: 'x' } })).status).toBe(400);
    expect((await post(sub(), 'tok-seul')).status).toBe(403);
  });

  it('le désabonnement ne retire que les abonnements du compte', async () => {
    seed({ push_abonnements: [
      { id: 'p1', user_id: 'user-client', role: 'client', entreprise_id: E_A, endpoint: ENDPOINT, p256dh: 'x', auth: 'y' },
      { id: 'p2', user_id: 'user-admin', role: 'admin', entreprise_id: null, endpoint: `${ENDPOINT}2`, p256dh: 'x', auth: 'y' },
    ] });
    await request(app).post('/api/push/desabonnement').set('Cookie', cookies('tok-client')).set('X-CSRF-Token', CSRF).send({ endpoint: `${ENDPOINT}2` });
    expect(fake.state.tables.push_abonnements).toHaveLength(2);
    await request(app).post('/api/push/desabonnement').set('Cookie', cookies('tok-client')).set('X-CSRF-Token', CSRF).send({ endpoint: ENDPOINT });
    expect(fake.state.tables.push_abonnements.map((r) => r.id)).toEqual(['p2']);
  });
});

// ---------------------------------------------------------------- push : envoi

describe('notifications (envoi)', () => {
  const { createSupabaseAdmin } = require('../routes(api)/utils/supabaseUtil');

  it('sans VAPID : aucun envoi, aucune lecture de la base', async () => {
    fake.state.fail = { push_abonnements: 'ne doit pas être lue' };
    const db = createSupabaseAdmin();
    for (const r of await Promise.all([
      notifications.livrableAValider(db, { id: 'x', titre: 't' }),
      notifications.robotActive(db, { robot: 'redacteur', entreprise: 'Acme' }),
      notifications.conseilConsensus(db, { question: 'q', accord: 0.8 }),
      notifications.livrablePublie(db, { entreprise_id: E_A, titre: 't' }),
      notifications.alertesFinances(db, [{ id: 'marge', niveau: 'critique', titre: 'Marge' }], '2026-10'),
    ])) expect(r).toEqual({ envoye: 0, raison: 'vapid-absent' });
  });

  it('avec VAPID : envoie aux admins encore admins, aux clients de la bonne entreprise, et retire un abonnement expiré', async () => {
    avecVapid();
    const k = cleUA();
    const base = { p256dh: k.p256dh, auth: k.auth };
    seed({ push_abonnements: [
      { id: 'a1', user_id: 'user-admin', role: 'admin', endpoint: `${ENDPOINT}/a1`, ...base },
      { id: 'a2', user_id: 'user-client', role: 'admin', endpoint: `${ENDPOINT}/a2`, ...base },
      { id: 'c1', user_id: 'user-client', role: 'client', entreprise_id: E_A, endpoint: `${ENDPOINT}/c1`, ...base },
      { id: 'c2', user_id: 'user-autre', role: 'client', entreprise_id: 'autre', endpoint: `${ENDPOINT}/c2`, ...base },
    ] });
    const vus = [];
    const fetchImpl = async (url, opts) => {
      vus.push({ url, opts });
      return { status: url.endsWith('/c1') ? 410 : 201 };
    };
    const db = createSupabaseAdmin();
    expect(await notifications.livrableAValider(db, { id: 'L1', titre: 'Article' }, { fetchImpl })).toEqual({ envoye: 1 });
    expect(vus.map((v) => v.url)).toEqual([`${ENDPOINT}/a1`]);
    expect(vus[0].opts.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '86400' });
    expect(vus[0].opts.headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${VAPID.publicKey}$`));
    // Le message reçu par l'appareil (déchiffré avec la clé de l'abonnement).
    const msg = JSON.parse(dechiffrer(vus[0].opts.body, k));
    expect(msg).toMatchObject({ title: '🕵️ Livrable à valider', body: 'Article', url: '/admin/console?vue=robots#livrable-L1' });

    vus.length = 0;
    expect(await notifications.livrablePublie(db, { entreprise_id: E_A, titre: 'Rapport' }, { fetchImpl })).toEqual({ envoye: 0 });
    expect(vus.map((v) => v.url)).toEqual([`${ENDPOINT}/c1`]);
    expect(fake.state.tables.push_abonnements.map((r) => r.id)).toEqual(['a1', 'a2', 'c2']);
  });

  it('une alerte finance critique n’est signalée qu’une fois par mois', async () => {
    avecVapid();
    const fetchImpl = jest.fn(async () => ({ status: 201 }));
    const k = cleUA();
    seed({ push_abonnements: [{ id: 'a1', user_id: 'user-admin', role: 'admin', endpoint: ENDPOINT, p256dh: k.p256dh, auth: k.auth }] });
    const db = createSupabaseAdmin();
    const alertes = [{ id: 'marge', niveau: 'critique', titre: 'Marge sous l’objectif' }, { id: 'ia', niveau: 'attention', titre: 'IA' }];
    expect((await notifications.alertesFinances(db, alertes, '2026-10', { fetchImpl })).envoye).toBe(1);
    expect((await notifications.alertesFinances(db, alertes, '2026-10', { fetchImpl })).raison).toBe('rien-de-neuf');
    expect((await notifications.alertesFinances(db, alertes, '2026-11', { fetchImpl })).envoye).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------- web push : crypto

function dechiffrer(corps, { ecdh, auth }) {
  const buf = Buffer.from(corps);
  const sel = buf.subarray(0, 16);
  const idlen = buf[20];
  const asPub = buf.subarray(21, 21 + idlen);
  const chiffre = buf.subarray(21 + idlen);
  const partage = ecdh.computeSecret(asPub);
  const hk = (ikm, s, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, n));
  const ikm = hk(partage, webpush.deB64u(auth), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub]), 32);
  const cek = hk(ikm, sel, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hk(ikm, sel, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(chiffre.subarray(chiffre.length - 16));
  const clair = Buffer.concat([d.update(chiffre.subarray(0, chiffre.length - 16)), d.final()]);
  expect(clair[clair.length - 1]).toBe(2);
  return clair.subarray(0, clair.length - 1).toString();
}

describe('web push (RFC 8291, RFC 8292)', () => {
  it('reproduit le vecteur de l’annexe A de la RFC 8291', () => {
    const out = webpush.chiffrer('When I grow up, I want to be a watermelon', {
      p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    }, { sel: webpush.deB64u('DGv6ra1nlYgDCS1FRnbzlw'), clePriveeServeur: webpush.deB64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') });
    expect(webpush.b64u(out)).toBe('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  });

  it('chiffre un message que l’appareil sait déchiffrer', () => {
    const k = cleUA();
    expect(dechiffrer(webpush.chiffrer('Bonjour PBTM ✓', k), k)).toBe('Bonjour PBTM ✓');
  });

  it('signe un JWT VAPID ES256 vérifiable avec la clé publique', () => {
    const cfg = webpush.config({ VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: 'mailto:admin@pbtm.ca' });
    const jwt = webpush.jetonVapid('https://fcm.googleapis.com', cfg, 1000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url'))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(Buffer.from(p, 'base64url'))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1000 + 12 * 3600, sub: 'mailto:admin@pbtm.ca' });
    const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: webpush.b64u(cfg.publique.subarray(1, 33)), y: webpush.b64u(cfg.publique.subarray(33)) }, format: 'jwk' });
    expect(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('refuse une configuration VAPID incomplète ou incohérente', () => {
    const autre = webpush.genererCles();
    expect(webpush.config({})).toBeNull();
    expect(webpush.config({ VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey })).toBeNull();
    expect(webpush.config({ VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: autre.privateKey, VAPID_SUBJECT: 'mailto:a@b.ca' })).toBeNull();
    expect(webpush.config({ VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: 'pas-une-adresse' })).toBeNull();
  });

  it('n’envoie qu’aux services de push des navigateurs, en https', () => {
    for (const e of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://db5p.notify.windows.com/w/?token=x']) expect(webpush.endpointPermis(e)).toBe(true);
    for (const e of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.test/x', 'https://169.254.169.254/latest', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'nope']) expect(webpush.endpointPermis(e)).toBe(false);
  });
});

// ---------------------------------------------------------------- qualité et documentation

describe('qualité', () => {
  const css = (f) => fs.readFileSync(path.join(ROOT, 'assets', 'css', f), 'utf8');

  it.each(['pwa.css', 'vitrine.css'])('%s n’utilise que les jetons du BLOC MARQUE (aucune couleur en dur)', (f) => {
    const sans = css(f).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sans).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(sans).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
    expect(sans).not.toMatch(/:\s*(white|black|red|blue|green|purple|pink)\b/i);
  });

  it('les transitions de page sont coupées avec prefers-reduced-motion', () => {
    const c = css('pwa.css');
    expect(c).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*@view-transition \{ navigation: auto; \}/);
    expect(c).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*@view-transition \{ navigation: none; \}/);
  });

  it('les cibles tactiles de la barre et des onglets font au moins 44 px, avec les zones sûres', () => {
    const c = css('pwa.css');
    expect(c).toMatch(/--pwa-onglets-h: (4[4-9]|[5-9]\d)px/);
    expect(c).toContain('env(safe-area-inset-bottom');
    expect(c).toContain('env(safe-area-inset-top');
    expect(c).toMatch(/\.pl \.pwa-section \{[^}]*min-height: var\(--tap\)/);
    expect(c).toMatch(/\.pwa-installer \{[^}]*min-height: var\(--tap\)/);
  });

  it('PWA.md et MISE-EN-LIGNE.md expliquent la PWA et l’ordre 001 → 009', () => {
    const doc = fs.readFileSync(path.join(ROOT, '..', 'PWA.md'), 'utf8');
    for (const s of ['iPhone', 'Android', 'ordinateur', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'hors ligne', 'RACJ', 'Code criminel']) expect(doc).toContain(s);
    const mel = fs.readFileSync(path.join(ROOT, '..', 'MISE-EN-LIGNE.md'), 'utf8');
    expect(mel).toMatch(/001 à 009/);
    expect(mel.indexOf('db/009_pwa.sql')).toBeGreaterThan(mel.indexOf('db/008_croissance.sql'));
    expect(mel).toContain('VAPID_PUBLIC_KEY');
  });
});
