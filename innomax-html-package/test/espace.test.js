// Espace entreprises: company isolation, deliverable approval, admin-only
// routes (role + 2FA proof) and the site CMS. Supabase is an in-memory fake;
// the guards, routers, CMS cache and EJS views are the real ones.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';

const path = require('path');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

jest.mock('../routes(api)/utils/supabaseUtil', () => require('./helpers/fakeSupabase').module);

const fake = require('./helpers/fakeSupabase');
const cms = require('../routes(api)/utils/cms');
const { signMfaProof } = require('../routes(api)/utils/twofa');
const { summarizeBill } = require('../routes(api)/utils/espace');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(cookieParser());
app.use(express.json());
app.use(cms.middleware);
app.use('/api/espace', require('../routes(api)/espaceCRUD'));
app.use('/api/admin', require('../routes(api)/adminCRUD'));
app.use(require('../routes(api)/espacePages'));
app.get('/titre', (req, res) => res.send(res.locals.content('home.hero.title', 'Pandora')));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const E_A = '11111111-1111-4111-8111-111111111111';
const E_B = '22222222-2222-4222-8222-222222222222';
const L_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const L_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const M_A = 'aaaaaaaa-1111-4111-8111-00000000000a';
const M_B = 'bbbbbbbb-1111-4111-8111-00000000000b';

const USERS = {
  'tok-a': { id: 'user-a', email: 'a@acme.ca' },
  'tok-b': { id: 'user-b', email: 'b@beta.ca' },
  'tok-solo': { id: 'user-solo', email: 'solo@x.ca' },
  'tok-admin': { id: 'user-admin', email: 'admin@pandora.ca' },
};

function seed() {
  fake.reset({
    tokens: USERS,
    tables: {
      Users: [
        { userId: 'user-a', email: 'a@acme.ca', isAdmin: false },
        { userId: 'user-b', email: 'b@beta.ca', isAdmin: false },
        { userId: 'user-solo', email: 'solo@x.ca', isAdmin: false },
        { userId: 'user-admin', email: 'admin@pandora.ca', isAdmin: true },
      ],
      entreprises: [{ id: E_A, nom: 'Acme Inc.' }, { id: E_B, nom: 'Beta Corp' }],
      membres: [
        { id: 'mem-a', entreprise_id: E_A, user_id: 'user-a', role: 'proprietaire' },
        { id: 'mem-b', entreprise_id: E_B, user_id: 'user-b', role: 'proprietaire' },
      ],
      mandats: [
        { id: M_A, entreprise_id: E_A, titre: 'Mandat secret Acme', statut: 'actif', etape: 2, created_at: '2026-09-01' },
        { id: M_B, entreprise_id: E_B, titre: 'Mandat secret Beta', statut: 'actif', etape: 1, created_at: '2026-09-02' },
      ],
      livrables: [
        { id: L_A, entreprise_id: E_A, mandat_id: M_A, titre: 'Rapport Acme', statut: 'en_attente', created_at: '2026-09-03' },
        { id: L_B, entreprise_id: E_B, mandat_id: M_B, titre: 'Rapport Beta', statut: 'en_attente', created_at: '2026-09-04' },
      ],
      bills: [
        { id: 1, user_id: 'user-a', source: 'course:7', created_at: '2026-08-01', payment_data: { id: 'cs_test_acme0001', amount_total: 12345, currency: 'cad', mode: 'payment', payment_status: 'paid' } },
        { id: 2, user_id: 'user-b', source: 'course:9', created_at: '2026-08-02', payment_data: { id: 'cs_test_beta0002', amount_total: 98765, currency: 'cad', mode: 'subscription', payment_status: 'paid' } },
      ],
      site_content: [],
    },
  });
  cms._reset();
}

const CSRF = 'csrf-test-token';
const cookies = (token, extra = []) => [`accessToken=${token}`, `XSRF-TOKEN=${CSRF}`, ...extra].join('; ');
const adminCookies = () => cookies('tok-admin', [`mfa=${signMfaProof('user-admin', Date.now() + 60000)}`]);
const post = (url, token, body, extra) =>
  request(app).post(url).set('Cookie', cookies(token, extra)).set('X-CSRF-Token', CSRF).send(body);
const asAdmin = (method, url) => request(app)[method](url).set('Cookie', adminCookies()).set('X-CSRF-Token', CSRF);
const livrable = (id) => fake.state.tables.livrables.find((l) => l.id === id);

beforeEach(seed);

describe('client space: isolation by company', () => {
  it("shows a member only their own company's mandates and payments", async () => {
    const mandats = await request(app).get('/espace?vue=mandats').set('Cookie', cookies('tok-a'));
    expect(mandats.status).toBe(200);
    expect(mandats.text).toContain('Mandat secret Acme');
    expect(mandats.text).not.toContain('Mandat secret Beta');

    const achats = await request(app).get('/espace?vue=achats').set('Cookie', cookies('tok-a'));
    expect(achats.text).toContain('123,45');
    expect(achats.text).not.toContain('987,65');
    expect(achats.text).not.toContain('cs_test_beta');
  });

  it("refuses a decision on another company's deliverable and leaves it untouched", async () => {
    const res = await post(`/api/espace/livrables/${L_B}/decision`, 'tok-a', { decision: 'approuve' });
    expect(res.status).toBe(404);
    expect(livrable(L_B).statut).toBe('en_attente');
  });

  it('files a new mandate under the caller company, whatever the body says', async () => {
    const res = await post('/api/espace/mandats', 'tok-a', { titre: 'Agent IA', entreprise_id: E_B, budget: '5000' });
    expect(res.status).toBe(201);
    const created = fake.state.tables.mandats.find((m) => m.id === res.body.id);
    expect(created).toMatchObject({ entreprise_id: E_A, titre: 'Agent IA', budget: 5000, etape: 0, created_by: 'user-a' });
  });

  it('refuses the API to an account without a company, and to visitors', async () => {
    expect((await post('/api/espace/mandats', 'tok-solo', { titre: 'x' })).status).toBe(403);
    expect((await post('/api/espace/mandats', 'nobody', { titre: 'x' })).status).toBe(401);
    const page = await request(app).get('/espace').set('Cookie', cookies('tok-solo'));
    expect(page.status).toBe(200);
    expect(page.text).toContain('pas encore rattaché');
  });

  it('requires the CSRF header on writes', async () => {
    const res = await request(app).post('/api/espace/mandats').set('Cookie', cookies('tok-a')).send({ titre: 'x' });
    expect(res.status).toBe(403);
    expect(fake.state.tables.mandats).toHaveLength(2);
  });
});

describe('client space: deliverable approval', () => {
  it('approves a pending deliverable once', async () => {
    const res = await post(`/api/espace/livrables/${L_A}/decision`, 'tok-a', { decision: 'approuve' });
    expect(res.status).toBe(200);
    expect(livrable(L_A)).toMatchObject({ statut: 'approuve', decided_by: 'user-a' });
    expect(livrable(L_A).decided_at).toBeTruthy();

    const again = await post(`/api/espace/livrables/${L_A}/decision`, 'tok-a', { decision: 'modification_demandee', commentaire: 'x' });
    expect(again.status).toBe(409);
    expect(livrable(L_A).statut).toBe('approuve');
  });

  it('asks for a comment before requesting changes', async () => {
    const bare = await post(`/api/espace/livrables/${L_A}/decision`, 'tok-a', { decision: 'modification_demandee' });
    expect(bare.status).toBe(400);
    const ok = await post(`/api/espace/livrables/${L_A}/decision`, 'tok-a', { decision: 'modification_demandee', commentaire: 'Changer le titre' });
    expect(ok.status).toBe(200);
    expect(livrable(L_A)).toMatchObject({ statut: 'modification_demandee', commentaire_client: 'Changer le titre' });
  });

  it('rejects an unknown decision', async () => {
    const res = await post(`/api/espace/livrables/${L_A}/decision`, 'tok-a', { decision: 'supprimer' });
    expect(res.status).toBe(400);
    expect(livrable(L_A).statut).toBe('en_attente');
  });
});

describe('admin routes: role and 2FA checked on the server', () => {
  const cmsEdit = { key: 'home.hero.title', lang: 'fr', type: 'texte', value: 'Piraté' };

  it.each([
    ['put', '/api/admin/cms', cmsEdit],
    ['post', '/api/admin/entreprises', { nom: 'Fake' }],
    ['post', '/api/admin/livrables', { entreprise_id: E_A, titre: 'x' }],
    ['patch', `/api/admin/mandats/${M_A}`, { etape: 4 }],
    ['delete', '/api/admin/membres/mem-b', {}],
  ])('refuses %s %s to a non-admin member', async (method, url, body) => {
    const res = await request(app)[method](url).set('Cookie', cookies('tok-a')).set('X-CSRF-Token', CSRF).send(body);
    expect(res.status).toBe(403);
    expect(fake.state.tables.site_content).toHaveLength(0);
    expect(fake.state.tables.entreprises).toHaveLength(2);
    expect(fake.state.tables.membres).toHaveLength(2);
    expect(fake.state.tables.mandats.find((m) => m.id === M_A).etape).toBe(2);
  });

  it('refuses the console page to a non-admin and to visitors', async () => {
    const member = await request(app).get('/admin/console').set('Cookie', cookies('tok-a'));
    expect(member.status).toBe(403);
    expect(member.text).not.toContain('Mandat secret Beta');
    const visitor = await request(app).get('/admin/console');
    expect(visitor.status).toBe(302);
    expect(visitor.headers.location).toBe('/login');
  });

  it('refuses an admin whose browser did not pass 2FA', async () => {
    const noProof = await request(app).put('/api/admin/cms').set('Cookie', cookies('tok-admin')).set('X-CSRF-Token', CSRF).send(cmsEdit);
    expect(noProof.status).toBe(403);
    const forged = await request(app)
      .put('/api/admin/cms')
      .set('Cookie', cookies('tok-admin', [`mfa=${signMfaProof('user-a', Date.now() + 60000)}`]))
      .set('X-CSRF-Token', CSRF)
      .send(cmsEdit);
    expect(forged.status).toBe(403);
    expect(fake.state.tables.site_content).toHaveLength(0);
  });

  it('renders the console for an admin with 2FA', async () => {
    const res = await request(app).get('/admin/console?vue=mandats').set('Cookie', adminCookies());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Mandat secret Acme');
    expect(res.text).toContain('Mandat secret Beta');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuses to attach a deliverable to another company mandate', async () => {
    const res = await asAdmin('post', '/api/admin/livrables').send({ entreprise_id: E_A, mandat_id: M_B, titre: 'x' });
    expect(res.status).toBe(400);
    const ok = await asAdmin('post', '/api/admin/livrables').send({ entreprise_id: E_A, mandat_id: M_A, titre: 'Maquette', url: 'https://drive.example/x' });
    expect(ok.status).toBe(201);
    expect(fake.state.tables.livrables.find((l) => l.id === ok.body.id)).toMatchObject({ entreprise_id: E_A, statut: 'en_attente' });
  });

  it('refuses a non-https deliverable link', async () => {
    const res = await asAdmin('post', '/api/admin/livrables').send({ entreprise_id: E_A, titre: 'x', url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
  });
});

describe('site CMS', () => {
  it('saves a text and the site shows it at once (cache invalidated)', async () => {
    expect((await request(app).get('/titre')).text).toBe('Pandora');
    const res = await asAdmin('put', '/api/admin/cms').send({ key: 'home.hero.title', lang: 'fr', type: 'texte', value: 'Pandora IA' });
    expect(res.status).toBe(200);
    expect(fake.state.tables.site_content[0]).toMatchObject({ key: 'home.hero.title', lang: 'fr', value: 'Pandora IA', updated_by: 'user-admin' });
    expect((await request(app).get('/titre')).text).toBe('Pandora IA');
    expect((await request(app).get('/titre?lang=en')).text).toBe('Pandora');
  });

  it('goes back to the template text when an entry is reset', async () => {
    await asAdmin('put', '/api/admin/cms').send({ key: 'home.hero.title', lang: 'fr', type: 'texte', value: 'Temp' });
    const res = await asAdmin('delete', '/api/admin/cms').send({ key: 'home.hero.title', lang: 'fr' });
    expect(res.status).toBe(200);
    expect((await request(app).get('/titre')).text).toBe('Pandora');
  });

  it('refuses unsafe images, broken JSON and type mismatches', async () => {
    const bad = [
      { key: 'home.hero.image', lang: 'fr', type: 'image', value: 'javascript:alert(1)' },
      { key: 'home.hero.image', lang: 'fr', type: 'image', value: 'assets/../../etc/passwd' },
      { key: 'home.services.tech.items', lang: 'fr', type: 'json', value: '[oops' },
      { key: 'home.hero.title', lang: 'fr', type: 'image', value: 'https://x.ca/a.png' },
      { key: 'Bad Key!', lang: 'fr', type: 'texte', value: 'x' },
      { key: 'home.hero.title', lang: 'de', type: 'texte', value: 'x' },
    ];
    for (const body of bad) {
      expect((await asAdmin('put', '/api/admin/cms').send(body)).status).toBe(400);
    }
    expect(fake.state.tables.site_content).toHaveLength(0);
  });

  it('uploads a raster image to storage and points the key at it', async () => {
    const res = await request(app)
      .post('/api/admin/cms/image')
      .set('Cookie', adminCookies())
      .set('X-CSRF-Token', CSRF)
      .field('key', 'home.hero.image')
      .field('lang', 'fr')
      .attach('image', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]), { filename: 'hero.PNG', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(fake.state.uploads[0]).toMatchObject({ bucket: 'site-content', contentType: 'image/png' });
    expect(fake.state.uploads[0].name).toMatch(/^cms\/\d+-[0-9a-f]{12}\.png$/);
    expect(fake.state.tables.site_content[0]).toMatchObject({ key: 'home.hero.image', type: 'image', value: res.body.url });
  });

  it('refuses an SVG upload', async () => {
    const res = await request(app)
      .post('/api/admin/cms/image')
      .set('Cookie', adminCookies())
      .set('X-CSRF-Token', CSRF)
      .field('key', 'home.hero.image')
      .attach('image', Buffer.from('<svg onload="alert(1)"/>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(400);
    expect(fake.state.uploads).toHaveLength(0);
  });

  it('refuses an HTML or SVG page disguised as a PNG (content checked, not just the name)', async () => {
    for (const body of ['<html><script>alert(1)</script></html>', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/admin/cms/image')
        .set('Cookie', adminCookies())
        .set('X-CSRF-Token', CSRF)
        .field('key', 'home.hero.image')
        .attach('image', Buffer.from(body), { filename: 'photo.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
    }
    expect(fake.state.uploads).toHaveLength(0);
  });

  it('keeps the template fallback when a stored value has the wrong shape', () => {
    expect(cms.resolve('missing.key', 'fr', ['a'])).toEqual(['a']);
    expect(cms.isSafeImageUrl('https://cdn.example/x.webp')).toBe(true);
    expect(cms.isSafeImageUrl('assets/img/shape/logogo.webp')).toBe(true);
    expect(cms.isSafeImageUrl('data:text/html,<script>')).toBe(false);
  });
});

describe('payment summary', () => {
  it('exposes only display fields of a Stripe session', () => {
    const s = summarizeBill({ id: 3, source: 'x', payment_data: { id: 'cs_live_abcdef123456', amount_total: 5000, currency: 'cad', mode: 'subscription', payment_status: 'paid', customer_details: { email: 'p@x.ca' } } });
    expect(s).toMatchObject({ montant: 50, devise: 'CAD', type: 'Abonnement', statut: 'Payé' });
    expect(JSON.stringify(s)).not.toContain('p@x.ca');
  });
});

describe('pages render every tab', () => {
  it.each(['apercu', 'entreprises', 'clients', 'paiements', 'mandats', 'livrables', 'cms'])('admin console: %s', async (vue) => {
    const res = await request(app).get(`/admin/console?vue=${vue}`).set('Cookie', adminCookies());
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/style=/);
  });

  it.each(['apercu', 'mandats', 'livrables', 'achats', 'nouveau'])('client space: %s', async (vue) => {
    const res = await request(app).get(`/espace?vue=${vue}`).set('Cookie', cookies('tok-a'));
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/style=|<script>/);
  });
});

describe('voice dictation', () => {
  it('allows the microphone for the page origin only, and marks the large fields', async () => {
    const client = await request(app).get('/espace?vue=nouveau').set('Cookie', cookies('tok-a'));
    expect(client.headers['permissions-policy']).toBe('microphone=(self), camera=(), geolocation=()');
    expect(client.text).toMatch(/<textarea id="description"[^>]*data-dictee/);
    expect(client.text).toContain('/assets/js/dictee.js');

    const admin = await request(app).get('/admin/console?vue=livrables').set('Cookie', adminCookies());
    expect(admin.headers['permissions-policy']).toBe('microphone=(self), camera=(), geolocation=()');
    expect(admin.text).toMatch(/<textarea id="l-d"[^>]*data-dictee/);
  });
});

describe('CMS registry matches the templates', () => {
  const fs = require('fs');
  const PAGES = { home: 'home4', marketing: 'marketing', techai: 'TechAndAi', contact: 'contact' };
  it.each(cms.REGISTRY.map((z) => [z.key, z]))('%s is wired with the same fallback', (key, zone) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', `${PAGES[key.split('.')[0]]}.ejs`), 'utf8');
    if (zone.type === 'json') {
      expect(src).toContain(`content('${key}', [`);
    } else {
      expect(src).toContain(`content('${key}', '${zone.fallback.replace(/'/g, "\\'")}')`);
    }
  });
});

describe('cheerful theme', () => {
  const fs = require('fs');
  const { fmt } = require('../routes(api)/utils/espace');
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'css', 'pilotage.css'), 'utf8');

  it('greets by the hour in Québec', () => {
    expect(fmt.salut(new Date('2026-10-02T12:00:00Z'))).toBe('☀️ Bonjour'); // 8 h
    expect(fmt.salut(new Date('2026-10-02T18:00:00Z'))).toBe('🌤️ Bon après-midi'); // 14 h
    expect(fmt.salut(new Date('2026-10-03T02:00:00Z'))).toBe('🌙 Bonsoir'); // 22 h
  });

  it('ships the light/dark toggle as a static script', async () => {
    const res = await request(app).get('/espace').set('Cookie', cookies('tok-a'));
    expect(res.text).toContain('<script src="/assets/js/theme.js"></script>');
    expect(res.text).toContain('data-theme-toggle');
  });

  it('defines the dark tokens for the system preference and the explicit choice, and calms motion', () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(":root:not([data-theme='light'])");
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.confetti \{ display: none; \}/);
  });
});
