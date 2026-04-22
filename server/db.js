import './env.js';
import { Sequelize } from 'sequelize';

const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/claude_trading';

const sequelize = new Sequelize(databaseUrl, {
  logging: false,
  dialect: 'postgres',
});

export default sequelize;
