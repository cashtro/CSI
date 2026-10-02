// Bound unbounded list queries. Keeps the array response shape (so existing
// callers don't break) while capping how many rows a single request can pull.
// Supports optional ?limit= and ?offset= (or ?page=) query params, clamped.

function getRange(query = {}, { defaultLimit = 100, maxLimit = 200 } = {}) {
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  let offset = parseInt(query.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) {
    const page = parseInt(query.page, 10);
    offset = Number.isFinite(page) && page > 1 ? (page - 1) * limit : 0;
  }

  // Supabase `.range(from, to)` is inclusive on both ends.
  return { limit, offset, from: offset, to: offset + limit - 1 };
}

module.exports = { getRange };
