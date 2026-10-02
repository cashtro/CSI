const request = require('supertest');// Import supertest for testing Express routes
const express = require('express');// Import Express framework

jest.mock('@supabase/supabase-js', () => ({ // Mock the Supabase client
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({        
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        })
      })
    })
  })
}));

const authRoutes = require('../routes(api)/authCRUD'); // Import the authentication routes

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('POST /api/auth/check-email', () => { // Test suite for the email existence check endpoint
  it('responds with exists boolean', async () => { // Test case to check if the endpoint responds with an exists boolean
    const res = await request(app)
      .post('/api/auth/check-email')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: expect.any(Boolean) });
  });
});