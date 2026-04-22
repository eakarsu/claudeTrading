const BASE = '/api';

function headers() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, { headers: headers(), ...options });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error || 'Request failed');
    err.status = res.status;
    err.details = body.details;
    throw err;
  }
  return res.json();
}

// Auth
export const login = (email, password) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
export const register = (email, password, name) =>
  request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
export const logout = () => request('/auth/logout', { method: 'POST' });
export const me = () => request('/auth/me');
export const forgotPassword = (email) =>
  request('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
export const resetPassword = (token, password) =>
  request('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
export const changePassword = (currentPassword, newPassword) =>
  request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
export const deleteAccount = (password) =>
  request('/auth/delete-account', { method: 'POST', body: JSON.stringify({ password, confirm: 'DELETE' }) });
export const verifyTotpLogin = (challenge, code) =>
  request('/auth/verify-totp', { method: 'POST', body: JSON.stringify({ challenge, code }) });
export const enroll2fa = () => request('/auth/2fa/enroll', { method: 'POST' });
export const verify2fa = (code) =>
  request('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) });
export const disable2fa = (password, code) =>
  request('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password, code }) });

// Active sessions
export const listSessions = () => request('/auth/sessions');
export const revokeSession = (id) => request(`/auth/sessions/${id}`, { method: 'DELETE' });

// Webhook ingress secret (used by external strategies to sign signals)
export const getWebhookSecret    = () => request('/auth/webhook-secret');
export const rotateWebhookSecret = () => request('/auth/webhook-secret', { method: 'POST' });
export const deleteWebhookSecret = () => request('/auth/webhook-secret', { method: 'DELETE' });

// Market news: on-demand sync from configured provider (Finnhub etc.)
export const syncMarketNews = (opts = {}) =>
  request('/market-news/sync', { method: 'POST', body: JSON.stringify(opts) });

// In-app notifications
export const listNotifications = ({ unread, limit, offset } = {}) => {
  const qs = new URLSearchParams();
  if (unread) qs.set('unread', 'true');
  if (limit != null) qs.set('limit', limit);
  if (offset != null) qs.set('offset', offset);
  return request(`/notifications${qs.toString() ? `?${qs}` : ''}`);
};
export const getUnreadNotificationCount = () => request('/notifications/unread-count');
export const markNotificationRead = (id) => request(`/notifications/${id}/read`, { method: 'PATCH' });
export const markAllNotificationsRead = () => request('/notifications/read-all', { method: 'POST' });
export const deleteNotification = (id) => request(`/notifications/${id}`, { method: 'DELETE' });

// Generic CRUD
// Server now paginates and returns { items, total, limit, offset }.
// Unwrap `items` here so call sites keep receiving an array.
export const getAll = async (resource, { limit, offset } = {}) => {
  const qs = new URLSearchParams();
  if (limit != null) qs.set('limit', limit);
  if (offset != null) qs.set('offset', offset);
  const suffix = qs.toString() ? `?${qs}` : '';
  const res = await request(`/${resource}${suffix}`);
  return Array.isArray(res) ? res : (res.items || []);
};
export const getPage = (resource, { limit, offset } = {}) => {
  const qs = new URLSearchParams();
  if (limit != null) qs.set('limit', limit);
  if (offset != null) qs.set('offset', offset);
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/${resource}${suffix}`);
};
export const getOne = (resource, id) => request(`/${resource}/${id}`);
export const create = (resource, data) =>
  request(`/${resource}`, { method: 'POST', body: JSON.stringify(data) });
export const update = (resource, id, data) =>
  request(`/${resource}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const remove = (resource, id) =>
  request(`/${resource}/${id}`, { method: 'DELETE' });
export const analyzeItem = (resource, id) =>
  request(`/${resource}/${id}/analyze`, { method: 'POST' });
export const askFeatureAI = (resource, prompt, context) =>
  request(`/${resource}/ai/ask`, { method: 'POST', body: JSON.stringify({ prompt, context }) });

// AI Center
export const aiChat = (prompt, feature, { groundWithDocs } = {}) =>
  request('/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ prompt, feature, groundWithDocs }),
  });
export const aiMarketSummary = () =>
  request('/ai/market-summary', { method: 'POST' });
export const aiPortfolioReview = () =>
  request('/ai/portfolio-review', { method: 'POST' });
export const aiTradeIdea = () =>
  request('/ai/trade-idea', { method: 'POST' });
export const aiRiskReport = () =>
  request('/ai/risk-report', { method: 'POST' });
export const aiOptionsStrategy = (symbol) =>
  request('/ai/options-strategy', { method: 'POST', body: JSON.stringify({ symbol }) });
export const aiPoliticianAnalysis = () =>
  request('/ai/politician-analysis', { method: 'POST' });

// Alpaca Paper Trading
export const alpacaAccount = () => request('/alpaca/account');
export const alpacaPositions = () => request('/alpaca/positions');
export const alpacaOrders = (status) => request(`/alpaca/orders${status ? `?status=${status}` : ''}`);
export const alpacaPlaceOrder = ({ symbol, qty, side, type, time_in_force, limit_price, stop_price }) =>
  request('/alpaca/orders', { method: 'POST', body: JSON.stringify({ symbol, qty, side, type, time_in_force, limit_price, stop_price }) });
export const alpacaCancelOrder = (id) => request(`/alpaca/orders/${id}`, { method: 'DELETE' });
export const alpacaClosePosition = (symbol) =>
  request(`/alpaca/positions/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
// Cancels every open order for the symbol server-side, then closes the
// position. Use this when a plain close returns Alpaca's "insufficient
// qty available" error — it means a pending order (e.g. a bracket stop)
// is reserving the qty and blocking the close.
export const alpacaCloseSafely = (symbol) =>
  request(`/alpaca/positions/${encodeURIComponent(symbol)}/close-safely`, { method: 'POST' });
export const alpacaCloseAllPositions = () =>
  request('/alpaca/positions/close-all', { method: 'DELETE' });
export const alpacaClock = () => request('/alpaca/clock');
export const alpacaPortfolioHistory = (period, timeframe) =>
  request(`/alpaca/portfolio-history?period=${period || '1M'}&timeframe=${timeframe || '1D'}`);

// Chart Data
export const getChart = (symbol, { days = 90, seed } = {}) => {
  const qs = new URLSearchParams({ days });
  if (seed) qs.set('seed', seed);
  return request(`/chart/${symbol}?${qs}`);
};
export const getIntradayChart = (symbol, { seed } = {}) => {
  const qs = new URLSearchParams();
  if (seed) qs.set('seed', seed);
  return request(`/chart/${symbol}/intraday${qs.toString() ? `?${qs}` : ''}`);
};
// Unified synthetic-chart bars endpoint — accepts '1Min' | '5Min' | '15Min' | '1H' | '1Day'.
// Distinct from the real-data getBars below which hits /market-data/bars.
export const getChartBars = (symbol, { timeframe = '1Day', seed } = {}) => {
  const qs = new URLSearchParams({ timeframe });
  if (seed) qs.set('seed', seed);
  return request(`/chart/${symbol}/bars?${qs}`);
};

// Live Signals
export const getLiveSignals = () => request('/signals/live');

// Strategy Lab
export const getStrategies = () => request('/strategies');
// opts: { slippagePct, commissionPerTrade, oosRatio, minAdx }
const addCostOpts = (qs, opts = {}) => {
  if (opts.slippagePct != null) qs.set('slippagePct', opts.slippagePct);
  if (opts.commissionPerTrade != null) qs.set('commissionPerTrade', opts.commissionPerTrade);
  if (opts.oosRatio != null) qs.set('oosRatio', opts.oosRatio);
  if (opts.minAdx != null) qs.set('minAdx', opts.minAdx);
};
export const backtestStrategy = (strategy, symbol, days = 365, timeframe, opts = {}) => {
  const qs = new URLSearchParams({ days });
  if (timeframe) qs.set('timeframe', timeframe);
  addCostOpts(qs, opts);
  return request(`/backtest/${strategy}/${symbol}?${qs}`);
};
export const backtestAll = (symbol, days = 365, strategies = null, timeframe, opts = {}) => {
  const qs = new URLSearchParams({ days });
  if (strategies) qs.set('strategies', strategies.join(','));
  if (timeframe) qs.set('timeframe', timeframe);
  addCostOpts(qs, opts);
  return request(`/backtest/all/${symbol}?${qs}`);
};
export const backtestMulti = (symbols, days = 365, strategies = null, timeframe, opts = {}) =>
  request('/backtest/multi', {
    method: 'POST',
    body: JSON.stringify({
      symbols, days, timeframe,
      strategies: strategies ? strategies.join(',') : undefined,
      ...opts,
    }),
  });
export const comboBacktest = (symbol, strategies, days = 365, timeframe, opts = {}) =>
  request('/backtest/combo', { method: 'POST', body: JSON.stringify({ symbol, strategies, days, timeframe, ...opts }) });
export const comboBacktestMulti = (symbols, strategies, days = 365, timeframe, opts = {}) =>
  request('/backtest/combo-multi', { method: 'POST', body: JSON.stringify({ symbols, strategies, days, timeframe, ...opts }) });
export const startAutoTrader = (strategy, symbols, config = {}) =>
  request('/auto-trader/start', { method: 'POST', body: JSON.stringify({ strategy, symbols, config }) });
export const stopAutoTrader = () =>
  request('/auto-trader/stop', { method: 'POST' });
export const getAutoTraderStatus = () => request('/auto-trader/status');
export const updateAutoTraderTradeTags = (id, tags) =>
  request(`/auto-trader/trades/${id}/tags`, { method: 'PATCH', body: JSON.stringify({ tags }) });
export const journalAutoTraderTrade = (id) =>
  request(`/auto-trader/trades/${id}/journal`, { method: 'POST' });
export const listAutoTraderTrades = ({ symbol, strategy, tag, limit = 100, offset = 0 } = {}) => {
  const qs = new URLSearchParams({ limit, offset });
  if (symbol)   qs.set('symbol', symbol);
  if (strategy) qs.set('strategy', strategy);
  if (tag)      qs.set('tag', tag);
  return request(`/auto-trader/trades?${qs}`);
};
export const getAutoTraderTrade = (id) => request(`/auto-trader/trades/${id}`);

// Audit log (read-only)
export const getAuditLog = ({ action, resource, userId, limit = 100, offset = 0 } = {}) => {
  const qs = new URLSearchParams({ limit, offset });
  if (action)   qs.set('action', action);
  if (resource) qs.set('resource', resource);
  if (userId)   qs.set('userId', userId);
  return request(`/audit-log?${qs}`);
};

// ─── AI Investment Themes ───
export const listThemes = () => request('/themes');
export const getTheme = (slug, { quotes = true } = {}) =>
  request(`/themes/${slug}${quotes ? '' : '?quotes=false'}`);
export const createTheme = (body) =>
  request('/themes', { method: 'POST', body: JSON.stringify(body) });
export const updateTheme = (slug, body) =>
  request(`/themes/${slug}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteTheme = (slug) =>
  request(`/themes/${slug}`, { method: 'DELETE' });
export const addThemeConstituent = (slug, body) =>
  request(`/themes/${slug}/constituents`, { method: 'POST', body: JSON.stringify(body) });
export const removeThemeConstituent = (slug, symbol) =>
  request(`/themes/${slug}/constituents/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
export const listThemeAlerts = (slug) => request(`/themes/${slug}/alerts`);
export const createThemeAlert = (slug, body) =>
  request(`/themes/${slug}/alerts`, { method: 'POST', body: JSON.stringify(body) });
export const deleteThemeAlert = (slug, id) =>
  request(`/themes/${slug}/alerts/${id}`, { method: 'DELETE' });
export const aiManifestoScore = (symbol) =>
  request('/ai/theme-manifesto', { method: 'POST', body: JSON.stringify({ symbol }) });

// Market data (HV rank + quote snapshot + SSE streaming)
export const getHvRank = (symbol) => request(`/market-data/hv-rank/${symbol}`);
/**
 * One-shot snapshot of latest trade price for a small list of symbols.
 * Shape: { SPY: { price, time }, QQQ: null, ... }
 */
export const getQuotes = (symbols) =>
  request(`/market-data/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
/**
 * Historical bars for charting. `timeframe` is one of
 * 1Min | 5Min | 15Min | 30Min | 1Hour | 1Day.
 */
export const getBars = (symbol, { timeframe = '5Min', limit = 78 } = {}) =>
  request(`/market-data/bars/${encodeURIComponent(symbol)}?timeframe=${timeframe}&limit=${limit}`);
/**
 * Real major-index quotes + intraday bars via Yahoo Finance (SPX, NDQ, DJI,
 * VIX, DXY). Returns:
 *   { SPX: { ticker, name, quote: { price, previousClose, time }, bars }, ... }
 */
export const getIndices = () => request('/market-data/indices');
/**
 * Opens an EventSource against /api/market-data/stream. The browser's native
 * EventSource does NOT support custom headers, so we piggy-back auth via a
 * query parameter — the stream endpoint treats it the same as a Bearer token.
 */
export const openPriceStream = (symbols, { onTick, onError } = {}) => {
  const token = localStorage.getItem('token');
  const qs = new URLSearchParams({ symbols: symbols.join(',') });
  if (token) qs.set('token', token);
  const es = new EventSource(`/api/market-data/stream?${qs}`);
  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'tick' && onTick) onTick(msg);
      if (msg.type === 'error' && onError) onError(new Error(msg.error));
    } catch (_) { /* ignore malformed */ }
  };
  es.onerror = (err) => { if (onError) onError(err); };
  return es;
};

// Event calendar
export const getEventCalendar = ({ start, end, symbol } = {}) => {
  const qs = new URLSearchParams();
  if (start) qs.set('start', start);
  if (end) qs.set('end', end);
  if (symbol) qs.set('symbol', symbol);
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/event-calendar${suffix}`);
};
export const addEventCalendar = (body) =>
  request('/event-calendar', { method: 'POST', body: JSON.stringify(body) });
export const deleteEventCalendar = (id) =>
  request(`/event-calendar/${id}`, { method: 'DELETE' });

// Advanced backtests
export const monteCarloBacktest = (body) =>
  request('/backtest/monte-carlo', { method: 'POST', body: JSON.stringify(body) });
export const optimizeBacktest = (body) =>
  request('/backtest/optimize', { method: 'POST', body: JSON.stringify(body) });
export const regimeBacktest = (body) =>
  request('/backtest/regime', { method: 'POST', body: JSON.stringify(body) });
export const portfolioBacktest = (body) =>
  request('/backtest/portfolio', { method: 'POST', body: JSON.stringify(body) });
export const benchmarkCurve = (symbol, { days = 365, timeframe, initialCapital } = {}) => {
  const qs = new URLSearchParams({ days });
  if (timeframe) qs.set('timeframe', timeframe);
  if (initialCapital) qs.set('initialCapital', initialCapital);
  return request(`/backtest/benchmark/${symbol}?${qs}`);
};

// Hyperopt — async parameter grid search on top of backtests
export const listHyperoptRuns = () => request('/hyperopt');
export const getHyperoptRun   = (id) => request(`/hyperopt/${id}`);
export const startHyperoptRun = (body) =>
  request('/hyperopt', { method: 'POST', body: JSON.stringify(body) });
export const deleteHyperoptRun = (id) =>
  request(`/hyperopt/${id}`, { method: 'DELETE' });

// Outbound webhooks — signed HTTP callbacks on auto-trader events
export const listOutboundWebhooks = () => request('/outbound-webhooks');
export const createOutboundWebhook = (body) =>
  request('/outbound-webhooks', { method: 'POST', body: JSON.stringify(body) });
export const updateOutboundWebhook = (id, body) =>
  request(`/outbound-webhooks/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteOutboundWebhook = (id) =>
  request(`/outbound-webhooks/${id}`, { method: 'DELETE' });
export const testOutboundWebhook = (id) =>
  request(`/outbound-webhooks/${id}/test`, { method: 'POST' });
export const rotateOutboundWebhookSecret = (id) =>
  request(`/outbound-webhooks/${id}/rotate-secret`, { method: 'POST' });

// Strategy-quality analyses — lookahead bias + recursive stability checks
export const analyzeLookahead = (body) =>
  request('/strategy-analysis/lookahead', { method: 'POST', body: JSON.stringify(body) });
export const analyzeRecursive = (body) =>
  request('/strategy-analysis/recursive', { method: 'POST', body: JSON.stringify(body) });

// Protections — per-symbol gate evaluation
export const getProtections = (extraSymbols) => {
  const qs = extraSymbols ? `?symbols=${encodeURIComponent(extraSymbols)}` : '';
  return request(`/protections${qs}`);
};

// Saved backtests — persist + browse prior backtest runs
export const listSavedBacktests = () => request('/saved-backtests');
export const getSavedBacktest = (id) => request(`/saved-backtests/${id}`);
export const createSavedBacktest = (body) =>
  request('/saved-backtests', { method: 'POST', body: JSON.stringify(body) });
export const deleteSavedBacktest = (id) =>
  request(`/saved-backtests/${id}`, { method: 'DELETE' });

// Strategy migrator — freqtrade V2 → V3 source rewriter
export const migrateStrategyV2ToV3 = (source) =>
  request('/strategy-migrate/v2-to-v3', { method: 'POST', body: JSON.stringify({ source }) });

// Edge — per-symbol expectancy/win-rate diagnostics
export const getEdgesAll = ({ lookbackDays, minTrades } = {}) => {
  const qs = new URLSearchParams();
  if (lookbackDays != null) qs.set('lookbackDays', lookbackDays);
  if (minTrades != null)    qs.set('minTrades', minTrades);
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/edge/all${suffix}`);
};

// FreqAI-lite model persistence + walk-forward retraining
export const listAiModels = (symbol) =>
  request(`/freqai-lite/models${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`);
export const saveAiModel = (body) =>
  request('/freqai-lite/save', { method: 'POST', body: JSON.stringify(body) });
export const deleteAiModel = (id) =>
  request(`/freqai-lite/models/${id}`, { method: 'DELETE' });
export const walkForwardAiModel = (body) =>
  request('/freqai-lite/walk-forward', { method: 'POST', body: JSON.stringify(body) });

// Bayesian hyperopt — TPE-lite over strategy-internal params
export const startBayesianHyperopt = (body) =>
  request('/hyperopt/bayesian', { method: 'POST', body: JSON.stringify(body) });

// Producer / Consumer — cross-bot signal publication
export const publishProducerSignal = (producerId, body) =>
  request(`/producer-consumer/producer/${encodeURIComponent(producerId)}`, { method: 'POST', body: JSON.stringify(body) });
export const pollConsumerSignals = (producerId, sinceId) => {
  const qs = sinceId != null ? `?sinceId=${sinceId}` : '';
  return request(`/producer-consumer/consumer/${encodeURIComponent(producerId)}${qs}`);
};

// Exchange adapters — list registered backends
export const listExchanges = () => request('/exchanges');

// Plot commands — chart-ready series derived from a backtest run
const plotQs = ({ strategyKey, symbol, days, timeframe }) => {
  const qs = new URLSearchParams();
  if (strategyKey) qs.set('strategyKey', strategyKey);
  if (symbol)      qs.set('symbol', symbol);
  if (days)        qs.set('days', days);
  if (timeframe)   qs.set('timeframe', timeframe);
  return qs.toString();
};
export const getPlotEquity     = (p) => request(`/plots/equity?${plotQs(p)}`);
export const getPlotDrawdown   = (p) => request(`/plots/drawdown?${plotQs(p)}`);
export const getPlotTrades     = (p) => request(`/plots/trades?${plotQs(p)}`);
export const getPlotIndicators = ({ symbol, days, timeframe }) => {
  const qs = new URLSearchParams();
  if (symbol)    qs.set('symbol', symbol);
  if (days)      qs.set('days', days);
  if (timeframe) qs.set('timeframe', timeframe);
  return request(`/plots/indicators?${qs}`);
};

// User-authored strategies (sandboxed JS)
export const listUserStrategies    = () => request('/user-strategies');
export const getUserStrategy       = (id) => request(`/user-strategies/${id}`);
export const getUserStrategyExample = () => request('/user-strategies/example');
export const createUserStrategy    = (body) =>
  request('/user-strategies', { method: 'POST', body: JSON.stringify(body) });
export const updateUserStrategy    = (id, body) =>
  request(`/user-strategies/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteUserStrategy    = (id) =>
  request(`/user-strategies/${id}`, { method: 'DELETE' });
export const validateUserStrategy  = (body) =>
  request('/user-strategies/validate', { method: 'POST', body: JSON.stringify(body) });
export const backtestUserStrategy  = (id, body) =>
  request(`/user-strategies/${id}/backtest`, { method: 'POST', body: JSON.stringify(body) });
export const inlineBacktestUserStrategy = (body) =>
  request('/user-strategies/inline-backtest', { method: 'POST', body: JSON.stringify(body) });

// Advanced hyperopt — built-in + custom loss, ROI/trailing/indicator spaces
export const listHyperoptLosses = () => request('/hyperopt-adv/losses');
export const validateHyperoptLoss = (body) =>
  request('/hyperopt-adv/validate-loss', { method: 'POST', body: JSON.stringify({ body }) });
export const runAdvancedHyperopt = (body) =>
  request('/hyperopt-adv/run', { method: 'POST', body: JSON.stringify(body) });

// Backtesting-analysis (freqtrade group 0..5)
export const analyzeTrades = ({ group = 0, enterReasons, exitReasons } = {}) => {
  const qs = new URLSearchParams();
  qs.set('group', group);
  if (enterReasons) qs.set('enterReasons', enterReasons);
  if (exitReasons) qs.set('exitReasons', exitReasons);
  return request(`/backtest-analysis/trades?${qs}`);
};
export const analyzeSavedBacktest = (id, { group = 0, enterReasons, exitReasons } = {}) => {
  const qs = new URLSearchParams();
  qs.set('group', group);
  if (enterReasons) qs.set('enterReasons', enterReasons);
  if (exitReasons) qs.set('exitReasons', exitReasons);
  return request(`/backtest-analysis/saved/${id}?${qs}`);
};

// Orderflow — L1-inferred tape + imbalance
export const getOrderflowTrades = (symbol, limit = 100) =>
  request(`/orderflow/${encodeURIComponent(symbol)}/trades?limit=${limit}`);
export const getOrderflowImbalance = (symbol, n = 100) =>
  request(`/orderflow/${encodeURIComponent(symbol)}/imbalance?n=${n}`);

// RL-lite (tabular Q-learning)
export const getRlBuckets    = () => request('/rl-lite/buckets');
export const listRlTables    = () => request('/rl-lite');
export const getRlTable      = (id) => request(`/rl-lite/${id}`);
export const trainRlTable    = (body) => request('/rl-lite/train', { method: 'POST', body: JSON.stringify(body) });
export const evaluateRlTable = (id, body) => request(`/rl-lite/${id}/evaluate`, { method: 'POST', body: JSON.stringify(body) });
export const deleteRlTable   = (id) => request(`/rl-lite/${id}`, { method: 'DELETE' });

// Jupyter export — trigger authenticated downloads of CSV/ipynb artifacts.
// Browsers can't send an Authorization header on a plain <a> click, so we
// fetch the file as a blob and synthesize a download via URL.createObjectURL.
async function downloadAuthed(url, filename) {
  const res = await fetch(`${BASE}${url}`, { headers: headers() });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const downloadSavedBacktestTrades   = (id) => downloadAuthed(`/jupyter/saved/${id}/trades.csv`, `trades-${id}.csv`);
export const downloadSavedBacktestEquity   = (id) => downloadAuthed(`/jupyter/saved/${id}/equity.csv`, `equity-${id}.csv`);
export const downloadSavedBacktestNotebook = (id) => downloadAuthed(`/jupyter/saved/${id}/notebook.ipynb`, `analysis-${id}.ipynb`);
export const downloadLiveTradesCsv         = () => downloadAuthed('/jupyter/live/trades.csv', 'live-trades.csv');
export const downloadBarsCsv = ({ symbol, timeframe = '1Day', days = 365 }) => {
  const qs = new URLSearchParams({ symbol, timeframe, days });
  return downloadAuthed(`/jupyter/bars.csv?${qs}`, `bars-${symbol}-${timeframe}.csv`);
};

// FreqAI Python sidecar (optional external service at FREQAI_PY_URL)
export const getFreqaiSidecarStatus = () => request('/freqai-sidecar/status');
export const listFreqaiSidecarModels = () => request('/freqai-sidecar/models');
export const deleteFreqaiSidecarModel = (id) => request(`/freqai-sidecar/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const trainFreqaiSidecar = (body) => request('/freqai-sidecar/train', { method: 'POST', body: JSON.stringify(body) });
export const predictFreqaiSidecar = (body) => request('/freqai-sidecar/predict', { method: 'POST', body: JSON.stringify(body) });

// Utility sub-commands (freqtrade parity)
export const utilListStrategies = () => request('/util/list-strategies');
export const utilListTimeframes = () => request('/util/list-timeframes');
export const utilListMarkets    = () => request('/util/list-markets');
export const utilListPairs      = () => request('/util/list-pairs');
export const utilListData       = (symbol, { timeframe = '1Day', days = 30 } = {}) => {
  const qs = new URLSearchParams({ timeframe, days });
  return request(`/util/list-data/${encodeURIComponent(symbol)}?${qs}`);
};
export const utilShowTrades     = (limit = 50) => request(`/util/show-trades?limit=${limit}`);
export const utilTestPairlist   = (symbols) =>
  request('/util/test-pairlist', { method: 'POST', body: JSON.stringify({ symbols }) });
export const utilHyperoptList   = () => request('/util/hyperopt-list');
export const utilHyperoptShow   = (id) => request(`/util/hyperopt-show/${id}`);

// Leverage / margin
export const calcLeverage     = (body) =>
  request('/leverage/calc', { method: 'POST', body: JSON.stringify(body) });
export const listLeverageTrades = () => request('/leverage/trades');

// External docs mirror (freqtrade, etc.)
export const listDocsSources = () => request('/docs/sources');
export const getDocsToc = (source) => request(`/docs/${source}/toc`);
export const getDocsPage = (source, slug) =>
  request(`/docs/${source}/page/${encodeURIComponent(slug || '')}`);
export const searchDocs = (source, q) =>
  request(`/docs/${source}/search?q=${encodeURIComponent(q)}`);
export const getDocsExcerpt = (source, slug) =>
  request(`/docs/${source}/excerpt/${encodeURIComponent(slug || '')}`);
export const refreshDocs = (source, { force, mode } = {}) => {
  const qs = [];
  if (force) qs.push('force=1');
  if (mode) qs.push(`mode=${encodeURIComponent(mode)}`);
  const suffix = qs.length ? `?${qs.join('&')}` : '';
  return request(`/docs/${source}/refresh${suffix}`, { method: 'POST' });
};
