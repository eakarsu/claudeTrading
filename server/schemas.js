import { z } from 'zod';

// ── Primitives ──
export const symbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z.]{1,6}$/, 'Invalid symbol');
export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const paginationQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// ── Auth ──
// Password strength: ≥10 chars, at least one letter AND one digit. Keeps the
// rule short enough to remember while blocking the obvious "password" /
// "12345678" failures. Stronger policies belong in a proper zxcvbn-style
// checker — punted for now.
const strongPassword = z.string()
  .min(10, 'Password must be at least 10 characters')
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/\d/, 'Password must include a digit');

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: strongPassword,
  name: z.string().trim().min(1, 'Name is required'),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: strongPassword,
});
export const totpEnrollVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});
export const totpLoginSchema = z.object({
  challenge: z.string().min(20).max(200),
  // Accept either a 6-digit TOTP or a backup code formatted like "a1b2c3-d4e5f6"
  code: z.string().regex(/^(\d{6}|[a-f0-9]{6}-[a-f0-9]{6})$/),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});
export const deleteAccountSchema = z.object({
  password: z.string().min(1),
  confirm: z.literal('DELETE'),
});

// ── Alpaca orders ──
// Supports market / limit / stop / stop-limit / trailing-stop plus bracket /
// OTO / OCO order classes (with optional take-profit and stop-loss legs).
// `side` accepts buy/sell; shorting is expressed as side='sell' against a
// zero/negative position — Alpaca rejects naked shorts on non-shortable
// symbols with a clear error, so we let it through rather than guessing here.
export const orderSchema = z.object({
  symbol: symbolSchema,
  qty: z.coerce.number().positive(),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop']).default('market'),
  time_in_force: z.enum(['day', 'gtc', 'opg', 'cls', 'ioc', 'fok']).default('day'),
  limit_price: z.coerce.number().positive().optional(),
  stop_price: z.coerce.number().positive().optional(),
  trail_percent: z.coerce.number().positive().max(50).optional(),
  trail_price: z.coerce.number().positive().optional(),
  order_class: z.enum(['simple', 'bracket', 'oto', 'oco']).optional(),
  take_profit: z.object({ limit_price: z.coerce.number().positive() }).optional(),
  stop_loss: z.object({
    stop_price: z.coerce.number().positive(),
    limit_price: z.coerce.number().positive().optional(),
  }).optional(),
}).refine(
  (v) => v.type !== 'trailing_stop' || v.trail_percent != null || v.trail_price != null,
  { message: 'trailing_stop requires trail_percent or trail_price', path: ['trail_percent'] },
).refine(
  (v) => v.order_class !== 'bracket' || (v.take_profit?.limit_price != null && v.stop_loss?.stop_price != null),
  { message: 'bracket orders require both take_profit.limit_price and stop_loss.stop_price', path: ['order_class'] },
);
export const ordersQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('all'),
  limit: z.coerce.number().int().positive().max(500).default(50),
});
export const portfolioHistoryQuery = z.object({
  period: z.string().regex(/^\d+[DWMYA]$/).default('1M'),
  timeframe: z.enum(['1Min', '5Min', '15Min', '1H', '4H', '1D']).default('1D'),
});

// ── AI ──
export const aiChatSchema = z.object({
  prompt: z.string().min(1).max(4000),
  feature: z.string().max(64).optional(),
  // When true, retrieve relevant freqtrade docs and include them as grounding
  // context. Default false so existing callers are unchanged.
  groundWithDocs: z.boolean().optional(),
});
export const aiOptionsSchema = z.object({ symbol: symbolSchema.optional() });

// ── Backtests ──
export const timeframeSchema = z.enum(['1Min', '5Min', '15Min', '1H', '4H', '1Day']).default('1Day');
const backtestOptions = {
  slippagePct: z.coerce.number().min(0).max(0.05).optional(),       // 0.001 = 10bps
  commissionPerTrade: z.coerce.number().min(0).max(50).optional(),  // $ per side
  oosRatio: z.coerce.number().min(0).max(0.5).optional(),           // 0.3 = 30% held out
  minAdx: z.coerce.number().min(0).max(100).optional(),             // regime filter
};
export const backtestParams = z.object({
  strategy: z.string().min(1),
  symbol: symbolSchema,
});
export const backtestQuery = z.object({
  days: z.coerce.number().int().positive().max(3650).default(365),
  timeframe: timeframeSchema.optional(),
  ...backtestOptions,
});
export const backtestAllParams = z.object({ symbol: symbolSchema });
export const backtestAllQuery = z.object({
  days: z.coerce.number().int().positive().max(3650).default(365),
  strategies: z.string().optional(),
  timeframe: timeframeSchema.optional(),
  ...backtestOptions,
});
export const backtestMultiSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(50).default(['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN']),
  days: z.coerce.number().int().positive().max(3650).default(365),
  strategies: z.string().optional(),
  timeframe: timeframeSchema.optional(),
  ...backtestOptions,
});
export const comboSchema = z.object({
  symbol: symbolSchema,
  strategies: z.array(z.string()).optional().nullable(),
  days: z.coerce.number().int().positive().max(3650).default(365),
  timeframe: timeframeSchema.optional(),
  ...backtestOptions,
});
export const comboMultiSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(50).default(['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN']),
  strategies: z.array(z.string()).optional().nullable(),
  days: z.coerce.number().int().positive().max(3650).default(365),
  timeframe: timeframeSchema.optional(),
  ...backtestOptions,
});

// ── Advanced backtesting ──
export const monteCarloSchema = z.object({
  strategy: z.string().min(1),
  symbol: symbolSchema,
  days: z.coerce.number().int().positive().max(3650).default(365),
  timeframe: timeframeSchema.optional(),
  runs: z.coerce.number().int().positive().max(10000).default(1000),
  ...backtestOptions,
});
export const optimizerSchema = z.object({
  strategy: z.string().min(1),
  symbol: symbolSchema,
  days: z.coerce.number().int().positive().max(3650).default(365),
  timeframe: timeframeSchema.optional(),
  // Let the caller narrow/broaden the grid. Defaults are set server-side.
  grid: z.object({
    stopLossPct:   z.array(z.number().positive().max(0.3)).optional(),
    takeProfitPct: z.array(z.number().positive().max(2)).optional(),
    slippagePct:   z.array(z.number().min(0).max(0.05)).optional(),
  }).optional(),
  oosRatio: z.coerce.number().min(0.1).max(0.5).default(0.3),
  topN: z.coerce.number().int().positive().max(50).default(10),
});
export const regimeSchema = z.object({
  strategy: z.string().min(1),
  symbol: symbolSchema,
  days: z.coerce.number().int().positive().max(3650).default(365),
  timeframe: timeframeSchema.optional(),
  ...backtestOptions,
});
export const portfolioSchema = z.object({
  legs: z.array(z.object({
    symbol: symbolSchema,
    strategy: z.string().min(1),
  })).min(1).max(20),
  days: z.coerce.number().int().positive().max(3650).default(365),
  timeframe: timeframeSchema.optional(),
  initialCapital: z.coerce.number().positive().max(10_000_000).default(100000),
  maxConcurrent: z.coerce.number().int().positive().max(50).default(10),
  positionPct: z.coerce.number().min(0.01).max(1).default(0.1),
  ...backtestOptions,
});
export const benchmarkSchema = z.object({
  symbol: symbolSchema.default('SPY'),
  days: z.coerce.number().int().positive().max(3650).default(365),
  timeframe: timeframeSchema.optional(),
  initialCapital: z.coerce.number().positive().max(10_000_000).default(100000),
});

// ── Auto-trader trade editing ──
export const autoTraderTagsSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(32)).max(10),
});

// ── Event calendar ──
export const eventCalendarQuery = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  symbol: symbolSchema.optional(),
});
export const eventCalendarCreateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['fomc', 'cpi', 'nfp', 'pce', 'earnings', 'custom']),
  symbol: symbolSchema.optional(),
  note: z.string().max(200).optional(),
}).refine(
  // Earnings events are per-symbol by definition — reject empty earnings rows
  // so the UI can't accidentally flood the calendar with blank entries.
  (data) => data.kind !== 'earnings' || !!data.symbol,
  { message: 'symbol is required for earnings events', path: ['symbol'] },
).refine(
  // Custom events need at least a symbol or a note — otherwise the row carries
  // no usable information for the operator.
  (data) => data.kind !== 'custom' || !!(data.symbol || data.note),
  { message: 'custom events need a symbol or a note', path: ['note'] },
);

// ── Auto trader ──
export const autoTraderStartSchema = z.object({
  strategy: z.string().min(1),
  symbols: z.array(symbolSchema).min(1).max(50),
  config: z
    .object({
      maxPositionSize: z.number().positive().max(100000).optional(),
      maxOpenPositions: z.number().int().positive().max(50).optional(),
      checkIntervalMs: z.number().int().min(5000).max(3600000).optional(),
      stopLossPct: z.number().positive().max(1).optional(),
      takeProfitPct: z.number().positive().max(10).optional(),
      dailyLossLimit: z.number().positive().optional(),
      maxConsecutiveLosses: z.number().int().positive().optional(),
      // Live-exposure guardrails (0/null = disabled). Evaluated each tick
      // against the Alpaca account and positions.
      maxShortExposureDollars: z.number().nonnegative().max(10_000_000).nullable().optional(),
      maxTotalExposureDollars: z.number().nonnegative().max(10_000_000).nullable().optional(),
      stopOnDrawdownPct:       z.number().positive().max(1).nullable().optional(),
      maxShortPositions:       z.number().int().nonnegative().max(200).nullable().optional(),
      timeframe: z.enum(['1Min', '5Min', '15Min', '1H', '4H', '1Day']).optional(),
      // Risk $ per trade. If set, overrides maxPositionSize sizing: we compute
      // shares = riskPerTrade / (entry - stop) so loss at stop = riskPerTrade.
      riskPerTrade: z.number().positive().max(100000).optional(),
      useBracketOrders: z.boolean().optional(),
      // Session guards
      avoidFirstMin: z.number().int().min(0).max(240).optional(),     // skip first N min after open
      avoidLastMin: z.number().int().min(0).max(240).optional(),      // skip last N min before close
      flattenOnClose: z.boolean().optional(),                         // close all positions near EOD
      flattenBeforeCloseMin: z.number().int().min(1).max(120).optional(),
      // Kill switches
      maxDailyTrades: z.number().int().positive().max(1000).optional(),
      // Trailing stop (server-side placed after fill)
      useTrailingStop: z.boolean().optional(),
      trailingStopPct: z.number().positive().max(0.5).optional(),     // 0.02 = 2%
      // Regime gate
      minAdx: z.number().min(0).max(100).optional(),
      // Per-symbol overrides: partial config keyed by symbol.
      perSymbol: z.record(z.any()).optional(),
      // Scheduled trading window (minutes since session open).
      tradeStartMin: z.number().int().min(0).max(390).optional(),
      tradeEndMin:   z.number().int().min(0).max(390).optional(),
      // Blackout flags
      skipFomc: z.boolean().optional(),
      skipCpi: z.boolean().optional(),
      skipNfp: z.boolean().optional(),
      skipEarnings: z.boolean().optional(),
      skipDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
      // Kelly + correlation sizing
      useKelly: z.boolean().optional(),
      kellyFraction: z.number().positive().max(1).optional(),
      useCorrelationAdjust: z.boolean().optional(),
      correlationThreshold: z.number().min(0).max(1).optional(),
      // Live-mode confirmation — required when the server runs with ALPACA_LIVE_TRADING=true.
      modeAcknowledged: z.enum(['paper', 'live']).optional(),
      // Dry run — execute the strategy loop without placing real orders.
      dryRun: z.boolean().optional(),
    })
    .optional()
    .default({}),
});
