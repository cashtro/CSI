// /healthz report. Leaks nothing: no error text, no hostnames, no config
// state, only ok/ko, queue sizes and how long ago a worker was seen.

const TIMEOUT_MS = 3000;

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(t));
}

async function healthReport(db, { now = () => Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  const count = (status) => db.from('agent_jobs').select('id', { count: 'exact', head: true }).eq('status', status);
  try {
    const [queued, running, workers] = await withTimeout(Promise.all([
      count('queued'),
      count('running'),
      db.from('agent_workers').select('seen_at').order('seen_at', { ascending: false }).limit(1),
    ]), timeoutMs);
    if (queued.error || running.error) throw new Error('db');
    const seen = !workers.error && workers.data && workers.data[0] ? Date.parse(workers.data[0].seen_at) : null;
    return {
      status: 'ok',
      db: 'ok',
      queue: { queued: queued.count || 0, running: running.count || 0 },
      worker: { seen_seconds_ago: Number.isFinite(seen) ? Math.max(0, Math.round((now() - seen) / 1000)) : null },
    };
  } catch (_) {
    return { status: 'degraded', db: 'ko', queue: null, worker: null };
  }
}

function healthHandler(getDb, opts) {
  return async (req, res) => {
    const report = await healthReport(getDb(), opts);
    res.set('Cache-Control', 'no-store');
    res.status(report.db === 'ok' ? 200 : 503).json(report);
  };
}

module.exports = { healthReport, healthHandler };
