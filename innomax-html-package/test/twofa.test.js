const request = require('supertest');
const express = require('express');

// Controllable mock state for the Users_2fa row and the sign-in result.
let mock2faRow = { enabled: true, secret: 'SECRET' };
const mockSignIn = {
  data: { user: { id: 'u1', email: 'a@b.com' }, session: { access_token: 'a', refresh_token: 'r' } },
  error: null,
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: jest.fn(() => Promise.resolve(mockSignIn)),
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'u1' } }, error: null })),
      admin: { listUsers: jest.fn(() => Promise.resolve({ data: { users: [] }, error: null })) },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: jest.fn(() => Promise.resolve({ data: mock2faRow, error: null })),
        }),
      }),
    }),
  }),
}));

jest.mock('../routes(api)/utils/auth-middleware', () => ({
  authenticateUser: (req, res, next) => next(),
  setAuthCookies: jest.fn(),
  twoFaLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
}));

jest.mock('../routes(api)/utils/validation-middleware', () => ({
  loginValidation: (req, res, next) => next(),
  registrationValidation: (req, res, next) => next(),
  validatePassword: () => ({ isValid: true }),
}));

jest.mock('../routes(api)/utils/supabaseSessionStore', () => ({
  storeTempSession: jest.fn(() => Promise.resolve()),
  getAndValidateSession: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../routes(api)/utils/supabaseUtil', () => ({
  createSupabaseAdmin: () => ({
    auth: { admin: { listUsers: jest.fn(() => Promise.resolve({ data: { users: [] }, error: null })), generateLink: jest.fn() } },
  }),
}));

jest.mock('../routes(api)/utils/emailService', () => ({ sendEmail: jest.fn() }));

const authRoutes = require('../routes(api)/authCRUD');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('POST /api/auth/login — 2FA gate', () => {
  it('challenges for a TOTP code when 2FA is ENABLED (no bypass, no cookies issued)', async () => {
    mock2faRow = { enabled: true, secret: 'SECRET' };
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'Passw0rd!', rememberMe: false });

    expect(res.status).toBe(200);
    expect(res.body.requires2FA).toBe(true);
    // Must NOT hand out tokens / log the user straight in.
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.message).not.toBe('Connexion réussie !');
  });

  it('offers 2FA setup when no 2FA row exists', async () => {
    mock2faRow = null;
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'Passw0rd!' });

    expect(res.status).toBe(200);
    expect(res.body.requires2FASetup).toBe(true);
  });
});
