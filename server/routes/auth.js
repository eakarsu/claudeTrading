import { Router } from 'express';
import bcryptjs from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Op } from 'sequelize';
import { User, RevokedToken, PasswordResetToken } from '../models/index.js';
import { authMiddleware, generateToken, noteRevokedInCache, hashToken } from '../middleware/auth.js';
import { recordSession, revokeSession, listSessions } from '../services/sessions.js';
import { idParam } from '../schemas.js';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import {
  loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema,
  totpEnrollVerifySchema, totpLoginSchema, changePasswordSchema, deleteAccountSchema,
} from '../schemas.js';
import { sendEmailTo } from '../services/notifier.js';
import { logger } from '../logger.js';
import {
  generateTotpSecret, buildOtpauthUrl, verifyTotp,
  generateBackupCodes, hashBackupCodes, consumeBackupCode,
} from '../services/totp.js';
import {
  BadRequestError, ConflictError, ForbiddenError,
  TooManyRequestsError, UnauthorizedError,
} from '../errors.js';
import { audit } from '../middleware/audit.js';

const JWT_SECRET = process.env.JWT_SECRET;
const TOTP_ISSUER = process.env.TOTP_ISSUER || 'claudeTrading';
// Short-lived challenge token used between /login and /verify-totp. Separate
// audience claim so it can't be presented on regular authed routes.
const CHALLENGE_TTL = '5m';
const CHALLENGE_AUD = '2fa-challenge';

function signChallenge(userId) {
  return jwt.sign({ userId, aud: CHALLENGE_AUD }, JWT_SECRET, { expiresIn: CHALLENGE_TTL });
}
function verifyChallenge(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.aud !== CHALLENGE_AUD) return null;
    return decoded.userId;
  } catch {
    return null;
  }
}

const router = Router();

// Minimal IP-based rate limiter for /register. Prevents a single IP from
// enumerating the signup endpoint or flooding bcrypt hashes. Sliding-window
// in-memory store is fine for a single-process deployment; swap for Redis if
// we ever scale horizontally.
const REGISTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const REGISTER_MAX = 3;
const registerHits = new Map(); // ip -> number[] (timestamps ms)

// Login rate limiter — mirrors checkRegisterRate but with a tighter cap to slow
// down password-spray attacks. Keyed by IP; acceptable for single-process use.
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX = 10;
const loginHits = new Map();

function checkLoginRate(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const cutoff = now - LOGIN_WINDOW_MS;
  const prev = (loginHits.get(ip) || []).filter((t) => t > cutoff);
  if (prev.length >= LOGIN_MAX) {
    const retryInMin = Math.ceil((prev[0] + LOGIN_WINDOW_MS - now) / 60_000);
    throw new TooManyRequestsError(`Too many login attempts. Try again in ${retryInMin}m.`);
  }
  prev.push(now);
  loginHits.set(ip, prev);
  if (loginHits.size > 10_000) {
    for (const [k, v] of loginHits) {
      const kept = v.filter((t) => t > cutoff);
      if (!kept.length) loginHits.delete(k);
      else loginHits.set(k, kept);
    }
  }
}

// Decode the token we just minted so we can stamp a Session row with the real
// expiresAt from the JWT payload (matches what the revocation blocklist uses).
function sessionExpiryFromToken(token) {
  try {
    const exp = jwt.verify(token, JWT_SECRET).exp;
    if (exp) return new Date(exp * 1000);
  } catch { /* ignore — fall through */ }
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

async function stampSession(req, token, userId) {
  await recordSession({
    userId,
    tokenHash: hashToken(token),
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.socket?.remoteAddress,
    expiresAt: sessionExpiryFromToken(token),
  }).catch(() => null);
}

function checkRegisterRate(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const cutoff = now - REGISTER_WINDOW_MS;
  const prev = (registerHits.get(ip) || []).filter((t) => t > cutoff);
  if (prev.length >= REGISTER_MAX) {
    const retryInMin = Math.ceil((prev[0] + REGISTER_WINDOW_MS - now) / 60_000);
    throw new TooManyRequestsError(`Too many register attempts. Try again in ${retryInMin}m.`);
  }
  prev.push(now);
  registerHits.set(ip, prev);
  // Periodic cleanup — drop empty entries so the map doesn't grow unbounded.
  if (registerHits.size > 10_000) {
    for (const [k, v] of registerHits) {
      const kept = v.filter((t) => t > cutoff);
      if (!kept.length) registerHits.delete(k);
      else registerHits.set(k, kept);
    }
  }
}

router.post('/login', audit('auth.login', 'user'), validate({ body: loginSchema }), asyncHandler(async (req, res) => {
  checkLoginRate(req);
  const { email, password } = req.body;
  const user = await User.findOne({ where: { email } });
  if (!user) throw new UnauthorizedError('Invalid credentials');
  const valid = await bcryptjs.compare(password, user.password);
  if (!valid) throw new UnauthorizedError('Invalid credentials');

  // If 2FA is enabled, don't issue a full session JWT yet. Return a short-lived
  // challenge token; the client posts it with the TOTP code to /verify-totp.
  if (user.totpEnabled && user.totpSecret) {
    return res.json({ requires2FA: true, challenge: signChallenge(user.id) });
  }

  const token = generateToken(user.id);
  await stampSession(req, token, user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
}));

/**
 * POST /api/auth/verify-totp
 * Completes a 2FA login. Accepts a 6-digit TOTP OR a backup code. Backup-code
 * use mutates the stored hash list so a code cannot be reused.
 */
router.post('/verify-totp', audit('auth.verify-totp', 'user'), validate({ body: totpLoginSchema }), asyncHandler(async (req, res) => {
  const { challenge, code } = req.body;
  const userId = verifyChallenge(challenge);
  if (!userId) throw new UnauthorizedError('Invalid or expired challenge');

  const user = await User.findByPk(userId);
  if (!user || !user.totpEnabled || !user.totpSecret) {
    throw new UnauthorizedError('2FA not configured');
  }

  // 6-digit TOTP path.
  if (/^\d{6}$/.test(code)) {
    if (!verifyTotp(user.totpSecret, code)) {
      throw new UnauthorizedError('Invalid 2FA code');
    }
  } else {
    // Backup-code path. consumeBackupCode returns the updated (null-punched)
    // hash array, or null if the code didn't match any unused hash.
    const next = await consumeBackupCode(user.totpBackupCodes || [], code);
    if (!next) throw new UnauthorizedError('Invalid backup code');
    await user.update({ totpBackupCodes: next });
  }

  const token = generateToken(user.id);
  await stampSession(req, token, user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
}));

router.post('/register', audit('auth.register', 'user'), validate({ body: registerSchema }), asyncHandler(async (req, res) => {
  if (process.env.ALLOW_REGISTRATION === 'false') {
    throw new ForbiddenError('Registration is disabled');
  }
  checkRegisterRate(req);
  const { email, password, name } = req.body;
  const existing = await User.findOne({ where: { email } });
  if (existing) throw new ConflictError('Email already registered');

  const hashed = await bcryptjs.hash(password, 10);
  const user = await User.create({ email, password: hashed, name });
  const token = generateToken(user.id);
  await stampSession(req, token, user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
}));

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/auth/forgot
 * Always returns 200 with a generic response — we never reveal whether an
 * email is registered (enumeration defense). If the email matches a user we
 * create a one-shot token, store its hash, and mail the raw token.
 */
router.post('/forgot', validate({ body: forgotPasswordSchema }), asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ where: { email } });
  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await PasswordResetToken.create({ tokenHash, userId: user.id, expiresAt });

    const clientOrigin = (process.env.CORS_ORIGIN?.split(',')[0] || '').trim()
      || `http://localhost:${process.env.CLIENT_PORT || 5173}`;
    const resetUrl = `${clientOrigin}/reset-password?token=${rawToken}`;
    const html = `
      <p>Hi ${user.name || 'trader'},</p>
      <p>You requested a password reset. This link expires in 30 minutes:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you didn't request this, ignore this email — your password is unchanged.</p>
    `;
    // Fire-and-forget: we must not leak whether delivery succeeded to the caller.
    sendEmailTo(user.email, 'Reset your claudeTrading password', html).catch((err) =>
      logger.warn({ err, userId: user.id }, 'Password reset email failed'),
    );
  }
  res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
}));

/**
 * POST /api/auth/reset
 * Consumes a reset token and sets a new password. The token is invalidated
 * after use. We also revoke any currently-valid sessions by inserting the
 * resetting user's outstanding tokens... we cannot enumerate them, so instead
 * we clear all reset tokens for this user and recommend the client logs the
 * user in fresh.
 */
router.post('/reset', validate({ body: resetPasswordSchema }), asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = await PasswordResetToken.findOne({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { [Op.gt]: new Date() },
    },
  });
  if (!row) throw new UnauthorizedError('Invalid or expired reset token');

  const user = await User.findByPk(row.userId);
  if (!user) throw new UnauthorizedError('Invalid or expired reset token');

  const hashed = await bcryptjs.hash(password, 10);
  await user.update({ password: hashed });
  await row.update({ usedAt: new Date() });

  // Burn every other outstanding reset token for this user so a second link
  // sent earlier can't still be redeemed after the password changes.
  await PasswordResetToken.update(
    { usedAt: new Date() },
    { where: { userId: user.id, usedAt: null } },
  );

  res.json({ success: true });
}));

/**
 * POST /api/auth/2fa/enroll
 * Starts TOTP enrollment. Generates (or reuses) a pending secret and returns
 * the otpauth URL. The client renders it as a QR and posts a code back to
 * /2fa/verify to finalize. Enrollment is NOT active until /verify succeeds —
 * totpEnabled remains false until then so the user can't lock themselves out.
 */
router.post('/2fa/enroll', authMiddleware, audit('auth.2fa.enroll', 'user'), asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.userId);
  if (!user) throw new UnauthorizedError('Invalid session');
  if (user.totpEnabled) throw new ConflictError('2FA already enabled');

  // If there's already a pending secret, return it so re-opening the page
  // doesn't invalidate a QR the user already scanned.
  const secret = user.totpSecret || generateTotpSecret();
  if (!user.totpSecret) await user.update({ totpSecret: secret });

  const otpauthUrl = buildOtpauthUrl({
    issuer: TOTP_ISSUER,
    account: user.email,
    secret,
  });
  res.json({ secret, otpauthUrl });
}));

/**
 * POST /api/auth/2fa/verify
 * Finalizes enrollment. Client submits a 6-digit code generated from the
 * secret returned by /enroll. On success we flip totpEnabled=true and hand
 * back freshly-generated backup codes (plain text — shown once, never again).
 */
router.post(
  '/2fa/verify',
  authMiddleware,
  audit('auth.2fa.verify', 'user'),
  validate({ body: totpEnrollVerifySchema }),
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.userId);
    if (!user) throw new UnauthorizedError('Invalid session');
    if (user.totpEnabled) throw new ConflictError('2FA already enabled');
    if (!user.totpSecret) throw new BadRequestError('Call /2fa/enroll first');

    if (!verifyTotp(user.totpSecret, req.body.code)) {
      throw new UnauthorizedError('Invalid 2FA code');
    }

    const backupCodes = generateBackupCodes(10);
    const hashed = await hashBackupCodes(backupCodes);
    await user.update({ totpEnabled: true, totpBackupCodes: hashed });

    // Return plain codes exactly once — the client must tell the user to save them.
    res.json({ success: true, backupCodes });
  }),
);

/**
 * POST /api/auth/2fa/disable
 * Requires the user's password AND a current TOTP code (or backup code).
 * Clears the secret and backup codes so the account is unprotected by 2FA.
 */
router.post(
  '/2fa/disable',
  authMiddleware,
  audit('auth.2fa.disable', 'user'),
  validate({
    body: z.object({
      password: z.string().min(1),
      code: z.string().regex(/^(\d{6}|[a-f0-9]{6}-[a-f0-9]{6})$/),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { password, code } = req.body;
    const user = await User.findByPk(req.userId);
    if (!user || !user.totpEnabled) throw new BadRequestError('2FA is not enabled');

    const validPw = await bcryptjs.compare(password, user.password);
    if (!validPw) throw new UnauthorizedError('Invalid password');

    let ok = false;
    if (/^\d{6}$/.test(code)) {
      ok = verifyTotp(user.totpSecret, code);
    } else {
      const next = await consumeBackupCode(user.totpBackupCodes || [], code);
      if (next) {
        await user.update({ totpBackupCodes: next });
        ok = true;
      }
    }
    if (!ok) throw new UnauthorizedError('Invalid 2FA code');

    await user.update({ totpEnabled: false, totpSecret: null, totpBackupCodes: [] });
    res.json({ success: true });
  }),
);

/**
 * POST /api/auth/2fa/backup-codes/regenerate
 * Regenerates a fresh batch of 10 one-shot backup codes and invalidates the
 * prior set. Requires the user's password *and* a valid current TOTP (or
 * backup code) so a stolen session alone can't lift the codes. The plain
 * codes are returned exactly once.
 */
router.post(
  '/2fa/backup-codes/regenerate',
  authMiddleware,
  audit('auth.2fa.backup-codes.regenerate', 'user'),
  validate({
    body: z.object({
      password: z.string().min(1),
      code: z.string().regex(/^(\d{6}|[a-f0-9]{6}-[a-f0-9]{6})$/),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.userId);
    if (!user || !user.totpEnabled) throw new BadRequestError('2FA is not enabled');

    const validPw = await bcryptjs.compare(req.body.password, user.password);
    if (!validPw) throw new UnauthorizedError('Invalid password');

    let ok = false;
    if (/^\d{6}$/.test(req.body.code)) {
      ok = verifyTotp(user.totpSecret, req.body.code);
    } else {
      const next = await consumeBackupCode(user.totpBackupCodes || [], req.body.code);
      if (next) ok = true; // consumed below along with the fresh batch
    }
    if (!ok) throw new UnauthorizedError('Invalid 2FA code');

    const backupCodes = generateBackupCodes(10);
    const hashed = await hashBackupCodes(backupCodes);
    await user.update({ totpBackupCodes: hashed });
    res.json({ success: true, backupCodes });
  }),
);

/**
 * GET  /api/auth/webhook-secret      → { hasSecret, ingressUrl }
 * POST /api/auth/webhook-secret      → { secret, ingressUrl } (rotates)
 * DELETE /api/auth/webhook-secret    → { ok: true } (disables ingress)
 *
 * The *plain* secret is returned exactly once on rotation. We store it
 * verbatim (not hashed) because HMAC verification needs the raw value on
 * each incoming request — there's no way around this.
 */
router.get('/webhook-secret', authMiddleware, asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.userId, { attributes: ['webhookSecret'] });
  res.json({
    hasSecret: Boolean(user?.webhookSecret),
    ingressUrl: `/api/webhooks/in/${req.userId}`,
  });
}));
router.post('/webhook-secret', authMiddleware, audit('auth.webhook-secret.rotate', 'user'),
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.userId);
    if (!user) throw new UnauthorizedError('Invalid session');
    // 32 random bytes = 256-bit secret; hex so it copies cleanly.
    const { randomBytes } = await import('node:crypto');
    const secret = randomBytes(32).toString('hex');
    await user.update({ webhookSecret: secret });
    res.json({ secret, ingressUrl: `/api/webhooks/in/${req.userId}` });
  }),
);
router.delete('/webhook-secret', authMiddleware, audit('auth.webhook-secret.delete', 'user'),
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.userId);
    if (!user) throw new UnauthorizedError('Invalid session');
    await user.update({ webhookSecret: null });
    res.json({ ok: true });
  }),
);

/**
 * POST /api/auth/change-password
 * Authed; requires the current password as a proof-of-possession check.
 */
router.post(
  '/change-password',
  authMiddleware,
  audit('auth.change-password', 'user'),
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findByPk(req.userId);
    if (!user) throw new UnauthorizedError('Invalid session');

    const valid = await bcryptjs.compare(currentPassword, user.password);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');

    const hashed = await bcryptjs.hash(newPassword, 10);
    await user.update({ password: hashed });

    // Best-effort: revoke any outstanding password-reset tokens so an old
    // forgot-password link can't be redeemed after the password changes.
    await PasswordResetToken.update(
      { usedAt: new Date() },
      { where: { userId: user.id, usedAt: null } },
    ).catch(() => null);

    res.json({ success: true });
  }),
);

/**
 * POST /api/auth/delete-account
 * Destructive — removes the user row. Requires password AND the literal string
 * "DELETE" in the body to reduce accident risk. Per-user data cascades via
 * FK constraints on the child tables (see migration 0002).
 */
router.post(
  '/delete-account',
  authMiddleware,
  audit('auth.delete-account', 'user'),
  validate({ body: deleteAccountSchema }),
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.userId);
    if (!user) throw new UnauthorizedError('Invalid session');

    const valid = await bcryptjs.compare(req.body.password, user.password);
    if (!valid) throw new UnauthorizedError('Invalid password');

    // Revoke the current token so the client session is immediately invalid.
    const expMs = (req.authExp || 0) * 1000;
    const expiresAt = new Date(expMs > Date.now() ? expMs : Date.now() + 7 * 24 * 60 * 60 * 1000);
    await RevokedToken.findOrCreate({
      where: { tokenHash: req.authTokenHash },
      defaults: { tokenHash: req.authTokenHash, userId: user.id, expiresAt },
    }).catch(() => null);
    noteRevokedInCache(req.authTokenHash, expiresAt.getTime());

    await user.destroy();
    res.json({ success: true });
  }),
);

/**
 * GET /api/auth/me
 * Returns the current user's profile and 2FA status. Cheap call used by the
 * client on boot so it can know whether to show "Enable 2FA" or "Disable 2FA".
 */
router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.userId);
  if (!user) throw new UnauthorizedError('Invalid session');
  const backupCodesRemaining = (user.totpBackupCodes || []).filter(Boolean).length;
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    totpEnabled: !!user.totpEnabled,
    backupCodesRemaining,
  });
}));

/**
 * POST /api/auth/logout
 * Server-side token revocation. We hash the presented JWT and insert it into
 * the blocklist; the auth middleware rejects any subsequent presentation of
 * the same token. The blocklist entry expires with the token.
 */
router.post('/logout', authMiddleware, audit('auth.logout', 'user'), asyncHandler(async (req, res) => {
  const expMs = (req.authExp || 0) * 1000;
  // Edge case: token with no exp — fall back to +7d so we don't keep entries
  // forever and don't release the token immediately either.
  const expiresAt = new Date(expMs > Date.now() ? expMs : Date.now() + 7 * 24 * 60 * 60 * 1000);
  await RevokedToken.findOrCreate({
    where: { tokenHash: req.authTokenHash },
    defaults: { tokenHash: req.authTokenHash, userId: req.userId, expiresAt },
  }).catch(() => null);
  noteRevokedInCache(req.authTokenHash, expiresAt.getTime());
  // Best-effort: drop the Session row so Account → Sessions stops listing it.
  const { Session } = await import('../models/index.js');
  await Session.destroy({ where: { tokenHash: req.authTokenHash } }).catch(() => null);
  res.json({ success: true });
}));

/**
 * GET /api/auth/sessions
 * Lists active sessions for the signed-in user. Current session is flagged so
 * the UI can render "this device" differently and prevent accidental self-kill.
 */
router.get('/sessions', authMiddleware, asyncHandler(async (req, res) => {
  const rows = await listSessions(req.userId);
  res.json(rows.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    ip: s.ip,
    lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt,
    current: s.tokenHash === req.authTokenHash,
  })));
}));

/**
 * DELETE /api/auth/sessions/:id
 * Kill a single session. Adds its tokenHash to the revocation blocklist so the
 * auth middleware rejects that token on its next request.
 */
router.delete(
  '/sessions/:id',
  authMiddleware,
  audit('auth.session.revoke', 'session'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const ok = await revokeSession({ userId: req.userId, sessionId: req.params.id });
    if (!ok) throw new UnauthorizedError('Session not found');
    res.json({ success: true });
  }),
);

export default router;

