/**
 * Liveness + readiness endpoints for load balancers and uptime monitors.
 *
 *   GET /api/health  — liveness. Returns 200 if the process is up.
 *                      Does NOT touch the DB so a degraded DB does not flap
 *                      the whole service out of the LB pool.
 *   GET /api/ready   — readiness. Returns 503 if the DB is not reachable.
 *                      Kubernetes readinessProbe should use this.
 *
 * Both endpoints are unauthenticated (ops infra needs to reach them without
 * credentials). Responses are intentionally minimal — no version, no
 * commit hash, nothing an attacker could use to fingerprint the deploy.
 */

import { Router } from 'express';
import sequelize from '../db.js';
import { getClock } from '../services/alpaca.js';

const router = Router();
const startedAt = Date.now();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptimeSec: Math.floor((Date.now() - startedAt) / 1000) });
});

router.get('/ready', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'degraded', reason: 'db_unreachable' });
  }
});

/**
 * GET /api/health/alpaca — diagnostic probe for the Alpaca upstream.
 * Answers the "is it me, my keys, or them?" question when the alert
 * evaluator starts logging ECONNRESETs. Uses /v2/clock — the cheapest
 * authenticated call.
 *
 * Status codes:
 *   200 { ok: true, latencyMs, clock }       — keys valid, network healthy
 *   503 { ok: false, reason: 'no_keys'|'network'|'auth_or_upstream', ... }
 *
 * Deliberately unauthenticated so it can be hit from curl/browser when
 * debugging a deploy — but leaks nothing beyond what any failed login
 * would already reveal (Alpaca's own status code + response text).
 */
router.get('/health/alpaca', async (req, res) => {
  const started = Date.now();
  try {
    const clock = await getClock();
    res.json({
      ok: true,
      latencyMs: Date.now() - started,
      clock: { is_open: clock.is_open, timestamp: clock.timestamp },
    });
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = String(err?.message || err);
    if (/not configured/i.test(msg)) {
      return res.status(503).json({ ok: false, reason: 'no_keys', latencyMs, hint: 'Set ALPACA_API_KEY and ALPACA_API_SECRET in .env.' });
    }
    if (/connection failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(msg)) {
      return res.status(503).json({
        ok: false,
        reason: 'network',
        latencyMs,
        error: msg,
        hint: 'Alpaca unreachable from this host. Check firewall/VPN/proxy and whether data.alpaca.markets:443 is permitted.',
      });
    }
    return res.status(503).json({ ok: false, reason: 'auth_or_upstream', latencyMs, error: msg });
  }
});

export default router;
