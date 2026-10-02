const { getRange } = require('../routes(api)/utils/pagination');

describe('getRange — bounded list pagination', () => {
  it('defaults to a bounded window when no params are given', () => {
    expect(getRange({})).toEqual({ limit: 100, offset: 0, from: 0, to: 99 });
  });

  it('clamps limit to maxLimit', () => {
    const r = getRange({ limit: '5000' }, { defaultLimit: 100, maxLimit: 200 });
    expect(r.limit).toBe(200);
    expect(r.to).toBe(199);
  });

  it('honors an explicit offset', () => {
    expect(getRange({ limit: '10', offset: '30' })).toMatchObject({ from: 30, to: 39, limit: 10 });
  });

  it('derives offset from page', () => {
    expect(getRange({ limit: '10', page: '3' })).toMatchObject({ offset: 20, from: 20, to: 29 });
  });

  it('falls back to defaults on invalid input', () => {
    const r = getRange({ limit: 'abc', offset: '-5' });
    expect(r.limit).toBe(100);
    expect(r.offset).toBe(0);
  });
});
