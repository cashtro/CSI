// Express "trust proxy" from TRUST_PROXY.
//
// Behind nginx (or any reverse proxy) every request reaches Node from
// 127.0.0.1. Without trust proxy, req.ip is that address for everyone, so
// each rate limit (login, 2FA, payments, agents) is one bucket shared by all
// visitors: one attacker can lock everybody out of 2FA for 15 minutes.
//
// Accepted values: a hop count ("1" = one proxy in front), or Express subnet
// names / addresses ("loopback", "127.0.0.1", "loopback, 10.0.0.0/8").
// "true" is refused: it trusts any X-Forwarded-For, which lets a client pick
// its own IP and bypass every limit. Unset = proxy not trusted (as before).
function parseTrustProxy(raw) {
  if (raw == null) return false;
  const v = String(raw).trim();
  if (!v || v === 'false' || v === '0') return false;
  if (v === 'true') return false;
  if (/^\d{1,2}$/.test(v)) return Number(v);
  if (/^[a-z0-9.:/,\s]+$/i.test(v)) return v;
  return false;
}

module.exports = { parseTrustProxy };
