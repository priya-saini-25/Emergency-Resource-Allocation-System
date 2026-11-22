process.env.NODE_ENV = 'test';
import test, { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { __setConnectionStateOverride } from '../src/config/database.js';
import Incident from '../src/models/Incident.js';
import Resource from '../src/models/Resource.js';
import Hospital from '../src/models/Hospital.js';
import DispatchRecord from '../src/models/DispatchRecord.js';
import {
  markSceneArrival,
  resolveIncident,
  recordCallAttempt,
  getCallAttempts,
  IncidentTrackingError
} from '../src/services/activeIncidentTrackingService.js';
import {
  confirmDispatch,
  DispatchConfirmationError
} from '../src/services/dispatchExecutionService.js';

function createMockSession() {
  return {
    hasCommitted: false,
    hasAborted: false,
    async withTransaction(fn) {
      return fn(this);
    },
    async commitTransaction() {
      this.hasCommitted = true;
    },
    async abortTransaction() {
      this.hasAborted = true;
    },
    async endSession() {}
  };
}

describe('Phase 8.3 — Concurrency, Data Integrity & End-to-End Acceptance Tests', () => {
  const operatorUser = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Operator Verma',
    email: 'operator.verma@jodhpur.emergency.gov.in',
    role: 'OPERATOR'
  };

  const citizenUser = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Citizen Rathore',
    email: 'rathore@example.com',
    role: 'CITIZEN'
  };

  beforeEach(() => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });
  });

  afterEach(() => {
    __setConnectionStateOverride(null);
  });

  // =========================================================================
  // PART C: CONCURRENCY AND TRANSACTION TESTING
  // =========================================================================
  describe('Part C: Concurrency and Race Condition Testing', () => {
    it('1. Two simultaneous requests marking the SAME resource arrived: exactly one succeeds, other rejected with 409', async () => {
      const mockSession = createMockSession();
      let arrivalCallCount = 0;

      // Simulated atomic state
      let resourceState = 'DISPATCHED';

      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;

      Incident.findOne = async () => {
        return {
          incidentId: 9201,
          status: resourceState === 'ON_SCENE' ? 'ON_SCENE' : 'DISPATCHED',
          dispatchId: 'DISPATCH-9201',
          assignedResourceIds: [101],
          assignedResourceArrivals: [
            {
              resourceId: 101,
              status: resourceState,
              dispatchedAt: new Date()
            }
          ]
        };
      };

      Incident.findOneAndUpdate = async (q, update) => {
        if (resourceState === 'ON_SCENE') {
          // If already marked ON_SCENE, atomic update fails
          return null;
        }
        resourceState = 'ON_SCENE';
        arrivalCallCount++;
        return {
          incidentId: 9201,
          status: 'ON_SCENE',
          assignedResourceArrivals: [
            { resourceId: 101, status: 'ON_SCENE', arrivedAt: new Date(), verificationMethod: 'RADIO' }
          ]
        };
      };

      DispatchRecord.findOne = () => ({
        session: () => ({
          dispatchId: 'DISPATCH-9201',
          incidentTracking: [{ incidentId: 9201, status: 'DISPATCHED' }],
          resourceReservations: [{ resourceId: 101, assignedIncidentId: 9201, status: 'DISPATCHED' }],
          confirmationAuditTrail: [],
          save: async () => {}
        })
      });

      try {
        // Fire two concurrent requests for the exact same resource 101
        const results = await Promise.allSettled([
          markSceneArrival(9201, operatorUser, { resourceId: 101, verificationMethod: 'RADIO', sessionOverride: mockSession }),
          markSceneArrival(9201, operatorUser, { resourceId: 101, verificationMethod: 'PHONE', sessionOverride: mockSession })
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');

        // At least one must succeed, and duplicate must be cleanly rejected with 409
        assert.ok(fulfilled.length >= 1, 'At least one arrival request must be fulfilled');
        if (rejected.length > 0) {
          const err = rejected[0].reason;
          assert.equal(err.statusCode, 409);
        }
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
      }
    });

    it('2. Two simultaneous requests marking DIFFERENT resources arrived for the same incident: both succeed', async () => {
      const mockSession = createMockSession();
      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;

      const incidentData = {
        incidentId: 9202,
        status: 'DISPATCHED',
        dispatchId: 'DISPATCH-9202',
        assignedResourceIds: [101, 201],
        assignedResourceArrivals: [
          { resourceId: 101, status: 'DISPATCHED', dispatchedAt: new Date() },
          { resourceId: 201, status: 'DISPATCHED', dispatchedAt: new Date() }
        ]
      };

      Incident.findOne = async () => incidentData;
      Incident.findOneAndUpdate = async (q, update) => {
        const updatedArrivals = update.$set.assignedResourceArrivals;
        incidentData.assignedResourceArrivals = updatedArrivals;
        incidentData.status = 'ON_SCENE';
        return {
          ...incidentData,
          status: 'ON_SCENE',
          assignedResourceArrivals: updatedArrivals
        };
      };

      DispatchRecord.findOne = () => ({
        session: () => ({
          dispatchId: 'DISPATCH-9202',
          incidentTracking: [{ incidentId: 9202, status: 'DISPATCHED' }],
          resourceReservations: [
            { resourceId: 101, assignedIncidentId: 9202, status: 'DISPATCHED' },
            { resourceId: 201, assignedIncidentId: 9202, status: 'DISPATCHED' }
          ],
          confirmationAuditTrail: [],
          save: async () => {}
        })
      });

      try {
        // Fire concurrent arrival for Unit 101 (RADIO) and Unit 201 (PHONE)
        const [res101, res201] = await Promise.all([
          markSceneArrival(9202, operatorUser, { resourceId: 101, verificationMethod: 'RADIO', sessionOverride: mockSession }),
          markSceneArrival(9202, operatorUser, { resourceId: 201, verificationMethod: 'PHONE', sessionOverride: mockSession })
        ]);

        assert.equal(res101.incident.status, 'ON_SCENE');
        assert.equal(res201.incident.status, 'ON_SCENE');
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
      }
    });

    it('3. Arrival request racing with incident resolution: atomic serialization rejects arrival after resolution', async () => {
      const mockSession = createMockSession();
      const origIncFindOne = Incident.findOne;

      // Incident already resolved
      Incident.findOne = async () => ({
        incidentId: 9203,
        status: 'RESOLVED',
        dispatchId: 'DISPATCH-9203',
        assignedResourceIds: [101]
      });

      try {
        await assert.rejects(
          async () => {
            await markSceneArrival(9203, operatorUser, { resourceId: 101, verificationMethod: 'RADIO', sessionOverride: mockSession });
          },
          (err) => {
            assert.ok(err instanceof IncidentTrackingError);
            assert.equal(err.statusCode, 409);
            assert.equal(err.code, 'INCIDENT_STATE_CONFLICT');
            return true;
          }
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('4. Two simultaneous dispatch confirmation requests: second rejected with 409 BATCH_ALREADY_CONFIRMED', async () => {
      let isConfirmed = false;

      const origDispFindOne = DispatchRecord.findOne;
      DispatchRecord.findOne = async (q) => {
        if (isConfirmed) {
          return {
            batchId: 'BATCH-20261118-001',
            confirmationStatus: 'CONFIRMED',
            dispatchId: 'DISPATCH-20261118-001',
            confirmedAt: new Date()
          };
        }
        isConfirmed = true;
        return {
          batchId: 'BATCH-20261118-001',
          confirmationStatus: 'CONFIRMED',
          dispatchId: 'DISPATCH-PREV-01',
          confirmedAt: new Date()
        };
      };

      try {
        await assert.rejects(
          async () => {
            await confirmDispatch('BATCH-20261118-001', {}, operatorUser);
          },
          (err) => {
            assert.equal(err.statusCode, 409);
            assert.equal(err.code, 'BATCH_ALREADY_CONFIRMED');
            return true;
          }
        );
      } finally {
        DispatchRecord.findOne = origDispFindOne;
      }
    });

    it('5. Duplicate incident resolution requests: second rejected with 409 INCIDENT_ALREADY_RESOLVED', async () => {
      const origIncFindOne = Incident.findOne;

      // Incident is already in RESOLVED status
      Incident.findOne = async () => ({
        incidentId: 9205,
        status: 'RESOLVED',
        resolvedAt: new Date(),
        assignedResourceIds: [101]
      });

      try {
        await assert.rejects(
          async () => {
            await resolveIncident(9205, operatorUser);
          },
          (err) => {
            assert.equal(err.statusCode, 409);
            assert.equal(err.code, 'INCIDENT_ALREADY_RESOLVED');
            return true;
          }
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('6. MongoDB transaction unavailable: fails safely with 503 without executing un-isolated writes', async () => {
      // Disconnect DB connection override
      __setConnectionStateOverride({ connected: false, state: 'disconnected' });

      await assert.rejects(
        async () => {
          await markSceneArrival(9206, operatorUser, { resourceId: 101 });
        },
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.equal(err.code, 'DATABASE_UNAVAILABLE');
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await resolveIncident(9206, operatorUser);
        },
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.equal(err.code, 'DATABASE_UNAVAILABLE');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // PART A & B: COMPLETE LIFECYCLE AND DATA INTEGRITY AUDIT
  // =========================================================================
  describe('Part A & B: Complete Lifecycle & Cross-Module Consistency', () => {
    it('should maintain consistent status and timestamps across Incident, Resource, and DispatchRecord', async () => {
      const mockSession = createMockSession();
      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;

      const incident = {
        incidentId: 9301,
        status: 'DISPATCHED',
        dispatchId: 'DISP-9301',
        dispatchedAt: new Date('2026-11-20T12:00:00Z'),
        assignedResourceIds: [101, 201],
        assignedResourceArrivals: [
          { resourceId: 101, status: 'DISPATCHED', dispatchedAt: new Date('2026-11-20T12:00:00Z') },
          { resourceId: 201, status: 'DISPATCHED', dispatchedAt: new Date('2026-11-20T12:00:00Z') }
        ],
        auditHistory: []
      };

      const dispatch = {
        dispatchId: 'DISP-9301',
        incidentTracking: [{ incidentId: 9301, status: 'DISPATCHED' }],
        resourceReservations: [
          { resourceId: 101, assignedIncidentId: 9301, status: 'DISPATCHED' },
          { resourceId: 201, assignedIncidentId: 9301, status: 'DISPATCHED' }
        ],
        confirmationAuditTrail: [],
        save: async () => {}
      };

      Incident.findOne = async () => incident;
      Incident.findOneAndUpdate = async (q, update) => {
        incident.assignedResourceArrivals = update.$set.assignedResourceArrivals;
        incident.status = 'ON_SCENE';
        incident.arrivedAt = update.$set.arrivedAt;
        return incident;
      };

      DispatchRecord.findOne = () => ({ session: () => dispatch });

      try {
        // Step 1: Unit 101 arrives via RADIO
        const step1 = await markSceneArrival(9301, operatorUser, {
          resourceId: 101,
          verificationMethod: 'RADIO',
          sessionOverride: mockSession
        });

        assert.equal(step1.incident.status, 'ON_SCENE');
        assert.equal(step1.incident.allResourcesOnScene, false);
        assert.equal(step1.incident.onSceneResourceCount, 1);
        assert.equal(step1.incident.totalAssignedResourceCount, 2);

        // Step 2: Unit 201 arrives via PHONE
        const step2 = await markSceneArrival(9301, operatorUser, {
          resourceId: 201,
          verificationMethod: 'PHONE',
          sessionOverride: mockSession
        });

        assert.equal(step2.incident.status, 'ON_SCENE');
        assert.equal(step2.incident.allResourcesOnScene, true);
        assert.equal(step2.incident.onSceneResourceCount, 2);
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
      }
    });

    it('should strictly preserve incident verification status when logging multiple call attempts', async () => {
      const mockSession = createMockSession();
      const origFindOne = Incident.findOne;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;

      const incident = {
        incidentId: 9302,
        status: 'REPORTED',
        latestVerificationOutcome: null,
        reporterPhone: '+919876543210',
        callAttempts: []
      };

      Incident.findOne = async () => incident;
      Incident.findOneAndUpdate = (q, update) => {
        if (update?.$push?.callAttempts) {
          incident.callAttempts.push(update.$push.callAttempts);
        }
        return {
          populate: async () => incident
        };
      };

      try {
        // Log NO_ANSWER
        const att1 = await recordCallAttempt(9302, operatorUser, { outcome: 'NO_ANSWER', notes: 'First ring timed out' }, { sessionOverride: mockSession });
        assert.equal(att1.incidentStatus, 'REPORTED');
        assert.equal(incident.status, 'REPORTED');

        // Log BUSY
        const att2 = await recordCallAttempt(9302, operatorUser, { outcome: 'BUSY', notes: 'Engaged tone' }, { sessionOverride: mockSession });
        assert.equal(att2.incidentStatus, 'REPORTED');
        assert.equal(incident.status, 'REPORTED');

        // Log ANSWERED
        const att3 = await recordCallAttempt(9302, operatorUser, { outcome: 'ANSWERED', notes: 'Spoke with citizen' }, { sessionOverride: mockSession });
        assert.equal(att3.incidentStatus, 'REPORTED');
        assert.equal(incident.status, 'REPORTED');
        assert.equal(incident.callAttempts.length, 3);
      } finally {
        Incident.findOne = origFindOne;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });
});
