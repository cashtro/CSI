// Minimal Anthropic Messages API client over native fetch (no SDK dependency).
//
// - Tiers quick / default / complex map to models set by env (or settings).
// - Each attempt has its own timeout (AbortController).
// - 429 / 5xx / 529 and network errors are retried with exponential backoff
//   and full jitter; a retry-after header is honoured.
// - A circuit breaker stops calling the API after N consecutive failures and
//   lets one trial request through after a cooldown.
// - Cost is computed from usage.input_tokens / output_tokens with a price
//   table that env can override.
//
// The client only produces text. The one tool it can declare is Anthropic's
// server-side web search (research jobs): it READS the web on Anthropic's
// servers and returns results as text blocks. No client-side tool exists, so
// the engine cannot send an email, publish anything or act outside this process.

const logger = require('../routes(api)/utils/logger');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

const DEFAULT_MODELS = {
  quick: 'claude-haiku-4-5-20251001',
  default: 'claude-sonnet-5-5',
  complex: 'claude-opus-5-5',
};

const DEFAULT_MAX_TOKENS = { quick: 2048, default: 8192, complex: 16000 };

// USD per million tokens. À VÉRIFIER sur https://www.anthropic.com/pricing
// avant la mise en ligne (valeurs relevées le 2026-09-25). Override with
// AGENTS_PRICES_JSON='{"claude-opus-5-5":{"in":4,"out":20}}'.
// Keys match by prefix, so a dated model id uses its family price.
const DEFAULT_PRICES = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
};
// Unknown model: charge the budget as if it were a top-tier model, so a typo
// in a model name can only make the engine stop early, never overspend.
const UNKNOWN_MODEL_PRICE = { in: 10, out: 50 };

// Server-side refusal fallback (beta): when a safety classifier declines, the
// API re-runs the request on a suitable model inside the same call. On by
// default for the models that accept it; AGENTS_REFUSAL_FALLBACK=false turns it off.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = /^claude-(opus-5-5|sonnet-5-5)/;

// Web search is billed per search on top of tokens. À VÉRIFIER sur
// https://www.anthropic.com/pricing (10 $ / 1 000 recherches relevé le
// 2026-10-02). Override with AGENTS_WEB_SEARCH_USD_PER_1000.
const DEFAULT_SEARCH_USD_PER_1000 = 10;
// Search results are fed back to the model as input tokens: the worst-case
// estimate counts this many extra input tokens per allowed search.
const SEARCH_INPUT_TOKENS = 8000;

function searchPricePerCall(env = process.env) {
  const n = Number(env.AGENTS_WEB_SEARCH_USD_PER_1000);
  return (Number.isFinite(n) && n >= 0 ? n : DEFAULT_SEARCH_USD_PER_1000) / 1000;
}

function maxSearches(tools) {
  return (tools || []).filter((t) => t && t.name === 'web_search')
    .reduce((n, t) => n + (Number(t.max_uses) || 5), 0);
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

class LLMError extends Error {
  constructor(message, { status = null, code = 'llm_error', retryable = false } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

class CircuitOpenError extends LLMError {
  constructor(retryInMs) {
    super(`Circuit ouvert : API Anthropic en pause pendant ${Math.ceil(retryInMs / 1000)} s`, { code: 'circuit_open', retryable: true });
    this.name = 'CircuitOpenError';
    this.retryInMs = retryInMs;
  }
}

function intEnv(env, key, fallback) {
  const n = parseInt(env[key], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function loadPrices(env = process.env) {
  const prices = { ...DEFAULT_PRICES };
  if (env.AGENTS_PRICES_JSON) {
    try {
      const extra = JSON.parse(env.AGENTS_PRICES_JSON);
      for (const [model, p] of Object.entries(extra)) {
        if (p && Number.isFinite(Number(p.in)) && Number.isFinite(Number(p.out))) {
          prices[model] = { in: Number(p.in), out: Number(p.out) };
        }
      }
    } catch (err) {
      logger.warn('[agents] AGENTS_PRICES_JSON is not valid JSON; using default prices.');
    }
  }
  return prices;
}

function priceFor(model, prices) {
  if (prices[model]) return prices[model];
  // Longest matching prefix wins.
  const key = Object.keys(prices)
    .filter((k) => model && model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? prices[key] : UNKNOWN_MODEL_PRICE;
}

function costUsd(model, usage, prices) {
  const p = priceFor(model, prices);
  const tin = Number(usage && usage.input_tokens) || 0;
  const tout = Number(usage && usage.output_tokens) || 0;
  return (tin * p.in + tout * p.out) / 1e6;
}

// retry-after is seconds or an HTTP date.
function parseRetryAfter(value, now) {
  if (value == null || value === '') return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function createBreaker({ threshold = 5, cooldownMs = 60000, now = Date.now } = {}) {
  let failures = 0;
  let openedAt = null;
  let trialInFlight = false;
  return {
    get state() {
      if (openedAt == null) return 'closed';
      return now() - openedAt >= cooldownMs ? 'half_open' : 'open';
    },
    get failures() { return failures; },
    // Throws CircuitOpenError when calls are not allowed.
    before() {
      if (openedAt == null) return;
      const elapsed = now() - openedAt;
      if (elapsed < cooldownMs) throw new CircuitOpenError(cooldownMs - elapsed);
      if (trialInFlight) throw new CircuitOpenError(1000);
      trialInFlight = true; // half-open: one trial request
    },
    success() { failures = 0; openedAt = null; trialInFlight = false; },
    failure() {
      trialInFlight = false;
      failures += 1;
      if (failures >= threshold) {
        if (openedAt == null || now() - openedAt >= cooldownMs) {
          logger.error(`[agents] Circuit breaker opened after ${failures} consecutive API failures.`);
        }
        openedAt = now();
      }
    },
  };
}

// opts: { apiKey, env, fetchImpl, sleep, now, random, breaker, models() }
function createLLM(opts = {}) {
  const env = opts.env || process.env;
  const apiKey = opts.apiKey !== undefined ? opts.apiKey : env.ANTHROPIC_API_KEY;
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || Date.now;
  const random = opts.random || Math.random;
  const prices = opts.prices || loadPrices(env);
  const maxRetries = intEnv(env, 'AGENTS_LLM_MAX_RETRIES', 4);
  const baseDelayMs = intEnv(env, 'AGENTS_LLM_BACKOFF_MS', 1000);
  const maxDelayMs = intEnv(env, 'AGENTS_LLM_BACKOFF_MAX_MS', 30000);
  const timeoutMs = intEnv(env, 'AGENTS_LLM_TIMEOUT_MS', 180000);
  const breaker = opts.breaker || createBreaker({
    threshold: intEnv(env, 'AGENTS_BREAKER_THRESHOLD', 5),
    cooldownMs: intEnv(env, 'AGENTS_BREAKER_COOLDOWN_MS', 60000),
    now,
  });
  // Settings may override env models at runtime (admin page).
  const modelOverrides = opts.models || (() => ({}));

  function resolveModel(tierOrModel = 'default') {
    if (!DEFAULT_MODELS[tierOrModel]) return tierOrModel; // explicit model id
    const o = modelOverrides() || {};
    return o[tierOrModel] || env[`AGENTS_MODEL_${tierOrModel.toUpperCase()}`] || DEFAULT_MODELS[tierOrModel];
  }

  function maxTokensFor(tier) {
    const t = DEFAULT_MAX_TOKENS[tier] ? tier : 'default';
    return intEnv(env, `AGENTS_MAX_TOKENS_${t.toUpperCase()}`, DEFAULT_MAX_TOKENS[t]);
  }

  function backoff(attempt, retryAfterMs) {
    if (retryAfterMs != null) return Math.min(retryAfterMs, Math.max(maxDelayMs, 60000));
    const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    return Math.round(random() * ceiling); // full jitter
  }

  async function attempt(body, extraHeaders) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        ...extraHeaders,
      };
      return await fetchImpl(API_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  const perSearch = searchPricePerCall(env);

  // { tier, model, system, messages, maxTokens, tools }
  //   -> { text, content, model, usage, costUsd, searchCostUsd, webSearches, stopReason }
  async function complete({ tier = 'default', model, system, messages, maxTokens, tools } = {}) {
    if (!apiKey) throw new LLMError('ANTHROPIC_API_KEY absente', { code: 'no_api_key' });
    const useModel = model || resolveModel(tier);
    const body = {
      model: useModel,
      max_tokens: maxTokens || maxTokensFor(tier),
      messages,
    };
    if (system) body.system = system;
    if (tools && tools.length) body.tools = tools;
    const effort = env[`AGENTS_EFFORT_${String(tier).toUpperCase()}`];
    if (effort) body.output_config = { effort };
    const extraHeaders = {};
    if (env.AGENTS_REFUSAL_FALLBACK !== 'false' && FALLBACK_MODELS.test(useModel)) {
      body.fallbacks = 'default';
      extraHeaders['anthropic-beta'] = FALLBACK_BETA;
    }

    breaker.before();
    let lastErr;
    for (let i = 0; i <= maxRetries; i += 1) {
      let res;
      try {
        res = await attempt(body, extraHeaders);
      } catch (err) {
        const aborted = err && err.name === 'AbortError';
        lastErr = new LLMError(aborted ? `Délai dépassé (${timeoutMs} ms)` : `Erreur réseau : ${err && err.message}`, {
          code: aborted ? 'timeout' : 'network', retryable: true,
        });
        if (i < maxRetries) { await sleep(backoff(i, null)); continue; }
        break;
      }

      if (res.ok) {
        let data;
        try {
          data = await res.json();
        } catch (err) {
          // A cut-off body must count as a failed attempt: escaping here left
          // a half-open breaker's trial flag set, blocking every later call.
          lastErr = new LLMError('Réponse illisible de l’API Anthropic', { code: 'bad_response', retryable: true });
          if (i < maxRetries) { await sleep(backoff(i, null)); continue; }
          break;
        }
        if (data.stop_reason === 'refusal') {
          breaker.success(); // the API works; the request was declined
          throw new LLMError('Le modèle a refusé la demande.', { code: 'refusal' });
        }
        const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        const usage = { input_tokens: Number(data.usage && data.usage.input_tokens) || 0, output_tokens: Number(data.usage && data.usage.output_tokens) || 0 };
        const served = data.model || useModel;
        const webSearches = Number(data.usage && data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests) || 0;
        const searchCostUsd = webSearches * perSearch;
        breaker.success();
        return {
          text,
          content: data.content || [],
          model: served,
          usage,
          costUsd: costUsd(served, usage, prices) + searchCostUsd,
          searchCostUsd,
          webSearches,
          stopReason: data.stop_reason,
        };
      }

      const status = res.status;
      let detail = '';
      try { const e = await res.json(); detail = (e && e.error && e.error.type) || ''; } catch (_) { /* body not JSON */ }
      if (!RETRY_STATUSES.has(status)) {
        // 400 = our request is wrong: not an outage, so the breaker ignores it.
        if (status === 401 || status === 403) breaker.failure();
        else breaker.success();
        throw new LLMError(`API Anthropic ${status}${detail ? ` (${detail})` : ''}`, { status, code: 'http_error' });
      }
      lastErr = new LLMError(`API Anthropic ${status}${detail ? ` (${detail})` : ''}`, { status, code: 'http_error', retryable: true });
      if (i < maxRetries) {
        const ra = parseRetryAfter(res.headers && res.headers.get && res.headers.get('retry-after'), now());
        const wait = backoff(i, ra);
        logger.warn(`[agents] API ${status}, nouvelle tentative ${i + 1}/${maxRetries} dans ${wait} ms`);
        await sleep(wait);
      }
    }
    breaker.failure();
    throw lastErr;
  }

  // Worst-case cost of one call, used by the budget before calling.
  // With web search: every allowed search is charged, plus its results read
  // back as input tokens.
  function estimateCost({ tier = 'default', model, system = '', messages = [], maxTokens, tools } = {}) {
    const useModel = model || resolveModel(tier);
    const chars = String(system).length + JSON.stringify(messages).length;
    const searches = maxSearches(tools);
    const usage = { input_tokens: Math.ceil(chars / 3) + searches * SEARCH_INPUT_TOKENS, output_tokens: maxTokens || maxTokensFor(tier) };
    return costUsd(useModel, usage, prices) + searches * perSearch;
  }

  return { complete, estimateCost, resolveModel, breaker, hasKey: Boolean(apiKey) };
}

module.exports = {
  createLLM,
  createBreaker,
  costUsd,
  priceFor,
  loadPrices,
  parseRetryAfter,
  searchPricePerCall,
  maxSearches,
  DEFAULT_SEARCH_USD_PER_1000,
  LLMError,
  CircuitOpenError,
  DEFAULT_MODELS,
  DEFAULT_PRICES,
  UNKNOWN_MODEL_PRICE,
};
