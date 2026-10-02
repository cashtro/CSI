// Pure, DB-free helpers for booking / lottery integrity so the core decision
// logic is unit-testable without a live Supabase instance.

/**
 * Did an atomic conditional claim actually take the slot?
 * We claim a slot with `UPDATE disponibilites SET taken=true WHERE id=? AND
 * taken=false` and `.select()` the affected rows. Postgres only returns rows it
 * actually changed, so a non-empty result means THIS request won the slot.
 */
function slotWasClaimed(updatedRows) {
  return Array.isArray(updatedRows) && updatedRows.length > 0;
}

/**
 * Global entry total for a lottery = sum of every user's entryCount.
 * (The bug this fixes wrote a single user's cumulative count as the lottery's
 * global total, corrupting draw gating.)
 */
function sumEntryCounts(entries) {
  return (entries || []).reduce((sum, e) => sum + (Number(e && e.entryCount) || 0), 0);
}

module.exports = { slotWasClaimed, sumEntryCounts };
