import { performance } from 'perf_hooks';
import { confirmDispatch } from '../src/services/dispatchExecutionService.js';
import DispatchRecord from '../src/models/DispatchRecord.js';
import Incident from '../src/models/Incident.js';
import Resource from '../src/models/Resource.js';
import Hospital from '../src/models/Hospital.js';

function createMockSession() {
  return {
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    async endSession() {}
  };
}

const operatorUser = {
  _id: '507f1f77bcf86cd799439088',
  id: '507f1f77bcf86cd799439088',
  name: 'Operator Dan',
  role: 'OPERATOR'
};

function createMockRecommendation(batchSize) {
  const incidentResults = [];
  const includedIncidentIds = [];

  for (let i = 1; i <= batchSize; i++) {
    const incId = 1000 + i;
    const resId = 500 + i;
    includedIncidentIds.push(incId);

    incidentResults.push({
      incidentId: incId,
      allocationStatus: 'SUCCESS',
      assignedResources: [
        {
          resourceId: resId,
          resourceType: 'FIRE_ENGINE'
        }
      ],
      resourceShortages: [],
      recommendedHospital: {
        hospitalId: 701 + (i % 3),
        hospitalName: `Hospital ${701 + (i % 3)}`,
        allocatedIcuBeds: 1,
        allocatedGeneralBeds: 1,
        allocatedOxygenBeds: 0
      }
    });
  }

  return {
    batchId: `BATCH-BENCH-${batchSize}`,
    requestId: `REQ-BENCH-${batchSize}`,
    recommendationStatus: 'RECOMMENDED',
    confirmationStatus: 'PENDING',
    batchStatus: 'SUCCESS',
    totalIncidents: batchSize,
    includedIncidentIds,
    incidentResults,
    confirmationAuditTrail: [],
    save: async function () { return this; }
  };
}

async function benchmarkConfirmation(batchSize) {
  const mockSession = createMockSession();
  const mockRec = createMockRecommendation(batchSize);

  const origRecFind = DispatchRecord.findOne;
  const origIncFind = Incident.find;
  const origResFindOneAndUpdate = Resource.findOneAndUpdate;
  const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
  const origIncFindOneAndUpdate = Incident.findOneAndUpdate;

  let lookupMs = 0;
  let validationMs = 0;
  let resourceMs = 0;
  let hospitalMs = 0;
  let incidentMs = 0;
  let commitMs = 0;

  DispatchRecord.findOne = async (q) => {
    if (q && q.idempotencyKey) {
      return null;
    }
    const t0 = performance.now();
    const res = mockRec;
    lookupMs = performance.now() - t0;
    return res;
  };

  Incident.find = async () => {
    const t0 = performance.now();
    const list = mockRec.includedIncidentIds.map((id) => ({ incidentId: id, status: 'VERIFIED' }));
    validationMs = performance.now() - t0;
    return list;
  };

  Resource.findOneAndUpdate = async () => {
    const t0 = performance.now();
    const r = { resourceId: 501, status: 'DISPATCHED' };
    resourceMs += performance.now() - t0;
    return r;
  };

  Hospital.findOneAndUpdate = async () => {
    const t0 = performance.now();
    const h = { hospitalId: 701, status: 'OPERATIONAL' };
    hospitalMs += performance.now() - t0;
    return h;
  };

  Incident.findOneAndUpdate = async () => {
    const t0 = performance.now();
    const inc = { incidentId: 1001, status: 'DISPATCHED' };
    incidentMs += performance.now() - t0;
    return inc;
  };

  const tTotalStart = performance.now();
  try {
    const result = await confirmDispatch(
      `BATCH-BENCH-${batchSize}`,
      {
        idempotencyKey: `key-bench-${batchSize}-${Date.now()}`,
        sessionOverride: mockSession
      },
      operatorUser
    );
    const totalMs = performance.now() - tTotalStart;

    return {
      batchSize,
      lookupMs: Number(lookupMs.toFixed(3)),
      validationMs: Number(validationMs.toFixed(3)),
      resourceReservationMs: Number(resourceMs.toFixed(3)),
      hospitalReservationMs: Number(hospitalMs.toFixed(3)),
      incidentUpdateMs: Number(incidentMs.toFixed(3)),
      totalConfirmationMs: Number(totalMs.toFixed(3)),
      status: result.confirmationStatus
    };
  } finally {
    DispatchRecord.findOne = origRecFind;
    Incident.find = origIncFind;
    Resource.findOneAndUpdate = origResFindOneAndUpdate;
    Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
    Incident.findOneAndUpdate = origIncFindOneAndUpdate;
  }
}

async function runBenchmarks() {
  console.log('\n===============================================================');
  console.log('   PHASE 4.5 DISPATCH CONFIRMATION PERFORMANCE BENCHMARKS      ');
  console.log('===============================================================\n');

  const batchSizes = [1, 5, 10, 25];
  const results = [];

  for (const size of batchSizes) {
    const res = await benchmarkConfirmation(size);
    results.push(res);
    console.log(`[BENCHMARK] Batch Size = ${size.toString().padStart(2, ' ')}: Total Latency = ${res.totalConfirmationMs}ms (Resources: ${res.resourceReservationMs}ms, Hospitals: ${res.hospitalReservationMs}ms, Incidents: ${res.incidentUpdateMs}ms)`);
  }

  console.log('\nDetailed Breakdown Summary Table:');
  console.table(results);
}

runBenchmarks().catch(console.error);
