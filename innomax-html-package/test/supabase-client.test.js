// Verifies server-side Supabase clients are created stateless, so concurrent
// requests cannot share/mutate an auth session (identity bleed).
let lastOpts;
jest.mock('@supabase/supabase-js', () => ({
  createClient: (url, key, opts) => {
    lastOpts = opts;
    return { url, key, opts };
  },
}));

const {
  createSupabaseClient,
  createSupabaseAdmin,
  createSupabaseClientWithAuth,
} = require('../routes(api)/utils/supabaseUtil');

describe('supabaseUtil — stateless server clients', () => {
  it('anon client disables session persistence and auto-refresh', () => {
    createSupabaseClient();
    expect(lastOpts.auth.persistSession).toBe(false);
    expect(lastOpts.auth.autoRefreshToken).toBe(false);
    expect(lastOpts.auth.detectSessionInUrl).toBe(false);
  });

  it('admin client is also stateless', () => {
    createSupabaseAdmin();
    expect(lastOpts.auth.persistSession).toBe(false);
    expect(lastOpts.auth.autoRefreshToken).toBe(false);
  });

  it('authed client keeps the Authorization header AND stays stateless', () => {
    createSupabaseClientWithAuth('Bearer test-token');
    expect(lastOpts.auth.persistSession).toBe(false);
    expect(lastOpts.global.headers.Authorization).toBe('Bearer test-token');
  });
});
