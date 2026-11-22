import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { bootstrapPrivilegedUsers } from '../src/utils/bootstrapAdmin.js';

async function run() {
  console.log('================================================================');
  console.log(' Emergency Resource Allocation System - Privileged User Seeder');
  console.log('================================================================');

  const connected = await connectDatabase();
  if (!connected) {
    console.error('[BOOTSTRAP_ERROR] Database connection failed. Cannot bootstrap accounts.');
    process.exit(1);
  }

  try {
    const outcome = await bootstrapPrivilegedUsers();
    console.log(`[BOOTSTRAP_COMPLETE] Summary: Admin created: ${outcome.adminCreated}, Operator created: ${outcome.operatorCreated}`);
  } catch (err) {
    console.error(`[BOOTSTRAP_ERROR] Failed during account seeding: ${err.message}`);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

run();

