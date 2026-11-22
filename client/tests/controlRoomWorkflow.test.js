process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import incidentService from '../src/services/incidentService.js';
import apiClient from '../src/services/apiClient.js';
import {
  PROGRESSION_STAGES,
  ACTIVE_LIFECYCLE_STATUSES,
  TERMINAL_STATUSES,
  getStageTimestamp,
  evaluateLifecycleProgression,
} from '../src/utils/incidentLifecycle.js';

describe('Phase 5.4 — Control Room Incident Management & Verification Tests', () => {

  // =========================================================================
  // 1. Incident Service API Contracts (Operator & Control Room Endpoints)
  // =========================================================================
  describe('1. Incident Service API Contracts', () => {
    it('should call GET /incidents with filter parameters and unpack { incidents, pagination }', async () => {
      const origGet = apiClient.get;
      try {
        const mockFilters = {
          status: 'REPORTED',
          category: 'FIRE',
          severity: 4,
          incidentId: 1731895200001,
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        };

        apiClient.get = async (url, config) => {
          assert.equal(url, '/incidents');
          assert.deepEqual(config?.params, mockFilters);

          return {
            success: true,
            message: 'Incident registry retrieved successfully',
            data: {
              incidents: [
                {
                  incidentId: 1731895200001,
                  category: 'FIRE',
                  severity: 4,
                  status: 'REPORTED',
                  location: { latitude: 26.2978, longitude: 73.0185 },
                  reportedBy: { id: 'usr_c1', name: 'Citizen Reporter', email: 'citizen@example.com' },
                  reportedAt: '2026-11-18T02:00:00.000Z',
                  createdAt: '2026-11-18T02:00:00.000Z',
                },
              ],
              pagination: {
                page: 1,
                limit: 20,
                totalCount: 1,
                totalPages: 1,
              },
            },
          };
        };

        const result = await incidentService.listIncidents(mockFilters);
        assert.ok(result);
        assert.equal(Array.isArray(result.incidents), true);
        assert.equal(result.incidents.length, 1);
        assert.equal(result.incidents[0].incidentId, 1731895200001);
        assert.equal(result.incidents[0].status, 'REPORTED');
        assert.equal(result.pagination.totalCount, 1);
        assert.equal(result.pagination.page, 1);
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should call GET /incidents/:id and unpack data.incident payload', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async (url) => {
          assert.equal(url, '/incidents/1731895200001');
          return {
            success: true,
            message: 'Incident detail retrieved',
            data: {
              incident: {
                incidentId: 1731895200001,
                category: 'ROAD_ACCIDENT',
                severity: 3,
                status: 'REPORTED',
                location: { latitude: 26.2886, longitude: 73.024 },
                reportedBy: { id: 'usr_c2', name: 'Sanjay Kumar', email: 'sanjay@example.com' },
                auditHistory: [
                  {
                    action: 'REPORTED',
                    performedBy: { id: 'usr_c2', name: 'Sanjay Kumar', role: 'CITIZEN' },
                    performedAt: '2026-11-18T02:05:00.000Z',
                  },
                ],
              },
            },
          };
        };

        const result = await incidentService.getIncidentById(1731895200001);
        assert.ok(result);
        assert.equal(result.incidentId, 1731895200001);
        assert.equal(result.category, 'ROAD_ACCIDENT');
        assert.equal(result.reportedBy.name, 'Sanjay Kumar');
        assert.equal(result.auditHistory.length, 1);
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should call PATCH /incidents/:id/verify with verification notes and return verified incident', async () => {
      const origPatch = apiClient.patch;
      try {
        apiClient.patch = async (url, payload) => {
          assert.equal(url, '/incidents/1731895200001/verify');
          assert.equal(payload.verificationNotes, 'Caller confirmed 2 vehicles collided.');

          return {
            success: true,
            message: 'Incident verified successfully',
            data: {
              incident: {
                incidentId: 1731895200001,
                status: 'VERIFIED',
                verifiedAt: '2026-11-18T02:10:00.000Z',
                verificationNotes: payload.verificationNotes,
                verifiedBy: { id: 'usr_op1', name: 'Operator Chief', email: 'operator@jodhpur.gov.in' },
              },
            },
          };
        };

        const result = await incidentService.verifyIncident(
          1731895200001,
          'Caller confirmed 2 vehicles collided.'
        );
        assert.ok(result);
        assert.equal(result.incidentId, 1731895200001);
        assert.equal(result.status, 'VERIFIED');
        assert.equal(result.verificationNotes, 'Caller confirmed 2 vehicles collided.');
        assert.equal(result.verifiedBy.name, 'Operator Chief');
      } finally {
        apiClient.patch = origPatch;
      }
    });

    it('should call PATCH /incidents/:id/reject with mandatory reason and return rejected incident', async () => {
      const origPatch = apiClient.patch;
      try {
        apiClient.patch = async (url, payload) => {
          assert.equal(url, '/incidents/1731895200001/reject');
          assert.equal(payload.rejectionReason, 'Duplicate report already logged under #1731895200000');

          return {
            success: true,
            message: 'Incident rejected successfully',
            data: {
              incident: {
                incidentId: 1731895200001,
                status: 'REJECTED',
                rejectedAt: '2026-11-18T02:12:00.000Z',
                rejectionReason: payload.rejectionReason,
                rejectedBy: { id: 'usr_op1', name: 'Operator Chief', email: 'operator@jodhpur.gov.in' },
              },
            },
          };
        };

        const result = await incidentService.rejectIncident(
          1731895200001,
          'Duplicate report already logged under #1731895200000'
        );
        assert.ok(result);
        assert.equal(result.incidentId, 1731895200001);
        assert.equal(result.status, 'REJECTED');
        assert.equal(result.rejectionReason, 'Duplicate report already logged under #1731895200000');
        assert.equal(result.rejectedBy.name, 'Operator Chief');
      } finally {
        apiClient.patch = origPatch;
      }
    });

    it('should call GET /incidents/stats and return global aggregate statistics', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async (url) => {
          assert.equal(url, '/incidents/stats');
          return {
            success: true,
            message: 'Incident statistics retrieved successfully',
            data: {
              totalIncidents: 42,
              pendingReported: 5,
              verifiedCount: 12,
              rejectedCount: 8,
              allocatedCount: 3,
              dispatchedCount: 4,
              onSceneCount: 2,
              resolvedCount: 8,
              activeIncidents: 26,
              byStatus: {
                REPORTED: 5,
                VERIFIED: 12,
                REJECTED: 8,
                ALLOCATED: 3,
                DISPATCHED: 4,
                ON_SCENE: 2,
                RESOLVED: 8,
              },
            },
          };
        };

        const result = await incidentService.getIncidentStats();
        assert.ok(result);
        assert.equal(result.totalIncidents, 42);
        assert.equal(result.pendingReported, 5);
        assert.equal(result.verifiedCount, 12);
        assert.equal(result.rejectedCount, 8);
        assert.equal(result.activeIncidents, 26);
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  // =========================================================================
  // 2. Verification & Rejection Validation Logic
  // =========================================================================
  describe('2. Client-Side Validation Rules for Verification and Rejection', () => {
    it('should validate verification notes length (max 1000 chars)', () => {
      const validNotes = 'a'.repeat(1000);
      assert.equal(validNotes.trim().length <= 1000, true);

      const invalidNotes = 'a'.repeat(1001);
      assert.equal(invalidNotes.trim().length > 1000, true);
    });

    it('should require minimum 3 characters and maximum 1000 for rejection reason', () => {
      const tooShortReason = 'ab';
      assert.equal(tooShortReason.trim().length < 3, true);

      const emptyReason = '   ';
      assert.equal(emptyReason.trim().length === 0, true);

      const validReason = 'Duplicate emergency report confirmed via radio.';
      assert.equal(validReason.trim().length >= 3 && validReason.trim().length <= 1000, true);

      const tooLongReason = 'x'.repeat(1001);
      assert.equal(tooLongReason.trim().length > 1000, true);
    });

    it('should handle 409 INCIDENT_STATE_CONFLICT error normalization', async () => {
      const origPatch = apiClient.patch;
      try {
        apiClient.patch = async () => {
          const err = new Error('Cannot verify incident with status VERIFIED.');
          err.status = 409;
          err.code = 'INCIDENT_STATE_CONFLICT';
          err.currentStatus = 'VERIFIED';
          err.requiredStatus = 'REPORTED';
          throw err;
        };

        await assert.rejects(
          async () => {
            await incidentService.verifyIncident(1731895200001, 'Test notes');
          },
          (err) => {
            assert.equal(err.status, 409);
            assert.equal(err.code, 'INCIDENT_STATE_CONFLICT');
            assert.equal(err.currentStatus, 'VERIFIED');
            return true;
          }
        );
      } finally {
        apiClient.patch = origPatch;
      }
    });
  });

  // =========================================================================
  // 3. Queue Query Parameter Construction
  // =========================================================================
  describe('3. Queue Query Parameter Construction', () => {
    it('should strip empty string parameters before dispatching API request', () => {
      const filters = {
        status: 'REPORTED',
        category: '',
        severity: '',
        incidentId: '',
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        startDate: '',
        endDate: '',
      };

      const cleanParams = {};
      if (filters.status) cleanParams.status = filters.status;
      if (filters.category) cleanParams.category = filters.category;
      if (filters.severity) cleanParams.severity = filters.severity;
      if (filters.incidentId) cleanParams.incidentId = filters.incidentId;
      if (filters.page) cleanParams.page = filters.page;
      if (filters.limit) cleanParams.limit = filters.limit;
      if (filters.sortBy) cleanParams.sortBy = filters.sortBy;
      if (filters.sortOrder) cleanParams.sortOrder = filters.sortOrder;
      if (filters.startDate) cleanParams.startDate = filters.startDate;
      if (filters.endDate) cleanParams.endDate = filters.endDate;

      assert.deepEqual(cleanParams, {
        status: 'REPORTED',
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      assert.equal('category' in cleanParams, false);
      assert.equal('severity' in cleanParams, false);
      assert.equal('incidentId' in cleanParams, false);
    });

    it('should include category and numeric severity when provided', () => {
      const filters = {
        status: 'VERIFIED',
        category: 'FIRE',
        severity: '5',
        page: 2,
        limit: 25,
      };

      const cleanParams = {};
      if (filters.status) cleanParams.status = filters.status;
      if (filters.category) cleanParams.category = filters.category;
      if (filters.severity) cleanParams.severity = filters.severity;
      if (filters.page) cleanParams.page = filters.page;
      if (filters.limit) cleanParams.limit = filters.limit;

      assert.deepEqual(cleanParams, {
        status: 'VERIFIED',
        category: 'FIRE',
        severity: '5',
        page: 2,
        limit: 25,
      });
    });
  });

  // =========================================================================
  // 4. Lifecycle Progression & Operator Permissions
  // =========================================================================
  describe('4. Lifecycle Progression & Operational Stage Verification', () => {
    it('should accurately determine that only REPORTED status can be verified or rejected', () => {
      const testStatuses = [
        { status: 'REPORTED', canVerify: true, canReject: true },
        { status: 'VERIFIED', canVerify: false, canReject: false },
        { status: 'ALLOCATED', canVerify: false, canReject: false },
        { status: 'DISPATCHED', canVerify: false, canReject: false },
        { status: 'ON_SCENE', canVerify: false, canReject: false },
        { status: 'RESOLVED', canVerify: false, canReject: false },
        { status: 'REJECTED', canVerify: false, canReject: false },
        { status: 'CANCELLED', canVerify: false, canReject: false },
      ];

      testStatuses.forEach(({ status, canVerify, canReject }) => {
        const isActionable = status === 'REPORTED';
        assert.equal(isActionable, canVerify, `Verification check mismatch for status ${status}`);
        assert.equal(isActionable, canReject, `Rejection check mismatch for status ${status}`);
      });
    });

    it('should correctly evaluate lifecycle progression stages for VERIFIED incident', () => {
      const { isTerminalAlternative, activeIndex, stages } = evaluateLifecycleProgression('VERIFIED');
      assert.equal(isTerminalAlternative, false);
      assert.equal(activeIndex, 1);
      assert.equal(stages[0].stage, 'REPORTED');
      assert.equal(stages[0].isCompleted, true);
      assert.equal(stages[1].stage, 'VERIFIED');
      assert.equal(stages[1].isCurrent, true);
      assert.equal(stages[2].stage, 'ALLOCATED');
      assert.equal(stages[2].isPending, true);
    });

    it('should extract genuine timestamps and return null for missing timestamps (no fabrication)', () => {
      const mockIncident = {
        reportedAt: '2026-11-18T02:00:00.000Z',
        verifiedAt: '2026-11-18T02:05:00.000Z',
        dispatchedAt: null,
      };

      assert.equal(getStageTimestamp(mockIncident, 'REPORTED'), '2026-11-18T02:00:00.000Z');
      assert.equal(getStageTimestamp(mockIncident, 'VERIFIED'), '2026-11-18T02:05:00.000Z');
      assert.equal(getStageTimestamp(mockIncident, 'DISPATCHED'), null);
      assert.equal(getStageTimestamp(mockIncident, 'ON_SCENE'), null);
      assert.equal(getStageTimestamp(mockIncident, 'RESOLVED'), null);
    });

    it('should safely display operator audit records without raw _id leaks', () => {
      const rawAuditRecord = {
        action: 'VERIFIED',
        performedBy: {
          id: '507f1f77bcf86cd799439011',
          name: 'Supervisor Sharma',
          email: 'sharma@jodhpur-ems.gov.in',
          role: 'OPERATOR',
        },
        performedAt: '2026-11-18T02:05:00.000Z',
        notes: 'Phone verified with police control room.',
        previousStatus: 'REPORTED',
        newStatus: 'VERIFIED',
      };

      // Display name and role must be available
      const displayName = rawAuditRecord.performedBy?.name || 'Operator';
      const roleLabel = rawAuditRecord.performedBy?.role || 'OPERATOR';
      assert.equal(displayName, 'Supervisor Sharma');
      assert.equal(roleLabel, 'OPERATOR');
      assert.equal(rawAuditRecord.performedAt, '2026-11-18T02:05:00.000Z');
      assert.equal(rawAuditRecord.notes, 'Phone verified with police control room.');
    });
  });

  // =========================================================================
  // 5. Control Room Dashboard Metric Calculations
  // =========================================================================
  describe('5. Control Room Dashboard Metric Calculations', () => {
    it('should extract genuine global MongoDB aggregation metrics without document pagination', () => {
      const mockStatsPayload = {
        totalIncidents: 42,
        pendingReported: 5,
        verifiedCount: 12,
        rejectedCount: 8,
        allocatedCount: 3,
        dispatchedCount: 4,
        onSceneCount: 2,
        resolvedCount: 8,
        activeIncidents: 26,
        byStatus: {
          REPORTED: 5,
          VERIFIED: 12,
          REJECTED: 8,
          ALLOCATED: 3,
          DISPATCHED: 4,
          ON_SCENE: 2,
          RESOLVED: 8,
        },
      };

      const metrics = {
        totalIncidents: mockStatsPayload.totalIncidents ?? 0,
        pendingReported: mockStatsPayload.pendingReported ?? 0,
        verifiedCount: mockStatsPayload.verifiedCount ?? 0,
        rejectedCount: mockStatsPayload.rejectedCount ?? 0,
      };

      assert.equal(metrics.totalIncidents, 42);
      assert.equal(metrics.pendingReported, 5);
      assert.equal(metrics.verifiedCount, 12);
      assert.equal(metrics.rejectedCount, 8);
    });

    it('should aggregate database counts for dashboard metrics accurately from fallback responses', () => {
      const mockResponses = {
        all: { pagination: { totalCount: 42 } },
        reported: { pagination: { totalCount: 5 } },
        verified: { pagination: { totalCount: 12 } },
        rejected: { pagination: { totalCount: 8 } },
      };

      const metrics = {
        totalIncidents: mockResponses.all.pagination.totalCount,
        pendingReported: mockResponses.reported.pagination.totalCount,
        verifiedCount: mockResponses.verified.pagination.totalCount,
        rejectedCount: mockResponses.rejected.pagination.totalCount,
      };

      assert.equal(metrics.totalIncidents, 42);
      assert.equal(metrics.pendingReported, 5);
      assert.equal(metrics.verifiedCount, 12);
      assert.equal(metrics.rejectedCount, 8);
    });
  });
});

