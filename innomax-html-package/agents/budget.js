// Monthly spending cap.
//
// Before each model call the engine asks assertCanSpend(worst-case cost). If
// the month's recorded spend plus that estimate would pass
// agent_settings.monthly_budget_usd, it throws BudgetExceededError and the
// job ends with status 'budget_refused'. After each call record() adds the
// real usage to agent_usage (atomic upsert in SQL).
//
// Months follow Québec time (America/Toronto), like record_agent_usage().
// Calls that run in parallel (a Council runs up to 6 at once) each reserve
// their worst-case estimate in this process before calling, and the check
// counts those reservations: without that, six calls reading the same "spent"
// at once could all pass and overshoot the cap six times over. Run a single
// worker process: separate processes do not see each other's reservations.

const logger = require('../routes(api)/utils/logger');

const TZ = 'America/Toronto';

// Worst-case cost of the calls in flight in this process (shared by every
// budget object, since each job builds its own).
let reserved = 0;

class BudgetExceededError extends Error {
  constructor({ spent, budget, estimate }) {
    super(`Budget mensuel atteint : ${spent.toFixed(2)} $ dépensés sur ${budget.toFixed(2)} $ (prochain appel estimé à ${estimate.toFixed(4)} $).`);
    this.name = 'BudgetExceededError';
    this.code = 'budget_exceeded';
    this.spent = spent;
    this.budget = budget;
    this.estimate = estimate;
  }
}

function monthStart(date = new Date()) {
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(date);
  return `${ym.slice(0, 7)}-01`;
}

// db: Supabase admin client. getSettings: async () => ({ monthly_budget_usd }).
function createBudget({ db, getSettings, now = () => new Date() }) {
  async function monthSpend() {
    const { data, error } = await db.from('agent_usage').select('cost_usd').gte('day', monthStart(now()));
    if (error) throw new Error(`agent_usage illisible : ${error.message}`);
    return (data || []).reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
  }

  async function status() {
    const settings = await getSettings();
    const budget = Number(settings && settings.monthly_budget_usd);
    const spent = await monthSpend();
    const limit = Number.isFinite(budget) ? budget : 60;
    return { spent, budget: limit, remaining: Math.max(0, limit - spent), month: monthStart(now()) };
  }

  async function assertCanSpend(estimate = 0) {
    const s = await status();
    if (s.spent + reserved + estimate > s.budget) throw new BudgetExceededError({ spent: s.spent + reserved, budget: s.budget, estimate });
    return s;
  }

  // Check AND reserve, with no await between the two, so parallel callers
  // see each other. Returns a release() to call once the call is recorded.
  async function reserve(estimate = 0) {
    const s = await status();
    const amount = Math.max(0, Number(estimate) || 0);
    if (s.spent + reserved + amount > s.budget) throw new BudgetExceededError({ spent: s.spent + reserved, budget: s.budget, estimate: amount });
    reserved += amount;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      reserved = Math.max(0, reserved - amount);
    };
  }

  async function record({ model, tokensIn = 0, tokensOut = 0, costUsd = 0 }) {
    const { error } = await db.rpc('record_agent_usage', {
      p_model: model, p_tokens_in: tokensIn, p_tokens_out: tokensOut, p_cost: costUsd,
    });
    // The call already happened; losing the row would under-count the budget,
    // so make it loud.
    if (error) logger.error('[agents] usage not recorded:', error.message);
  }

  return { monthSpend, status, assertCanSpend, reserve, record };
}

// Wrap an LLM client so every call is checked against the budget, recorded,
// and added to the job's running totals.
function meteredLLM(llm, budget, totals = { costUsd: 0, tokensIn: 0, tokensOut: 0, calls: 0 }) {
  return {
    totals,
    resolveModel: llm.resolveModel,
    async complete(req) {
      const release = await budget.reserve(llm.estimateCost(req));
      try {
        const out = await llm.complete(req);
        totals.costUsd += out.costUsd;
        totals.tokensIn += out.usage.input_tokens;
        totals.tokensOut += out.usage.output_tokens;
        totals.calls += 1;
        await budget.record({ model: out.model, tokensIn: out.usage.input_tokens, tokensOut: out.usage.output_tokens, costUsd: out.costUsd });
        return out;
      } finally {
        release();
      }
    },
  };
}

module.exports = { createBudget, meteredLLM, monthStart, BudgetExceededError, _reserved: () => reserved };
