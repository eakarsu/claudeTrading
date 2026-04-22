/**
 * Notifications service — writes to the in-app feed (the Notifications table)
 * and, when configured, fans out to external channels via notifier.js.
 *
 * Keep the shape small: `type` drives an icon/color in the UI, `title` is the
 * single-line summary, `body` is optional multi-line detail, `link` is a
 * relative app path the bell can deep-link to.
 */

import { Notification } from '../models/index.js';
import { notifier } from './notifier.js';
import { logger as appLogger } from '../logger.js';

const VALID_TYPES = new Set(['price-alert', 'auto-trader', 'security', 'info']);

/**
 * Create an in-app notification. `externalFanout=false` skips Slack/Discord
 * (useful for noisy events we only want surfaced inside the app).
 */
export async function createNotification({ userId, type, title, body, link, externalFanout = true }) {
  if (!userId || !type || !title) {
    appLogger.warn({ userId, type, title }, 'createNotification: missing required fields');
    return null;
  }
  if (!VALID_TYPES.has(type)) {
    appLogger.warn({ type }, 'createNotification: unknown type, falling back to "info"');
    type = 'info';
  }
  try {
    const row = await Notification.create({ userId, type, title, body: body || null, link: link || null });
    if (externalFanout) {
      // Best-effort external dispatch. notifier already swallows failures.
      notifier.raw(`${title}${body ? `\n${body}` : ''}`).catch(() => {});
    }
    return row;
  } catch (err) {
    appLogger.warn({ err, type, title }, 'createNotification: DB write failed');
    return null;
  }
}
