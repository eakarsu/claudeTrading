import { Router } from 'express';
import bcryptjs from 'bcryptjs';
import { z } from 'zod';
import {
  BrokerConnection, BrokerOrder, LiveActivation, ReconciliationRun,
  StrategyValidation, KillSwitchDrill, User,
} from '../models/index.js';
import { asyncHandler } from '../middleware/async.js';
import { audit } from '../middleware/audit.js';
import { tradeLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { idParam, orderSchema } from '../schemas.js';
import { verifyTotp } from '../services/totp.js';
import { ForbiddenError, UnauthorizedError } from '../errors.js';
import {
  DISCLOSURE_VERSION, activateKillSwitch, approveLiveActivation,
  approveStrategyValidation, connectBroker, executeGovernedOrder,
  getBrokerContext, publicConnection, reauthenticateConnection,
  reconcileConnection, requestLiveActivation, resetKillSwitch,
  saveStrategyValidation,
} from '../services/brokerGovernance.js';

const router = Router();
const environment = z.enum(['paper', 'live']);
const riskPolicy = z.object({
  maxGrossExposure: z.number().positive().max(10_000_000),
  maxDailyLoss: z.number().positive().max(1_000_000),
  maxLeverage: z.number().positive().max(4),
  maxConcentrationPct: z.number().positive().max(1),
  maxOrderNotional: z.number().positive().max(1_000_000),
  maxOrdersPerMinute: z.number().int().positive().max(100),
  maxQuoteAgeMs: z.number().int().positive().max(60_000),
}).partial();

router.get('/connections', asyncHandler(async (req, res) => {
  const rows = await BrokerConnection.findAll({ where: { userId: req.userId }, order: [['environment', 'ASC']] });
  res.json(rows.map(publicConnection));
}));

router.post('/connections', tradeLimiter, validate({
  body: z.object({
    environment, apiKey: z.string().min(8).max(256), apiSecret: z.string().min(8).max(512),
    accountId: z.string().max(128).optional(), riskPolicy: riskPolicy.optional(),
    brokerLimitsVerified: z.literal(true).optional(),
  }),
}), audit('broker.connection.configure', 'broker-connection'), asyncHandler(async (req, res) => {
  res.status(201).json(await connectBroker(req.userId, req.body));
}));

router.post('/connections/:id/reauthenticate', tradeLimiter, validate({
  params: idParam,
  body: z.object({ password: z.string().min(1).max(256), totpCode: z.string().regex(/^\d{6}$/) }),
}), audit('broker.connection.reauthenticate', 'broker-connection'), asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.userId);
  if (!user || !(await bcryptjs.compare(req.body.password, user.password))) throw new UnauthorizedError('Invalid credentials');
  if (!user.totpEnabled || !user.totpSecret || !verifyTotp(user.totpSecret, req.body.totpCode)) {
    throw new UnauthorizedError('Current 2FA code is required');
  }
  res.json(await reauthenticateConnection(req.userId, req.params.id));
}));

const validationBody = z.object({
  strategy: z.string().min(1).max(128), version: z.string().min(1).max(64),
  datasetLicense: z.string().min(1).max(256), survivorshipSafe: z.boolean(),
  walkForwardWindows: z.number().int().nonnegative().max(1000),
  costModel: z.object({ commissionBps: z.number().nonnegative(), slippageBps: z.number().positive(), marketImpactBps: z.number().positive() }),
  stressResults: z.record(z.object({ passed: z.boolean(), lossPct: z.number().optional() })),
  paperMetrics: z.object({ trades: z.number().int().nonnegative(), maxDrawdownPct: z.number().nonnegative(), sharpe: z.number().optional() }),
  monitoredPaperDays: z.number().int().nonnegative(),
  expiresAt: z.coerce.date().optional(),
});

router.get('/validations', asyncHandler(async (req, res) => {
  res.json(await StrategyValidation.findAll({ where: { userId: req.userId }, order: [['createdAt', 'DESC']] }));
}));

router.post('/validations', validate({ body: validationBody }), audit('strategy.validation.submit', 'strategy-validation'), asyncHandler(async (req, res) => {
  const result = await saveStrategyValidation(req.userId, req.body);
  res.status(201).json(result);
}));

router.post('/validations/:id/approve', validate({ params: idParam }), audit('strategy.validation.approve', 'strategy-validation'), asyncHandler(async (req, res) => {
  const approver = await User.findByPk(req.userId);
  res.json(await approveStrategyValidation(req.params.id, approver));
}));

router.get('/activations', asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.userId);
  const where = ['operator', 'compliance', 'admin'].includes(user?.role) ? {} : { userId: req.userId };
  res.json(await LiveActivation.findAll({ where, order: [['createdAt', 'DESC']], limit: 100 }));
}));

router.get('/disclosure', (req, res) => res.json({
  version: DISCLOSURE_VERSION,
  text: 'Live automated trading can lose all deployed capital. Orders may be delayed, partially filled, rejected, or execute at worse prices. AI output never authorizes an order. Activation is time-limited and subject to operator kill switches.',
}));

router.post('/activations', validate({
  body: z.object({
    connectionId: z.number().int().positive(), strategyValidationId: z.number().int().positive(),
    disclosureVersion: z.string(), acceptDisclosure: z.literal(true),
    jurisdiction: z.string().min(2).max(64),
  }),
}), audit('broker.live-activation.request', 'live-activation', { captureBody: true }), asyncHandler(async (req, res) => {
  res.status(201).json(await requestLiveActivation(req.userId, req.body));
}));

router.post('/activations/:id/approve', validate({ params: idParam }), audit('broker.live-activation.approve', 'live-activation'), asyncHandler(async (req, res) => {
  const approver = await User.findByPk(req.userId);
  res.json(await approveLiveActivation(req.params.id, approver));
}));

router.get('/orders', asyncHandler(async (req, res) => {
  res.json(await BrokerOrder.findAll({ where: { userId: req.userId }, order: [['createdAt', 'DESC']], limit: 500 }));
}));

router.post('/orders', tradeLimiter, validate({
  body: orderSchema.and(z.object({ environment: environment.default('paper'), client_order_id: z.string().regex(/^[A-Za-z0-9_-]{8,48}$/).optional() })),
}), audit('broker.order.submit', 'broker-order', { captureBody: true }), asyncHandler(async (req, res) => {
  const { environment: executionEnvironment, ...order } = req.body;
  const result = await executeGovernedOrder(req.userId, executionEnvironment, order);
  res.status(result.idempotentReplay ? 200 : 201).json(result);
}));

router.post('/connections/:id/reconcile', tradeLimiter, validate({ params: idParam }), audit('broker.reconcile', 'broker-connection'), asyncHandler(async (req, res) => {
  res.json(await reconcileConnection(req.userId, req.params.id));
}));

router.get('/connections/:id/reconciliations', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const connection = await BrokerConnection.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!connection) throw new ForbiddenError('Connection ownership mismatch');
  res.json(await ReconciliationRun.findAll({ where: { connectionId: connection.id }, order: [['startedAt', 'DESC']], limit: 100 }));
}));

router.post('/connections/:id/kill-switch', tradeLimiter, validate({
  params: idParam,
  body: z.object({ mode: z.enum(['drill', 'incident']), reason: z.string().min(8).max(500) }),
}), audit('broker.kill-switch.activate', 'broker-connection', { captureBody: true }), asyncHandler(async (req, res) => {
  res.json(await activateKillSwitch(req.userId, req.params.id, req.body));
}));

router.post('/connections/:id/kill-switch/reset', tradeLimiter, validate({ params: idParam }), audit('broker.kill-switch.reset', 'broker-connection'), asyncHandler(async (req, res) => {
  res.json(await resetKillSwitch(req.userId, req.params.id));
}));

router.get('/connections/:id/kill-switch-drills', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const connection = await BrokerConnection.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!connection) throw new ForbiddenError('Connection ownership mismatch');
  res.json(await KillSwitchDrill.findAll({ where: { connectionId: connection.id }, order: [['createdAt', 'DESC']], limit: 100 }));
}));

// Read-only account snapshot remains convenient for the UI but is always
// explicitly scoped by the authenticated user's connection.
router.get('/account/:environment', validate({ params: z.object({ environment }) }), asyncHandler(async (req, res) => {
  const { client, connection } = await getBrokerContext(req.userId, req.params.environment);
  const [account, positions] = await Promise.all([client.getAccount(), client.getPositions()]);
  res.json({ connection: publicConnection(connection), account, positions });
}));

export default router;
