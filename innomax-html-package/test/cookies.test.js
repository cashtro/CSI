// M1: auth cookies must use env-driven `secure` and clears must reuse the same
// attributes (path/domain/httpOnly/sameSite) so the browser actually removes them.
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

function mockRes() {
  const calls = { set: [], clear: [] };
  return {
    calls,
    cookie: (name, val, opts) => calls.set.push({ name, opts }),
    clearCookie: (name, opts) => calls.clear.push({ name, opts }),
  };
}

describe('auth cookie options (M1)', () => {
  const ORIGINAL = process.env;
  beforeEach(() => { jest.resetModules(); process.env = { ...ORIGINAL }; });
  afterAll(() => { process.env = ORIGINAL; });

  it('secure can be turned off for local http and options are consistent', () => {
    process.env.COOKIE_SECURE = 'false';
    const { setAuthCookies } = require('../routes(api)/utils/auth-middleware');
    const res = mockRes();
    setAuthCookies(res, 'a', 'r', false);
    const access = res.calls.set.find((c) => c.name === 'accessToken');
    expect(access.opts.secure).toBe(false);
    expect(access.opts.httpOnly).toBe(true);
    expect(access.opts.path).toBe('/');
  });

  it('secure is on by default, whatever NODE_ENV says', () => {
    delete process.env.COOKIE_SECURE;
    process.env.NODE_ENV = 'development';
    const { setAuthCookies } = require('../routes(api)/utils/auth-middleware');
    const res = mockRes();
    setAuthCookies(res, 'a', 'r', true);
    expect(res.calls.set.find((c) => c.name === 'accessToken').opts.secure).toBe(true);
  });

  it('clearAuthCookies clears all three cookies with matching attributes', () => {
    process.env.COOKIE_SECURE = 'false';
    const { clearAuthCookies } = require('../routes(api)/utils/auth-middleware');
    const res = mockRes();
    clearAuthCookies(res);
    expect(res.calls.clear.map((c) => c.name).sort()).toEqual(['accessToken', 'csrf-token', 'refreshToken']);
    res.calls.clear.forEach((c) => {
      expect(c.opts.path).toBe('/');
      expect(c.opts.httpOnly).toBe(true);
    });
  });
});
