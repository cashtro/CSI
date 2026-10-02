// A student's enrolments are readable by that student and admins only.
require('./helpers/quiet');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_x';
const request = require('supertest');
const express = require('express');
const { createMockDb } = require('./helpers/mock-supabase');

let mockDb;
jest.mock('@supabase/supabase-js', () => ({ createClient: () => new Proxy({}, { get: (_, k) => mockDb[k] }) }));
jest.mock('../routes(api)/utils/supabaseUtil', () => ({
  createSupabaseAdmin: () => new Proxy({}, { get: (_, k) => mockDb[k] }),
  createSupabaseClient: () => new Proxy({}, { get: (_, k) => mockDb[k] }),
}));
jest.mock('../routes(api)/utils/auth-middleware', () => ({
  authenticateUser: (req, res, next) => { req.user = { id: req.headers['x-user'] }; next(); },
  checkAdmin: (req, res, next) => next(),
}));

const app = express();
app.use('/api/course', require('../routes(api)/courseCRUD'));

beforeEach(() => {
  mockDb = createMockDb({
    Users: [{ userId: 'alice', isAdmin: false }, { userId: 'bob', isAdmin: false }, { userId: 'boss', isAdmin: true }],
    cours_students: [{ cours_id: 'c1', student_id: 'alice' }],
    cours: [{ id: 'c1', nom: 'Cours secret' }],
  });
});

describe('student enrolments', () => {
  it.each(['/api/course/student-courses/alice', '/api/course/student-courses-count/alice'])('%s: other student 403, self and admin 200', async (url) => {
    expect((await request(app).get(url).set('x-user', 'bob')).status).toBe(403);
    expect((await request(app).get(url).set('x-user', 'alice')).status).toBe(200);
    expect((await request(app).get(url).set('x-user', 'boss')).status).toBe(200);
  });
});
