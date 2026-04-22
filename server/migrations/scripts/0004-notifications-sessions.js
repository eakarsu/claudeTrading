/**
 * 0004 — notifications + sessions.
 *
 * Adds:
 *   - Notifications: in-app feed. Alert evaluator, auto-trader, and auth
 *     flows write here so the bell in the sidebar has content to show.
 *   - Sessions: active-session list (one row per issued JWT). Lets a user
 *     see "signed in from Chrome on macOS, last seen 5m ago" and revoke
 *     individual sessions without a full logout everywhere.
 *
 * Idempotent, same pattern as prior migrations.
 */

async function tableExists(qi, table) {
  try { await qi.describeTable(table); return true; }
  catch { return false; }
}
async function hasIndex(qi, table, indexName) {
  try {
    const indexes = await qi.showIndex(table);
    return indexes.some((idx) => idx.name === indexName);
  } catch {
    return false;
  }
}

export async function up({ context: qi, DataTypes }) {
  // ─── Notifications ───
  if (!(await tableExists(qi, 'Notifications'))) {
    await qi.createTable('Notifications', {
      id:      { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId:  { type: DataTypes.INTEGER, allowNull: false },
      type:    { type: DataTypes.STRING, allowNull: false }, // 'price-alert' | 'auto-trader' | 'security' | 'info'
      title:   { type: DataTypes.STRING, allowNull: false },
      body:    { type: DataTypes.TEXT },
      link:    { type: DataTypes.STRING },                    // optional deep-link path
      read:    { type: DataTypes.BOOLEAN, defaultValue: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  }
  if (!(await hasIndex(qi, 'Notifications', 'Notifications_userId_read'))) {
    try { await qi.addIndex('Notifications', ['userId', 'read'], { name: 'Notifications_userId_read' }); }
    catch { /* already present */ }
  }
  if (!(await hasIndex(qi, 'Notifications', 'Notifications_createdAt'))) {
    try { await qi.addIndex('Notifications', ['createdAt'], { name: 'Notifications_createdAt' }); }
    catch { /* already present */ }
  }

  // ─── Sessions ───
  if (!(await tableExists(qi, 'Sessions'))) {
    await qi.createTable('Sessions', {
      id:         { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId:     { type: DataTypes.INTEGER, allowNull: false },
      tokenHash:  { type: DataTypes.STRING, allowNull: false, unique: true },
      userAgent:  { type: DataTypes.STRING(256) },
      ip:         { type: DataTypes.STRING(45) },
      lastSeenAt: { type: DataTypes.DATE, allowNull: false },
      expiresAt:  { type: DataTypes.DATE, allowNull: false },
      createdAt:  { type: DataTypes.DATE, allowNull: false },
      updatedAt:  { type: DataTypes.DATE, allowNull: false },
    });
  }
  if (!(await hasIndex(qi, 'Sessions', 'Sessions_userId'))) {
    try { await qi.addIndex('Sessions', ['userId'], { name: 'Sessions_userId' }); }
    catch { /* already present */ }
  }
  if (!(await hasIndex(qi, 'Sessions', 'Sessions_expiresAt'))) {
    try { await qi.addIndex('Sessions', ['expiresAt'], { name: 'Sessions_expiresAt' }); }
    catch { /* already present */ }
  }
}

export async function down({ context: qi }) {
  const tryDrop = async (fn) => { try { await fn(); } catch { /* already gone */ } };
  await tryDrop(() => qi.dropTable('Sessions'));
  await tryDrop(() => qi.dropTable('Notifications'));
}
