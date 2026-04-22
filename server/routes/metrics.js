/**
 * Prometheus metrics exposition endpoint.
 *
 * Mounted before the auth middleware because Prometheus scrapers authenticate
 * at the network layer (scrape config, ingress ACL) not via JWT. If you need
 * to gate the endpoint, restrict it in your reverse proxy.
 */

import { Router } from 'express';
import { renderMetrics } from '../services/metrics.js';

const router = Router();

router.get('/metrics', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(renderMetrics());
});

export default router;
