// Content-Security-Policy in REPORT-ONLY mode.
//
// This NEVER blocks anything — it only asks the browser to report resources that
// an enforcing policy WOULD block, so a tailored, enforcing CSP can be built from
// real violation data. The app currently relies on inline scripts and ~20 CDNs,
// so enforcing a strict CSP blind would break it; report-only is the safe first
// phase. Flip to an enforcing `Content-Security-Policy` header once the reports
// have been reviewed and the allowlist finalized (browser QA required).
//
// Baseline below allows 'self' + inline + the CDNs currently in use, so ordinary
// pages don't flood reports; anything NEW/unexpected still gets reported.

const REPORT_ONLY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://js.zohocdn.com https://static.zohocdn.com https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://css.zohocdn.com",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "connect-src 'self' https:",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "object-src 'none'",
  "base-uri 'self'",
  "report-uri /api/csp-report",
].join('; ');

function cspReportOnly(req, res, next) {
  res.setHeader('Content-Security-Policy-Report-Only', REPORT_ONLY_POLICY);
  next();
}

module.exports = { cspReportOnly, REPORT_ONLY_POLICY };
