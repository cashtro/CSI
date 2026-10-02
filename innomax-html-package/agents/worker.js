// Job loop for the agent engine (started by scripts/agents-worker.js).
//
// Each tick:
//   1. writes a heartbeat to agent_workers (read by /healthz);
//   2. stays idle when ANTHROPIC_API_KEY is missing, AGENTS_ENABLED is not
//      "true", or agent_settings.enabled is false (both switches must be on);
//   3. returns jobs abandoned in 'running' for more than 15 min to the queue;
//   4. claims one job with claim_agent_job() (FOR UPDATE SKIP LOCKED) and runs it.
//
// While a job runs, locked_at is refreshed so it is not seen as abandoned.
// stop() (SIGTERM) stops claiming, waits for the current job for a grace
// period, then hands it back to the queue.

const os = require('os');
const crypto = require('crypto');
const logger = require('../routes(api)/utils/logger');
const { createLLM, CircuitOpenError } = require('./llm');
const { createBudget, meteredLLM, BudgetExceededError } = require('./budget');
const { runOrder, runCouncil, CancelledError } = require('./protocol');
const store = require('./store');

const STALE_MINUTES = 15;

function retryDelayMs(attempts) {
  return Math.min(30, 2 ** Math.max(0, attempts - 1)) * 60 * 1000; // 1, 2, 4 … 30 min
}

function createWorker({
  db,
  env = process.env,
  llmFactory = (opts) => createLLM(opts),
  workerId = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`,
  pollMs = 5000,
  heartbeatMs = 30000,
  staleMinutes = STALE_MINUTES,
  stopGraceMs = 20000,
  now = () => new Date(),
} = {}) {
  let stopping = false;
  let current = null;        // { job, promise }
  let lastIdle = null;
  let wake = null;
  let loopPromise = null;
  let heartbeatFailing = false;

  const idle = (reason, message) => {
    if (lastIdle !== reason) logger.info(`[agents] worker au repos : ${message}`);
    lastIdle = reason;
    return reason;
  };

  async function heartbeat(state) {
    const { error } = await db.from('agent_workers').upsert({ worker: workerId, state, seen_at: now().toISOString() });
    if (error && !heartbeatFailing) logger.warn('[agents] heartbeat failed:', error.message);
    heartbeatFailing = Boolean(error);
  }

  const mine = (q, id) => q.eq('id', id).eq('locked_by', workerId).eq('status', 'running');

  async function updateJob(id, patch) {
    const { error } = await mine(db.from('agent_jobs').update({ ...patch, updated_at: now().toISOString() }), id);
    if (error) logger.error(`[agents] job ${id} update failed:`, error.message);
  }

  async function processJob(job, settings) {
    const totals = { costUsd: 0, tokensIn: 0, tokensOut: 0, calls: 0 };
    const budget = createBudget({ db, getSettings: () => store.getSettings(db) });
    const llm = meteredLLM(llmFactory({ env, models: () => store.modelsFromSettings(settings) }), budget, totals);
    const money = () => ({ cost_usd: Number(totals.costUsd.toFixed(6)), tokens_in: totals.tokensIn, tokens_out: totals.tokensOut });
    const beat = setInterval(() => {
      updateJob(job.id, { locked_at: now().toISOString() }).catch(() => {});
      heartbeat('running').catch(() => {});
    }, heartbeatMs);
    if (beat.unref) beat.unref();

    const deps = {
      job,
      llm,
      getAgent: (id) => store.getAgent(db, id),
      concurrency: settings.concurrency,
      saveProgress: (result) => updateJob(job.id, { result, ...money() }),
      isCancelled: async () => {
        const { data } = await db.from('agent_jobs').select('status').eq('id', job.id).maybeSingle();
        return !data || data.status === 'cancelled';
      },
      createTasks: async (rows) => {
        if (!rows.length) return 0;
        const { error } = await db.from('agent_tasks').insert(rows.map((r) => ({ ...r, job_id: job.id, entreprise_id: job.entreprise_id || null })));
        if (error) throw new Error(`agent_tasks : ${error.message}`);
        return rows.length;
      },
      onEvent: (phase) => store.logActivity(db, { job_id: job.id, kind: 'phase', message: `Conseil : ${phase}` }),
    };

    await store.logActivity(db, { job_id: job.id, kind: 'job_started', message: `${job.kind === 'debate' ? 'Conseil' : 'Ordre'} démarré (tentative ${job.attempts})` });
    const agentId = job.kind === 'order' && job.payload && job.payload.agent_id;
    if (agentId) await db.from('agents').update({ status: 'working', current_task: String(job.payload.instruction || '').slice(0, 200) }).eq('id', agentId);

    try {
      const result = job.kind === 'debate' ? await runCouncil(deps) : await runOrder(deps);
      await updateJob(job.id, { status: 'done', result, error: null, finished_at: now().toISOString(), locked_by: null, ...money() });
      await store.logActivity(db, { job_id: job.id, kind: 'job_done', message: `Terminé (${totals.calls} appels, ${totals.costUsd.toFixed(4)} $)` });
      return 'done';
    } catch (err) {
      if (err instanceof CancelledError) {
        await db.from('agent_jobs').update({ ...money(), locked_by: null, finished_at: now().toISOString() }).eq('id', job.id).eq('status', 'cancelled');
        await store.logActivity(db, { job_id: job.id, kind: 'job_cancelled', message: 'Annulé' });
        return 'cancelled';
      }
      if (err instanceof BudgetExceededError) {
        await updateJob(job.id, { status: 'budget_refused', error: err.message, finished_at: now().toISOString(), locked_by: null, ...money() });
        await store.logActivity(db, { job_id: job.id, kind: 'job_budget_refused', message: err.message });
        logger.warn(`[agents] job ${job.id} refusé : ${err.message}`);
        return 'budget_refused';
      }
      const retryable = Boolean(err.retryable) || err instanceof CircuitOpenError;
      if (retryable && job.attempts < job.max_attempts) {
        const runAfter = new Date(now().getTime() + retryDelayMs(job.attempts)).toISOString();
        await updateJob(job.id, { status: 'queued', error: err.message, run_after: runAfter, locked_by: null, locked_at: null, ...money() });
        await store.logActivity(db, { job_id: job.id, kind: 'job_retry', message: `Nouvel essai prévu : ${err.message}` });
        return 'requeued';
      }
      logger.error(`[agents] job ${job.id} failed:`, err.message);
      await updateJob(job.id, { status: 'error', error: String(err.message).slice(0, 2000), finished_at: now().toISOString(), locked_by: null, ...money() });
      await store.logActivity(db, { job_id: job.id, kind: 'job_error', message: String(err.message).slice(0, 500) });
      return 'error';
    } finally {
      clearInterval(beat);
      if (agentId) await db.from('agents').update({ status: 'idle', current_task: null }).eq('id', agentId);
    }
  }

  async function tick() {
    if (!env.ANTHROPIC_API_KEY) {
      await heartbeat('idle_no_key');
      return idle('idle_no_key', 'ANTHROPIC_API_KEY absente, aucun travail ne sera traité.');
    }
    if (env.AGENTS_ENABLED !== 'true') {
      await heartbeat('disabled_env');
      return idle('disabled_env', 'AGENTS_ENABLED n’est pas « true ».');
    }
    const settings = await store.getSettings(db);
    if (!settings.enabled) {
      await heartbeat('disabled_settings');
      return idle('disabled_settings', 'moteur désactivé dans les réglages (agent_settings.enabled).');
    }
    if (lastIdle) logger.info('[agents] worker actif.');
    lastIdle = null;
    await heartbeat('polling');

    const { data: requeued, error: staleErr } = await db.rpc('requeue_stale_agent_jobs', { stale_minutes: staleMinutes });
    if (staleErr) logger.warn('[agents] requeue_stale_agent_jobs failed:', staleErr.message);
    else if (requeued) logger.warn(`[agents] ${requeued} travail(s) abandonné(s) remis en file.`);

    if (stopping) return 'stopping';
    const { data, error } = await db.rpc('claim_agent_job', { worker: workerId });
    if (error) throw new Error(`claim_agent_job : ${error.message}`);
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return 'empty';

    const promise = processJob(job, settings);
    current = { job, promise };
    try { await promise; } finally { current = null; }
    return 'processed';
  }

  function pause(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => { clearTimeout(t); resolve(); };
    });
  }

  function start() {
    logger.info(`[agents] worker ${workerId} démarré.`);
    loopPromise = (async () => {
      while (!stopping) {
        let r;
        try { r = await tick(); } catch (err) { logger.error('[agents] tick failed:', err.message); }
        if (!stopping && r !== 'processed') await pause(pollMs);
      }
    })();
    return loopPromise;
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    if (wake) wake();
    logger.info('[agents] arrêt demandé, fin du travail en cours…');
    if (current) {
      const { job, promise } = current;
      const finished = await Promise.race([promise.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), stopGraceMs))]);
      if (!finished) {
        await mine(db.from('agent_jobs').update({
          status: 'queued', locked_by: null, locked_at: null, attempts: Math.max(0, job.attempts - 1), updated_at: now().toISOString(),
        }), job.id);
        logger.warn(`[agents] job ${job.id} remis en file à l’arrêt.`);
      }
    }
    await heartbeat('stopped').catch(() => {});
    if (loopPromise) await Promise.race([loopPromise, new Promise((r) => setTimeout(r, 1000))]);
  }

  return { start, stop, tick, processJob, workerId, get stopping() { return stopping; } };
}

module.exports = { createWorker, retryDelayMs, STALE_MINUTES };
