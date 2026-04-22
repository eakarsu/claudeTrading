import { describe, it, expect } from 'vitest';
import { SMA, EMA, RSI, ADX } from '../services/indicators.js';

describe('SMA', () => {
  it('returns null for indices before period-1', () => {
    const out = SMA([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10);
  });

  it('computes a rolling mean', () => {
    const out = SMA([2, 4, 6, 8, 10], 2);
    expect(out[1]).toBe(3);
    expect(out[2]).toBe(5);
    expect(out[4]).toBe(9);
  });
});

describe('EMA', () => {
  it('seeds with SMA at period-1', () => {
    const out = EMA([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10); // seed = SMA of first 3
  });

  it('responds more to recent values than SMA', () => {
    const closes = [10, 10, 10, 10, 20]; // sudden jump at end
    const sma = SMA(closes, 3);
    const ema = EMA(closes, 3);
    expect(ema[4]).toBeGreaterThan(sma[4]);
  });
});

describe('RSI', () => {
  it('returns 100 for strictly rising closes', () => {
    const closes = Array.from({ length: 30 }, (_, i) => i + 1);
    const out = RSI(closes, 14);
    // No losses → avgLoss is 0 → RSI = 100.
    expect(out[out.length - 1]).toBeCloseTo(100, 5);
  });

  it('returns nulls when history is too short', () => {
    const out = RSI([1, 2, 3], 14);
    expect(out.every((v) => v === null)).toBe(true);
  });
});

describe('ADX', () => {
  it('returns nulls when history is shorter than 2*period', () => {
    const h = Array.from({ length: 10 }, (_, i) => 100 + i);
    const l = h.map((x) => x - 1);
    const c = h;
    const out = ADX(h, l, c, 14);
    // No bar has enough history to produce a real ADX — all nulls.
    expect(out.every((v) => v === null)).toBe(true);
  });

  it('is > 25 on a strong trend and stays in [0, 100]', () => {
    // Stair-step up: every bar makes a clean higher-high, higher-low.
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    const highs = closes.map((c) => c + 1);
    const lows = closes.map((c) => c - 1);
    const out = ADX(highs, lows, closes, 14);
    const last = out[out.length - 1];
    expect(last).not.toBeNull();
    expect(last).toBeGreaterThan(25);
    expect(last).toBeLessThanOrEqual(100);
  });

  it('is low on a flat market', () => {
    const closes = new Array(60).fill(100);
    const highs = closes.map(() => 100.1);
    const lows = closes.map(() => 99.9);
    const out = ADX(highs, lows, closes, 14);
    const last = out[out.length - 1];
    // Flat ≈ no directional pressure → very small ADX (not trending).
    expect(last).toBeLessThan(25);
  });
});
