// Second-factor policy across password and OAuth sign-in (see utils/twofa).
const request = require('supertest');
const express = require('express');
const { authenticator } = require('otplib');

// In-memory tables shared by the anon and admin clients.
const mockDb = { Users: [], Users_2fa: [] };
const mockSessions = new Map();

jest.mock('@supabase/supabase-js', () => {
  const table = (name) => {
    const rows = () => mockDb[name];
    const filtered = (col, val) => rows().filter((r) => r[col] === val);
    return {
      select: () => ({
        eq: (col, val) => ({
          single: () => {
            const [row] = filtered(col, val);
            return Promise.resolve(row ? { data: { ...row }, error: null } : { data: null, error: { code: 'PGRST116' } });
          },
        }),
      }),
      upsert: (patch) => {
        const existing = rows().find((r) => r.userId === patch.userId);
        if (existing) Object.assign(existing, patch);
        else rows().push({ ...patch });
        return Promise.resolve({ error: null });
      },
      update: (patch) => ({
        eq: (col, val) => {
          filtered(col, val).forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ error: null });
        },
      }),
      insert: (row) => {
        rows().push({ ...row });
        return Promise.resolve({ error: null });
      },
    };
  };
  return {
    createClient: () => ({
      auth: {
        signInWithPassword: jest.fn(({ email }) => {
          const user = mockDb.Users.find((u) => u.email === email);
          return Promise.resolve({
            data: { user: { id: user.userId, email }, session: { access_token: `at-${user.userId}`, refresh_token: 'rt' } },
            error: null,
          });
        }),
        getUser: jest.fn((token) => {
          const id = String(token).replace(/^at-/, '');
          const user = mockDb.Users.find((u) => u.userId === id);
          return Promise.resolve({ data: { user: user ? { id, email: user.email, app_metadata: { provider: 'google' } } : null }, error: null });
        }),
        admin: {},
      },
      from: (name) => table(name),
    }),
  };
});

jest.mock('../routes(api)/utils/auth-middleware', () => ({
  authenticateUser: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] };
    next();
  },
  setAuthCookies: jest.fn(),
  clearAuthCookies: jest.fn(),
  twoFaLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
}));

jest.mock('../routes(api)/utils/validation-middleware', () => ({
  loginValidation: (req, res, next) => next(),
  registrationValidation: (req, res, next) => next(),
  validatePassword: () => ({ isValid: true }),
}));

jest.mock('../routes(api)/utils/supabaseSessionStore', () => ({
  storeTempSession: jest.fn((id, userId, req, rememberMe, accessToken, refreshToken) => {
    mockSessions.set(id, { userId, rememberMe, accessToken, refreshToken });
    return Promise.resolve();
  }),
  getAndValidateSession: jest.fn((id) => Promise.resolve(mockSessions.get(id) || null)),
}));

jest.mock('../routes(api)/utils/supabaseUtil', () => {
  const { createClient } = require('@supabase/supabase-js');
  return { createSupabaseClient: () => createClient(), createSupabaseAdmin: () => createClient() };
});

jest.mock('../routes(api)/utils/emailService', () => ({ sendEmail: jest.fn() }));

const { setAuthCookies } = require('../routes(api)/utils/auth-middleware');
const authRoutes = require('../routes(api)/authCRUD');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

const SECRET = authenticator.generateSecret();

function seed({ isAdmin = false, isTeacher = false, twofa } = {}) {
  mockDb.Users = [{ userId: 'u1', email: 'a@b.com', isAdmin, isTeacher }];
  mockDb.Users_2fa = twofa ? [{ userId: 'u1', email: 'a@b.com', ...twofa }] : [];
}

const login = () => request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'Passw0rd!' });

beforeEach(() => {
  mockSessions.clear();
  setAuthCookies.mockClear();
});

describe('password sign-in', () => {
  it('challenges an enabled 2FA account and issues no cookies', async () => {
    seed({ twofa: { enabled: true, secret: SECRET } });
    const res = await login();
    expect(res.body.requires2FA).toBe(true);
    expect(res.body.accessToken).toBeUndefined();
    expect(setAuthCookies).not.toHaveBeenCalled();
  });

  it('asks an account without 2FA to set it up, with a setup token', async () => {
    seed();
    const res = await login();
    expect(res.body.requires2FASetup).toBe(true);
    expect(res.body.setupToken).toMatch(/^[0-9a-f]{64}$/);
    expect(setAuthCookies).not.toHaveBeenCalled();
  });

  it('lets a student who turned 2FA off sign in without a code', async () => {
    seed({ twofa: { enabled: false, secret: SECRET } });
    const res = await login();
    expect(res.body.message).toBe('Connexion réussie !');
    expect(setAuthCookies).toHaveBeenCalled();
  });

  it.each([['admin', { isAdmin: true }], ['teacher', { isTeacher: true }]])(
    'forces an %s whose 2FA is off back into setup',
    async (_, role) => {
      seed({ ...role, twofa: { enabled: false, secret: SECRET } });
      const res = await login();
      expect(res.body.requires2FASetup).toBe(true);
      expect(setAuthCookies).not.toHaveBeenCalled();
    },
  );
});

describe('verify-2fa setup', () => {
  it('rejects a secret the client invented', async () => {
    seed();
    const { body } = await login();
    const mine = authenticator.generateSecret();
    const res = await request(app).post('/api/auth/verify-2fa').send({
      code: authenticator.generate(mine), tempSessionId: body.tempSessionId, isSetup: true, secret: mine, setupToken: body.setupToken,
    });
    expect(res.status).toBe(400);
    expect(mockDb.Users_2fa).toHaveLength(0);
  });

  it('enables 2FA with the server-issued secret', async () => {
    seed();
    const { body } = await login();
    const res = await request(app).post('/api/auth/verify-2fa').send({
      code: authenticator.generate(body.secret), tempSessionId: body.tempSessionId, isSetup: true, secret: body.secret, setupToken: body.setupToken,
    });
    expect(res.status).toBe(200);
    expect(mockDb.Users_2fa[0].enabled).toBe(true);
  });

  it('refuses a "new" setup over an enabled authenticator', async () => {
    seed();
    const { body } = await login();
    mockDb.Users_2fa = [{ userId: 'u1', enabled: true, secret: SECRET }];
    const res = await request(app).post('/api/auth/verify-2fa').send({
      code: authenticator.generate(body.secret), tempSessionId: body.tempSessionId, isSetup: true, secret: body.secret, setupToken: body.setupToken,
    });
    expect(res.status).toBe(409);
    expect(mockDb.Users_2fa[0].secret).toBe(SECRET);
  });
});

describe('regenerate-2fa', () => {
  it('changes nothing for a caller who only knows the password', async () => {
    seed({ twofa: { enabled: true, secret: SECRET } });
    const { body } = await login();
    const regen = await request(app).post('/api/auth/regenerate-2fa').send({ tempSessionId: body.tempSessionId });
    expect(regen.status).toBe(401);
    expect(mockDb.Users_2fa[0]).toMatchObject({ enabled: true, secret: SECRET });
    // The old bypass: log in again and expect to skip 2FA. Still challenged.
    expect((await login()).body.requires2FA).toBe(true);
  });

  it('rotates the authenticator when the current code is given', async () => {
    seed({ twofa: { enabled: true, secret: SECRET } });
    const { body } = await login();
    const regen = await request(app)
      .post('/api/auth/regenerate-2fa')
      .send({ tempSessionId: body.tempSessionId, code: authenticator.generate(SECRET) });
    expect(regen.status).toBe(200);
    expect(mockDb.Users_2fa[0].secret).toBe(SECRET); // nothing written yet

    const res = await request(app).post('/api/auth/verify-2fa').send({
      code: authenticator.generate(regen.body.secret), tempSessionId: body.tempSessionId,
      isSetup: true, secret: regen.body.secret, setupToken: regen.body.setupToken,
    });
    expect(res.status).toBe(200);
    expect(mockDb.Users_2fa[0].enabled).toBe(true);
    expect(mockDb.Users_2fa[0].secret).not.toBe(SECRET);
  });
});

describe('toggle-2fa', () => {
  it('will not let an admin turn 2FA off', async () => {
    seed({ isAdmin: true, twofa: { enabled: true, secret: SECRET } });
    const res = await request(app)
      .post('/api/auth/toggle-2fa')
      .set('x-test-user', 'u1')
      .send({ enable: false, code: authenticator.generate(SECRET) });
    expect(res.status).toBe(403);
    expect(mockDb.Users_2fa[0].enabled).toBe(true);
  });
});

describe('OAuth sign-in', () => {
  const session = { access_token: 'at-u1', refresh_token: 'rt' };

  it('UserProvider never issues cookies', async () => {
    seed({ twofa: { enabled: true, secret: SECRET } });
    const res = await request(app).post('/api/auth/UserProvider').send({ session });
    expect(res.body.requires2FACheck).toBe(true);
    expect(setAuthCookies).not.toHaveBeenCalled();
  });

  it('check-2fa challenges an enabled account before any cookie', async () => {
    seed({ twofa: { enabled: true, secret: SECRET } });
    const res = await request(app).post('/api/auth/check-2fa').send({ session });
    expect(res.body.requires2FA).toBe(true);
    expect(setAuthCookies).not.toHaveBeenCalled();
  });

  it('check-2fa signs in a student whose 2FA is off', async () => {
    seed({ twofa: { enabled: false, secret: SECRET } });
    const res = await request(app).post('/api/auth/check-2fa').send({ session });
    expect(res.body.requires2FA).toBe(false);
    expect(setAuthCookies).toHaveBeenCalled();
  });
});
