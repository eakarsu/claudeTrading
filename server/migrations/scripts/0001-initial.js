/**
 * Baseline migration.
 *
 * The project initially relied on `sequelize.sync()` to create tables, so the
 * live schema already matches the models in `server/models/index.js`. This
 * migration is a no-op marker: running it establishes the SequelizeMeta row so
 * future migrations can be applied incrementally without resync'ing tables.
 *
 * New schema changes should be added as numbered files (0002-..., 0003-...).
 */
export async function up() {
  // No-op — schema already created by sync().
}

export async function down() {
  // No-op — initial baseline is not reversible.
}
