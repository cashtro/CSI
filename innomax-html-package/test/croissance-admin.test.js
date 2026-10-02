// Croissance tab (CROISSANCE.md): admin + 2FA only, CSRF on every change,
// CRUD of backlinks / campaigns / contents / AEO / media / press releases,
// agent jobs (Racine, Tribune, marketing Council) and the import of their
// results, the protected CSV export, the page itself (escaped, no inline
// script or style), and the SQL file 008. Nothing is ever sent.
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
jest.mock('../routes(api)/utils/emailService', () => new Proxy({}, { get: () => jest.fn() }));
const fake = require('./helpers/fakeSupabase');
const cms = require('../routes(api)/utils/cms');
const seo = require('../routes(api)/utils/seo');
const C = require('../routes(api)/utils/croissance');
const { signMfaProof } = require('../routes(api)/utils/twofa');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(cookieParser());
app.use(express.json());
app.use(cms.middleware);
app.use(seo.middleware);
app.use('/api/admin/croissance', require('../routes(api)/croissanceAdmin'));
app.use(require('../routes(api)/espacePages'));
app.use(require('../routes(api)/seoRoutes'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const MARKETING = ['marketing-seo', 'marketing-ads', 'marketing-courriel', 'marketing-rp', 'marketing-marque', 'marketing-communaute', 'marketing-cro', 'marketing-growth', 'marketing-video-courte'];
const OTHERS = ['contra-client', 'contra-diable', 'planif-projet', 'revue-arbitre', 'revue-qualite'];

function seed() {
  fake.reset({
    tokens: { 'tok-admin': { id: 'user-admin', email: 'admin@pbtm.ca' }, 'tok-a': { id: 'user-a', email: 'a@acme.ca' } },
    tables: {
      Users: [{ userId: 'user-admin', email: 'admin@pbtm.ca', isAdmin: true }, { userId: 'user-a', email: 'a@acme.ca', isAdmin: false }],
      entreprises: [], membres: [], mandats: [], livrables: [], bills: [], site_content: [],
      cours: [{ id: 7, nom: 'IA pour PME', prix: 49, description: 'Un cours.', created_at: '2026-09-01' }],
      agents: [...MARKETING, ...OTHERS].map((id) => ({ id, name: id, team: id.split('-')[0], active: true })),
      agent_jobs: [], agent_activity: [], agent_tasks: [],
      backlinks: [], campagnes: [], contenus: [], aeo_questions: [], medias: [], communiques: [], croissance_jobs: [],
    },
  });
  cms._reset();
}
beforeEach(seed);

const CSRF = 'csrf-croissance';
const mfa = () => `mfa=${signMfaProof('user-admin', Date.now() + 60000)}`;
const adminCookie = () => `accessToken=tok-admin; XSRF-TOKEN=${CSRF}; ${mfa()}`;
const as = (method, url, cookie = adminCookie()) => request(app)[method](url).set('Cookie', cookie).set('X-CSRF-Token', CSRF);
const admin = (method, url) => as(method, url);
const t = (name) => fake.state.tables[name];
const finish = (jobId, patch) => Object.assign(t('agent_jobs').find((j) => j.id === jobId), { status: 'done', ...patch });

describe('access: admin with 2FA only', () => {
  const routes = [
    ['get', '/api/admin/croissance/seo/audit'],
    ['post', '/api/admin/croissance/backlinks'],
    ['post', '/api/admin/croissance/campagnes'],
    ['post', '/api/admin/croissance/seo/racine'],
    ['get', '/api/admin/croissance/export?table=backlinks'],
  ];
  it.each(routes)('%s %s refuses visitors (401), members (403) and an admin without the 2FA proof (403)', async (method, url) => {
    expect((await as(method, url, `XSRF-TOKEN=${CSRF}`)).status).toBe(401);
    expect((await as(method, url, `accessToken=tok-a; XSRF-TOKEN=${CSRF}`)).status).toBe(403);
    expect((await as(method, url, `accessToken=tok-admin; XSRF-TOKEN=${CSRF}`)).status).toBe(403);
  });

  it('the page redirects visitors and refuses members', async () => {
    const visitor = await request(app).get('/admin/console?vue=croissance');
    expect(visitor.status).toBe(302);
    expect(visitor.headers.location).toBe('/login');
    const member = await request(app).get('/admin/console?vue=croissance').set('Cookie', 'accessToken=tok-a');
    expect(member.status).toBe(403);
    expect(member.text).not.toContain('Croissance');
  });

  it('refuses a change without the CSRF token', async () => {
    const res = await request(app).post('/api/admin/croissance/backlinks').set('Cookie', adminCookie()).send({ cible: 'X' });
    expect(res.status).toBe(403);
    expect(t('backlinks')).toHaveLength(0);
  });
});

describe('backlinks CRUD', () => {
  it('creates, updates and deletes a backlink, with validation', async () => {
    const created = await admin('post', '/api/admin/croissance/backlinks').send({ cible: 'Chambre de commerce de Laval', url: 'https://www.ccilaval.qc.ca/membres', type: 'annuaire_qc', autorite: '45' });
    expect(created.status).toBe(201);
    const row = t('backlinks')[0];
    expect(row).toMatchObject({ cible: 'Chambre de commerce de Laval', domaine: 'ccilaval.qc.ca', statut: 'idee', autorite: 45, created_by: 'user-admin' });

    const patched = await admin('patch', `/api/admin/croissance/backlinks/${row.id}`).send({ statut: 'obtenu', date_suivi: '2026-10-01' });
    expect(patched.status).toBe(200);
    expect(t('backlinks')[0]).toMatchObject({ statut: 'obtenu', date_suivi: '2026-10-01', cible: 'Chambre de commerce de Laval' });

    expect((await admin('post', '/api/admin/croissance/backlinks').send({ cible: 'X', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await admin('post', '/api/admin/croissance/backlinks').send({ cible: 'X', type: 'spam' })).status).toBe(400);
    expect((await admin('post', '/api/admin/croissance/backlinks').send({ url: 'https://a.ca' })).status).toBe(400);
    expect((await admin('patch', `/api/admin/croissance/backlinks/${row.id}`).send({ statut: 'publie' })).status).toBe(400);
    expect((await admin('patch', '/api/admin/croissance/backlinks/pas-un-uuid').send({ statut: 'obtenu' })).status).toBe(400);

    expect((await admin('delete', `/api/admin/croissance/backlinks/${row.id}`)).status).toBe(200);
    expect(t('backlinks')).toHaveLength(0);
  });

  it('"Trouver des opportunités" queues a web research by Racine, then adds its sources as ideas once', async () => {
    const res = await admin('post', '/api/admin/croissance/backlinks/opportunites').send({ zone: 'Montréal' });
    expect(res.status).toBe(201);
    const job = t('agent_jobs')[0];
    expect(job.kind).toBe('research');
    expect(job.payload.agent_id).toBe('marketing-seo');
    expect(job.payload.question).toMatch(/annuaires d’affaires du Québec/);
    expect(job.payload.question).toMatch(/chambres de commerce/);
    expect(job.payload.question).toMatch(/balados/);
    expect(t('croissance_jobs')[0]).toMatchObject({ job_id: job.id, type: 'backlinks' });

    expect((await admin('post', `/api/admin/croissance/jobs/${job.id}/importer`)).status).toBe(409); // not finished

    t('backlinks').push({ id: 'b0', cible: 'Déjà là', url: 'https://www.fccq.ca/' });
    finish(job.id, {
      result: {
        agent_name: 'Racine',
        sources: [
          { url: 'https://www.fccq.ca/', title: 'FCCQ — Fédération des chambres de commerce du Québec' },
          { url: 'https://www.qub.ca/balado/tech', title: 'Balado techno QUB', cited_text: 'Un balado sur la tech.' },
          { url: 'https://annuaire.quebec/entreprises', title: 'Annuaire des entreprises du Québec' },
          { url: 'javascript:alert(1)', title: 'piège' },
        ],
      },
    });
    const imp = await admin('post', `/api/admin/croissance/jobs/${job.id}/importer`);
    expect(imp.status).toBe(200);
    expect(imp.body.imported).toBe(2);
    const ideas = t('backlinks').filter((b) => b.job_id === job.id);
    expect(ideas.map((b) => [b.type, b.statut])).toEqual([['podcast', 'idee'], ['annuaire_qc', 'idee']]);
    expect(ideas[0].source).toMatch(/^Recherche web de l’agent Racine, \d{4}-\d{2}-\d{2}$/);
    expect(ideas[0].note).toBe('Un balado sur la tech.');
    expect((await admin('post', `/api/admin/croissance/jobs/${job.id}/importer`)).status).toBe(409);
  });

  it('the approach e-mail is drafted by Tribune with the LCAP rules, saved as a draft and never sent', async () => {
    const emailService = require('../routes(api)/utils/emailService');
    t('backlinks').push({ id: '11111111-1111-4111-8111-111111111111', cible: 'Balado <Tech>', type: 'podcast', page_visee: '/' });
    const res = await admin('post', '/api/admin/croissance/backlinks/11111111-1111-4111-8111-111111111111/approche');
    expect(res.status).toBe(201);
    const job = t('agent_jobs')[0];
    expect(job.payload.agent_id).toBe('marketing-rp');
    expect(job.payload.instruction).toMatch(/LCAP/);
    expect(job.payload.instruction).toMatch(/PAS envoyé automatiquement/);
    finish(job.id, { result: { texte: 'Objet : Entrevue\n\nBonjour…' } });
    expect((await admin('post', `/api/admin/croissance/jobs/${job.id}/importer`)).status).toBe(200);
    expect(t('backlinks')[0].courriel_approche).toBe('Objet : Entrevue\n\nBonjour…');
    expect(t('backlinks')[0].statut).toBeUndefined();
    for (const k of Object.keys(emailService)) expect(emailService[k]).not.toHaveBeenCalled();
  });
});

describe('campaigns and editorial calendar', () => {
  it('creates a campaign from the form (one checkbox per channel), edits and deletes it', async () => {
    const res = await admin('post', '/api/admin/croissance/campagnes').send({
      nom: 'Agents IA automne', objectif: '20 rendez-vous', canaux_seo: '1', canaux_courriel: '1', budget: '1500', date_debut: '2026-10-05', date_fin: '2026-11-15', kpi_vises: '20 RDV',
    });
    expect(res.status).toBe(201);
    const c = t('campagnes')[0];
    expect(c).toMatchObject({ nom: 'Agents IA automne', canaux: ['seo', 'courriel'], budget: 1500, statut: 'brouillon' });
    expect((await admin('patch', `/api/admin/croissance/campagnes/${c.id}`).send({ statut: 'active', kpi_reels: '12 RDV' })).status).toBe(200);
    expect(t('campagnes')[0]).toMatchObject({ statut: 'active', kpi_reels: '12 RDV', canaux: ['seo', 'courriel'] });
    expect((await admin('post', '/api/admin/croissance/campagnes').send({ nom: 'X', date_debut: '2026-10-05', date_fin: '2026-10-01' })).status).toBe(400);
    expect((await admin('post', '/api/admin/croissance/campagnes').send({ nom: 'X', canaux: ['tiktok-bot'] })).status).toBe(400);
    expect((await admin('delete', `/api/admin/croissance/campagnes/${c.id}`)).status).toBe(200);
    expect(t('campagnes')).toHaveLength(0);
  });

  it('"Générer la campagne" runs a Council of the marketing agents; its tasks become draft contents, nothing is published', async () => {
    t('campagnes').push({ id: '22222222-2222-4222-8222-222222222222', nom: 'Lancement', canaux: ['seo', 'publicite', 'video'], date_debut: '2026-10-05', date_fin: '2026-10-25', statut: 'brouillon' });
    const res = await admin('post', '/api/admin/croissance/campagnes/22222222-2222-4222-8222-222222222222/generer');
    expect(res.status).toBe(201);
    const job = t('agent_jobs')[0];
    expect(job.kind).toBe('debate');
    expect(job.payload.proposeurs).toEqual(['marketing-seo', 'marketing-ads', 'marketing-video-courte', 'marketing-growth']);
    expect(job.payload).toMatchObject({ contradicteurs: ['contra-client', 'contra-diable'], planificateur: 'planif-projet', arbitre: 'revue-arbitre', reviseur: 'revue-qualite' });
    expect(job.payload.sujet).toMatch(/Rien ne sera publié automatiquement/);
    expect(t('campagnes')[0].job_id).toBe(job.id);

    t('agent_tasks').push(
      { id: 1, job_id: job.id, title: 'seo : Article « 5 usages des agents IA »', detail: 'Angle PME', due: '2026-10-08' },
      { id: 2, job_id: job.id, title: 'Vidéo de 30 s', detail: 'Démo', due: 'vendredi' },
    );
    finish(job.id, { result: { decision: { decision: 'Miser sur le SEO et la vidéo.' } } });
    const imp = await admin('post', `/api/admin/croissance/jobs/${job.id}/importer`);
    expect(imp.status).toBe(200);
    const rows = t('contenus');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ canal: 'seo', titre: 'Article « 5 usages des agents IA »', date_prevue: '2026-10-08', statut: 'idee', campagne_id: '22222222-2222-4222-8222-222222222222' });
    expect(rows[1]).toMatchObject({ canal: 'seo', statut: 'idee' });
    expect(rows[1].date_prevue).toMatch(/^2026-10-(0[5-9]|1\d|2[0-5])$/);
    expect(rows.every((r) => r.statut !== 'publie' && !r.publie_le)).toBe(true);
    expect(t('campagnes')[0].decision).toBe('Miser sur le SEO et la vidéo.');
  });

  it('a content is published only by hand ("publié" sets the date), and the calendar shows it', async () => {
    const res = await admin('post', '/api/admin/croissance/contenus').send({ titre: 'Carrousel <LinkedIn>', canal: 'reseaux', date_prevue: '2026-10-14' });
    expect(res.status).toBe(201);
    const id = t('contenus')[0].id;
    expect(t('contenus')[0].statut).toBe('idee');
    expect((await admin('patch', `/api/admin/croissance/contenus/${id}`).send({ statut: 'publie' })).status).toBe(200);
    expect(t('contenus')[0].publie_le).toEqual(expect.any(String));
    expect((await admin('post', '/api/admin/croissance/contenus').send({ titre: 'X', media_url: 'http://pas-https.ca/a.png' })).status).toBe(400);
    const page = await request(app).get('/admin/console?vue=croissance&section=campagnes&mois=2026-10').set('Cookie', adminCookie());
    expect(page.status).toBe(200);
    expect(page.text).toContain('Carrousel &lt;LinkedIn&gt;');
    expect(page.text).not.toContain('<LinkedIn>');
    expect(page.text).toMatch(/octobre 2026/);
  });

  it('builds a Monday-first month grid', () => {
    const g = C.monthGrid('2026-10', [{ id: 'x', titre: 'T', date_prevue: '2026-10-01' }]);
    // 1 October 2026 is a Thursday.
    expect(g.weeks[0].slice(0, 4)).toEqual([null, null, null, expect.objectContaining({ day: 1, date: '2026-10-01' })]);
    expect(g.weeks[0][3].contenus).toHaveLength(1);
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
    expect(g.prev).toBe('2026-09');
    expect(g.next).toBe('2026-11');
  });
});

describe('SEO: audit, Racine, apply after review', () => {
  it('returns the audit of every public page', async () => {
    const res = await admin('get', '/api/admin/croissance/seo/audit');
    expect(res.status).toBe(200);
    expect(res.body.pages.length).toBe(seo.PAGES.length + 1);
    expect(res.body.moyenne).toBeGreaterThan(0);
  });

  it('"Faire corriger par Racine" queues an order with the audit; the reviewed proposal is applied to the CMS', async () => {
    const res = await admin('post', '/api/admin/croissance/seo/racine').send({ page: 'portfolio' });
    expect(res.status).toBe(201);
    const job = t('agent_jobs')[0];
    expect(job).toMatchObject({ kind: 'order', status: 'queued' });
    expect(job.payload.agent_id).toBe('marketing-seo');
    expect(job.payload.instruction).toMatch(/Portfolio/);
    expect(job.payload.instruction).toMatch(/H1/);
    expect(job.payload.instruction).toMatch(/Loi 96/);
    expect(t('site_content')).toHaveLength(0); // nothing applied yet

    finish(job.id, { result: { texte: '```json\n{"title":"Portfolio IA <b>web</b> et marketing | PBTM","description":"Nos réalisations en intelligence artificielle, sites web et marketing pour des PME du Québec. Voyez les projets.","faq":[]}\n```' } });
    expect(C.seoProposal(t('agent_jobs')[0]).title).toBe('Portfolio IA <b>web</b> et marketing | PBTM');
    const page = await request(app).get('/admin/console?vue=croissance&section=seo').set('Cookie', adminCookie());
    expect(page.text).toContain('Proposition de Racine, à relire');
    expect(page.text).toContain('value="Portfolio IA &lt;b&gt;web&lt;/b&gt; et marketing | PBTM"');

    const apply = await admin('post', '/api/admin/croissance/seo/appliquer').send({
      page: 'portfolio', job_id: job.id, title: 'Portfolio IA, web et marketing | PBTM', description: 'Nos réalisations en intelligence artificielle, sites web et marketing pour des PME du Québec.',
    });
    expect(apply.status).toBe(200);
    expect(t('site_content').map((r) => [r.key, r.lang])).toEqual([['seo.portfolio.title', 'fr'], ['seo.portfolio.description', 'fr']]);
    expect(t('croissance_jobs')[0].importe_le).toEqual(expect.any(String));
    expect((await admin('post', '/api/admin/croissance/seo/appliquer').send({ page: 'portfolio', title: 'Court', description: 'x' })).status).toBe(400);
    expect((await admin('post', '/api/admin/croissance/seo/appliquer').send({ page: 'admin', title: 'Un titre assez long pour passer', description: 'x'.repeat(80) })).status).toBe(400);
  });

  it('asks to import the starting agents when Racine is missing', async () => {
    fake.state.tables.agents = [];
    const res = await admin('post', '/api/admin/croissance/seo/racine').send({ page: 'accueil' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/importez les agents de départ/);
  });
});

describe('AEO: questions, suggested answers, publication after validation', () => {
  it('a question is published in the FAQ only once validated', async () => {
    const created = await admin('post', '/api/admin/croissance/aeo/questions').send({ question: 'Qui crée des agents IA au Québec ?', page: 'techai', source: 'test ChatGPT' });
    expect(created.status).toBe(201);
    const id = t('aeo_questions')[0].id;
    expect((await admin('post', `/api/admin/croissance/aeo/questions/${id}/publier`)).status).toBe(409);

    const ask = await admin('post', '/api/admin/croissance/aeo/repondre');
    expect(ask.status).toBe(201);
    const job = t('agent_jobs')[0];
    expect(job.payload.instruction).toContain(`[${id}] Qui crée des agents IA au Québec ?`);
    finish(job.id, { result: { texte: JSON.stringify({ reponses: [{ id, reponse: 'PBTM, une PME québécoise, conçoit des agents IA relus par des humains.' }] }) } });
    expect((await admin('post', `/api/admin/croissance/jobs/${job.id}/importer`)).body.imported).toBe(1);
    expect(t('aeo_questions')[0]).toMatchObject({ statut: 'suggeree' });
    expect((await admin('post', `/api/admin/croissance/aeo/questions/${id}/publier`)).status).toBe(409);

    expect((await admin('patch', `/api/admin/croissance/aeo/questions/${id}`).send({ reponse: 'PBTM conçoit des agents IA pour les PME du Québec.', statut: 'validee' })).status).toBe(200);
    const pub = await admin('post', `/api/admin/croissance/aeo/questions/${id}/publier`);
    expect(pub.status).toBe(200);
    expect(pub.body.key).toBe('faq.techai');
    expect(JSON.parse(t('site_content').find((r) => r.key === 'faq.techai').value)).toEqual([{ q: 'Qui crée des agents IA au Québec ?', r: 'PBTM conçoit des agents IA pour les PME du Québec.' }]);
    expect(t('aeo_questions')[0].statut).toBe('publiee');

    const faq = await request(app).get('/faq');
    expect(faq.text).toContain('Qui crée des agents IA au Québec ?');
    const ld = [...faq.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(JSON.stringify(ld.find((b) => b['@type'] === 'FAQPage'))).toContain('Qui crée des agents IA au Québec ?');
  });

  it('publishing to the general FAQ keeps the default questions', async () => {
    t('aeo_questions').push({ id: '33333333-3333-4333-8333-333333333333', question: 'Où est PBTM ?', page: 'generale', reponse: 'Au Québec.', statut: 'validee' });
    expect((await admin('post', '/api/admin/croissance/aeo/questions/33333333-3333-4333-8333-333333333333/publier')).status).toBe(200);
    const list = JSON.parse(t('site_content').find((r) => r.key === 'faq.generale').value);
    expect(list.length).toBe(seo.FAQ_GENERALE.length + 1);
    expect(list[list.length - 1]).toEqual({ q: 'Où est PBTM ?', r: 'Au Québec.' });
  });

  it('suggested questions are imported once, without duplicates', async () => {
    t('aeo_questions').push({ id: 'q0', question: 'Déjà posée ?', statut: 'a_repondre' });
    await admin('post', '/api/admin/croissance/aeo/suggerer');
    const job = t('agent_jobs')[0];
    expect(job.payload.instruction).toContain('- Déjà posée ?');
    finish(job.id, { result: { texte: '{"questions":[{"question":"Déjà posée ?"},{"question":"Combien coûte un agent IA ?","page":"techai"},{"question":"x","page":"admin"}]}' } });
    const imp = await admin('post', `/api/admin/croissance/jobs/${job.id}/importer`);
    expect(imp.body.imported).toBe(2);
    expect(t('aeo_questions').map((q) => [q.question, q.page || null])).toEqual([['Déjà posée ?', null], ['Combien coûte un agent IA ?', 'techai'], ['x', 'generale']]);
  });
});

describe('media and press releases', () => {
  it('Tribune drafts a press release; the text arrives as a draft to review', async () => {
    const res = await admin('post', '/api/admin/croissance/communiques/rediger').send({ titre: 'PBTM lance ses agents IA', sujet: 'Lancement le 15 octobre à Montréal.' });
    expect(res.status).toBe(201);
    const row = t('communiques')[0];
    expect(row).toMatchObject({ titre: 'PBTM lance ses agents IA', statut: 'en_redaction' });
    const job = t('agent_jobs')[0];
    expect(job.payload.agent_id).toBe('marketing-rp');
    expect(job.payload.instruction).toMatch(/– 30 –/);
    finish(job.id, { result: { texte: 'COMMUNIQUÉ — Montréal, le 15 octobre…' } });
    expect((await admin('post', `/api/admin/croissance/jobs/${job.id}/importer`)).status).toBe(200);
    expect(t('communiques')[0]).toMatchObject({ statut: 'brouillon', texte: 'COMMUNIQUÉ — Montréal, le 15 octobre…' });
    expect((await admin('patch', `/api/admin/croissance/communiques/${row.id}`).send({ statut: 'approuve' })).status).toBe(200);
  });

  it('keeps the LCAP consent of each media contact', async () => {
    expect((await admin('post', '/api/admin/croissance/medias').send({ nom: 'Journal X', courriel: 'pas-un-courriel' })).status).toBe(400);
    expect((await admin('post', '/api/admin/croissance/medias').send({ nom: 'Journal X', courriel: 'redaction@journalx.ca', consentement: 'tacite' })).status).toBe(201);
    expect(t('medias')[0]).toMatchObject({ consentement: 'tacite' });
    expect((await admin('post', '/api/admin/croissance/medias').send({ nom: 'Y' })).status).toBe(201);
    expect(t('medias')[1].consentement).toBe('aucun');
  });
});

describe('protected CSV export', () => {
  it('exports a table for the admin, with spreadsheet formulas neutralised', async () => {
    t('backlinks').push({ id: 'b1', cible: '=HYPERLINK("http://evil")', url: 'https://a.ca', statut: 'idee', note: 'Il a dit "oui"', created_at: '2026-10-01' });
    const res = await admin('get', '/api/admin/croissance/export?table=backlinks');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="pbtm-backlinks-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.text).toContain('"Il a dit ""oui"""');
    expect((await admin('get', '/api/admin/croissance/export?table=Users')).status).toBe(400);
  });
});

describe('the Croissance tab', () => {
  it.each(C.SECTIONS)('section %s renders for the admin, escaped, without inline script or style', async (section) => {
    t('backlinks').push({ id: '44444444-4444-4444-8444-444444444444', cible: '<img src=x onerror=alert(1)>', type: 'media', statut: 'obtenu', created_at: '2026-10-01' });
    t('campagnes').push({ id: '55555555-5555-4555-8555-555555555555', nom: '<script>alert(1)</script>', statut: 'active', canaux: ['seo'], created_at: '2026-10-01' });
    t('medias').push({ id: '66666666-6666-4666-8666-666666666666', nom: 'Média <i>', consentement: 'aucun', created_at: '2026-10-01' });
    const res = await request(app).get(`/admin/console?vue=croissance&section=${section}`).set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('📣');
    expect(res.text).toContain('/assets/css/croissance.css');
    expect(res.text).not.toContain('<img src=x onerror');
    expect(res.text).not.toContain('<script>alert(1)');
    expect(res.text).not.toMatch(/\sstyle="/);
    expect(res.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(res.text).not.toMatch(/\son[a-z]+="/);
    expect(res.text).toMatch(/Aucune publication ni aucun envoi automatique/);
  });

  it('the dashboard counts SEO score, obtained backlinks, contents of the week and active campaigns', async () => {
    const { start } = C.weekRange();
    t('backlinks').push({ id: 'a', statut: 'obtenu', cible: 'A' }, { id: 'b', statut: 'idee', cible: 'B' });
    t('campagnes').push({ id: 'c', nom: 'C', statut: 'active' }, { id: 'd', nom: 'D', statut: 'terminee' });
    t('contenus').push({ id: 'e', titre: 'E', statut: 'redige', date_prevue: start }, { id: 'f', titre: 'F', statut: 'publie', date_prevue: start, publie_le: new Date().toISOString() });
    const data = await C.loadPage(require('./helpers/fakeSupabase').module.createSupabaseAdmin(), { section: 'tableau', audit: { moyenne: 88, pages: [] } });
    expect(data.board).toMatchObject({ scoreMoyen: 88, backlinksObtenus: 1, prevusSemaine: 1, publiesSemaine: 1, campagnesActives: 1 });
    const res = await request(app).get('/admin/console?vue=croissance').set('Cookie', adminCookie());
    expect(res.text).toContain('Score SEO moyen');
    expect(res.text).toMatch(/\d+ \/ 100/);
  });

  it('says to run 008 when the tables are missing', async () => {
    const data = await C.loadPage({ from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: 'relation does not exist' } }) }) }) }) }, { section: 'tableau', audit: null });
    expect(data.errors).toEqual([C.MISSING_TABLES]);
  });

  it('lists the Croissance tab in the console navigation', async () => {
    const res = await request(app).get('/admin/console').set('Cookie', adminCookie());
    expect(res.text).toContain('href="/admin/console?vue=croissance"');
  });
});

describe('db/008_croissance.sql', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'db', '008_croissance.sql'), 'utf8');
  const sql = raw.replace(/--.*$/gm, '');
  it('states that it runs after 007 (006 and 007 by other teams)', () => {
    const head = raw.split('\n').slice(0, 10).join('\n');
    expect(head).toMatch(/ORDRE D'EXECUTION OBLIGATOIRE[\s\S]*005_recherche_agents\.sql[\s\S]*006 et 007[\s\S]*ce fichier \(008\)/);
  });
  it('enables RLS on every table, with no policy and no grant to the browser (service only)', () => {
    const tables = [...sql.matchAll(/create table if not exists (public\.\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(['public.backlinks', 'public.campagnes', 'public.contenus', 'public.aeo_questions', 'public.medias', 'public.communiques', 'public.croissance_jobs']);
    for (const tb of tables) expect(sql).toMatch(new RegExp(`alter table ${tb.replace('.', '\\.')}\\s+enable row level security`));
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant /i);
    expect(sql).toMatch(/revoke all on public\.backlinks,[\s\S]*public\.croissance_jobs from anon, authenticated/);
  });
  it('matches the statuses and types of the application', () => {
    expect(sql).toContain(`check (type in (${Object.keys(C.BACKLINK_TYPES).map((x) => `'${x}'`).join(', ')}))`);
    expect(sql).toContain(`check (statut in (${Object.keys(C.BACKLINK_STATUTS).map((x) => `'${x}'`).join(', ')}))`);
    expect(sql).toContain(`check (statut in (${Object.keys(C.CONTENU_STATUTS).map((x) => `'${x}'`).join(', ')}))`);
    expect(sql).toContain(`check (statut in (${Object.keys(C.CAMPAGNE_STATUTS).map((x) => `'${x}'`).join(', ')}))`);
    expect(sql).toContain(`check (type in (${C.JOB_TYPES.map((x) => `'${x}'`).join(', ')}))`);
  });
});
