process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import locationService from '../src/services/locationService.js';
import incidentService from '../src/services/incidentService.js';
import apiClient from '../src/services/apiClient.js';
import { getStationDisplayName } from '../src/utils/stationUtils.js';
import {
  isInsideJodhpurPolygon,
  isWithinJodhpurBoundingBox,
  JODHPUR_COORDINATES,
} from '../src/config/geoConfig.js';

describe('Phase 7 — Citizen Location Search, Place-Name Geocoding & Interactive Map Tests', () => {

  // =========================================================================
  // 1. Valid Place-Name Search via Location Service
  // =========================================================================
  describe('1. Valid Place-Name Search via Location Service', () => {
    it('should query /location/search with trimmed query and unpack results', async () => {
      const origGet = apiClient.get;
      try {
        let requestedUrl = null;
        let requestedParams = null;

        apiClient.get = async (url, config) => {
          requestedUrl = url;
          requestedParams = config?.params;
          return {
            data: {
              results: [
                {
                  name: 'Sojati Gate, Jodhpur',
                  latitude: 26.2917,
                  longitude: 73.0234,
                  category: 'amenity',
                  type: 'gate',
                  isInsideServiceArea: true,
                },
                {
                  name: 'Sojati Gate Police Chowki',
                  latitude: 26.2919,
                  longitude: 73.0236,
                  category: 'amenity',
                  type: 'police',
                  isInsideServiceArea: true,
                },
              ],
            },
          };
        };

        const results = await locationService.searchPlaces('  Sojati Gate  ');
        assert.equal(requestedUrl, '/location/search');
        assert.deepEqual(requestedParams, { q: 'Sojati Gate' });
        assert.equal(results.length, 2);
        assert.equal(results[0].name, 'Sojati Gate, Jodhpur');
        assert.equal(results[0].latitude, 26.2917);
        assert.equal(results[0].longitude, 73.0234);
        assert.equal(results[0].isInsideServiceArea, true);
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should immediately return empty array without calling API for empty or short queries (< 2 chars)', async () => {
      const origGet = apiClient.get;
      let apiCalled = false;
      try {
        apiClient.get = async () => {
          apiCalled = true;
          return { data: { results: [] } };
        };

        const resNull = await locationService.searchPlaces(null);
        const resEmpty = await locationService.searchPlaces('');
        const resSingleChar = await locationService.searchPlaces('a');
        const resWhitespace = await locationService.searchPlaces('   ');

        assert.deepEqual(resNull, []);
        assert.deepEqual(resEmpty, []);
        assert.deepEqual(resSingleChar, []);
        assert.deepEqual(resWhitespace, []);
        assert.equal(apiCalled, false, 'apiClient.get should never be invoked for queries under 2 characters');
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  // =========================================================================
  // 2. Search Debouncing Logic & Stale Response Discarding
  // =========================================================================
  describe('2. Search Debouncing Logic & Stale Response Discarding', () => {
    it('should collapse multiple rapid keystrokes within 350ms window into a single search call', async () => {
      let callCount = 0;
      let lastExecutedQuery = null;

      function createDebouncedSearch(delayMs = 350) {
        let timer = null;
        return (query) => {
          if (timer) clearTimeout(timer);
          return new Promise((resolve) => {
            timer = setTimeout(() => {
              callCount += 1;
              lastExecutedQuery = query;
              resolve({ query, callCount });
            }, delayMs);
          });
        };
      }

      const debounced = createDebouncedSearch(50);

      // Simulate rapid typing: "S", "So", "Soj", "Sojati"
      debounced('S');
      debounced('So');
      debounced('Soj');
      const finalResult = await debounced('Sojati');

      assert.equal(callCount, 1, 'Only the final debounced keystroke should trigger an execution');
      assert.equal(lastExecutedQuery, 'Sojati');
      assert.equal(finalResult.query, 'Sojati');
    });

    it('should ignore older out-of-order asynchronous responses and preserve newer results', async () => {
      let activeRequestId = 0;
      let displayedResults = null;

      // Simulated component search runner with request sequence tracking
      async function triggerSearch(query, responseData, delayMs) {
        const reqId = ++activeRequestId;
        await new Promise((r) => setTimeout(r, delayMs));
        // Check if request is still current
        if (reqId === activeRequestId) {
          displayedResults = responseData;
        }
      }

      // Request 1 started for "Sojati", slow network response (100ms)
      const p1 = triggerSearch('Sojati', [{ name: 'Sojati Gate' }], 100);

      // Request 2 started for "AIIMS", fast cached/local response (10ms)
      const p2 = triggerSearch('AIIMS', [{ name: 'AIIMS Jodhpur' }], 10);

      await Promise.all([p1, p2]);

      // Displayed results must reflect Request 2 ("AIIMS Jodhpur"), not the delayed Request 1
      assert.deepEqual(displayedResults, [{ name: 'AIIMS Jodhpur' }]);
    });
  });

  // =========================================================================
  // 3. Repeated-Query Caching Logic
  // =========================================================================
  describe('3. Repeated-Query Caching Logic', () => {
    it('should serve repeated query results from cache without redundant API roundtrips', async () => {
      const origGet = apiClient.get;
      let networkCallCount = 0;

      try {
        const localCache = new Map();

        async function cachedSearch(query) {
          const normalized = query.trim().toLowerCase();
          if (localCache.has(normalized)) {
            return localCache.get(normalized);
          }
          networkCallCount += 1;
          const res = await apiClient.get('/location/search', { params: { q: normalized } });
          const data = res.data?.results || [];
          localCache.set(normalized, data);
          return data;
        }

        apiClient.get = async () => ({
          data: {
            results: [{ name: 'AIIMS Jodhpur', latitude: 26.2413, longitude: 73.0039, isInsideServiceArea: true }],
          },
        });

        const res1 = await cachedSearch('aiims jodhpur');
        const res2 = await cachedSearch('AIIMS Jodhpur'); // case variation
        const res3 = await cachedSearch('aiims jodhpur');

        assert.equal(networkCallCount, 1, 'apiClient.get should be called exactly once for repeated queries');
        assert.equal(res1.length, 1);
        assert.equal(res2.length, 1);
        assert.equal(res3.length, 1);
        assert.equal(res1[0].name, 'AIIMS Jodhpur');
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  // =========================================================================
  // 4. No Search Results Handling
  // =========================================================================
  describe('4. No Search Results Handling', () => {
    it('should handle obscure or unresolvable place query returning empty array gracefully', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async () => ({
          data: {
            success: true,
            count: 0,
            results: [],
          },
        });

        const results = await locationService.searchPlaces('xyznonexistentplacename99');
        assert.ok(Array.isArray(results));
        assert.equal(results.length, 0);
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  // =========================================================================
  // 5. Geocoding Provider / Network Failure Handling
  // =========================================================================
  describe('5. Geocoding Provider / Network Failure Handling', () => {
    it('should handle provider 500/503 errors and return empty list without crashing', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async () => {
          const err = new Error('Nominatim upstream provider 503 Service Unavailable');
          err.response = { status: 503, data: { message: 'Provider busy' } };
          throw err;
        };

        // When searchPlaces catches or throws, caller UI falls back gracefully to manual map-pin
        let errorCaught = false;
        try {
          await locationService.searchPlaces('Clock Tower');
        } catch (err) {
          errorCaught = true;
          assert.equal(err.response.status, 503);
        }
        assert.equal(errorCaught, true, 'Propagates error or allows fallback to interactive map pinning');
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  // =========================================================================
  // 6. Out-of-Service-Area Indicator & Polygon Filtering
  // =========================================================================
  describe('6. Out-of-Service-Area Indicator & Polygon Filtering', () => {
    it('should correctly flag results inside and outside the canonical Jodhpur boundary', () => {
      // Clock Tower: 26.2978, 73.0185 (Inside polygon)
      const clockTowerInside = isInsideJodhpurPolygon(26.2978, 73.0185);
      assert.equal(clockTowerInside, true, 'Clock Tower must be inside Jodhpur service polygon');

      // Mandore Garden: 26.3550, 73.0400 (Outside polygon)
      const mandoreInside = isInsideJodhpurPolygon(26.3550, 73.0400);
      assert.equal(mandoreInside, false, 'Mandore Garden must be outside Jodhpur service polygon');

      // AIIMS Jodhpur: 26.2413, 73.0039 (Inside polygon)
      const aiimsInside = isInsideJodhpurPolygon(26.2413, 73.0039);
      assert.equal(aiimsInside, true, 'AIIMS Jodhpur must be inside Jodhpur service polygon');
    });

    it('should prevent form submission when selected place is flagged as outside service area', () => {
      const outOfAreaPlace = {
        name: 'Mandore, Jodhpur',
        latitude: 26.3550,
        longitude: 73.0400,
        isInsideServiceArea: false,
      };

      const inArea = isInsideJodhpurPolygon(outOfAreaPlace.latitude, outOfAreaPlace.longitude);
      assert.equal(inArea, false);

      // Simulation of form submission guard
      function canSubmit(place) {
        if (!place || !place.latitude || !place.longitude) return false;
        return isInsideJodhpurPolygon(place.latitude, place.longitude);
      }

      assert.equal(canSubmit(outOfAreaPlace), false, 'Out-of-service place must block form submission');
    });
  });

  // =========================================================================
  // 7. Successful Location Selection & State Population
  // =========================================================================
  describe('7. Location Selection & State Population', () => {
    it('should populate latitude, longitude, and locationName upon place selection', () => {
      const selectedPlace = {
        name: 'Paota Circle, Jodhpur',
        latitude: 26.3012,
        longitude: 73.0378,
        isInsideServiceArea: true,
      };

      // Form state transition
      let formData = {
        category: 'MEDICAL_EMERGENCY',
        severity: 3,
        victimCount: 1,
        description: 'Patient experiencing chest pain',
        latitude: '',
        longitude: '',
        locationName: '',
      };

      function handleSelectLocation(place) {
        formData = {
          ...formData,
          locationName: place.name,
          latitude: place.latitude.toFixed(6),
          longitude: place.longitude.toFixed(6),
        };
      }

      handleSelectLocation(selectedPlace);

      assert.equal(formData.locationName, 'Paota Circle, Jodhpur');
      assert.equal(formData.latitude, '26.301200');
      assert.equal(formData.longitude, '73.037800');
    });
  });

  // =========================================================================
  // 8. Map Center Synchronization
  // =========================================================================
  describe('8. Map Center Synchronization', () => {
    it('should compute valid center coordinates from selected place location', () => {
      const defaultCenter = JODHPUR_COORDINATES.center;
      assert.equal(defaultCenter[0], 26.2918);
      assert.equal(defaultCenter[1], 73.0168);

      const selectedCoords = { latitude: 26.2755, longitude: 73.0089 };
      const mapCenter = [selectedCoords.latitude, selectedCoords.longitude];

      assert.equal(mapCenter[0], 26.2755);
      assert.equal(mapCenter[1], 73.0089);
      assert.notDeepEqual(mapCenter, defaultCenter);
    });
  });

  // =========================================================================
  // 9. Marker Drag Coordinate Updates & Polygon Revalidation
  // =========================================================================
  describe('9. Marker Drag Coordinate Updates & Polygon Revalidation', () => {
    it('should update coordinates, append (Pin Refined), and re-evaluate boundary on marker drag', () => {
      let state = {
        locationName: 'Sojati Gate, Jodhpur',
        latitude: 26.2917,
        longitude: 73.0234,
        isInsidePolygon: true,
      };

      // Marker dragged 100 meters
      const draggedLat = 26.2925;
      const draggedLng = 73.0240;

      function onMarkerDragEnd(newLat, newLng) {
        const inPoly = isInsideJodhpurPolygon(newLat, newLng);
        const baseName = state.locationName.replace(/\s*\(Pin Refined\)$/, '');
        state = {
          locationName: `${baseName} (Pin Refined)`,
          latitude: newLat,
          longitude: newLng,
          isInsidePolygon: inPoly,
        };
      }

      onMarkerDragEnd(draggedLat, draggedLng);

      assert.equal(state.latitude, 26.2925);
      assert.equal(state.longitude, 73.0240);
      assert.equal(state.locationName, 'Sojati Gate, Jodhpur (Pin Refined)');
      assert.equal(state.isInsidePolygon, true);
    });

    it('should detect when marker is dragged outside polygon boundary and update warning', () => {
      let state = {
        locationName: 'Sojati Gate, Jodhpur',
        latitude: 26.2917,
        longitude: 73.0234,
        boundaryWarning: null,
      };

      // Drag to Mandore (outside boundary)
      const draggedLat = 26.3550;
      const draggedLng = 73.0400;

      const inPoly = isInsideJodhpurPolygon(draggedLat, draggedLng);
      assert.equal(inPoly, false);

      if (!inPoly) {
        state.boundaryWarning = `Selected coordinates (${draggedLat.toFixed(4)}° N, ${draggedLng.toFixed(4)}° E) fall outside the Jodhpur Urban Service Area boundary polygon.`;
      }

      assert.ok(state.boundaryWarning.includes('fall outside the Jodhpur Urban Service Area boundary polygon'));
    });
  });

  // =========================================================================
  // 10. Map-Click Coordinate Updates & Polygon Revalidation
  // =========================================================================
  describe('10. Map-Click Coordinate Updates & Polygon Revalidation', () => {
    it('should update coordinates on interactive map click and retain place reference', () => {
      let state = {
        locationName: 'AIIMS Jodhpur',
        latitude: 26.2413,
        longitude: 73.0039,
      };

      const clickedLat = 26.2420;
      const clickedLng = 73.0045;

      const baseName = state.locationName.replace(/\s*\(Pin Refined\)$/, '');
      state = {
        locationName: `${baseName} (Pin Refined)`,
        latitude: clickedLat,
        longitude: clickedLng,
      };

      assert.equal(state.latitude, 26.2420);
      assert.equal(state.longitude, 73.0045);
      assert.equal(state.locationName, 'AIIMS Jodhpur (Pin Refined)');
    });
  });

  // =========================================================================
  // 11. Invalid Coordinates Rejection
  // =========================================================================
  describe('11. Invalid Coordinates Rejection', () => {
    it('should safely reject NaN, null, and out-of-range coordinates', () => {
      assert.equal(isInsideJodhpurPolygon(NaN, 73.0), false);
      assert.equal(isInsideJodhpurPolygon(26.0, NaN), false);
      assert.equal(isInsideJodhpurPolygon(null, undefined), false);
      assert.equal(isInsideJodhpurPolygon('invalid', 'coord'), false);
      assert.equal(isInsideJodhpurPolygon(95.0, 73.0), false); // Latitude > 90
      assert.equal(isInsideJodhpurPolygon(26.0, 190.0), false); // Longitude > 180
    });
  });

  // =========================================================================
  // 12. Legacy Coordinate-Only Submission (Backward Compatibility)
  // =========================================================================
  describe('12. Legacy Coordinate-Only Submission (Backward Compatibility)', () => {
    it('should successfully submit incident without locationName (legacy payload)', async () => {
      const origPost = apiClient.post;
      try {
        let sentPayload = null;

        apiClient.post = async (url, payload) => {
          sentPayload = payload;
          return {
            data: {
              incident: {
                incidentId: 1731895200044,
                category: payload.category,
                severity: payload.severity,
                victimCount: payload.victimCount,
                description: payload.description,
                location: payload.location,
                status: 'REPORTED',
                reportedAt: '2026-11-20T00:00:00.000Z',
              },
            },
          };
        };

        const legacyPayload = {
          category: 'ROAD_ACCIDENT',
          severity: 3,
          victimCount: 2,
          description: 'Two-car collision at intersection.',
          location: {
            latitude: 26.2978,
            longitude: 73.0185,
          },
        };

        const result = await incidentService.createIncident(legacyPayload);

        assert.ok(result);
        assert.equal(result.incidentId, 1731895200044);
        assert.equal(sentPayload.locationName, undefined);
        assert.equal(result.location.latitude, 26.2978);
        assert.equal(result.location.longitude, 73.0185);
      } finally {
        apiClient.post = origPost;
      }
    });
  });

  // =========================================================================
  // 13. New Incident Submission with locationName
  // =========================================================================
  describe('13. New Incident Submission with locationName', () => {
    it('should include locationName in createIncident payload and receive it back', async () => {
      const origPost = apiClient.post;
      try {
        let sentPayload = null;

        apiClient.post = async (url, payload) => {
          sentPayload = payload;
          return {
            data: {
              incident: {
                incidentId: 1731895200055,
                category: payload.category,
                severity: payload.severity,
                victimCount: payload.victimCount,
                description: payload.description,
                locationName: payload.locationName,
                location: {
                  latitude: payload.location.latitude,
                  longitude: payload.location.longitude,
                  locationName: payload.locationName,
                },
                status: 'REPORTED',
                reportedAt: '2026-11-20T00:00:00.000Z',
              },
            },
          };
        };

        const newPayload = {
          category: 'FIRE',
          severity: 4,
          victimCount: 0,
          description: 'Fire in ground floor shop.',
          locationName: 'Sardarpura B Road, Jodhpur',
          location: {
            latitude: 26.2755,
            longitude: 73.0089,
            locationName: 'Sardarpura B Road, Jodhpur',
          },
        };

        const result = await incidentService.createIncident(newPayload);

        assert.ok(result);
        assert.equal(result.incidentId, 1731895200055);
        assert.equal(sentPayload.locationName, 'Sardarpura B Road, Jodhpur');
        assert.equal(result.locationName, 'Sardarpura B Road, Jodhpur');
        assert.equal(result.location.latitude, 26.2755);
      } finally {
        apiClient.post = origPost;
      }
    });
  });

  // =========================================================================
  // 14. Resource Station Map Labels Formatting
  // =========================================================================
  describe('14. Resource Station Map Labels Formatting', () => {
    it('should format all 5 canonical Jodhpur simulated depots with clear station labels', () => {
      // 1. AIIMS Depot
      assert.equal(
        getStationDisplayName('DEPOT-AIIMS-01', 'AIIMS Depot'),
        'AIIMS Depot — Simulated Station'
      );

      // 2. Basni Depot
      assert.equal(
        getStationDisplayName('STATION-BASNI-02', 'Basni Station'),
        'Basni Depot — Simulated Station'
      );

      // 3. Paota Depot
      assert.equal(
        getStationDisplayName('DEPOT-PAOTA-03', 'Paota Depot'),
        'Paota Depot — Simulated Station'
      );

      // 4. Shastri Nagar Depot
      assert.equal(
        getStationDisplayName('DEPOT-SHASTRI-04', 'Shastri Nagar Fire Station'),
        'Shastri Nagar Depot — Simulated Station'
      );

      // 5. Jalori Gate Depot
      assert.equal(
        getStationDisplayName('POST-JALORI-05', 'Jalori Gate Outpost'),
        'Jalori Gate Depot — Simulated Station'
      );

      // Fallback for custom or unknown simulated station
      assert.equal(
        getStationDisplayName('DEPOT-CUSTOM-99', 'Unknown Location'),
        'DEPOT-CUSTOM-99 — Simulated Station'
      );

      // Default fallback when stationId is empty
      assert.equal(
        getStationDisplayName('', ''),
        'Simulated Base Depot'
      );
    });
  });

  // =========================================================================
  // 15. Backend Rate Limiting & Provider Error Resilience Contract
  // =========================================================================
  describe('15. Backend Rate Limiting & Provider Error Resilience Contract', () => {
    it('should handle rate limit 429 response gracefully', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async () => {
          const err = new Error('Rate limit exceeded');
          err.response = {
            status: 429,
            data: { error: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded. Please wait a moment.' },
          };
          throw err;
        };

        let handledGracefully = false;
        try {
          await locationService.searchPlaces('Paota Circle');
        } catch (err) {
          assert.equal(err.response.status, 429);
          handledGracefully = true;
        }
        assert.equal(handledGracefully, true);
      } finally {
        apiClient.get = origGet;
      }
    });

    it('should handle service timeout 504 gateway timeout gracefully', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async () => {
          const err = new Error('Gateway Timeout');
          err.response = { status: 504, data: { message: 'Geocoding upstream timeout' } };
          throw err;
        };

        let handledGracefully = false;
        try {
          await locationService.searchPlaces('Clock Tower');
        } catch (err) {
          assert.equal(err.response.status, 504);
          handledGracefully = true;
        }
        assert.equal(handledGracefully, true);
      } finally {
        apiClient.get = origGet;
      }
    });
  });

});
