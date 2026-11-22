import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { __setConnectionStateOverride } from '../src/config/database.js';
import Incident, {
  CALL_ATTEMPT_OUTCOMES,
  ARRIVAL_VERIFICATION_METHODS
} from '../src/models/Incident.js';
import Resource from '../src/models/Resource.js';
import DispatchRecord from '../src/models/DispatchRecord.js';
import {
  recordCallAttempt,
  getCallAttempts,
  markSceneArrival,
  resolveIncident,
  IncidentTrackingError
} from '../src/services/activeIncidentTrackingService.js';
import { arriveIncident, recordCallAttemptController, getCallAttemptsController } from '../src/controllers/incidentController.js';

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

describe('Phase 8.2 — Call Attempt Logging & Individual Resource Arrival Tracking Tests', () => {
  let mockSession;

  beforeEach(() => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });
    mockSession = createMockSession();
  });

  afterEach(() => {
    __setConnectionStateOverride(null);
  });

  const operatorUser = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Operator Patel',
    email: 'operator@jodhpur.emergency.gov.in',
    role: 'OPERATOR'
  };

  const citizenUser = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Citizen Saini',
    email: 'citizen@example.com',
    role: 'CITIZEN'
  };

  // =========================================================================
  // PART A: REPORTER CALL ATTEMPT LOGGING TESTS
  // =========================================================================
  describe('Part A: Manual Reporter Call Attempt Logging', () => {
    it('1. should define all 5 canonical call attempt outcomes', () => {
      assert.deepEqual(CALL_ATTEMPT_OUTCOMES, [
        'ANSWERED',
        'NO_ANSWER',
        'BUSY',
        'UNREACHABLE',
        'INVALID_NUMBER'
      ]);
    });

    it('2. should successfully record an ANSWERED call attempt with notes and operator attribution', async () => {
      const origFindOne = Incident.findOne;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;

      const mockIncident = {
        incidentId: 9001,
        status: 'REPORTED',
        reporterPhone: '+919876543210',
        callAttempts: []
      };

      Incident.findOne = async () => mockIncident;
      Incident.findOneAndUpdate = (query, update) => {
        assert.equal(query.incidentId, 9001);
        const attempt = update.$push.callAttempts;
        assert.equal(attempt.outcome, 'ANSWERED');
        assert.equal(attempt.phoneCalled, '+919876543210');
        assert.equal(attempt.notes, 'Spoke with caller Rajesh; confirmed situation');
        assert.ok(attempt.attemptId.startsWith('CALL-'));
        assert.ok(attempt.attemptedAt instanceof Date);

        return {
          populate: () => ({
            ...mockIncident,
            callAttempts: [
              {
                ...attempt,
                performedBy: operatorUser
              }
            ]
          })
        };
      };

      try {
        const result = await recordCallAttempt(9001, operatorUser, {
          outcome: 'ANSWERED',
          notes: 'Spoke with caller Rajesh; confirmed situation'
        }, { sessionOverride: mockSession });

        assert.equal(result.incidentId, 9001);
        assert.equal(result.incidentStatus, 'REPORTED'); // Incident status remains unchanged!
        assert.equal(result.totalCallAttempts, 1);
        assert.equal(result.callAttempt.outcome, 'ANSWERED');
        assert.equal(result.callAttempt.performedBy.name, 'Operator Patel');
      } finally {
        Incident.findOne = origFindOne;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    it('3. should successfully record all remaining outcomes (NO_ANSWER, BUSY, UNREACHABLE, INVALID_NUMBER)', async () => {
      const outcomesToTest = ['NO_ANSWER', 'BUSY', 'UNREACHABLE', 'INVALID_NUMBER'];
      const origFindOne = Incident.findOne;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;

      try {
        for (const testOutcome of outcomesToTest) {
          const mockIncident = {
            incidentId: 9002,
            status: 'REPORTED',
            reporterPhone: '+919876543210',
            callAttempts: []
          };

          Incident.findOne = async () => mockIncident;
          Incident.findOneAndUpdate = (query, update) => {
            assert.equal(update.$push.callAttempts.outcome, testOutcome);
            return {
              populate: () => ({
                ...mockIncident,
                callAttempts: [update.$push.callAttempts]
              })
            };
          };

          const result = await recordCallAttempt(9002, operatorUser, {
            outcome: testOutcome,
            notes: `Attempt recorded as ${testOutcome}`
          }, { sessionOverride: mockSession });

          assert.equal(result.callAttempt.outcome, testOutcome);
          assert.equal(result.incidentStatus, 'REPORTED'); // Status NEVER auto-transitions!
        }
      } finally {
        Incident.findOne = origFindOne;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    it('4. should reject malformed or invalid call outcomes with 400 INVALID_CALL_OUTCOME', async () => {
      const origFindOne = Incident.findOne;
      Incident.findOne = async () => ({ incidentId: 9003, reporterPhone: '+919876543210' });

      try {
        await assert.rejects(
          async () => {
            await recordCallAttempt(9003, operatorUser, { outcome: 'CALL_COMPLETED_FAKE' }, { sessionOverride: mockSession });
          },
          (err) => {
            assert.ok(err instanceof IncidentTrackingError);
            assert.equal(err.code, 'INVALID_CALL_OUTCOME');
            assert.equal(err.statusCode, 400);
            return true;
          }
        );
      } finally {
        Incident.findOne = origFindOne;
      }
    });

    it('5. should reject excessive call notes (>1000 characters)', async () => {
      const origFindOne = Incident.findOne;
      Incident.findOne = async () => ({ incidentId: 9004, reporterPhone: '+919876543210' });

      try {
        await assert.rejects(
          async () => {
            await recordCallAttempt(9004, operatorUser, {
              outcome: 'BUSY',
              notes: 'a'.repeat(1001)
            }, { sessionOverride: mockSession });
          },
          (err) => {
            assert.ok(err instanceof IncidentTrackingError);
            assert.equal(err.code, 'NOTES_TOO_LONG');
            assert.equal(err.statusCode, 400);
            return true;
          }
        );
      } finally {
        Incident.findOne = origFindOne;
      }
    });

    it('6. should persist multiple call attempts in chronological history', async () => {
      const origFindOne = Incident.findOne;
      Incident.findOne = () => ({
        populate: () => ({
          lean: async () => ({
            incidentId: 9005,
            callAttempts: [
              {
                attemptId: 'CALL-1',
                incidentId: 9005,
                attemptedAt: new Date('2026-11-20T10:00:00Z'),
                phoneCalled: '+919876543210',
                outcome: 'NO_ANSWER',
                notes: 'First attempt: rang 5 times',
                performedBy: { _id: operatorUser._id, name: 'Operator Patel', email: operatorUser.email, role: 'OPERATOR' }
              },
              {
                attemptId: 'CALL-2',
                incidentId: 9005,
                attemptedAt: new Date('2026-11-20T10:05:00Z'),
                phoneCalled: '+919876543210',
                outcome: 'BUSY',
                notes: 'Second attempt: busy signal',
                performedBy: { _id: operatorUser._id, name: 'Operator Patel', email: operatorUser.email, role: 'OPERATOR' }
              },
              {
                attemptId: 'CALL-3',
                incidentId: 9005,
                attemptedAt: new Date('2026-11-20T10:10:00Z'),
                phoneCalled: '+919876543210',
                outcome: 'ANSWERED',
                notes: 'Third attempt: connected with reporter',
                performedBy: { _id: operatorUser._id, name: 'Operator Patel', email: operatorUser.email, role: 'OPERATOR' }
              }
            ]
          })
        })
      });

      try {
        const history = await getCallAttempts(9005);
        assert.equal(history.callAttempts.length, 3);
        assert.equal(history.callAttempts[0].outcome, 'NO_ANSWER');
        assert.equal(history.callAttempts[1].outcome, 'BUSY');
        assert.equal(history.callAttempts[2].outcome, 'ANSWERED');
        assert.equal(history.callAttempts[2].performedBy.name, 'Operator Patel');
      } finally {
        Incident.findOne = origFindOne;
      }
    });

    it('7. should guarantee call attempts do not automatically alter incident status or verification outcome', async () => {
      const origFindOne = Incident.findOne;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;

      let capturedStatus = 'REPORTED';
      let capturedOutcome = null;

      Incident.findOne = async () => ({
        incidentId: 9006,
        status: capturedStatus,
        latestVerificationOutcome: capturedOutcome,
        reporterPhone: '+919876543210',
        callAttempts: []
      });

      Incident.findOneAndUpdate = (query, update) => {
        // Assert that $set does NOT update status or verificationOutcome!
        assert.equal(update.$set, undefined);
        return {
          populate: () => ({
            incidentId: 9006,
            status: capturedStatus,
            latestVerificationOutcome: capturedOutcome,
            callAttempts: [update.$push.callAttempts]
          })
        };
      };

      try {
        const res = await recordCallAttempt(9006, operatorUser, {
          outcome: 'ANSWERED',
          notes: 'Call was answered but operator must still independently verify'
        }, { sessionOverride: mockSession });

        assert.equal(res.incidentStatus, 'REPORTED');
      } finally {
        Incident.findOne = origFindOne;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  // =========================================================================
  // PART B: INDIVIDUAL RESOURCE ARRIVAL TRACKING TESTS
  // =========================================================================
  describe('Part B: Per-Resource Arrival Tracking & Verification Methods', () => {
    it('1. should define all 3 supported verification methods (RADIO, PHONE, MANUAL)', () => {
      assert.deepEqual(ARRIVAL_VERIFICATION_METHODS, ['RADIO', 'PHONE', 'MANUAL']);
    });

    it('2. should mark only the specified resource as arrived and transition incident DISPATCHED -> ON_SCENE', async () => {
      const mockSession = createMockSession();
      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;

      const inc = {
        incidentId: 8001,
        status: 'DISPATCHED',
        dispatchId: 'DISPATCH-8001-TEST',
        dispatchedBatchId: 'BATCH-8001',
        dispatchedAt: new Date('2026-11-20T12:00:00Z'),
        assignedResourceIds: [101, 201, 301],
        assignedResourceArrivals: [
          { resourceId: 101, resourceType: 'ALS_AMBULANCE', incidentId: 8001, status: 'DISPATCHED' },
          { resourceId: 201, resourceType: 'FIRE_ENGINE', incidentId: 8001, status: 'DISPATCHED' },
          { resourceId: 301, resourceType: 'RESCUE_VEHICLE', incidentId: 8001, status: 'DISPATCHED' }
        ],
        auditHistory: []
      };

      const disp = {
        dispatchId: 'DISPATCH-8001-TEST',
        resourceReservations: [
          { resourceId: 101, assignedIncidentId: 8001, status: 'DISPATCHED' },
          { resourceId: 201, assignedIncidentId: 8001, status: 'DISPATCHED' },
          { resourceId: 301, assignedIncidentId: 8001, status: 'DISPATCHED' }
        ],
        incidentTracking: [{ incidentId: 8001, status: 'DISPATCHED' }],
        confirmationAuditTrail: [],
        save: async () => {}
      };

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async (query, update) => {
        assert.equal(query.incidentId, 8001);
        assert.equal(update.$set.status, 'ON_SCENE'); // First resource triggers overall incident ON_SCENE
        assert.equal(update.$set.arrivalVerificationMethod, 'RADIO');
        const arrivals = update.$set.assignedResourceArrivals;

        // Verify only #101 is ON_SCENE, while #201 and #301 remain DISPATCHED
        const res101 = arrivals.find((r) => r.resourceId === 101);
        const res201 = arrivals.find((r) => r.resourceId === 201);
        const res301 = arrivals.find((r) => r.resourceId === 301);

        assert.equal(res101.status, 'ON_SCENE');
        assert.equal(res101.verificationMethod, 'RADIO');
        assert.equal(res101.notes, 'Unit 101 arrived at north gate');
        assert.ok(res101.arrivedAt instanceof Date);

        assert.equal(res201.status, 'DISPATCHED');
        assert.equal(res201.arrivedAt, null);
        assert.equal(res301.status, 'DISPATCHED');
        assert.equal(res301.arrivedAt, null);

        return {
          ...inc,
          status: 'ON_SCENE',
          arrivedAt: update.$set.arrivedAt,
          arrivalVerificationMethod: 'RADIO',
          assignedResourceArrivals: arrivals,
          auditHistory: [...inc.auditHistory, { action: 'ON_SCENE' }]
        };
      };

      DispatchRecord.findOne = () => ({ session: () => disp });

      try {
        const result = await markSceneArrival(8001, operatorUser, {
          resourceId: 101,
          verificationMethod: 'RADIO',
          notes: 'Unit 101 arrived at north gate',
          sessionOverride: mockSession
        });

        assert.equal(result.incident.status, 'ON_SCENE');
        assert.equal(result.resourceArrival.resourceId, 101);
        assert.equal(result.resourceArrival.status, 'ON_SCENE');
        assert.equal(result.resourceArrival.verificationMethod, 'RADIO');
        assert.equal(result.incident.onSceneResourceCount, 1);
        assert.equal(result.incident.allResourcesOnScene, false); // Partial arrival!
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
      }
    });

    it('3. should mark subsequent resource arrived on an already ON_SCENE incident', async () => {
      const mockSession = createMockSession();
      const origIncFindOne = Incident.findOne;
      const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
      const origDispFindOne = DispatchRecord.findOne;

      // Incident is already ON_SCENE because unit 101 previously arrived
      const inc = {
        incidentId: 8002,
        status: 'ON_SCENE',
        dispatchId: 'DISPATCH-8002',
        dispatchedBatchId: 'BATCH-8002',
        dispatchedAt: new Date('2026-11-20T12:00:00Z'),
        arrivedAt: new Date('2026-11-20T12:05:00Z'),
        assignedResourceIds: [101, 201],
        assignedResourceArrivals: [
          { resourceId: 101, resourceType: 'ALS_AMBULANCE', incidentId: 8002, status: 'ON_SCENE', arrivedAt: new Date('2026-11-20T12:05:00Z') },
          { resourceId: 201, resourceType: 'FIRE_ENGINE', incidentId: 8002, status: 'DISPATCHED', arrivedAt: null }
        ],
        auditHistory: []
      };

      const disp = {
        dispatchId: 'DISPATCH-8002',
        resourceReservations: [
          { resourceId: 101, assignedIncidentId: 8002, status: 'ON_SCENE' },
          { resourceId: 201, assignedIncidentId: 8002, status: 'DISPATCHED' }
        ],
        incidentTracking: [{ incidentId: 8002, status: 'ON_SCENE' }],
        confirmationAuditTrail: [],
        save: async () => {}
      };

      Incident.findOne = async () => inc;
      Incident.findOneAndUpdate = async (query, update) => {
        const arrivals = update.$set.assignedResourceArrivals;
        const res201 = arrivals.find((r) => r.resourceId === 201);
        assert.equal(res201.status, 'ON_SCENE');
        assert.equal(res201.verificationMethod, 'PHONE');
        assert.equal(res201.notes, 'Engine 201 on site confirmed via cellphone');

        return {
          ...inc,
          status: 'ON_SCENE',
          assignedResourceArrivals: arrivals
        };
      };

      DispatchRecord.findOne = () => ({ session: () => disp });

      try {
        const result = await markSceneArrival(8002, operatorUser, {
          resourceId: 201,
          verificationMethod: 'PHONE',
          notes: 'Engine 201 on site confirmed via cellphone',
          sessionOverride: mockSession
        });

        assert.equal(result.incident.status, 'ON_SCENE');
        assert.equal(result.resourceArrival.resourceId, 201);
        assert.equal(result.resourceArrival.status, 'ON_SCENE');
        assert.equal(result.incident.onSceneResourceCount, 2);
        assert.equal(result.incident.allResourcesOnScene, true); // All resources on scene!
      } finally {
        Incident.findOne = origIncFindOne;
        Incident.findOneAndUpdate = origIncFindOneAndUpdate;
        DispatchRecord.findOne = origDispFindOne;
      }
    });

    it('4. should reject duplicate arrival request for an already ON_SCENE resource with 409 RESOURCE_ALREADY_ON_SCENE', async () => {
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => ({
        incidentId: 8003,
        status: 'ON_SCENE',
        dispatchId: 'DISPATCH-8003',
        assignedResourceIds: [101],
        assignedResourceArrivals: [
          { resourceId: 101, status: 'ON_SCENE', arrivedAt: new Date() }
        ]
      });

      try {
        await assert.rejects(
          async () => {
            await markSceneArrival(8003, operatorUser, {
              resourceId: 101,
              verificationMethod: 'MANUAL',
              sessionOverride: mockSession
            });
          },
          (err) => {
            assert.ok(err instanceof IncidentTrackingError);
            assert.equal(err.code, 'RESOURCE_ALREADY_ON_SCENE');
            assert.equal(err.statusCode, 409);
            return true;
          }
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('5. should reject arrival for unassigned resource ID with 400 RESOURCE_NOT_ASSIGNED_TO_INCIDENT', async () => {
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => ({
        incidentId: 8004,
        status: 'DISPATCHED',
        dispatchId: 'DISPATCH-8004',
        assignedResourceIds: [101, 102] // #999 not assigned
      });

      try {
        await assert.rejects(
          async () => {
            await markSceneArrival(8004, operatorUser, {
              resourceId: 999,
              verificationMethod: 'MANUAL',
              sessionOverride: mockSession
            });
          },
          (err) => {
            assert.ok(err instanceof IncidentTrackingError);
            assert.equal(err.code, 'RESOURCE_NOT_ASSIGNED_TO_INCIDENT');
            assert.equal(err.statusCode, 400);
            return true;
          }
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('6. should reject arrival for undispatched incident with 409 INCIDENT_STATE_CONFLICT', async () => {
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => ({
        incidentId: 8005,
        status: 'VERIFIED', // Not dispatched
        assignedResourceIds: [101]
      });

      try {
        await assert.rejects(
          async () => {
            await markSceneArrival(8005, operatorUser, {
              resourceId: 101,
              verificationMethod: 'RADIO',
              sessionOverride: mockSession
            });
          },
          (err) => {
            assert.ok(err instanceof IncidentTrackingError);
            assert.equal(err.statusCode, 409);
            return true;
          }
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });

    it('7. should reject invalid verification method with 400 INVALID_VERIFICATION_METHOD', async () => {
      const origIncFindOne = Incident.findOne;
      Incident.findOne = async () => ({
        incidentId: 8006,
        status: 'DISPATCHED',
        dispatchId: 'DISPATCH-8006',
        assignedResourceIds: [101],
        assignedResourceArrivals: [{ resourceId: 101, status: 'DISPATCHED' }]
      });

      try {
        await assert.rejects(
          async () => {
            await markSceneArrival(8006, operatorUser, {
              resourceId: 101,
              verificationMethod: 'SATELLITE_TELEMETRY_FAKE',
              sessionOverride: mockSession
            });
          },
          (err) => {
            assert.ok(err instanceof IncidentTrackingError);
            assert.equal(err.code, 'INVALID_VERIFICATION_METHOD');
            assert.equal(err.statusCode, 400);
            return true;
          }
        );
      } finally {
        Incident.findOne = origIncFindOne;
      }
    });
  });

  // =========================================================================
  // PART C: CONTROLLER ENDPOINTS, RBAC & CITIZEN PRIVACY TESTS
  // =========================================================================
  describe('Part C: Controller Endpoints, Privacy & Role Authorization', () => {
    function createMockRes() {
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        }
      };
      return res;
    }

    it('1. recordCallAttemptController should return 201 for valid operator call attempt', async () => {
      const req = {
        params: { incidentId: '9101' },
        body: { outcome: 'ANSWERED', notes: 'Citizen reported situation under control.' },
        user: operatorUser
      };
      const res = createMockRes();

      const origFindOne = Incident.findOne;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;

      Incident.findOne = async () => ({
        incidentId: 9101,
        reporterPhone: '+919876543210'
      });

      Incident.findOneAndUpdate = () => ({
        populate: async () => ({
          incidentId: 9101,
          status: 'REPORTED',
          callAttempts: [{ outcome: 'ANSWERED' }]
        })
      });

      try {
        await recordCallAttemptController(req, res, (err) => {
          if (err) throw err;
        });
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.callAttempt.outcome, 'ANSWERED');
      } finally {
        Incident.findOne = origFindOne;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    it('2. recordCallAttemptController should return 400 for invalid call outcome', async () => {
      const req = {
        params: { incidentId: '9102' },
        body: { outcome: 'INVALID_STATUS_FOO' },
        user: operatorUser
      };
      const res = createMockRes();

      const origFindOne = Incident.findOne;
      Incident.findOne = async () => ({ incidentId: 9102, reporterPhone: '+919876543210' });

      try {
        await recordCallAttemptController(req, res, () => {});
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, 'INVALID_CALL_OUTCOME');
      } finally {
        Incident.findOne = origFindOne;
      }
    });

    it('3. getCallAttemptsController should return 200 with chronological attempts', async () => {
      const req = {
        params: { incidentId: '9103' },
        user: operatorUser
      };
      const res = createMockRes();

      const origFindOne = Incident.findOne;
      Incident.findOne = () => ({
        populate: () => ({
          lean: async () => ({
            incidentId: 9103,
            callAttempts: [
              { attemptId: 'CALL-1', outcome: 'BUSY', attemptedAt: new Date() }
            ]
          })
        })
      });

      try {
        await getCallAttemptsController(req, res, () => {});
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.callAttempts.length, 1);
        assert.equal(res.body.callAttempts[0].outcome, 'BUSY');
      } finally {
        Incident.findOne = origFindOne;
      }
    });

    it('4. getIncidentById should sanitize and hide callAttempts and reporterPhone from CITIZEN', async () => {
      const { getIncidentById } = await import('../src/controllers/incidentController.js');

      const citizenCaller = {
        _id: new mongoose.Types.ObjectId(),
        role: 'CITIZEN'
      };

      const req = {
        params: { incidentId: '9104' },
        user: citizenCaller
      };
      const res = createMockRes();

      const origFindOne = Incident.findOne;
      Incident.findOne = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              populate: () => ({
                populate: () => ({
                  populate: () => ({
                    populate: async () => ({
                      incidentId: 9104,
                      status: 'REPORTED',
                      reportedBy: citizenCaller._id,
                      reporterPhone: '+919876543210',
                      alternatePhone: '+919876543211',
                      callAttempts: [{ attemptId: 'CA-1', outcome: 'ANSWERED' }],
                      assignedResourceArrivals: [{ resourceId: 101, status: 'DISPATCHED' }],
                      reportedAt: new Date()
                    })
                  })
                })
              })
            })
          })
        })
      });

      try {
        await getIncidentById(req, res, () => {});
        assert.equal(res.statusCode, 200);
        const data = res.body.data.incident;
        assert.equal(data.incidentId, 9104);
        // Sensitive fields must be stripped for citizen!
        assert.equal(data.reporterPhone, undefined);
        assert.equal(data.alternatePhone, undefined);
        assert.equal(data.callAttempts, undefined);
        assert.equal(data.assignedResourceArrivals, undefined);
      } finally {
        Incident.findOne = origFindOne;
      }
    });

    it('5. getIncidentById should include callAttempts and assignedResourceArrivals for OPERATOR', async () => {
      const { getIncidentById } = await import('../src/controllers/incidentController.js');

      const req = {
        params: { incidentId: '9105' },
        user: operatorUser
      };
      const res = createMockRes();

      const origFindOne = Incident.findOne;
      Incident.findOne = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              populate: () => ({
                populate: () => ({
                  populate: () => ({
                    populate: async () => ({
                      incidentId: 9105,
                      status: 'DISPATCHED',
                      reportedBy: new mongoose.Types.ObjectId(),
                      reporterPhone: '+919876543210',
                      alternatePhone: '+919876543211',
                      callAttempts: [{ attemptId: 'CA-2', outcome: 'NO_ANSWER' }],
                      assignedResourceArrivals: [{ resourceId: 101, status: 'DISPATCHED' }],
                      reportedAt: new Date(),
                      dispatchedAt: new Date()
                    })
                  })
                })
              })
            })
          })
        })
      });

      try {
        await getIncidentById(req, res, () => {});
        assert.equal(res.statusCode, 200);
        const data = res.body.data.incident;
        assert.equal(data.incidentId, 9105);
        // Operator can see callAttempts and assignedResourceArrivals
        assert.equal(data.reporterPhone, '+919876543210');
        assert.equal(data.callAttempts.length, 1);
        assert.equal(data.callAttempts[0].outcome, 'NO_ANSWER');
        assert.equal(data.assignedResourceArrivals.length, 1);
        assert.equal(data.assignedResourceArrivals[0].resourceId, 101);
      } finally {
        Incident.findOne = origFindOne;
      }
    });
  });
});
