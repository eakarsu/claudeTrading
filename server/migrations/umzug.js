import './../env.js';
import { Umzug, SequelizeStorage } from 'umzug';
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Umzug migrator.
 * Migration files live in ./scripts/*.js and each exports { up, down }.
 * Metadata is stored in the SequelizeMeta table — matches sequelize-cli default
 * so future migration to the CLI remains painless.
 */
export const migrator = new Umzug({
  migrations: {
    glob: ['scripts/*.js', { cwd: __dirname }],
    resolve: ({ name, path: filepath }) => ({
      name,
      up: async () => {
        const m = await import(filepath);
        return m.up({ context: sequelize.getQueryInterface(), DataTypes, sequelize });
      },
      down: async () => {
        const m = await import(filepath);
        return m.down({ context: sequelize.getQueryInterface(), DataTypes, sequelize });
      },
    }),
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});

// Allow running via `node server/migrations/umzug.js up|down|pending|executed`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] || 'up';
  const run = async () => {
    try {
      const result = await migrator.runAsCLI([cmd]);
      if (!result) process.exit(1);
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  };
  run();
}
