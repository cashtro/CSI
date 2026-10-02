// agents/llm.js: retries with backoff, retry-after, timeout, circuit breaker, cost.
require('./helpers/quiet');
const { createLLM, createBreaker, costUsd, priceFor, loadPrices, parseRetryAfter, LLMError, CircuitOpenError, UNKNOWN_MODEL_PRICE } = require('../agents/llm');

function reply(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}
const okBody = (text = 'Bonjour', usage = { input_tokens: 1000, output_tokens: 500 }) => ({
  model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }], usage,
});

function make(responses, extra = {}) {
  const queue = [...responses];
  const fetchImpl = jest.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const delays = [];
  const llm = createLLM({
    apiKey: 'sk-test', env: { AGENTS_LLM_BACKOFF_MS: '1000', AGENTS_LLM_BACKOFF_MAX_MS: '30000', ...extra.env },
    fetchImpl, sleep: async (ms) => { delays.push(ms); }, random: () => 1, ...extra,
  });
  return { llm, fetchImpl, delays };
}

const req = { tier: 'default', system: 's', messages: [{ role: 'user', content: 'x' }] };

describe('agents/llm unreadable responses', () => {
  it('retries a 200 whose body is not JSON, and the half-open breaker recovers', async () => {
    let t = 0;
    const breaker = createBreaker({ threshold: 1, cooldownMs: 10, now: () => t });
    breaker.failure(); // open
    t = 20; // half-open: the next call is the trial
    const broken = { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('Unexpected end'); } };
    const { llm } = make([broken, reply(200, okBody())], { breaker, now: () => t });
    await expect(llm.complete(req)).resolves.toMatchObject({ text: 'Bonjour' });
    expect(breaker.state).toBe('closed');
  });

  it('a body that never parses fails the call and releases the trial', async () => {
    let t = 0;
    const breaker = createBreaker({ threshold: 1, cooldownMs: 10, now: () => t });
    breaker.failure();
    t = 20;
    const broken = () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('x'); } });
    const { llm } = make([broken(), broken()], { breaker, now: () => t, env: { AGENTS_LLM_MAX_RETRIES: '1' } });
    await expect(llm.complete(req)).rejects.toMatchObject({ code: 'bad_response' });
    t = 40; // after the cooldown a new trial is allowed again (not stuck)
    expect(() => breaker.before()).not.toThrow();
  });
});

describe('agents/llm retries and backoff', () => {
  it('retries 529 / 500 / 429 with exponential backoff, then succeeds', async () => {
    const { llm, fetchImpl, delays } = make([reply(529), reply(500), reply(429), reply(200, okBody())]);
    const out = await llm.complete(req);
    expect(out.text).toBe('Bonjour');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([1000, 2000, 4000]); // random()=1 -> full ceiling
  });

  it('applies full jitter (random * ceiling)', async () => {
    const { llm, delays } = make([reply(500), reply(200, okBody())], { random: () => 0.25 });
    await llm.complete(req);
    expect(delays).toEqual([250]);
  });

  it('honours retry-after (seconds) instead of the computed backoff', async () => {
    const { llm, delays } = make([reply(429, {}, { 'retry-after': '7' }), reply(200, okBody())]);
    await llm.complete(req);
    expect(delays).toEqual([7000]);
  });

  it('retries network errors and timeouts', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { llm, fetchImpl } = make([new Error('ECONNRESET'), abort, reply(200, okBody())]);
    await expect(llm.complete(req)).resolves.toMatchObject({ text: 'Bonjour' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('aborts a hanging request after the timeout', async () => {
    const fetchImpl = jest.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const llm = createLLM({ apiKey: 'k', env: { AGENTS_LLM_TIMEOUT_MS: '20', AGENTS_LLM_MAX_RETRIES: '0' }, fetchImpl, sleep: async () => {} });
    await expect(llm.complete(req)).rejects.toMatchObject({ code: 'timeout', retryable: true });
  });

  it('gives up after max retries with a retryable error', async () => {
    const { llm, fetchImpl } = make([reply(529), reply(529), reply(529)], { env: { AGENTS_LLM_MAX_RETRIES: '2' } });
    await expect(llm.complete(req)).rejects.toMatchObject({ status: 529, retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 400', async () => {
    const { llm, fetchImpl } = make([reply(400, { error: { type: 'invalid_request_error' } })]);
    await expect(llm.complete(req)).rejects.toMatchObject({ status: 400, retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('turns a refusal into a non-retryable error', async () => {
    const { llm } = make([reply(200, { ...okBody(), stop_reason: 'refusal' })]);
    await expect(llm.complete(req)).rejects.toMatchObject({ code: 'refusal' });
  });

  it('refuses to call without an API key', async () => {
    const llm = createLLM({ apiKey: '', env: {}, fetchImpl: jest.fn() });
    await expect(llm.complete(req)).rejects.toMatchObject({ code: 'no_api_key' });
  });

  it('sends the key header, the model of the tier and only text blocks come back', async () => {
    const { llm, fetchImpl } = make([reply(200, okBody('ok'))], { env: { AGENTS_MODEL_DEFAULT: 'claude-sonnet-5-5' } });
    const out = await llm.complete(req);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.tools).toBeUndefined(); // the engine has no tools
    expect(out.text).toBe('ok');
  });

  it('parses retry-after as an HTTP date', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(parseRetryAfter('Fri, 02 Oct 2026 12:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});

describe('agents/llm circuit breaker', () => {
  it('opens after N consecutive failures, then lets one trial through after the cooldown', async () => {
    let t = 0;
    const breaker = createBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
    const { llm, fetchImpl } = make([reply(500), reply(500), reply(200, okBody())], { breaker, env: { AGENTS_LLM_MAX_RETRIES: '0' } });
    await expect(llm.complete(req)).rejects.toBeInstanceOf(LLMError);
    await expect(llm.complete(req)).rejects.toBeInstanceOf(LLMError);
    expect(breaker.state).toBe('open');
    await expect(llm.complete(req)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no call while open
    t = 1500;
    expect(breaker.state).toBe('half_open');
    await expect(llm.complete(req)).resolves.toMatchObject({ text: 'Bonjour' });
    expect(breaker.state).toBe('closed');
  });

  it('a 400 does not count as an outage', async () => {
    const breaker = createBreaker({ threshold: 1, cooldownMs: 1000 });
    const { llm } = make([reply(400)], { breaker });
    await expect(llm.complete(req)).rejects.toMatchObject({ status: 400 });
    expect(breaker.state).toBe('closed');
  });
});

describe('agents/llm cost', () => {
  it('computes cost from usage with the price table (prefix match for dated ids)', () => {
    const prices = loadPrices({});
    expect(costUsd('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e6 }, prices)).toBeCloseTo(12);
    expect(priceFor('claude-haiku-4-5-20251001', prices)).toEqual({ in: 1, out: 5 });
  });

  it('charges unknown models at the prudent fallback price', () => {
    expect(priceFor('mystery-model', loadPrices({}))).toEqual(UNKNOWN_MODEL_PRICE);
  });

  it('lets env override prices', () => {
    const prices = loadPrices({ AGENTS_PRICES_JSON: '{"claude-opus-5-5":{"in":9,"out":99}}' });
    expect(costUsd('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 0 }, prices)).toBe(9);
  });

  it('returns the cost on each completion', async () => {
    const { llm } = make([reply(200, okBody('x', { input_tokens: 500000, output_tokens: 100000 }))]);
    const out = await llm.complete(req);
    expect(out.costUsd).toBeCloseTo(500000 * 2 / 1e6 + 100000 * 10 / 1e6);
  });
});
