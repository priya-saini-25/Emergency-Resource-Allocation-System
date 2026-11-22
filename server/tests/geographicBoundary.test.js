import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInsideJodhpurBoundary, getBoundaryMetadata } from '../src/services/geographicService.js';

describe('Geographic Service — Jodhpur Service Boundary Validation', () => {
  it('should successfully load boundary metadata from canonical GeoJSON', () => {
    const meta = getBoundaryMetadata();
    assert.ok(meta);
    assert.equal(typeof meta.vertexCount, 'number');
    assert.ok(meta.vertexCount >= 4, 'Must have at least 4 vertices for a closed ring');
    assert.ok(meta.boundingBox);
    assert.ok(meta.boundingBox.minLat < meta.boundingBox.maxLat);
    assert.ok(meta.boundingBox.minLng < meta.boundingBox.maxLng);
    assert.ok(meta.metadata.dataset_name.includes('Jodhpur'));
  });

  it('should accept coordinates inside the authentic Jodhpur settlement boundary', () => {
    // Known points inside the Jodhpur urban settlement boundary
    const insidePoints = [
      { name: 'Jodhpur Urban Center', lat: 26.2918, lng: 73.0168 },
      { name: 'MDM Hospital Area', lat: 26.2800, lng: 73.0200 },
      { name: 'AIIMS Jodhpur Area', lat: 26.2550, lng: 73.0050 },
      { name: 'Old City Jodhpur (Clock Tower)', lat: 26.2970, lng: 73.0240 },
      { name: 'Ratanada District', lat: 26.2750, lng: 73.0300 }
    ];

    for (const pt of insidePoints) {
      const inside = isInsideJodhpurBoundary(pt.lat, pt.lng);
      assert.equal(inside, true, `Expected point '${pt.name}' (${pt.lat}, ${pt.lng}) to be INSIDE boundary`);
    }
  });

  it('should reject coordinates outside the Jodhpur settlement boundary', () => {
    const outsidePoints = [
      { name: 'Jaipur Proxy Location', lat: 26.9124, lng: 75.7873 },
      { name: 'Bikaner Proxy Location', lat: 28.0229, lng: 73.3119 },
      { name: 'New Delhi Proxy Location', lat: 28.6139, lng: 77.2090 },
      { name: 'Western Thar Desert Area', lat: 26.2918, lng: 72.5000 },
      { name: 'Eastern Outskirts beyond Boundary', lat: 26.2918, lng: 73.2000 },
      { name: 'Far South Outskirts', lat: 26.1000, lng: 73.0168 },
      { name: 'Far North Outskirts', lat: 26.4500, lng: 73.0168 }
    ];

    for (const pt of outsidePoints) {
      const inside = isInsideJodhpurBoundary(pt.lat, pt.lng);
      assert.equal(inside, false, `Expected point '${pt.name}' (${pt.lat}, ${pt.lng}) to be OUTSIDE boundary`);
    }
  });

  it('should safely reject non-finite or out-of-range coordinates', () => {
    assert.equal(isInsideJodhpurBoundary(NaN, 73.0168), false);
    assert.equal(isInsideJodhpurBoundary(26.2918, NaN), false);
    assert.equal(isInsideJodhpurBoundary(Infinity, 73.0168), false);
    assert.equal(isInsideJodhpurBoundary(26.2918, -Infinity), false);
    assert.equal(isInsideJodhpurBoundary(95.0, 73.0168), false); // Latitude > 90
    assert.equal(isInsideJodhpurBoundary(-95.0, 73.0168), false); // Latitude < -90
    assert.equal(isInsideJodhpurBoundary(26.2918, 190.0), false); // Longitude > 180
    assert.equal(isInsideJodhpurBoundary(26.2918, -190.0), false); // Longitude < -180
  });
});

