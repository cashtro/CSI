// Idempotency ledger behavior.
const mockDb = { existing: null, insertError: null, inserted: [] };

jest.mock('../routes(api)/utils/supabaseUtil', () => ({
  createSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mockDb.existing, error: null }),
        }),
      }),
      insert: (row) => {
        if (mockDb.insertError) return Promise.resolve({ error: mockDb.insertError });
        mockDb.inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const { claimFulfillment } = require('../routes(api)/utils/fulfillment');

describe('claimFulfillment — idempotency', () => {
  beforeEach(() => {
    mockDb.existing = null;
    mockDb.insertError = null;
    mockDb.inserted = [];
  });

  it('claims a fresh key', async () => {
    const r = await claimFulfillment('lottery_entry:cs_1', 'lottery_entry');
    expect(r.claimed).toBe(true);
    expect(mockDb.inserted).toHaveLength(1);
  });

  it('skips an already-recorded key', async () => {
    mockDb.existing = { key: 'lottery_entry:cs_1' };
    const r = await claimFulfillment('lottery_entry:cs_1', 'lottery_entry');
    expect(r.alreadyProcessed).toBe(true);
    expect(mockDb.inserted).toHaveLength(0);
  });

  it('treats a unique-violation insert as already processed (race)', async () => {
    mockDb.insertError = { code: '23505', message: 'duplicate key' };
    const r = await claimFulfillment('lottery_entry:cs_1', 'lottery_entry');
    expect(r.alreadyProcessed).toBe(true);
  });
});
