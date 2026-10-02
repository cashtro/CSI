const { slotWasClaimed, sumEntryCounts } = require('../routes(api)/utils/booking');

describe('slotWasClaimed — atomic slot claim result', () => {
  it('true when the conditional update changed a row (we won the slot)', () => {
    expect(slotWasClaimed([{ id: 'd1' }])).toBe(true);
  });
  it('false when no row changed (slot already taken)', () => {
    expect(slotWasClaimed([])).toBe(false);
    expect(slotWasClaimed(null)).toBe(false);
    expect(slotWasClaimed(undefined)).toBe(false);
  });
});

describe('sumEntryCounts — global lottery total', () => {
  it('sums every user entryCount', () => {
    expect(sumEntryCounts([{ entryCount: 3 }, { entryCount: 5 }, { entryCount: 2 }])).toBe(10);
  });
  it('handles empty / missing / non-numeric safely', () => {
    expect(sumEntryCounts([])).toBe(0);
    expect(sumEntryCounts(null)).toBe(0);
    expect(sumEntryCounts([{ entryCount: 4 }, {}, { entryCount: null }])).toBe(4);
  });
  it('does not write a single user total as the global (regression guard for H2)', () => {
    // Two users with 5 and 7 -> global 12, not 7 (the last writer).
    expect(sumEntryCounts([{ entryCount: 5 }, { entryCount: 7 }])).toBe(12);
  });
});
