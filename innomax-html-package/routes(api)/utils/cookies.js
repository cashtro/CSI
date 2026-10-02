// Auth and CSRF cookies are Secure unless explicitly turned off for plain-http
// local development (COOKIE_SECURE=false). Deliberately not tied to NODE_ENV:
// production runs with NODE_ENV=development (see README).
function cookieSecure() {
  return process.env.COOKIE_SECURE !== 'false';
}

module.exports = { cookieSecure };
