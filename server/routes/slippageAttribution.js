import express from 'express';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    feature: 'Slippage Attribution',
    summary: { avgSlippageBps: 18.6, affectedTrades: 23, venueDrift: 'High', recoveryOpportunity: 740 },
    buckets: [
      { cause: 'Spread expansion', trades: 9, bps: 22.1, action: 'Avoid first five minutes after signal' },
      { cause: 'Market impact', trades: 6, bps: 17.4, action: 'Slice orders above liquidity threshold' },
      { cause: 'Latency', trades: 8, bps: 13.2, action: 'Route time-sensitive entries to faster venue' },
    ],
    controls: [
      'Compare expected fill against actual execution at order acknowledgement time.',
      'Disable strategy deployment when trailing seven-day slippage exceeds 25 bps.',
      'Tag slippage by strategy, pair, venue, session, and order type.',
    ],
  });
});

export default router;
