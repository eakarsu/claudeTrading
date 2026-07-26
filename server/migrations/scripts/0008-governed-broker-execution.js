/**
 * 0008 — governed, account-scoped broker execution.
 *
 * Additive and restart-safe. Every table/column/index is discovered before it
 * is created so this can follow either older `sequelize.sync()` deployments or
 * migration-only deployments without overwriting customer records.
 */

async function tableExists(qi, table) {
  try { await qi.describeTable(table); return true; } catch { return false; }
}

async function hasColumn(qi, table, column) {
  try { return Object.hasOwn(await qi.describeTable(table), column); } catch { return false; }
}

async function addIndex(qi, table, fields, options) {
  const indexes = await qi.showIndex(table).catch(() => []);
  if (!indexes.some((index) => index.name === options.name)) {
    await qi.addIndex(table, fields, options);
  }
}

const timestamps = (DataTypes) => ({
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
});

export async function up({ context: qi, DataTypes }) {
  if (await tableExists(qi, 'Users') && !(await hasColumn(qi, 'Users', 'role'))) {
    await qi.addColumn('Users', 'role', {
      type: DataTypes.ENUM('trader', 'operator', 'compliance', 'admin'),
      allowNull: false,
      defaultValue: 'trader',
    });
  }

  if (!(await tableExists(qi, 'BrokerConnections'))) {
    await qi.createTable('BrokerConnections', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      broker: { type: DataTypes.STRING, allowNull: false, defaultValue: 'alpaca' },
      accountId: { type: DataTypes.STRING, allowNull: false },
      environment: { type: DataTypes.ENUM('paper', 'live'), allowNull: false },
      credentialsCiphertext: { type: DataTypes.TEXT, allowNull: false },
      credentialKeyVersion: { type: DataTypes.STRING, allowNull: false, defaultValue: 'v1' },
      status: { type: DataTypes.ENUM('active', 'disabled', 'reauth_required'), allowNull: false, defaultValue: 'active' },
      verifiedAt: { type: DataTypes.DATE, allowNull: false },
      lastReauthenticatedAt: { type: DataTypes.DATE },
      riskPolicy: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      brokerLimitsVerifiedAt: { type: DataTypes.DATE },
      killSwitchActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      killSwitchReason: { type: DataTypes.TEXT },
      lastReconciledAt: { type: DataTypes.DATE },
      ...timestamps(DataTypes),
    });
  }
  await addIndex(qi, 'BrokerConnections', ['userId', 'environment'], { name: 'broker_connections_user_environment', unique: true });
  await addIndex(qi, 'BrokerConnections', ['broker', 'accountId', 'environment'], { name: 'broker_connections_account_environment', unique: true });

  if (!(await tableExists(qi, 'StrategyValidations'))) {
    await qi.createTable('StrategyValidations', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      strategy: { type: DataTypes.STRING, allowNull: false },
      version: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.ENUM('draft', 'paper_monitoring', 'passed', 'failed', 'expired'), allowNull: false, defaultValue: 'draft' },
      datasetLicense: { type: DataTypes.STRING, allowNull: false },
      survivorshipSafe: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      walkForwardWindows: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      costModel: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      stressResults: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      paperMetrics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      monitoredPaperDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      approvedBy: { type: DataTypes.INTEGER },
      approvedAt: { type: DataTypes.DATE },
      expiresAt: { type: DataTypes.DATE },
      ...timestamps(DataTypes),
    });
  }
  await addIndex(qi, 'StrategyValidations', ['userId', 'strategy', 'version'], { name: 'strategy_validations_owner_strategy_version', unique: true });
  await addIndex(qi, 'StrategyValidations', ['status'], { name: 'strategy_validations_status' });

  if (!(await tableExists(qi, 'LiveActivations'))) {
    await qi.createTable('LiveActivations', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      connectionId: { type: DataTypes.INTEGER, allowNull: false },
      status: { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'expired', 'revoked'), allowNull: false, defaultValue: 'pending' },
      requestedBy: { type: DataTypes.INTEGER, allowNull: false },
      operatorApprovedBy: { type: DataTypes.INTEGER },
      complianceApprovedBy: { type: DataTypes.INTEGER },
      operatorApprovedAt: { type: DataTypes.DATE },
      complianceApprovedAt: { type: DataTypes.DATE },
      disclosureVersion: { type: DataTypes.STRING, allowNull: false },
      disclosureAcceptedAt: { type: DataTypes.DATE, allowNull: false },
      strategyValidationId: { type: DataTypes.INTEGER, allowNull: false },
      jurisdiction: { type: DataTypes.STRING, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      decisionReason: { type: DataTypes.TEXT },
      ...timestamps(DataTypes),
    });
  }
  await addIndex(qi, 'LiveActivations', ['connectionId', 'status'], { name: 'live_activations_connection_status' });
  await addIndex(qi, 'LiveActivations', ['userId'], { name: 'live_activations_user' });

  if (!(await tableExists(qi, 'BrokerOrders'))) {
    await qi.createTable('BrokerOrders', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      connectionId: { type: DataTypes.INTEGER, allowNull: false },
      clientOrderId: { type: DataTypes.STRING, allowNull: false },
      brokerOrderId: { type: DataTypes.STRING },
      environment: { type: DataTypes.ENUM('paper', 'live'), allowNull: false },
      symbol: { type: DataTypes.STRING, allowNull: false },
      side: { type: DataTypes.STRING, allowNull: false },
      orderType: { type: DataTypes.STRING, allowNull: false },
      qty: { type: DataTypes.DECIMAL(24, 8), allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending_submit' },
      filledQty: { type: DataTypes.DECIMAL(24, 8), allowNull: false, defaultValue: 0 },
      avgFillPrice: { type: DataTypes.DECIMAL(24, 8) },
      request: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      lastBrokerUpdateAt: { type: DataTypes.DATE },
      lastEventSequence: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      lastError: { type: DataTypes.TEXT },
      ...timestamps(DataTypes),
    });
  }
  await addIndex(qi, 'BrokerOrders', ['userId', 'connectionId', 'clientOrderId'], { name: 'broker_orders_idempotency', unique: true });
  await addIndex(qi, 'BrokerOrders', ['connectionId', 'brokerOrderId'], { name: 'broker_orders_broker_id' });
  await addIndex(qi, 'BrokerOrders', ['connectionId', 'status'], { name: 'broker_orders_reconcile_queue' });

  if (!(await tableExists(qi, 'BrokerOrderEvents'))) {
    await qi.createTable('BrokerOrderEvents', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      brokerOrderId: { type: DataTypes.INTEGER, allowNull: false },
      eventKey: { type: DataTypes.STRING, allowNull: false, unique: true },
      eventType: { type: DataTypes.STRING, allowNull: false },
      brokerTimestamp: { type: DataTypes.DATE, allowNull: false },
      sequence: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ...timestamps(DataTypes),
    });
  }
  await addIndex(qi, 'BrokerOrderEvents', ['brokerOrderId', 'brokerTimestamp'], { name: 'broker_order_events_order_time' });

  if (!(await tableExists(qi, 'ReconciliationRuns'))) {
    await qi.createTable('ReconciliationRuns', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      connectionId: { type: DataTypes.INTEGER, allowNull: false },
      status: { type: DataTypes.ENUM('running', 'succeeded', 'failed'), allowNull: false, defaultValue: 'running' },
      startedAt: { type: DataTypes.DATE, allowNull: false },
      completedAt: { type: DataTypes.DATE },
      brokerOrderCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      brokerPositionCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      changedOrderCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      orphanOrderCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      accountSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      positionSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      error: { type: DataTypes.TEXT },
      ...timestamps(DataTypes),
    });
  }
  await addIndex(qi, 'ReconciliationRuns', ['connectionId', 'startedAt'], { name: 'reconciliation_runs_connection_time' });

  if (!(await tableExists(qi, 'KillSwitchDrills'))) {
    await qi.createTable('KillSwitchDrills', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      connectionId: { type: DataTypes.INTEGER, allowNull: false },
      initiatedBy: { type: DataTypes.INTEGER, allowNull: false },
      mode: { type: DataTypes.ENUM('drill', 'incident'), allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      cancelSucceeded: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      flattenSucceeded: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      completedAt: { type: DataTypes.DATE },
      details: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ...timestamps(DataTypes),
    });
  }
  await addIndex(qi, 'KillSwitchDrills', ['connectionId', 'createdAt'], { name: 'kill_switch_drills_connection_time' });
}

export async function down({ context: qi }) {
  // Explicit rollback is intentionally narrow and reverse-ordered. Production
  // operators should back up retained trading records before invoking it.
  for (const table of ['KillSwitchDrills', 'ReconciliationRuns', 'BrokerOrderEvents', 'BrokerOrders', 'LiveActivations', 'StrategyValidations', 'BrokerConnections']) {
    if (await tableExists(qi, table)) await qi.dropTable(table);
  }
  if (await tableExists(qi, 'Users') && await hasColumn(qi, 'Users', 'role')) {
    await qi.removeColumn('Users', 'role');
  }
}
