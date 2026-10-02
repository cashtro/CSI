// In-memory stand-in for the Supabase clients built by utils/supabaseUtil.
// Supports the query-builder calls the espace / admin / CMS code uses.
// Usage in a test file:
//   jest.mock('../routes(api)/utils/supabaseUtil', () => require('./helpers/fakeSupabase').module);
const crypto = require('crypto');

const state = { tables: {}, tokens: {}, uploads: [], unique: { membres: ['user_id'], robots_offres: ['slug'], connexions_etats: ['state'] }, fail: {} };

function reset({ tables = {}, tokens = {} } = {}) {
  state.tables = JSON.parse(JSON.stringify(tables));
  state.tokens = tokens;
  state.uploads = [];
  state.fail = {};
}

class Query {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.filters = [];
    this.mode = 'many';
    this.max = null;
  }

  select() { return this; }
  insert(payload) { this.op = 'insert'; this.payload = payload; return this; }
  update(payload) { this.op = 'update'; this.payload = payload; return this; }
  upsert(payload, opts) { this.op = 'upsert'; this.payload = payload; this.conflict = ((opts && opts.onConflict) || 'id').split(','); return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  in(col, vals) { this.filters.push((r) => vals.includes(r[col])); return this; }
  neq(col, val) { this.filters.push((r) => r[col] !== val); return this; }
  gte(col, val) { this.filters.push((r) => r[col] >= val); return this; }
  order() { return this; }
  limit(n) { this.max = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  then(resolve, reject) {
    return Promise.resolve().then(() => this.exec()).then(resolve, reject);
  }

  exec() {
    // state.fail.<table> = 'message': every query on that table fails (a
    // missing table, an outage).
    if (state.fail[this.table]) return { data: null, error: { code: '42P01', message: state.fail[this.table] } };
    if (!state.tables[this.table]) state.tables[this.table] = [];
    const rows = state.tables[this.table];
    const match = (r) => this.filters.every((f) => f(r));
    let out = [];

    if (this.op === 'select') {
      out = rows.filter(match).map((r) => ({ ...r }));
      if (this.max) out = out.slice(0, this.max);
    } else if (this.op === 'insert') {
      const list = [].concat(this.payload).map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      for (const col of state.unique[this.table] || []) {
        if (list.some((n) => rows.some((r) => r[col] === n[col]))) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
      }
      rows.push(...list);
      out = list;
    } else if (this.op === 'update') {
      out = rows.filter(match);
      out.forEach((r) => Object.assign(r, this.payload));
    } else if (this.op === 'upsert') {
      for (const p of [].concat(this.payload)) {
        const existing = rows.find((r) => this.conflict.every((c) => r[c] === p[c]));
        if (existing) Object.assign(existing, p);
        else rows.push({ ...p });
        out.push(p);
      }
    } else if (this.op === 'delete') {
      out = rows.filter(match);
      state.tables[this.table] = rows.filter((r) => !match(r));
    }

    if (this.mode === 'single') {
      return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not found' } };
    }
    if (this.mode === 'maybe') return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
}

function client() {
  return {
    from: (table) => new Query(table),
    auth: {
      getUser: async (token) => ({ data: { user: state.tokens[token] || null }, error: null }),
      refreshSession: async () => ({ data: null, error: { message: 'no refresh in tests' } }),
    },
    storage: {
      from: (bucket) => ({
        upload: async (name, buffer, opts) => {
          state.uploads.push({ bucket, name, contentType: opts && opts.contentType });
          return { error: null };
        },
        getPublicUrl: (name) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${name}` } }),
      }),
    },
  };
}

module.exports = {
  state,
  reset,
  module: {
    createSupabaseClient: client,
    createSupabaseAdmin: client,
    createSupabaseClientWithAuth: client,
  },
};
