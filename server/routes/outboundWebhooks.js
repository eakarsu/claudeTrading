import { Router } from 'express';
import crypto from 'node:crypto';
import { asyncHandler } from '../middleware/async.js';
import { WebhookConfig } from '../models/index.js';
import { pingOne } from '../services/webhookDispatcher.js';
import { NotFoundError, BadRequestError } from '../errors.js';

/**
 * Outbound webhook configuration CRUD.
 *
 * Users register a URL + event subscription here; the dispatcher posts signed
 * events to the URL when the auto-trader produces a matching event.
 *
 * Secret handling: generated server-side on create (32 random bytes hex). The
 * secret is returned *once* in the POST response so the user can copy it into
 * their receiver's verification code; subsequent GETs return a masked preview.
 */

const router = Router();

const ALLOWED_EVENTS = [
  'order.filled',   // any auto-trader buy/sell fill
  'order.stopped',  // stop-loss / trailing-stop trigger
  'order.flatten',  // kill-switch / flatten-on-close liquidation
  'auto-trader.started',
  'auto-trader.stopped',
  '*',              // subscribe to everything
];

function toPublic(row) {
  // Never leak the raw secret on read. Show only the first 4 chars so users
  // can eyeball whether they have the right key locally.
  const j = row.toJSON();
  j.secretPreview = j.secret ? `${j.secret.slice(0, 4)}…` : null;
  delete j.secret;
  return j;
}

function validate(body) {
  if (!body || typeof body !== 'object') throw new BadRequestError('Body required');
  if (!body.name || typeof body.name !== 'string' || body.name.length > 80) {
    throw new BadRequestError('name (≤80 chars) required');
  }
  if (!body.url || typeof body.url !== 'string') {
    throw new BadRequestError('url required');
  }
  try {
    const u = new URL(body.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('non-http(s) protocol');
  } catch {
    throw new BadRequestError('url must be a valid http(s) URL');
  }
  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) throw new BadRequestError('events[] must be non-empty');
  const bad = events.filter((e) => !ALLOWED_EVENTS.includes(e));
  if (bad.length) throw new BadRequestError(`unknown events: ${bad.join(', ')}`);
  return { name: body.name.trim(), url: body.url, events };
}

router.get('/', asyncHandler(async (req, res) => {
  const rows = await WebhookConfig.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
  });
  res.json({ items: rows.map(toPublic) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const clean = validate(req.body);
  const secret = crypto.randomBytes(32).toString('hex');
  const row = await WebhookConfig.create({
    userId: req.userId,
    name: clean.name,
    url: clean.url,
    events: clean.events,
    secret,
    active: true,
  });
  // Return the raw secret ONCE on creation. After this, only the preview is
  // readable — the user must re-rotate to see it again.
  const pub = toPublic(row);
  pub.secret = secret;
  res.status(201).json(pub);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const row = await WebhookConfig.findOne({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!row) throw new NotFoundError('Webhook not found');
  const clean = validate(req.body);
  await row.update({
    name: clean.name,
    url: clean.url,
    events: clean.events,
    // Re-enable on edit so fixing a URL clears the auto-disabled state.
    active: req.body.active !== false,
    failCount: 0,
    lastError: null,
  });
  res.json(toPublic(row));
}));

// Rotate the HMAC secret. The new value is returned once; the old one stops
// working immediately. Use case: suspected secret leak.
router.post('/:id/rotate-secret', asyncHandler(async (req, res) => {
  const row = await WebhookConfig.findOne({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!row) throw new NotFoundError('Webhook not found');
  const secret = crypto.randomBytes(32).toString('hex');
  await row.update({ secret });
  const pub = toPublic(row);
  pub.secret = secret;
  res.json(pub);
}));

// Send a test "ping" event so the user can verify their endpoint end-to-end.
router.post('/:id/test', asyncHandler(async (req, res) => {
  const row = await WebhookConfig.findOne({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!row) throw new NotFoundError('Webhook not found');
  const result = await pingOne(row);
  res.json(result);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const row = await WebhookConfig.findOne({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!row) throw new NotFoundError('Webhook not found');
  await row.destroy();
  res.json({ ok: true });
}));

export default router;
