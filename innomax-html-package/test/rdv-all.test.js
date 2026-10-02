// Regression: GET /api/rdv/all must AWAIT the RPC. Without await, the handler
// destructured a Promise (data/error undefined) and serialized {} to the client.
let mockRpcResult;

jest.mock('stripe', () => jest.fn(() => ({})));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: () => Promise.resolve(mockRpcResult),
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
  }),
}));

const request = require('supertest');
const express = require('express');
const rdvRoutes = require('../routes(api)/rdvCRUD');

const app = express();
app.use(express.json());
app.use('/api/rdv', rdvRoutes);

describe('GET /api/rdv/all', () => {
  it('awaits the RPC and returns the real data array', async () => {
    mockRpcResult = { data: [{ id: 'rdv1' }, { id: 'rdv2' }], error: null };
    const res = await request(app).get('/api/rdv/all?userId=u1');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'rdv1' }, { id: 'rdv2' }]);
  });

  it('surfaces an RPC error as 400', async () => {
    mockRpcResult = { data: null, error: { message: 'boom' } };
    const res = await request(app).get('/api/rdv/all?userId=u1');
    expect(res.status).toBe(400);
  });
});
