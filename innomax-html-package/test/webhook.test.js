// Signed Stripe webhook receiver behavior.
let mockConstructEvent;
let mockClaim;
const mockBillInsert = jest.fn(() => Promise.resolve({ error: null }));

jest.mock('stripe', () => jest.fn(() => ({
  webhooks: { constructEvent: (...args) => mockConstructEvent(...args) },
})));

jest.mock('../routes(api)/utils/supabaseUtil', () => ({
  createSupabaseAdmin: () => ({ from: () => ({ insert: mockBillInsert }) }),
}));

jest.mock('../routes(api)/utils/fulfillment', () => ({
  claimFulfillment: (...args) => mockClaim(...args),
}));

const { stripeWebhookHandler } = require('../routes(api)/webhook');

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    send(obj) { this.body = obj; return this; },
  };
}

describe('stripeWebhookHandler', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    mockBillInsert.mockClear();
    mockClaim = jest.fn(() => Promise.resolve({ claimed: true }));
  });

  it('returns 503 when the webhook secret is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = mockRes();
    await stripeWebhookHandler({ headers: {}, body: Buffer.from('{}') }, res);
    expect(res.statusCode).toBe(503);
  });

  it('returns 400 on a bad signature', async () => {
    mockConstructEvent = () => { throw new Error('No signatures found'); };
    const res = mockRes();
    await stripeWebhookHandler({ headers: { 'stripe-signature': 'bad' }, body: Buffer.from('{}') }, res);
    expect(res.statusCode).toBe(400);
  });

  it('records a bill and returns 200 for a fresh checkout.session.completed', async () => {
    mockConstructEvent = () => ({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', metadata: { type: 'lottery_entry', userId: 'u1', lotteryId: 'l1' } } },
    });
    const res = mockRes();
    await stripeWebhookHandler({ headers: { 'stripe-signature': 'ok' }, body: Buffer.from('{}') }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(mockBillInsert).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a duplicate delivery is skipped without re-recording', async () => {
    mockClaim = jest.fn(() => Promise.resolve({ alreadyProcessed: true }));
    mockConstructEvent = () => ({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', metadata: { type: 'lottery_entry' } } },
    });
    const res = mockRes();
    await stripeWebhookHandler({ headers: { 'stripe-signature': 'ok' }, body: Buffer.from('{}') }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(mockBillInsert).not.toHaveBeenCalled();
  });
});
