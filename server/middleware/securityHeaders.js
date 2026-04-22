/**
 * Minimal security headers — no helmet dependency.
 *
 * What this sets (and why):
 *   - X-Content-Type-Options: nosniff
 *       Blocks MIME-sniffing attacks on served static assets.
 *   - X-Frame-Options: DENY
 *       The app is never legitimately framed — refuse clickjacking.
 *   - Referrer-Policy: no-referrer
 *       We never need to leak the current path to outbound links
 *       (and news card links open in a new tab anyway).
 *   - X-XSS-Protection: 0
 *       The legacy XSS auditor caused more XSS than it prevented;
 *       modern guidance is to disable it explicitly.
 *   - Strict-Transport-Security (prod only)
 *       Only set when NODE_ENV=production AND the request came in over
 *       https, or behind a trusted proxy that reports x-forwarded-proto.
 *       Don't pin HSTS in dev — it survives across ports and breaks the
 *       Vite dev server for weeks.
 *
 * What this deliberately does NOT set:
 *   - Content-Security-Policy. The SPA uses Vite with inline scripts in
 *     dev and ships bundled assets in prod. A strict CSP is high-risk
 *     and deploy-specific; left for a production hardening pass.
 */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');

  if (process.env.NODE_ENV === 'production') {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto === 'https') {
      // 180 days, includeSubDomains. No `preload` — opt-in only via env.
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
  }
  next();
}
