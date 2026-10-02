// Example data of the local demo: the 38 agents, a finished Council converted
// from the artifact to the engine format, and the fake Anthropic API.
require('./helpers/quiet');
const { createMockDb } = require('./helpers/mock-supabase');
const { seedDemo } = require('../scripts/demo/data');
const { createFakeAnthropic } = require('../scripts/demo/fake-anthropic');
const { createLLM } = require('../agents/llm');
const { runResearch, SCHEMAS } = require('../agents/protocol');
const { validate } = require('../agents/json');

describe('demo data', () => {
  it('seeds the 38 agents and a finished Council in the engine format', async () => {
    const db = createMockDb({}, {}, { uuid: true });
    const { debateId } = await seedDemo(db);
    expect(db.tables.agents).toHaveLength(38);
    const debate = db.tables.agent_jobs.find((j) => j.id === debateId);
    expect(debate).toMatchObject({ kind: 'debate', status: 'done', result: { phase: 'termine', consensus: true } });
    expect(debate.result.propositions[0]).toMatchObject({ agent: 'conseil-strategie', nom: 'Cap' });
    expect(debate.result.propositions.every((p) => p.confiance >= 0 && p.confiance <= 1)).toBe(true);
    expect(debate.result.tours[0].votes).toHaveLength(10);
    expect(debate.payload.proposeurs.every((id) => db.tables.agents.some((a) => a.id === id))).toBe(true);
    expect(db.tables.agent_tasks).toHaveLength(debate.result.decision.taches.length);
  });

  it('the fake API answers every Council schema with valid JSON, and research with sources', async () => {
    const { councilAnswer } = require('../scripts/demo/fake-anthropic');
    for (const key of Object.keys(SCHEMAS)) expect({ key, errors: validate(SCHEMAS[key], councilAnswer(key, 'S')) }).toEqual({ key, errors: [] });
    const llm = createLLM({ env: { ANTHROPIC_API_KEY: 'demo', AGENTS_REFUSAL_FALLBACK: 'false' }, fetchImpl: createFakeAnthropic({ delayMs: 0 }) });
    const r = await runResearch({ job: { payload: { agent_id: 'x', question: 'Q ?' } }, llm, getAgent: async () => null, saveProgress: async () => {}, env: {} });
    expect(r.texte).toMatch(/Démo/);
    expect(r.sources.length).toBe(3);
  });
});

describe('demo robots', () => {
  it('seeds a client with robots, a deliverable to validate, and a fake Stripe that charges nothing', async () => {
    const { seedRobotsDemo, createFakeStripe, CLIENT_ID } = require('../scripts/demo/robots');
    const db = createMockDb({}, {}, { uuid: true });
    await seedDemo(db);
    seedRobotsDemo(db);
    expect(db.tables.robots_offres).toHaveLength(6);
    expect(db.tables.membres.find((m) => m.user_id === CLIENT_ID).role).toBe('proprietaire');
    expect(db.tables.livrables.some((l) => l.statut === 'a_valider')).toBe(true);
    expect(db.tables.connexions.every((c) => c.jetons === null)).toBe(true);
    const stripe = createFakeStripe()('sk_none');
    const s = await stripe.checkout.sessions.create({ mode: 'subscription', metadata: { type: 'robot' } });
    expect(s.url).toMatch(/^\/demo\/stripe\/cs_demo_/);
    expect((await stripe.checkout.sessions.retrieve(s.id)).payment_status).toBe('paid');
  });
});
