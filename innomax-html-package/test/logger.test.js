describe('utils/logger', () => {
  const ORIGINAL_ENV = process.env;
  let logSpy, warnSpy, errorSpy;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  afterAll(() => { process.env = ORIGINAL_ENV; });

  it('emits error/warn/info at default level and tags the level', () => {
    const logger = require('../routes(api)/utils/logger');
    logger.error('boom');
    logger.warn('careful');
    logger.info('hello');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'), 'boom');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN]'), 'careful');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO]'), 'hello');
  });

  it('suppresses debug below the configured level (default info)', () => {
    const logger = require('../routes(api)/utils/logger');
    logger.debug('noisy');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('honors LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug';
    const logger = require('../routes(api)/utils/logger');
    logger.debug('now visible');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[DEBUG]'), 'now visible');
  });

  it('redact() scrubs secret/PII fields (deep)', () => {
    const logger = require('../routes(api)/utils/logger');
    const clean = logger.redact({
      email: 'a@b.com',
      access_token: 'xyz',
      nested: { password: 'p', ok: 1 },
      ok: 'visible',
    });
    expect(clean.email).toBe('[redacted]');
    expect(clean.access_token).toBe('[redacted]');
    expect(clean.nested.password).toBe('[redacted]');
    expect(clean.nested.ok).toBe(1);
    expect(clean.ok).toBe('visible');
  });
});
