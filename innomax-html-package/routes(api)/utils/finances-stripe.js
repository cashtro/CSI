// Read-only Stripe data for the Finances tab: subscriptions (MRR, churn) and
// paid invoices (renewals, invoice list). Optional: without STRIPE_SECRET_KEY,
// under NODE_ENV=test or with FINANCES_STRIPE=false, the tab works from the
// bills table alone and labels the MRR as an estimate.
//
// Results are cached 5 minutes in memory so the page does not call Stripe on
// every view; a slow or failing Stripe answer never breaks the page.

const logger = require('./logger');

const TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;
let cache = { at: 0, data: null };

function enabled(env = process.env) {
  return Boolean(env.STRIPE_SECRET_KEY) && env.NODE_ENV !== 'test' && env.FINANCES_STRIPE !== 'false';
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('délai Stripe dépassé')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// stripe: a Stripe client (injectable for tests). Returns
// { subscriptions, invoices } or null.
async function fetchStripeFinance({ stripe, env = process.env, now = Date.now() } = {}) {
  if (!stripe && !enabled(env)) return null;
  if (cache.data && now - cache.at < TTL_MS) return cache.data;
  try {
    const client = stripe || require('stripe')(env.STRIPE_SECRET_KEY);
    const since = Math.floor(now / 1000) - 400 * 86400;
    const [subscriptions, invoices] = await withTimeout(Promise.all([
      client.subscriptions.list({ status: 'all', limit: 100 }).autoPagingToArray({ limit: 1000 }),
      client.invoices.list({ status: 'paid', created: { gte: since }, limit: 100 }).autoPagingToArray({ limit: 2000 }),
    ]), TIMEOUT_MS);
    cache = { at: now, data: { subscriptions, invoices } };
    return cache.data;
  } catch (err) {
    logger.warn('[finances] Stripe illisible, repli sur la table bills :', err.message);
    return null;
  }
}

module.exports = { fetchStripeFinance, enabled, _resetCache: () => { cache = { at: 0, data: null }; } };
