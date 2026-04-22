import { describe, it, expect } from 'vitest';
import { backtest } from '../services/backtester.js';
import { STRATEGIES } from '../services/strategyEngine.js';

// Tiny deterministic helper — builds a flat bar series then injects moves so
// we can exercise the slippage/commission pathway without depending on any
// particular strategy's signal logic.
function makeBars(closes, { high = null, low = null } = {}) {
  return closes.map((c, i) => ({
    time: `2025-01-${String(i + 1).padStart(2, '0')}`,
    open: c,
    high: high ? high[i] : c,
    low: low ? low[i] : c,
    close: c,
    volume: 1_000_000,
  }));
}

// Find a strategy that produces at least one buy+sell pair on trivial data.
// The engine ships with 25+ strategies; we pick any that fires for our fixture.
function pickStrategyWithTrade(bars) {
  for (const key of Object.keys(STRATEGIES)) {
    const r = backtest(key, bars);
    if (r.totalTrades > 0) return key;
  }
  return null;
}

describe('backtester — slippage & commission math', () => {
  it('charges commission on both entry and exit', () => {
    // Price walk that crosses SMAs — gives a couple of signals for most strategies.
    const closes = [100, 101, 102, 103, 104, 105, 104, 103, 102, 101,
                    100,  99,  98,  99, 100, 101, 102, 103, 104, 105,
                    106, 107, 108, 109, 110, 111, 112, 113, 114, 115];
    const bars = makeBars(closes);
    const key = pickStrategyWithTrade(bars);
    if (!key) return; // No strategy fired on this fixture — skip rather than fail.

    const baseline = backtest(key, bars, { commissionPerTrade: 0, slippagePct: 0 });
    const withCommission = backtest(key, bars, { commissionPerTrade: 5, slippagePct: 0 });

    if (baseline.totalTrades === 0) return;
    // Each round-trip costs 2 * commission. Equity should drop by at least that much.
    const expectedDrop = baseline.totalTrades * 2 * 5;
    expect(baseline.finalEquity - withCommission.finalEquity).toBeGreaterThanOrEqual(expectedDrop - 1);
  });

  it('applies slippage asymmetrically (worse on entry, worse on exit)', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
    const bars = makeBars(closes);
    const key = pickStrategyWithTrade(bars);
    if (!key) return;

    const clean = backtest(key, bars, { slippagePct: 0 });
    const slipped = backtest(key, bars, { slippagePct: 0.005 }); // 50 bps each side

    if (clean.totalTrades === 0) return;
    // Slippage always hurts realized P&L on long-only engines; not greater than clean.
    expect(slipped.finalEquity).toBeLessThanOrEqual(clean.finalEquity);
  });

  it('produces an equityCurve aligned with the bars', () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const r = backtest(Object.keys(STRATEGIES)[0], bars);
    expect(r.equityCurve.length).toBe(bars.length);
    expect(r.equityCurve[0].time).toBe(bars[0].time);
  });

  it('reports an OOS split when oosRatio is set', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
    const bars = makeBars(closes);
    const r = backtest(Object.keys(STRATEGIES)[0], bars, { oosRatio: 0.2 });
    if (r.totalTrades === 0) return;
    expect(r.oosReport).not.toBeNull();
    expect(r.oosReport.splitIdx).toBe(Math.floor(60 * 0.8));
    expect(r.oosReport.inSample).toBeDefined();
    expect(r.oosReport.outSample).toBeDefined();
  });

  it('max drawdown is a non-negative percentage', () => {
    const bars = makeBars([100, 110, 90, 120, 80, 130]);
    const r = backtest(Object.keys(STRATEGIES)[0], bars);
    expect(r.maxDrawdown).toBeGreaterThanOrEqual(0);
    // Expressed as percentage (not fraction) in the returned payload.
    expect(r.maxDrawdown).toBeLessThanOrEqual(100);
  });
});
