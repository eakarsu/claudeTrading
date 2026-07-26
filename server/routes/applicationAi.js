import express from 'express';
import { askAI } from '../services/openrouter.js';
import { RuntimeAiResult } from '../models/index.js';
import { asyncHandler } from '../middleware/async.js';

const router = express.Router();

router.post('/trading-risk-review', asyncHandler(async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (prompt.length < 20 || prompt.length > 12000) return res.status(422).json({ error: 'prompt must contain 20 to 12000 characters' });
  const result = await askAI(
    prompt,
    'Provide analysis only. Require deterministic exposure and loss limits, human approval, licensed data provenance, reconciliation and audit evidence. Never place, modify, or cancel a trade.',
    { userId: req.userId },
  );
  if (result.provider !== 'openrouter' || !result.providerReceipt) return res.status(502).json({ error: 'Approved provider receipt is missing' });
  const saved = await RuntimeAiResult.create({ userId: req.userId, prompt, model: result.model, provider: result.provider, providerReceipt: result.providerReceipt, result: result.content, usage: result.usage || {} });
  res.json({ id: saved.id, model: saved.model, result: saved.result, usage: saved.usage });
}));

export default router;
