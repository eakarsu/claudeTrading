/**
 * Position notes — free-form text attached to a symbol (not a specific
 * order). Notes persist across entries/exits so a trader can capture their
 * thesis, invalidation conditions, and post-mortems on a per-symbol basis.
 *
 * Endpoints are per-user-scoped: the caller can only see/edit their own notes.
 */
import { Router } from 'express';
import { z } from 'zod';
import { PositionNote } from '../models/index.js';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { symbolSchema } from '../schemas.js';
import { NotFoundError } from '../errors.js';

const router = Router();
const noteBody = z.object({
  symbol: symbolSchema,
  note:   z.string().min(1).max(4000),
});

router.get('/', asyncHandler(async (req, res) => {
  const where = { userId: req.userId };
  if (req.query.symbol) where.symbol = String(req.query.symbol).toUpperCase();
  const rows = await PositionNote.findAll({ where, order: [['updatedAt', 'DESC']] });
  res.json(rows);
}));

router.post('/', validate({ body: noteBody }), asyncHandler(async (req, res) => {
  const row = await PositionNote.create({
    userId: req.userId,
    symbol: req.body.symbol.toUpperCase(),
    note: req.body.note,
  });
  res.status(201).json(row);
}));

router.put('/:id', validate({ body: z.object({ note: z.string().min(1).max(4000) }) }),
  asyncHandler(async (req, res) => {
    const row = await PositionNote.findOne({ where: { id: req.params.id, userId: req.userId } });
    if (!row) throw new NotFoundError('Note');
    await row.update({ note: req.body.note });
    res.json(row);
  }),
);

router.delete('/:id', asyncHandler(async (req, res) => {
  const n = await PositionNote.destroy({ where: { id: req.params.id, userId: req.userId } });
  if (!n) throw new NotFoundError('Note');
  res.json({ ok: true });
}));

export default router;
