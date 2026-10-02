const { csrfGuard, issueCsrfCookie, CSRF_COOKIE } = require('../routes(api)/utils/csrf');

function mockRes() {
  return {
    statusCode: 0, body: null, cookies: [],
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    cookie(n, v, o) { this.cookies.push({ n, v, o }); },
  };
}
const next = () => { next.called = true; };

describe('csrfGuard (double-submit, flag-gated)', () => {
  const ORIG = process.env;
  beforeEach(() => { process.env = { ...ORIG, CSRF_ENFORCE: 'true' }; next.called = false; });
  afterAll(() => { process.env = ORIG; });

  it('passes safe methods (GET)', () => {
    const res = mockRes();
    csrfGuard({ method: 'GET', headers: {}, cookies: {} }, res, next);
    expect(next.called).toBe(true);
  });

  it('passes Bearer-authenticated requests (not CSRF-vulnerable)', () => {
    const res = mockRes();
    csrfGuard({ method: 'POST', headers: { authorization: 'Bearer abc' }, cookies: {} }, res, next);
    expect(next.called).toBe(true);
  });

  it('rejects a cookie-based POST with no CSRF token (403)', () => {
    const res = mockRes();
    csrfGuard({ method: 'POST', headers: {}, cookies: { [CSRF_COOKIE]: 'tok' } }, res, next);
    expect(res.statusCode).toBe(403);
    expect(next.called).toBe(false);
  });

  it('rejects when header/cookie tokens mismatch (403)', () => {
    const res = mockRes();
    csrfGuard({ method: 'POST', headers: { 'x-csrf-token': 'a' }, cookies: { [CSRF_COOKIE]: 'b' } }, res, next);
    expect(res.statusCode).toBe(403);
  });

  it('passes when header matches the cookie (double-submit)', () => {
    const res = mockRes();
    csrfGuard({ method: 'POST', headers: { 'x-csrf-token': 'same' }, cookies: { [CSRF_COOKIE]: 'same' } }, res, next);
    expect(next.called).toBe(true);
  });

  it('is a no-op when CSRF_ENFORCE is not set', () => {
    process.env.CSRF_ENFORCE = 'false';
    const res = mockRes();
    csrfGuard({ method: 'POST', headers: {}, cookies: {} }, res, next);
    expect(next.called).toBe(true);
  });
});

describe('issueCsrfCookie', () => {
  it('sets a readable XSRF-TOKEN cookie when absent', () => {
    const res = mockRes();
    issueCsrfCookie({ cookies: {} }, res, () => {});
    const c = res.cookies.find((x) => x.n === CSRF_COOKIE);
    expect(c).toBeTruthy();
    expect(c.o.httpOnly).toBe(false);
  });
  it('does not overwrite an existing token', () => {
    const res = mockRes();
    issueCsrfCookie({ cookies: { [CSRF_COOKIE]: 'existing' } }, res, () => {});
    expect(res.cookies.length).toBe(0);
  });
});
