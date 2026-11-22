process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import Resource from '../src/models/Resource.js';
import Hospital from '../src/models/Hospital.js';
import DispatchRecord from '../src/models/DispatchRecord.js';
import { generateToken } from '../src/utils/jwt.js';
import { __setConnectionStateOverride } from '../src/config/database.js';
import dispatchExecutionService, {
  confirmDispatch,
  getDispatchById,
  listDispatches,
  DispatchConfirmationError
} from '../src/services/dispatchExecutionService.js';

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

/**
 * Creates a mock Mongoose session to simulate and test transactional atomicity and rollback.
 */
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

describe('Phase 4.5 — Atomic Resource Reservation & Dispatch Confirmation', () => {
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

  // Reusable sample recommendation record
  function createSampleRecommendation(overrides = {}) {
    return {
      batchId: 'BATCH-20261118-001',
      requestId: 'REQ-123',
      recommendationStatus: 'RECOMMENDED',
      confirmationStatus: 'PENDING',
      batchStatus: 'SUCCESS',
      totalIncidents: 1,
      includedIncidentIds: [1001],
      incidentResults: [
        {
          incidentId: 1001,
          allocationStatus: 'SUCCESS',
          assignedResources: [
            {
              resourceId: 501,
              resourceType: 'FIRE_ENGINE'
            }
          ],
          resourceShortages: [],
          recommendedHospital: {
            hospitalId: 701,
            hospitalName: 'MDM Hospital Jodhpur',
            allocatedIcuBeds: 1,
            allocatedGeneralBeds: 1,
            allocatedOxygenBeds: 0
          }
        }
      ],
      confirmationAuditTrail: [],
      save: async function () { return this; },
      ...overrides
    };
  }

  describe('1. Confirmation Pre-condition Validation', () => {
    it('should reject missing recommendation batch with 404 BATCH_NOT_FOUND', async () => {
      const origFindOne = DispatchRecord.findOne;
      DispatchRecord.findOne = async () => null;

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-NON-EXISTENT', {}, operatorUser);
          },
          (err) => err.code === 'BATCH_NOT_FOUND' && err.statusCode === 404
        );
      } finally {
        DispatchRecord.findOne = origFindOne;
      }
    });

    it('should reject confirmation of an already CONFIRMED batch with 409 BATCH_ALREADY_CONFIRMED', async () => {
      const origFindOne = DispatchRecord.findOne;
      DispatchRecord.findOne = async () => createSampleRecommendation({
        confirmationStatus: 'CONFIRMED',
        dispatchId: 'DISPATCH-PREV-01',
        confirmedAt: new Date()
      });

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', {}, operatorUser);
          },
          (err) => err.code === 'BATCH_ALREADY_CONFIRMED' && err.statusCode === 409
        );
      } finally {
        DispatchRecord.findOne = origFindOne;
      }
    });

    it('should reject confirmation of a FAILED recommendation batch with 409 CANNOT_CONFIRM_FAILED_BATCH', async () => {
      const origFindOne = DispatchRecord.findOne;
      DispatchRecord.findOne = async () => createSampleRecommendation({
        recommendationStatus: 'FAILED',
        batchStatusMessage: 'Engine execution aborted'
      });

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', {}, operatorUser);
          },
          (err) => err.code === 'CANNOT_CONFIRM_FAILED_BATCH' && err.statusCode === 409
        );
      } finally {
        DispatchRecord.findOne = origFindOne;
      }
    });

    it('should reject confirmation if an incident is not in VERIFIED status with 409 INCIDENT_STATE_CONFLICT', async () => {
      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;

      DispatchRecord.findOne = async () => createSampleRecommendation();
      Incident.find = async () => [
        { incidentId: 1001, status: 'REPORTED' } // Not VERIFIED!
      ];

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', {}, operatorUser);
          },
          (err) => err.code === 'INCIDENT_STATE_CONFLICT' && err.statusCode === 409
        );
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
      }
    });

    it('should reject confirmation with unmet shortages when allowPartialDispatch is false', async () => {
      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;

      DispatchRecord.findOne = async () => createSampleRecommendation({
        incidentResults: [
          {
            incidentId: 1001,
            allocationStatus: 'PARTIAL',
            assignedResources: [{ resourceId: 501, resourceType: 'FIRE_ENGINE' }],
            resourceShortages: [{ resourceType: 'ALS_AMBULANCE', shortageQuantity: 1 }]
          }
        ]
      });
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', { allowPartialDispatch: false }, operatorUser);
          },
          (err) => err.code === 'INCOMPLETE_ALLOCATION_SHORTAGE' && err.statusCode === 409
        );
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
      }
    });
  });

  describe('2. Resource Reservation & Status Invariants', () => {
    it('should successfully reserve an AVAILABLE resource and transition it to DISPATCHED', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;

      const capturedResourceUpdates = [];

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];

      Resource.findOneAndUpdate = async (query, update) => {
        capturedResourceUpdates.push({ query, update });
        return {
          resourceId: 501,
          resourceType: 'FIRE_ENGINE',
          status: update.$set.status || 'DISPATCHED'
        };
      };

      Hospital.findOneAndUpdate = async () => ({
        hospitalId: 701,
        name: 'MDM Hospital Jodhpur',
        status: 'OPERATIONAL'
      });

      Incident.findOneAndUpdate = async () => ({
        incidentId: 1001,
        status: 'DISPATCHED'
      });

      try {
        const result = await confirmDispatch(
          'BATCH-20261118-001',
          { sessionOverride: mockSession },
          operatorUser
        );

        assert.equal(result.confirmationStatus, 'CONFIRMED');
        assert.ok(result.dispatchId);
        // Verify explicit 2-stage lifecycle: AVAILABLE -> RESERVED -> DISPATCHED
        assert.equal(capturedResourceUpdates.length, 2);
        // Stage 1: AVAILABLE -> RESERVED
        assert.equal(capturedResourceUpdates[0].query.resourceId, 501);
        assert.equal(capturedResourceUpdates[0].query.status, 'AVAILABLE');
        assert.equal(capturedResourceUpdates[0].update.$set.status, 'RESERVED');
        assert.equal(capturedResourceUpdates[0].update.$set.assignedIncidentId, 1001);
        assert.ok(capturedResourceUpdates[0].update.$set.reservedAt instanceof Date);
        // Stage 2: RESERVED -> DISPATCHED
        assert.equal(capturedResourceUpdates[1].query.resourceId, 501);
        assert.equal(capturedResourceUpdates[1].query.status, 'RESERVED');
        assert.equal(capturedResourceUpdates[1].update.$set.status, 'DISPATCHED');
        assert.ok(capturedResourceUpdates[1].update.$set.dispatchedAt instanceof Date);
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
      }
    });

    it('should reject reservation and abort transaction if resource is already RESERVED or DISPATCHED', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origResFindOne = Resource.findOne;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];

      Resource.findOneAndUpdate = async () => null; // Atomic conditional update matched 0 documents!
      Resource.findOne = () => ({
        session: () => ({
          resourceId: 501,
          resourceType: 'FIRE_ENGINE',
          status: 'DISPATCHED', // Already committed!
          assignedIncidentId: 999
        })
      });

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch(
              'BATCH-20261118-001',
              { sessionOverride: mockSession },
              operatorUser
            );
          },
          (err) => err.code === 'RESOURCE_ALREADY_COMMITTED' && err.statusCode === 409
        );
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Resource.findOne = origResFindOne;
      }
    });
  });

  describe('3. Hospital Capacity Reservation Invariants', () => {
    it('should decrement hospital available beds atomically and enforce non-negative capacity', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;

      let capturedHospQuery = null;
      let capturedHospUpdate = null;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, resourceType: 'FIRE_ENGINE' });

      Hospital.findOneAndUpdate = async (query, update) => {
        capturedHospQuery = query;
        capturedHospUpdate = update;
        return {
          hospitalId: 701,
          name: 'MDM Hospital Jodhpur',
          status: 'OPERATIONAL'
        };
      };

      Incident.findOneAndUpdate = async () => ({ incidentId: 1001, status: 'DISPATCHED' });

      try {
        await confirmDispatch(
          'BATCH-20261118-001',
          { sessionOverride: mockSession },
          operatorUser
        );

        assert.equal(capturedHospQuery.hospitalId, 701);
        assert.equal(capturedHospQuery.status, 'OPERATIONAL');
        assert.deepEqual(capturedHospQuery['icuBeds.available'], { $gte: 1 });
        assert.deepEqual(capturedHospQuery['generalBeds.available'], { $gte: 1 });
        assert.equal(capturedHospUpdate.$inc['icuBeds.available'], -1);
        assert.equal(capturedHospUpdate.$inc['generalBeds.available'], -1);
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
      }
    });

    it('should reject reservation with 409 HOSPITAL_CAPACITY_INSUFFICIENT if hospital lacks requested beds', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origHospFindOne = Hospital.findOne;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, resourceType: 'FIRE_ENGINE' });

      Hospital.findOneAndUpdate = async () => null; // Capacity check failed!
      Hospital.findOne = () => ({
        session: () => ({
          hospitalId: 701,
          name: 'MDM Hospital Jodhpur',
          status: 'OPERATIONAL',
          icuBeds: { total: 10, available: 0 } // 0 ICU beds left!
        })
      });

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch(
              'BATCH-20261118-001',
              { sessionOverride: mockSession },
              operatorUser
            );
          },
          (err) => err.code === 'HOSPITAL_CAPACITY_INSUFFICIENT' && err.statusCode === 409
        );
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        Hospital.findOne = origHospFindOne;
      }
    });
  });

  describe('4. Transactional Atomicity & Rollback Guarantees', () => {
    it('should invoke abortTransaction() when any step in the transaction throws', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];

      // Simulate unexpected database crash or validation failure
      Resource.findOneAndUpdate = async () => {
        throw new Error('Database connection reset during resource update');
      };

      try {
        await assert.rejects(async () => {
          await dispatchExecutionService.withTransaction(async (session) => {
            await Resource.findOneAndUpdate({}, {});
          }, { sessionOverride: mockSession });
        });
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
      }
    });

    it('should abort transaction and rollback all writes if hospital capacity check fails after resource reservation', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origHospFindOne = Hospital.findOne;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];

      let resourceWasReserved = false;
      Resource.findOneAndUpdate = async () => {
        resourceWasReserved = true;
        return { resourceId: 501, status: 'RESERVED' };
      };

      // Hospital capacity exhausted mid-transaction
      Hospital.findOneAndUpdate = async () => null;
      Hospital.findOne = () => ({
        session: () => ({
          hospitalId: 701,
          name: 'MDM Hospital Jodhpur',
          status: 'OPERATIONAL',
          icuBeds: { total: 5, available: 0 }
        })
      });

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', { sessionOverride: mockSession }, operatorUser);
          },
          (err) => err.code === 'HOSPITAL_CAPACITY_INSUFFICIENT' && err.statusCode === 409
        );

        assert.equal(resourceWasReserved, true);
        assert.equal(mockSession.hasAborted, true);
        assert.equal(mockSession.hasCommitted, false);
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        Hospital.findOne = origHospFindOne;
      }
    });

    it('should abort transaction and rollback all writes if incident update fails after resource and hospital reservations', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];

      let resourceReserved = false;
      let hospitalReserved = false;

      Resource.findOneAndUpdate = async () => {
        resourceReserved = true;
        return { resourceId: 501, status: 'DISPATCHED' };
      };

      Hospital.findOneAndUpdate = async () => {
        hospitalReserved = true;
        return { hospitalId: 701, name: 'MDM Hospital Jodhpur', status: 'OPERATIONAL' };
      };

      // Incident state conflict mid-transaction (e.g. concurrent cancellation or verification change)
      Incident.findOneAndUpdate = async () => null;

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', { sessionOverride: mockSession }, operatorUser);
          },
          (err) => err.code === 'INCIDENT_STATE_CONFLICT' && err.statusCode === 409
        );

        assert.equal(resourceReserved, true);
        assert.equal(hospitalReserved, true);
        assert.equal(mockSession.hasAborted, true);
        assert.equal(mockSession.hasCommitted, false);
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
      }
    });

    it('should abort transaction and rollback all writes if dispatch record save throws mid-transaction', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation({
        save: async () => {
          throw new Error('Database write collision on dispatch record persistence');
        }
      });

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, status: 'DISPATCHED' });
      Hospital.findOneAndUpdate = async () => ({ hospitalId: 701, status: 'OPERATIONAL' });
      Incident.findOneAndUpdate = async () => ({ incidentId: 1001, status: 'DISPATCHED' });

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', { sessionOverride: mockSession }, operatorUser);
          },
          (err) => err.message.includes('Database write collision')
        );

        assert.equal(mockSession.hasAborted, true);
        assert.equal(mockSession.hasCommitted, false);
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
      }
    });

    it('should prevent concurrent operators from confirming the same batch twice', async () => {
      const mockSession1 = createMockSession();
      const mockSession2 = createMockSession();

      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, status: 'DISPATCHED' });
      Hospital.findOneAndUpdate = async () => ({ hospitalId: 701, status: 'OPERATIONAL' });
      Incident.findOneAndUpdate = async () => ({ incidentId: 1001, status: 'DISPATCHED' });

      try {
        // Operator 1 confirms
        const result1 = await confirmDispatch('BATCH-20261118-001', { sessionOverride: mockSession1 }, operatorUser);
        assert.equal(result1.confirmationStatus, 'CONFIRMED');

        // Operator 2 attempts to confirm same batch without same idempotency key
        await assert.rejects(
          async () => {
            await confirmDispatch(
              'BATCH-20261118-001',
              { sessionOverride: mockSession2, idempotencyKey: 'different-op-key' },
              { _id: '507f1f77bcf86cd799439099', name: 'Operator Eve', role: 'OPERATOR' }
            );
          },
          (err) => err.code === 'BATCH_ALREADY_CONFIRMED' && err.statusCode === 409
        );
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
      }
    });

    it('should reject second batch when competing batches contest the same resource', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origResFindOne = Resource.findOne;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];

      // Resource conditional update fails because competing batch already claimed it
      Resource.findOneAndUpdate = async () => null;
      Resource.findOne = () => ({
        session: () => ({
          resourceId: 501,
          resourceType: 'FIRE_ENGINE',
          status: 'DISPATCHED',
          assignedIncidentId: 9999
        })
      });

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', { sessionOverride: mockSession }, operatorUser);
          },
          (err) => err.code === 'RESOURCE_ALREADY_COMMITTED' && err.statusCode === 409
        );

        assert.equal(mockSession.hasAborted, true);
        assert.equal(mockSession.hasCommitted, false);
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Resource.findOne = origResFindOne;
      }
    });

    it('should reject second batch when competing batches contest limited hospital bed capacity', async () => {
      const mockSession = createMockSession();
      const rec = createSampleRecommendation();

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origHospFindOne = Hospital.findOne;

      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) return null;
        return rec;
      };
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, status: 'DISPATCHED' });

      // Hospital capacity exhausted by earlier batch
      Hospital.findOneAndUpdate = async () => null;
      Hospital.findOne = () => ({
        session: () => ({
          hospitalId: 701,
          name: 'MDM Hospital Jodhpur',
          status: 'OPERATIONAL',
          icuBeds: { total: 10, available: 0 }
        })
      });

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', { sessionOverride: mockSession }, operatorUser);
          },
          (err) => err.code === 'HOSPITAL_CAPACITY_INSUFFICIENT' && err.statusCode === 409
        );

        assert.equal(mockSession.hasAborted, true);
        assert.equal(mockSession.hasCommitted, false);
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        Hospital.findOne = origHospFindOne;
      }
    });

    it('should safely handle incidents requiring 0 hospital beds without decrementing bed capacity', async () => {
      const mockSession = createMockSession();
      const zeroBedRec = createSampleRecommendation({
        incidentResults: [
          {
            incidentId: 1001,
            allocationStatus: 'SUCCESS',
            assignedResources: [{ resourceId: 501, resourceType: 'FIRE_ENGINE' }],
            resourceShortages: [],
            recommendedHospital: {
              hospitalId: 701,
              hospitalName: 'MDM Hospital Jodhpur',
              allocatedIcuBeds: 0,
              allocatedGeneralBeds: 0,
              allocatedOxygenBeds: 0
            }
          }
        ]
      });

      const origRecFind = DispatchRecord.findOne;
      const origIncFind = Incident.find;
      const origResFindOneAndUpdate = Resource.findOneAndUpdate;
      const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;
      const origHospFindOne = Hospital.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;

      let hospitalFindOneAndUpdateCalled = false;
      let hospitalFindOneCalled = false;

      DispatchRecord.findOne = async () => zeroBedRec;
      Incident.find = async () => [{ incidentId: 1001, status: 'VERIFIED' }];
      Resource.findOneAndUpdate = async () => ({ resourceId: 501, status: 'DISPATCHED' });

      Hospital.findOneAndUpdate = async () => {
        hospitalFindOneAndUpdateCalled = true;
        return { hospitalId: 701, status: 'OPERATIONAL' };
      };

      Hospital.findOne = () => ({
        session: () => {
          hospitalFindOneCalled = true;
          return { hospitalId: 701, name: 'MDM Hospital Jodhpur', status: 'OPERATIONAL' };
        }
      });

      Incident.findOneAndUpdate = async () => ({ incidentId: 1001, status: 'DISPATCHED' });

      try {
        const result = await confirmDispatch(
          'BATCH-20261118-001',
          { sessionOverride: mockSession },
          operatorUser
        );

        assert.equal(result.confirmationStatus, 'CONFIRMED');
        // Beds were 0, so findOneAndUpdate with negative $inc should NOT be called; only findOne to check OPERATIONAL
        assert.equal(hospitalFindOneAndUpdateCalled, false);
        assert.equal(hospitalFindOneCalled, true);
        assert.equal(result.hospitalReservations[0].reservedIcuBeds, 0);
        assert.equal(result.hospitalReservations[0].reservedGeneralBeds, 0);
        assert.equal(result.hospitalReservations[0].reservedOxygenBeds, 0);
      } finally {
        DispatchRecord.findOne = origRecFind;
        Incident.find = origIncFind;
        Resource.findOneAndUpdate = origResFindOneAndUpdate;
        Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
        Hospital.findOne = origHospFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
      }
    });
  });

  describe('5. Idempotency Key Handling', () => {
    it('should support idempotent replay and return 200 with existing result when same key is sent', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origRecFindOne = DispatchRecord.findOne;

      User.findById = async () => operatorUser;
      DispatchRecord.findOne = async (q) => {
        if (q.idempotencyKey === 'idempotency-key-1234') {
          return {
            batchId: 'BATCH-20261118-001',
            dispatchId: 'DISPATCH-20261118-TEST',
            confirmationStatus: 'CONFIRMED',
            confirmedAt: new Date('2026-11-18T00:30:00.000Z'),
            associatedIncidentIds: [1001],
            resourceReservations: [{ resourceId: 501, status: 'DISPATCHED' }],
            hospitalReservations: []
          };
        }
        return null;
      };

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'POST',
          '/api/dispatch/recommendations/BATCH-20261118-001/confirm',
          { idempotencyKey: 'idempotency-key-1234' },
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.dispatch.isIdempotentReplay, true);
        assert.equal(result.body.data.dispatch.dispatchId, 'DISPATCH-20261118-TEST');
      } finally {
        User.findById = origUserFind;
        DispatchRecord.findOne = origRecFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('should reject with 409 IDEMPOTENCY_KEY_COLLISION if idempotency key was used for a different batch', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origRecFindOne = DispatchRecord.findOne;

      User.findById = async () => operatorUser;
      DispatchRecord.findOne = async (q) => {
        if (q.idempotencyKey === 'reused-key-999') {
          return {
            batchId: 'BATCH-DIFFERENT-999', // Different batch!
            dispatchId: 'DISPATCH-OTHER',
            confirmationStatus: 'CONFIRMED'
          };
        }
        return null;
      };

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'POST',
          '/api/dispatch/recommendations/BATCH-20261118-001/confirm',
          { idempotencyKey: 'reused-key-999' },
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 409);
        assert.equal(result.body.error.code, 'IDEMPOTENCY_KEY_COLLISION');
      } finally {
        User.findById = origUserFind;
        DispatchRecord.findOne = origRecFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('should reject re-confirmation of an already confirmed batch when called with a new or different idempotency key', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origRecFindOne = DispatchRecord.findOne;

      User.findById = async () => operatorUser;
      DispatchRecord.findOne = async (q) => {
        if (q && q.idempotencyKey) {
          // Key not yet used anywhere
          return null;
        }
        // Query by batchId returns already confirmed record
        return {
          batchId: 'BATCH-20261118-001',
          dispatchId: 'DISPATCH-PRIOR-01',
          confirmationStatus: 'CONFIRMED',
          idempotencyKey: 'original-key-111',
          confirmedAt: new Date('2026-11-18T00:10:00.000Z')
        };
      };

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'POST',
          '/api/dispatch/recommendations/BATCH-20261118-001/confirm',
          { idempotencyKey: 'new-different-key-222' },
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 409);
        assert.equal(result.body.error.code, 'BATCH_ALREADY_CONFIRMED');
      } finally {
        User.findById = origUserFind;
        DispatchRecord.findOne = origRecFindOne;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('6. Dispatch Retrieval APIs (GET /:dispatchId, GET /)', () => {
    it('GET /api/dispatch/:dispatchId should return confirmed dispatch details for OPERATOR', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origRecFindOne = DispatchRecord.findOne;

      User.findById = async () => operatorUser;
      DispatchRecord.findOne = () => ({
        populate: function () { return this; },
        lean: async () => ({
          batchId: 'BATCH-20261118-001',
          dispatchId: 'DISPATCH-8888',
          confirmationStatus: 'CONFIRMED',
          confirmedAt: new Date('2026-11-18T00:30:00.000Z'),
          associatedIncidentIds: [1001],
          resourceReservations: [{ resourceId: 501, resourceType: 'FIRE_ENGINE', status: 'DISPATCHED' }],
          hospitalReservations: []
        })
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/dispatch/DISPATCH-8888',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.dispatch.dispatchId, 'DISPATCH-8888');
        assert.equal(result.body.data.dispatch.resourceReservations[0].resourceId, 501);
      } finally {
        User.findById = origUserFind;
        DispatchRecord.findOne = origRecFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('GET /api/dispatch/:dispatchId should return 404 DISPATCH_NOT_FOUND if dispatch does not exist', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origRecFindOne = DispatchRecord.findOne;

      User.findById = async () => operatorUser;
      DispatchRecord.findOne = () => ({
        populate: function () { return this; },
        lean: async () => null
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/dispatch/DISPATCH-MISSING',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 404);
        assert.equal(result.body.error.code, 'DISPATCH_NOT_FOUND');
      } finally {
        User.findById = origUserFind;
        DispatchRecord.findOne = origRecFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('GET /api/dispatch should return paginated list of confirmed dispatches', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origCount = DispatchRecord.countDocuments;
      const origFind = DispatchRecord.find;

      User.findById = async () => operatorUser;
      DispatchRecord.countDocuments = async () => 1;
      DispatchRecord.find = () => ({
        populate: function () { return this; },
        sort: function () { return this; },
        skip: function () { return this; },
        limit: function () { return this; },
        lean: async () => [
          {
            batchId: 'BATCH-20261118-001',
            dispatchId: 'DISPATCH-8888',
            confirmationStatus: 'CONFIRMED',
            confirmedAt: new Date('2026-11-18T00:30:00.000Z'),
            associatedIncidentIds: [1001],
            resourceReservations: []
          }
        ]
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/dispatch?page=1&limit=20',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.dispatches.length, 1);
        assert.equal(result.body.data.pagination.totalCount, 1);
      } finally {
        User.findById = origUserFind;
        DispatchRecord.countDocuments = origCount;
        DispatchRecord.find = origFind;
        __setConnectionStateOverride(null);
      }
    });

    it('GET /api/dispatch should deny CITIZEN with 403 Forbidden', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      User.findById = async () => citizenUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/dispatch',
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
});

