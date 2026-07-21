/** 0009 — retained account/position evidence for every reconciliation run. */
async function hasColumn(qi, table, column) {
  try { return Object.hasOwn(await qi.describeTable(table), column); } catch { return false; }
}

export async function up({ context: qi, DataTypes }) {
  if (!(await hasColumn(qi, 'ReconciliationRuns', 'brokerPositionCount'))) {
    await qi.addColumn('ReconciliationRuns', 'brokerPositionCount', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  }
  if (!(await hasColumn(qi, 'ReconciliationRuns', 'accountSnapshot'))) {
    await qi.addColumn('ReconciliationRuns', 'accountSnapshot', { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
  }
  if (!(await hasColumn(qi, 'ReconciliationRuns', 'positionSnapshot'))) {
    await qi.addColumn('ReconciliationRuns', 'positionSnapshot', { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  }
}

export async function down({ context: qi }) {
  for (const column of ['positionSnapshot', 'accountSnapshot', 'brokerPositionCount']) {
    if (await hasColumn(qi, 'ReconciliationRuns', column)) await qi.removeColumn('ReconciliationRuns', column);
  }
}
