// API behind the admin "Agents" tab: research route (admin + 2FA, CSRF,
// budget), agents and activity reads, job filters, and the starting-agents
// seed (route and script), which must be idempotent.
require('./helpers/quiet');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createMockDb } = require('./helpers/mock-supabase');

const USERS = { admin2fa: 'u-admin', client: 'u-client' };
const ENT = '44444444-4444-4444-8444-444444444444';
let mockDb;
function mockReset() {
  mockDb = createMockDb({
    Users: [{ userId: 'u-admin', isAdmin: true }, { userId: 'u-client', isAdmin: false }],
    agents: [{ id: 'conseil-strategie', name: 'Cap', team: 'conseil', status: 'idle' }, { id: 'redac', name: 'Rédactrice', team: 'contenu', status: 'working' }],
    agent_jobs: [], agent_activity: [], agent_settings: [{ id: 1, enabled: false, monthly_budget_usd: 60, concurrency: 2 }], agent_usage: [], agent_tasks: [],
  });
  mockDb.auth = { getUser: async (token) => ({ data: { user: USERS[token] ? { id: USERS[token] } : null }, error: null }) };
}
mockReset();
jest.mock('../routes(api)/utils/supabaseUtil', () => ({
  createSupabaseAdmin: () => new Proxy({}, { get: (_, k) => mockDb[k] }),
  createSupabaseClient: () => new Proxy({}, { get: (_, k) => mockDb[k] }),
}));

const adminRoutes = require('../routes(api)/agentsAdmin');
const catalog = require('../agents/catalog');
const { monthStart } = require('../agents/budget');
const { signMfaProof } = require('../routes(api)/utils/twofa');

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use('/api/admin/agents', adminRoutes);
beforeEach(mockReset);

// Signed after the logger is silenced (helpers/quiet).
let mfa;
let admin;
beforeAll(() => {
  mfa = `mfa=${signMfaProof('u-admin', Date.now() + 3600e3)}`;
  admin = { Authorization: 'Bearer admin2fa', Cookie: mfa };
});
const research = (body, headers = admin) => request(app).post('/api/admin/agents/jobs/research').set(headers).send(body);

describe('research route: access', () => {
  const routes = [
    ['post', '/api/admin/agents/jobs/research'],
    ['get', '/api/admin/agents/agents'],
    ['get', '/api/admin/agents/activity'],
    ['post', '/api/admin/agents/seed'],
    ['get', '/api/admin/agents/summary'],
    ['post', '/api/admin/agents/emergency-stop'],
  ];
  it.each(routes)('%s %s refuses visitors, non-admins and an admin without the 2FA proof', async (method, url) => {
    expect((await request(app)[method](url).send({})).status).toBe(401);
    expect((await request(app)[method](url).set({ Authorization: 'Bearer client' }).send({})).status).toBe(403);
    const noMfa = await request(app)[method](url).set({ Authorization: 'Bearer admin2fa' }).send({});
    expect(noMfa.status).toBe(403);
    expect(noMfa.body.error).toMatch(/Double authentification/);
    expect(mockDb.tables.agent_jobs).toHaveLength(0);
  });

  it('requires the CSRF token when the session comes from cookies', async () => {
    const cookie = `accessToken=admin2fa; ${mfa}`;
    const bad = await research({ question: 'Q ?' }, { Cookie: cookie });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toMatch(/CSRF/);
    const ok = await research({ question: 'Q ?' }, { Cookie: `${cookie}; XSRF-TOKEN=t`, 'X-CSRF-Token': 't' });
    expect(ok.status).toBe(201);
  });
});

describe('research route: jobs and budget', () => {
  it('queues a research job for Cap by default', async () => {
    const res = await research({ question: 'Que change la Loi 25 pour une PME ?', entreprise_id: ENT });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('research');
    expect(mockDb.tables.agent_jobs[0]).toMatchObject({
      kind: 'research', entreprise_id: ENT, created_by: 'u-admin', payload: { agent_id: 'conseil-strategie', question: 'Que change la Loi 25 pour une PME ?' },
    });
    expect(mockDb.tables.agent_activity[0]).toMatchObject({ kind: 'job_queued', agent_id: 'conseil-strategie', message: 'Recherche mis en file' });
  });

  it('validates the question, the agent and max_uses', async () => {
    expect((await research({})).status).toBe(400);
    expect((await research({ question: 'x'.repeat(2001) })).status).toBe(400);
    expect((await research({ question: 'Q', agent_id: 'inconnu' })).status).toBe(400);
    expect((await research({ question: 'Q', max_uses: 9 })).status).toBe(400);
    expect((await research({ question: 'Q', agent_id: 'redac', max_uses: 2 })).status).toBe(201);
  });

  it('refuses a research the month budget cannot cover', async () => {
    mockDb.tables.agent_usage.push({ day: monthStart(), model: 'claude-sonnet-5-5', cost_usd: 59.99 });
    const res = await research({ question: 'Q ?' });
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/Budget mensuel atteint/);
    expect(mockDb.tables.agent_jobs).toHaveLength(0);
  });
});

describe('agents tab reads', () => {
  it('lists agents with their status and the ten teams', async () => {
    const res = await request(app).get('/api/admin/agents/agents').set(admin);
    expect(res.status).toBe(200);
    expect(res.body.teams).toHaveLength(10);
    expect(res.body.agents.find((a) => a.id === 'redac').status).toBe('working');
  });

  it('returns activity after an id (polling fallback of the stream)', async () => {
    mockDb.tables.agent_activity.push({ id: 1, kind: 'a', message: 'un' }, { id: 2, kind: 'b', message: 'deux' }, { id: 3, kind: 'c', message: 'trois' });
    const all = await request(app).get('/api/admin/agents/activity').set(admin);
    expect(all.body.map((r) => r.id)).toEqual([1, 2, 3]);
    const after = await request(app).get('/api/admin/agents/activity?after=2').set(admin);
    expect(after.body.map((r) => r.id)).toEqual([3]);
  });

  it('filters jobs by kind, agent and client', async () => {
    mockDb.tables.agent_jobs.push(
      { id: 'a', kind: 'research', status: 'done', payload: { agent_id: 'conseil-strategie' }, entreprise_id: ENT },
      { id: 'b', kind: 'order', status: 'queued', payload: { agent_id: 'redac' }, entreprise_id: null },
      { id: 'c', kind: 'debate', status: 'running', payload: {}, entreprise_id: ENT },
    );
    const ids = async (qs) => (await request(app).get(`/api/admin/agents/jobs?${qs}`).set(admin)).body.map((j) => j.id).sort();
    expect(await ids('kind=research')).toEqual(['a']);
    expect(await ids('agent_id=redac')).toEqual(['b']);
    expect(await ids(`entreprise_id=${ENT}`)).toEqual(['a', 'c']);
    expect((await request(app).get('/api/admin/agents/jobs?kind=autre').set(admin)).status).toBe(400);
    expect((await request(app).get('/api/admin/agents/jobs?entreprise_id=x').set(admin)).status).toBe(400);
  });
});

describe('console summary and emergency stop', () => {
  it('counts agents at work, running and queued jobs and consensus', async () => {
    mockDb.tables.agent_jobs.push(
      { id: 'a', kind: 'order', status: 'running', payload: {} },
      { id: 'b', kind: 'order', status: 'queued', payload: {} },
      { id: 'c', kind: 'debate', status: 'done', payload: {}, result: { consensus: true } },
      { id: 'd', kind: 'debate', status: 'done', payload: {}, result: { consensus: false } },
    );
    const res = await request(app).get('/api/admin/agents/summary').set(admin);
    expect(res.body).toEqual({ agents: 2, working: 1, running: 1, queued: 1, consensus: 1 });
  });

  it('turns the engine off and cancels queued and running jobs', async () => {
    mockDb.tables.agent_settings[0].enabled = true;
    mockDb.tables.agent_jobs.push(
      { id: 'a', kind: 'order', status: 'running', payload: {} },
      { id: 'b', kind: 'research', status: 'queued', payload: {} },
      { id: 'c', kind: 'order', status: 'done', payload: {} },
    );
    const res = await request(app).post('/api/admin/agents/emergency-stop').set(admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, cancelled: 2 });
    expect(mockDb.tables.agent_settings[0].enabled).toBe(false);
    expect(mockDb.tables.agent_jobs.map((j) => j.status)).toEqual(['cancelled', 'cancelled', 'done']);
    expect(mockDb.tables.agent_activity.some((a) => a.kind === 'emergency_stop')).toBe(true);
  });
});

describe('starting agents (db/seed_agents.json)', () => {
  it('holds the 49 agents (38 of the Centre de commande + 11 reinforcements), in the ten teams', () => {
    const list = catalog.loadSeed();
    expect(list).toHaveLength(49);
    expect(new Set(list.map((a) => a.id)).size).toBe(49);
    for (const id of ['contra-chiffres', 'infra-devops', 'infra-veille', 'planif-capacite', 'planif-sprint', 'revue-faits', 'revue-juge', 'ventes-closing', 'ventes-prospection', 'ventes-succes', 'web-frontend']) {
      expect(list.some((a) => a.id === id)).toBe(true);
    }
    expect(catalog.seedCount()).toBe(49);
    const teams = new Set(catalog.TEAMS.map((t) => t.key));
    expect(list.every((a) => teams.has(a.team))).toBe(true);
    expect(list.find((a) => a.id === catalog.DEFAULT_RESEARCH_AGENT)).toMatchObject({ name: 'Cap', team: 'conseil' });
    expect(catalog.normaliseList(list).errors).toBeUndefined();
  });

  it('seeds idempotently through the route and keeps edited agents', async () => {
    mockDb.tables.agents[0].role = 'Rôle modifié par l’admin';
    const first = await request(app).post('/api/admin/agents/seed').set(admin);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ inserted: 48, updated: 0, skipped: 1, total: 49 });
    const second = await request(app).post('/api/admin/agents/seed').set(admin);
    expect(second.body).toEqual({ inserted: 0, updated: 0, skipped: 49, total: 49 });
    expect(mockDb.tables.agents).toHaveLength(50); // 49 + "redac"
    expect(mockDb.tables.agents.find((a) => a.id === 'conseil-strategie').role).toBe('Rôle modifié par l’admin');
  });

  it('the script seeds once, and --force rewrites the fields', async () => {
    const { run } = require('../scripts/seed-agents');
    const db = createMockDb({ agents: [] });
    expect(await run({ db, args: [] })).toMatchObject({ inserted: 49, skipped: 0 });
    db.tables.agents[0].name = 'Changé';
    expect(await run({ db, args: [] })).toMatchObject({ inserted: 0, skipped: 49 });
    expect(db.tables.agents).toHaveLength(49);
    expect(db.tables.agents[0].name).toBe('Changé');
    expect(await run({ db, args: ['--force'] })).toMatchObject({ inserted: 0, updated: 49 });
    expect(db.tables.agents.some((a) => a.name === 'Changé')).toBe(false);
    expect(db.tables.agents.every((a) => a.status === 'idle')).toBe(true);
  });
});
