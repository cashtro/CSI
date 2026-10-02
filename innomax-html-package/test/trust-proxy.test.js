const { parseTrustProxy } = require('../routes(api)/utils/trustProxy');

describe('TRUST_PROXY parsing', () => {
  it.each([
    [undefined, false], ['', false], ['false', false], ['0', false],
    ['true', false], // would let any client forge X-Forwarded-For
    ['1', 1], ['2', 2], ['loopback', 'loopback'], ['127.0.0.1', '127.0.0.1'],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'], ['$(rm -rf)', false],
  ])('%p -> %p', (raw, want) => {
    expect(parseTrustProxy(raw)).toEqual(want);
  });
});
