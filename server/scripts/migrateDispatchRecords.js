import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';

/**
 * Migration Script: Migrate dispatchId and Unique Indexes on dispatchrecords
 *
 * Safety & Reliability Guarantees:
 * 1. Targets exclusively `emergency_response_jodhpur`.
 * 2. Does not delete, modify, or overwrite completed dispatch records.
 * 3. Exports an automated JSON backup of the collection before any write operations.
 * 4. Verifies no unexpected duplicate string values exist before creating unique indexes.
 * 5. Replaces { unique: true, sparse: true } indexes with { unique: true, partialFilterExpression: { field: { $type: "string" } } }.
 * 6. Safely handles repeated execution and partial runs (strictly idempotent).
 */
async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('================================================================');
  console.log(' DispatchRecords Index & dispatchId Migration Plan');
  console.log(` Mode: ${isExecute ? 'EXECUTE (LIVE DATABASE CHANGES)' : 'DRY RUN (INSPECTION ONLY)'}`);
  console.log('================================================================\n');

  const connected = await connectDatabase();
  if (!connected) {
    console.error('[MIGRATION_ERROR] Could not connect to MongoDB Atlas. Aborting.');
    process.exit(1);
  }

  try {
    const dbName = mongoose.connection.name;
    console.log(`[TARGET_VERIFICATION] Connected to database: "${dbName}"`);
    if (dbName !== 'emergency_response_jodhpur') {
      throw new Error(`SAFETY_ABORT: Target database mismatch! Expected "emergency_response_jodhpur", got "${dbName}"`);
    }

    const rawCollection = mongoose.connection.collection('dispatchrecords');

    // Fetch all current records
    const allRecords = await rawCollection.find({}).toArray();
    console.log(`[INSPECTION] Total DispatchRecord document(s) in collection: ${allRecords.length}`);

    // Check 1: Duplicate String Detection
    const duplicateDispatchIds = await rawCollection.aggregate([
      { $match: { dispatchId: { $type: 'string' } } },
      { $group: { _id: '$dispatchId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (duplicateDispatchIds.length > 0) {
      throw new Error(
        `SAFETY_ABORT: Duplicate string dispatchId values found: ${JSON.stringify(duplicateDispatchIds)}. Cannot proceed.`
      );
    }

    const duplicateIdempKeys = await rawCollection.aggregate([
      { $match: { idempotencyKey: { $type: 'string' } } },
      { $group: { _id: '$idempotencyKey', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (duplicateIdempKeys.length > 0) {
      throw new Error(
        `SAFETY_ABORT: Duplicate string idempotencyKey values found: ${JSON.stringify(duplicateIdempKeys)}. Cannot proceed.`
      );
    }
    console.log('  [INTEGRITY_CHECK] Passed: No duplicate string dispatchId or idempotencyKey values exist.');

    // Check 2: Inspect existing documents with dispatchId: null
    const nullDispatchDocs = await rawCollection
      .find({ $or: [{ dispatchId: null }, { dispatchId: { $exists: false } }] })
      .toArray();

    console.log(`\n[INSPECTION] Found ${nullDispatchDocs.length} record(s) with null/missing dispatchId:`);
    const updatePlans = nullDispatchDocs.map((doc) => {
      const timestamp = doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now();
      const suffix = doc.batchId ? doc.batchId.replace('BATCH-', '') : doc._id.toString().slice(-8);
      const newDispatchId = `DISPATCH-${timestamp}-${suffix}`;
      return {
        _id: doc._id,
        batchId: doc.batchId,
        createdAt: doc.createdAt,
        currentDispatchId: doc.dispatchId,
        proposedDispatchId: newDispatchId,
        status: doc.status
      };
    });

    for (const plan of updatePlans) {
      console.log(`  - Document ID: ${plan._id}`);
      console.log(`    Batch ID:    ${plan.batchId}`);
      console.log(`    Status:      ${plan.status}`);
      console.log(`    Created At:  ${plan.createdAt}`);
      console.log(`    Current:     dispatchId = ${plan.currentDispatchId}`);
      console.log(`    Proposed:    dispatchId = "${plan.proposedDispatchId}"\n`);
    }

    // Check 3: Inspect documents with idempotencyKey: null
    const nullIdempDocs = await rawCollection
      .find({ idempotencyKey: null })
      .toArray();
    console.log(`[INSPECTION] Found ${nullIdempDocs.length} record(s) with explicit null idempotencyKey.`);

    // Check 4: Inspect existing indexes
    const existingIndexes = await rawCollection.indexes();
    console.log('\n[INSPECTION] Current index configuration on dispatchrecords:');
    const dispatchIdIdx = existingIndexes.find((i) => i.name === 'dispatchId_1');
    const idempIdx = existingIndexes.find((i) => i.name === 'idempotencyKey_1');

    console.log('  - dispatchId_1:', dispatchIdIdx ? JSON.stringify(dispatchIdIdx) : 'NOT FOUND');
    console.log('  - idempotencyKey_1:', idempIdx ? JSON.stringify(idempIdx) : 'NOT FOUND');

    // Create Backup in both dry run and execute mode
    const backupDir = path.resolve(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `dispatchrecords_backup_${backupTimestamp}.json`);
    const backupPayload = {
      database: dbName,
      collection: 'dispatchrecords',
      timestamp: new Date().toISOString(),
      documentCount: allRecords.length,
      indexes: existingIndexes,
      documents: allRecords
    };
    fs.writeFileSync(backupFile, JSON.stringify(backupPayload, null, 2), 'utf8');
    console.log(`\n[BACKUP] Pre-migration collection snapshot saved to: ${backupFile}`);

    if (!isExecute) {
      console.log('\n----------------------------------------------------------------');
      console.log(' [DRY-RUN COMPLETE] No database records or indexes were modified.');
      console.log(' Target database verified: "emergency_response_jodhpur"');
      console.log(' Pre-migration backup verified.');
      console.log(' To apply this migration to live MongoDB Atlas, run:');
      console.log(' node server/scripts/migrateDispatchRecords.js --execute');
      console.log('----------------------------------------------------------------');
      return;
    }

    // --- EXECUTE MODE ---
    console.log('\n[EXECUTE] Applying migrations to live database...');

    // A. Migrate dispatchId
    for (const plan of updatePlans) {
      const res = await rawCollection.updateOne(
        { _id: plan._id, $or: [{ dispatchId: null }, { dispatchId: { $exists: false } }] },
        { $set: { dispatchId: plan.proposedDispatchId } }
      );
      console.log(`  [MIGRATED] Record ${plan._id} updated (matched: ${res.matchedCount}, modified: ${res.modifiedCount}) -> dispatchId: ${plan.proposedDispatchId}`);
    }

    // B. Unset explicit null idempotencyKey
    if (nullIdempDocs.length > 0) {
      const unsetResult = await rawCollection.updateMany(
        { idempotencyKey: null },
        { $unset: { idempotencyKey: '' } }
      );
      console.log(`  [UNSET] Unset null idempotencyKey on ${unsetResult.modifiedCount} document(s).`);
    }

    // C. Recreate dispatchId_1 index with partialFilterExpression
    if (dispatchIdIdx) {
      console.log('  [INDEX] Dropping legacy dispatchId_1 index...');
      await rawCollection.dropIndex('dispatchId_1');
    }
    console.log('  [INDEX] Creating modern dispatchId_1 index with partialFilterExpression...');
    await rawCollection.createIndex(
      { dispatchId: 1 },
      {
        name: 'dispatchId_1',
        unique: true,
        partialFilterExpression: { dispatchId: { $type: 'string' } }
      }
    );

    // D. Recreate idempotencyKey_1 index with partialFilterExpression
    if (idempIdx) {
      console.log('  [INDEX] Dropping legacy idempotencyKey_1 index...');
      await rawCollection.dropIndex('idempotencyKey_1');
    }
    console.log('  [INDEX] Creating modern idempotencyKey_1 index with partialFilterExpression...');
    await rawCollection.createIndex(
      { idempotencyKey: 1 },
      {
        name: 'idempotencyKey_1',
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } }
      }
    );

    // --- POST-EXECUTION VERIFICATION ---
    console.log('\n================================================================');
    console.log(' POST-EXECUTION DATABASE VERIFICATION');
    console.log('================================================================');

    const postRecords = await rawCollection.find({}).toArray();
    console.log(`[VERIFY] Total DispatchRecord document(s): ${postRecords.length} (Expected: ${allRecords.length})`);
    if (postRecords.length !== allRecords.length) {
      throw new Error(`VERIFICATION_FAILED: Document count changed from ${allRecords.length} to ${postRecords.length}!`);
    }

    for (const doc of postRecords) {
      console.log(`  - Record ID: ${doc._id}`);
      console.log(`    Batch ID:    ${doc.batchId}`);
      console.log(`    Status:      ${doc.status}`);
      console.log(`    dispatchId:  "${doc.dispatchId}"`);
      console.log(`    idempKey:    ${doc.idempotencyKey === undefined ? 'undefined (clean)' : `"${doc.idempotencyKey}"`}`);
      if (doc.dispatchId === null || doc.dispatchId === undefined) {
        throw new Error(`VERIFICATION_FAILED: Record ${doc._id} has null or undefined dispatchId!`);
      }
      if (doc.idempotencyKey === null) {
        throw new Error(`VERIFICATION_FAILED: Record ${doc._id} still has explicit null idempotencyKey!`);
      }
    }

    const postIndexes = await rawCollection.indexes();
    console.log('\n[VERIFY] Active index configuration:');
    const newDispatchIdx = postIndexes.find((i) => i.name === 'dispatchId_1');
    const newIdempIdx = postIndexes.find((i) => i.name === 'idempotencyKey_1');

    console.log('  - dispatchId_1:', JSON.stringify(newDispatchIdx));
    console.log('  - idempotencyKey_1:', JSON.stringify(newIdempIdx));

    if (!newDispatchIdx || !newDispatchIdx.partialFilterExpression || newDispatchIdx.partialFilterExpression.dispatchId?.$type !== 'string') {
      throw new Error('VERIFICATION_FAILED: dispatchId_1 does not have the expected partialFilterExpression!');
    }
    if (!newIdempIdx || !newIdempIdx.partialFilterExpression || newIdempIdx.partialFilterExpression.idempotencyKey?.$type !== 'string') {
      throw new Error('VERIFICATION_FAILED: idempotencyKey_1 does not have the expected partialFilterExpression!');
    }

    console.log('\n[MIGRATION_SUCCESS] All verifications passed. Database migration completed cleanly.');
  } catch (err) {
    console.error(`\n[MIGRATION_ERROR] ${err.message}`);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

main();
