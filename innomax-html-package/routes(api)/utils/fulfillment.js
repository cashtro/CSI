// Idempotency ledger for Stripe fulfillment.
//
// Backed by a `fulfillments` table:
//   create table fulfillments (
//     key text primary key,               -- e.g. 'webhook:cs_test_123'
//     type text,
//     created_at timestamptz default now()
//   );
// The primary key (or a UNIQUE constraint on `key`) is the real guard against
// double fulfillment under concurrent/replayed deliveries.
//
// Keys are namespaced by scope so independent consumers (the Stripe webhook and
// the success_url redirect verify handlers) dedupe against their OWN action and
// never block each other.

const { createSupabaseAdmin } = require('./supabaseUtil');

const UNIQUE_VIOLATION = '23505';

/**
 * Atomically claim a fulfillment key.
 * @returns {Promise<{claimed:boolean, alreadyProcessed?:boolean, error?:object}>}
 *  - { claimed:true }                      -> caller should perform the action
 *  - { alreadyProcessed:true }             -> already done, caller should skip
 *  - { claimed:false, error }              -> ledger unavailable; caller decides
 */
async function claimFulfillment(key, type) {
  if (!key) return { claimed: false, error: { message: 'missing key' } };

  const admin = createSupabaseAdmin();

  // Fast path: already recorded.
  const { data: existing, error: readError } = await admin
    .from('fulfillments')
    .select('key')
    .eq('key', key)
    .maybeSingle();

  if (readError) {
    // Ledger unavailable (e.g. table not yet created). Let the caller decide;
    // callers proceed best-effort so existing behavior is preserved.
    return { claimed: false, error: readError };
  }
  if (existing) return { claimed: false, alreadyProcessed: true };

  const { error: insertError } = await admin
    .from('fulfillments')
    .insert({ key, type: type || null });

  if (insertError) {
    // Concurrent claim won the race -> treat as already processed.
    if (insertError.code === UNIQUE_VIOLATION) {
      return { claimed: false, alreadyProcessed: true };
    }
    return { claimed: false, error: insertError };
  }

  return { claimed: true };
}

/** Read-only check: has this key been fulfilled? */
async function wasFulfilled(key) {
  if (!key) return false;
  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from('fulfillments')
    .select('key')
    .eq('key', key)
    .maybeSingle();
  return !!data;
}

/** Undo a claim whose action failed, so a retry can claim it again. */
async function releaseFulfillment(key) {
  const admin = createSupabaseAdmin();
  const { error } = await admin.from('fulfillments').delete().eq('key', key);
  if (error) console.error(`[fulfillment] could not release ${key}:`, error.message);
}

module.exports = { claimFulfillment, releaseFulfillment, wasFulfilled };
