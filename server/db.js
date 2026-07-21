import './env.js';
import { Sequelize } from 'sequelize';

const databaseUrl = process.env.DATABASE_URL || (() => {
  const user = encodeURIComponent(process.env.DB_USER || 'postgres');
  const password = encodeURIComponent(process.env.DB_PASSWORD || 'postgres');
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const name = encodeURIComponent(process.env.DB_NAME || 'claude_trading');
  return `postgres://${user}:${password}@${host}:${port}/${name}`;
})();

const sequelize = new Sequelize(databaseUrl, {
  logging: false,
  dialect: 'postgres',
  dialectOptions: process.env.DB_SSL === 'true'
    ? { ssl: { require: true, rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } }
    : {},
});

export default sequelize;
