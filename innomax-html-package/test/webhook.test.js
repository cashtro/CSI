// Signed Stripe webhook receiver behavior.
let mockConstructEvent;
let mockFulfill;

jest.mock('stripe', () => jest.fn(() => ({
  webhooks: { constructEvent: (...args) => mockConstructEvent(...args) },
})));

jest.mock('../routes(api)/utils/fulfill', () => ({
  fulfillCheckoutSession: (...args) => mockFulfill(...args),
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
    mockFulfill = jest.fn(() => Promise.resolve({ kind: 'lottery_entry', status: 'granted' }));
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

  it.each([['checkout.session.completed'], ['checkout.session.async_payment_succeeded']])(
    'fulfils the session on %s',
    async (type) => {
      const session = { id: 'cs_1', metadata: { type: 'lottery_entry' } };
      mockConstructEvent = () => ({ type, data: { object: session } });
      const res = mockRes();
      await stripeWebhookHandler({ headers: { 'stripe-signature': 'ok' }, body: Buffer.from('{}') }, res);
      expect(res.statusCode).toBe(200);
      expect(mockFulfill).toHaveBeenCalledWith(session);
    },
  );

  it('ignores unrelated events', async () => {
    mockConstructEvent = () => ({ type: 'invoice.paid', data: { object: {} } });
    const res = mockRes();
    await stripeWebhookHandler({ headers: { 'stripe-signature': 'ok' }, body: Buffer.from('{}') }, res);
    expect(res.statusCode).toBe(200);
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('answers 500 when fulfilment fails so Stripe retries', async () => {
    mockFulfill = jest.fn(() => Promise.reject(new Error('ledger down')));
    mockConstructEvent = () => ({ type: 'checkout.session.completed', data: { object: { id: 'cs_2', metadata: {} } } });
    const res = mockRes();
    await stripeWebhookHandler({ headers: { 'stripe-signature': 'ok' }, body: Buffer.from('{}') }, res);
    expect(res.statusCode).toBe(500);
  });
});
