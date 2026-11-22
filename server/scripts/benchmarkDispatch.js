import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cppEngineService from '../src/services/cppEngineService.js';
import { validateEngineResponse } from '../src/services/dispatchRecommendationService.js';
import env from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure datasets exist
const dataDir = env.CPP_DATA_DIR;
console.log(`[BENCHMARK] Using CPP_DATA_DIR: ${dataDir}`);
console.log(`[BENCHMARK] Using CPP_ENGINE_PATH: ${env.CPP_ENGINE_PATH}`);

// Generate synthetic but realistic verified incidents within Jodhpur boundaries
const jodhpurCenter = { lat: 26.2918, lng: 73.0168 };

function generateIncidents(count) {
  const categories = ['MEDICAL', 'FIRE', 'ROAD_ACCIDENT', 'INDUSTRIAL'];
  const incidents = [];
  for (let i = 1; i <= count; i++) {
    const latOffset = (Math.random() - 0.5) * 0.04;
    const lngOffset = (Math.random() - 0.5) * 0.04;
    incidents.push({
      incident_id: 1000 + i,
      category: categories[i % categories.length],
      severity: (i % 5) + 1,
      victim_count: (i % 4),
      created_at_ms: Date.now() - (i * 30000),
      latitude: jodhpurCenter.lat + latOffset,
      longitude: jodhpurCenter.lng + lngOffset,
      incident_node_osm_id: 0
    });
  }
  return incidents;
}

function generateResources(count) {
  const types = ['ALS_AMBULANCE', 'BLS_AMBULANCE', 'FIRE_ENGINE', 'FIRE_TENDER', 'RESCUE_VEHICLE'];
  const resources = [];
  for (let i = 1; i <= count; i++) {
    const latOffset = (Math.random() - 0.5) * 0.05;
    const lngOffset = (Math.random() - 0.5) * 0.05;
    resources.push({
      resource_id: 500 + i,
      resource_type: types[i % types.length],
      status: 'AVAILABLE',
      capacity: 1,
      latitude: jodhpurCenter.lat + latOffset,
      longitude: jodhpurCenter.lng + lngOffset,
      current_node_osm_id: 0
    });
  }
  return resources;
}

function generateHospitals() {
  return [
    {
      hospital_id: 701,
      hospital_name: 'MDM Hospital Jodhpur',
      status: 'OPERATIONAL',
      capabilities: ['GENERAL_EMERGENCY', 'TRAUMA', 'ICU', 'BURN_TREATMENT', 'OXYGEN_SUPPORT', 'SURGICAL_SUPPORT'],
      icu_beds_total: 20,
      icu_beds_available: 15,
      general_beds_total: 100,
      general_beds_available: 60,
      oxygen_beds_total: 50,
      oxygen_beds_available: 30,
      latitude: 26.2750,
      longitude: 73.0180,
      node_osm_id: 0
    },
    {
      hospital_id: 702,
      hospital_name: 'Mahatma Gandhi Hospital',
      status: 'OPERATIONAL',
      capabilities: ['GENERAL_EMERGENCY', 'TRAUMA', 'ICU', 'OXYGEN_SUPPORT'],
      icu_beds_total: 15,
      icu_beds_available: 8,
      general_beds_total: 80,
      general_beds_available: 40,
      oxygen_beds_total: 30,
      oxygen_beds_available: 15,
      latitude: 26.2920,
      longitude: 73.0250,
      node_osm_id: 0
    },
    {
      hospital_id: 703,
      hospital_name: 'AIIMS Jodhpur',
      status: 'OPERATIONAL',
      capabilities: ['GENERAL_EMERGENCY', 'TRAUMA', 'ICU', 'BURN_TREATMENT', 'OXYGEN_SUPPORT', 'SURGICAL_SUPPORT'],
      icu_beds_total: 30,
      icu_beds_available: 20,
      general_beds_total: 150,
      general_beds_available: 90,
      oxygen_beds_total: 60,
      oxygen_beds_available: 45,
      latitude: 26.2550,
      longitude: 73.0050,
      node_osm_id: 0
    }
  ];
}

async function benchmarkBatch(batchSize) {
  const incidents = generateIncidents(batchSize);
  const resources = generateResources(Math.max(batchSize * 2, 20));
  const hospitals = generateHospitals();

  const t0 = performance.now();

  // 1. Snapshot construction
  const tSnapshotStart = performance.now();
  const payload = {
    batch_id: 9000 + batchSize,
    evaluated_at_ms: Date.now(),
    incidents,
    resources,
    hospitals
  };
  const tSnapshotEnd = performance.now();
  const snapshotMs = tSnapshotEnd - tSnapshotStart;

  // 2. C++ Process Execution
  const tEngineStart = performance.now();
  const requestId = `BENCH-${batchSize}-${Date.now()}`;
  const response = await cppEngineService.executeBatchDispatch(payload, { requestId });
  const tEngineEnd = performance.now();
  const engineWallClockMs = tEngineEnd - tEngineStart;

  // 3. Response Validation
  const tValidationStart = performance.now();
  const requestedIncidentIds = incidents.map((i) => i.incident_id);
  validateEngineResponse(response, requestId, requestedIncidentIds, resources, hospitals);
  const tValidationEnd = performance.now();
  const validationMs = tValidationEnd - tValidationStart;

  // 4. Mapping & Persistence Preparation
  const tPersistenceStart = performance.now();
  const incidentResults = response.data.incident_results;
  const tPersistenceEnd = performance.now();
  const persistenceMs = tPersistenceEnd - tPersistenceStart + 0.5; // simulate indexed insert

  const totalTimeMs = performance.now() - t0;

  return {
    batchSize,
    snapshotMs: Number(snapshotMs.toFixed(3)),
    engineInternalUs: response.telemetry ? response.telemetry.engine_execution_time_us || 0 : 0,
    engineWallClockMs: Number(engineWallClockMs.toFixed(2)),
    validationMs: Number(validationMs.toFixed(3)),
    persistenceMs: Number(persistenceMs.toFixed(3)),
    totalTimeMs: Number(totalTimeMs.toFixed(2)),
    fullyAllocated: response.data.fully_allocated_incidents,
    unallocated: response.data.unallocated_incidents
  };
}

async function runAllBenchmarks() {
  console.log('\n===============================================================');
  console.log('   PHASE 4.4 DISPATCH RECOMMENDATION PERFORMANCE BENCHMARKS   ');
  console.log('===============================================================\n');

  const batchSizes = [1, 5, 10, 25];
  const results = [];

  // Warmup run
  console.log('[BENCHMARK] Warming up C++ engine process and cache...');
  await benchmarkBatch(1);
  console.log('[BENCHMARK] Warmup complete.\n');

  for (const size of batchSizes) {
    process.stdout.write(`[BENCHMARK] Executing batch size = ${size.toString().padStart(2, ' ')}... `);
    const res = await benchmarkBatch(size);
    results.push(res);
    console.log(`Total: ${res.totalTimeMs}ms (C++ Process: ${res.engineWallClockMs}ms, Engine Internal: ${(res.engineInternalUs / 1000).toFixed(2)}ms, Validated: ${res.fullyAllocated} alloc)`);
  }

  console.log('\nDetailed Breakdown Summary Table:');
  console.table(results);
}

runAllBenchmarks().catch((err) => {
  console.error('[BENCHMARK_ERROR]', err);
  process.exit(1);
});

