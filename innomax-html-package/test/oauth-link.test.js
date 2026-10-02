// OAuth session must be verified server-side; providerId must not come from the
// client, and link-account must bind the OAuth email to the password account.
let mockGetUser, mockSignIn;

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: (...a) => mockGetUser(...a),
      signInWithPassword: (...a) => mockSignIn(...a),
      admin: {},
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }) }) }),
      insert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
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
jest.mock('../routes(api)/utils/supabaseSessionStore', () => ({ storeTempSession: jest.fn(), getAndValidateSession: jest.fn() }));
jest.mock('../routes(api)/utils/supabaseUtil', () => ({ createSupabaseAdmin: () => ({ auth: { admin: {} } }), createSupabaseClient: () => ({}) }));
jest.mock('../routes(api)/utils/emailService', () => ({ sendEmail: jest.fn() }));

const request = require('supertest');
const express = require('express');
const authRoutes = require('../routes(api)/authCRUD');
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

beforeEach(() => {
  mockGetUser = jest.fn(() => Promise.resolve({ data: { user: null }, error: null }));
  mockSignIn = jest.fn(() => Promise.resolve({ data: { user: {} }, error: null }));
});

describe('POST /api/auth/UserProvider (H5)', () => {
  it('rejects a missing session', async () => {
    const res = await request(app).post('/api/auth/UserProvider').send({});
    expect(res.status).toBe(400);
  });
  it('rejects an invalid OAuth token', async () => {
    const res = await request(app).post('/api/auth/UserProvider').send({ session: { access_token: 'bad' } });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/link-account (H6)', () => {
  it('rejects when the OAuth email does not match the password account', async () => {
    mockGetUser = jest.fn(() => Promise.resolve({ data: { user: { id: 'o1', email: 'attacker@evil.com' } }, error: null }));
    const res = await request(app).post('/api/auth/link-account')
      .send({ email: 'victim@site.com', password: 'pw', session: { access_token: 'x' } });
    expect(res.status).toBe(403);
  });
  it('links when the verified OAuth email matches', async () => {
    mockGetUser = jest.fn(() => Promise.resolve({ data: { user: { id: 'o1', email: 'victim@site.com', app_metadata: { provider: 'google' } } }, error: null }));
    const res = await request(app).post('/api/auth/link-account')
      .send({ email: 'victim@site.com', password: 'pw', session: { access_token: 'x' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
