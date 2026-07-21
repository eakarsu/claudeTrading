import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.BROKER_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');

const {
  DEFAULT_RISK_POLICY, applyBrokerEvent, decryptCredentials, encryptCredentials,
  evaluateOrderRisk, normalizeRiskPolicy, strategyPromotionDecision,
} = await import('../services/brokerGovernance.js');
const { BrokerOrderEvent } = await import('../models/index.js');
const { ALPACA_ENDPOINTS, createAlpacaClient } = await import('../services/alpaca.js');

const identity = { userId: 12, accountId: 'acct-1', environment: 'paper' };
const account = { equity: '100000', last_equity: '100000', buying_power: '50000' };
const freshQuote = () => ({ p: 100, t: new Date().toISOString() });

describe('broker credential isolation', () => {
  it('round-trips credentials using authenticated encryption', () => {
    const envelope = encryptCredentials({ apiKey: 'key-123', apiSecret: 'secret-123' }, identity);
    expect(envelope).not.toContain('secret-123');
    expect(decryptCredentials(envelope, identity)).toEqual({ apiKey: 'key-123', apiSecret: 'secret-123' });
  });

  it('rejects ciphertext moved to another user or environment', () => {
    const envelope = encryptCredentials({ apiKey: 'key-123', apiSecret: 'secret-123' }, identity);
    expect(() => decryptCredentials(envelope, { ...identity, userId: 13 })).toThrow(/authenticated/);
    expect(() => decryptCredentials(envelope, { ...identity, environment: 'live' })).toThrow(/authenticated/);
  });

  it('rejects tampered envelopes', () => {
    const envelope = encryptCredentials({ apiKey: 'key-123', apiSecret: 'secret-123' }, identity);
    const tampered = `${envelope.slice(0, -2)}AA`;
    expect(() => decryptCredentials(tampered, identity)).toThrow(/authenticated/);
  });
});

describe('application risk gate', () => {
  const base = (overrides = {}) => ({
    policy: DEFAULT_RISK_POLICY, account, positions: [], quote: freshQuote(),
    order: { symbol: 'AAPL', qty: 10 }, recentOrderCount: 0, ...overrides,
  });

  it('accepts a fresh, bounded order', () => {
    expect(evaluateOrderRisk(base())).toBeNull();
  });

  it('fails closed when account, positions, or quote is unavailable', () => {
    expect(evaluateOrderRisk(base({ account: null }))).toMatch(/unavailable/);
    expect(evaluateOrderRisk(base({ positions: null }))).toMatch(/unavailable/);
    expect(evaluateOrderRisk(base({ quote: null }))).toMatch(/unavailable/);
  });

  it('rejects stale and future-dated market data', () => {
    expect(evaluateOrderRisk(base({ quote: { p: 100, t: new Date(Date.now() - 20_000) } }))).toMatch(/stale/);
    expect(evaluateOrderRisk(base({ quote: { p: 100, t: new Date(Date.now() + 10_000) } }))).toMatch(/future/);
  });

  it('enforces loss, broker-block, and order-rate limits', () => {
    expect(evaluateOrderRisk(base({ account: { ...account, equity: 99000 } }))).toMatch(/loss/);
    expect(evaluateOrderRisk(base({ account: { ...account, trading_blocked: true } }))).toMatch(/blocked/);
    expect(evaluateOrderRisk(base({ recentOrderCount: 10 }))).toMatch(/rate/);
  });

  it('enforces notional, buying-power, and gross-exposure limits', () => {
    expect(evaluateOrderRisk(base({ order: { symbol: 'AAPL', qty: 60 } }))).toMatch(/notional/);
    expect(evaluateOrderRisk(base({
      policy: { ...DEFAULT_RISK_POLICY, maxOrderNotional: 100000 },
      account: { ...account, buying_power: 1000 }, order: { symbol: 'AAPL', qty: 20 },
    }))).toMatch(/buying power/);
    expect(evaluateOrderRisk(base({ positions: [{ symbol: 'MSFT', market_value: 24900 }] }))).toMatch(/Gross/);
  });

  it('enforces leverage and symbol concentration independently', () => {
    expect(evaluateOrderRisk(base({
      policy: { ...DEFAULT_RISK_POLICY, maxGrossExposure: 200000, maxLeverage: 0.2 },
      positions: [{ symbol: 'MSFT', market_value: 19500 }],
    }))).toMatch(/Leverage/);
    expect(evaluateOrderRisk(base({
      order: { symbol: 'AAPL', qty: 10 }, positions: [{ symbol: 'AAPL', market_value: 24500 }],
      policy: { ...DEFAULT_RISK_POLICY, maxGrossExposure: 200000 },
    }))).toMatch(/Concentration/);
  });

  it('rejects attempts to disable hard ceilings with zero or excess values', () => {
    expect(() => normalizeRiskPolicy({ maxDailyLoss: 0 })).toThrow(/positive/);
    expect(() => normalizeRiskPolicy({ maxLeverage: 5 })).toThrow(/hard ceiling/);
    expect(() => normalizeRiskPolicy({ maxQuoteAgeMs: 60001 })).toThrow(/hard ceiling/);
  });
});

describe('strategy promotion gate', () => {
  const passing = {
    datasetLicense: 'licensed-point-in-time-vendor-feed', survivorshipSafe: true,
    walkForwardWindows: 8,
    costModel: { commissionBps: 1, slippageBps: 5, marketImpactBps: 3 },
    stressResults: Object.fromEntries(['gapDown', 'volatilitySpike', 'delayedFill', 'liquidityShock'].map((name) => [name, { passed: true }])),
    monitoredPaperDays: 45,
    paperMetrics: { trades: 180, maxDrawdownPct: 0.08 },
  };

  it('passes only complete walk-forward, cost, stress, and monitored-paper evidence', () => {
    expect(strategyPromotionDecision(passing)).toEqual({ passed: true, reasons: [] });
  });

  it('returns every missing promotion condition for supervision', () => {
    const decision = strategyPromotionDecision({ ...passing, survivorshipSafe: false, walkForwardWindows: 2, monitoredPaperDays: 3, stressResults: {} });
    expect(decision.passed).toBe(false);
    expect(decision.reasons.length).toBeGreaterThanOrEqual(7);
  });
});

describe('Alpaca broker contract and chaos behavior', () => {
  it('hard-binds paper and live adapters to distinct official endpoints', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url);
      return { ok: true, text: async () => JSON.stringify({ id: 'acct' }) };
    });
    await createAlpacaClient({ apiKey: 'paper-key', apiSecret: 'paper-secret', environment: 'paper', fetchImpl }).getAccount();
    await createAlpacaClient({ apiKey: 'live-key', apiSecret: 'live-secret', environment: 'live', fetchImpl }).getAccount();
    expect(calls[0]).toBe(`${ALPACA_ENDPOINTS.paper}/v2/account`);
    expect(calls[1]).toBe(`${ALPACA_ENDPOINTS.live}/v2/account`);
  });

  it('retries an idempotent network-partitioned submit with the same client id', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network partition'))
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: 'broker-1', status: 'accepted' }) });
    const client = createAlpacaClient({ apiKey: 'paper-key', apiSecret: 'paper-secret', environment: 'paper', fetchImpl });
    const result = await client.placeOrder({ symbol: 'AAPL', qty: 1, side: 'buy', client_order_id: 'stable-client-order' });
    expect(result.id).toBe('broker-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).client_order_id).toBe('stable-client-order');
    expect(fetchImpl.mock.calls[1][1].body).toBe(fetchImpl.mock.calls[0][1].body);
  });

  it('does not retry broker throttling responses as a new write', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ message: 'rate limited' }) }));
    const client = createAlpacaClient({ apiKey: 'paper-key', apiSecret: 'paper-secret', environment: 'paper', fetchImpl });
    await expect(client.placeOrder({ symbol: 'AAPL', qty: 1, side: 'buy', client_order_id: 'rate-limit-order' })).rejects.toThrow(/rate limited/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('out-of-order event monotonicity', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('ignores a delayed accepted event after a partial fill', async () => {
    vi.spyOn(BrokerOrderEvent, 'findOrCreate').mockResolvedValue([{ id: 1 }, true]);
    const order = {
      id: 7, status: 'partially_filled', filledQty: 4, lastEventSequence: 8,
      update: vi.fn(async function update(values) { Object.assign(this, values); }),
    };
    const result = await applyBrokerEvent(order, {
      id: 'broker-7', status: 'accepted', sequence: 2, filled_qty: 0,
      updated_at: new Date(Date.now() - 30_000).toISOString(),
    });
    expect(result.changed).toBe(false);
    expect(order.update).not.toHaveBeenCalled();
  });

  it('allows a delayed full-fill fact to supersede a cancel event', async () => {
    vi.spyOn(BrokerOrderEvent, 'findOrCreate').mockResolvedValue([{ id: 2 }, true]);
    const order = {
      id: 8, status: 'canceled', filledQty: 2, lastEventSequence: 9,
      update: vi.fn(async function update(values) { Object.assign(this, values); }),
    };
    const result = await applyBrokerEvent(order, {
      id: 'broker-8', status: 'filled', sequence: 4, filled_qty: 5, filled_avg_price: 101,
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(result.changed).toBe(true);
    expect(order.status).toBe('filled');
    expect(order.filledQty).toBe(5);
  });

  it('deduplicates replayed webhook events', async () => {
    vi.spyOn(BrokerOrderEvent, 'findOrCreate').mockResolvedValue([{ id: 3 }, false]);
    const order = { id: 9, status: 'submitted', filledQty: 0, update: vi.fn() };
    const result = await applyBrokerEvent(order, { eventKey: 'already-seen', status: 'filled' });
    expect(result.duplicate).toBe(true);
    expect(order.update).not.toHaveBeenCalled();
  });
});
