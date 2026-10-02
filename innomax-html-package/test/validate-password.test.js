const { validatePassword } = require('../routes(api)/utils/validation-middleware');

describe('validatePassword — returns missingRequirements (M4 crash fix)', () => {
  it('weak password: invalid, with a non-empty missingRequirements array', () => {
    const r = validatePassword('weak');
    expect(r.isValid).toBe(false);
    expect(Array.isArray(r.missingRequirements)).toBe(true);
    expect(r.missingRequirements.length).toBeGreaterThan(0);
    // The registration path does missingRequirements.join(', ') — must not throw.
    expect(() => r.missingRequirements.join(', ')).not.toThrow();
  });

  it('password missing a special char reports it', () => {
    const r = validatePassword('Password1');
    expect(r.isValid).toBe(false);
    expect(r.missingRequirements.join(', ')).toMatch(/special character/);
  });

  it('strong password: valid, empty missingRequirements', () => {
    const r = validatePassword('Str0ng!Pass');
    expect(r.isValid).toBe(true);
    expect(r.missingRequirements).toEqual([]);
  });
});
