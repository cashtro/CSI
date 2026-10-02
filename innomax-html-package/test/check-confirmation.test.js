// check-confirmation finds any account by email, not just the first 50.
const mockAuthUsers = {};
const mockUsers = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        getUserById: jest.fn((id) => Promise.resolve({ data: { user: mockAuthUsers[id] || null }, error: null })),
        listUsers: jest.fn(() => Promise.resolve({ data: { users: [] }, error: null })),
      },
    },
    from: () => ({
      select: () => ({
        eq: (col, val) => ({
          maybeSingle: () => Promise.resolve({ data: mockUsers.find((u) => u[col] === val) || null, error: null }),
          single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
        }),
      }),
    }),
  }),
}));
jest.mock('../routes(api)/utils/auth-middleware', () => ({
  authenticateUser: (q, s, n) => n(), setAuthCookies: jest.fn(), clearAuthCookies: jest.fn(),
  twoFaLimiter: (q, s, n) => n(), authLimiter: (q, s, n) => n(),
}));
jest.mock('../routes(api)/utils/supabaseSessionStore', () => ({ storeTempSession: jest.fn(), getAndValidateSession: jest.fn() }));
jest.mock('../routes(api)/utils/supabaseUtil', () => {
  const { createClient } = require('@supabase/supabase-js');
  return { createSupabaseClient: () => createClient(), createSupabaseAdmin: () => createClient() };
});
jest.mock('../routes(api)/utils/emailService', () => ({ sendEmail: jest.fn() }));

const request = require('supertest');
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes(api)/authCRUD'));

it('reports a confirmed account that listUsers() would not have returned', async () => {
  mockUsers.push({ userId: 'u77', email: 'late@ex.com' });
  mockAuthUsers.u77 = { id: 'u77', email: 'late@ex.com', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {} };
  const res = await request(app).post('/api/auth/check-confirmation').send({ email: 'late@ex.com' });
  expect(res.body).toEqual({ confirmed: true, exists: true });
});

it('reports unknown and unconfirmed accounts without leaking the user object', async () => {
  mockUsers.push({ userId: 'u78', email: 'new@ex.com' });
  mockAuthUsers.u78 = { id: 'u78', email: 'new@ex.com', email_confirmed_at: null, user_metadata: {} };
  expect((await request(app).post('/api/auth/check-confirmation').send({ email: 'new@ex.com' })).body).toEqual({ confirmed: false, exists: true });
  expect((await request(app).post('/api/auth/check-confirmation').send({ email: 'nobody@ex.com' })).body).toEqual({ confirmed: false, exists: false });
});
