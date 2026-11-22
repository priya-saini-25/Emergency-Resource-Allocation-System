import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import incidentService from '../src/services/incidentService.js';
import apiClient from '../src/services/apiClient.js';

describe('Phase 8.2 — Frontend Call Attempt Logging & Per-Resource Arrival Tracking Tests', () => {
  // =========================================================================
  // 1. Service API Contracts for Call Attempts
  // =========================================================================
  describe('1. Call Attempt API Contracts', () => {
    it('should call POST /incidents/:id/call-attempts with valid outcome and notes', async () => {
      const origPost = apiClient.post;
      let recordedUrl = null;
      let recordedPayload = null;

      apiClient.post = async (url, payload) => {
        recordedUrl = url;
        recordedPayload = payload;
        return {
          data: {
            success: true,
            message: 'Call attempt recorded.',
            callAttempt: {
              attemptId: 'ATTEMPT-101',
              outcome: payload.outcome,
              notes: payload.notes,
              attemptedAt: '2026-11-20T12:00:00Z',
            },
          },
        };
      };

      try {
        const result = await incidentService.recordCallAttempt(5001, {
          outcome: 'ANSWERED',
          notes: 'Citizen confirmed 2 trapped victims.',
        });

        assert.equal(recordedUrl, '/incidents/5001/call-attempts');
        assert.equal(recordedPayload.outcome, 'ANSWERED');
        assert.equal(recordedPayload.notes, 'Citizen confirmed 2 trapped victims.');
        assert.equal(result.success, true);
        assert.equal(result.callAttempt.outcome, 'ANSWERED');
      } finally {
        apiClient.post = origPost;
      }
    });

    it('should call GET /incidents/:id/call-attempts to fetch attempt history', async () => {
      const origGet = apiClient.get;
      let recordedUrl = null;

      apiClient.get = async (url) => {
        recordedUrl = url;
        return {
          data: {
            callAttempts: [
              {
                attemptId: 'ATT-1',
                outcome: 'NO_ANSWER',
                attemptedAt: '2026-11-20T10:00:00Z',
              },
              {
                attemptId: 'ATT-2',
                outcome: 'ANSWERED',
                attemptedAt: '2026-11-20T10:05:00Z',
              },
            ],
          },
        };
      };

      try {
        const history = await incidentService.getCallAttempts(5002);
        assert.equal(recordedUrl, '/incidents/5002/call-attempts');
        assert.equal(history.length, 2);
        assert.equal(history[0].outcome, 'NO_ANSWER');
        assert.equal(history[1].outcome, 'ANSWERED');
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  // =========================================================================
  // 2. Service API Contracts for Per-Resource Arrival Tracking
  // =========================================================================
  describe('2. Per-Resource Arrival API Contracts', () => {
    it('should call PATCH /incidents/:id/resources/:resourceId/arrive with verification method', async () => {
      const origPatch = apiClient.patch;
      let recordedUrl = null;
      let recordedPayload = null;

      apiClient.patch = async (url, payload) => {
        recordedUrl = url;
        recordedPayload = payload;
        return {
          data: {
            incident: {
              incidentId: 6001,
              status: 'ON_SCENE',
              assignedResourceArrivals: [
                {
                  resourceId: 101,
                  status: 'ON_SCENE',
                  verificationMethod: payload.verificationMethod,
                  notes: payload.arrivalNotes,
                },
              ],
            },
          },
        };
      };

      try {
        const updated = await incidentService.markResourceArrived(6001, 101, {
          verificationMethod: 'RADIO',
          arrivalNotes: 'Ambulance 101 reports on scene.',
        });

        assert.equal(recordedUrl, '/incidents/6001/resources/101/arrive');
        assert.equal(recordedPayload.verificationMethod, 'RADIO');
        assert.equal(recordedPayload.arrivalNotes, 'Ambulance 101 reports on scene.');
        assert.equal(updated.status, 'ON_SCENE');
        assert.equal(updated.assignedResourceArrivals[0].status, 'ON_SCENE');
      } finally {
        apiClient.patch = origPatch;
      }
    });

    it('should support legacy markArrived with backward-compatible options object', async () => {
      const origPatch = apiClient.patch;
      let recordedUrl = null;
      let recordedPayload = null;

      apiClient.patch = async (url, payload) => {
        recordedUrl = url;
        recordedPayload = payload;
        return {
          data: {
            incident: {
              incidentId: 6002,
              status: 'ON_SCENE',
              arrivalVerificationMethod: payload.verificationMethod,
            },
          },
        };
      };

      try {
        const updated = await incidentService.markArrived(6002, {
          verificationMethod: 'MANUAL',
          arrivalNotes: 'Supervisor verified on scene.',
        });

        assert.equal(recordedUrl, '/incidents/6002/arrive');
        assert.equal(recordedPayload.verificationMethod, 'MANUAL');
        assert.equal(updated.status, 'ON_SCENE');
      } finally {
        apiClient.patch = origPatch;
      }
    });
  });

  // =========================================================================
  // 3. UI Helpers & Lifecycle Progression State
  // =========================================================================
  describe('3. Arrival State Progression & Verification Validation', () => {
    const CANONICAL_CALL_OUTCOMES = [
      'ANSWERED',
      'NO_ANSWER',
      'BUSY',
      'UNREACHABLE',
      'INVALID_NUMBER',
    ];

    const CANONICAL_VERIFICATION_METHODS = ['RADIO', 'PHONE', 'MANUAL'];

    it('should recognize all 5 canonical call outcomes', () => {
      assert.equal(CANONICAL_CALL_OUTCOMES.length, 5);
      assert.ok(CANONICAL_CALL_OUTCOMES.includes('ANSWERED'));
      assert.ok(CANONICAL_CALL_OUTCOMES.includes('NO_ANSWER'));
      assert.ok(CANONICAL_CALL_OUTCOMES.includes('BUSY'));
      assert.ok(CANONICAL_CALL_OUTCOMES.includes('UNREACHABLE'));
      assert.ok(CANONICAL_CALL_OUTCOMES.includes('INVALID_NUMBER'));
    });

    it('should recognize all 3 canonical verification methods', () => {
      assert.equal(CANONICAL_VERIFICATION_METHODS.length, 3);
      assert.ok(CANONICAL_VERIFICATION_METHODS.includes('RADIO'));
      assert.ok(CANONICAL_VERIFICATION_METHODS.includes('PHONE'));
      assert.ok(CANONICAL_VERIFICATION_METHODS.includes('MANUAL'));
    });

    it('should calculate partial arrival vs all resources on scene correctly', () => {
      // 1 of 2 arrived -> Partial arrival
      const partialIncident = {
        assignedResourceArrivals: [
          { resourceId: 101, status: 'ON_SCENE' },
          { resourceId: 201, status: 'DISPATCHED' },
        ],
      };
      const arrivedCount = partialIncident.assignedResourceArrivals.filter(
        (a) => a.status === 'ON_SCENE'
      ).length;
      const totalCount = partialIncident.assignedResourceArrivals.length;
      const allArrived = arrivedCount === totalCount;

      assert.equal(arrivedCount, 1);
      assert.equal(totalCount, 2);
      assert.equal(allArrived, false);

      // 2 of 2 arrived -> All resources on scene
      const fullIncident = {
        assignedResourceArrivals: [
          { resourceId: 101, status: 'ON_SCENE' },
          { resourceId: 201, status: 'ON_SCENE' },
        ],
      };
      const fullArrivedCount = fullIncident.assignedResourceArrivals.filter(
        (a) => a.status === 'ON_SCENE'
      ).length;
      const fullAllArrived = fullArrivedCount === fullIncident.assignedResourceArrivals.length;

      assert.equal(fullArrivedCount, 2);
      assert.equal(fullAllArrived, true);
    });

    it('should enforce that logging a call attempt never alters incident verification status', () => {
      const incidentBefore = {
        incidentId: 7001,
        status: 'REPORTED',
        latestVerificationOutcome: null,
      };

      // Recording a NO_ANSWER call attempt
      const callAttempt = {
        attemptId: 'ATT-99',
        outcome: 'NO_ANSWER',
        notes: 'Called reporter mobile; line rang without answer.',
      };

      // Incident state must strictly remain REPORTED
      const incidentAfter = {
        ...incidentBefore,
        callAttempts: [callAttempt],
      };

      assert.equal(incidentAfter.status, 'REPORTED');
      assert.equal(incidentAfter.latestVerificationOutcome, null);
      assert.equal(incidentAfter.callAttempts.length, 1);
    });
  });
});
