import crypto from 'node:crypto';
import { WebhookConfig } from '../models/index.js';
import { logger } from '../logger.js';

/**
 * Outbound webhook dispatcher.
 *
 * Fires HTTP POSTs to user-registered URLs when bot events occur (order.filled,
 * order.stopped, etc.). Each delivery is HMAC-signed so the receiver can verify
 * authenticity:
 *
 *   X-Signature: sha256=<hex hmac-sha256 of body using config.secret>
 *   X-Event:     <event name, e.g. "order.filled">
 *   X-Delivery:  <random UUID, useful for idempotency on the receiver>
 *
 * Retries: 3 attempts with 0/1s/4s backoff. After MAX_FAIL_COUNT consecutive
 * failures we auto-disable the config and stamp `lastError` so the user can
 * investigate in the UI.
 *
 * Non-blocking by design — `dispatch()` returns immediately; the actual HTTP
 * calls run on a detached promise. The caller (e.g. auto-trader trade flow)
 * never waits on webhook delivery, so a stuck receiver can't stall trading.
 */

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 1000, 4000];
const MAX_FAIL_COUNT = 10;       // disable after this many consecutive failures
const TIMEOUT_MS = 5000;

export function signPayload(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function deliver(config, event, payload) {
  const body = JSON.stringify({
    event,
    deliveredAt: new Date().toISOString(),
    webhookId: config.id,
    payload,
  });
  const signature = signPayload(config.secret, body);
  const delivery = crypto.randomUUID();

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt]) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Event': event,
          'X-Delivery': delivery,
          'User-Agent': 'claudeTrading-webhook/1.0',
        },
        body,
        signal: ac.signal,
      });
      clearTimeout(t);
      if (res.ok) {
        await config.update({
          lastDeliveryAt: new Date(),
          lastStatus: 'ok',
          lastError: null,
          failCount: 0,
        });
        return { ok: true, status: res.status, attempts: attempt + 1 };
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      clearTimeout(t);
      lastErr = err.name === 'AbortError' ? 'timeout' : (err.message || String(err));
    }
  }

  // All attempts exhausted — record the failure and potentially disable.
  const newFailCount = (config.failCount || 0) + 1;
  const shouldDisable = newFailCount >= MAX_FAIL_COUNT;
  await config.update({
    lastDeliveryAt: new Date(),
    lastStatus: shouldDisable ? 'disabled' : 'error',
    lastError: lastErr,
    failCount: newFailCount,
    ...(shouldDisable ? { active: false } : {}),
  });
  logger.warn(
    { webhookId: config.id, event, err: lastErr, failCount: newFailCount, disabled: shouldDisable },
    'Webhook delivery failed',
  );
  return { ok: false, error: lastErr, attempts: MAX_ATTEMPTS };
}

/**
 * Dispatch an event to every active webhook config whose `events` list
 * includes it (or uses the wildcard '*').
 *
 * Returns a Promise you can ignore in callers — errors are swallowed inside.
 */
export function dispatch(userId, event, payload) {
  // Fire-and-forget. We wrap in an IIFE so the top-level call sites can be
  // plain `dispatch(...)` without needing to await.
  (async () => {
    try {
      const configs = await WebhookConfig.findAll({
        where: { userId, active: true },
      });
      const subscribed = configs.filter((c) => {
        const evts = Array.isArray(c.events) ? c.events : [];
        return evts.includes('*') || evts.includes(event);
      });
      if (!subscribed.length) return;
      // Concurrent delivery — each receiver is independent.
      await Promise.all(subscribed.map((c) =>
        deliver(c, event, payload).catch((err) =>
          logger.warn({ err, webhookId: c.id }, 'deliver() threw unexpectedly'),
        ),
      ));
    } catch (err) {
      logger.warn({ err, userId, event }, 'webhook dispatch failed');
    }
  })();
}

/**
 * Send a synthetic "ping" event to a specific webhook config. Used by the
 * "Test" button in the UI so a user can verify their endpoint works before
 * trading against it.
 */
export async function pingOne(config) {
  return deliver(config, 'ping', {
    message: 'Test delivery from claudeTrading.',
    timestamp: new Date().toISOString(),
  });
}
