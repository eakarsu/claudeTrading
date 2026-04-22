import '../env.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { RevokedToken } from '../models/index.js';
import { Op } from 'sequelize';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Refusing to start with an insecure default.');
}

/** SHA-256 of a raw JWT — used as the blocklist key so we never store tokens. */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Cache the hashes of recently-revoked tokens so the hot path on authed
// requests avoids a DB round-trip per request. Entries auto-expire after
// REVOKE_CACHE_TTL_MS. A miss still falls through to a DB check — we only
// short-circuit on cached *positive* hits (token is revoked).
const revokedCache = new Map(); // tokenHash -> expiresAt (ms)
const REVOKE_CACHE_TTL_MS = 60_000;

export function noteRevokedInCache(tokenHash, expiresAtMs) {
  revokedCache.set(tokenHash, expiresAtMs);
  // Cheap prune — drop entries past their exp every time the map grows.
  if (revokedCache.size > 1000) {
    const now = Date.now();
    for (const [k, exp] of revokedCache) {
      if (exp < now) revokedCache.delete(k);
    }
  }
}

async function isTokenRevoked(tokenHash) {
  const cached = revokedCache.get(tokenHash);
  if (cached != null) {
    if (cached > Date.now()) return true;
    revokedCache.delete(tokenHash);
  }
  const row = await RevokedToken.findOne({ where: { tokenHash } }).catch(() => null);
  if (!row) return false;
  noteRevokedInCache(tokenHash, new Date(row.expiresAt).getTime());
  return true;
}

export async function authMiddleware(req, res, next) {
  // EventSource does not support Authorization headers, so GET requests for
  // the SSE stream endpoint may pass `?token=...`. We only honor the query
  // fallback on that path to avoid leaking tokens into generic request logs.
  const headerToken = req.headers.authorization?.replace('Bearer ', '');
  const allowQueryToken = req.method === 'GET' && req.path === '/market-data/stream';
  const token = headerToken || (allowQueryToken ? req.query.token : null);
  if (!token) return res.status(401).json({ error: 'No token provided' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const tokenHash = hashToken(token);
  if (await isTokenRevoked(tokenHash)) {
    return res.status(401).json({ error: 'Token revoked' });
  }

  req.userId = decoded.userId;
  req.authToken = token;        // routes can revoke "this" token on logout
  req.authTokenHash = tokenHash;
  req.authExp = decoded.exp;

  // Throttled session.lastSeenAt update so the Account → Sessions view stays
  // fresh without writing on every request. Imported lazily to avoid circular
  // deps between auth middleware and the Session model bootstrapping.
  import('../services/sessions.js').then(({ touchSession }) => {
    touchSession(tokenHash).catch(() => {});
  }).catch(() => {});

  next();
}

export function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

/**
 * Periodic sweep of expired blocklist entries. Called from server startup.
 * Safe to invoke repeatedly; the DB query is cheap because expiresAt is indexed.
 */
export async function pruneRevokedTokens() {
  try {
    await RevokedToken.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });
  } catch {
    /* swallow — pruning is best-effort */
  }
}
