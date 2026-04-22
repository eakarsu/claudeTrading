/**
 * 0007 — AI Investment Themes.
 *
 * Creates three tables:
 *   - Themes            (global, admin-managed structural investment themes)
 *   - ThemeConstituents (member tickers per theme with rationale + weight)
 *   - ThemeAlerts       (per-user alerts bound to a theme basket)
 *
 * Idempotent. Down drops all three in reverse order.
 *
 * Seed data is not inserted here — seed.js handles it so a reset picks it up.
 */

async function tableExists(qi, table) {
  try { await qi.describeTable(table); return true; }
  catch { return false; }
}

export async function up({ context: qi, DataTypes }) {
  if (!(await tableExists(qi, 'Themes'))) {
    await qi.createTable('Themes', {
      id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      slug:       { type: DataTypes.STRING, allowNull: false, unique: true },
      name:       { type: DataTypes.STRING, allowNull: false },
      tagline:    { type: DataTypes.STRING },
      thesisMd:   { type: DataTypes.TEXT },
      disclaimer: { type: DataTypes.TEXT },
      order:      { type: DataTypes.INTEGER, defaultValue: 0 },
      createdAt:  { type: DataTypes.DATE, allowNull: false },
      updatedAt:  { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('Themes', ['slug']);
    await qi.addIndex('Themes', ['order']);
  }

  if (!(await tableExists(qi, 'ThemeConstituents'))) {
    await qi.createTable('ThemeConstituents', {
      id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      themeId:    { type: DataTypes.INTEGER, allowNull: false },
      symbol:     { type: DataTypes.STRING, allowNull: false },
      rationale:  { type: DataTypes.TEXT },
      weight:     { type: DataTypes.FLOAT, defaultValue: 1.0 },
      createdAt:  { type: DataTypes.DATE, allowNull: false },
      updatedAt:  { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('ThemeConstituents', ['themeId']);
    await qi.addIndex('ThemeConstituents', ['themeId', 'symbol'], { unique: true });
  }

  if (!(await tableExists(qi, 'ThemeAlerts'))) {
    await qi.createTable('ThemeAlerts', {
      id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId:     { type: DataTypes.INTEGER, allowNull: true },
      themeId:    { type: DataTypes.INTEGER, allowNull: false },
      kind:       { type: DataTypes.STRING, defaultValue: 'basket-change-pct' },
      threshold:  { type: DataTypes.FLOAT, allowNull: false },
      baseline:   { type: DataTypes.FLOAT },
      status:     { type: DataTypes.STRING, defaultValue: 'active' },
      notes:      { type: DataTypes.TEXT },
      createdAt:  { type: DataTypes.DATE, allowNull: false },
      updatedAt:  { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('ThemeAlerts', ['userId']);
    await qi.addIndex('ThemeAlerts', ['themeId']);
  }
}

export async function down({ context: qi }) {
  try { await qi.dropTable('ThemeAlerts'); } catch { /* gone */ }
  try { await qi.dropTable('ThemeConstituents'); } catch { /* gone */ }
  try { await qi.dropTable('Themes'); } catch { /* gone */ }
}
