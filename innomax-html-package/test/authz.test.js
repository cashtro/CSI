// Authorization: sensitive auth routes must reject unauthenticated requests.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Mock data deps so the module loads, but keep auth-middleware REAL so the
// authenticateUser guard actually runs.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
  }),
}));
jest.mock('../routes(api)/utils/supabaseSessionStore', () => ({
  storeTempSession: jest.fn(), getAndValidateSession: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../routes(api)/utils/supabaseUtil', () => ({
  createSupabaseAdmin: () => ({ auth: { admin: {} } }),
  createSupabaseClient: () => ({}),
}));
jest.mock('../routes(api)/utils/emailService', () => ({ sendEmail: jest.fn() }));

const authRoutes = require('../routes(api)/authCRUD');

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use('/api/auth', authRoutes);

const rejected = (s) => [401, 403].includes(s);

describe('Auth authorization guards (unauthenticated)', () => {
  it('GET /api/auth/user/:userId is rejected without a session (IDOR guard, H2)', async () => {
    const res = await request(app).get('/api/auth/user/victim-123');
    expect(rejected(res.status)).toBe(true);
  });

  it('POST /api/auth/toggle-2fa is rejected without a session (H4)', async () => {
    const res = await request(app).post('/api/auth/toggle-2fa').send({ enable: true });
    expect(rejected(res.status)).toBe(true);
  });
});
