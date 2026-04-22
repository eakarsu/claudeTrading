import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock every external dependency so autoTrader.js can load without touching
// Postgres, Alpaca, or the price cache. Every fake returns the minimum shape
// the production code inspects.
vi.mock('../services/alpaca.js', () => ({
  getClock: vi.fn(async () => ({ is_open: true, next_close: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() })),
  getPositions: vi.fn(async () => []),
  getOrders: vi.fn(async () => []),
  cancelAllOrders: vi.fn(async () => ({})),
  closePosition: vi.fn(async () => ({ id: 'close-1' })),
  placeOrder: vi.fn(async () => ({ id: 'order-1' })),
  placeTrailingStop: vi.fn(async () => ({ id: 'trail-1' })),
  getBars: vi.fn(async () => []),
}));

vi.mock('../services/priceCache.js', () => ({
  getLatestTradePrices: vi.fn(async () => ({})),
}));

vi.mock('../services/indicators.js', () => ({
  computeAll: vi.fn(() => ({ adx: [] })),
}));

vi.mock('../services/strategyEngine.js', () => ({
  runStrategy: vi.fn(() => []),
  STRATEGIES: {
    test: { name: 'Test Strategy', fn: () => [] },
  },
}));

// Minimal Sequelize-like stub — autoTrader only calls findOrCreate/count/findAll/findOne/create/update.
const stateRow = {
  running: false,
  activeStrategy: null,
  symbols: [],
  config: {},
  dailyPnl: 0,
  consecutiveLosses: 0,
  startedAt: null,
  killedReason: null,
  update: vi.fn(async function (patch) { Object.assign(this, patch); return this; }),
};

vi.mock('../models/index.js', () => ({
  AutoTraderState: {
    findOrCreate: vi.fn(async () => [stateRow]),
  },
  AutoTraderTrade: {
    count: vi.fn(async () => 0),
    findAll: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 1 })),
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import AFTER mocks so the module sees fakes.
const autoTrader = await import('../services/autoTrader.js');
const { _resetForTests, startAutoTrader, stopAutoTrader, getAutoTraderStatus } = autoTrader;

beforeEach(() => {
  _resetForTests();
  stateRow.running = false;
  stateRow.activeStrategy = null;
  stateRow.symbols = [];
  stateRow.config = {};
  stateRow.dailyPnl = 0;
  stateRow.consecutiveLosses = 0;
  stateRow.killedReason = null;
});

const USER_ID = 1;

describe('autoTrader — public API', () => {
  it('rejects unknown strategies', async () => {
    await expect(startAutoTrader(USER_ID, '__nope__', ['TSLA'])).rejects.toThrow(/Unknown strategy/);
  });

  it('start → stop flips state.running', async () => {
    const started = await startAutoTrader(USER_ID, 'test', ['TSLA'], { checkIntervalMs: 60_000_000 });
    expect(started.status).toBe('started');
    expect(stateRow.running).toBe(true);
    const stopped = await stopAutoTrader(USER_ID);
    expect(stopped.status).toBe('stopped');
    expect(stateRow.running).toBe(false);
  });

  it('getAutoTraderStatus returns a summary block even with no trades', async () => {
    const status = await getAutoTraderStatus(USER_ID);
    expect(status.summary).toBeDefined();
    expect(status.summary.realizedPnl).toBe(0);
    expect(status.summary.totalTrades).toBe(0);
    expect(status.summary.winRate).toBe(0);
    expect(Array.isArray(status.summary.perSymbol)).toBe(true);
  });

  it('summary aggregates realized P&L from sell trades', async () => {
    const models = await import('../models/index.js');
    models.AutoTraderTrade.findAll.mockResolvedValueOnce([
      { toJSON: () => ({ id: 1, action: 'sell', pnl: 50, symbol: 'TSLA' }) },
    ]);
    // Second findAll call is the sells aggregate query.
    models.AutoTraderTrade.findAll.mockResolvedValueOnce([
      { pnl: 50, symbol: 'TSLA', createdAt: new Date() },
      { pnl: -10, symbol: 'AAPL', createdAt: new Date() },
      { pnl: 25, symbol: 'TSLA', createdAt: new Date() },
    ]);

    const status = await getAutoTraderStatus(USER_ID);
    expect(status.summary.totalTrades).toBe(3);
    expect(status.summary.wins).toBe(2);
    expect(status.summary.losses).toBe(1);
    expect(status.summary.realizedPnl).toBeCloseTo(65, 2);
    expect(status.summary.perSymbol.length).toBeGreaterThan(0);
  });
});
