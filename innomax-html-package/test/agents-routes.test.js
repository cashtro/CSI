// Agent admin API: admin role + 2FA + CSRF, validation, import/export, rate
// limit; client read routes; /healthz.
require('./helpers/quiet');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createMockDb } = require('./helpers/mock-supabase');

const USERS = { admin2fa: 'u-admin', 'admin-no2fa': 'u-admin2', client: 'u-client' };
let mockDb;
function mockReset() {
  mockDb = createMockDb({
    Users: [{ userId: 'u-admin', isAdmin: true }, { userId: 'u-admin2', isAdmin: true }, { userId: 'u-client', isAdmin: false }],
    Users_2fa: [{ userId: 'u-admin', enabled: true, secret: 's' }],
    agents: [{ id: 'redac', name: 'Rédactrice' }, { id: 'strat', name: 'Stratège' }],
    agent_jobs: [], agent_activity: [], agent_settings: [{ id: 1, enabled: false, monthly_budget_usd: 60, concurrency: 2 }], agent_usage: [], agent_tasks: [], agent_workers: [],
  });
  mockDb.auth = { getUser: async (token) => ({ data: { user: USERS[token] ? { id: USERS[token] } : null }, error: null }) };
}
mockReset();
jest.mock('../routes(api)/utils/supabaseUtil', () => ({
  createSupabaseAdmin: () => new Proxy({}, { get: (_, k) => mockDb[k] }),
  createSupabaseClient: () => new Proxy({}, { get: (_, k) => mockDb[k] }),
}));

const adminRoutes = require('../routes(api)/agentsAdmin');
const clientRoutes = require('../routes(api)/agentsClient');
const { healthReport } = require('../agents/health');

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/admin/agents', adminRoutes);
  app.use('/api/agents', clientRoutes);
  return app;
}
let app;
beforeEach(() => { mockReset(); app = makeApp(); });

const as = (token) => ({ Authorization: `Bearer ${token}` });
const rejected = (s) => [401, 403].includes(s);

describe('agent admin routes refuse without the admin role', () => {
  const routes = [
    ['get', '/api/admin/agents/jobs'],
    ['post', '/api/admin/agents/jobs/order'],
    ['post', '/api/admin/agents/jobs/council'],
    ['get', '/api/admin/agents/jobs/00000000-0000-0000-0000-000000000000'],
    ['post', '/api/admin/agents/jobs/00000000-0000-0000-0000-000000000000/cancel'],
    ['get', '/api/admin/agents/settings'],
    ['put', '/api/admin/agents/settings'],
    ['get', '/api/admin/agents/usage'],
    ['get', '/api/admin/agents/stream'],
    ['get', '/api/admin/agents/export'],
    ['post', '/api/admin/agents/import'],
  ];

  it.each(routes)('%s %s -> 401 without a session', async (method, url) => {
    const res = await request(app)[method](url).send({});
    expect(res.status).toBe(401);
  });

  it.each(routes)('%s %s -> 403 for a non-admin', async (method, url) => {
    const res = await request(app)[method](url).set(as('client')).send({});
    expect(res.status).toBe(403);
  });

  it('403 for an admin without 2FA enabled', async () => {
    const res = await request(app).get('/api/admin/agents/jobs').set(as('admin-no2fa'));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Double authentification/);
  });

  it('enforces CSRF on cookie-authenticated mutations, even without CSRF_ENFORCE', async () => {
    delete process.env.CSRF_ENFORCE;
    const body = { agent_id: 'redac', instruction: 'x' };
    const bad = await request(app).post('/api/admin/agents/jobs/order').set('Cookie', 'accessToken=admin2fa').send(body);
    expect(bad.status).toBe(403);
    expect(bad.body.error).toMatch(/CSRF/);
    const ok = await request(app).post('/api/admin/agents/jobs/order')
      .set('Cookie', 'accessToken=admin2fa; XSRF-TOKEN=tok').set('X-CSRF-Token', 'tok').send(body);
    expect(ok.status).toBe(201);
  });
});

describe('agent admin routes (admin + 2FA)', () => {
  it('creates an order job and lists it', async () => {
    const res = await request(app).post('/api/admin/agents/jobs/order').set(as('admin2fa'))
      .send({ agent_id: 'redac', instruction: 'Écris un résumé', client: { nom: 'ACME' } });
    expect(res.status).toBe(201);
    expect(mockDb.tables.agent_jobs[0]).toMatchObject({ kind: 'order', created_by: 'u-admin', payload: { agent_id: 'redac' } });
    const list = await request(app).get('/api/admin/agents/jobs').set(as('admin2fa'));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('validates order and council input', async () => {
    const post = (url, body) => request(app).post(url).set(as('admin2fa')).send(body);
    expect((await post('/api/admin/agents/jobs/order', { agent_id: 'inconnu', instruction: 'x' })).status).toBe(400);
    expect((await post('/api/admin/agents/jobs/order', { agent_id: 'redac' })).status).toBe(400);
    expect((await post('/api/admin/agents/jobs/order', { agent_id: 'redac', instruction: 'x', entreprise_id: 'pas-un-uuid' })).status).toBe(400);
    expect((await post('/api/admin/agents/jobs/council', { sujet: 's', proposeurs: ['redac', 'strat', 'redac', 'strat', 'redac', 'strat', 'redac'] })).status).toBe(400);
    expect((await post('/api/admin/agents/jobs/council', { sujet: 's', proposeurs: ['redac'], contradicteurs: ['a', 'b', 'c', 'd'] })).status).toBe(400);
    expect((await post('/api/admin/agents/jobs/council', { sujet: 's', proposeurs: ['redac'], contradicteurs: ['strat'] })).status).toBe(201);
    expect(mockDb.tables.agent_jobs[0]).toMatchObject({ kind: 'debate', payload: { sujet: 's', proposeurs: ['redac'], contradicteurs: ['strat'] } });
  });

  it('rate limits job creation', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await request(app).post('/api/admin/agents/jobs/order').set(as('admin2fa')).send({ agent_id: 'redac', instruction: `n${i}` })).status);
    }
    // The limiter (10/min) is shared with the tests above, so only check that
    // it kicks in within 11 requests and that the rest went through.
    expect(statuses).toContain(429);
    expect(statuses.every((s) => s === 201 || s === 429)).toBe(true);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('cancels a queued job once, and shows a job with its activity', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    mockDb.tables.agent_jobs.push({ id, kind: 'order', status: 'queued', payload: {} });
    const first = await request(app).post(`/api/admin/agents/jobs/${id}/cancel`).set(as('admin2fa'));
    expect(first.status).toBe(200);
    expect(mockDb.tables.agent_jobs[0].status).toBe('cancelled');
    expect((await request(app).post(`/api/admin/agents/jobs/${id}/cancel`).set(as('admin2fa'))).status).toBe(409);
    const show = await request(app).get(`/api/admin/agents/jobs/${id}`).set(as('admin2fa'));
    expect(show.status).toBe(200);
    expect(show.body.activity.map((a) => a.kind)).toEqual(['job_cancel_requested']);
    expect((await request(app).get('/api/admin/agents/jobs/22222222-2222-4222-8222-222222222222').set(as('admin2fa'))).status).toBe(404);
  });

  it('reads and updates settings with validation', async () => {
    const get = await request(app).get('/api/admin/agents/settings').set(as('admin2fa'));
    expect(get.body).toMatchObject({ enabled: false, monthly_budget_usd: 60, concurrency: 2 });
    const put = (b) => request(app).put('/api/admin/agents/settings').set(as('admin2fa')).send(b);
    expect((await put({ concurrency: 9 })).status).toBe(400);
    expect((await put({ monthly_budget_usd: -1 })).status).toBe(400);
    expect((await put({ model_complex: 'Pas un modèle!' })).status).toBe(400);
    expect((await put({ enabled: 'yes' })).status).toBe(400);
    const ok = await put({ enabled: true, monthly_budget_usd: 25, model_complex: 'claude-opus-5-5', concurrency: 3 });
    expect(ok.status).toBe(200);
    expect(mockDb.tables.agent_settings[0]).toMatchObject({ enabled: true, monthly_budget_usd: 25, model_complex: 'claude-opus-5-5', concurrency: 3, updated_by: 'u-admin' });
  });

  it('reports the month usage against the budget', async () => {
    const { monthStart } = require('../agents/budget');
    mockDb.tables.agent_usage.push({ day: monthStart(), model: 'claude-sonnet-5-5', calls: 3, tokens_in: 100, tokens_out: 50, cost_usd: 1.5 });
    const res = await request(app).get('/api/admin/agents/usage').set(as('admin2fa'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ budget_usd: 60, spent_usd: 1.5, remaining_usd: 58.5, totals: { calls: 3 } });
  });

  it('imports agents with the artifact field names and exports them', async () => {
    const res = await request(app).post('/api/admin/agents/import').set(as('admin2fa')).send({
      agents: [
        { nom: 'Analyste Marché', equipe: 'Stratégie', role: 'Analyse', methode: 'SWOT', outils: ['web'], actif: true },
        { id: 'redac', name: 'Rédactrice v2', team: 'Contenu', engine: 'maison', model: 'quick' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    const analyst = mockDb.tables.agents.find((a) => a.id === 'analyste-marche');
    expect(analyst).toMatchObject({ name: 'Analyste Marché', team: 'Stratégie', method: 'SWOT', tools: ['web'], engine: 'claude', active: true });
    expect(mockDb.tables.agents.find((a) => a.id === 'redac')).toMatchObject({ name: 'Rédactrice v2', engine: 'maison', model: 'quick' });

    const bad = await request(app).post('/api/admin/agents/import').set(as('admin2fa')).send({ agents: [{ name: 'x', engine: 'gpt' }] });
    expect(bad.status).toBe(400);

    const exp = await request(app).get('/api/admin/agents/export').set(as('admin2fa'));
    expect(exp.status).toBe(200);
    expect(exp.headers['content-disposition']).toMatch(/agents-pandora\.json/);
    expect(exp.body.agents).toHaveLength(3);
  });

  it('streams activity as server-sent events', async () => {
    mockDb.tables.agent_activity.push({ id: 7, kind: 'job_done', message: 'Terminé' });
    const server = app.listen(0);
    const { port } = server.address();
    const http = require('http');
    const chunk = await new Promise((resolve, reject) => {
      const r = http.get({ port, path: '/api/admin/agents/stream', headers: as('admin2fa') }, (res) => {
        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        let buf = '';
        res.on('data', (d) => {
          buf += d;
          if (buf.includes('job_done')) { r.destroy(); resolve(buf); }
        });
      });
      r.on('error', reject);
    });
    server.close();
    expect(chunk).toMatch(/id: 7\nevent: activity\ndata: .*job_done/);
  });
});

describe('client read routes', () => {
  it('require a session', async () => {
    expect((await request(app).get('/api/agents/jobs')).status).toBe(401);
  });

  it('show nothing until entreprise membership exists (TODO), even for a known job id', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    mockDb.tables.agent_jobs.push({ id, kind: 'order', status: 'done', entreprise_id: '44444444-4444-4444-8444-444444444444', result: { texte: 'secret' } });
    expect((await request(app).get('/api/agents/jobs').set(as('client'))).body).toEqual([]);
    expect((await request(app).get(`/api/agents/jobs/${id}`).set(as('client'))).status).toBe(404);
  });

  it('canReadJob matches only the member entreprises', () => {
    const { canReadJob, clientView } = clientRoutes;
    expect(canReadJob({ entreprise_id: 'e1' }, ['e1'])).toBe(true);
    expect(canReadJob({ entreprise_id: 'e2' }, ['e1'])).toBe(false);
    expect(canReadJob({ entreprise_id: null }, ['e1'])).toBe(false);
    const view = clientView({ id: 'j', status: 'done', result: { texte: 'livrable' }, cost_usd: 3, payload: { x: 1 } });
    expect(view).toEqual({ id: 'j', kind: undefined, status: 'done', created_at: undefined, finished_at: undefined, livrable: 'livrable' });
  });
});

describe('/healthz report', () => {
  it('reports db ok, queue sizes and worker age', async () => {
    mockDb.tables.agent_jobs.push({ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }, { id: 'c', status: 'running' });
    mockDb.tables.agent_workers.push({ worker: 'w', seen_at: new Date(Date.parse('2026-10-02T12:00:00Z')).toISOString(), state: 'idle_no_key' });
    const r = await healthReport(mockDb, { now: () => Date.parse('2026-10-02T12:00:42Z') });
    expect(r).toEqual({ status: 'ok', db: 'ok', queue: { queued: 2, running: 1 }, worker: { seen_seconds_ago: 42 } });
  });

  it('reports ko without leaking the error', async () => {
    const broken = { from: () => { throw new Error('password=hunter2 host=db.internal'); } };
    const r = await healthReport(broken);
    expect(r).toEqual({ status: 'degraded', db: 'ko', queue: null, worker: null });
    expect(JSON.stringify(r)).not.toMatch(/hunter2|internal/);
  });
});
