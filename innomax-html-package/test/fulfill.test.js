// Checkout fulfilment: each paid session grants exactly once, replays are
// no-ops, and a failed grant releases its claim so a retry can succeed.

// Minimal in-memory Supabase query builder covering what fulfil uses.
const mockDb = {};
let mockFailBillsOnce = false;

function mockReset() {
  Object.assign(mockDb, {
    fulfillments: [], Achat: [], disponibilites: [], rendez_vous: [], cours_students: [], Entry: [], Lottery: [], bills: [],
  });
  mockFailBillsOnce = false;
}

class MockQuery {
  constructor(table) { this.table = table; this.filters = []; this.op = null; }
  select() { if (!this.op) this.op = 'select'; return this; }
  insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
  update(patch) { this.op = 'update'; this.patch = patch; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col, val) { this.filters.push([col, val]); return this; }
  match(obj) { Object.entries(obj).forEach((f) => this.filters.push(f)); return this; }
  single() { this.mode = 'single'; return this.run(); }
  maybeSingle() { this.mode = 'maybe'; return this.run(); }
  then(resolve, reject) { return this.run().then(resolve, reject); }
  matches(row) { return this.filters.every(([c, v]) => row[c] === v); }
  async run() {
    const rows = mockDb[this.table];
    let data;
    if (this.op === 'insert') {
      if (this.table === 'bills' && mockFailBillsOnce) {
        mockFailBillsOnce = false;
        return { data: null, error: { message: 'bills down' } };
      }
      if (this.table === 'fulfillments' && this.rows.some((r) => rows.some((x) => x.key === r.key))) {
        return { data: null, error: { code: '23505', message: 'duplicate' } };
      }
      data = this.rows.map((r) => ({ id: `${this.table}-${rows.length + 1}`, ...r }));
      rows.push(...data);
    } else if (this.op === 'update') {
      data = rows.filter((r) => this.matches(r));
      data.forEach((r) => Object.assign(r, this.patch));
    } else if (this.op === 'delete') {
      mockDb[this.table] = rows.filter((r) => !this.matches(r));
      data = [];
    } else {
      data = rows.filter((r) => this.matches(r));
    }
    data = data.map((r) => ({ ...r }));
    if (this.mode === 'single') return data[0] ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116' } };
    if (this.mode === 'maybe') return { data: data[0] || null, error: null };
    return { data, error: null };
  }
}

jest.mock('../routes(api)/utils/supabaseUtil', () => ({
  createSupabaseAdmin: () => ({ from: (t) => new MockQuery(t) }),
}));
const mockSendEmail = jest.fn(() => Promise.resolve());
jest.mock('../routes(api)/utils/emailService', () => ({ sendEmail: (...a) => mockSendEmail(...a) }));

const { fulfillCheckoutSession } = require('../routes(api)/utils/fulfill');

const future = new Date(Date.now() + 86400000).toISOString();
const paid = (id, metadata, extra = {}) => ({ id, payment_status: 'paid', mode: 'payment', payment_intent: `pi_${id}`, metadata, ...extra });

beforeEach(() => {
  mockReset();
  mockSendEmail.mockClear();
});

describe('rendez-vous', () => {
  it('books the slot once, however often the session is replayed', async () => {
    mockDb.disponibilites.push({ id: 'd1', taken: false, id_prof: 'p' });
    const s = paid('cs_rdv', { disponibilite_id: 'd1', id_eleve: 'e1' });
    expect((await fulfillCheckoutSession(s)).status).toBe('granted');
    expect((await fulfillCheckoutSession(s)).status).toBe('already_fulfilled');
    expect(mockDb.rendez_vous).toHaveLength(1);
    expect(mockDb.bills).toHaveLength(1);
    expect(mockDb.disponibilites[0].taken).toBe(true);
  });

  it('reports a slot someone else already took', async () => {
    mockDb.disponibilites.push({ id: 'd1', taken: true, id_prof: 'p' });
    const result = await fulfillCheckoutSession(paid('cs_late', { disponibilite_id: 'd1', id_eleve: 'e2' }));
    expect(result.status).toBe('slot_taken');
    expect(mockDb.rendez_vous).toHaveLength(0);
  });
});

describe('lottery entries', () => {
  beforeEach(() => {
    mockDb.Lottery.push({ lotteryId: 'L1', isActive: true, lotteryTime: future, totalEntries: 0 });
    mockDb.Entry.push({ lotteryId: 'L1', userId: 'other', entryCount: 4 });
  });

  it('adds the paid entries once and keeps the global total right', async () => {
    const s = paid('cs_lot', { type: 'lottery_entry', lotteryId: 'L1', userId: 'u1', entryQuantity: '3' });
    await fulfillCheckoutSession(s);
    await fulfillCheckoutSession(s); // reloaded success URL
    expect(mockDb.Entry.find((e) => e.userId === 'u1').entryCount).toBe(3);
    expect(mockDb.Lottery[0].totalEntries).toBe(7);
    expect(mockDb.bills).toHaveLength(1);
  });

  it('grants nothing for a closed lottery', async () => {
    mockDb.Lottery[0].isActive = false;
    const result = await fulfillCheckoutSession(paid('cs_closed', { type: 'lottery_entry', lotteryId: 'L1', userId: 'u1', entryQuantity: '1' }));
    expect(result.status).toBe('lottery_closed');
    expect(mockDb.Entry).toHaveLength(1);
  });
});

describe('courses', () => {
  it.each([['payment'], ['subscription']])('enrolls once for a %s session', async (mode) => {
    const s = paid(`cs_${mode}`, { course_id: 'c1', student_id: 's1' }, { mode });
    await fulfillCheckoutSession(s);
    await fulfillCheckoutSession(s);
    expect(mockDb.cours_students).toHaveLength(1);
    expect(mockDb.bills).toHaveLength(1);
  });
});

describe('products', () => {
  it('records the order and escapes buyer-controlled text in the owner email', async () => {
    mockDb.Lottery.push({ lotteryId: 'P1', nomProduit: '<img src=x onerror=alert(1)>', price: 10 });
    const s = paid('cs_prod', { type: 'product', lotteryId: 'P1', userId: 'anonymous', quantity: '1', size: 'M' }, {
      customer_details: { email: 'buyer@example.com' },
      shipping_details: { address: { line1: '<b>1 rue</b>', city: 'Montréal', country: 'CA' } },
    });
    expect((await fulfillCheckoutSession(s)).status).toBe('granted');
    expect(mockDb.bills[0].user_id).toBeNull();
    const html = mockSendEmail.mock.calls[0][2];
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;b&gt;1 rue&lt;/b&gt;');
  });
});

describe('achats (shop items)', () => {
  it('records the order and e-mails the owner once, with buyer text escaped', async () => {
    mockDb.Achat.push({ id_item: 'A1', title_item: 'T-shirt', price_item: 25 });
    const s = paid('cs_achat', { type: 'achat', productId: 'A1', quantity: '2', size: '<script>x</script>' }, {
      customer_details: { email: 'buyer@example.com' },
      shipping_details: { address: { line1: '<img src=x>', city: 'Québec', country: 'CA' } },
    });
    expect((await fulfillCheckoutSession(s)).status).toBe('granted');
    expect((await fulfillCheckoutSession(s)).status).toBe('already_fulfilled'); // reloaded success URL
    expect(mockDb.bills).toHaveLength(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const html = mockSendEmail.mock.calls[0][2];
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('ledger behaviour', () => {
  it('rolls lottery entries back when the bill fails, then grants on retry', async () => {
    mockDb.Lottery.push({ lotteryId: 'L1', isActive: true, lotteryTime: future, totalEntries: 2 });
    mockDb.Entry.push({ lotteryId: 'L1', userId: 'u1', entryCount: 2 });
    const s = paid('cs_lot_retry', { type: 'lottery_entry', lotteryId: 'L1', userId: 'u1', entryQuantity: '5' });
    mockFailBillsOnce = true;
    await expect(fulfillCheckoutSession(s)).rejects.toThrow();
    expect(mockDb.Entry[0].entryCount).toBe(2);
    expect(mockDb.Lottery[0].totalEntries).toBe(2);
    await fulfillCheckoutSession(s);
    expect(mockDb.Entry[0].entryCount).toBe(7);
    expect(mockDb.Lottery[0].totalEntries).toBe(7);
  });

  it('releases the claim when a grant fails so a retry can grant', async () => {
    mockDb.disponibilites.push({ id: 'd1', taken: false, id_prof: 'p' });
    const s = paid('cs_retry', { disponibilite_id: 'd1', id_eleve: 'e1' });
    mockFailBillsOnce = true;
    await expect(fulfillCheckoutSession(s)).rejects.toThrow(/bill insert failed/);
    expect(mockDb.fulfillments).toHaveLength(0);
    expect(mockDb.rendez_vous).toHaveLength(0);
    expect(mockDb.disponibilites[0].taken).toBe(false);
    expect((await fulfillCheckoutSession(s)).status).toBe('granted');
  });

  it('does nothing for an unpaid session', async () => {
    const result = await fulfillCheckoutSession({ id: 'cs_unpaid', payment_status: 'unpaid', metadata: { course_id: 'c1', student_id: 's1' } });
    expect(result.status).toBe('not_paid');
    expect(mockDb.fulfillments).toHaveLength(0);
  });
});
