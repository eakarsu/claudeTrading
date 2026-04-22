/**
 * Minimal OpenAPI 3.0 document describing the public surface. We hand-author
 * this rather than generating from Zod so we don't add a dependency for a
 * doc file. Keep synced with schemas.js when routes change.
 *
 * Served at GET /api/openapi.json (auth-protected like every other /api/*
 * endpoint). Wire a Swagger UI / Redoc in front of it at your leisure.
 */

import { Router } from 'express';

const router = Router();

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Claude Trading API',
    version: '1.0.0',
    description: 'Internal API for the Claude Trading paper-trading dashboard.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Order: {
        type: 'object',
        required: ['symbol', 'qty', 'side'],
        properties: {
          symbol:         { type: 'string', pattern: '^[A-Z.]{1,6}$' },
          qty:            { type: 'number', minimum: 0 },
          side:           { type: 'string', enum: ['buy', 'sell'] },
          type:           { type: 'string', enum: ['market', 'limit', 'stop', 'stop_limit'] },
          time_in_force:  { type: 'string', enum: ['day', 'gtc', 'opg', 'cls', 'ioc', 'fok'] },
          limit_price:    { type: 'number' },
          stop_price:     { type: 'number' },
        },
      },
      AutoTraderStart: {
        type: 'object',
        required: ['strategy', 'symbols'],
        properties: {
          strategy: { type: 'string' },
          symbols:  { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
          config:   { type: 'object', additionalProperties: true,
            description: 'See autoTraderStartSchema in server/schemas.js for the full field list.' },
        },
      },
      EventCalendarItem: {
        type: 'object',
        properties: {
          id:     { type: 'integer' },
          date:   { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          kind:   { type: 'string', enum: ['fomc', 'cpi', 'nfp', 'pce', 'earnings', 'custom'] },
          symbol: { type: 'string', nullable: true },
          note:   { type: 'string', nullable: true },
          source: { type: 'string', enum: ['static', 'db'] },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/login':    { post: { summary: 'Log in', responses: { 200: { description: 'JWT returned' } }, security: [] } },
    '/auth/register': { post: { summary: 'Register a new user', security: [] } },

    '/alpaca/account':             { get: { summary: 'Get Alpaca account details' } },
    '/alpaca/positions':           { get: { summary: 'List open positions' } },
    '/alpaca/orders': {
      get:  { summary: 'List orders' },
      post: {
        summary: 'Place an order (audited)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
      },
    },
    '/alpaca/orders/{id}': { delete: { summary: 'Cancel an order (audited)' } },

    '/auto-trader/start':  { post: {
      summary: 'Start the auto-trader (audited)',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AutoTraderStart' } } } },
    } },
    '/auto-trader/stop':   { post: { summary: 'Stop the auto-trader (audited)' } },
    '/auto-trader/status': { get:  { summary: 'Current auto-trader status and P&L summary' } },
    '/auto-trader/trades/{id}/tags': {
      patch: { summary: 'Update tags on an auto-trader trade' },
    },
    '/auto-trader/trades/{id}/journal': {
      post:  { summary: 'Copy an auto-trader trade into the Trade Journal' },
    },

    '/backtest/{strategy}/{symbol}': { get: { summary: 'Single-strategy backtest' } },
    '/backtest/all/{symbol}':        { get: { summary: 'Backtest all strategies on a symbol' } },
    '/backtest/multi':               { post: { summary: 'Backtest strategies across multiple symbols' } },
    '/backtest/combo':               { post: { summary: 'Combo (ensemble) backtest' } },
    '/backtest/combo-multi':         { post: { summary: 'Combo backtest across multiple symbols' } },
    '/backtest/monte-carlo':         { post: { summary: 'Monte Carlo robustness check' } },
    '/backtest/optimize':            { post: { summary: 'Grid-search parameter optimizer with OOS split' } },
    '/backtest/regime':              { post: { summary: 'Regime-tagged performance (bull/bear/chop)' } },
    '/backtest/portfolio':           { post: { summary: 'Shared-capital multi-leg portfolio backtest' } },
    '/backtest/benchmark/{symbol}':  { get:  { summary: 'Buy-and-hold benchmark equity curve' } },

    '/event-calendar':      {
      get:  { summary: 'List macro + user events in a date window' },
      post: { summary: 'Add a user event (earnings / custom)' },
    },
    '/event-calendar/{id}': { delete: { summary: 'Remove a user-added event' } },

    '/market-data/hv-rank/{symbol}': { get: { summary: 'Historical volatility rank (0–100) for a symbol' } },
    '/market-data/stream':           { get: { summary: 'Server-Sent Events price tick stream',
      parameters: [{ name: 'symbols', in: 'query', required: true, schema: { type: 'string' } }] } },

    '/audit-log': { get: { summary: 'Read audit log entries (filter by action/resource/userId)' } },

    '/openapi.json': { get: { summary: 'This document', security: [] } },
  },
};

router.get('/openapi.json', (req, res) => res.json(spec));

// Swagger UI. Served as a single HTML page that loads the UI assets from a
// pinned CDN — we don't take a swagger-ui-express dependency for one page.
// The CSP disallows inline eval; Swagger UI works fine under that constraint.
const SWAGGER_UI_VERSION = '5.17.14';
const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Claude Trading API Docs</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" />
<style>body{margin:0;background:#fafafa}</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js" crossorigin></script>
<script>
  window.addEventListener('load', () => {
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout',
    });
  });
</script>
</body>
</html>`;
router.get('/docs', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DOCS_HTML);
});

export default router;
