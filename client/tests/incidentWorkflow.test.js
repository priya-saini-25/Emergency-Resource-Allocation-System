process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import incidentService from '../src/services/incidentService.js';
import apiClient from '../src/services/apiClient.js';
import {
  isInsideJodhpurPolygon,
  isWithinJodhpurBoundingBox,
  isPointInPolygonWithHoles,
  extractPolygonCoordinates,
  pointInLinearRing,
  JODHPUR_BOUNDING_BOX,
  JODHPUR_COORDINATES,
  JODHPUR_BOUNDARY_GEOJSON,
} from '../src/config/geoConfig.js';
import {
  PROGRESSION_STAGES,
  ACTIVE_LIFECYCLE_STATUSES,
  TERMINAL_STATUSES,
  getStageTimestamp,
  evaluateLifecycleProgression,
} from '../src/utils/incidentLifecycle.js';

describe('Phase 5.3 — Citizen Emergency Reporting & Incident History Integration Tests', () => {

  // =========================================================================
  // 1. Incident Service API Contract Alignment
  // =========================================================================
  describe('1. Incident Service API Contracts', () => {
    it('should call POST /incidents and unpack data.incident payload', async () => {
      const origPost = apiClient.post;
      try {
        const mockPayload = {
          category: 'FIRE',
          severity: 4,
          victimCount: 2,
          description: 'Structure fire near Ghanta Ghar market square.',
          location: { latitude: 26.2978, longitude: 73.0185 }
        };

        apiClient.post = async (url, payload) => {
          assert.equal(url, '/incidents');
          assert.equal(payload.category, 'FIRE');
          assert.equal(payload.severity, 4);
          assert.equal(payload.victimCount, 2);
          assert.equal(payload.location.latitude, 26.2978);
          assert.equal(payload.location.longitude, 73.0185);

          return {
            success: true,
            message: 'Emergency incident reported successfully',
            data: {
              incident: {
                incidentId: 1731895200001,
                category: 'FIRE',
                severity: 4,
                victimCount: 2,
                status: 'REPORTED',
                description: payload.description,
                location: payload.location,
                reportedAt: '2026-11-18T02:00:00.000Z',
                reportedBy: 'usr_citizen_001'
              }
            }
          };
        };

        const result = await incidentService.createIncident(mockPayload);
        assert.ok(result);
        assert.equal(result.incidentId, 1731895200001);
        assert.equal(result.status, 'REPORTED');
        assert.equal(result.category, 'FIRE');
        assert.equal(result.severity, 4);
        assert.equal(result.victimCount, 2);
        assert.equal(result.location.latitude, 26.2978);
      } finally {
        apiClient.post = origPost;
      }
    });

    it('should send canonical ROAD_ACCIDENT category when submitting a traffic collision report', async () => {
      const origPost = apiClient.post;
      try {
        let sentPayload = null;
        apiClient.post = async (url, payload) => {
          assert.equal(url, '/incidents');
          sentPayload = payload;
          return {
            success: true,
            data: {
              incident: {
                incidentId: 1731895200099,
                category: payload.category,
                severity: payload.severity,
                victimCount: payload.victimCount,
                location: payload.location,
                status: 'REPORTED',
                reportedAt: '2026-11-18T02:00:00.000Z',
              }
            }
          };
        };

        const result = await incidentService.createIncident({
          category: 'ROAD_ACCIDENT',
          severity: 3,
          victimCount: 1,
          description: 'Two-car collision near Clock Tower.',
          location: { latitude: 26.2978, longitude: 73.0185 }
        });

        assert.ok(result);
        assert.equal(sentPayload.category, 'ROAD_ACCIDENT');
        assert.notEqual(sentPayload.category, 'TRAFFIC_ACCIDENT');
        assert.equal(result.category, 'ROAD_ACCIDENT');
      } finally {
        apiClient.post = origPost;
      }
    });

    it('should call GET /incidents/my with pagination and unpack { incidents, pagination }', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async (url, config) => {
          assert.equal(url, '/incidents/my');
          assert.deepEqual(config?.params, { page: 1, limit: 10 });

          return {
            success: true,
            message: 'Citizen incident history retrieved successfully',
            data: {
              incidents: [
                {
                  incidentId: 1731895200001,
                  category: 'FIRE',
                  severity: 4,
                  victimCount: 2,
                  status: 'DISPATCHED',
                  description: 'Structure fire reported.',
                  location: { latitude: 26.2978, longitude: 73.0185 },
                  reportedAt: '2026-11-18T02:00:00.000Z'
                },
                {
                  incidentId: 1731895100002,
                  category: 'ROAD_ACCIDENT',
                  severity: 3,
                  victimCount: 1,
                  status: 'ON_SCENE',
                  description: 'Two-car collision.',
                  location: { latitude: 26.2886, longitude: 73.0240 },
                  reportedAt: '2026-11-18T01:30:00.000Z'
                }
              ],
              pagination: {
                page: 1,
                limit: 10,
                totalCount: 2,
                totalPages: 1
              }
            }
          };
        };

        const result = await incidentService.getMyIncidents({ page: 1, limit: 10 });
        assert.ok(result);
        assert.equal(Array.isArray(result.incidents), true);
        assert.equal(result.incidents.length, 2);
        assert.equal(result.incidents[0].incidentId, 1731895200001);
        assert.equal(result.pagination.totalCount, 2);
        assert.equal(result.pagination.totalPages, 1);
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should call GET /incidents/:incidentId and unpack data.incident', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async (url) => {
          assert.equal(url, '/incidents/1731895200001');

          return {
            success: true,
            message: 'Incident details retrieved successfully',
            data: {
              incident: {
                incidentId: 1731895200001,
                category: 'FIRE',
                severity: 4,
                victimCount: 2,
                status: 'VERIFIED',
                description: 'Structure fire near Ghanta Ghar.',
                location: { latitude: 26.2978, longitude: 73.0185 },
                reportedAt: '2026-11-18T02:00:00.000Z',
                verifiedAt: '2026-11-18T02:02:15.000Z',
                verificationNotes: 'Control room confirmed smoke plumes on surveillance camera.',
                statusHistory: [
                  { status: 'REPORTED', timestamp: '2026-11-18T02:00:00.000Z' },
                  { status: 'VERIFIED', timestamp: '2026-11-18T02:02:15.000Z' }
                ]
              }
            }
          };
        };

        const result = await incidentService.getIncidentById(1731895200001);
        assert.ok(result);
        assert.equal(result.incidentId, 1731895200001);
        assert.equal(result.status, 'VERIFIED');
        assert.equal(result.statusHistory.length, 2);
        assert.equal(result.verificationNotes, 'Control room confirmed smoke plumes on surveillance camera.');
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  // =========================================================================
  // 2. Client-Side Input Validation Rules
  // =========================================================================
  describe('2. Form Validation Rules & Submission Blocking', () => {
    const CANONICAL_CATEGORIES = [
      'FIRE',
      'ROAD_ACCIDENT',
      'MEDICAL_EMERGENCY',
      'HAZMAT',
      'STRUCTURAL_COLLAPSE',
      'NATURAL_DISASTER',
      'CIVIL_DISTURBANCE',
      'OTHER'
    ];

    function validateIncidentInput({ category, severity, victimCount, description, latitude, longitude }) {
      const errors = {};

      if (!category || !CANONICAL_CATEGORIES.includes(category)) {
        errors.category = 'Valid emergency category is required';
      }

      const sevNum = Number(severity);
      if (!Number.isInteger(sevNum) || sevNum < 1 || sevNum > 5) {
        errors.severity = 'Severity must be an integer between 1 and 5';
      }

      const vicNum = Number(victimCount);
      if (!Number.isInteger(vicNum) || vicNum < 0) {
        errors.victimCount = 'Estimated casualties must be a non-negative integer';
      }

      const desc = typeof description === 'string' ? description.trim() : '';
      if (!desc) {
        errors.description = 'Description is required';
      } else if (desc.length > 1000) {
        errors.description = 'Description cannot exceed 1000 characters';
      }

      const latNum = Number(latitude);
      if (latitude === '' || !Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
        errors.latitude = 'Valid latitude in [-90, 90] is required';
      }

      const lngNum = Number(longitude);
      if (longitude === '' || !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
        errors.longitude = 'Valid longitude in [-180, 180] is required';
      }

      // Exact Polygon Pre-Validation: Prevent submission when outside polygon
      if (Number.isFinite(latNum) && Number.isFinite(lngNum) && !errors.latitude && !errors.longitude) {
        if (!isInsideJodhpurPolygon(latNum, lngNum)) {
          errors.location = 'Selected coordinates fall outside the Jodhpur Urban Service Area boundary polygon';
          errors.latitude = 'Location falls outside Jodhpur Urban Service Area polygon (OSM Way 31725312 proxy)';
        }
      }

      return {
        isValid: Object.keys(errors).length === 0,
        errors
      };
    }

    it('should accept valid incident report inside Jodhpur settlement polygon', () => {
      const res = validateIncidentInput({
        category: 'ROAD_ACCIDENT',
        severity: '3',
        victimCount: '2',
        description: 'Multi-vehicle collision with minor injuries.',
        latitude: '26.2918',
        longitude: '73.0168'
      });
      assert.equal(res.isValid, true);
      assert.deepEqual(res.errors, {});
    });

    it('should reject submission when coordinates fall outside the supported polygon', () => {
      // Mandore is outside polygon
      const res = validateIncidentInput({
        category: 'FIRE',
        severity: '4',
        victimCount: '0',
        description: 'Test fire report',
        latitude: '26.3550',
        longitude: '73.0400'
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.location);
      assert.ok(res.errors.latitude);
    });

    it('should reject submission when coordinates are inside bounding box but outside polygon', () => {
      // Coordinate inside BBox but outside authentic polygon
      const res = validateIncidentInput({
        category: 'FIRE',
        severity: '4',
        victimCount: '0',
        description: 'Test outside polygon',
        latitude: '26.3400',
        longitude: '72.9600'
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.location);
    });

    it('should reject invalid emergency categories', () => {
      const res = validateIncidentInput({
        category: 'INVALID_CATEGORY_NAME',
        severity: '3',
        victimCount: '0',
        description: 'Test',
        latitude: '26.2918',
        longitude: '73.0168'
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.category);
    });

    it('should reject out-of-range severity values (< 1, > 5, or float)', () => {
      assert.equal(validateIncidentInput({ category: 'FIRE', severity: '0', victimCount: '0', description: 'Test', latitude: '26.29', longitude: '73.01' }).isValid, false);
      assert.equal(validateIncidentInput({ category: 'FIRE', severity: '6', victimCount: '0', description: 'Test', latitude: '26.29', longitude: '73.01' }).isValid, false);
      assert.equal(validateIncidentInput({ category: 'FIRE', severity: '3.5', victimCount: '0', description: 'Test', latitude: '26.29', longitude: '73.01' }).isValid, false);
      assert.equal(validateIncidentInput({ category: 'FIRE', severity: 'NaN', victimCount: '0', description: 'Test', latitude: '26.29', longitude: '73.01' }).isValid, false);
    });

    it('should reject negative casualties', () => {
      const res = validateIncidentInput({
        category: 'FIRE',
        severity: '4',
        victimCount: '-1',
        description: 'Test',
        latitude: '26.2918',
        longitude: '73.0168'
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.victimCount);
    });

    it('should reject descriptions exceeding 1000 characters', () => {
      const longDesc = 'A'.repeat(1001);
      const res = validateIncidentInput({
        category: 'FIRE',
        severity: '4',
        victimCount: '0',
        description: longDesc,
        latitude: '26.2918',
        longitude: '73.0168'
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.description);
    });

    it('should reject invalid coordinates (non-numeric or out-of-range)', () => {
      assert.equal(validateIncidentInput({ category: 'FIRE', severity: '4', victimCount: '0', description: 'Test', latitude: '95.0', longitude: '73.01' }).isValid, false);
      assert.equal(validateIncidentInput({ category: 'FIRE', severity: '4', victimCount: '0', description: 'Test', latitude: '-95.0', longitude: '73.01' }).isValid, false);
      assert.equal(validateIncidentInput({ category: 'FIRE', severity: '4', victimCount: '0', description: 'Test', latitude: '26.29', longitude: '190.0' }).isValid, false);
      assert.equal(validateIncidentInput({ category: 'FIRE', severity: '4', victimCount: '0', description: 'Test', latitude: '26.29', longitude: '-190.0' }).isValid, false);
      assert.equal(validateIncidentInput({ category: 'FIRE', severity: '4', victimCount: '0', description: 'Test', latitude: 'abc', longitude: '73.01' }).isValid, false);
    });
  });

  // =========================================================================
  // 3. Exact Jodhpur Polygon Validation Tests (Remediation Item 1)
  // =========================================================================
  describe('3. Exact Jodhpur Polygon Validation', () => {
    it('Test 1: Clock Tower [26.2978, 73.0185] should be INSIDE polygon', () => {
      const inside = isInsideJodhpurPolygon(26.2978, 73.0185);
      assert.equal(inside, true, 'Expected Clock Tower (Ghanta Ghar) to be inside the authentic polygon');
    });

    it('Test 2: Mandore [26.3550, 73.0400] should be OUTSIDE polygon (negative control)', () => {
      const inside = isInsideJodhpurPolygon(26.3550, 73.0400);
      assert.equal(inside, false, 'Expected Mandore to be outside the academic proxy settlement polygon');
    });

    it('Test 3: Point inside bounding box but OUTSIDE actual polygon should be evaluated as OUTSIDE', () => {
      // Coordinate: 26.3400 N, 72.9600 E
      // Bounding box range: Lat [26.2059842, 26.3536661], Lng [72.9485753, 73.0888716]
      const lat = 26.3400;
      const lng = 72.9600;

      // 1. Verify it is inside the fast preliminary bounding box
      const inBbox = isWithinJodhpurBoundingBox(lat, lng);
      assert.equal(inBbox, true, 'Test point must fall within bounding box to serve as discriminant');

      // 2. Verify exact ray-casting rejects it as outside the authentic polygon
      const inPolygon = isInsideJodhpurPolygon(lat, lng);
      assert.equal(inPolygon, false, 'Expected point inside bounding box but outside polygon vertices to be OUTSIDE');

      // Test a second discriminant point in the South-East corner: [26.2100, 73.0800]
      assert.equal(isWithinJodhpurBoundingBox(26.2100, 73.0800), true);
      assert.equal(isInsideJodhpurPolygon(26.2100, 73.0800), false);
    });

    it('Test 4: Valid points near the polygon interior should be evaluated as INSIDE', () => {
      // AIIMS Jodhpur Area
      assert.equal(isInsideJodhpurPolygon(26.2550, 73.0050), true, 'AIIMS area must be INSIDE polygon');
      // MDM Hospital Area
      assert.equal(isInsideJodhpurPolygon(26.2800, 73.0200), true, 'MDM Hospital area must be INSIDE polygon');
      // Jodhpur Urban Center
      assert.equal(isInsideJodhpurPolygon(JODHPUR_COORDINATES.center[0], JODHPUR_COORDINATES.center[1]), true);
      // Ratanada District
      assert.equal(isInsideJodhpurPolygon(26.2750, 73.0300), true, 'Ratanada district must be INSIDE polygon');
    });

    it('Test 5: Invalid coordinate values should be safely rejected', () => {
      assert.equal(isInsideJodhpurPolygon(NaN, 73.0185), false);
      assert.equal(isInsideJodhpurPolygon(26.2978, NaN), false);
      assert.equal(isInsideJodhpurPolygon(Infinity, 73.0185), false);
      assert.equal(isInsideJodhpurPolygon(26.2978, -Infinity), false);
      assert.equal(isInsideJodhpurPolygon(null, 73.0185), false);
      assert.equal(isInsideJodhpurPolygon(26.2978, undefined), false);
      assert.equal(isInsideJodhpurPolygon(95.0, 73.0185), false); // Latitude > 90
      assert.equal(isInsideJodhpurPolygon(-95.0, 73.0185), false); // Latitude < -90
      assert.equal(isInsideJodhpurPolygon(26.2978, 190.0), false); // Longitude > 180
      assert.equal(isInsideJodhpurPolygon(26.2978, -190.0), false); // Longitude < -180
    });

    it('should support multi-ring polygons with holes and MultiPolygon structures', () => {
      // Synthetic polygon with an exterior square and an interior square hole
      // Exterior: [0,0] to [10,10]
      // Hole: [4,4] to [6,6]
      const syntheticPolygonWithHole = [
        // Exterior ring (counter-clockwise or clockwise closed)
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        // Interior hole
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
      ];

      // Point inside exterior ring but outside hole: [2, 2] -> INSIDE
      assert.equal(isPointInPolygonWithHoles(2, 2, syntheticPolygonWithHole), true);

      // Point inside the hole: [5, 5] -> OUTSIDE
      assert.equal(isPointInPolygonWithHoles(5, 5, syntheticPolygonWithHole), false);

      // Point completely outside: [12, 12] -> OUTSIDE
      assert.equal(isPointInPolygonWithHoles(12, 12, syntheticPolygonWithHole), false);

      // Test extractPolygonCoordinates handles MultiPolygon FeatureCollection
      const syntheticMultiPolyGeoJSON = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
                [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]]
              ]
            }
          }
        ]
      };

      const extracted = extractPolygonCoordinates(syntheticMultiPolyGeoJSON);
      assert.equal(extracted.length, 2);
    });
  });

  // =========================================================================
  // 4. API Error Handling & Rejection Scenarios
  // =========================================================================
  describe('4. Error Handling & Backend Rejection Scenarios', () => {
    it('should normalize and convey OUTSIDE_SERVICE_AREA rejection code', async () => {
      const origPost = apiClient.post;
      try {
        apiClient.post = async () => {
          const err = new Error('Incident location falls outside the Jodhpur Urban Service Area boundary');
          err.status = 400;
          err.code = 'OUTSIDE_SERVICE_AREA';
          err.details = { coordinates: { latitude: 26.355, longitude: 73.04 } };
          throw err;
        };

        await assert.rejects(
          async () => {
            await incidentService.createIncident({
              category: 'FIRE',
              severity: 4,
              victimCount: 0,
              description: 'Out of area test',
              location: { latitude: 26.355, longitude: 73.04 }
            });
          },
          (err) => {
            assert.equal(err.status, 400);
            assert.equal(err.code, 'OUTSIDE_SERVICE_AREA');
            return true;
          }
        );
      } finally {
        apiClient.post = origPost;
      }
    });

    it('should handle DATABASE_UNAVAILABLE 503 error', async () => {
      const origPost = apiClient.post;
      try {
        apiClient.post = async () => {
          const err = new Error('Database is disconnected');
          err.status = 503;
          err.code = 'DATABASE_UNAVAILABLE';
          throw err;
        };

        await assert.rejects(
          async () => {
            await incidentService.createIncident({
              category: 'FIRE',
              severity: 4,
              victimCount: 0,
              description: 'DB offline test',
              location: { latitude: 26.2978, longitude: 73.0185 }
            });
          },
          (err) => {
            assert.equal(err.status, 503);
            assert.equal(err.code, 'DATABASE_UNAVAILABLE');
            return true;
          }
        );
      } finally {
        apiClient.post = origPost;
      }
    });

    it('should handle 404 INCIDENT_NOT_FOUND when fetching details', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async () => {
          const err = new Error('Incident with ID 999999999 not found');
          err.status = 404;
          err.code = 'INCIDENT_NOT_FOUND';
          throw err;
        };

        await assert.rejects(
          async () => {
            await incidentService.getIncidentById(999999999);
          },
          (err) => {
            assert.equal(err.status, 404);
            assert.equal(err.code, 'INCIDENT_NOT_FOUND');
            return true;
          }
        );
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should handle 403 FORBIDDEN when citizen attempts to view an unowned report', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async () => {
          const err = new Error('Forbidden. You do not have permission to view this incident.');
          err.status = 403;
          err.code = 'FORBIDDEN';
          throw err;
        };

        await assert.rejects(
          async () => {
            await incidentService.getIncidentById(1731895000999);
          },
          (err) => {
            assert.equal(err.status, 403);
            assert.equal(err.code, 'FORBIDDEN');
            return true;
          }
        );
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  // =========================================================================
  // 5. Incident Progression Timeline (Remediation Item 3)
  // =========================================================================
  describe('5. Incident Progression Timeline (6-Stage Lifecycle & Alternatives)', () => {
    it('should declare the exact 6-stage lifecycle order', () => {
      assert.deepEqual(PROGRESSION_STAGES, [
        'REPORTED',
        'VERIFIED',
        'ALLOCATED',
        'DISPATCHED',
        'ON_SCENE',
        'RESOLVED',
      ]);
    });

    it('should accurately calculate completed, current, and pending stages for every normal lifecycle status', () => {
      function evaluateStages(currentStatus) {
        const activeIndex = PROGRESSION_STAGES.indexOf(currentStatus);
        return PROGRESSION_STAGES.map((stage, idx) => ({
          stage,
          isCompleted: activeIndex > idx,
          isCurrent: activeIndex === idx,
          isPending: activeIndex < idx,
        }));
      }

      // Stage 1: REPORTED
      const reportedStages = evaluateStages('REPORTED');
      assert.equal(reportedStages[0].isCurrent, true);
      assert.equal(reportedStages[0].isCompleted, false);
      for (let i = 1; i < 6; i++) {
        assert.equal(reportedStages[i].isCompleted, false, `Future stage ${reportedStages[i].stage} must NOT be completed`);
        assert.equal(reportedStages[i].isPending, true);
      }

      // Stage 2: VERIFIED
      const verifiedStages = evaluateStages('VERIFIED');
      assert.equal(verifiedStages[0].isCompleted, true);
      assert.equal(verifiedStages[1].isCurrent, true);
      for (let i = 2; i < 6; i++) {
        assert.equal(verifiedStages[i].isCompleted, false);
        assert.equal(verifiedStages[i].isPending, true);
      }

      // Stage 3: ALLOCATED (Verified included per prompt)
      const allocatedStages = evaluateStages('ALLOCATED');
      assert.equal(allocatedStages[0].isCompleted, true);
      assert.equal(allocatedStages[1].isCompleted, true);
      assert.equal(allocatedStages[2].isCurrent, true);
      assert.equal(allocatedStages[3].isCompleted, false);
      assert.equal(allocatedStages[4].isCompleted, false);
      assert.equal(allocatedStages[5].isCompleted, false);

      // Stage 4: DISPATCHED
      const dispatchedStages = evaluateStages('DISPATCHED');
      assert.equal(dispatchedStages[0].isCompleted, true);
      assert.equal(dispatchedStages[1].isCompleted, true);
      assert.equal(dispatchedStages[2].isCompleted, true);
      assert.equal(dispatchedStages[3].isCurrent, true);
      assert.equal(dispatchedStages[4].isCompleted, false);
      assert.equal(dispatchedStages[5].isCompleted, false);

      // Stage 5: ON_SCENE
      const onSceneStages = evaluateStages('ON_SCENE');
      assert.equal(onSceneStages[3].isCompleted, true);
      assert.equal(onSceneStages[4].isCurrent, true);
      assert.equal(onSceneStages[5].isCompleted, false);
      assert.equal(onSceneStages[5].isPending, true);

      // Stage 6: RESOLVED
      const resolvedStages = evaluateStages('RESOLVED');
      for (let i = 0; i < 5; i++) {
        assert.equal(resolvedStages[i].isCompleted, true);
      }
      assert.equal(resolvedStages[5].isCurrent, true);
    });

    it('should identify REJECTED and CANCELLED as terminal alternatives', () => {
      const isTerminalAlternative = (status) => ['REJECTED', 'CANCELLED'].includes(status);

      assert.equal(isTerminalAlternative('REJECTED'), true);
      assert.equal(isTerminalAlternative('CANCELLED'), true);
      assert.equal(isTerminalAlternative('REPORTED'), false);
      assert.equal(isTerminalAlternative('DISPATCHED'), false);
      assert.equal(isTerminalAlternative('RESOLVED'), false);
    });

    it('should extract genuine timestamps and NEVER fabricate dates for missing timestamps', () => {
      const incidentWithMissingTimestamps = {
        incidentId: 101,
        status: 'VERIFIED',
        reportedAt: '2026-11-18T02:00:00.000Z',
        verifiedAt: null, // missing
        allocatedAt: undefined, // missing
        dispatchedAt: null,
        arrivedAt: null,
        resolvedAt: null,
        statusHistory: [
          { status: 'REPORTED', timestamp: '2026-11-18T02:00:00.000Z' }
        ]
      };

      // REPORTED has genuine timestamp
      assert.equal(getStageTimestamp(incidentWithMissingTimestamps, 'REPORTED'), '2026-11-18T02:00:00.000Z');

      // VERIFIED timestamp is missing - must return null (NEVER fabricated)
      assert.equal(getStageTimestamp(incidentWithMissingTimestamps, 'VERIFIED'), null);

      // ALLOCATED timestamp is missing - must return null
      assert.equal(getStageTimestamp(incidentWithMissingTimestamps, 'ALLOCATED'), null);

      // DISPATCHED timestamp is missing - must return null
      assert.equal(getStageTimestamp(incidentWithMissingTimestamps, 'DISPATCHED'), null);

      // REJECTED timestamp on active incident - must return null
      assert.equal(getStageTimestamp(incidentWithMissingTimestamps, 'REJECTED'), null);
    });

    it('should ensure citizen response strictly omits internal operator fields', () => {
      const citizenIncident = {
        incidentId: 1731895200001,
        category: 'FIRE',
        severity: 4,
        victimCount: 2,
        status: 'VERIFIED',
        description: 'Structure fire near Clock Tower.',
        location: { latitude: 26.2978, longitude: 73.0185 },
        reportedAt: '2026-11-18T02:00:00.000Z',
        verifiedAt: '2026-11-18T02:02:15.000Z',
        verificationNotes: 'Surveillance confirmed',
        statusHistory: [
          { status: 'REPORTED', timestamp: '2026-11-18T02:00:00.000Z' },
          { status: 'VERIFIED', timestamp: '2026-11-18T02:02:15.000Z' }
        ]
      };

      assert.equal(citizenIncident.verifiedBy, undefined);
      assert.equal(citizenIncident.dispatchedBy, undefined);
      assert.equal(citizenIncident.arrivedBy, undefined);
      assert.equal(citizenIncident.resolvedBy, undefined);
      assert.equal(citizenIncident.auditHistory, undefined);
      assert.equal(citizenIncident.assignedResourceIds, undefined);
      assert.equal(citizenIncident.assignedHospitalId, undefined);
    });
  });

  // =========================================================================
  // 6. Citizen Dashboard Metric Aggregation (Remediation Item 2)
  // =========================================================================
  describe('6. Dashboard Active Incident Counts & Status Accounting', () => {
    const ACTIVE_LIFECYCLE_STATUSES = ['REPORTED', 'VERIFIED', 'ALLOCATED', 'DISPATCHED', 'ON_SCENE'];
    const TERMINAL_STATUSES = ['RESOLVED', 'REJECTED', 'CANCELLED'];

    function countDashboardMetrics(incidents, pagination = null) {
      const totalReports = pagination ? pagination.totalCount : incidents.length;
      const activeEmergencies = incidents.filter(
        (inc) =>
          inc &&
          inc.status &&
          ACTIVE_LIFECYCLE_STATUSES.includes(inc.status) &&
          !TERMINAL_STATUSES.includes(inc.status)
      ).length;
      const resolved = incidents.filter((inc) => inc && inc.status === 'RESOLVED').length;

      return { totalReports, activeEmergencies, resolved };
    }

    it('should count every applicable non-terminal status including ALLOCATED', () => {
      const activeStatuses = ['REPORTED', 'VERIFIED', 'ALLOCATED', 'DISPATCHED', 'ON_SCENE'];

      for (const status of activeStatuses) {
        const metrics = countDashboardMetrics([{ incidentId: 1, status }]);
        assert.equal(
          metrics.activeEmergencies,
          1,
          `Expected status '${status}' to be counted as active emergency`
        );
        assert.equal(metrics.resolved, 0);
        assert.equal(metrics.totalReports, 1);
      }
    });

    it('should strictly exclude terminal statuses: RESOLVED, REJECTED, CANCELLED from active count', () => {
      // RESOLVED
      const resMetrics = countDashboardMetrics([{ incidentId: 1, status: 'RESOLVED' }]);
      assert.equal(resMetrics.activeEmergencies, 0, 'RESOLVED must not be counted in active emergencies');
      assert.equal(resMetrics.resolved, 1, 'RESOLVED must be counted in resolved count');

      // REJECTED
      const rejMetrics = countDashboardMetrics([{ incidentId: 2, status: 'REJECTED' }]);
      assert.equal(rejMetrics.activeEmergencies, 0, 'REJECTED must not be counted in active emergencies');
      assert.equal(rejMetrics.resolved, 0, 'REJECTED must not be counted in resolved');

      // CANCELLED
      const canMetrics = countDashboardMetrics([{ incidentId: 3, status: 'CANCELLED' }]);
      assert.equal(canMetrics.activeEmergencies, 0, 'CANCELLED must not be counted in active emergencies');
      assert.equal(canMetrics.resolved, 0, 'CANCELLED must not be counted in resolved');
    });

    it('should correctly aggregate mixed batch across all 9 schema statuses', () => {
      const mixedIncidents = [
        { incidentId: 1, status: 'REPORTED' },    // active (1)
        { incidentId: 2, status: 'VERIFIED' },    // active (2)
        { incidentId: 3, status: 'ALLOCATED' },   // active (3)
        { incidentId: 4, status: 'DISPATCHED' },  // active (4)
        { incidentId: 5, status: 'ON_SCENE' },    // active (5)
        { incidentId: 6, status: 'RESOLVED' },    // terminal resolved (1)
        { incidentId: 7, status: 'RESOLVED' },    // terminal resolved (2)
        { incidentId: 8, status: 'REJECTED' },    // terminal excluded
        { incidentId: 9, status: 'CANCELLED' }    // terminal excluded
      ];

      const metrics = countDashboardMetrics(mixedIncidents, { totalCount: 9 });
      assert.equal(metrics.totalReports, 9);
      assert.equal(metrics.activeEmergencies, 5); // REPORTED, VERIFIED, ALLOCATED, DISPATCHED, ON_SCENE
      assert.equal(metrics.resolved, 2);          // 2 RESOLVED
    });

    it('should handle empty incidents array cleanly', () => {
      const metrics = countDashboardMetrics([], { totalCount: 0 });
      assert.equal(metrics.totalReports, 0);
      assert.equal(metrics.activeEmergencies, 0);
      assert.equal(metrics.resolved, 0);
    });
  });
});
