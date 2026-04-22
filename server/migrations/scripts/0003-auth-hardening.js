/**
 * 0003 — auth hardening.
 *
 * Follows 0002. Adds:
 *   - Users.totpSecret / totpEnabled / totpBackupCodes  (optional 2FA)
 *   - RevokedTokens   (server-side logout blocklist)
 *   - PasswordResetTokens (one-shot password reset tokens)
 *
 * Idempotent, same pattern as 0002: each addition is guarded by a
 * describeTable / showIndex check so this migration runs cleanly against a
 * dev DB that already has sequelize.sync() applied.
 */

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

export async function up({ context: qi, DataTypes }) {
  // ─── Users: 2FA columns ───
  if (await tableExists(qi, 'Users')) {
    if (!(await hasColumn(qi, 'Users', 'totpSecret'))) {
      await qi.addColumn('Users', 'totpSecret', { type: DataTypes.STRING });
    }
    if (!(await hasColumn(qi, 'Users', 'totpEnabled'))) {
      await qi.addColumn('Users', 'totpEnabled', {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      });
    }
    if (!(await hasColumn(qi, 'Users', 'totpBackupCodes'))) {
      await qi.addColumn('Users', 'totpBackupCodes', {
        type: DataTypes.JSON,
        defaultValue: [],
      });
    }
  }

  // ─── RevokedTokens ───
  if (!(await tableExists(qi, 'RevokedTokens'))) {
    await qi.createTable('RevokedTokens', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
      userId:    { type: DataTypes.INTEGER },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  }
  // Guard the index creation in case the unique was already asserted inline.
  if (!(await hasIndex(qi, 'RevokedTokens', 'RevokedTokens_expiresAt'))) {
    try {
      await qi.addIndex('RevokedTokens', ['expiresAt'], {
        name: 'RevokedTokens_expiresAt',
      });
    } catch { /* already present */ }
  }

  // ─── PasswordResetTokens ───
  if (!(await tableExists(qi, 'PasswordResetTokens'))) {
    await qi.createTable('PasswordResetTokens', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
      userId:    { type: DataTypes.INTEGER, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      usedAt:    { type: DataTypes.DATE },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  }
  if (!(await hasIndex(qi, 'PasswordResetTokens', 'PasswordResetTokens_userId'))) {
    try {
      await qi.addIndex('PasswordResetTokens', ['userId'], {
        name: 'PasswordResetTokens_userId',
      });
    } catch { /* already present */ }
  }
}

export async function down({ context: qi }) {
  const tryDrop = async (fn) => { try { await fn(); } catch { /* already gone */ } };

  await tryDrop(() => qi.dropTable('PasswordResetTokens'));
  await tryDrop(() => qi.dropTable('RevokedTokens'));

  if (await tableExists(qi, 'Users')) {
    await tryDrop(() => qi.removeColumn('Users', 'totpSecret'));
    await tryDrop(() => qi.removeColumn('Users', 'totpEnabled'));
    await tryDrop(() => qi.removeColumn('Users', 'totpBackupCodes'));
  }
}
