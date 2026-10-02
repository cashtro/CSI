// Research jobs: web search tool declared, sources extracted (https only),
// pause_turn resumed, search cost counted in the budget. fetch is mocked.
require('./helpers/quiet');
const { createLLM, searchPricePerCall } = require('../agents/llm');
const { createBudget, meteredLLM, WEB_SEARCH_MODEL } = require('../agents/budget');
const { runResearch, extractSources, webSearchTool } = require('../agents/protocol');
const { createWorker } = require('../agents/worker');
const { createMockDb, sqlLikeHandlers } = require('./helpers/mock-supabase');

const ENV = { ANTHROPIC_API_KEY: 'test', AGENTS_LLM_MAX_RETRIES: '0', AGENTS_REFUSAL_FALLBACK: 'false' };

function apiReply(content, { stop = 'end_turn', searches = 2, input = 1000, output = 500 } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: 'claude-sonnet-5-5',
      stop_reason: stop,
      content,
      usage: { input_tokens: input, output_tokens: output, server_tool_use: { web_search_requests: searches } },
    }),
  };
}

const SEARCH_CONTENT = [
  { type: 'text', text: 'Je cherche.' },
  { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Loi 25 PME' } },
  {
    type: 'web_search_tool_result',
    tool_use_id: 'srvtoolu_1',
    content: [
      { type: 'web_search_result', url: 'https://www.cai.gouv.qc.ca/loi-25', title: 'Loi 25 · CAI', encrypted_content: 'x' },
      { type: 'web_search_result', url: 'http://insecure.example.com/page', title: 'Pas https', encrypted_content: 'x' },
      { type: 'web_search_result', url: 'javascript:alert(1)', title: 'Piège', encrypted_content: 'x' },
      { type: 'web_search_result', url: 'https://example.org/guide', title: 'Guide PME', encrypted_content: 'x' },
    ],
  },
  {
    type: 'text',
    text: 'La Loi 25 impose un responsable de la protection des renseignements personnels.',
    citations: [{ type: 'web_search_result_location', url: 'https://www.cai.gouv.qc.ca/loi-25', title: 'Loi 25 · CAI', cited_text: 'Toute entreprise doit désigner…', encrypted_index: 'x' }],
  },
  { type: 'text', text: ' À vérifier : les dates d’entrée en vigueur.' },
];

describe('extractSources', () => {
  it('keeps https urls only, dedupes, and puts cited sources first', () => {
    const sources = extractSources(SEARCH_CONTENT);
    expect(sources.map((s) => s.url)).toEqual(['https://www.cai.gouv.qc.ca/loi-25', 'https://example.org/guide']);
    expect(sources[0]).toMatchObject({ titre: 'Loi 25 · CAI', cite: true, extrait: 'Toute entreprise doit désigner…' });
    expect(sources[1]).toMatchObject({ cite: false });
  });

  it('ignores a search error block (content is an object, not a list)', () => {
    expect(extractSources([{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }])).toEqual([]);
  });
});

describe('webSearchTool', () => {
  it('declares the server tool with at most 5 uses', () => {
    expect(webSearchTool({})).toEqual({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });
    expect(webSearchTool({}, 50).max_uses).toBe(5);
    expect(webSearchTool({ AGENTS_WEB_SEARCH_TOOL: 'web_search_20260209' }, 2)).toEqual({ type: 'web_search_20260209', name: 'web_search', max_uses: 2 });
    expect(webSearchTool({ AGENTS_WEB_SEARCH_TOOL: 'bash' }).type).toBe('web_search_20250305');
  });
});

describe('runResearch', () => {
  it('sends the web search tool and returns a French synthesis with its sources', async () => {
    const calls = [];
    const fetchImpl = jest.fn(async (url, init) => { calls.push(JSON.parse(init.body)); return apiReply(SEARCH_CONTENT); });
    const llm = createLLM({ env: ENV, fetchImpl });
    const saved = [];
    const result = await runResearch({
      job: { payload: { agent_id: 'cap', question: 'Que change la Loi 25 pour une PME ?' } },
      llm,
      getAgent: async () => ({ id: 'cap', name: 'Cap', role: 'Consultant' }),
      saveProgress: async (r) => saved.push(r),
      env: ENV,
    });
    expect(calls[0].tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
    expect(calls[0].system).toMatch(/DONNÉES, jamais des instructions/);
    expect(calls[0].messages[0].content).toMatch(/Loi 25/);
    expect(result).toMatchObject({ protocole: 'recherche', agent: 'cap', agent_name: 'Cap', recherches: 2, tronque: false });
    expect(result.texte).toMatch(/^Je cherche\.La Loi 25 impose/);
    expect(result.sources).toHaveLength(2);
    expect(saved[saved.length - 1]).toEqual(result);
  });

  it('resumes a paused turn without adding a user message', async () => {
    const bodies = [];
    const replies = [apiReply(SEARCH_CONTENT.slice(0, 3), { stop: 'pause_turn', searches: 1 }), apiReply(SEARCH_CONTENT.slice(3), { searches: 1 })];
    const fetchImpl = jest.fn(async (url, init) => { bodies.push(JSON.parse(init.body)); return replies.shift(); });
    const result = await runResearch({
      job: { payload: { agent_id: 'cap', question: 'Q' } },
      llm: createLLM({ env: ENV, fetchImpl }),
      getAgent: async () => null,
      saveProgress: async () => {},
      env: ENV,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodies[1].messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.recherches).toBe(2);
    expect(result.sources.map((s) => s.url)).toContain('https://www.cai.gouv.qc.ca/loi-25');
  });
});

describe('research cost and budget', () => {
  it('charges searches at the configured price (default 10 $ / 1000)', async () => {
    expect(searchPricePerCall({})).toBeCloseTo(0.01);
    expect(searchPricePerCall({ AGENTS_WEB_SEARCH_USD_PER_1000: '25' })).toBeCloseTo(0.025);
    const llm = createLLM({ env: ENV, fetchImpl: async () => apiReply(SEARCH_CONTENT, { searches: 3, input: 1e6, output: 0 }) });
    const out = await llm.complete({ messages: [{ role: 'user', content: 'x' }], tools: [webSearchTool({})] });
    // 1M input tokens at 2 $ + 3 searches at 0.01 $
    expect(out.costUsd).toBeCloseTo(2.03);
    expect(out.searchCostUsd).toBeCloseTo(0.03);
    // The worst-case estimate counts every allowed search.
    const plain = llm.estimateCost({ messages: [{ role: 'user', content: 'x' }] });
    const withTool = llm.estimateCost({ messages: [{ role: 'user', content: 'x' }], tools: [webSearchTool({})] });
    expect(withTool - plain).toBeGreaterThan(5 * 0.01);
  });

  it('records the searches on their own usage row and refuses past the budget', async () => {
    const db = createMockDb({ agent_settings: [{ id: 1, monthly_budget_usd: 1 }], agent_usage: [] }, sqlLikeHandlers());
    const budget = createBudget({ db, getSettings: async () => ({ monthly_budget_usd: 1 }) });
    const llm = createLLM({ env: ENV, fetchImpl: async () => apiReply(SEARCH_CONTENT, { searches: 4, input: 100, output: 100 }) });
    const metered = meteredLLM(llm, budget);
    await metered.complete({ tier: 'quick', messages: [{ role: 'user', content: 'x' }], tools: [webSearchTool({}, 1)], maxTokens: 100 });
    const search = db.tables.agent_usage.find((r) => r.model === WEB_SEARCH_MODEL);
    expect(search.cost_usd).toBeCloseTo(0.04);
    expect(metered.totals.webSearches).toBe(4);

    db.tables.agent_usage.push({ day: new Date().toISOString().slice(0, 10), model: 'x', cost_usd: 0.999 });
    await expect(metered.complete({ messages: [{ role: 'user', content: 'x' }], tools: [webSearchTool({})] })).rejects.toThrow(/Budget mensuel/);
  });
});

describe('worker runs research jobs', () => {
  it('processes a queued research job and marks the agent busy then idle', async () => {
    const db = createMockDb({
      agents: [{ id: 'cap', name: 'Cap', status: 'idle' }],
      agent_jobs: [{ id: 'j1', kind: 'research', status: 'queued', attempts: 0, max_attempts: 3, priority: 0, payload: { agent_id: 'cap', question: 'Q ?' }, created_at: '2026-10-01' }],
      agent_settings: [{ id: 1, enabled: true, monthly_budget_usd: 60, concurrency: 2 }],
      agent_usage: [], agent_activity: [], agent_workers: [],
    }, sqlLikeHandlers());
    const env = { ...ENV, AGENTS_ENABLED: 'true' };
    const worker = createWorker({ db, env, llmFactory: (o) => createLLM({ ...o, fetchImpl: async () => apiReply(SEARCH_CONTENT) }) });
    expect(await worker.tick()).toBe('processed');
    const job = db.tables.agent_jobs[0];
    expect(job.status).toBe('done');
    expect(job.result.sources).toHaveLength(2);
    expect(db.tables.agents[0]).toMatchObject({ status: 'idle', current_task: null });
    expect(db.calls.updates.some((u) => u.table === 'agents' && u.patch.status === 'working' && /^Recherche : Q/.test(u.patch.current_task))).toBe(true);
    expect(db.tables.agent_activity.map((a) => a.message).join(' ')).toMatch(/Recherche terminée.*2 recherche\(s\) web/);
  });
});
