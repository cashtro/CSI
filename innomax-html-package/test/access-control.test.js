// Unauthenticated mutating routes must be rejected before touching data.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_x';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Avoid real SDK construction at import time.
jest.mock('stripe', () => jest.fn(() => ({})));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
  }),
}));

const achatsRoutes = require('../routes(api)/achatsCRUD');
const rdvRoutes = require('../routes(api)/rdvCRUD');
const teacherRoutes = require('../routes(api)/demandCRUD');

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use('/api/achats', achatsRoutes);
app.use('/api/rdv', rdvRoutes);
app.use('/api/teacher', teacherRoutes);

const rejected = (status) => [401, 403].includes(status);

describe('Access control on mutating / sensitive routes (unauthenticated)', () => {
  it('POST /api/achats (create product) is rejected', async () => {
    const res = await request(app).post('/api/achats').send({ nomProduit: 'x', price: 1 });
    expect(rejected(res.status)).toBe(true);
  });

  it('PUT /api/achats/:id (edit product) is rejected', async () => {
    const res = await request(app).put('/api/achats/1').send({ price: 999 });
    expect(rejected(res.status)).toBe(true);
  });

  it('DELETE /api/achats/:id (delete product) is rejected', async () => {
    const res = await request(app).delete('/api/achats/1');
    expect(rejected(res.status)).toBe(true);
  });

  it('PUT /api/rdv/update/:id is rejected', async () => {
    const res = await request(app).put('/api/rdv/update/1').send({ date: '2026-01-01' });
    expect(rejected(res.status)).toBe(true);
  });

  it('DELETE /api/rdv/cancel/:id is rejected', async () => {
    const res = await request(app).delete('/api/rdv/cancel/1');
    expect(rejected(res.status)).toBe(true);
  });

  it('GET /api/teacher/dev/users no longer exists (removed)', async () => {
    const res = await request(app).get('/api/teacher/dev/users');
    expect(res.status).toBe(404);
  });
});
