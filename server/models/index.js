import { DataTypes } from 'sequelize';
import sequelize from '../db.js';

// ─── Users ───
export const User = sequelize.define('User', {
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, defaultValue: 'Trader' },
  // Optional TOTP 2FA. When totpEnabled=true, login returns a challenge and
  // must be followed by a /verify-totp call with the current code. The secret
  // is a base32-encoded 20-byte buffer shared with the authenticator app.
  totpSecret:  { type: DataTypes.STRING },
  totpEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  // Backup codes are stored as a JSON array of bcrypt hashes. Each code is
  // one-shot: on use we null the slot (null-filled array = none left).
  totpBackupCodes: { type: DataTypes.JSON, defaultValue: [] },
  // Per-user HMAC secret for inbound webhook authentication. Generated on
  // demand (POST /auth/webhook-secret), stored in hex so it's copy-pasteable
  // by the user when configuring an external strategy (TradingView alerts,
  // Python scripts etc.).
  webhookSecret: { type: DataTypes.STRING },
});

// ─── Position Notes ───
// Free-form notes attached to a symbol (not a specific order — positions
// come and go, notes about a thesis persist). Useful for logging why you
// entered, what would invalidate the trade, post-mortems.
export const PositionNote = sequelize.define('PositionNote', {
  userId: { type: DataTypes.INTEGER, allowNull: false },
  symbol: { type: DataTypes.STRING, allowNull: false },
  note:   { type: DataTypes.TEXT, allowNull: false },
}, { indexes: [{ fields: ['userId'] }, { fields: ['symbol'] }] });

// Every per-user model gets a nullable-for-legacy-rows userId column + index.
// The auth middleware stamps req.userId and the CRUD router scopes queries.
// NB: userScopedOpts is a *factory*, not a shared object — Sequelize normalizes
// opts.indexes in place (stamping a table-specific `name` on each entry), so
// sharing one object across models leaks the first model's index name to the
// next and sync() fails with "relation ... already exists".
const userScoped = { userId: { type: DataTypes.INTEGER, allowNull: true } };
const userScopedOpts = () => ({ indexes: [{ fields: ['userId'] }] });

// ─── Trailing Stops ───
export const TrailingStop = sequelize.define('TrailingStop', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  qty: { type: DataTypes.INTEGER, defaultValue: 10 },
  entryPrice: { type: DataTypes.FLOAT },
  currentPrice: { type: DataTypes.FLOAT },
  stopLossPct: { type: DataTypes.FLOAT, defaultValue: 10 },
  trailPct: { type: DataTypes.FLOAT, defaultValue: 5 },
  floorPrice: { type: DataTypes.FLOAT },
  highestPrice: { type: DataTypes.FLOAT },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Copy Trades ───
export const CopyTrade = sequelize.define('CopyTrade', {
  ...userScoped,
  politician: { type: DataTypes.STRING, allowNull: false },
  symbol: { type: DataTypes.STRING, allowNull: false },
  action: { type: DataTypes.STRING },
  tradeDate: { type: DataTypes.STRING },
  qty: { type: DataTypes.INTEGER },
  price: { type: DataTypes.FLOAT },
  totalValue: { type: DataTypes.FLOAT },
  status: { type: DataTypes.STRING, defaultValue: 'pending' },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Wheel Strategy ───
export const WheelStrategy = sequelize.define('WheelStrategy', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  stage: { type: DataTypes.STRING, defaultValue: 'selling_puts' },
  strikePrice: { type: DataTypes.FLOAT },
  expiration: { type: DataTypes.STRING },
  premium: { type: DataTypes.FLOAT },
  costBasis: { type: DataTypes.FLOAT },
  contracts: { type: DataTypes.INTEGER, defaultValue: 1 },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Watchlist ───
export const WatchlistItem = sequelize.define('WatchlistItem', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  companyName: { type: DataTypes.STRING },
  price: { type: DataTypes.FLOAT },
  changePct: { type: DataTypes.FLOAT },
  volume: { type: DataTypes.STRING },
  sector: { type: DataTypes.STRING },
  notes: { type: DataTypes.TEXT },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Trade Journal ───
export const TradeJournal = sequelize.define('TradeJournal', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  action: { type: DataTypes.STRING },
  qty: { type: DataTypes.INTEGER },
  entryPrice: { type: DataTypes.FLOAT },
  exitPrice: { type: DataTypes.FLOAT },
  tradeDate: { type: DataTypes.STRING },
  pnl: { type: DataTypes.FLOAT },
  notes: { type: DataTypes.TEXT },
  strategy: { type: DataTypes.STRING },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Price Alerts ───
export const PriceAlert = sequelize.define('PriceAlert', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  targetPrice: { type: DataTypes.FLOAT },
  direction: { type: DataTypes.STRING, defaultValue: 'above' },
  currentPrice: { type: DataTypes.FLOAT },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  notes: { type: DataTypes.TEXT },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Trade Signals ───
export const TradeSignal = sequelize.define('TradeSignal', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  signalType: { type: DataTypes.STRING },
  strategy: { type: DataTypes.STRING },
  confidence: { type: DataTypes.FLOAT },
  entryPrice: { type: DataTypes.FLOAT },
  targetPrice: { type: DataTypes.FLOAT },
  stopPrice: { type: DataTypes.FLOAT },
  timeframe: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Stock Screener ───
export const StockScreener = sequelize.define('StockScreener', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  companyName: { type: DataTypes.STRING },
  sector: { type: DataTypes.STRING },
  marketCap: { type: DataTypes.STRING },
  peRatio: { type: DataTypes.FLOAT },
  dividendYield: { type: DataTypes.FLOAT },
  aiScore: { type: DataTypes.FLOAT },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Risk Assessments ───
export const RiskAssessment = sequelize.define('RiskAssessment', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  positionSize: { type: DataTypes.FLOAT },
  riskLevel: { type: DataTypes.STRING },
  maxLoss: { type: DataTypes.FLOAT },
  riskRewardRatio: { type: DataTypes.FLOAT },
  volatility: { type: DataTypes.FLOAT },
  notes: { type: DataTypes.TEXT },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Portfolio Items ───
export const PortfolioItem = sequelize.define('PortfolioItem', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  companyName: { type: DataTypes.STRING },
  qty: { type: DataTypes.INTEGER },
  avgPrice: { type: DataTypes.FLOAT },
  currentPrice: { type: DataTypes.FLOAT },
  pnl: { type: DataTypes.FLOAT },
  allocation: { type: DataTypes.FLOAT },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Sentiment ───
export const Sentiment = sequelize.define('Sentiment', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  sentimentScore: { type: DataTypes.FLOAT },
  source: { type: DataTypes.STRING },
  headline: { type: DataTypes.STRING },
  bullishPct: { type: DataTypes.FLOAT },
  bearishPct: { type: DataTypes.FLOAT },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Options Chain ───
export const OptionsChain = sequelize.define('OptionsChain', {
  ...userScoped,
  symbol: { type: DataTypes.STRING, allowNull: false },
  optionType: { type: DataTypes.STRING },
  strike: { type: DataTypes.FLOAT },
  expiration: { type: DataTypes.STRING },
  premium: { type: DataTypes.FLOAT },
  iv: { type: DataTypes.FLOAT },
  delta: { type: DataTypes.FLOAT },
  openInterest: { type: DataTypes.INTEGER },
  aiAnalysis: { type: DataTypes.TEXT },
}, userScopedOpts());

// ─── Market News ───
export const MarketNews = sequelize.define('MarketNews', {
  title: { type: DataTypes.STRING, allowNull: false },
  summary: { type: DataTypes.TEXT },
  source: { type: DataTypes.STRING },
  symbol: { type: DataTypes.STRING },
  sentiment: { type: DataTypes.STRING },
  publishedAt: { type: DataTypes.STRING },
  // Outbound link to the source article. Nullable — older rows and
  // user-authored entries without a link still render as plain text.
  url: { type: DataTypes.STRING(2048), allowNull: true },
  aiAnalysis: { type: DataTypes.TEXT },
});

// ─── AI Usage (per-user token + cost tracking) ───
export const AiUsage = sequelize.define('AiUsage', {
  userId: { type: DataTypes.INTEGER, allowNull: false, index: true },
  day: { type: DataTypes.STRING, allowNull: false, index: true }, // YYYY-MM-DD UTC
  promptTokens: { type: DataTypes.INTEGER, defaultValue: 0 },
  completionTokens: { type: DataTypes.INTEGER, defaultValue: 0 },
  totalTokens: { type: DataTypes.INTEGER, defaultValue: 0 },
  requests: { type: DataTypes.INTEGER, defaultValue: 0 },
  model: { type: DataTypes.STRING },
}, {
  indexes: [{ fields: ['userId', 'day'] }],
});

// ─── Auto-Trader State (persisted so restarts don't lose in-progress runs) ───
export const AutoTraderState = sequelize.define('AutoTraderState', {
  // userId is the unique key now — each user owns at most one state row.
  userId: { type: DataTypes.INTEGER, allowNull: true, unique: true },
  running: { type: DataTypes.BOOLEAN, defaultValue: false },
  activeStrategy: { type: DataTypes.STRING },
  symbols: { type: DataTypes.JSON, defaultValue: [] },
  config: { type: DataTypes.JSON, defaultValue: {} },
  startedAt: { type: DataTypes.DATE },
  consecutiveLosses: { type: DataTypes.INTEGER, defaultValue: 0 },
  dailyPnl: { type: DataTypes.FLOAT, defaultValue: 0 },
  killedReason: { type: DataTypes.STRING },
});

// ─── Auto-Trader Trade History ───
export const AutoTraderTrade = sequelize.define('AutoTraderTrade', {
  userId: { type: DataTypes.INTEGER, allowNull: true },
  symbol: { type: DataTypes.STRING, allowNull: false },
  action: { type: DataTypes.STRING, allowNull: false },
  qty: { type: DataTypes.FLOAT },
  price: { type: DataTypes.FLOAT },
  reason: { type: DataTypes.TEXT },
  orderId: { type: DataTypes.STRING, unique: true }, // idempotency
  strategy: { type: DataTypes.STRING },
  pnl: { type: DataTypes.FLOAT },
  tags: { type: DataTypes.JSON, defaultValue: [] },    // ['scalp', 'news-catalyst']
  entryContext: { type: DataTypes.JSON, defaultValue: {} }, // indicator snapshot at entry
  // Leverage + margin fields (freqtrade parity). Cash accounts ignore these;
  // rows emitted from the user-strategy sandbox or a futures exchange
  // adapter stamp them so downstream stats can show margin/liquidation risk.
  leverage:       { type: DataTypes.FLOAT,  defaultValue: 1 },
  marginMode:     { type: DataTypes.STRING, defaultValue: 'spot' },  // spot | isolated | cross
  liquidationPrice: { type: DataTypes.FLOAT },                       // nullable — only for margin trades
  fundingFees:    { type: DataTypes.FLOAT,  defaultValue: 0 },       // accumulated funding cost
}, {
  indexes: [{ fields: ['userId'] }],
});

// ─── Event Calendar (earnings / macro events) ───
export const EventCalendar = sequelize.define('EventCalendar', {
  date:   { type: DataTypes.STRING, allowNull: false },   // YYYY-MM-DD UTC
  kind:   { type: DataTypes.STRING, allowNull: false },   // fomc | cpi | nfp | earnings | custom
  symbol: { type: DataTypes.STRING },                      // nullable for macro events
  note:   { type: DataTypes.STRING },
}, {
  indexes: [{ fields: ['date'] }, { fields: ['symbol'] }],
});

// ─── Revoked Tokens (server-side logout blocklist) ───
// We store a SHA-256 hash of the JWT (never the token itself) plus the
// token's `exp` claim so a periodic sweep can prune dead entries.
export const RevokedToken = sequelize.define('RevokedToken', {
  tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
  userId:    { type: DataTypes.INTEGER },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
}, {
  indexes: [{ fields: ['expiresAt'] }, { fields: ['userId'] }],
});

// ─── Password Reset Tokens (short-lived, one-shot) ───
// Same pattern: store only the hash so a DB leak can't immediately be used to
// reset passwords. usedAt nulled out after redemption for audit trail.
export const PasswordResetToken = sequelize.define('PasswordResetToken', {
  tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
  userId:    { type: DataTypes.INTEGER, allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  usedAt:    { type: DataTypes.DATE },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['expiresAt'] }],
});

// ─── Audit Log ───
export const AuditLog = sequelize.define('AuditLog', {
  userId: { type: DataTypes.INTEGER },
  action: { type: DataTypes.STRING, allowNull: false },   // e.g. "auto-trader.start"
  resource: { type: DataTypes.STRING },                    // e.g. "auto-trader"
  resourceId: { type: DataTypes.STRING },
  ip: { type: DataTypes.STRING },
  userAgent: { type: DataTypes.STRING },
  meta: { type: DataTypes.JSON, defaultValue: {} },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['action'] }, { fields: ['createdAt'] }],
});

// ─── AI Investment Themes ───
// Curated structural investment themes (e.g. "AI semiconductor scarcity").
// Global/admin-managed — no userId. Seeded from the AI Manifesto transcript.
// Themes are the grouping layer; ThemeConstituent rows are the member tickers.
export const Theme = sequelize.define('Theme', {
  slug:       { type: DataTypes.STRING, allowNull: false, unique: true },
  name:       { type: DataTypes.STRING, allowNull: false },
  tagline:    { type: DataTypes.STRING },          // one-line hook
  thesisMd:   { type: DataTypes.TEXT },            // long-form markdown
  disclaimer: { type: DataTypes.TEXT },            // per-theme disclaimer override
  order:      { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  indexes: [{ fields: ['slug'] }, { fields: ['order'] }],
});

export const ThemeConstituent = sequelize.define('ThemeConstituent', {
  themeId:   { type: DataTypes.INTEGER, allowNull: false },
  symbol:    { type: DataTypes.STRING, allowNull: false },
  rationale: { type: DataTypes.TEXT },
  weight:    { type: DataTypes.FLOAT, defaultValue: 1.0 },  // equal-weight by default
}, {
  indexes: [
    { fields: ['themeId'] },
    { fields: ['themeId', 'symbol'], unique: true },  // no duplicate tickers per theme
  ],
});

// Per-user alerts bound to a theme basket rather than a single symbol.
// Evaluated by extending alertEvaluator: fetch the theme's constituents,
// compute equal-weight basket change vs threshold.
export const ThemeAlert = sequelize.define('ThemeAlert', {
  ...userScoped,
  themeId:   { type: DataTypes.INTEGER, allowNull: false },
  // 'basket-change-pct' = basket moved threshold% since createdAt baseline
  // 'any-member-above'  = any constituent price > threshold
  // 'any-member-below'  = any constituent price < threshold
  kind:      { type: DataTypes.STRING, defaultValue: 'basket-change-pct' },
  threshold: { type: DataTypes.FLOAT, allowNull: false },
  baseline:  { type: DataTypes.FLOAT },                // stamped on create for basket-change-pct
  status:    { type: DataTypes.STRING, defaultValue: 'active' }, // active|triggered
  notes:     { type: DataTypes.TEXT },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['themeId'] }],
});

// ─── Notifications (in-app feed) ───
export const Notification = sequelize.define('Notification', {
  userId:  { type: DataTypes.INTEGER, allowNull: false },
  // 'price-alert' | 'auto-trader' | 'security' | 'info'
  type:    { type: DataTypes.STRING, allowNull: false },
  title:   { type: DataTypes.STRING, allowNull: false },
  body:    { type: DataTypes.TEXT },
  link:    { type: DataTypes.STRING },
  read:    { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  indexes: [{ fields: ['userId', 'read'] }, { fields: ['createdAt'] }],
});

// ─── Sessions (active JWT registry) ───
// Complements RevokedTokens: that table is a blocklist of revoked hashes,
// this one is the *positive* list of currently-valid sessions per user. The
// auth middleware touches lastSeenAt on each request and the user can view
// / revoke individual sessions from the Account page.
export const Session = sequelize.define('Session', {
  userId:     { type: DataTypes.INTEGER, allowNull: false },
  tokenHash:  { type: DataTypes.STRING, allowNull: false, unique: true },
  userAgent:  { type: DataTypes.STRING(256) },
  ip:         { type: DataTypes.STRING(45) },
  lastSeenAt: { type: DataTypes.DATE, allowNull: false },
  expiresAt:  { type: DataTypes.DATE, allowNull: false },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['expiresAt'] }],
});

// ─── External Docs Mirror ───
// Local copy of third-party documentation (currently: freqtrade.io) so users
// can browse reference material without leaving the app, and so the AI layer
// can later ground answers in it. `source` namespaces the corpus — 'freqtrade'
// today, room for more later ('alpaca', 'ib-api', etc.). `htmlHash` is an
// SHA-1 of the extracted HTML used by the crawler to skip unchanged pages.
// ─── Hyperopt Runs (parameter optimization jobs) ───
// Each row is one async grid-search job kicked off from Strategy Lab. The
// backtest engine wraps a bars fetch + `optimizeParams()` — we persist the
// job so a browser refresh can resume polling and so users can review history.
export const HyperoptRun = sequelize.define('HyperoptRun', {
  userId:      { type: DataTypes.INTEGER, allowNull: false },
  strategyKey: { type: DataTypes.STRING, allowNull: false },
  symbol:      { type: DataTypes.STRING, allowNull: false },
  days:        { type: DataTypes.INTEGER, defaultValue: 365 },
  timeframe:   { type: DataTypes.STRING, defaultValue: '1Day' },
  grid:        { type: DataTypes.JSON, defaultValue: {} },   // { stopLossPct:[...], takeProfitPct:[...], slippagePct:[...] }
  status:      { type: DataTypes.STRING, defaultValue: 'pending' }, // pending|running|done|failed
  progress:    { type: DataTypes.JSON, defaultValue: { completed: 0, total: 0 } },
  leaderboard: { type: DataTypes.JSON, defaultValue: [] },   // top-N [{params, score, metrics}]
  bestParams:  { type: DataTypes.JSON, defaultValue: null },
  error:       { type: DataTypes.TEXT },
  startedAt:   { type: DataTypes.DATE },
  finishedAt:  { type: DataTypes.DATE },
}, {
  indexes: [{ fields: ['userId', 'createdAt'] }, { fields: ['status'] }],
});

// ─── Webhook Configurations (outbound HTTP callbacks on trade events) ───
// Users register a URL + secret; the dispatcher fires signed POSTs when the
// auto-trader produces a matching event (order.filled, order.stopped, etc.).
export const WebhookConfig = sequelize.define('WebhookConfig', {
  userId:         { type: DataTypes.INTEGER, allowNull: false },
  name:           { type: DataTypes.STRING, allowNull: false },
  url:            { type: DataTypes.STRING(1024), allowNull: false },
  // Shared HMAC secret. We store as-is (server-only field); the client never
  // reads it back after creation beyond a masked preview.
  secret:         { type: DataTypes.STRING, allowNull: false },
  events:         { type: DataTypes.JSON, defaultValue: ['order.filled'] },
  active:         { type: DataTypes.BOOLEAN, defaultValue: true },
  failCount:      { type: DataTypes.INTEGER, defaultValue: 0 },
  lastDeliveryAt: { type: DataTypes.DATE },
  lastStatus:     { type: DataTypes.STRING }, // 'ok' | 'error' | 'disabled'
  lastError:      { type: DataTypes.TEXT },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['active'] }],
});

export const DocsPage = sequelize.define('DocsPage', {
  source:    { type: DataTypes.STRING, allowNull: false },
  slug:      { type: DataTypes.STRING, allowNull: false },
  title:     { type: DataTypes.STRING, allowNull: false },
  section:   { type: DataTypes.STRING },                // grouping for the TOC
  order:     { type: DataTypes.INTEGER, defaultValue: 0 },
  url:       { type: DataTypes.STRING(1024), allowNull: false },
  markdown:  { type: DataTypes.TEXT('long') },
  htmlHash:  { type: DataTypes.STRING(64) },
  fetchedAt: { type: DataTypes.DATE },
}, {
  indexes: [
    { fields: ['source'] },
    { fields: ['source', 'slug'], unique: true },
  ],
});

// ─── FreqAI trained models (persisted weights + metadata) ───
export const AiModel = sequelize.define('AiModel', {
  userId:    { type: DataTypes.INTEGER, allowNull: true },
  symbol:    { type: DataTypes.STRING, allowNull: false },
  timeframe: { type: DataTypes.STRING, defaultValue: '1Day' },
  modelType: { type: DataTypes.STRING, defaultValue: 'logreg' },  // logreg | perceptron | ensemble
  weights:   { type: DataTypes.JSON },
  bias:      { type: DataTypes.FLOAT },
  featureNames: { type: DataTypes.JSON },
  trainSamples: { type: DataTypes.INTEGER },
  trainAccuracy: { type: DataTypes.FLOAT },
  oosSamples: { type: DataTypes.INTEGER },
  oosAccuracy: { type: DataTypes.FLOAT },
  trainedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  // Walk-forward metadata — so clients can see when this model's window ends.
  trainWindowEnd: { type: DataTypes.DATE },
}, {
  indexes: [{ fields: ['userId', 'symbol', 'timeframe'] }],
});

// ─── Saved backtest runs (user-visible persistence) ───
export const SavedBacktest = sequelize.define('SavedBacktest', {
  userId:      { type: DataTypes.INTEGER, allowNull: true },
  name:        { type: DataTypes.STRING, allowNull: false },
  strategyKey: { type: DataTypes.STRING, allowNull: false },
  symbol:      { type: DataTypes.STRING, allowNull: false },
  timeframe:   { type: DataTypes.STRING, defaultValue: '1Day' },
  days:        { type: DataTypes.INTEGER },
  options:     { type: DataTypes.JSON },
  result:      { type: DataTypes.JSON },  // full backtest result blob (summary + trades)
  tags:        { type: DataTypes.JSON, defaultValue: [] },
}, {
  indexes: [{ fields: ['userId'] }],
});

// ─── Producer/Consumer signal relay ───
export const ProducedSignal = sequelize.define('ProducedSignal', {
  userId:      { type: DataTypes.INTEGER, allowNull: true },
  producerId:  { type: DataTypes.STRING, allowNull: false }, // free-form channel name
  symbol:      { type: DataTypes.STRING, allowNull: false },
  action:      { type: DataTypes.STRING, allowNull: false }, // buy | sell | hold
  price:       { type: DataTypes.FLOAT },
  strategy:    { type: DataTypes.STRING },
  meta:        { type: DataTypes.JSON, defaultValue: {} },
  expiresAt:   { type: DataTypes.DATE },
}, {
  indexes: [{ fields: ['producerId'] }, { fields: ['userId', 'producerId'] }],
});

// ─── User-authored JS strategies (sandboxed) ───
// Each row holds a freeform JS source that defines hooks via defineStrategy().
// The source is executed in a Node `vm` context — see services/strategySandbox.js.
export const UserStrategy = sequelize.define('UserStrategy', {
  userId:   { type: DataTypes.INTEGER, allowNull: false },
  name:     { type: DataTypes.STRING, allowNull: false },
  sourceJs: { type: DataTypes.TEXT, allowNull: false },
  params:   { type: DataTypes.JSON, defaultValue: {} },
  notes:    { type: DataTypes.TEXT },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['userId', 'name'], unique: true }],
});

// ─── RL-lite Q-tables (tabular Q-learning for discrete market state) ───
// Each row is a trained Q-table for a (userId, symbol, timeframe) scope.
// The policy operates over a bucketed state vector (RSI x ADX x trend) and
// three actions: 0=hold, 1=long, 2=exit. State keys are JSON-encoded
// "[rsiBucket,adxBucket,trendBucket]" strings mapping to [qHold,qLong,qExit].
export const QTable = sequelize.define('QTable', {
  userId:    { type: DataTypes.INTEGER, allowNull: true },
  name:      { type: DataTypes.STRING, allowNull: false },
  symbol:    { type: DataTypes.STRING, allowNull: false },
  timeframe: { type: DataTypes.STRING, defaultValue: '1Day' },
  // Bucket edges so the serving side can reproduce the same discretization.
  buckets:   { type: DataTypes.JSON, defaultValue: {} },
  // { "[1,2,0]": [0.12, 0.31, -0.02], ... }
  qTable:    { type: DataTypes.JSON, defaultValue: {} },
  params:    { type: DataTypes.JSON, defaultValue: {} },   // alpha, gamma, epsilon, episodes
  stats:     { type: DataTypes.JSON, defaultValue: {} },   // trainReturn, oosReturn, trades, winRate
  trainedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['userId', 'name'], unique: true }],
});

// ─── Telegram Config (per-user bot token + authorized chat ID) ───
export const TelegramConfig = sequelize.define('TelegramConfig', {
  userId:    { type: DataTypes.INTEGER, allowNull: false, unique: true },
  botToken:  { type: DataTypes.STRING, allowNull: false }, // stored plaintext (acceptable for single-tenant-per-user bot)
  chatId:    { type: DataTypes.STRING, allowNull: false }, // authorized chat — commands from other chats are ignored
  active:    { type: DataTypes.BOOLEAN, defaultValue: true },
  lastUpdateId: { type: DataTypes.BIGINT, defaultValue: 0 }, // offset for long-polling
  lastError: { type: DataTypes.TEXT },
}, {
  indexes: [{ fields: ['userId'], unique: true }],
});

export default {
  User, TrailingStop, CopyTrade, WheelStrategy, WatchlistItem,
  TradeJournal, PriceAlert, TradeSignal, StockScreener,
  RiskAssessment, PortfolioItem, Sentiment, OptionsChain, MarketNews,
  AiUsage, AutoTraderState, AutoTraderTrade, EventCalendar, AuditLog,
  RevokedToken, PasswordResetToken, Notification, Session,
  PositionNote,
  Theme, ThemeConstituent, ThemeAlert,
  DocsPage,
  HyperoptRun, WebhookConfig,
  TelegramConfig,
  AiModel, SavedBacktest, ProducedSignal,
  UserStrategy,
};
