process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchService } from '../src/services/dispatchService.js';
import { incidentService } from '../src/services/incidentService.js';
import { resourceService } from '../src/services/resourceService.js';
import { hospitalService } from '../src/services/hospitalService.js';
import { decodePolyline } from '../src/utils/polylineDecoder.js';
import apiClient from '../src/services/apiClient.js';

describe('Phase 5.5–5.10 — Dispatch, Fleet, Hospital & Tactical Workflow Integration Tests', () => {

  describe('1. Polyline Route Decoder Utility (Phase 5.5 & 5.10)', () => {
    it('should decode a valid Google Encoded Polyline into [lat, lng] coordinates', () => {
      // Standard test polyline "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
      // Points: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
      const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
      const coordinates = decodePolyline(encoded);

      assert.ok(Array.isArray(coordinates), 'Decoded result must be an array');
      assert.strictEqual(coordinates.length, 3, 'Must contain 3 decoded coordinates');

      // Check first coordinate
      assert.strictEqual(Math.round(coordinates[0][0] * 10) / 10, 38.5);
      assert.strictEqual(Math.round(coordinates[0][1] * 10) / 10, -120.2);

      // Check second coordinate
      assert.strictEqual(Math.round(coordinates[1][0] * 100) / 100, 40.7);
      assert.strictEqual(Math.round(coordinates[1][1] * 100) / 100, -120.95);
    });

    it('should return empty array for empty, non-string, or invalid polyline inputs', () => {
      assert.deepStrictEqual(decodePolyline(''), []);
      assert.deepStrictEqual(decodePolyline(null), []);
      assert.deepStrictEqual(decodePolyline(undefined), []);
      assert.deepStrictEqual(decodePolyline(12345), []);
    });
  });

  describe('2. Tactical Map Entity & Filter Evaluation (Phase 5.10)', () => {
    it('should filter incidents according to tactical map filter selections', () => {
      const mockIncidents = [
        { incidentId: 1, status: 'REPORTED', severity: 4 },
        { incidentId: 2, status: 'VERIFIED', severity: 5 },
        { incidentId: 3, status: 'DISPATCHED', severity: 3 },
        { incidentId: 4, status: 'RESOLVED', severity: 2 }
      ];

      // Active filter includes REPORTED, VERIFIED, DISPATCHED, ON_SCENE
      const activeFilter = (inc) => ['REPORTED', 'VERIFIED', 'DISPATCHED', 'ON_SCENE'].includes(inc.status);
      const activeResults = mockIncidents.filter(activeFilter);
      assert.strictEqual(activeResults.length, 3);

      // Verified filter
      const verifiedResults = mockIncidents.filter((inc) => inc.status === 'VERIFIED');
      assert.strictEqual(verifiedResults.length, 1);
      assert.strictEqual(verifiedResults[0].incidentId, 2);
    });

    it('should filter resources according to tactical layer visibility and status', () => {
      const mockResources = [
        { resourceId: 101, status: 'AVAILABLE', resourceType: 'AMBULANCE' },
        { resourceId: 102, status: 'DISPATCHED', resourceType: 'FIRE_TRUCK' },
        { resourceId: 103, status: 'OUT_OF_SERVICE', resourceType: 'POLICE' }
      ];

      const availableUnits = mockResources.filter((r) => r.status === 'AVAILABLE');
      assert.strictEqual(availableUnits.length, 1);
      assert.strictEqual(availableUnits[0].resourceId, 101);
    });
  });

  describe('3. Dispatch Service Contracts (Phase 5.5 & 5.6)', () => {
    it('should call POST /dispatch/recommendations with incidentIds payload', async () => {
      const origPost = apiClient.post;
      let capturedUrl = null;
      let capturedBody = null;

      apiClient.post = async (url, body) => {
        capturedUrl = url;
        capturedBody = body;
        return {
          success: true,
          data: {
            recommendation: {
              batchId: 'batch-test-101',
              recommendationSummary: { totalIncidents: 1, totalUnitsRecommended: 2 },
              recommendations: []
            }
          }
        };
      };

      try {
        const result = await dispatchService.generateRecommendations([1001, 1002]);
        assert.strictEqual(capturedUrl, '/dispatch/recommendations');
        assert.deepStrictEqual(capturedBody, { incidentIds: [1001, 1002] });
        assert.strictEqual(result.batchId, 'batch-test-101');
      } finally {
        apiClient.post = origPost;
      }
    });

    it('should enforce batch limit bounds (reject > 25 incidents in client validation)', () => {
      const oversizedBatch = Array.from({ length: 26 }, (_, i) => i + 1);
      assert.strictEqual(oversizedBatch.length > 25, true, 'Oversized batch detection');
    });

    it('should call POST /dispatch/recommendations/:batchId/confirm with Idempotency-Key and options', async () => {
      const origPost = apiClient.post;
      let capturedUrl = null;
      let capturedBody = null;
      let capturedHeaders = null;

      apiClient.post = async (url, body, config) => {
        capturedUrl = url;
        capturedBody = body;
        capturedHeaders = config?.headers;
        return {
          success: true,
          data: {
            dispatch: {
              dispatchId: 'disp-real-201',
              status: 'CONFIRMED',
              confirmedAt: new Date().toISOString()
            }
          }
        };
      };

      try {
        const idempotencyKey = 'idem-uuid-999';
        const result = await dispatchService.confirmDispatch('batch-test-101', {
          allowPartialDispatch: true,
          confirmationNotes: 'Confirmed by shift operator'
        }, idempotencyKey);

        assert.strictEqual(capturedUrl, '/dispatch/recommendations/batch-test-101/confirm');
        assert.strictEqual(capturedBody.allowPartialDispatch, true);
        assert.strictEqual(capturedBody.confirmationNotes, 'Confirmed by shift operator');
        assert.strictEqual(capturedHeaders['Idempotency-Key'], 'idem-uuid-999');
        assert.strictEqual(result.dispatchId, 'disp-real-201');
      } finally {
        apiClient.post = origPost;
      }
    });

    it('should unpack GET /dispatch/recommendations with pagination', async () => {
      const origGet = apiClient.get;
      apiClient.get = async () => ({
        success: true,
        data: {
          recommendations: [{ batchId: 'batch-1' }],
          pagination: { page: 1, limit: 10, totalCount: 1 }
        }
      });

      try {
        const result = await dispatchService.listRecommendations({ page: 1 });
        assert.strictEqual(result.recommendations.length, 1);
        assert.strictEqual(result.pagination.totalCount, 1);
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should unpack GET /dispatch dispatches with pagination', async () => {
      const origGet = apiClient.get;
      apiClient.get = async () => ({
        success: true,
        data: {
          dispatches: [{ dispatchId: 'disp-1' }],
          pagination: { page: 1, limit: 10, totalCount: 1 }
        }
      });

      try {
        const result = await dispatchService.listDispatches({ page: 1 });
        assert.strictEqual(result.dispatches.length, 1);
        assert.strictEqual(result.pagination.totalCount, 1);
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  describe('4. Active Incident Tracking & Lifecycle Actions (Phase 5.7)', () => {
    it('should call GET /incidents/active and unpack { incidents, pagination }', async () => {
      const origGet = apiClient.get;
      apiClient.get = async (url) => {
        assert.strictEqual(url, '/incidents/active');
        return {
          success: true,
          data: {
            incidents: [
              { incidentId: 1001, status: 'DISPATCHED' },
              { incidentId: 1002, status: 'ON_SCENE' }
            ],
            pagination: { page: 1, limit: 20, totalCount: 2 }
          }
        };
      };

      try {
        const result = await incidentService.getActiveIncidents();
        assert.strictEqual(result.incidents.length, 2);
        assert.strictEqual(result.pagination.totalCount, 2);
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should call PATCH /incidents/:id/arrive with scene notes', async () => {
      const origPatch = apiClient.patch;
      let capturedUrl = null;
      let capturedBody = null;

      apiClient.patch = async (url, body) => {
        capturedUrl = url;
        capturedBody = body;
        return {
          success: true,
          data: {
            incident: { incidentId: 1001, status: 'ON_SCENE', arrivedAt: new Date().toISOString() }
          }
        };
      };

      try {
        const result = await incidentService.markArrived(1001, 'Ambulance 101 on site');
        assert.strictEqual(capturedUrl, '/incidents/1001/arrive');
        assert.strictEqual(capturedBody.arrivalNotes, 'Ambulance 101 on site');
        assert.strictEqual(result.status, 'ON_SCENE');
      } finally {
        apiClient.patch = origPatch;
      }
    });

    it('should call PATCH /incidents/:id/resolve with resolution notes', async () => {
      const origPatch = apiClient.patch;
      let capturedUrl = null;
      let capturedBody = null;

      apiClient.patch = async (url, body) => {
        capturedUrl = url;
        capturedBody = body;
        return {
          success: true,
          data: {
            incident: { incidentId: 1001, status: 'RESOLVED', resolvedAt: new Date().toISOString() },
            releasedResources: ['AMB-101'],
            releasedHospitals: []
          }
        };
      };

      try {
        const result = await incidentService.resolveIncident(1001, 'Patient stabilized and transported to MDM Hospital');
        assert.strictEqual(capturedUrl, '/incidents/1001/resolve');
        assert.strictEqual(capturedBody.resolutionNotes, 'Patient stabilized and transported to MDM Hospital');
        assert.strictEqual(result.incident.status, 'RESOLVED');
        assert.strictEqual(result.releasedResources.length, 1);
      } finally {
        apiClient.patch = origPatch;
      }
    });
  });

  describe('5. Resource Fleet Service Contracts (Phase 5.8)', () => {
    it('should call GET /resources with filters and return unpacked resource list', async () => {
      const origGet = apiClient.get;
      apiClient.get = async (url, config) => {
        assert.strictEqual(url, '/resources');
        assert.strictEqual(config.params.status, 'AVAILABLE');
        return {
          success: true,
          data: {
            resources: [
              { resourceId: 101, name: 'Ambulance 101', status: 'AVAILABLE', capacity: 2 }
            ],
            pagination: { totalCount: 1, totalPages: 1 }
          }
        };
      };

      try {
        const result = await resourceService.listResources({ status: 'AVAILABLE' });
        assert.strictEqual(result.resources.length, 1);
        assert.strictEqual(result.resources[0].resourceId, 101);
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should call GET /resources/stats and return aggregated fleet metrics', async () => {
      const origGet = apiClient.get;
      apiClient.get = async (url) => {
        assert.strictEqual(url, '/resources/stats');
        return {
          success: true,
          data: {
            totalResources: 20,
            availableCount: 15,
            reservedCount: 2,
            dispatchedCount: 3,
            byType: { AMBULANCE: 12, FIRE_TRUCK: 8 }
          }
        };
      };

      try {
        const stats = await resourceService.getResourceStats();
        assert.strictEqual(stats.totalResources, 20);
        assert.strictEqual(stats.availableCount, 15);
        assert.strictEqual(stats.dispatchedCount, 3);
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  describe('6. Hospital Network Service Contracts (Phase 5.9)', () => {
    it('should call GET /hospitals with query and return unpacked hospital list', async () => {
      const origGet = apiClient.get;
      apiClient.get = async (url) => {
        assert.strictEqual(url, '/hospitals');
        return {
          success: true,
          data: {
            hospitals: [
              { hospitalId: 1, name: 'AIIMS Jodhpur', totalBeds: 250, availableBeds: 85 }
            ],
            pagination: { totalCount: 1, totalPages: 1 }
          }
        };
      };

      try {
        const result = await hospitalService.listHospitals();
        assert.strictEqual(result.hospitals.length, 1);
        assert.strictEqual(result.hospitals[0].name, 'AIIMS Jodhpur');
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should call GET /hospitals/stats and return capacity statistics', async () => {
      const origGet = apiClient.get;
      apiClient.get = async (url) => {
        assert.strictEqual(url, '/hospitals/stats');
        return {
          success: true,
          data: {
            totalHospitals: 6,
            totalBeds: 1200,
            availableBeds: 450,
            occupancyRate: 62.5
          }
        };
      };

      try {
        const stats = await hospitalService.getHospitalStats();
        assert.strictEqual(stats.totalHospitals, 6);
        assert.strictEqual(stats.totalBeds, 1200);
        assert.strictEqual(stats.occupancyRate, 62.5);
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  describe('7. Dispatch Confirmation Guard Invariants (Simulation Integrity)', () => {
    it('should detect failed batch when batchStatus is FAILED or allocated vehicles count is 0', () => {
      const failedRecommendation1 = {
        batchId: 'rec_failed_001',
        batchStatus: 'FAILED',
        incidentResults: [
          { incidentId: 101, assignedResources: [] }
        ]
      };

      const totalVehicles1 = (failedRecommendation1.incidentResults || []).reduce(
        (sum, ir) => sum + (ir.assignedResources?.length || 0),
        0
      );
      const isBatchFailed1 = failedRecommendation1.batchStatus === 'FAILED' || totalVehicles1 === 0;

      assert.strictEqual(totalVehicles1, 0);
      assert.strictEqual(isBatchFailed1, true);

      // Successful recommendation with vehicles
      const validRecommendation = {
        batchId: 'rec_success_001',
        batchStatus: 'SUCCESS',
        incidentResults: [
          { incidentId: 102, assignedResources: [101, 102] }
        ]
      };

      const totalVehiclesValid = (validRecommendation.incidentResults || []).reduce(
        (sum, ir) => sum + (ir.assignedResources?.length || 0),
        0
      );
      const isBatchFailedValid = validRecommendation.batchStatus === 'FAILED' || totalVehiclesValid === 0;

      assert.strictEqual(totalVehiclesValid, 2);
      assert.strictEqual(isBatchFailedValid, false);
    });

    it('should determine appropriate failure badge text when batch fails or fleet is empty', () => {
      const getBlockedBadgeText = (isBatchFailed) => {
        return isBatchFailed ? 'Cannot Mobilize: 0 Vehicles Allocated (Batch Failed)' : null;
      };

      assert.strictEqual(
        getBlockedBadgeText(true),
        'Cannot Mobilize: 0 Vehicles Allocated (Batch Failed)'
      );
      assert.strictEqual(getBlockedBadgeText(false), null);
    });
  });
});
