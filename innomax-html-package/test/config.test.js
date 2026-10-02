// Boot-safety: a missing credential must not crash startup at import time.
describe('utils/config — boot-safety', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reports missing required vars and installs non-throwing sentinels', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    const cfg = require('../routes(api)/utils/config');

    expect(cfg.isDegraded).toBe(true);
    expect(cfg.missingEnv).toEqual(
      expect.arrayContaining(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'STRIPE_SECRET_KEY'])
    );
    // Sentinels installed so downstream SDK constructors don't throw.
    expect(process.env.SUPABASE_URL).toBe('https://missing-config.invalid');
    expect(process.env.STRIPE_SECRET_KEY).toBe('sk_test_missing_config');
  });

  it('does not overwrite real values that are already set', () => {
    process.env.SUPABASE_URL = 'https://real.supabase.co';
    const cfg = require('../routes(api)/utils/config');
    expect(process.env.SUPABASE_URL).toBe('https://real.supabase.co');
    expect(cfg.missingEnv).not.toContain('SUPABASE_URL');
  });

  it('lets the Stripe/Supabase util load without throwing when keys are missing', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.SENDGRID_API_KEY;

    require('../routes(api)/utils/config'); // installs sentinels first
    expect(() => require('../routes(api)/utils/stripe')).not.toThrow();
  });
});
