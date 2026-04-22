/**
 * Session tracking helpers.
 *
 * Record-keeping for active JWTs so users can see/kill individual sessions.
 * Works alongside the RevokedTokens blocklist: when a session is killed, we
 * delete its row here AND add an entry there, so the auth middleware rejects
 * the token on its next request.
 */

import crypto from 'node:crypto';
import { Op } from 'sequelize';
import { Session, RevokedToken } from '../models/index.js';
import { noteRevokedInCache } from '../middleware/auth.js';
import { logger } from '../logger.js';

/** Update or insert the session row for this token. Cheap idempotent upsert. */
export async function recordSession({ userId, tokenHash, userAgent, ip, expiresAt }) {
  try {
    const now = new Date();
    const [row, created] = await Session.findOrCreate({
      where: { tokenHash },
      defaults: {
        userId, tokenHash,
        userAgent: (userAgent || '').slice(0, 256) || null,
        ip: (ip || '').slice(0, 45) || null,
        lastSeenAt: now,
        expiresAt,
      },
    });
    if (!created) {
      // Touch only lastSeenAt — we don't overwrite UA/IP on every request.
      await row.update({ lastSeenAt: now });
    }
    return row;
  } catch (err) {
    logger.warn({ err }, 'recordSession failed');
    return null;
  }
}

// Simple in-process throttle so we don't write a Session.lastSeenAt on every
// request — once per minute per token is plenty for the UI.
const lastTouched = new Map(); // tokenHash -> ms
const TOUCH_INTERVAL_MS = 60_000;

export async function touchSession(tokenHash) {
  if (!tokenHash) return;
  const last = lastTouched.get(tokenHash) || 0;
  const now = Date.now();
  if (now - last < TOUCH_INTERVAL_MS) return;
  lastTouched.set(tokenHash, now);
  try {
    await Session.update({ lastSeenAt: new Date() }, { where: { tokenHash } });
  } catch { /* best-effort */ }
  if (lastTouched.size > 5000) {
    // Evict stale entries — anything older than 10 minutes can't be under-throttled.
    const cutoff = now - 10 * TOUCH_INTERVAL_MS;
    for (const [k, v] of lastTouched) if (v < cutoff) lastTouched.delete(k);
  }
}

/** Revoke a single session (user-initiated from the Account page). */
export async function revokeSession({ userId, sessionId }) {
  const row = await Session.findOne({ where: { id: sessionId, userId } });
  if (!row) return false;
  await RevokedToken.findOrCreate({
    where: { tokenHash: row.tokenHash },
    defaults: { tokenHash: row.tokenHash, userId, expiresAt: row.expiresAt },
  }).catch(() => null);
  noteRevokedInCache(row.tokenHash, new Date(row.expiresAt).getTime());
  await row.destroy();
  return true;
}

export async function pruneExpiredSessions() {
  try {
    await Session.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });
  } catch { /* best-effort */ }
}

/** Convenience — list sessions for a user, newest-touched first. */
export function listSessions(userId) {
  return Session.findAll({
    where: { userId },
    order: [['lastSeenAt', 'DESC']],
  });
}

// Re-exported for callers that want to compute hashes the same way as auth.
export function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
