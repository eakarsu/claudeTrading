/**
 * Generic notifier for auto-trader events. Two channels out of the box:
 *   - Slack incoming webhook (set SLACK_WEBHOOK_URL)
 *   - SMTP email via nodemailer-compatible config OR Resend HTTP API (set RESEND_API_KEY)
 *
 * If no channel is configured the functions no-op so calling code never has
 * to branch on "is notifications enabled?".
 *
 * IMPORTANT: never include credentials, full position lists, or account
 * equity in notification bodies — these often land in shared channels.
 */

import { logger } from '../logger.js';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM || 'alerts@claudetrading.local';

export const CHANNELS = {
  slack:   Boolean(SLACK_WEBHOOK_URL),
  discord: Boolean(DISCORD_WEBHOOK_URL),
  email:   Boolean(ALERT_EMAIL_TO && RESEND_API_KEY),
};

async function sendSlack(text, blocks = null) {
  if (!CHANNELS.slack) return false;
  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blocks ? { text, blocks } : { text }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Slack notify failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, 'Slack notify threw');
    return false;
  }
}

async function sendDiscord(text) {
  if (!CHANNELS.discord) return false;
  try {
    // Discord webhooks expect a `content` field (Slack uses `text`). Payload is
    // otherwise identical, so we share the same one-line text as Slack.
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Discord notify failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, 'Discord notify threw');
    return false;
  }
}

async function sendEmail(subject, html) {
  if (!CHANNELS.email) return false;
  return sendEmailTo(ALERT_EMAIL_TO, subject, html);
}

/**
 * Send a transactional email to an arbitrary recipient (e.g. the user who
 * requested a password reset). Only the API key needs to be configured —
 * ALERT_EMAIL_TO is irrelevant here since we're mailing a specific user.
 */
export async function sendEmailTo(to, subject, html) {
  if (!RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ALERT_EMAIL_FROM,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Email send failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, 'Email send threw');
    return false;
  }
}

/**
 * Throttle window per event kind. A volatile session can fire dozens of
 * orderFilled events per minute; without throttling the Slack channel fills
 * with noise and the Resend quota burns. Values are max events-per-window.
 */
const THROTTLE = {
  orderFilled:         { windowMs: 60_000,  max: 10 },
  killSwitchTriggered: { windowMs: 60_000,  max: 1  }, // loud event, never suppress twice in a minute
  started:             { windowMs: 60_000,  max: 3  },
  stopped:             { windowMs: 60_000,  max: 3  },
  raw:                 { windowMs: 60_000,  max: 20 },
};

const throttleBuckets = new Map(); // kind -> number[] of timestamps ms
const suppressed = new Map();      // kind -> count since last flush

/**
 * Returns true if the caller may emit now. Records the emit timestamp and
 * prunes expired entries. Logging a suppression warning happens on the first
 * drop per window so we don't spam logs either.
 */
function shouldEmit(kind) {
  const rule = THROTTLE[kind];
  if (!rule) return true;
  const now = Date.now();
  const cutoff = now - rule.windowMs;
  const hits = (throttleBuckets.get(kind) || []).filter((t) => t > cutoff);
  if (hits.length >= rule.max) {
    const prev = suppressed.get(kind) || 0;
    if (prev === 0) {
      logger.warn({ kind, max: rule.max, windowMs: rule.windowMs }, 'Notifier throttle engaged');
    }
    suppressed.set(kind, prev + 1);
    return false;
  }
  hits.push(now);
  throttleBuckets.set(kind, hits);
  // When a window empties, flush a summary of how many messages were dropped.
  const drops = suppressed.get(kind) || 0;
  if (drops > 0 && hits.length === 1) {
    logger.info({ kind, suppressed: drops }, 'Notifier throttle window reset');
    suppressed.set(kind, 0);
  }
  return true;
}

// Exposed for tests / admin tooling — ignore in normal code paths.
export function _resetNotifierThrottle() {
  throttleBuckets.clear();
  suppressed.clear();
}

/**
 * High-level events fired by the auto-trader. Each accepts an object so
 * call sites remain readable without worrying about arg order.
 */
export const notifier = {
  async orderFilled({ symbol, side, qty, price, strategy, orderClass }) {
    if (!shouldEmit('orderFilled')) return;
    const text = `${side.toUpperCase()} ${qty} ${symbol} @ $${price} (${strategy}${orderClass ? `, ${orderClass}` : ''})`;
    await Promise.all([
      sendSlack(`📈 Filled: ${text}`),
      sendDiscord(`📈 Filled: ${text}`),
      sendEmail(`Auto-trader fill: ${symbol}`, `<p>${text}</p>`),
    ]);
  },
  async killSwitchTriggered({ reason, dailyPnl, consecutiveLosses }) {
    if (!shouldEmit('killSwitchTriggered')) return;
    const text = `🛑 Auto-trader stopped: ${reason}. Daily P&L: $${dailyPnl}. Consecutive losses: ${consecutiveLosses}.`;
    await Promise.all([
      sendSlack(text),
      sendDiscord(text),
      sendEmail('Auto-trader kill switch triggered', `<p>${text}</p>`),
    ]);
  },
  async started({ strategy, symbols, mode }) {
    if (!shouldEmit('started')) return;
    const text = `🚀 Auto-trader started (${mode}): ${strategy} on ${symbols.join(', ')}`;
    await Promise.all([sendSlack(text), sendDiscord(text), sendEmail('Auto-trader started', `<p>${text}</p>`)]);
  },
  async stopped({ reason = 'manual' } = {}) {
    if (!shouldEmit('stopped')) return;
    const text = `⏹ Auto-trader stopped (${reason})`;
    await Promise.all([sendSlack(text), sendDiscord(text), sendEmail('Auto-trader stopped', `<p>${text}</p>`)]);
  },
  // Low-level escape hatch for ad-hoc messages.
  async raw(text) {
    if (!shouldEmit('raw')) return;
    await Promise.all([sendSlack(text), sendDiscord(text), sendEmail('Auto-trader alert', `<p>${text}</p>`)]);
  },
};
