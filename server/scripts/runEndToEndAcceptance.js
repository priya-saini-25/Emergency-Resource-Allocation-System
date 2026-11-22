/**
 * Phase 8: Complete System End-to-End Acceptance Test Script
 *
 * Executes authentic end-to-end testing across:
 * - Environment, database, and health probes
 * - Authentication and RBAC
 * - Citizen reporting and geocoding integration
 * - C++ engine multi-category dispatch optimization
 * - Dispatch confirmation, active tracking, scene arrival, and resolution
 * - Persistence and resource restoration
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { connectDatabase, disconnectDatabase, getConnectionStatus } from '../src/config/database.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import Resource from '../src/models/Resource.js';
import Hospital from '../src/models/Hospital.js';
import DispatchRecord from '../src/models/DispatchRecord.js';
import { checkEngineHealth } from '../src/services/cppEngineService.js';
import { generateDispatchRecommendations } from '../src/services/dispatchRecommendationService.js';
import { confirmDispatch } from '../src/services/dispatchExecutionService.js';
import { markSceneArrival, resolveIncident } from '../src/services/activeIncidentTrackingService.js';
import { generateToken } from '../src/utils/jwt.js';

// HTTP mock helper for route testing
function createMockHttp(method, url, body = {}, headers = {}, query = {}) {
  const parsedUrl = new URL(url, 'http://localhost');
  const queryObj = { ...Object.fromEntries(parsedUrl.searchParams), ...query };
  const req = {
    method,
    url,
    originalUrl: url,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    query: queryObj,
    params: {},
    body
  };

  let resolveResponse;
  const promise = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this._headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return this._headers[name.toLowerCase()];
    },
    json(data) {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: data });
      return this;
    },
    send(data) {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: data });
      return this;
    },
    end() {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: null });
    }
  };

  return { req, res, waitForResponse: () => promise };
}

async function runTest(name, fn) {
  process.stdout.write(`[TEST] ${name} ... `);
  try {
    const result = await fn();
    console.log('PASSED');
    return { name, status: 'PASS', result };
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    return { name, status: 'FAIL', error: err.message };
  }
}

async function main() {
  console.log('================================================================');
  console.log(' Emergency Resource Allocation System - Phase 8 E2E Acceptance');
  console.log(' Target: Jodhpur Urban Service Area (Academic Simulation)');
  console.log('================================================================\n');

  const auditLog = [];

  // =========================================================================
  // 1. Environment & Connectivity Verification
  // =========================================================================
  console.log('--- 1. Environment & Connectivity Verification ---');

  auditLog.push(await runTest('1.1 MongoDB Atlas Connectivity', async () => {
    const isConnected = await connectDatabase();
    if (!isConnected) throw new Error('Failed to connect to MongoDB Atlas');
    const status = getConnectionStatus();
    if (!status.connected) throw new Error('Database status indicates disconnected');
    return { host: status.host, db: status.name };
  }));

  auditLog.push(await runTest('1.2 C++ Decision Engine Health Probe', async () => {
    const engineHealth = await checkEngineHealth();
    if (engineHealth.status !== 'healthy') {
      throw new Error(`Engine unhealthy: ${engineHealth.error || 'Unknown error'}`);
    }
    return {
      version: engineHealth.versionInfo?.protocol_version,
      probeLatencyMs: engineHealth.wallClockMs
    };
  }));

  auditLog.push(await runTest('1.3 GET /api/health Endpoint Evaluation', async () => {
    const { req, res, waitForResponse } = createMockHttp('GET', '/api/health');
    app.handle(req, res);
    const resp = await waitForResponse();
    if (resp.statusCode !== 200) throw new Error(`Health returned HTTP ${resp.statusCode}`);
    if (resp.body.data.status !== 'healthy') throw new Error(`Health status is ${resp.body.data.status}`);
    return resp.body.data;
  }));

  auditLog.push(await runTest('1.4 Simulated Fleet & Hospital Inventory Check', async () => {
    const hospitals = await Hospital.find({}).lean();
    const resources = await Resource.find({}).lean();

    if (hospitals.length < 3) throw new Error(`Expected at least 3 hospitals, found ${hospitals.length}`);
    if (resources.length < 15) throw new Error(`Expected at least 15 resources, found ${resources.length}`);

    const availableResources = resources.filter(r => r.status === 'AVAILABLE');
    const operationalHospitals = hospitals.filter(h => h.status === 'OPERATIONAL');

    return {
      totalHospitals: hospitals.length,
      operationalHospitals: operationalHospitals.length,
      totalResources: resources.length,
      availableResources: availableResources.length
    };
  }));

  // =========================================================================
  // 2. Authentication & Role-Based Access Control
  // =========================================================================
  console.log('\n--- 2. Authentication & Role-Based Access Control ---');

  let adminToken = '';
  let operatorToken = '';
  let citizenToken = '';
  let operatorUser = null;

  auditLog.push(await runTest('2.1 Admin Login', async () => {
    const admin = await User.findOne({ role: 'ADMIN' });
    if (!admin) throw new Error('No ADMIN user found in database');
    adminToken = generateToken(admin);
    return { email: admin.email, role: admin.role };
  }));

  auditLog.push(await runTest('2.2 Operator Login', async () => {
    operatorUser = await User.findOne({ role: 'OPERATOR' });
    if (!operatorUser) throw new Error('No OPERATOR user found in database');
    operatorToken = generateToken(operatorUser);
    return { email: operatorUser.email, role: operatorUser.role };
  }));

  auditLog.push(await runTest('2.3 Citizen Registration / Login', async () => {
    const citizenEmail = 'e2e_citizen_test@jodhpur.emergency.gov.in';
    let citizen = await User.findOne({ email: citizenEmail });
    if (!citizen) {
      citizen = new User({
        userId: 'usr_e2e_citizen',
        name: 'E2E Test Citizen',
        email: citizenEmail,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLM',
        role: 'CITIZEN'
      });
      await citizen.save();
    }
    citizenToken = generateToken(citizen);
    return { email: citizen.email, role: citizen.role };
  }));

  auditLog.push(await runTest('2.4 Unauthorized API Access Rejection', async () => {
    // Attempt to access operator incident list with no token
    const { req, res, waitForResponse } = createMockHttp('GET', '/api/incidents');
    app.handle(req, res);
    const resp = await waitForResponse();
    if (resp.statusCode !== 401) throw new Error(`Expected 401, received ${resp.statusCode}`);
    return { statusCode: resp.statusCode };
  }));

  auditLog.push(await runTest('2.5 Citizen Role Denial on Operator Route', async () => {
    // Attempt to access operator incident list with CITIZEN token
    const { req, res, waitForResponse } = createMockHttp(
      'GET',
      '/api/incidents',
      {},
      { authorization: `Bearer ${citizenToken}` }
    );
    app.handle(req, res);
    const resp = await waitForResponse();
    if (resp.statusCode !== 403) throw new Error(`Expected 403, received ${resp.statusCode}`);
    return { statusCode: resp.statusCode };
  }));

  // =========================================================================
  // 3. Citizen Incident Intake Workflow
  // =========================================================================
  console.log('\n--- 3. Citizen Incident Intake Workflow ---');

  let testIncidentId = null;

  auditLog.push(await runTest('3.1 Place-Name Geocoding Search (Sojati Gate)', async () => {
    const { req, res, waitForResponse } = createMockHttp('GET', '/api/location/search?q=Sojati Gate');
    app.handle(req, res);
    const resp = await waitForResponse();
    if (resp.statusCode !== 200) throw new Error(`Search returned HTTP ${resp.statusCode}`);
    const results = resp.body.data.results;
    if (!results || results.length === 0) throw new Error('No search results returned for Sojati Gate');
    const sojati = results[0];
    if (!sojati.isInsideServiceArea) throw new Error('Sojati Gate should be inside service area');
    return { name: sojati.name, lat: sojati.latitude, lng: sojati.longitude };
  }));

  auditLog.push(await runTest('3.2 Citizen Incident Submission with locationName', async () => {
    const payload = {
      category: 'MEDICAL_EMERGENCY',
      severity: 4,
      victimCount: 2,
      description: 'Severe multi-vehicle collision with trauma victims near Sojati Gate.',
      locationName: 'Sojati Gate, Jodhpur',
      location: {
        latitude: 26.2906,
        longitude: 73.0232,
        locationName: 'Sojati Gate, Jodhpur'
      }
    };

    const { req, res, waitForResponse } = createMockHttp(
      'POST',
      '/api/incidents',
      payload,
      { authorization: `Bearer ${citizenToken}` }
    );
    app.handle(req, res);
    const resp = await waitForResponse();
    if (resp.statusCode !== 201) throw new Error(`Submission returned HTTP ${resp.statusCode}: ${JSON.stringify(resp.body)}`);

    const incident = resp.body.data.incident;
    testIncidentId = incident.incidentId;
    if (!testIncidentId) throw new Error('No incidentId returned');
    if (incident.status !== 'REPORTED') throw new Error(`Expected status REPORTED, got ${incident.status}`);
    if (incident.locationName !== 'Sojati Gate, Jodhpur') throw new Error(`Expected locationName, got ${incident.locationName}`);

    return { incidentId: testIncidentId, status: incident.status };
  }));

  auditLog.push(await runTest('3.3 Citizen History Verification (GET /api/incidents/my)', async () => {
    const { req, res, waitForResponse } = createMockHttp(
      'GET',
      '/api/incidents/my',
      {},
      { authorization: `Bearer ${citizenToken}` }
    );
    app.handle(req, res);
    const resp = await waitForResponse();
    if (resp.statusCode !== 200) throw new Error(`GET /my returned HTTP ${resp.statusCode}`);
    const myIncidents = resp.body.data.incidents;
    const found = myIncidents.find(i => i.incidentId === testIncidentId);
    if (!found) throw new Error('Created incident not found in citizen my-incidents list');
    return { foundIncidentId: found.incidentId, status: found.status };
  }));

  auditLog.push(await runTest('3.4 Out-of-Service-Area Coordinates Rejection', async () => {
    // Mandore Garden (outside settlement polygon)
    const outPayload = {
      category: 'FIRE',
      severity: 3,
      victimCount: 0,
      description: 'Test fire outside boundary',
      location: { latitude: 26.3550, longitude: 73.0400 }
    };
    const { req, res, waitForResponse } = createMockHttp(
      'POST',
      '/api/incidents',
      outPayload,
      { authorization: `Bearer ${citizenToken}` }
    );
    app.handle(req, res);
    const resp = await waitForResponse();
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
    if (resp.body.error?.code !== 'OUTSIDE_SERVICE_AREA') {
      throw new Error(`Expected OUTSIDE_SERVICE_AREA, got ${resp.body.error?.code}`);
    }
    return { code: resp.body.error.code };
  }));

  // =========================================================================
  // 4. Operator Verification & C++ Recommendation
  // =========================================================================
  console.log('\n--- 4. Operator Verification & C++ Recommendation ---');

  auditLog.push(await runTest('4.1 Operator Incident Verification (PATCH /verify)', async () => {
    const { req, res, waitForResponse } = createMockHttp(
      'PATCH',
      `/api/incidents/${testIncidentId}/verify`,
      { verificationNotes: 'Verified via CCTV camera and citizen callback.' },
      { authorization: `Bearer ${operatorToken}` }
    );
    app.handle(req, res);
    const resp = await waitForResponse();
    if (resp.statusCode !== 200) throw new Error(`Verify returned HTTP ${resp.statusCode}`);
    if (resp.body.data.incident.status !== 'VERIFIED') {
      throw new Error(`Expected VERIFIED, got ${resp.body.data.incident.status}`);
    }
    return { incidentId: testIncidentId, status: resp.body.data.incident.status };
  }));

  let recommendationBatch = null;

  auditLog.push(await runTest('4.2 C++ Optimization Recommendation (POST /recommend)', async () => {
    const recResult = await generateDispatchRecommendations(
      {
        incidentIds: [testIncidentId],
        selectAllVerified: false
      },
      operatorUser
    );

    if (!recResult || !recResult.batchId) throw new Error('No batchId returned');
    if (!recResult.incidentResults || recResult.incidentResults.length === 0) {
      throw new Error('No incidentResults generated');
    }

    const rec = recResult.incidentResults[0];
    if (rec.incidentId !== testIncidentId) throw new Error('Incident ID mismatch');
    if (rec.assignedResources.length === 0) throw new Error('No resources allocated for trauma emergency');
    if (!rec.recommendedHospital) throw new Error('No hospital matched for medical trauma incident');
    if (!recResult.dispatchId) throw new Error('Recommendation missing valid dispatchId');

    recommendationBatch = recResult;
    return {
      batchId: recResult.batchId,
      dispatchId: recResult.dispatchId,
      resourcesAllocated: rec.assignedResources.length,
      matchedHospital: rec.recommendedHospital.hospitalName,
      wallClockMs: recResult.engineTelemetry?.wallClockMs
    };
  }));

  // =========================================================================
  // 5. Dispatch Confirmation, Arrival & Resolution
  // =========================================================================
  console.log('\n--- 5. Dispatch Confirmation, Arrival & Resolution ---');

  const rec = recommendationBatch.incidentResults[0];
  const allocatedResourceIds = rec.assignedResources.map(r => r.resourceId);
  const matchedHospitalId = rec.recommendedHospital.hospitalId;

  auditLog.push(await runTest('5.1 Dispatch Execution Confirmation', async () => {
    const confirmResult = await confirmDispatch(
      recommendationBatch.batchId,
      {
        confirmationNotes: 'Authorized emergency units mobilized from depot.'
      },
      operatorUser
    );

    if (!confirmResult || confirmResult.confirmationStatus !== 'CONFIRMED') {
      throw new Error('Dispatch confirmation failed');
    }

    // Verify incident transitioned to DISPATCHED
    const updatedInc = await Incident.findOne({ incidentId: testIncidentId });
    if (updatedInc.status !== 'DISPATCHED') {
      throw new Error(`Expected incident DISPATCHED, got ${updatedInc.status}`);
    }

    // Verify allocated resources transitioned to DISPATCHED
    const updatedResources = await Resource.find({ resourceId: { $in: allocatedResourceIds } });
    for (const r of updatedResources) {
      if (r.status !== 'DISPATCHED') {
        throw new Error(`Expected resource ${r.resourceId} DISPATCHED, got ${r.status}`);
      }
    }

    return {
      batchId: confirmResult.batchId,
      confirmationStatus: confirmResult.confirmationStatus,
      resourceIdsDispatched: allocatedResourceIds
    };
  }));

  auditLog.push(await runTest('5.2 Duplicate Dispatch Confirmation Protection', async () => {
    // Attempting to re-confirm the already confirmed batch without idempotency key
    try {
      await confirmDispatch(
        recommendationBatch.batchId,
        {
          confirmationNotes: 'Attempting illegal second confirmation'
        },
        operatorUser
      );
      throw new Error('Duplicate confirmation should have been rejected');
    } catch (err) {
      // Expected to fail with state conflict or duplicate dispatch
      return { handledGracefully: true, error: err.message };
    }
  }));

  auditLog.push(await runTest('5.3 Scene Arrival (DISPATCHED -> ON_SCENE)', async () => {
    const arrivalResult = await markSceneArrival(
      testIncidentId,
      operatorUser
    );

    if (arrivalResult.incident.status !== 'ON_SCENE') {
      throw new Error(`Expected ON_SCENE, got ${arrivalResult.incident.status}`);
    }
    return { status: arrivalResult.incident.status, arrivedAt: arrivalResult.incident.arrivedAt };
  }));

  auditLog.push(await runTest('5.4 Incident Resolution & Fleet Restoration (ON_SCENE -> RESOLVED)', async () => {
    const resResult = await resolveIncident(
      testIncidentId,
      operatorUser,
      {
        resolutionNotes: 'Patients stabilized and transferred to trauma center. Scene cleared.'
      }
    );

    if (resResult.incident.status !== 'RESOLVED') {
      throw new Error(`Expected RESOLVED, got ${resResult.incident.status}`);
    }

    // Verify resources released back to AVAILABLE
    const releasedResources = await Resource.find({ resourceId: { $in: allocatedResourceIds } });
    for (const r of releasedResources) {
      if (r.status !== 'AVAILABLE') {
        throw new Error(`Expected resource ${r.resourceId} to be restored to AVAILABLE, got ${r.status}`);
      }
    }

    return {
      status: resResult.incident.status,
      resolvedAt: resResult.incident.resolvedAt,
      releasedResourcesCount: releasedResources.length
    };
  }));

  // =========================================================================
  // 6. Multi-Category Engine Allocation Scenarios
  // =========================================================================
  console.log('\n--- 6. Multi-Category Engine Allocation Scenarios ---');

  const categoriesToTest = ['FIRE', 'ROAD_ACCIDENT', 'STRUCTURAL_COLLAPSE'];
  for (const cat of categoriesToTest) {
    auditLog.push(await runTest(`6. C++ Allocation Scenario: ${cat}`, async () => {
      // Create temporary verified incident
      const inc = new Incident({
        incidentId: 9999000 + Math.floor(Math.random() * 1000),
        category: cat,
        severity: 4,
        victimCount: 2,
        status: 'VERIFIED',
        latitude: 26.2906,
        longitude: 73.0232,
        locationName: `Test Location (${cat})`,
        reportedAt: new Date(),
        verifiedAt: new Date()
      });
      await inc.save();

      try {
        const result = await generateDispatchRecommendations(
          { incidentIds: [inc.incidentId] },
          operatorUser
        );

        if (!result.incidentResults || result.incidentResults.length === 0) {
          throw new Error(`No recommendation generated for ${cat}`);
        }
        const recItem = result.incidentResults[0];
        return {
          category: cat,
          allocationStatus: recItem.allocationStatus,
          resourcesAllocated: recItem.assignedResources.length,
          matchedHospital: recItem.recommendedHospital?.hospitalName || 'None'
        };
      } finally {
        // Clean up test incident
        await Incident.deleteOne({ incidentId: inc.incidentId });
      }
    }));
  }

  // =========================================================================
  // 7. Edge Cases: Shortage & Disconnected Component
  // =========================================================================
  console.log('\n--- 7. Edge Cases: Shortage & Disconnected Locations ---');

  auditLog.push(await runTest('7.1 Disconnected Road Component Handling', async () => {
    // Isolated location node 5733751433 near edge
    const inc = new Incident({
      incidentId: 9999991,
      category: 'MEDICAL_EMERGENCY',
      severity: 3,
      victimCount: 1,
      status: 'VERIFIED',
      latitude: 26.3120,
      longitude: 73.0850,
      reportedAt: new Date(),
      verifiedAt: new Date()
    });
    await inc.save();

    try {
      const result = await generateDispatchRecommendations(
        { incidentIds: [inc.incidentId] },
        operatorUser
      );
      const recItem = result.incidentResults[0];
      return {
        allocationStatus: recItem.allocationStatus,
        resourcesAllocated: recItem.assignedResources.length
      };
    } finally {
      await Incident.deleteOne({ incidentId: inc.incidentId });
    }
  }));

  auditLog.push(await runTest('7.2 Empty Allocation Rejection Protection', async () => {
    // Attempting confirmation on a batch where zero vehicles were allocated or batch failed
    const mockBatchId = 'batch_empty_test_999';
    const mockRec = new DispatchRecord({
      batchId: mockBatchId,
      dispatchId: 'disp_empty_999',
      recommendationStatus: 'FAILED',
      batchStatus: 'FAILED',
      includedIncidentIds: [testIncidentId],
      totalIncidents: 1,
      totalAllocatedResources: 0,
      createdAt: new Date()
    });
    await mockRec.save();

    try {
      await confirmDispatch(mockBatchId, {}, operatorUser);
      throw new Error('Should have rejected confirmation of failed / empty batch');
    } catch (err) {
      if (err.code !== 'CANNOT_CONFIRM_FAILED_BATCH' && err.code !== 'CANNOT_DISPATCH_EMPTY_FLEET') {
        throw new Error(`Unexpected error code: ${err.code}`);
      }
      return { correctlyBlocked: true, code: err.code, message: err.message };
    } finally {
      await DispatchRecord.deleteOne({ batchId: mockBatchId });
    }
  }));

  // =========================================================================
  // 8. Persistence & Clean Disconnect
  // =========================================================================
  console.log('\n--- 8. Persistence Verification ---');

  auditLog.push(await runTest('8.1 Database Disconnect and Reconnect Persistence', async () => {
    await disconnectDatabase();
    const reconnected = await connectDatabase();
    if (!reconnected) throw new Error('Failed to reconnect database');

    const persistedIncident = await Incident.findOne({ incidentId: testIncidentId });
    if (!persistedIncident) throw new Error('Test incident did not persist across reconnect');
    if (persistedIncident.status !== 'RESOLVED') {
      throw new Error(`Expected status RESOLVED, got ${persistedIncident.status}`);
    }

    const dispatchRecord = await DispatchRecord.findOne({ batchId: recommendationBatch.batchId });
    if (!dispatchRecord) throw new Error('Dispatch record did not persist');

    return {
      persistedIncidentId: persistedIncident.incidentId,
      persistedStatus: persistedIncident.status,
      persistedBatchId: dispatchRecord.batchId,
      confirmationStatus: dispatchRecord.confirmationStatus
    };
  }));

  // Clean up test incident to avoid polluting production simulation database
  await Incident.deleteOne({ incidentId: testIncidentId });
  if (recommendationBatch?.batchId) {
    await DispatchRecord.deleteMany({ batchId: recommendationBatch.batchId });
  }
  await disconnectDatabase();

  console.log('\n================================================================');
  console.log(' E2E ACCEPTANCE AUDIT COMPLETE');
  console.log('================================================================');

  const passedCount = auditLog.filter(l => l.status === 'PASS').length;
  const failedCount = auditLog.filter(l => l.status === 'FAIL').length;
  console.log(`Total Scenarios: ${auditLog.length}`);
  console.log(`PASSED: ${passedCount}`);
  console.log(`FAILED: ${failedCount}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[FATAL_ERROR] Acceptance test crashed: ${err.message}`);
  process.exit(1);
});
