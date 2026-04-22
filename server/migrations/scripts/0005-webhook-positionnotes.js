/**
 * 0005 — webhook secret + PositionNotes.
 *
 * Adds:
 *   - Users.webhookSecret (nullable): hex secret used for HMAC-verifying
 *     inbound webhooks from external strategies.
 *   - PositionNotes table: free-form notes attached to a symbol so a
 *     trader can record their thesis, invalidation conditions, post-mortems.
 *
 * Idempotent — matches the pattern of prior migrations.
 */

async function tableExists(qi, table) {
  try { await qi.describeTable(table); return true; }
  catch { return false; }
}
async function columnExists(qi, table, col) {
  try {
    const desc = await qi.describeTable(table);
    return Object.prototype.hasOwnProperty.call(desc, col);
  } catch { return false; }
}
async function hasIndex(qi, table, indexName) {
  try {
    const indexes = await qi.showIndex(table);
    return indexes.some((idx) => idx.name === indexName);
  } catch { return false; }
}

export async function up({ context: qi, DataTypes }) {
  // ─── Users.webhookSecret ───
  if (await tableExists(qi, 'Users') && !(await columnExists(qi, 'Users', 'webhookSecret'))) {
    await qi.addColumn('Users', 'webhookSecret', { type: DataTypes.STRING, allowNull: true });
  }

  // ─── PositionNotes ───
  if (!(await tableExists(qi, 'PositionNotes'))) {
    await qi.createTable('PositionNotes', {
      id:     { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      symbol: { type: DataTypes.STRING, allowNull: false },
      note:   { type: DataTypes.TEXT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  }
  if (!(await hasIndex(qi, 'PositionNotes', 'PositionNotes_userId'))) {
    try { await qi.addIndex('PositionNotes', ['userId'], { name: 'PositionNotes_userId' }); }
    catch { /* already present */ }
  }
  if (!(await hasIndex(qi, 'PositionNotes', 'PositionNotes_symbol'))) {
    try { await qi.addIndex('PositionNotes', ['symbol'], { name: 'PositionNotes_symbol' }); }
    catch { /* already present */ }
  }
}

export async function down({ context: qi }) {
  const tryDrop = async (fn) => { try { await fn(); } catch { /* already gone */ } };
  await tryDrop(() => qi.dropTable('PositionNotes'));
  await tryDrop(() => qi.removeColumn('Users', 'webhookSecret'));
}
