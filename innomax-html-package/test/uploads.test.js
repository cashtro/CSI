// Upload filters refuse files a browser would execute from the public bucket.
const { isAllowedImage, matchesImageSignature, extensionFor } = require('../routes(api)/utils/multerConfig');

describe('image upload filter', () => {
  it.each([
    ['image/png', 'a.png', true],
    ['image/jpeg', 'photo.JPG', true],
    ['image/webp', 'x.webp', true],
    ['image/svg+xml', 'logo.svg', false],
    ['image/png', 'evil.svg', false],
    ['image/png', 'page.html', false],
    ['text/html', 'a.png', false],
  ])('%s %s -> %s', (mimetype, originalname, ok) => {
    expect(isAllowedImage({ mimetype, originalname })).toBe(ok);
  });
});

describe('image content signature', () => {
  const pad = (b) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);
  it.each([
    ['image/png', pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), true],
    ['image/jpeg', pad([0xff, 0xd8, 0xff, 0xe0]), true],
    ['image/gif', pad(Buffer.from('GIF89a')), true],
    ['image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]), true],
    ['image/avif', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(8)]), true],
    ['image/png', pad(Buffer.from('<html><script>')), false],
    ['image/png', pad(Buffer.from('<svg onload=1>')), false],
    ['image/jpeg', pad([0x89, 0x50, 0x4e, 0x47]), false],
    ['image/svg+xml', pad(Buffer.from('<svg/>')), false],
    ['image/png', Buffer.from([0x89, 0x50]), false],
  ])('%s -> %s', (mimetype, buffer, ok) => {
    expect(matchesImageSignature(buffer, mimetype)).toBe(ok);
  });

  it('derives the stored extension from the verified type', () => {
    expect(extensionFor('image/jpeg')).toBe('.jpg');
    expect(extensionFor('image/svg+xml')).toBeNull();
  });
});
