import './env.js';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import sequelize from './db.js';
import { logger } from './logger.js';
import { authMiddleware, pruneRevokedTokens } from './middleware/auth.js';
import { authLimiter, aiLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import {
  TrailingStop, CopyTrade, WheelStrategy, WatchlistItem,
  TradeJournal, PriceAlert, TradeSignal, StockScreener,
  RiskAssessment, PortfolioItem, Sentiment, OptionsChain, MarketNews,
} from './models/index.js';

import authRoutes from './routes/auth.js';
import aiRoutes from './routes/ai.js';
import alpacaRoutes from './routes/alpaca.js';
import autoTraderRoutes from './routes/autoTrader.js';
import backtestRoutes from './routes/backtest.js';
import chartDataRoutes from './routes/chartData.js';
import eventCalendarRoutes from './routes/eventCalendar.js';
import marketDataRoutes from './routes/marketData.js';
import auditLogRoutes from './routes/auditLog.js';
import healthRoutes from './routes/health.js';
import metricsRoutes from './routes/metrics.js';
import openapiRoutes from './routes/openapi.js';
import { createCrudRouter } from './routes/crud.js';
import signalsRoutes from './routes/signals.js';
import strategiesRoutes from './routes/strategies.js';
import notificationsRoutes from './routes/notifications.js';
import performanceRoutes from './routes/performance.js';
import webhookRoutes from './routes/webhooks.js';
import marketNewsRoutes from './routes/marketNews.js';
import themesRoutes from './routes/themes.js';
import docsRoutes from './routes/docs.js';
import hyperoptRoutes from './routes/hyperopt.js';
import outboundWebhookRoutes from './routes/outboundWebhooks.js';
import strategyAnalysisRoutes from './routes/strategyAnalysis.js';
import protectionsRoutes from './routes/protections.js';
import edgeRoutes from './routes/edge.js';
import pairlistRoutes from './routes/pairlists.js';
import freqaiLiteRoutes from './routes/freqaiLite.js';
import telegramRoutes from './routes/telegram.js';
import savedBacktestRoutes from './routes/savedBacktests.js';
import producerConsumerRoutes from './routes/producerConsumer.js';
import plotsRoutes from './routes/plots.js';
import freqtradeApiRoutes from './routes/freqtradeApi.js';
import strategyMigratorRoutes from './routes/strategyMigrator.js';
import exchangeRoutes from './routes/exchanges.js';
import userStrategyRoutes from './routes/userStrategies.js';
import leverageRoutes from './routes/leverage.js';
import backtestAnalysisRoutes from './routes/backtestAnalysis.js';
import utilRoutes from './routes/util.js';
import hyperoptAdvancedRoutes from './routes/hyperoptAdvanced.js';
import orderflowRoutes from './routes/orderflow.js';
import rlLiteRoutes from './routes/rlLite.js';
import jupyterRoutes from './routes/jupyter.js';
import freqaiSidecarRoutes from './routes/freqaiSidecar.js';

import { resourcePrompts } from './prompts/resourceAnalysis.js';
import { resumeAutoTraderIfRunning, stopAllAutoTraders } from './services/autoTrader.js';
import { startAlertEvaluator, stopAlertEvaluator } from './services/alertEvaluator.js';
import { startDocsScheduler, stopDocsScheduler } from './services/docsScheduler.js';
import { resumeTelegramLoops } from './services/telegramBot.js';
import { pruneExpiredSessions } from './services/sessions.js';
import { metricsMiddleware } from './services/metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

// ─── CORS ───
const clientPort = process.env.CLIENT_PORT || 5173;
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : [`http://localhost:${clientPort}`, `http://127.0.0.1:${clientPort}`];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Security headers for every response (static + API). Mounted after CORS so
// preflight responses still get the Access-Control-* pair.
app.use(securityHeaders);

app.use(express.json({ limit: '100kb' }));

// ─── Per-request metrics — mounted before auth so we see 401s too ───
app.use(metricsMiddleware);

// ─── Public infra endpoints (no auth — health probes + Prom scrape) ───
app.use('/api', healthRoutes);
app.use('/api', metricsRoutes);

// ─── Public auth ───
app.use('/api/auth', authLimiter, authRoutes);

// ─── Public OpenAPI spec (no auth — discovery endpoint) ───
app.use('/api', openapiRoutes);

// ─── Webhook ingress (no JWT — HMAC auth inside the router). Mounted here
//     so express.json() above doesn't consume the body we need to HMAC. ───
app.use('/api/webhooks', webhookRoutes);

// ─── Everything below requires auth ───
app.use('/api', authMiddleware);

// AI rate limit on any endpoint whose path implies AI cost.
app.use('/api', (req, res, next) => {
  if (/\/analyze$/.test(req.path) || /\/ai\/ask$/.test(req.path) || req.path.startsWith('/ai/')) {
    return aiLimiter(req, res, next);
  }
  next();
});

app.use('/api/chart', chartDataRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/alpaca', alpacaRoutes);
app.use('/api/auto-trader', autoTraderRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/event-calendar', eventCalendarRoutes);
app.use('/api/market-data', marketDataRoutes);
app.use('/api/audit-log', auditLogRoutes);
// Note: /api/openapi.json is mounted earlier, above the auth middleware.
app.use('/api/signals', signalsRoutes);
app.use('/api/strategies', strategiesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/themes', themesRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/hyperopt', hyperoptRoutes);
app.use('/api/outbound-webhooks', outboundWebhookRoutes);
app.use('/api/strategy-analysis', strategyAnalysisRoutes);
app.use('/api/protections', protectionsRoutes);
app.use('/api/edge', edgeRoutes);
app.use('/api/pairlists', pairlistRoutes);
app.use('/api/freqai-lite', freqaiLiteRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/saved-backtests', savedBacktestRoutes);
app.use('/api/producer-consumer', producerConsumerRoutes);
app.use('/api/plots', plotsRoutes);
// Freqtrade-compatible REST API — mirrors the /api/v1/* endpoints their CLI
// and 3rd-party tooling (ft-client, freqUI) expect.
app.use('/api/v1', freqtradeApiRoutes);
app.use('/api/strategy-migrate', strategyMigratorRoutes);
app.use('/api/exchanges', exchangeRoutes);
app.use('/api/user-strategies', userStrategyRoutes);
app.use('/api/leverage', leverageRoutes);
app.use('/api/backtest-analysis', backtestAnalysisRoutes);
app.use('/api/util', utilRoutes);
app.use('/api/hyperopt-adv', hyperoptAdvancedRoutes);
app.use('/api/orderflow', orderflowRoutes);
app.use('/api/rl-lite', rlLiteRoutes);
app.use('/api/jupyter', jupyterRoutes);
app.use('/api/freqai-sidecar', freqaiSidecarRoutes);

// ─── CRUD + AI-analyze routers ───
const crudResources = [
  ['trailing-stops',   TrailingStop,    'Trailing Stop'],
  ['copy-trades',      CopyTrade,       'Copy Trade'],
  ['wheel-strategies', WheelStrategy,   'Wheel Strategy'],
  ['watchlist',        WatchlistItem,   'Watchlist'],
  ['trade-journal',    TradeJournal,    'Trade Journal'],
  ['price-alerts',     PriceAlert,      'Price Alert'],
  ['trade-signals',    TradeSignal,     'Trade Signal'],
  ['stock-screener',   StockScreener,   'Stock Screener'],
  ['risk-assessments', RiskAssessment,  'Risk Assessment'],
  ['portfolio',        PortfolioItem,   'Portfolio'],
  ['sentiment',        Sentiment,       'Sentiment'],
  ['options-chain',    OptionsChain,    'Options Chain'],
  ['market-news',      MarketNews,      'Market News'],
];
for (const [path, Model, label] of crudResources) {
  const promptFn = resourcePrompts[path];
  if (!promptFn) throw new Error(`Missing resource prompt builder for "${path}"`);
  // Custom routes for market-news (sync) mount ahead of the generic CRUD
  // router so named paths like /sync aren't swallowed by /:id.
  if (path === 'market-news') {
    app.use(`/api/${path}`, marketNewsRoutes);
  }
  app.use(`/api/${path}`, createCrudRouter(Model, label, promptFn));
}

// ─── JSON 404 for unknown /api paths (must come BEFORE SPA fallback) ───
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Serve built frontend ───
const clientDist = join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(join(clientDist, 'index.html'));
});

// ─── Error handler (must be last) ───
app.use(errorHandler);

let httpServer = null;

async function start() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    logger.info('Database connected');
    httpServer = app.listen(PORT, () => {
      logger.info({ port: PORT }, `Server running on http://localhost:${PORT}`);
    });
    // Resume auto-trader if it was running before restart.
    resumeAutoTraderIfRunning().catch((err) =>
      logger.warn({ err }, 'Auto-trader resume failed'),
    );
    // Start the price-alert evaluator loop. Polls active PriceAlert rows,
    // compares against current quotes, fires notifications on threshold
    // crossings, and also expires stale TradeSignal rows in the same tick.
    startAlertEvaluator();
    // Resume Telegram long-poll loops for configured users.
    resumeTelegramLoops().catch((err) =>
      logger.warn({ err }, 'Telegram resume failed'),
    );
    // Docs mirror refresh loop — initial crawl on first boot, daily after.
    startDocsScheduler();
    // Prune expired token blocklist entries hourly. unref'd so the interval
    // never holds the process open during shutdown.
    pruneRevokedTokens().catch(() => {});
    pruneExpiredSessions().catch(() => {});
    const pruneTimer = setInterval(() => {
      pruneRevokedTokens().catch(() => {});
      pruneExpiredSessions().catch(() => {});
    }, 60 * 60 * 1000);
    pruneTimer.unref();
  } catch (err) {
    logger.error({ err }, 'Failed to start');
    process.exit(1);
  }
}

// ─── Graceful shutdown ───
// On SIGTERM/SIGINT: stop accepting new connections, flush the auto-trader
// interval, close the sequelize pool, and only then exit. Without this, an
// in-flight tick could be orphaned and leave partial state.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutdown signal received');

  // Force-exit backstop — if something hangs, don't block forever.
  const forceExit = setTimeout(() => {
    logger.warn('Shutdown timed out after 10s, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    stopAlertEvaluator();
    stopDocsScheduler();
    await stopAllAutoTraders().catch((err) => logger.warn({ err }, 'stopAllAutoTraders during shutdown failed'));
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    await sequelize.close().catch((err) => logger.warn({ err }, 'sequelize.close failed'));
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Shutdown error');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
