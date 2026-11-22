import User from '../models/User.js';
import { env } from '../config/env.js';

/**
 * Idempotently provisions initial administrative and operator accounts.
 * Reads credentials from environment variables, hashes passwords with bcrypt,
 * and ensures accounts are only created if they do not already exist.
 *
 * @returns {Promise<{ adminCreated: boolean, operatorCreated: boolean }>}
 */
export async function bootstrapPrivilegedUsers() {
  const result = {
    adminCreated: false,
    operatorCreated: false
  };

  // 1. Check & provision ADMIN account
  const adminEmail = (env.ADMIN_INITIAL_EMAIL || 'admin@jodhpur.emergency.gov.in').toLowerCase().trim();
  const existingAdmin = await User.findOne({ email: adminEmail });

  if (!existingAdmin) {
    const adminPassword = env.ADMIN_INITIAL_PASSWORD || 'AdminJodhpur2026!';
    const passwordHash = await User.hashPassword(adminPassword);

    await User.create({
      name: 'System Administrator',
      email: adminEmail,
      passwordHash,
      role: 'ADMIN',
      isActive: true
    });
    result.adminCreated = true;
    console.log(`[BOOTSTRAP] Initial ADMIN account successfully provisioned: ${adminEmail}`);
  } else {
    // Already exists - idempotent skip
    console.log(`[BOOTSTRAP] ADMIN account already exists (${adminEmail}); skipping.`);
  }

  // 2. Check & provision OPERATOR account
  const operatorEmail = (env.OPERATOR_INITIAL_EMAIL || 'operator@jodhpur.emergency.gov.in').toLowerCase().trim();
  const existingOperator = await User.findOne({ email: operatorEmail });

  if (!existingOperator) {
    const operatorPassword = env.OPERATOR_INITIAL_PASSWORD || 'OperatorJodhpur2026!';
    const passwordHash = await User.hashPassword(operatorPassword);

    await User.create({
      name: 'Emergency Dispatch Operator',
      email: operatorEmail,
      passwordHash,
      role: 'OPERATOR',
      isActive: true
    });
    result.operatorCreated = true;
    console.log(`[BOOTSTRAP] Initial OPERATOR account successfully provisioned: ${operatorEmail}`);
  } else {
    // Already exists - idempotent skip
    console.log(`[BOOTSTRAP] OPERATOR account already exists (${operatorEmail}); skipping.`);
  }

  return result;
}

export default bootstrapPrivilegedUsers;

