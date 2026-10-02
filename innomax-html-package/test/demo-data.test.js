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

  it('seeds the Finances tab with data marked « exemple »', async () => {
    const db = createMockDb({}, {}, { uuid: true });
    await seedDemo(db);
    const t = db.tables;
    expect(t.bills.length).toBeGreaterThan(20);
    expect(t.bills.every((b) => /\(exemple\)/.test(b.source) && /@exemple\.demo$/.test(b.payment_data.customer_details.email))).toBe(true);
    expect(t.depenses.length).toBeGreaterThan(30);
    expect(t.depenses.every((d) => /\(exemple\)/.test(d.fournisseur))).toBe(true);
    expect(t.objectifs_financiers).toHaveLength(4);
    const { loadFinances } = require('../routes(api)/utils/finances');
    const fin = await loadFinances(db);
    expect(fin.kpi.revenus).toBeGreaterThan(0);
    expect(fin.alerts.map((a) => a.id)).toEqual(expect.arrayContaining(['ia']));
    expect(fin.alerts.some((a) => a.titre === 'Dépense inhabituelle')).toBe(true);
  });
});
