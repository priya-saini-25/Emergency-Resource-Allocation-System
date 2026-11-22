import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { bootstrapSimulationData } from '../src/utils/bootstrapSimulationData.js';

async function main() {
  console.log('================================================================');
  console.log(' Emergency Resource Allocation System - Simulation Data Seeder');
  console.log(' Jodhpur Urban Service Area (Academic Prototype)');
  console.log('================================================================');

  const connected = await connectDatabase();
  if (!connected) {
    console.error('[SEED_ERROR] Database connection failed. Aborting seeder.');
    process.exit(1);
  }

  try {
    const stats = await bootstrapSimulationData();
    console.log('[SEED_COMPLETE] Summary of seed operations:');
    console.log(`  - Hospitals Created: ${stats.hospitalsCreated}`);
    console.log(`  - Hospitals Skipped (already exist): ${stats.hospitalsSkipped}`);
    console.log(`  - Resources Created: ${stats.resourcesCreated}`);
    console.log(`  - Resources Skipped (already exist): ${stats.resourcesSkipped}`);
  } catch (err) {
    console.error(`[SEED_ERROR] Failed during simulation seeding: ${err.message}`);
    process.exit(1);
  } finally {
    await disconnectDatabase();
    console.log('[SEED] Database disconnected cleanly.');
  }
}

main();
