import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { migrateV2ToV3 } from '../services/strategyMigrator.js';
import { BadRequestError } from '../errors.js';

const router = Router();

router.post('/v2-to-v3', asyncHandler(async (req, res) => {
  const { source } = req.body || {};
  if (!source || typeof source !== 'string') throw new BadRequestError('source (string) required');
  if (source.length > 500_000) throw new BadRequestError('source too large (max 500KB)');
  res.json(migrateV2ToV3(source));
}));

export default router;
