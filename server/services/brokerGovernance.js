import crypto from 'node:crypto';
import { Op } from 'sequelize';
import sequelize from '../db.js';
import {
  BrokerConnection, BrokerOrder, BrokerOrderEvent, ReconciliationRun,
  LiveActivation, StrategyValidation, KillSwitchDrill,
} from '../models/index.js';
import { createAlpacaClient } from './alpaca.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UpstreamError } from '../errors.js';

export const DISCLOSURE_VERSION = 'live-risk-v1-2026-07-19';
const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;
const RECONCILIATION_MAX_AGE_MS = 2 * 60 * 1000;
const BROKER_LIMIT_ATTESTATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RISK_POLICY = Object.freeze({
  maxGrossExposure: 25_000,
  maxDailyLoss: 500,
  maxLeverage: 1,
  maxConcentrationPct: 0.25,
  maxOrderNotional: 5_000,
  maxOrdersPerMinute: 10,
  maxQuoteAgeMs: 10_000,
});

const STATUS_RANK = Object.freeze({
  pending_submit: 0, submitted: 10, accepted: 20, new: 20,
  pending_new: 20, partially_filled: 50, pending_cancel: 60,
  canceled: 80, expired: 80, rejected: 80, replaced: 80, filled: 100,
});

function credentialsKey(keyMaterial = process.env.BROKER_CREDENTIALS_KEY) {
  if (!keyMaterial) throw new ForbiddenError('BROKER_CREDENTIALS_KEY is required for broker connections');
  let key;
  try { key = Buffer.from(keyMaterial, 'base64'); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw new ForbiddenError('BROKER_CREDENTIALS_KEY must be a base64-encoded 32-byte key');
  return key;
}

function aadFor({ userId, accountId, environment }) {
  return Buffer.from(`claudeTrading|${userId}|${environment}|${accountId}`, 'utf8');
}

export function encryptCredentials(credentials, identity, keyMaterial) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialsKey(keyMaterial), iv);
  cipher.setAAD(aadFor(identity));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return Buffer.from(JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  })).toString('base64');
}

export function decryptCredentials(envelope, identity, keyMaterial) {
  try {
    const parsed = JSON.parse(Buffer.from(envelope, 'base64').toString('utf8'));
    if (parsed.v !== 1) throw new Error('unsupported envelope version');
    const decipher = crypto.createDecipheriv('aes-256-gcm', credentialsKey(keyMaterial), Buffer.from(parsed.iv, 'base64'));
    decipher.setAAD(aadFor(identity));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]).toString('utf8'));
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    throw new ForbiddenError('Broker credential envelope could not be authenticated', { cause: error });
  }
}

export function publicConnection(connection) {
  const value = connection.toJSON ? connection.toJSON() : { ...connection };
  delete value.credentialsCiphertext;
  return { ...value, credentialsStored: true };
}

export function normalizeRiskPolicy(input = {}) {
  const policy = { ...DEFAULT_RISK_POLICY, ...input };
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
      throw new BadRequestError(`Risk policy ${key} must be a positive number`);
    }
  }
  if (policy.maxConcentrationPct > 1 || policy.maxLeverage > 4 || policy.maxQuoteAgeMs > 60_000) {
    throw new BadRequestError('Risk policy exceeds the platform hard ceiling');
  }
  return Object.fromEntries(Object.entries(policy).map(([key, value]) => [key, Number(value)]));
}

export function evaluateOrderRisk({ policy, account, positions, quote, order, recentOrderCount, now = Date.now() }) {
  const cfg = normalizeRiskPolicy(policy);
  if (!account || !Array.isArray(positions) || !quote) return 'Risk state unavailable';
  const equity = Number(account.equity);
  const buyingPower = Number(account.buying_power);
  const dailyPnl = Number(account.equity) - Number(account.last_equity);
  const quotePrice = Number(quote.p ?? quote.price);
  const quoteTime = new Date(quote.t ?? quote.timestamp).getTime();
  if (![equity, buyingPower, dailyPnl, quotePrice, quoteTime].every(Number.isFinite) || equity <= 0 || quotePrice <= 0) {
    return 'Risk state contains invalid account or quote values';
  }
  if (now - quoteTime > cfg.maxQuoteAgeMs || quoteTime - now > 5_000) return 'Market quote is stale or future-dated';
  if (account.trading_blocked || account.account_blocked) return 'Broker account is blocked';
  if (dailyPnl <= -cfg.maxDailyLoss) return 'Daily loss limit exceeded';
  if (recentOrderCount >= cfg.maxOrdersPerMinute) return 'Order-rate limit exceeded';

  const orderNotional = Number(order.qty) * quotePrice;
  if (!Number.isFinite(orderNotional) || orderNotional <= 0) return 'Order notional is invalid';
  if (orderNotional > cfg.maxOrderNotional) return 'Per-order notional limit exceeded';
  if (orderNotional > buyingPower) return 'Insufficient broker buying power';

  const gross = positions.reduce((sum, position) => sum + Math.abs(Number(position.market_value) || 0), 0);
  const projectedGross = gross + orderNotional;
  if (projectedGross > cfg.maxGrossExposure) return 'Gross-exposure limit exceeded';
  if (projectedGross / equity > cfg.maxLeverage) return 'Leverage limit exceeded';
  const sameSymbol = positions
    .filter((position) => position.symbol === order.symbol)
    .reduce((sum, position) => sum + Math.abs(Number(position.market_value) || 0), 0);
  if ((sameSymbol + orderNotional) / equity > cfg.maxConcentrationPct) return 'Concentration limit exceeded';
  return null;
}

export function strategyPromotionDecision(validation) {
  const costs = validation.costModel || {};
  const stress = validation.stressResults || {};
  const paper = validation.paperMetrics || {};
  const reasons = [];
  if (!validation.survivorshipSafe) reasons.push('dataset is not survivorship-safe');
  if (!validation.datasetLicense?.trim()) reasons.push('licensed-data provenance is missing');
  if (Number(validation.walkForwardWindows) < 5) reasons.push('fewer than five walk-forward windows');
  if (!(Number(costs.commissionBps) >= 0) || !(Number(costs.slippageBps) > 0) || !(Number(costs.marketImpactBps) > 0)) reasons.push('realistic cost model is incomplete');
  for (const scenario of ['gapDown', 'volatilitySpike', 'delayedFill', 'liquidityShock']) {
    if (stress[scenario]?.passed !== true) reasons.push(`${scenario} stress scenario failed or missing`);
  }
  if (Number(validation.monitoredPaperDays) < 30) reasons.push('less than 30 monitored paper days');
  if (Number(paper.trades) < 100) reasons.push('fewer than 100 monitored paper trades');
  if (!(Number(paper.maxDrawdownPct) >= 0) || Number(paper.maxDrawdownPct) > 0.15) reasons.push('paper drawdown exceeds 15% or is missing');
  return { passed: reasons.length === 0, reasons };
}

export async function saveStrategyValidation(userId, input, approverId = null) {
  const decision = strategyPromotionDecision(input);
  const status = decision.passed && approverId ? 'passed' : (decision.passed ? 'paper_monitoring' : 'failed');
  const [row] = await StrategyValidation.upsert({
    ...input, userId, status,
    approvedBy: status === 'passed' ? approverId : null,
    approvedAt: status === 'passed' ? new Date() : null,
  }, { returning: true });
  return { validation: row, decision };
}

export async function approveStrategyValidation(validationId, approver) {
  if (!['operator', 'admin'].includes(approver.role)) throw new ForbiddenError('Operator approval is required');
  const validation = await StrategyValidation.findByPk(validationId);
  if (!validation) throw new NotFoundError('Strategy validation');
  const decision = strategyPromotionDecision(validation);
  await validation.update({
    status: decision.passed ? 'passed' : 'failed',
    approvedBy: decision.passed ? approver.id : null,
    approvedAt: decision.passed ? new Date() : null,
  });
  return { validation, decision };
}

export async function connectBroker(userId, input, { clientFactory = createAlpacaClient } = {}) {
  if (!['paper', 'live'].includes(input.environment)) throw new BadRequestError('environment must be paper or live');
  const client = clientFactory({ apiKey: input.apiKey, apiSecret: input.apiSecret, environment: input.environment });
  const account = await client.getAccount();
  const accountId = String(account?.id || account?.account_number || '');
  if (!accountId) throw new UpstreamError('Broker account identity was missing');
  if (input.accountId && String(input.accountId) !== accountId) throw new ConflictError('Broker account identity did not match');
  if (account.trading_blocked || account.account_blocked) throw new ForbiddenError('Broker account is blocked');

  const claimedByAnotherUser = await BrokerConnection.findOne({
    where: { broker: 'alpaca', accountId, environment: input.environment, userId: { [Op.ne]: userId } },
  });
  if (claimedByAnotherUser) throw new ConflictError('Broker account is already assigned to another user');

  const identity = { userId, accountId, environment: input.environment };
  const values = {
    userId, broker: 'alpaca', accountId, environment: input.environment,
    credentialsCiphertext: encryptCredentials({ apiKey: input.apiKey, apiSecret: input.apiSecret }, identity),
    credentialKeyVersion: process.env.BROKER_CREDENTIALS_KEY_VERSION || 'v1',
    status: 'active', verifiedAt: new Date(),
    riskPolicy: normalizeRiskPolicy(input.riskPolicy),
    brokerLimitsVerifiedAt: input.brokerLimitsVerified === true ? new Date() : null,
    killSwitchActive: false, killSwitchReason: null,
  };
  const existing = await BrokerConnection.findOne({ where: { userId, environment: input.environment } });
  if (existing && existing.accountId !== accountId) {
    throw new ConflictError('An environment connection cannot be reassigned to a different account; preserve its ledger and use an operator-reviewed migration');
  }
  const connection = existing ? await existing.update(values) : await BrokerConnection.create(values);
  return publicConnection(connection);
}

export async function getBrokerContext(userId, environment = 'paper') {
  const connection = await BrokerConnection.findOne({ where: { userId, environment, status: 'active' } });
  if (!connection) throw new NotFoundError(`No active ${environment} broker connection`);
  const identity = { userId, accountId: connection.accountId, environment };
  const credentials = decryptCredentials(connection.credentialsCiphertext, identity);
  return { connection, client: createAlpacaClient({ ...credentials, environment }) };
}

export async function reauthenticateConnection(userId, connectionId) {
  const connection = await BrokerConnection.findOne({ where: { id: connectionId, userId } });
  if (!connection) throw new NotFoundError('Broker connection');
  await connection.update({ lastReauthenticatedAt: new Date(), status: 'active' });
  return publicConnection(connection);
}

export async function requestLiveActivation(userId, input) {
  const connection = await BrokerConnection.findOne({ where: { id: input.connectionId, userId, environment: 'live', status: 'active' } });
  if (!connection) throw new NotFoundError('Active live broker connection');
  const validation = await StrategyValidation.findOne({ where: { id: input.strategyValidationId, userId, status: 'passed' } });
  if (!validation || (validation.expiresAt && new Date(validation.expiresAt) <= new Date())) {
    throw new ForbiddenError('A current passed strategy validation is required');
  }
  if (input.disclosureVersion !== DISCLOSURE_VERSION || input.acceptDisclosure !== true) {
    throw new ForbiddenError(`Disclosure ${DISCLOSURE_VERSION} must be accepted`);
  }
  await LiveActivation.update({ status: 'revoked' }, { where: { connectionId: connection.id, status: { [Op.in]: ['pending', 'approved'] } } });
  return LiveActivation.create({
    userId, connectionId: connection.id, requestedBy: userId,
    disclosureVersion: input.disclosureVersion, disclosureAcceptedAt: new Date(),
    strategyValidationId: validation.id, jurisdiction: input.jurisdiction,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), status: 'pending',
  });
}

export async function approveLiveActivation(activationId, approver) {
  if (!['operator', 'compliance', 'admin'].includes(approver.role)) throw new ForbiddenError('Approval role required');
  const activation = await LiveActivation.findByPk(activationId);
  if (!activation || activation.status !== 'pending') throw new NotFoundError('Pending live activation');
  if (activation.requestedBy === approver.id) throw new ForbiddenError('Requester cannot approve live activation');
  const now = new Date();
  if (new Date(activation.expiresAt) <= now) {
    await activation.update({ status: 'expired' });
    throw new ForbiddenError('Live activation request expired');
  }
  const values = {};
  if (approver.role === 'operator' || (approver.role === 'admin' && !activation.operatorApprovedBy)) {
    values.operatorApprovedBy = approver.id;
    values.operatorApprovedAt = now;
  }
  if (approver.role === 'compliance' || (approver.role === 'admin' && activation.operatorApprovedBy && !activation.complianceApprovedBy)) {
    values.complianceApprovedBy = approver.id;
    values.complianceApprovedAt = now;
  }
  await activation.update(values);
  if (activation.operatorApprovedBy && activation.complianceApprovedBy && activation.operatorApprovedBy !== activation.complianceApprovedBy) {
    await activation.update({ status: 'approved' });
  }
  return activation;
}

export async function assertExecutionReady(connection, now = Date.now()) {
  if (connection.killSwitchActive) throw new ForbiddenError(`Kill switch active: ${connection.killSwitchReason || 'operator stop'}`);
  if (connection.environment === 'paper') return;
  if (process.env.LIVE_TRADING_ENABLED !== 'true') throw new ForbiddenError('Live trading is disabled at deployment level');
  const reauthAge = now - new Date(connection.lastReauthenticatedAt || 0).getTime();
  if (reauthAge > REAUTH_MAX_AGE_MS) throw new ForbiddenError('Live trading re-authentication is required');
  const reconcileAge = now - new Date(connection.lastReconciledAt || 0).getTime();
  if (reconcileAge > RECONCILIATION_MAX_AGE_MS) throw new ForbiddenError('Account reconciliation is stale');
  const brokerLimitAge = now - new Date(connection.brokerLimitsVerifiedAt || 0).getTime();
  if (brokerLimitAge > BROKER_LIMIT_ATTESTATION_MAX_AGE_MS) throw new ForbiddenError('Broker-side limit attestation is stale');
  const activation = await LiveActivation.findOne({
    where: { connectionId: connection.id, status: 'approved', expiresAt: { [Op.gt]: new Date(now) } },
    order: [['createdAt', 'DESC']],
  });
  if (!activation) throw new ForbiddenError('Dual-approved live activation is required');
}

export async function applyBrokerEvent(order, event, transaction) {
  const eventKey = event.eventKey || crypto.createHash('sha256').update(JSON.stringify([
    order.id, event.id, event.status, event.updated_at, event.filled_qty,
  ])).digest('hex');
  const [stored, created] = await BrokerOrderEvent.findOrCreate({
    where: { eventKey },
    defaults: {
      brokerOrderId: order.id, eventType: event.status || event.event || 'unknown',
      brokerTimestamp: new Date(event.updated_at || event.timestamp || Date.now()),
      sequence: Number(event.sequence) || 0, payload: event,
    }, transaction,
  });
  if (!created) return { changed: false, duplicate: true, event: stored };
  const incomingStatus = event.status || order.status;
  const currentRank = STATUS_RANK[order.status] ?? 0;
  const incomingRank = STATUS_RANK[incomingStatus] ?? 0;
  const incomingFilled = Number(event.filled_qty) || 0;
  const currentFilled = Number(order.filledQty) || 0;
  const sequence = Number(event.sequence) || 0;
  const progresses = incomingRank > currentRank || incomingFilled > currentFilled;
  if (progresses) {
    await order.update({
      status: incomingStatus,
      filledQty: Math.max(currentFilled, incomingFilled),
      avgFillPrice: event.filled_avg_price || order.avgFillPrice,
      brokerOrderId: event.id || order.brokerOrderId,
      lastBrokerUpdateAt: new Date(event.updated_at || event.timestamp || Date.now()),
      lastEventSequence: Math.max(Number(order.lastEventSequence) || 0, sequence),
      lastError: incomingStatus === 'rejected' ? (event.reject_reason || event.message || 'broker rejected') : order.lastError,
    }, { transaction });
  }
  return { changed: progresses, duplicate: false, event: stored };
}

export async function executeGovernedOrder(userId, environment, orderRequest, { context } = {}) {
  const brokerContext = context || await getBrokerContext(userId, environment);
  const { connection, client } = brokerContext;
  await assertExecutionReady(connection);
  const clientOrderId = orderRequest.client_order_id || crypto.randomUUID().replaceAll('-', '').slice(0, 32);
  const request = { ...orderRequest, client_order_id: clientOrderId };
  const [order, created] = await BrokerOrder.findOrCreate({
    where: { userId, connectionId: connection.id, clientOrderId },
    defaults: {
      environment, symbol: request.symbol, side: request.side,
      orderType: request.type || 'market', qty: request.qty, request,
    },
  });
  if (!created) return { order, idempotentReplay: true };

  try {
    const [account, positions, quotes, recentOrderCount] = await Promise.all([
      client.getAccount(), client.getPositions(), client.getLatestTrades([request.symbol]),
      BrokerOrder.count({ where: { connectionId: connection.id, createdAt: { [Op.gte]: new Date(Date.now() - 60_000) } } }),
    ]);
    const riskReason = evaluateOrderRisk({
      policy: connection.riskPolicy, account, positions,
      quote: quotes?.[request.symbol], order: request,
      recentOrderCount: Math.max(0, recentOrderCount - 1),
    });
    if (riskReason) {
      await order.update({ status: 'rejected', lastError: riskReason });
      throw new ForbiddenError(riskReason);
    }
    const brokerOrder = await client.placeOrder(request);
    await sequelize.transaction(async (transaction) => {
      await order.update({ brokerOrderId: brokerOrder.id, status: 'submitted' }, { transaction });
      await applyBrokerEvent(order, brokerOrder, transaction);
    });
    return { order: await BrokerOrder.findByPk(order.id), idempotentReplay: false };
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    // A network timeout after submission is ambiguous. Keep the durable row in
    // pending_unknown and let reconciliation discover the broker result; never
    // auto-submit a second order.
    await order.update({ status: 'pending_unknown', lastError: error.message });
    throw new UpstreamError('Order outcome unknown; reconciliation required', { cause: error, code: 'ORDER_OUTCOME_UNKNOWN' });
  }
}

export async function reconcileConnection(userId, connectionId, { context } = {}) {
  const ownedConnection = await BrokerConnection.findOne({ where: { id: connectionId, userId } });
  if (!ownedConnection) throw new NotFoundError('Broker connection');
  const brokerContext = context || await getBrokerContext(userId, ownedConnection.environment);
  const { connection, client } = brokerContext;
  if (connection.id !== Number(connectionId) || connection.userId !== userId) throw new ForbiddenError('Connection ownership mismatch');
  const run = await ReconciliationRun.create({ connectionId, status: 'running', startedAt: new Date() });
  try {
    const [brokerOrders, accountSnapshot, positionSnapshot] = await Promise.all([
      client.getOrders('all', 500), client.getAccount(), client.getPositions(),
    ]);
    const reconciledAccountId = String(accountSnapshot?.id || accountSnapshot?.account_number || '');
    if (!reconciledAccountId || reconciledAccountId !== connection.accountId) {
      throw new ForbiddenError('Reconciliation account identity mismatch');
    }
    if (!Array.isArray(positionSnapshot)) throw new UpstreamError('Broker positions snapshot was invalid');
    let changedOrderCount = 0;
    let orphanOrderCount = 0;
    await sequelize.transaction(async (transaction) => {
      for (const event of brokerOrders) {
        const order = await BrokerOrder.findOne({
          where: {
            connectionId,
            [Op.or]: [{ brokerOrderId: event.id }, { clientOrderId: event.client_order_id || '__missing__' }],
          }, transaction, lock: transaction.LOCK.UPDATE,
        });
        if (!order) { orphanOrderCount += 1; continue; }
        const result = await applyBrokerEvent(order, event, transaction);
        if (result.changed) changedOrderCount += 1;
        for (const leg of event.legs || []) {
          let legOrder = await BrokerOrder.findOne({
            where: { connectionId, brokerOrderId: leg.id }, transaction, lock: transaction.LOCK.UPDATE,
          });
          if (!legOrder) {
            legOrder = await BrokerOrder.create({
              userId, connectionId,
              clientOrderId: leg.client_order_id || `broker-leg-${leg.id}`,
              brokerOrderId: leg.id, environment: connection.environment,
              symbol: leg.symbol || order.symbol, side: leg.side || 'sell',
              orderType: leg.type || 'market', qty: leg.qty || order.qty,
              status: 'submitted', request: { parentBrokerOrderId: event.id, brokerCreatedLeg: true },
            }, { transaction });
          }
          const legResult = await applyBrokerEvent(legOrder, { ...leg, eventKey: `leg:${leg.id}:${leg.updated_at}:${leg.status}` }, transaction);
          if (legResult.changed) changedOrderCount += 1;
        }
      }
      if (orphanOrderCount > 0) {
        await connection.update({
          killSwitchActive: true,
          killSwitchReason: `${orphanOrderCount} broker order(s) were not owned by this account ledger`,
        }, { transaction });
      } else {
        await connection.update({ lastReconciledAt: new Date() }, { transaction });
      }
    });
    await run.update({
      status: 'succeeded', completedAt: new Date(), brokerOrderCount: brokerOrders.length,
      brokerPositionCount: positionSnapshot.length, accountSnapshot, positionSnapshot,
      changedOrderCount, orphanOrderCount,
    });
    return run;
  } catch (error) {
    await connection.update({ killSwitchActive: true, killSwitchReason: `Reconciliation failed: ${error.message}` });
    await run.update({ status: 'failed', completedAt: new Date(), error: error.message });
    throw error;
  }
}

export async function activateKillSwitch(userId, connectionId, { mode, reason }, { context } = {}) {
  const ownedConnection = await BrokerConnection.findOne({ where: { id: connectionId, userId } });
  if (!ownedConnection) throw new NotFoundError('Broker connection');
  const brokerContext = context || await getBrokerContext(userId, ownedConnection.environment);
  const { connection, client } = brokerContext;
  if (connection.id !== Number(connectionId) || connection.userId !== userId) throw new ForbiddenError('Connection ownership mismatch');
  const drill = await KillSwitchDrill.create({ connectionId, initiatedBy: userId, mode, reason });
  await connection.update({ killSwitchActive: true, killSwitchReason: reason });
  let cancelSucceeded = false;
  let flattenSucceeded = false;
  const details = {};
  if (mode === 'drill') {
    cancelSucceeded = typeof client.cancelAllOrders === 'function';
    flattenSucceeded = typeof client.closeAllPositions === 'function';
    details.simulated = true;
  } else {
    try { await client.cancelAllOrders(); cancelSucceeded = true; } catch (error) { details.cancelError = error.message; }
    try { await client.closeAllPositions(); flattenSucceeded = true; } catch (error) { details.flattenError = error.message; }
  }
  await drill.update({ cancelSucceeded, flattenSucceeded, details, completedAt: new Date() });
  return drill;
}

export async function resetKillSwitch(userId, connectionId) {
  const connection = await BrokerConnection.findOne({ where: { id: connectionId, userId } });
  if (!connection) throw new NotFoundError('Broker connection');
  if (!connection.lastReconciledAt || Date.now() - new Date(connection.lastReconciledAt).getTime() > RECONCILIATION_MAX_AGE_MS) {
    throw new ForbiddenError('A successful current reconciliation is required before reset');
  }
  await connection.update({ killSwitchActive: false, killSwitchReason: null, status: 'reauth_required' });
  return publicConnection(connection);
}

let reconciliationTimer;
let reconciliationRunning = false;

export async function reconcileAllConnections() {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  try {
    const connections = await BrokerConnection.findAll({ where: { status: 'active' } });
    for (const connection of connections) {
      try {
        await reconcileConnection(connection.userId, connection.id);
      } catch {
        // reconcileConnection records the failed run and activates the
        // connection kill switch. Continue so one broker outage does not hide
        // the health of every other isolated account.
      }
    }
  } finally {
    reconciliationRunning = false;
  }
}

export function startReconciliationWorker() {
  if (reconciliationTimer) return;
  const intervalMs = Math.max(15_000, Number(process.env.BROKER_RECONCILIATION_INTERVAL_MS) || 60_000);
  reconciliationTimer = setInterval(() => { reconcileAllConnections().catch(() => {}); }, intervalMs);
  reconciliationTimer.unref();
}

export function stopReconciliationWorker() {
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  reconciliationTimer = undefined;
}
