// Rendez-vous routes: the RPC is awaited, and only the student, the slot's
// teacher or an admin can read, change or cancel a rendez-vous.
let mockRpcResult;
const mockDb = {
  Users: [{ userId: 'admin', isAdmin: true }, { userId: 'eleve', isAdmin: false }, { userId: 'prof', isAdmin: false }, { userId: 'other', isAdmin: false }],
  rendez_vous: [],
  disponibilites: [{ id: 'd1', id_prof: 'prof' }],
};

jest.mock('stripe', () => jest.fn(() => ({})));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: () => Promise.resolve(mockRpcResult),
    from: (name) => ({
      select: () => ({
        eq: (col, val) => ({
          single: () => {
            const row = mockDb[name].find((r) => r[col] === val);
            return Promise.resolve({ data: row ? { ...row } : null, error: null });
          },
        }),
      }),
      update: (patch) => ({
        eq: (col, val) => {
          mockDb[name].filter((r) => r[col] === val).forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: null, error: null });
        },
      }),
      delete: () => ({
        eq: (col, val) => ({
          single: () => {
            mockDb[name] = mockDb[name].filter((r) => r[col] !== val);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  }),
}));
jest.mock('../routes(api)/utils/auth-middleware', () => ({
  authenticateUser: (req, res, next) => {
    if (!req.headers['x-test-user']) return res.status(401).json({ error: 'unauthenticated' });
    req.user = { id: req.headers['x-test-user'] };
    next();
  },
  checkAdmin: (req, res, next) => next(),
}));

const request = require('supertest');
const express = require('express');
const rdvRoutes = require('../routes(api)/rdvCRUD');

const app = express();
app.use(express.json());
app.use('/api/rdv', rdvRoutes);

beforeEach(() => {
  mockDb.rendez_vous = [{ id: 'r1', id_eleve: 'eleve', disponibilite_id: 'd1', heure: '10:00' }];
});

describe('GET /api/rdv/all', () => {
  it('awaits the RPC and returns the real data array', async () => {
    mockRpcResult = { data: [{ id: 'rdv1' }, { id: 'rdv2' }], error: null };
    const res = await request(app).get('/api/rdv/all?userId=eleve').set('x-test-user', 'eleve');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'rdv1' }, { id: 'rdv2' }]);
  });

  it('surfaces an RPC error as 400', async () => {
    mockRpcResult = { data: null, error: { message: 'boom' } };
    const res = await request(app).get('/api/rdv/all').set('x-test-user', 'eleve');
    expect(res.status).toBe(400);
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/rdv/all?userId=eleve')).status).toBe(401);
  });

  it("refuses to list someone else's rendez-vous", async () => {
    mockRpcResult = { data: [], error: null };
    const res = await request(app).get('/api/rdv/all?userId=eleve').set('x-test-user', 'other');
    expect(res.status).toBe(403);
  });

  it('lets an admin list anyone', async () => {
    mockRpcResult = { data: [], error: null };
    const res = await request(app).get('/api/rdv/all?userId=eleve').set('x-test-user', 'admin');
    expect(res.status).toBe(200);
  });
});

describe('PUT /update and DELETE /cancel', () => {
  it('refuses a stranger', async () => {
    const put = await request(app).put('/api/rdv/update/r1').set('x-test-user', 'other').send({ heure: '23:00' });
    const del = await request(app).delete('/api/rdv/cancel/r1').set('x-test-user', 'other');
    expect(put.status).toBe(403);
    expect(del.status).toBe(403);
    expect(mockDb.rendez_vous).toEqual([expect.objectContaining({ id: 'r1', heure: '10:00' })]);
  });

  it('lets the student update and the teacher cancel', async () => {
    const put = await request(app).put('/api/rdv/update/r1').set('x-test-user', 'eleve').send({ heure: '11:00' });
    expect(put.status).toBe(200);
    expect(mockDb.rendez_vous[0].heure).toBe('11:00');
    const del = await request(app).delete('/api/rdv/cancel/r1').set('x-test-user', 'prof');
    expect(del.status).toBe(200);
    expect(mockDb.rendez_vous).toHaveLength(0);
  });

  it('answers 404 for an unknown rendez-vous', async () => {
    expect((await request(app).delete('/api/rdv/cancel/nope').set('x-test-user', 'eleve')).status).toBe(404);
  });
});
