export async function up({ context: qi, DataTypes }) {
  const tables = (await qi.showAllTables()).map(String);
  if (tables.includes('RuntimeAiResults')) return;
  await qi.createTable('RuntimeAiResults', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    prompt: { type: DataTypes.TEXT, allowNull: false },
    model: { type: DataTypes.STRING, allowNull: false },
    provider: { type: DataTypes.STRING, allowNull: false },
    providerReceipt: { type: DataTypes.STRING, allowNull: false },
    result: { type: DataTypes.TEXT, allowNull: false },
    usage: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex('RuntimeAiResults', ['userId', 'createdAt']);
}

export async function down({ context: qi }) {
  await qi.dropTable('RuntimeAiResults');
}
