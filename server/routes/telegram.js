import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { TelegramConfig } from '../models/index.js';
import { startTelegramLoop, stopTelegramLoop, sendTelegramMessage } from '../services/telegramBot.js';
import { BadRequestError, NotFoundError } from '../errors.js';

const router = Router();

function toPublic(row) {
  const j = row.toJSON();
  // Mask the token — first 6 + last 4. Enough for the user to eyeball.
  if (j.botToken) {
    j.botTokenPreview = `${j.botToken.slice(0, 6)}…${j.botToken.slice(-4)}`;
    delete j.botToken;
  }
  return j;
}

router.get('/', asyncHandler(async (req, res) => {
  const row = await TelegramConfig.findOne({ where: { userId: req.userId } });
  res.json(row ? toPublic(row) : { configured: false });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { botToken, chatId } = req.body || {};
  if (!botToken || !/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    throw new BadRequestError('botToken must be in the Telegram format "<digits>:<secret>"');
  }
  if (!chatId || typeof chatId !== 'string' && typeof chatId !== 'number') {
    throw new BadRequestError('chatId required');
  }
  const [row, created] = await TelegramConfig.findOrCreate({
    where: { userId: req.userId },
    defaults: { userId: req.userId, botToken, chatId: String(chatId), active: true },
  });
  if (!created) {
    await row.update({ botToken, chatId: String(chatId), active: true, lastError: null, lastUpdateId: 0 });
  }
  startTelegramLoop(req.userId);
  res.status(created ? 201 : 200).json(toPublic(row));
}));

router.post('/test', asyncHandler(async (req, res) => {
  const row = await TelegramConfig.findOne({ where: { userId: req.userId } });
  if (!row) throw new NotFoundError('Telegram not configured');
  await sendTelegramMessage(req.userId, '*Ping* — your trading bot is online.');
  res.json({ ok: true });
}));

router.delete('/', asyncHandler(async (req, res) => {
  const row = await TelegramConfig.findOne({ where: { userId: req.userId } });
  if (!row) throw new NotFoundError('Telegram not configured');
  stopTelegramLoop(req.userId);
  await row.destroy();
  res.json({ ok: true });
}));

export default router;
