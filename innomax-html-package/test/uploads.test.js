// Upload filters refuse files a browser would execute from the public bucket.
const { isAllowedImage } = require('../routes(api)/utils/multerConfig');

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
