import test from 'node:test';
import assert from 'node:assert/strict';
import geocodingService, {
  normalizeQuery,
  clearGeocodeCache,
  getGeocodeCacheStats,
  setMockFetcher,
  scheduleOutboundRequest
} from '../src/services/geocodingService.js';
import { app } from '../src/app.js';
import Incident from '../src/models/Incident.js';

function createMockHttp(method, url, query = {}) {
  const parsedUrl = new URL(url, 'http://localhost');
  const req = {
    method,
    url,
    originalUrl: url,
    headers: {
      'content-type': 'application/json'
    },
    query,
    params: {},
    body: {}
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

test('Phase 7 — Citizen Location Search & Geocoding Unit & Integration Tests', async (t) => {
  t.beforeEach(() => {
    clearGeocodeCache();
    setMockFetcher(null);
  });

  t.afterEach(() => {
    clearGeocodeCache();
    setMockFetcher(null);
  });

  await t.test('1. Query Normalization & Input Sanitization', () => {
    assert.equal(normalizeQuery('   Sojati   Gate, Jodhpur!  '), 'sojati gate, jodhpur');
    assert.equal(normalizeQuery('AIIMS @#$ Jodhpur'), 'aiims jodhpur');
    assert.equal(normalizeQuery(''), '');
    assert.equal(normalizeQuery(null), '');
    assert.equal(normalizeQuery(123), '');
  });

  await t.test('2. Known Landmark Seed Lookup (Sub-millisecond resolution)', async () => {
    const results = await geocodingService.searchPlaces('sojati gate');
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1);

    const match = results[0];
    assert.equal(match.name, 'Sojati Gate');
    assert.ok(match.displayName.includes('Jodhpur'));
    assert.equal(typeof match.latitude, 'number');
    assert.equal(typeof match.longitude, 'number');
    assert.equal(match.isInsideServiceArea, true);
  });

  await t.test('3. Repeated-Query Caching (Zero external calls for duplicate queries)', async () => {
    let mockCalls = 0;
    setMockFetcher(async (q) => {
      mockCalls++;
      return [
        {
          place_id: 101,
          name: 'Custom Test Location',
          display_name: 'Custom Test Location, Jodhpur, Rajasthan',
          lat: '26.2900',
          lon: '73.0200',
          class: 'amenity',
          type: 'police'
        }
      ];
    });

    const res1 = await geocodingService.searchPlaces('custom test query');
    assert.equal(mockCalls, 1);
    assert.equal(res1.length, 1);

    // Second call with same query should hit cache
    const res2 = await geocodingService.searchPlaces('custom test query');
    assert.equal(mockCalls, 1, 'Mock fetcher should not be called again for cached query');
    assert.equal(res2.length, 1);
    assert.equal(res2[0].name, 'Custom Test Location');

    // Case-insensitive query should also hit cache
    const res3 = await geocodingService.searchPlaces('CUSTOM TEST QUERY');
    assert.equal(mockCalls, 1, 'Normalized uppercase query should hit cache');
    assert.equal(res3.length, 1);
  });

  await t.test('4. Service Area Polygon Filtering (Inside vs Outside boundary)', async () => {
    setMockFetcher(async () => [
      {
        place_id: 201,
        name: 'Mandore Garden (Outside Boundary)',
        display_name: 'Mandore Garden, Jodhpur, Rajasthan, India',
        lat: '26.3550',
        lon: '73.0400',
        class: 'tourism',
        type: 'attraction'
      },
      {
        place_id: 202,
        name: 'Clock Tower (Inside Boundary)',
        display_name: 'Clock Tower, Jodhpur, Rajasthan, India',
        lat: '26.2978',
        lon: '73.0185',
        class: 'historic',
        type: 'monument'
      }
    ]);

    const results = await geocodingService.searchPlaces('jodhpur attractions');
    assert.equal(results.length, 2);

    // Results inside service area should be prioritized first
    assert.equal(results[0].name, 'Clock Tower (Inside Boundary)');
    assert.equal(results[0].isInsideServiceArea, true);

    assert.equal(results[1].name, 'Mandore Garden (Outside Boundary)');
    assert.equal(results[1].isInsideServiceArea, false);
  });

  await t.test('5. Outbound Rate Limiting & Error Handling on Provider Failure', async () => {
    setMockFetcher(async () => {
      throw new Error('Nominatim 503 Service Unavailable');
    });

    // Should not throw unhandled exception, but return empty array safely
    const results = await geocodingService.searchPlaces('unknown remote place');
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 0);
  });

  await t.test('6. Location Controller GET /api/location/search Validation', async () => {
    // Missing query
    {
      const { req, res, waitForResponse } = createMockHttp('GET', '/api/location/search', {});
      app.handle(req, res);
      const resp = await waitForResponse();
      assert.equal(resp.statusCode, 400);
      assert.equal(resp.body.error.code, 'INVALID_QUERY');
    }

    // Short query (< 2 chars)
    {
      const { req, res, waitForResponse } = createMockHttp('GET', '/api/location/search?q=a', { q: 'a' });
      app.handle(req, res);
      const resp = await waitForResponse();
      assert.equal(resp.statusCode, 400);
      assert.equal(resp.body.error.code, 'INVALID_QUERY');
    }

    // Long query (> 100 chars)
    {
      const longQ = 'a'.repeat(101);
      const { req, res, waitForResponse } = createMockHttp('GET', `/api/location/search?q=${longQ}`, { q: longQ });
      app.handle(req, res);
      const resp = await waitForResponse();
      assert.equal(resp.statusCode, 400);
      assert.equal(resp.body.error.code, 'QUERY_TOO_LONG');
    }

    // Valid query
    {
      const { req, res, waitForResponse } = createMockHttp('GET', '/api/location/search?q=AIIMS', { q: 'AIIMS' });
      app.handle(req, res);
      const resp = await waitForResponse();
      assert.equal(resp.statusCode, 200);
      assert.equal(resp.body.success, true);
      assert.ok(Array.isArray(resp.body.data.results));
      assert.ok(resp.body.data.results.length >= 1);
      assert.equal(resp.body.data.results[0].name, 'AIIMS Jodhpur');
    }
  });

  await t.test('7. Incident Schema Compatibility with optional locationName', () => {
    const inc = new Incident({
      incidentId: 99912345,
      category: 'MEDICAL',
      severity: 3,
      victimCount: 1,
      latitude: 26.2906,
      longitude: 73.0232,
      locationName: 'Sojati Gate, Jodhpur'
    });

    assert.equal(inc.locationName, 'Sojati Gate, Jodhpur');
    assert.equal(inc.location.locationName, 'Sojati Gate, Jodhpur');
    assert.equal(inc.location.latitude, 26.2906);
    assert.equal(inc.location.longitude, 73.0232);

    // Verify toEngineProtocol preserves verbatim numeric coordinates and C++ JSON protocol
    const engineProto = inc.toEngineProtocol();
    assert.equal(engineProto.incident_id, 99912345);
    assert.equal(engineProto.category, 'MEDICAL');
    assert.equal(engineProto.latitude, 26.2906);
    assert.equal(engineProto.longitude, 73.0232);
    assert.equal(engineProto.locationName, undefined, 'C++ protocol must not include locationName');
  });

  await t.test('8. Concurrent Outbound Request Serialization & Minimum Interval', async () => {
    const timestamps = [];
    const p1 = scheduleOutboundRequest(async () => {
      timestamps.push(Date.now());
      return 'task1';
    });
    const p2 = scheduleOutboundRequest(async () => {
      timestamps.push(Date.now());
      return 'task2';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, 'task1');
    assert.equal(r2, 'task2');
    assert.equal(timestamps.length, 2);
    const interval = timestamps[1] - timestamps[0];
    assert.ok(
      interval >= 1000,
      `Interval between outbound calls (${interval}ms) must be >= 1000ms for Nominatim compliance`
    );
  });
});
