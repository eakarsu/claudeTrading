import { Router } from 'express';
import { STRATEGIES } from '../services/strategyEngine.js';
import { INTRADAY_STRATEGIES } from '../services/intradayStrategies.js';

const router = Router();

const INTRADAY_KEYS = new Set(Object.keys(INTRADAY_STRATEGIES));

router.get('/', (req, res) => {
  const list = Object.entries(STRATEGIES).map(([key, s]) => ({
    key,
    name: s.name,
    description: s.description,
    intraday: INTRADAY_KEYS.has(key),
  }));
  res.json(list);
});

export default router;
