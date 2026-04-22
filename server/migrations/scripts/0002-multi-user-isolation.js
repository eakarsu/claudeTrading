/**
 * 0002 — multi-user isolation.
 *
 * Adds userId columns + indexes to every per-user table, a unique userId on
 * AutoTraderStates (one state row per user), tags + entryContext JSON fields
 * on AutoTraderTrades, and creates the EventCalendars + AuditLogs tables.
 *
 * Idempotent by design: each addColumn/addIndex/createTable is guarded with a
 * describeTable / showIndex check so dev environments that already ran
 * sequelize.sync() over the new model definitions do not fail when this
 * migration applies.
 */

const PER_USER_TABLES = [
  'TrailingStops',
  'CopyTrades',
  'WheelStrategies',
  'WatchlistItems',
  'TradeJournals',
  'PriceAlerts',
  'TradeSignals',
  'StockScreeners',
  'RiskAssessments',
  'PortfolioItems',
  'Sentiments',
  'OptionsChains',
];

async function tableExists(qi, table) {
  try { await qi.describeTable(table); return true; }
  catch { return false; }
}

async function hasColumn(qi, table, column) {
  try {
    const desc = await qi.describeTable(table);
    return Object.prototype.hasOwnProperty.call(desc, column);
  } catch {
    return false;
  }
}

async function hasIndex(qi, table, indexName) {
  try {
    const indexes = await qi.showIndex(table);
    return indexes.some((idx) => idx.name === indexName);
  } catch {
    return false;
  }
}

async function addUserIdIfMissing(qi, DataTypes, table, { unique = false } = {}) {
  if (!(await tableExists(qi, table))) return;
  if (!(await hasColumn(qi, table, 'userId'))) {
    await qi.addColumn(table, 'userId', {
      type: DataTypes.INTEGER,
      allowNull: true,
      unique,
    });
  }
  const idxName = `${table}_userId`;
  if (!(await hasIndex(qi, table, idxName))) {
    await qi.addIndex(table, ['userId'], { name: idxName, unique });
  }
}

export async function up({ context: qi, DataTypes }) {
  // Per-user tables: add nullable userId + index. Legacy rows keep NULL
  // until touched; the CRUD routes stamp req.userId onto any row the user
  // writes through.
  for (const table of PER_USER_TABLES) {
    await addUserIdIfMissing(qi, DataTypes, table);
  }

  // AutoTraderStates: one row per user, so the userId index is UNIQUE.
  await addUserIdIfMissing(qi, DataTypes, 'AutoTraderStates', { unique: true });

  // AutoTraderTrades: userId + tags + entryContext.
  if (await tableExists(qi, 'AutoTraderTrades')) {
    if (!(await hasColumn(qi, 'AutoTraderTrades', 'userId'))) {
      await qi.addColumn('AutoTraderTrades', 'userId', {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
    }
    if (!(await hasIndex(qi, 'AutoTraderTrades', 'AutoTraderTrades_userId'))) {
      await qi.addIndex('AutoTraderTrades', ['userId'], {
        name: 'AutoTraderTrades_userId',
      });
    }
    if (!(await hasColumn(qi, 'AutoTraderTrades', 'tags'))) {
      await qi.addColumn('AutoTraderTrades', 'tags', {
        type: DataTypes.JSON,
        defaultValue: [],
      });
    }
    if (!(await hasColumn(qi, 'AutoTraderTrades', 'entryContext'))) {
      await qi.addColumn('AutoTraderTrades', 'entryContext', {
        type: DataTypes.JSON,
        defaultValue: {},
      });
    }
  }

  // EventCalendars: earnings + macro events the auto-trader honors as blackouts.
  if (!(await tableExists(qi, 'EventCalendars'))) {
    await qi.createTable('EventCalendars', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      date:   { type: DataTypes.STRING, allowNull: false },
      kind:   { type: DataTypes.STRING, allowNull: false },
      symbol: { type: DataTypes.STRING },
      note:   { type: DataTypes.STRING },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('EventCalendars', ['date'],   { name: 'EventCalendars_date' });
    await qi.addIndex('EventCalendars', ['symbol'], { name: 'EventCalendars_symbol' });
  }

  // AuditLogs: append-only record of mutating actions, read-only via API.
  if (!(await tableExists(qi, 'AuditLogs'))) {
    await qi.createTable('AuditLogs', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER },
      action: { type: DataTypes.STRING, allowNull: false },
      resource: { type: DataTypes.STRING },
      resourceId: { type: DataTypes.STRING },
      ip: { type: DataTypes.STRING },
      userAgent: { type: DataTypes.STRING },
      meta: { type: DataTypes.JSON, defaultValue: {} },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('AuditLogs', ['userId'],    { name: 'AuditLogs_userId' });
    await qi.addIndex('AuditLogs', ['action'],    { name: 'AuditLogs_action' });
    await qi.addIndex('AuditLogs', ['createdAt'], { name: 'AuditLogs_createdAt' });
  }
}

export async function down({ context: qi }) {
  // Drop in reverse order. Safe even if earlier up() partially ran — each step
  // is wrapped in a best-effort try/catch so a missing artifact doesn't block.
  const tryDrop = async (fn) => { try { await fn(); } catch { /* already gone */ } };

  await tryDrop(() => qi.dropTable('AuditLogs'));
  await tryDrop(() => qi.dropTable('EventCalendars'));

  if (await tableExists(qi, 'AutoTraderTrades')) {
    await tryDrop(() => qi.removeIndex('AutoTraderTrades', 'AutoTraderTrades_userId'));
    await tryDrop(() => qi.removeColumn('AutoTraderTrades', 'userId'));
    await tryDrop(() => qi.removeColumn('AutoTraderTrades', 'tags'));
    await tryDrop(() => qi.removeColumn('AutoTraderTrades', 'entryContext'));
  }
  if (await tableExists(qi, 'AutoTraderStates')) {
    await tryDrop(() => qi.removeIndex('AutoTraderStates', 'AutoTraderStates_userId'));
    await tryDrop(() => qi.removeColumn('AutoTraderStates', 'userId'));
  }
  for (const table of PER_USER_TABLES) {
    if (!(await tableExists(qi, table))) continue;
    await tryDrop(() => qi.removeIndex(table, `${table}_userId`));
    await tryDrop(() => qi.removeColumn(table, 'userId'));
  }
}
