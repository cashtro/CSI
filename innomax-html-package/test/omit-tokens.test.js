// C4: login must be able to stop echoing tokens in the JSON body (flag-gated).
const mockSignIn = {
  data: { user: { id: 'u1', email: 'a@b.com' }, session: { access_token: 'AT', refresh_token: 'RT' } },
  error: null,
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { signInWithPassword: jest.fn(() => Promise.resolve(mockSignIn)), getUser: jest.fn(), admin: {} },
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { enabled: false, secret: 's' }, error: null }) }) }) }),
  }),
}));
jest.mock('../routes(api)/utils/auth-middleware', () => ({
  authenticateUser: (q, s, n) => n(), setAuthCookies: jest.fn(), setMfaProof: jest.fn(), twoFaLimiter: (q, s, n) => n(), authLimiter: (q, s, n) => n(),
}));
jest.mock('../routes(api)/utils/validation-middleware', () => ({
  loginValidation: (q, s, n) => n(), registrationValidation: (q, s, n) => n(), validatePassword: () => ({ isValid: true }),
}));
jest.mock('../routes(api)/utils/supabaseSessionStore', () => ({ storeTempSession: jest.fn(), getAndValidateSession: jest.fn() }));
jest.mock('../routes(api)/utils/supabaseUtil', () => ({ createSupabaseAdmin: () => require('@supabase/supabase-js').createClient(), createSupabaseClient: () => require('@supabase/supabase-js').createClient() }));
jest.mock('../routes(api)/utils/emailService', () => ({ sendEmail: jest.fn() }));

const request = require('supertest');
const express = require('express');

function makeApp() {
  jest.resetModules();
  const authRoutes = require('../routes(api)/authCRUD');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

describe('POST /api/auth/login body tokens (C4)', () => {
  const ORIG = process.env;
  afterEach(() => { process.env = ORIG; });

  it('echoes tokens in the body by default (current behavior)', async () => {
    process.env = { ...ORIG, OMIT_BODY_TOKENS: 'false' };
    const res = await request(makeApp()).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('AT');
    expect(res.body.refreshToken).toBe('RT');
  });

  it('omits tokens from the body when OMIT_BODY_TOKENS=true (still 200)', async () => {
    process.env = { ...ORIG, OMIT_BODY_TOKENS: 'true' };
    const res = await request(makeApp()).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Connexion réussie !');
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });
});
