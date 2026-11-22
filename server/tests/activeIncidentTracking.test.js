process.env.NODE_ENV = 'test';
import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import Resource from '../src/models/Resource.js';
import Hospital from '../src/models/Hospital.js';
import DispatchRecord from '../src/models/DispatchRecord.js';
import { generateToken } from '../src/utils/jwt.js';
import { __setConnectionStateOverride } from '../src/config/database.js';
import activeIncidentTrackingService, {
  markSceneArrival,
  resolveIncident,
  getActiveIncidents,
  IncidentTrackingError
} from '../src/services/activeIncidentTrackingService.js';

function createMockHttp(method, url, body = {}, headers = {}) {
  const parsedUrl = new URL(url, 'http://localhost');
  const query = {};
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    query[key] = value;
  }

  const req = {
    method,
    url,
    originalUrl: url,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body,
    params: {},
    query
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

function createMockSession() {
  const session = {
    hasStarted: false,
    hasCommitted: false,
    hasAborted: false,
    hasEnded: false,
    startTransaction() {
      this.hasStarted = true;
    },
    async commitTransaction() {
      this.hasCommitted = true;
    },
    async abortTransaction() {
      this.hasAborted = true;
    },
    async endSession() {
      this.hasEnded = true;
    }
  };
  return session;
}

describe('Phase 4.6 — Active Incident Tracking, Scene Arrival & Incident Resolution', () => {
  const citizenUser = {
    _id: '507f1f77bcf86cd799439001',
    id: '507f1f77bcf86cd799439001',
    name: 'Citizen Alice',
    email: 'alice@example.com',
    role: 'CITIZEN',
    isActive: true
  };

  const operatorUser = {
    _id: '507f1f77bcf86cd799439088',
    id: '507f1f77bcf86cd799439088',
    name: 'Operator Dan',
    email: 'operator@jodhpur.emergency.gov.in',
    role: 'OPERATOR',
    isActive: true
  };

  const tokenCitizen = generateToken(citizenUser);
  const tokenOperator = generateToken(operatorUser);

  beforeEach(() => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });
  });

  afterEach(() => {
    __setConnectionStateOverride(null);
  });

  function createSampleDispatchedIncident(overrides = {}) {
    return {
      incidentId: 1001,
      category: 'MEDICAL',
      severity: 4,
      victimCount: 2,
      status: 'DISPATCHED',
      latitude: 26.2918,
      longitude: 73.0168,
      reportedBy: citizenUser._id,
      reportedAt: new Date('2026-11-18T00:10:00.000Z'),
      verifiedAt: new Date('2026-11-18T00:12:00.000Z'),
      dispatchedAt: new Date('2026-11-18T00:15:00.000Z'),
      dispatchedBatchId: 'BATCH-20261118-001',
      dispatchId: 'DISPATCH-20261118-001',
      assignedResourceIds: [501],
      assignedHospitalId: 701,
      arrivedAt: null,
      resolvedAt: null,
      auditHistory: [
        { action: 'REPORTED', performedAt: new Date('2026-11-18T00:10:00.000Z') },
        { action: 'VERIFIED', performedAt: new Date('2026-11-18T00:12:00.000Z') },
        { action: 'DISPATCHED', performedAt: new Date('2026-11-18T00:15:00.000Z') }
      ],
      ...overrides
    };
  }

  function createSampleDispatchRecord(overrides = {}) {
    return {
      batchId: 'BATCH-20261118-001',
      dispatchId: 'DISPATCH-20261118-001',
      confirmationStatus: 'CONFIRMED',
      associatedIncidentIds: [1001],
      resourceReservations: [
        {
          resourceId: 501,
          resourceType: 'ALS_AMBULANCE',
          status: 'DISPATCHED',
          assignedIncidentId: 1001,
          isReleased: false,
          releasedAt: null
        }
      ],
      hospitalReservations: [
        {
          hospitalId: 701,
          hospitalName: 'MDM Hospital Jodhpur',
          assignedIncidentId: 1001,
          reservedIcuBeds: 1,
          reservedGeneralBeds: 1,
          reservedOxygenBeds: 0,
          isReleased: false,
          releasedAt: null,
          releasedBy: null
        }
      ],
      incidentTracking: [
        {
          incidentId: 1001,
          status: 'DISPATCHED',
          arrivedAt: null,
          resolvedAt: null,
          resolutionNotes: ''
        }
      ],
      confirmationAuditTrail: [],
      save: async function () { return this; },
      ...overrides
    };
  }

  describe('1. Scene Arrival (DISPATCHED -> ON_SCENE)', () => {
    it('should successfully transition DISPATCHED incident to ON_SCENE and record arrivedAt', async () => {
      const mockSession = createMockSession();
      const inc = createSampleDispatchedIncident();
      const disp = createSampleDispatchRecord();

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async (query, update) => {
        assert.equal(query.incidentId, 1001);
        assert.equal(query.status, 'DISPATCHED');
        assert.equal(update.$set.status, 'ON_SCENE');
        assert.ok(update.$set.arrivedAt instanceof Date);
        return {
          ...inc,
          status: 'ON_SCENE',
          arrivedAt: update.$set.arrivedAt,
          auditHistory: [...inc.auditHistory, { action: 'ON_SCENE' }]
        };
      };

      DispatchRecord.findOne = () => ({
        session: () => disp
      });

      try {
        const result = await markSceneArrival(1001, operatorUser, { sessionOverride: mockSession });
        assert.equal(result.incident.status, 'ON_SCENE');
        assert.ok(result.incident.arrivedAt);
        assert.equal(mockSession.hasCommitted, true);
        assert.equal(disp.incidentTracking[0].status, 'ON_SCENE');
        assert.ok(disp.incidentTracking[0].arrivedAt);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
      }
    });

    it('should reject arrival for VERIFIED incident with 409 INCIDENT_STATE_CONFLICT', async () => {
      const inc = createSampleDispatchedIncident({ status: 'VERIFIED' });
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => inc;

      try {
        await assert.rejects(
          async () => {
            await markSceneArrival(1001, operatorUser);
          },
          (err) => err.code === 'INCIDENT_STATE_CONFLICT' && err.statusCode === 409
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('should reject duplicate arrival if incident is already ON_SCENE with 409', async () => {
      const inc = createSampleDispatchedIncident({ status: 'ON_SCENE', arrivedAt: new Date() });
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => inc;

      try {
        await assert.rejects(
          async () => {
            await markSceneArrival(1001, operatorUser);
          },
          (err) => err.code === 'INCIDENT_STATE_CONFLICT' && err.statusCode === 409
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('should reject arrival for non-existent incident with 404 INCIDENT_NOT_FOUND', async () => {
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => null;

      try {
        await assert.rejects(
          async () => {
            await markSceneArrival(9999, operatorUser);
          },
          (err) => err.code === 'INCIDENT_NOT_FOUND' && err.statusCode === 404
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('should reject arrival if incident has not been confirmed in any dispatch', async () => {
      const inc = createSampleDispatchedIncident({ dispatchId: null, dispatchedBatchId: null });
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => inc;

      try {
        await assert.rejects(
          async () => {
            await markSceneArrival(1001, operatorUser);
          },
          (err) => err.code === 'DISPATCH_NOT_CONFIRMED' && err.statusCode === 409
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('should isolate arrival updates so arrival of incident A does not alter incident B in multi-incident batch', async () => {
      const mockSession = createMockSession();
      const incA = createSampleDispatchedIncident({ incidentId: 1001 });
      const disp = createSampleDispatchRecord({
        associatedIncidentIds: [1001, 1002],
        incidentTracking: [
          { incidentId: 1001, status: 'DISPATCHED', arrivedAt: null },
          { incidentId: 1002, status: 'DISPATCHED', arrivedAt: null }
        ]
      });

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;

      Incident.findOne = async (q) => (q.incidentId === 1001 ? incA : null);
      Incident.findOneAndUpdate = async (q, u) => ({
        ...incA,
        status: 'ON_SCENE',
        arrivedAt: u.$set.arrivedAt
      });
      DispatchRecord.findOne = () => ({ session: () => disp });

      try {
        await markSceneArrival(1001, operatorUser, { sessionOverride: mockSession });
        assert.equal(disp.incidentTracking.find((t) => t.incidentId === 1001).status, 'ON_SCENE');
        // Incident 1002 must remain untouched in DISPATCHED status
        assert.equal(disp.incidentTracking.find((t) => t.incidentId === 1002).status, 'DISPATCHED');
        assert.equal(disp.incidentTracking.find((t) => t.incidentId === 1002).arrivedAt, null);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
      }
    });
  });

  describe('2. Incident Resolution (ON_SCENE -> RESOLVED)', () => {
    it('should successfully resolve ON_SCENE incident and record resolvedAt and resolution notes', async () => {
      const mockSession = createMockSession();
      const inc = createSampleDispatchedIncident({ status: 'ON_SCENE', arrivedAt: new Date() });
      const disp = createSampleDispatchRecord();
      const hosp = {
        hospitalId: 701,
        icuBeds: { total: 10, available: 4 },
        generalBeds: { total: 50, available: 20 },
        oxygenBeds: { total: 20, available: 10 }
      };

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOne = Hospital.findOne;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;
      const origIncCount = Incident.countDocuments;

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async (q, u) => ({
        ...inc,
        status: 'RESOLVED',
        resolvedAt: u.$set.resolvedAt,
        resolutionNotes: u.$set.resolutionNotes
      });
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, status: 'AVAILABLE' });
      Hospital.findOne = () => ({ session: () => hosp });
      Hospital.findOneAndUpdate = async () => hosp;
      DispatchRecord.findOne = () => ({ session: () => disp });
      Incident.countDocuments = () => ({ session: async () => 0 });

      try {
        const result = await resolveIncident(1001, operatorUser, {
          resolutionNotes: 'Patient stabilized and transported',
          sessionOverride: mockSession
        });

        assert.equal(result.incident.status, 'RESOLVED');
        assert.equal(result.incident.resolutionNotes, 'Patient stabilized and transported');
        assert.ok(result.incident.resolvedAt);
        assert.equal(mockSession.hasCommitted, true);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOne = origHospFindOne;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
        Incident.countDocuments = origIncCount;
      }
    });

    it('should reject resolution if incident is DISPATCHED but not yet ON_SCENE (direct transition prohibited)', async () => {
      const inc = createSampleDispatchedIncident({ status: 'DISPATCHED' });
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => inc;

      try {
        await assert.rejects(
          async () => {
            await resolveIncident(1001, operatorUser);
          },
          (err) => err.code === 'INCIDENT_STATE_CONFLICT' && err.statusCode === 409
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('should reject resolution if incident is VERIFIED (direct transition prohibited)', async () => {
      const inc = createSampleDispatchedIncident({ status: 'VERIFIED' });
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => inc;

      try {
        await assert.rejects(
          async () => {
            await resolveIncident(1001, operatorUser);
          },
          (err) => err.code === 'INCIDENT_STATE_CONFLICT' && err.statusCode === 409
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('should reject resolution if incident is already RESOLVED with 409 INCIDENT_ALREADY_RESOLVED', async () => {
      const inc = createSampleDispatchedIncident({ status: 'RESOLVED', resolvedAt: new Date() });
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => inc;

      try {
        await assert.rejects(
          async () => {
            await resolveIncident(1001, operatorUser);
          },
          (err) => err.code === 'INCIDENT_ALREADY_RESOLVED' && err.statusCode === 409
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('should safely release assigned resources back to AVAILABLE and clear assignments', async () => {
      const mockSession = createMockSession();
      const inc = createSampleDispatchedIncident({
        status: 'ON_SCENE',
        arrivedAt: new Date(),
        assignedResourceIds: [501, 502]
      });
      const disp = createSampleDispatchRecord({
        hospitalReservations: [],
        resourceReservations: [
          { resourceId: 501, assignedIncidentId: 1001, isReleased: false },
          { resourceId: 502, assignedIncidentId: 1001, isReleased: false }
        ]
      });

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;
      const origIncCount = Incident.countDocuments;

      const releasedResourcesCaptured = [];

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async () => ({ ...inc, status: 'RESOLVED' });
      Resource.findOneAndUpdate = async (query, update) => {
        releasedResourcesCaptured.push({ query, update });
        return {
          resourceId: query.resourceId,
          resourceType: 'ALS_AMBULANCE',
          status: 'AVAILABLE'
        };
      };
      DispatchRecord.findOne = () => ({ session: () => disp });
      Incident.countDocuments = () => ({ session: async () => 0 });

      try {
        const result = await resolveIncident(1001, operatorUser, { sessionOverride: mockSession });
        assert.equal(releasedResourcesCaptured.length, 2);

        // Verify conditional query invariants for each release
        for (const call of releasedResourcesCaptured) {
          assert.equal(call.query.assignedIncidentId, 1001);
          assert.equal(call.query.status, 'DISPATCHED');
          assert.equal(call.update.$set.status, 'AVAILABLE');
          assert.equal(call.update.$set.assignedIncidentId, null);
          assert.equal(call.update.$set.reservedAt, null);
          assert.equal(call.update.$set.dispatchedAt, null);
        }

        assert.equal(result.releasedResources.length, 2);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
        Incident.countDocuments = origIncCount;
      }
    });

    it('should never release resources assigned to another active incident', async () => {
      const mockSession = createMockSession();
      const inc = createSampleDispatchedIncident({
        status: 'ON_SCENE',
        assignedResourceIds: [501] // Wants to release 501
      });
      const disp = createSampleDispatchRecord({ hospitalReservations: [] });

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;
      const origIncCount = Incident.countDocuments;

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async () => ({ ...inc, status: 'RESOLVED' });

      // Resource 501 is assigned to incident 9999, NOT 1001!
      // Therefore, query { resourceId: 501, assignedIncidentId: 1001 } matches 0 records
      Resource.findOneAndUpdate = async (query) => {
        if (query.assignedIncidentId !== 1001) {
          throw new Error('Isolation breach: queried wrong incident ID');
        }
        return null; // Document not matched because assignedIncidentId is 9999
      };

      DispatchRecord.findOne = () => ({ session: () => disp });
      Incident.countDocuments = () => ({ session: async () => 0 });

      try {
        const result = await resolveIncident(1001, operatorUser, { sessionOverride: mockSession });
        assert.equal(result.releasedResources.length, 0); // Correctly protected
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
        Incident.countDocuments = origIncCount;
      }
    });

    it('should restore hospital bed capacity accurately and enforce upper bound at total beds', async () => {
      const mockSession = createMockSession();
      const inc = createSampleDispatchedIncident({ status: 'ON_SCENE' });
      const disp = createSampleDispatchRecord({
        hospitalReservations: [
          {
            hospitalId: 701,
            hospitalName: 'MDM Hospital Jodhpur',
            assignedIncidentId: 1001,
            reservedIcuBeds: 2,
            reservedGeneralBeds: 5,
            reservedOxygenBeds: 0,
            isReleased: false
          }
        ]
      });

      const hosp = {
        hospitalId: 701,
        name: 'MDM Hospital Jodhpur',
        icuBeds: { total: 10, available: 7 }, // Can restore at most 3
        generalBeds: { total: 50, available: 40 }, // Can restore 5
        oxygenBeds: { total: 20, available: 20 }
      };

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOne = Hospital.findOne;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;
      const origIncCount = Incident.countDocuments;

      let hospitalUpdateCaptured = null;

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async () => ({ ...inc, status: 'RESOLVED' });
      Resource.findOneAndUpdate = async () => null;
      Hospital.findOne = () => ({ session: () => hosp });
      Hospital.findOneAndUpdate = async (q, u) => {
        hospitalUpdateCaptured = { q, u };
        return hosp;
      };
      DispatchRecord.findOne = () => ({ session: () => disp });
      Incident.countDocuments = () => ({ session: async () => 0 });

      try {
        await resolveIncident(1001, operatorUser, { sessionOverride: mockSession });

        assert.ok(hospitalUpdateCaptured);
        assert.equal(hospitalUpdateCaptured.q.hospitalId, 701);
        // ICU had 2 reserved, capacity cap maxRestore was (10 - 7) = 3, so restored 2
        assert.equal(hospitalUpdateCaptured.u.$inc['icuBeds.available'], 2);
        // General had 5 reserved, maxRestore was (50 - 40) = 10, so restored 5
        assert.equal(hospitalUpdateCaptured.u.$inc['generalBeds.available'], 5);
        // Marker set
        assert.equal(disp.hospitalReservations[0].isReleased, true);
        assert.ok(disp.hospitalReservations[0].releasedAt instanceof Date);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOne = origHospFindOne;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
        Incident.countDocuments = origIncCount;
      }
    });

    it('should safely handle zero-bed incidents without modifying hospital availability', async () => {
      const mockSession = createMockSession();
      const inc = createSampleDispatchedIncident({ status: 'ON_SCENE' });
      const disp = createSampleDispatchRecord({
        hospitalReservations: [
          {
            hospitalId: 701,
            assignedIncidentId: 1001,
            reservedIcuBeds: 0,
            reservedGeneralBeds: 0,
            reservedOxygenBeds: 0,
            isReleased: false
          }
        ]
      });

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;
      const origIncCount = Incident.countDocuments;

      let hospitalUpdateCalled = false;

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async () => ({ ...inc, status: 'RESOLVED' });
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, status: 'AVAILABLE' });
      Hospital.findOneAndUpdate = async () => {
        hospitalUpdateCalled = true;
      };
      DispatchRecord.findOne = () => ({ session: () => disp });
      Incident.countDocuments = () => ({ session: async () => 0 });

      try {
        await resolveIncident(1001, operatorUser, { sessionOverride: mockSession });
        assert.equal(hospitalUpdateCalled, false); // Must NOT decrement or increment
        assert.equal(disp.hospitalReservations[0].isReleased, true);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
        Incident.countDocuments = origIncCount;
      }
    });

    it('should prevent duplicate hospital capacity restoration via idempotent release marker', async () => {
      const mockSession = createMockSession();
      const inc = createSampleDispatchedIncident({ status: 'ON_SCENE' });
      const disp = createSampleDispatchRecord({
        hospitalReservations: [
          {
            hospitalId: 701,
            assignedIncidentId: 1001,
            reservedIcuBeds: 2,
            isReleased: true, // Already released!
            releasedAt: new Date()
          }
        ]
      });

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOne = Hospital.findOne;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;
      const origIncCount = Incident.countDocuments;

      let hospitalUpdateCalled = false;

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async () => ({ ...inc, status: 'RESOLVED' });
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, status: 'AVAILABLE' });
      Hospital.findOneAndUpdate = async () => { hospitalUpdateCalled = true; };
      DispatchRecord.findOne = () => ({ session: () => disp });
      Incident.countDocuments = () => ({ session: async () => 0 });

      try {
        await resolveIncident(1001, operatorUser, { sessionOverride: mockSession });
        // Because isReleased was true, hospital availability is not restored a second time
        assert.equal(hospitalUpdateCalled, false);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
        Incident.countDocuments = origIncCount;
      }
    });

    it('should handle multi-incident batch partial completion (PARTIALLY_RESOLVED vs COMPLETED)', async () => {
      const mockSession = createMockSession();
      const incA = createSampleDispatchedIncident({ incidentId: 1001, status: 'ON_SCENE' });
      const disp = createSampleDispatchRecord({
        associatedIncidentIds: [1001, 1002],
        hospitalReservations: []
      });

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;
      const origIncCount = Incident.countDocuments;

      Incident.findOne = async () => incA;
      Incident.findOneAndUpdate = async () => ({ ...incA, status: 'RESOLVED' });
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, status: 'AVAILABLE' });
      DispatchRecord.findOne = () => ({ session: () => disp });

      try {
        // Step 1: Incident 1002 is still NOT resolved
        Incident.countDocuments = () => ({ session: async () => 1 }); // 1 remaining unresolved
        const result1 = await resolveIncident(1001, operatorUser, { sessionOverride: mockSession });
        assert.equal(result1.dispatchSummary.confirmationStatus, 'PARTIALLY_RESOLVED');

        // Step 2: All incidents are now resolved
        Incident.countDocuments = () => ({ session: async () => 0 }); // 0 remaining unresolved
        const result2 = await resolveIncident(1001, operatorUser, { sessionOverride: mockSession });
        assert.equal(result2.dispatchSummary.confirmationStatus, 'COMPLETED');
        assert.ok(result2.dispatchSummary.completedAt);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
        Incident.countDocuments = origIncCount;
      }
    });
  });

  describe('3. Transaction Atomicity & Rollback Guarantees', () => {
    it('should rollback incident write if resource release throws an unexpected error', async () => {
      const mockSession = createMockSession();
      const inc = createSampleDispatchedIncident({ status: 'ON_SCENE' });

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async () => ({ ...inc, status: 'RESOLVED' });
      Resource.findOneAndUpdate = async () => {
        throw new Error('Database disk error during resource release');
      };

      try {
        await assert.rejects(
          async () => {
            await resolveIncident(1001, operatorUser, { sessionOverride: mockSession });
          },
          (err) => err.message.includes('Database disk error')
        );

        assert.equal(mockSession.hasAborted, true);
        assert.equal(mockSession.hasCommitted, false);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
      }
    });

    it('should rollback all writes if hospital capacity release throws an unexpected error', async () => {
      const mockSession = createMockSession();
      const inc = createSampleDispatchedIncident({ status: 'ON_SCENE' });
      const disp = createSampleDispatchRecord({
        hospitalReservations: [{ hospitalId: 701, assignedIncidentId: 1001, reservedIcuBeds: 1 }]
      });

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOne = Hospital.findOne;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async () => ({ ...inc, status: 'RESOLVED' });
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, status: 'AVAILABLE' });
      Hospital.findOne = () => ({ session: () => ({ hospitalId: 701, icuBeds: { total: 10, available: 5 } }) });
      Hospital.findOneAndUpdate = async () => {
        throw new Error('Write conflict on hospital collection');
      };
      DispatchRecord.findOne = () => ({ session: () => disp });

      try {
        await assert.rejects(
          async () => {
            await resolveIncident(1001, operatorUser, { sessionOverride: mockSession });
          },
          (err) => err.message.includes('Write conflict on hospital collection')
        );

        assert.equal(mockSession.hasAborted, true);
        assert.equal(mockSession.hasCommitted, false);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOne = origHospFindOne;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
      }
    });
  });

  describe('4. Active Incident Tracking API (GET /api/incidents/active)', () => {
    it('GET /api/incidents/active should return 200 with list of DISPATCHED and ON_SCENE incidents for OPERATOR', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origCount = Incident.countDocuments;
      const origFind = Incident.find;

      User.findById = async () => operatorUser;
      Incident.countDocuments = async () => 2;
      Incident.find = () => ({
        populate: function () { return this; },
        sort: function () { return this; },
        skip: function () { return this; },
        limit: function () { return this; },
        lean: async () => [
          createSampleDispatchedIncident({ incidentId: 1001, status: 'DISPATCHED' }),
          createSampleDispatchedIncident({ incidentId: 1002, status: 'ON_SCENE', arrivedAt: new Date() })
        ]
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/active?page=1&limit=10',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.incidents.length, 2);
        assert.equal(result.body.data.pagination.totalCount, 2);
      } finally {
        User.findById = origUserFind;
        Incident.countDocuments = origCount;
        Incident.find = origFind;
        __setConnectionStateOverride(null);
      }
    });

    it('GET /api/incidents/active should filter by status and category', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origCount = Incident.countDocuments;
      const origFind = Incident.find;

      User.findById = async () => operatorUser;
      Incident.countDocuments = async (filter) => {
        assert.equal(filter.status, 'ON_SCENE');
        assert.equal(filter.category, 'FIRE');
        return 1;
      };
      Incident.find = () => ({
        populate: function () { return this; },
        sort: function () { return this; },
        skip: function () { return this; },
        limit: function () { return this; },
        lean: async () => [
          createSampleDispatchedIncident({ incidentId: 1003, category: 'FIRE', status: 'ON_SCENE' })
        ]
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/active?status=ON_SCENE&category=FIRE',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.data.incidents[0].category, 'FIRE');
      } finally {
        User.findById = origUserFind;
        Incident.countDocuments = origCount;
        Incident.find = origFind;
        __setConnectionStateOverride(null);
      }
    });

    it('GET /api/incidents/active should reject CITIZEN with 403 Forbidden', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      User.findById = async () => citizenUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/active',
          {},
          { authorization: `Bearer ${tokenCitizen}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origUserFind;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('5. Citizen Visibility & Field Sanitization', () => {
    it('GET /api/incidents/:incidentId should show safe status progression and timestamps to owner citizen without operator IDs', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origIncFindOne = Incident.findOne;

      User.findById = async () => citizenUser;
      Incident.findOne = () => ({
        populate: function () { return this; },
        incidentId: 1001,
        category: 'MEDICAL',
        severity: 4,
        victimCount: 1,
        status: 'ON_SCENE',
        latitude: 26.2918,
        longitude: 73.0168,
        reportedBy: citizenUser._id,
        reportedAt: new Date('2026-11-18T00:10:00.000Z'),
        verifiedAt: new Date('2026-11-18T00:12:00.000Z'),
        dispatchedAt: new Date('2026-11-18T00:15:00.000Z'),
        arrivedAt: new Date('2026-11-18T00:25:00.000Z'),
        resolvedAt: null,
        dispatchedBy: operatorUser._id,
        arrivedBy: operatorUser._id
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/1001',
          {},
          { authorization: `Bearer ${tokenCitizen}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        const incData = result.body.data.incident;
        assert.equal(incData.status, 'ON_SCENE');
        assert.ok(incData.dispatchedAt);
        assert.ok(incData.arrivedAt);
        assert.ok(incData.statusHistory);
        assert.equal(incData.statusHistory.length, 4);

        // Verify citizen is NOT exposed to internal operator ID fields
        assert.equal(incData.dispatchedBy, undefined);
        assert.equal(incData.arrivedBy, undefined);
        assert.equal(incData.auditHistory, undefined);
      } finally {
        User.findById = origUserFind;
        Incident.findOne = origIncFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('GET /api/incidents/my should include dispatchedAt, arrivedAt, and resolvedAt for citizen reports', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origCount = Incident.countDocuments;
      const origFind = Incident.find;

      User.findById = async () => citizenUser;
      Incident.countDocuments = async () => 1;
      Incident.find = () => ({
        sort: function () { return this; },
        skip: function () { return this; },
        limit: function () { return this; },
        lean: async () => [
          {
            incidentId: 1001,
            category: 'MEDICAL',
            severity: 4,
            victimCount: 1,
            status: 'RESOLVED',
            latitude: 26.2918,
            longitude: 73.0168,
            reportedAt: new Date('2026-11-18T00:10:00.000Z'),
            dispatchedAt: new Date('2026-11-18T00:15:00.000Z'),
            arrivedAt: new Date('2026-11-18T00:25:00.000Z'),
            resolvedAt: new Date('2026-11-18T00:45:00.000Z')
          }
        ]
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/my',
          {},
          { authorization: `Bearer ${tokenCitizen}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        const inc = result.body.data.incidents[0];
        assert.equal(inc.status, 'RESOLVED');
        assert.ok(inc.dispatchedAt);
        assert.ok(inc.arrivedAt);
        assert.ok(inc.resolvedAt);
      } finally {
        User.findById = origUserFind;
        Incident.countDocuments = origCount;
        Incident.find = origFind;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('6. Route-Level Role Authorization Tests (App Dispatch)', () => {
    it('PATCH /api/incidents/:incidentId/arrive should reject CITIZEN with 403 Forbidden', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      User.findById = async () => citizenUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1001/arrive',
          {},
          { authorization: `Bearer ${tokenCitizen}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origUserFind;
        __setConnectionStateOverride(null);
      }
    });

    it('PATCH /api/incidents/:incidentId/resolve should reject CITIZEN with 403 Forbidden', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      User.findById = async () => citizenUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1001/resolve',
          { resolutionNotes: 'Trying to resolve own incident' },
          { authorization: `Bearer ${tokenCitizen}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origUserFind;
        __setConnectionStateOverride(null);
      }
    });
  });
});
