describe('utils/crypto2fa — 2FA secret encryption at rest', () => {
  const ORIGINAL = process.env;
  beforeEach(() => { jest.resetModules(); process.env = { ...ORIGINAL }; });
  afterAll(() => { process.env = ORIGINAL; });

  it('round-trips a secret when a key is configured', () => {
    process.env.TOTP_ENC_KEY = 'unit-test-key';
    const { encryptSecret, decryptSecret, isEncrypted } = require('../routes(api)/utils/crypto2fa');
    const secret = 'JBSWY3DPEHPK3PXP';
    const enc = encryptSecret(secret);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('passes plaintext through decrypt (legacy backward-compat)', () => {
    process.env.TOTP_ENC_KEY = 'unit-test-key';
    const { decryptSecret } = require('../routes(api)/utils/crypto2fa');
    expect(decryptSecret('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('stores plaintext when no key is configured (degraded, boot-safe)', () => {
    delete process.env.TOTP_ENC_KEY;
    const { encryptSecret, isEncrypted } = require('../routes(api)/utils/crypto2fa');
    const out = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(out).toBe('JBSWY3DPEHPK3PXP');
    expect(isEncrypted(out)).toBe(false);
  });

  it('fails to decrypt a tampered ciphertext (auth tag)', () => {
    process.env.TOTP_ENC_KEY = 'unit-test-key';
    const { encryptSecret, decryptSecret } = require('../routes(api)/utils/crypto2fa');
    const enc = encryptSecret('JBSWY3DPEHPK3PXP');
    const tampered = enc.slice(0, -4) + (enc.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
