/**
 * Webhook ingress for external strategies (TradingView alert, Python script,
 * Zapier etc.) to create TradeSignal rows without logging in. Each user has
 * a per-user secret (`webhookSecret` on the User row); the payload must be
 * HMAC-SHA256-signed in the `X-Signature` header to authenticate.
 *
 * Flow:
 *   1. User visits Account Settings → Webhooks, gets a URL like
 *        https://…/api/webhooks/in/<userId>
 *      plus their secret (rotatable).
 *   2. External system POSTs JSON:
 *        { symbol, signalType, strategy?, entryPrice?, targetPrice?, stopPrice?,
 *          timeframe?, confidence?, notes? }
 *      with header `X-Signature: sha256=<hex hmac of raw body>`.
 *   3. We verify HMAC, insert TradeSignal, respond 201 with the row id.
 *
 * No auth middleware — the HMAC *is* the auth. A replay window check uses an
 * optional `X-Timestamp` header (reject > 5 min skew) to thwart capture &
 * replay.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { User, TradeSignal } from '../models/index.js';
import { logger } from '../logger.js';
import { z } from 'zod';

const router = Router();

// Use express.raw for this router so we can HMAC the exact bytes the client
// signed. JSON-parse middleware would re-serialize and cause signature drift.
router.use('/in/:userId', (req, res, next) => {
  let buf = Buffer.alloc(0);
  req.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); });
  req.on('end', () => { req.rawBody = buf; next(); });
  req.on('error', next);
});

const signalSchema = z.object({
  symbol: z.string().min(1).max(12),
  signalType: z.enum(['buy', 'sell', 'long', 'short']).default('buy'),
  strategy: z.string().max(64).optional(),
  entryPrice: z.coerce.number().optional(),
  targetPrice: z.coerce.number().optional(),
  stopPrice: z.coerce.number().optional(),
  timeframe: z.string().max(16).optional(),
  confidence: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().max(500).optional(),
});

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

router.post('/in/:userId', async (req, res) => {
  const userId = Number.parseInt(req.params.userId, 10);
  if (!userId) return res.status(400).json({ error: 'bad userId' });

  const user = await User.findByPk(userId).catch(() => null);
  if (!user || !user.webhookSecret) {
    // Don't distinguish between "no such user" and "no secret set" — that
    // leaks account enumeration.
    return res.status(401).json({ error: 'invalid signature' });
  }

  // Optional replay protection.
  const ts = Number.parseInt(req.get('X-Timestamp') || '0', 10);
  if (ts && Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'stale timestamp' });
  }

  const sigHeader = req.get('X-Signature') || '';
  const sig = sigHeader.replace(/^sha256=/, '').trim();
  const raw = req.rawBody || Buffer.alloc(0);
  const expected = crypto.createHmac('sha256', user.webhookSecret).update(raw).digest('hex');
  if (!sig || !constantTimeEqual(sig, expected)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  let body;
  try { body = JSON.parse(raw.toString('utf8') || '{}'); }
  catch { return res.status(400).json({ error: 'invalid json' }); }

  const parsed = signalSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
  }

  try {
    const signal = await TradeSignal.create({
      userId,
      symbol: parsed.data.symbol.toUpperCase(),
      signalType: parsed.data.signalType,
      strategy: parsed.data.strategy || 'webhook',
      entryPrice: parsed.data.entryPrice,
      targetPrice: parsed.data.targetPrice,
      stopPrice: parsed.data.stopPrice,
      timeframe: parsed.data.timeframe,
      confidence: parsed.data.confidence,
      status: 'active',
      aiAnalysis: parsed.data.notes || null,
    });
    res.status(201).json({ id: signal.id, ok: true });
  } catch (err) {
    logger.error({ err, userId }, 'webhook signal insert failed');
    res.status(500).json({ error: 'insert failed' });
  }
});

export default router;
