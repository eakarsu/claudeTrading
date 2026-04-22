/**
 * 0006 — MarketNews.url.
 *
 * Adds a nullable `url` column to MarketNews so rows can carry an
 * outbound link to the source article. Older rows stay NULL — the UI
 * falls back to plain-text title when no URL is present.
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

export async function up({ context: qi, DataTypes }) {
  if (await tableExists(qi, 'MarketNews') && !(await columnExists(qi, 'MarketNews', 'url'))) {
    await qi.addColumn('MarketNews', 'url', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });
  }
}

export async function down({ context: qi }) {
  try { await qi.removeColumn('MarketNews', 'url'); }
  catch { /* already gone */ }
}
