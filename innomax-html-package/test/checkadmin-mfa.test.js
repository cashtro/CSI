// Legacy admin routes (checkAdmin) need the admin role AND the 2FA proof.
require('./helpers/quiet');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createMockDb } = require('./helpers/mock-supabase');

const TOKENS = { 'tok-admin': 'u-admin', 'tok-user': 'u-user' };
let mockDb;
jest.mock('../routes(api)/utils/supabaseUtil', () => {
  const proxy = () => new Proxy({}, { get: (_, k) => mockDb[k] });
  return { createSupabaseAdmin: proxy, createSupabaseClient: proxy };
});

const { checkAdmin } = require('../routes(api)/utils/auth-middleware');
const { signMfaProof } = require('../routes(api)/utils/twofa');

const app = express();
app.use(cookieParser());
app.post('/admin-only', checkAdmin, (req, res) => res.json({ ok: true, user: req.user.id }));

beforeEach(() => {
  mockDb = createMockDb({ Users: [{ userId: 'u-admin', isAdmin: true }, { userId: 'u-user', isAdmin: false }] });
  mockDb.auth = { getUser: async (t) => ({ data: { user: TOKENS[t] ? { id: TOKENS[t] } : null }, error: null }) };
});

const mfa = (id, ttl = 3600e3) => `mfa=${signMfaProof(id, Date.now() + ttl)}`;

describe('checkAdmin', () => {
  it('refuses an admin JWT without the mfa proof (2FA not passed in this browser)', async () => {
    const res = await request(app).post('/admin-only').set('Authorization', 'Bearer tok-admin');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Double authentification/);
  });

  it('refuses a proof for another user or an expired one', async () => {
    for (const c of [mfa('u-user'), mfa('u-admin', -1)]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).post('/admin-only').set('Authorization', 'Bearer tok-admin').set('Cookie', c)).status).toBe(403);
    }
  });

  it('refuses a non-admin even with a valid proof', async () => {
    const res = await request(app).post('/admin-only').set('Authorization', 'Bearer tok-user').set('Cookie', mfa('u-user'));
    expect(res.status).toBe(403);
  });

  it('accepts an admin with the proof', async () => {
    const res = await request(app).post('/admin-only').set('Cookie', `accessToken=tok-admin; ${mfa('u-admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('u-admin');
  });

  it('401 without a session', async () => {
    expect((await request(app).post('/admin-only')).status).toBe(401);
  });
});
