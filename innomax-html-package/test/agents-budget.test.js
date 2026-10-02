// agents/budget.js: monthly cap refuses work that would exceed it, records usage.
require('./helpers/quiet');
const { createBudget, meteredLLM, monthStart, BudgetExceededError } = require('../agents/budget');
const { createMockDb, sqlLikeHandlers } = require('./helpers/mock-supabase');

const now = () => new Date('2026-10-15T12:00:00Z');

function setup(usage, budgetUsd = 60) {
  const db = createMockDb({ agent_usage: usage }, sqlLikeHandlers(() => now().getTime()));
  const budget = createBudget({ db, getSettings: async () => ({ monthly_budget_usd: budgetUsd }), now });
  return { db, budget };
}

describe('agents/budget', () => {
  it('starts the month in Québec time', () => {
    expect(monthStart(new Date('2026-11-01T03:00:00Z'))).toBe('2026-10-01'); // still Oct 31 in Montréal
    expect(monthStart(new Date('2026-11-01T12:00:00Z'))).toBe('2026-11-01');
  });

  it('sums only the current month', async () => {
    const { budget } = setup([{ day: '2026-09-30', model: 'm', cost_usd: 50 }, { day: '2026-10-02', model: 'm', cost_usd: 10 }, { day: '2026-10-10', model: 'n', cost_usd: '5.5' }]);
    expect(await budget.monthSpend()).toBeCloseTo(15.5);
  });

  it('refuses a call that would pass the monthly budget', async () => {
    const { budget } = setup([{ day: '2026-10-02', model: 'm', cost_usd: 59.9 }]);
    await expect(budget.assertCanSpend(0.05)).resolves.toMatchObject({ spent: 59.9 });
    await expect(budget.assertCanSpend(0.2)).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(budget.assertCanSpend(0.2)).rejects.toThrow(/Budget mensuel atteint/);
  });

  it('a budget of 0 refuses everything', async () => {
    const { budget } = setup([], 0);
    await expect(budget.assertCanSpend(0.0001)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('meteredLLM checks before calling, records after, and sums job totals', async () => {
    const { db, budget } = setup([{ day: '2026-10-02', model: 'm', cost_usd: 1 }]);
    const llm = {
      estimateCost: () => 0.1,
      complete: jest.fn(async () => ({ text: 'x', model: 'claude-sonnet-5-5', costUsd: 0.03, usage: { input_tokens: 100, output_tokens: 50 } })),
    };
    const m = meteredLLM(llm, budget);
    await m.complete({});
    await m.complete({});
    expect(m.totals).toMatchObject({ calls: 2, tokensIn: 200, tokensOut: 100 });
    expect(m.totals.costUsd).toBeCloseTo(0.06);
    expect(db.calls.rpc.filter((c) => c.name === 'record_agent_usage')).toHaveLength(2);
  });

  it('meteredLLM never calls the API once the budget is spent', async () => {
    const { budget } = setup([{ day: '2026-10-02', model: 'm', cost_usd: 60 }]);
    const llm = { estimateCost: () => 0.01, complete: jest.fn() };
    await expect(meteredLLM(llm, budget).complete({})).rejects.toBeInstanceOf(BudgetExceededError);
    expect(llm.complete).not.toHaveBeenCalled();
  });
});
