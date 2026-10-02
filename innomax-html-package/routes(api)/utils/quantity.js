// Parse and bound a client-supplied purchase quantity.
// Returns a valid integer in [min, max], or null if the input is invalid.
// (Prevents oversized/invalid order quantities reaching Stripe / fulfillment.)
function parseQuantity(raw, { min = 1, max = 20 } = {}) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

module.exports = { parseQuantity };
