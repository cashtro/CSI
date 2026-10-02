// agents/worker.js: idle without key, switches, claim, abandoned jobs, budget, retries, stop.
require('./helpers/quiet');
const { createWorker } = require('../agents/worker');
const { LLMError } = require('../agents/llm');
const { createMockDb, sqlLikeHandlers } = require('./helpers/mock-supabase');

const T0 = Date.parse('2026-10-15T12:00:00Z');
const ENV_ON = { ANTHROPIC_API_KEY: 'sk-test', AGENTS_ENABLED: 'true' };

function job(over = {}) {
  return {
    id: `job-${Math.random().toString(16).slice(2, 8)}`, kind: 'order', status: 'queued', priority: 0, attempts: 0, max_attempts: 3,
    run_after: new Date(T0 - 1000).toISOString(), created_at: new Date(T0 - 5000).toISOString(),
    payload: { agent_id: 'redac', instruction: 'Écris un résumé' }, ...over,
  };
}

function setup({ jobs = [], settings = { id: 1, enabled: true, monthly_budget_usd: 60, concurrency: 2 }, usage = [], env = ENV_ON, complete } = {}) {
  const db = createMockDb({
    agent_jobs: jobs, agent_settings: settings ? [settings] : [], agent_usage: usage,
    agents: [{ id: 'redac', name: 'Rédactrice', role: 'Rédaction' }], agent_activity: [], agent_workers: [], agent_tasks: [],
  }, sqlLikeHandlers(() => T0));
  const llm = {
    complete: complete || jest.fn(async () => ({ text: 'Voici le résumé', model: 'claude-sonnet-5-5', usage: { input_tokens: 100, output_tokens: 200 }, costUsd: 0.0022, stopReason: 'end_turn' })),
    estimateCost: () => 0.01,
    resolveModel: (t) => t,
  };
  const llmFactory = jest.fn(() => llm);
  const worker = createWorker({ db, env, llmFactory, workerId: 'w-test', now: () => new Date(T0), pollMs: 10, stopGraceMs: 30 });
  return { db, llm, llmFactory, worker };
}

const claimCalls = (db) => db.calls.rpc.filter((c) => c.name === 'claim_agent_job');
const logged = (re) => console.log.mock.calls.some((args) => re.test(args.join(' ')));

describe('agents worker: switches', () => {
  it('stays idle and logs it when ANTHROPIC_API_KEY is missing', async () => {
    const { db, worker, llmFactory } = setup({ jobs: [job()], env: { AGENTS_ENABLED: 'true' } });
    expect(await worker.tick()).toBe('idle_no_key');
    expect(claimCalls(db)).toHaveLength(0);
    expect(llmFactory).not.toHaveBeenCalled();
    expect(db.tables.agent_jobs[0].status).toBe('queued');
    expect(db.tables.agent_workers[0]).toMatchObject({ worker: 'w-test', state: 'idle_no_key' });
    expect(logged(/ANTHROPIC_API_KEY absente/)).toBe(true);
  });

  it('stays idle unless AGENTS_ENABLED=true', async () => {
    const { db, worker } = setup({ jobs: [job()], env: { ANTHROPIC_API_KEY: 'k' } });
    expect(await worker.tick()).toBe('disabled_env');
    expect(claimCalls(db)).toHaveLength(0);
  });

  it('stays idle when agent_settings.enabled is false (the default)', async () => {
    const { db, worker } = setup({ jobs: [job()], settings: null });
    expect(await worker.tick()).toBe('disabled_settings');
    expect(claimCalls(db)).toHaveLength(0);
  });
});

describe('agents worker: claim and run', () => {
  it('claims a queued order, runs it and stores text, cost and tokens', async () => {
    const { db, worker } = setup({ jobs: [job({ id: 'j1' })] });
    expect(await worker.tick()).toBe('processed');
    const j = db.tables.agent_jobs[0];
    expect(j).toMatchObject({ status: 'done', locked_by: null, tokens_in: 100, tokens_out: 200, attempts: 1 });
    expect(j.result.texte).toBe('Voici le résumé');
    expect(j.cost_usd).toBeCloseTo(0.0022);
    expect(db.tables.agent_usage).toHaveLength(1);
    expect(db.tables.agent_activity.map((a) => a.kind)).toEqual(['job_started', 'job_done']);
    expect(db.tables.agents[0]).toMatchObject({ status: 'idle', current_task: null });
    expect(claimCalls(db)[0].args).toEqual({ worker: 'w-test' });
  });

  it('takes the highest priority first and reports an empty queue', async () => {
    const { db, worker } = setup({ jobs: [job({ id: 'low' }), job({ id: 'high', priority: 5 })] });
    await worker.tick();
    expect(db.tables.agent_jobs.find((j) => j.id === 'high').status).toBe('done');
    expect(db.tables.agent_jobs.find((j) => j.id === 'low').status).toBe('queued');
    await worker.tick();
    expect(await worker.tick()).toBe('empty');
  });

  it('does not take a job whose run_after is in the future', async () => {
    const { worker } = setup({ jobs: [job({ run_after: new Date(T0 + 60000).toISOString() })] });
    expect(await worker.tick()).toBe('empty');
  });

  it('two workers never run the same job', async () => {
    const { db, llm } = setup({ jobs: [job()] });
    const a = createWorker({ db, env: ENV_ON, llmFactory: () => llm, workerId: 'a', now: () => new Date(T0) });
    const b = createWorker({ db, env: ENV_ON, llmFactory: () => llm, workerId: 'b', now: () => new Date(T0) });
    const results = await Promise.all([a.tick(), b.tick()]);
    expect(results.sort()).toEqual(['empty', 'processed']);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });
});

describe('agents worker: abandoned jobs', () => {
  it('requeues a job left running for more than 15 minutes, then runs it', async () => {
    const stale = job({ id: 'stale', status: 'running', attempts: 1, locked_by: 'dead', locked_at: new Date(T0 - 16 * 60000).toISOString() });
    const { db, worker } = setup({ jobs: [stale] });
    expect(await worker.tick()).toBe('processed');
    expect(db.calls.rpc.find((c) => c.name === 'requeue_stale_agent_jobs').args).toEqual({ stale_minutes: 15 });
    expect(db.tables.agent_jobs[0]).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('leaves a recently locked running job alone', async () => {
    const fresh = job({ status: 'running', attempts: 1, locked_by: 'other', locked_at: new Date(T0 - 5 * 60000).toISOString() });
    const { db, worker } = setup({ jobs: [fresh] });
    expect(await worker.tick()).toBe('empty');
    expect(db.tables.agent_jobs[0]).toMatchObject({ status: 'running', locked_by: 'other' });
  });

  it('marks an abandoned job as error once its attempts are spent', async () => {
    const dead = job({ status: 'running', attempts: 3, max_attempts: 3, locked_by: 'dead', locked_at: new Date(T0 - 60 * 60000).toISOString() });
    const { db, worker } = setup({ jobs: [dead] });
    await worker.tick();
    expect(db.tables.agent_jobs[0].status).toBe('error');
  });
});

describe('agents worker: failures', () => {
  it('refuses a job when the monthly budget is spent (status budget_refused, no API call)', async () => {
    const { db, worker, llm } = setup({ jobs: [job()], usage: [{ day: '2026-10-01', model: 'm', cost_usd: 60 }] });
    await worker.tick();
    expect(db.tables.agent_jobs[0].status).toBe('budget_refused');
    expect(db.tables.agent_jobs[0].error).toMatch(/Budget mensuel atteint/);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('requeues a transient failure with a delay while attempts remain', async () => {
    const complete = jest.fn(async () => { throw new LLMError('API 529', { status: 529, retryable: true }); });
    const { db, worker } = setup({ jobs: [job()], complete });
    await worker.tick();
    const j = db.tables.agent_jobs[0];
    expect(j.status).toBe('queued');
    expect(Date.parse(j.run_after)).toBe(T0 + 60000);
    expect(j.locked_by).toBeNull();
  });

  it('fails for good on a non-retryable error', async () => {
    const complete = jest.fn(async () => { throw new LLMError('API 400', { status: 400 }); });
    const { db, worker } = setup({ jobs: [job()], complete });
    await worker.tick();
    expect(db.tables.agent_jobs[0]).toMatchObject({ status: 'error', error: 'API 400' });
  });

  it('keeps a cancelled job cancelled', async () => {
    const { db, worker } = setup({ jobs: [job({ kind: 'debate', payload: { sujet: 's', proposeurs: ['redac'] } })] });
    db.tables.agent_jobs[0].status = 'queued';
    const origFrom = db.from;
    // Cancel as soon as the job is running.
    db.from = (t) => { if (t === 'agent_jobs' && db.tables.agent_jobs[0].status === 'running') db.tables.agent_jobs[0].status = 'cancelled'; return origFrom(t); };
    await worker.tick();
    expect(db.tables.agent_jobs[0].status).toBe('cancelled');
  });
});

describe('agents worker: stop', () => {
  it('hands a job that does not finish within the grace period back to the queue', async () => {
    let release;
    const complete = jest.fn(() => new Promise((r) => { release = r; }));
    const { db, worker } = setup({ jobs: [job()], complete });
    const ticking = worker.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(db.tables.agent_jobs[0].status).toBe('running');
    await worker.stop();
    expect(db.tables.agent_jobs[0]).toMatchObject({ status: 'queued', locked_by: null, attempts: 0 });
    release({ text: 'tard', model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, costUsd: 0 });
    await ticking;
    expect(db.tables.agent_jobs[0].status).toBe('queued'); // the late result does not overwrite
    expect(worker.stopping).toBe(true);
  });

  it('start() loops until stop()', async () => {
    const { worker } = setup({ env: {} });
    const loop = worker.start();
    await new Promise((r) => setTimeout(r, 30));
    await worker.stop();
    await loop;
    expect(logged(/worker au repos/)).toBe(true);
  });
});
