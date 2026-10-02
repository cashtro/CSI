const { parseQuantity } = require('../routes(api)/utils/quantity');

describe('parseQuantity — bounded purchase quantity', () => {
  it('accepts a valid quantity', () => {
    expect(parseQuantity('3')).toBe(3);
    expect(parseQuantity(1)).toBe(1);
    expect(parseQuantity('20')).toBe(20);
  });
  it('rejects oversized quantities', () => {
    expect(parseQuantity('21')).toBeNull();
    expect(parseQuantity('1000000')).toBeNull();
  });
  it('rejects zero, negative, and non-numeric', () => {
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('-4')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
  });
  it('honors a custom max', () => {
    expect(parseQuantity('50', { max: 100 })).toBe(50);
    expect(parseQuantity('101', { max: 100 })).toBeNull();
  });
});
