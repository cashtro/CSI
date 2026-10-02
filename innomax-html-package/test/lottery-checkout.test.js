// Lottery checkout: never open a Stripe session for a closed draw, and the
// quantity charged is the quantity granted.
require('./helpers/quiet');
const mockCreate = jest.fn(async () => ({ id: 'cs_test_1' }));
jest.mock('stripe', () => () => ({ checkout: { sessions: { create: (...a) => mockCreate(...a), retrieve: jest.fn() } } }));
let mockLottery;
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: mockLottery, error: mockLottery ? null : { message: 'x' } }) }) }) }),
  }),
}));

const { handleLotteryPayment } = require('../routes(api)/utils/stripe');

function call(body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return handleLotteryPayment({ body, user: { id: 'u1' }, accessToken: 't' }, res).then(() => res);
}
const future = new Date(Date.now() + 86400000).toISOString();

beforeEach(() => mockCreate.mockClear());

describe('lottery checkout', () => {
  it('refuses a closed or past draw without creating a Stripe session', async () => {
    mockLottery = { lotteryId: 'L1', isActive: false, lotteryTime: future, entrieCost: 5, nomProduit: 'P' };
    expect((await call({ lotteryId: 'L1', entryQuantity: 2 })).statusCode).toBe(409);
    mockLottery = { lotteryId: 'L1', isActive: true, lotteryTime: new Date(Date.now() - 1000).toISOString(), entrieCost: 5, nomProduit: 'P' };
    expect((await call({ lotteryId: 'L1', entryQuantity: 2 })).statusCode).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('charges and records the same integer quantity', async () => {
    mockLottery = { lotteryId: 'L1', isActive: true, lotteryTime: future, entrieCost: 5, nomProduit: 'P' };
    const res = await call({ lotteryId: 'L1', entryQuantity: '3' });
    expect(res.body).toEqual({ id: 'cs_test_1' });
    const args = mockCreate.mock.calls[0][0];
    expect(args.line_items[0].quantity).toBe(3);
    expect(args.line_items[0].price_data.unit_amount).toBe(500);
    expect(args.metadata.entryQuantity).toBe('3');
    expect(args.metadata.userId).toBe('u1');
    expect((await call({ lotteryId: 'L1', entryQuantity: '0' })).statusCode).toBe(400);
  });
});
