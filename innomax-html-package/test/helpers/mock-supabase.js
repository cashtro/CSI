// In-memory Supabase stand-in for the agent engine tests. Covers the query
// builder calls the engine makes, plus rpc() through injectable handlers.

// Column value, with PostgREST JSON paths: 'payload->>agent_id'.
function pick(row, col) {
  if (!String(col).includes('->')) return row[col];
  const [base, ...keys] = String(col).split(/->>?/);
  let v = row[base];
  for (const k of keys) v = v == null ? undefined : v[k];
  return keys.length && String(col).includes('->>') && v != null ? String(v) : v;
}

// options.uuid: ids are random UUIDs (like gen_random_uuid()), for code
// that validates them. options.defaults: { table: () => columns } applied on
// insert, like the SQL column defaults (used by the local demo).
function createMockDb(seed = {}, rpcHandlers = {}, options = {}) {
  const tables = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  let seq = 1000;
  const calls = { rpc: [], updates: [] };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.op = 'select';
      this.opts = {};
      this.lim = null;
      this.orders = [];
    }
    rows() { if (!tables[this.table]) tables[this.table] = []; return tables[this.table]; }
    select(cols, opts) { if (this.op === 'select') this.opts = opts || {}; this.returning = true; return this; }
    insert(rows) { this.op = 'insert'; this.payload = [].concat(rows); return this; }
    upsert(rows, opts) { this.op = 'upsert'; this.payload = [].concat(rows); this.conflict = (opts && opts.onConflict) || null; return this; }
    update(patch) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push((r) => pick(r, c) === v); return this; }
    gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
    gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    order(c, o) { this.orders.push([c, !o || o.ascending !== false]); return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.lim = b - a + 1; this.offset = a; return this; }
    single() { this.mode = 'single'; return this.run(); }
    maybeSingle() { this.mode = 'maybe'; return this.run(); }
    then(res, rej) { return this.run().then(res, rej); }
    match(r) { return this.filters.every((f) => f(r)); }
    async run() {
      const rows = this.rows();
      let data;
      if (this.op === 'insert') {
        const defaults = (options.defaults && options.defaults[this.table]) || (() => ({}));
        const newId = () => (this.table === 'agent_activity' ? seq += 1 : options.uuid ? require('crypto').randomUUID() : `${this.table}-${seq += 1}`);
        data = this.payload.map((r) => ({ id: r.id || newId(), created_at: new Date().toISOString(), ...defaults(), ...r }));
        rows.push(...data);
      } else if (this.op === 'upsert') {
        const key = this.conflict || (this.table === 'agent_workers' ? 'worker' : 'id');
        data = this.payload.map((r) => {
          const existing = rows.find((x) => x[key] === r[key]);
          if (existing) return Object.assign(existing, r);
          rows.push({ ...r });
          return rows[rows.length - 1];
        });
      } else if (this.op === 'update') {
        data = rows.filter((r) => this.match(r));
        data.forEach((r) => Object.assign(r, this.patch));
        calls.updates.push({ table: this.table, patch: this.patch, matched: data.length });
      } else if (this.op === 'delete') {
        tables[this.table] = rows.filter((r) => !this.match(r));
        data = [];
      } else {
        data = rows.filter((r) => this.match(r));
        for (const [c, asc] of [...this.orders].reverse()) data.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
        if (this.offset) data = data.slice(this.offset);
        if (this.lim != null) data = data.slice(0, this.lim);
      }
      data = data.map((r) => ({ ...r }));
      if (this.opts.head) return { data: null, count: data.length, error: null };
      if (this.mode === 'single') return data[0] ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      if (this.mode === 'maybe') return { data: data[0] || null, error: null };
      return { data, error: null, count: data.length };
    }
  }

  return {
    tables,
    calls,
    from: (t) => new Query(t),
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      const h = rpcHandlers[name];
      if (!h) return { data: null, error: null };
      try { return { data: await h(args, tables), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
    },
  };
}

// claim_agent_job / requeue_stale_agent_jobs semantics in JS (mirrors the SQL).
const sqlLikeHandlers = (nowFn = () => Date.now()) => ({
  claim_agent_job({ worker }, tables) {
    const jobs = (tables.agent_jobs || [])
      .filter((j) => j.status === 'queued' && (!j.run_after || Date.parse(j.run_after) <= nowFn()))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.created_at).localeCompare(String(b.created_at)));
    const j = jobs[0];
    if (!j) return [];
    Object.assign(j, { status: 'running', locked_by: worker, locked_at: new Date(nowFn()).toISOString(), attempts: (j.attempts || 0) + 1 });
    return [{ ...j }];
  },
  requeue_stale_agent_jobs({ stale_minutes }, tables) {
    let n = 0;
    for (const j of tables.agent_jobs || []) {
      if (j.status === 'running' && Date.parse(j.locked_at) < nowFn() - stale_minutes * 60000) {
        n += 1;
        if (j.attempts >= j.max_attempts) Object.assign(j, { status: 'error', error: 'Abandonné', locked_by: null, locked_at: null });
        else Object.assign(j, { status: 'queued', locked_by: null, locked_at: null });
      }
    }
    return n;
  },
  record_agent_usage({ p_model, p_tokens_in, p_tokens_out, p_cost }, tables) {
    tables.agent_usage = tables.agent_usage || [];
    tables.agent_usage.push({ day: new Date(nowFn()).toISOString().slice(0, 10), model: p_model, calls: 1, tokens_in: p_tokens_in, tokens_out: p_tokens_out, cost_usd: p_cost });
    return null;
  },
});

module.exports = { createMockDb, sqlLikeHandlers, pick };
