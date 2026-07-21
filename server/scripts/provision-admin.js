import '../env.js';
import bcryptjs from 'bcryptjs';
import sequelize from '../db.js';
import { User } from '../models/index.js';

async function main() {
  if (process.env.BOOTSTRAP_ACKNOWLEDGEMENT !== 'create-initial-admin') {
    throw new Error('BOOTSTRAP_ACKNOWLEDGEMENT=create-initial-admin is required');
  }
  const email = String(process.env.PROVISION_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.PROVISION_ADMIN_PASSWORD || '');
  const name = String(process.env.PROVISION_ADMIN_NAME || '').trim();
  if (!email.includes('@') || password.length < 12 || !name) {
    throw new Error('PROVISION_ADMIN_EMAIL, PROVISION_ADMIN_PASSWORD (12+ characters), and PROVISION_ADMIN_NAME are required');
  }
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    console.log(JSON.stringify({ event: 'initial_admin_exists', userId: existing.id }));
    return;
  }
  const user = await User.create({
    email,
    password: await bcryptjs.hash(password, 12),
    name,
    role: 'admin',
  });
  console.log(JSON.stringify({ event: 'initial_admin_created', userId: user.id }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => sequelize.close());
