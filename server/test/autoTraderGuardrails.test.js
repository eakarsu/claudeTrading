import { describe, it, expect, vi } from 'vitest';

// Mock the heavy deps so autoTrader.js can load in isolation — we're only
// exercising the pure `exposureKillSwitch` function here.
vi.mock('../services/alpaca.js', () => ({}));
vi.mock('../services/priceCache.js', () => ({}));
vi.mock('../services/indicators.js', () => ({ computeAll: () => ({}) }));
vi.mock('../services/strategyEngine.js', () => ({ runStrategy: () => [], STRATEGIES: {} }));
vi.mock('../services/notifier.js', () => ({ notifier: { orderFilled: vi.fn(), killSwitchTriggered: vi.fn() } }));
vi.mock('../services/notifications.js', () => ({ createNotification: vi.fn() }));
vi.mock('../services/kelly.js', () => ({ kellyFractionForUser: vi.fn() }));
vi.mock('../services/correlation.js', () => ({ correlationMultiplier: vi.fn() }));
vi.mock('../models/index.js', () => ({
  AutoTraderState: { findOrCreate: vi.fn() },
  AutoTraderTrade: { count: vi.fn(), create: vi.fn() },
}));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { exposureKillSwitch } = await import('../services/autoTrader.js');

describe('exposureKillSwitch', () => {
  const emptyAccount = { equity: 100000, last_equity: 100000 };

  it('returns null when no guardrails are configured', () => {
    const cfg = {};
    const positions = [
      { symbol: 'AAPL', qty: '-72', market_value: '-19000' },
      { symbol: 'MSFT', qty: '10',  market_value: '4000'   },
    ];
    expect(exposureKillSwitch(cfg, emptyAccount, positions)).toBeNull();
  });

  it('trips maxShortExposureDollars when short book exceeds the cap', () => {
    const cfg = { maxShortExposureDollars: 10000 };
    const positions = [
      { symbol: 'AAPL', qty: '-72', market_value: '-19000' },
      { symbol: 'MSFT', qty: '10',  market_value: '4000'   },
    ];
    const reason = exposureKillSwitch(cfg, emptyAccount, positions);
    expect(reason).toMatch(/Short exposure/);
    expect(reason).toMatch(/19000/);
  });

  it('does NOT trip maxShortExposureDollars when long positions are the big ones', () => {
    const cfg = { maxShortExposureDollars: 10000 };
    const positions = [
      { symbol: 'MSFT', qty: '100', market_value: '40000' },
      { symbol: 'AAPL', qty: '-10', market_value: '-2700' },
    ];
    expect(exposureKillSwitch(cfg, emptyAccount, positions)).toBeNull();
  });

  it('trips maxTotalExposureDollars when aggregate book exceeds the cap', () => {
    const cfg = { maxTotalExposureDollars: 20000 };
    const positions = [
      { symbol: 'AAPL', qty: '-72', market_value: '-19000' },
      { symbol: 'MSFT', qty: '10',  market_value: '4000'   },
    ];
    const reason = exposureKillSwitch(cfg, emptyAccount, positions);
    expect(reason).toMatch(/Total exposure/);
  });

  it('trips maxShortPositions when short count exceeds the cap', () => {
    const cfg = { maxShortPositions: 2 };
    const positions = [
      { symbol: 'AAPL', qty: '-1', market_value: '-190' },
      { symbol: 'MSFT', qty: '-1', market_value: '-410' },
      { symbol: 'NVDA', qty: '-1', market_value: '-148' },
    ];
    const reason = exposureKillSwitch(cfg, emptyAccount, positions);
    expect(reason).toMatch(/Short positions \(3\)/);
  });

  it('trips stopOnDrawdownPct when equity falls below threshold', () => {
    const cfg = { stopOnDrawdownPct: 0.05 }; // -5%
    const account = { equity: 94000, last_equity: 100000 }; // -6%
    const reason = exposureKillSwitch(cfg, account, []);
    expect(reason).toMatch(/Drawdown/);
    expect(reason).toMatch(/-6\.00%/);
  });

  it('does NOT trip drawdown when account data is missing', () => {
    const cfg = { stopOnDrawdownPct: 0.05 };
    expect(exposureKillSwitch(cfg, null, [])).toBeNull();
    expect(exposureKillSwitch(cfg, { equity: undefined }, [])).toBeNull();
  });

  it('does NOT trip any guardrail when positions is not an array', () => {
    const cfg = { maxShortExposureDollars: 1, maxTotalExposureDollars: 1, maxShortPositions: 0 };
    expect(exposureKillSwitch(cfg, emptyAccount, null)).toBeNull();
    expect(exposureKillSwitch(cfg, emptyAccount, undefined)).toBeNull();
  });

  it('null/0 values disable the corresponding guardrail', () => {
    const cfg = {
      maxShortExposureDollars: null,
      maxTotalExposureDollars: 0,
      maxShortPositions: null,
      stopOnDrawdownPct: null,
    };
    const positions = [{ symbol: 'AAPL', qty: '-999', market_value: '-999999' }];
    expect(exposureKillSwitch(cfg, emptyAccount, positions)).toBeNull();
  });
});
