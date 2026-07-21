import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePg = testDatabaseUrl ? describe : describe.skip;

describePg('governed broker execution — real PostgreSQL', () => {
  let sequelize;
  let migrator;
  let models;
  let governance;
  let owner;
  let connection;
  let liveConnection;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.BROKER_CREDENTIALS_KEY = Buffer.alloc(32, 11).toString('base64');
    ({ default: sequelize } = await import('../db.js'));
    ({ migrator } = await import('../migrations/umzug.js'));
    models = await import('../models/index.js');
    governance = await import('../services/brokerGovernance.js');
    await sequelize.authenticate();
    await migrator.up();
    await sequelize.sync();

    await models.BrokerOrderEvent.destroy({ where: {} });
    await models.BrokerOrder.destroy({ where: {} });
    await models.ReconciliationRun.destroy({ where: {} });
    await models.KillSwitchDrill.destroy({ where: {} });
    await models.LiveActivation.destroy({ where: {} });
    await models.StrategyValidation.destroy({ where: {} });
    await models.BrokerConnection.destroy({ where: {} });
    owner = await models.User.create({ email: 'governance-owner@example.test', password: 'not-a-real-hash', name: 'Owner' });
    const identity = { userId: owner.id, accountId: 'paper-account-1', environment: 'paper' };
    connection = await models.BrokerConnection.create({
      ...identity,
      broker: 'alpaca', status: 'active', verifiedAt: new Date(),
      credentialsCiphertext: governance.encryptCredentials({ apiKey: 'paper-key', apiSecret: 'paper-secret' }, identity),
      riskPolicy: governance.DEFAULT_RISK_POLICY,
    });
  }, 30_000);

  afterAll(async () => {
    if (!sequelize) return;
    await models.BrokerOrderEvent.destroy({ where: {} });
    await models.BrokerOrder.destroy({ where: {} });
    await models.ReconciliationRun.destroy({ where: {} });
    await models.KillSwitchDrill.destroy({ where: {} });
    await models.LiveActivation.destroy({ where: {} });
    await models.StrategyValidation.destroy({ where: {} });
    await models.BrokerConnection.destroy({ where: {} });
    await models.User.destroy({ where: { email: [
      'governance-owner@example.test', 'governance-other@example.test',
      'governance-operator@example.test', 'governance-compliance@example.test',
    ] } });
    await sequelize.close();
  });

  it('replays the additive migration without changing an applied schema', async () => {
    const secondRun = await migrator.up();
    expect(secondRun).toEqual([]);
    const columns = await sequelize.getQueryInterface().describeTable('BrokerOrders');
    expect(columns.clientOrderId.allowNull).toBe(false);
    expect(columns.request.type).toMatch(/JSONB/i);
  });

  it('persists exactly one order and one submission for an idempotency key', async () => {
    const brokerSubmit = vi.fn(async (request) => ({
      id: 'broker-order-1', client_order_id: request.client_order_id,
      status: 'accepted', filled_qty: '0', updated_at: new Date().toISOString(),
    }));
    const context = {
      connection,
      client: {
        getAccount: vi.fn(async () => ({ equity: '100000', last_equity: '100000', buying_power: '50000' })),
        getPositions: vi.fn(async () => []),
        getLatestTrades: vi.fn(async () => ({ AAPL: { p: 100, t: new Date().toISOString() } })),
        placeOrder: brokerSubmit,
      },
    };
    const request = { symbol: 'AAPL', qty: 10, side: 'buy', type: 'market', client_order_id: 'pg-idempotent-order' };
    const first = await governance.executeGovernedOrder(owner.id, 'paper', request, { context });
    const second = await governance.executeGovernedOrder(owner.id, 'paper', request, { context });
    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(brokerSubmit).toHaveBeenCalledTimes(1);
    expect(await models.BrokerOrder.count({ where: { clientOrderId: request.client_order_id } })).toBe(1);
    expect(await models.BrokerOrderEvent.count({ where: { brokerOrderId: first.order.id } })).toBe(1);
  });

  it('survives partial, duplicate, and out-of-order events transactionally', async () => {
    const order = await models.BrokerOrder.create({
      userId: owner.id, connectionId: connection.id, clientOrderId: 'pg-event-order',
      brokerOrderId: 'broker-event-order', environment: 'paper', symbol: 'MSFT', side: 'buy',
      orderType: 'market', qty: 5, status: 'submitted', request: {},
    });
    await sequelize.transaction(async (transaction) => {
      await governance.applyBrokerEvent(order, {
        eventKey: 'partial-1', id: 'broker-event-order', status: 'partially_filled',
        filled_qty: '2', filled_avg_price: '401', sequence: 5, updated_at: new Date().toISOString(),
      }, transaction);
    });
    await sequelize.transaction(async (transaction) => {
      await governance.applyBrokerEvent(order, {
        eventKey: 'old-accepted', id: 'broker-event-order', status: 'accepted',
        filled_qty: '0', sequence: 2, updated_at: new Date(Date.now() - 60_000).toISOString(),
      }, transaction);
    });
    const replay = await sequelize.transaction((transaction) => governance.applyBrokerEvent(order, {
      eventKey: 'partial-1', id: 'broker-event-order', status: 'partially_filled', filled_qty: '2', sequence: 5,
    }, transaction));
    await order.reload();
    expect(order.status).toBe('partially_filled');
    expect(Number(order.filledQty)).toBe(2);
    expect(replay.duplicate).toBe(true);
  });

  it('materializes broker-created bracket legs as independently reconciled ledger rows', async () => {
    await models.BrokerOrder.create({
      userId: owner.id, connectionId: connection.id, clientOrderId: 'pg-bracket-parent',
      brokerOrderId: 'broker-bracket-parent', environment: 'paper', symbol: 'NVDA', side: 'buy',
      orderType: 'market', qty: 3, status: 'filled', filledQty: 3, request: { order_class: 'bracket' },
    });
    const context = {
      connection,
      client: {
        getOrders: vi.fn(async () => [{
          id: 'broker-bracket-parent', client_order_id: 'pg-bracket-parent', status: 'filled',
          filled_qty: '3', updated_at: new Date().toISOString(),
          legs: [{
            id: 'broker-stop-leg', symbol: 'NVDA', side: 'sell', type: 'stop', qty: '3',
            status: 'filled', filled_qty: '3', filled_avg_price: '95', updated_at: new Date().toISOString(),
          }],
        }]),
        getAccount: vi.fn(async () => ({ id: connection.accountId, equity: '100000' })),
        getPositions: vi.fn(async () => []),
      },
    };
    const run = await governance.reconcileConnection(owner.id, connection.id, { context });
    const leg = await models.BrokerOrder.findOne({ where: { connectionId: connection.id, brokerOrderId: 'broker-stop-leg' } });
    expect(run.orphanOrderCount).toBe(0);
    expect(leg.status).toBe('filled');
    expect(leg.request.parentBrokerOrderId).toBe('broker-bracket-parent');
  });

  it('activates the account kill switch when reconciliation finds an orphan broker order', async () => {
    const context = {
      connection,
      client: {
        getOrders: vi.fn(async () => [{ id: 'unowned-order', client_order_id: 'external-order', status: 'accepted' }]),
        getAccount: vi.fn(async () => ({ id: connection.accountId, equity: '100000' })),
        getPositions: vi.fn(async () => []),
      },
    };
    const run = await governance.reconcileConnection(owner.id, connection.id, { context });
    await connection.reload();
    expect(run.status).toBe('succeeded');
    expect(run.orphanOrderCount).toBe(1);
    expect(connection.killSwitchActive).toBe(true);
  });

  it('requires two distinct supervision roles for a time-limited live activation', async () => {
    const operator = await models.User.create({ email: 'governance-operator@example.test', password: 'hash', role: 'operator' });
    const compliance = await models.User.create({ email: 'governance-compliance@example.test', password: 'hash', role: 'compliance' });
    const validationInput = {
      strategy: 'walk-forward-approved', version: '1.0.0',
      datasetLicense: 'licensed-point-in-time-feed', survivorshipSafe: true,
      walkForwardWindows: 8,
      costModel: { commissionBps: 1, slippageBps: 5, marketImpactBps: 3 },
      stressResults: Object.fromEntries(['gapDown', 'volatilitySpike', 'delayedFill', 'liquidityShock'].map((name) => [name, { passed: true }])),
      monitoredPaperDays: 45, paperMetrics: { trades: 160, maxDrawdownPct: 0.09 },
      expiresAt: new Date(Date.now() + 86400000),
    };
    const { validation } = await governance.saveStrategyValidation(owner.id, validationInput, operator.id);
    const liveIdentity = { userId: owner.id, accountId: 'live-account-1', environment: 'live' };
    liveConnection = await models.BrokerConnection.create({
      ...liveIdentity, broker: 'alpaca', status: 'active', verifiedAt: new Date(),
      lastReauthenticatedAt: new Date(), lastReconciledAt: new Date(), brokerLimitsVerifiedAt: new Date(),
      credentialsCiphertext: governance.encryptCredentials({ apiKey: 'live-key', apiSecret: 'live-secret' }, liveIdentity),
      riskPolicy: governance.DEFAULT_RISK_POLICY,
    });
    const activation = await governance.requestLiveActivation(owner.id, {
      connectionId: liveConnection.id, strategyValidationId: validation.id,
      disclosureVersion: governance.DISCLOSURE_VERSION, acceptDisclosure: true, jurisdiction: 'US-NY',
    });
    await governance.approveLiveActivation(activation.id, operator);
    await activation.reload();
    expect(activation.status).toBe('pending');
    await governance.approveLiveActivation(activation.id, compliance);
    await activation.reload();
    expect(activation.status).toBe('approved');
    expect(activation.operatorApprovedBy).not.toBe(activation.complianceApprovedBy);
  });

  it('keeps the deployment-level live gate closed even after workflow approval', async () => {
    process.env.LIVE_TRADING_ENABLED = 'false';
    await expect(governance.assertExecutionReady(liveConnection)).rejects.toThrow(/deployment level/);
    process.env.LIVE_TRADING_ENABLED = 'true';
    await expect(governance.assertExecutionReady(liveConnection)).resolves.toBeUndefined();
    process.env.LIVE_TRADING_ENABLED = 'false';
  });

  it('prevents two users from claiming the same broker account and environment', async () => {
    const other = await models.User.create({ email: 'governance-other@example.test', password: 'not-a-real-hash' });
    const identity = { userId: other.id, accountId: connection.accountId, environment: 'paper' };
    await expect(models.BrokerConnection.create({
      ...identity, broker: 'alpaca', status: 'active', verifiedAt: new Date(),
      credentialsCiphertext: governance.encryptCredentials({ apiKey: 'other-key', apiSecret: 'other-secret' }, identity),
      riskPolicy: governance.DEFAULT_RISK_POLICY,
    })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
  });
});
