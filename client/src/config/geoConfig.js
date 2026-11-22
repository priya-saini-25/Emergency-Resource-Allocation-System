/**
 * Canonical Geographic Configuration for Jodhpur Urban Service Area
 *
 * Boundary classification: Academic urban settlement proxy (OSM Way 31725312).
 * NOT an officially notified Jodhpur Municipal Corporation boundary.
 */

import { JODHPUR_BOUNDARY_GEOJSON } from './jodhpurBoundaryData.js';

export const JODHPUR_COORDINATES = {
  center: [26.2918, 73.0168], // [Latitude, Longitude]
  defaultZoom: 13,
  minZoom: 11,
  maxZoom: 18,
};

export const OSM_TILE_LAYER = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

export const JODHPUR_BOUNDING_BOX = {
  minLng: 72.9485753,
  minLat: 26.2059842,
  maxLng: 73.0888716,
  maxLat: 26.3536661,
};

/**
 * Rapid client-side bounding box pre-check.
 * Note: Used as an optional fast preliminary filter, NOT the final geographic decision.
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean}
 */
export function isWithinJodhpurBoundingBox(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return false;
  return (
    numLat >= JODHPUR_BOUNDING_BOX.minLat &&
    numLat <= JODHPUR_BOUNDING_BOX.maxLat &&
    numLng >= JODHPUR_BOUNDING_BOX.minLng &&
    numLng <= JODHPUR_BOUNDING_BOX.maxLng
  );
}

/**
 * Standard ray-casting point-in-polygon algorithm on a closed linear ring of [lng, lat] coordinates.
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {Array<[number, number]>} ring - Array of [longitude, latitude] coordinates
 * @returns {boolean} True if point is inside ring
 */
export function pointInLinearRing(lat, lng, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0]; // longitude
    const yi = ring[i][1]; // latitude
    const xj = ring[j][0];
    const yj = ring[j][1];

    if ((yi > lat) !== (yj > lat)) {
      const xinters = ((lat - yi) * (xj - xi)) / (yj - yi) + xi;
      if (lng <= xinters) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Extracts polygon coordinate definitions from any GeoJSON structure:
 * FeatureCollection, Feature, Polygon, or MultiPolygon.
 *
 * Each polygon is represented as an array of rings: [outerRing, hole1, hole2, ...]
 * where each ring is an array of [lng, lat] coordinate pairs.
 *
 * @param {object} geojson
 * @returns {Array<Array<Array<[number, number]>>>} Array of polygons
 */
export function extractPolygonCoordinates(geojson) {
  if (!geojson) return [];

  const polygons = [];

  const handleGeometry = (geom) => {
    if (!geom || !geom.type) return;
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
      polygons.push(geom.coordinates);
    } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      for (const poly of geom.coordinates) {
        if (Array.isArray(poly)) {
          polygons.push(poly);
        }
      }
    }
  };

  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    for (const feature of geojson.features) {
      if (feature && feature.geometry) {
        handleGeometry(feature.geometry);
      }
    }
  } else if (geojson.type === 'Feature' && geojson.geometry) {
    handleGeometry(geojson.geometry);
  } else if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
    handleGeometry(geojson);
  }

  return polygons;
}

/**
 * Evaluates whether a point is inside a polygon with possible interior holes.
 * Point must be strictly inside the exterior ring and outside all interior rings (holes).
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {Array<Array<[number, number]>>} rings - [outerRing, hole1, hole2, ...]
 * @returns {boolean}
 */
export function isPointInPolygonWithHoles(lat, lng, rings) {
  if (!rings || rings.length === 0) return false;
  // 1. Must be inside exterior ring
  if (!pointInLinearRing(lat, lng, rings[0])) {
    return false;
  }
  // 2. Must NOT be inside any interior ring (hole)
  for (let h = 1; h < rings.length; h++) {
    if (pointInLinearRing(lat, lng, rings[h])) {
      return false;
    }
  }
  return true;
}

/**
 * Exact client-side point-in-polygon validation against the authentic
 * Jodhpur Urban Service Area boundary geometry (OSM Way 31725312 academic proxy).
 *
 * Evaluates fast preliminary bounding box first, then performs exact ray-casting.
 * Clearly designated as early client-side validation; backend ray-casting is authoritative.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {object} [boundaryGeoJson=JODHPUR_BOUNDARY_GEOJSON] - Optional custom GeoJSON boundary
 * @returns {boolean} True if inside the service boundary polygon, false otherwise.
 */
export function isInsideJodhpurPolygon(lat, lng, boundaryGeoJson = JODHPUR_BOUNDARY_GEOJSON) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return false;
  if (numLat < -90 || numLat > 90 || numLng < -180 || numLng > 180) return false;

  // Fast preliminary bounding box acceleration
  if (!isWithinJodhpurBoundingBox(numLat, numLng)) {
    return false;
  }

  // Exact ray-casting against all polygon geometries in the canonical GeoJSON
  const polygons = extractPolygonCoordinates(boundaryGeoJson);
  for (const poly of polygons) {
    if (isPointInPolygonWithHoles(numLat, numLng, poly)) {
      return true;
    }
  }
  return false;
}

export { JODHPUR_BOUNDARY_GEOJSON };

export default {
  JODHPUR_COORDINATES,
  OSM_TILE_LAYER,
  JODHPUR_BOUNDING_BOX,
  JODHPUR_BOUNDARY_GEOJSON,
  isWithinJodhpurBoundingBox,
  pointInLinearRing,
  extractPolygonCoordinates,
  isPointInPolygonWithHoles,
  isInsideJodhpurPolygon,
};
