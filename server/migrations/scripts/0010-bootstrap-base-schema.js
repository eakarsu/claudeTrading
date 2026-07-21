import sequelize from '../../db.js';
import '../../models/index.js';

// The original 0001 marker assumed tables had already been created with
// sequelize.sync(). New installations need that baseline as an explicit,
// idempotent migration before accounts can be provisioned.
export async function up() {
  await sequelize.sync();
}

export async function down() {
  throw new Error('The additive base-schema migration is not reversible');
}
