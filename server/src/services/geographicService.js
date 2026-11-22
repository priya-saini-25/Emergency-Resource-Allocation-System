import fs from 'fs';
import { env } from '../config/env.js';

let boundaryData = null;
let linearRing = []; // Array of { lat, lng }
let bbox = {
  minLat: 90.0,
  maxLat: -90.0,
  minLng: 180.0,
  maxLng: -180.0
};
let metadata = null;

/**
 * Loads and parses the canonical Jodhpur boundary GeoJSON.
 */
function loadBoundary() {
  if (boundaryData) return;

  const boundaryPath = env.JODHPUR_BOUNDARY_PATH;
  if (!fs.existsSync(boundaryPath)) {
    throw new Error(`[GEO_SERVICE_ERROR] Canonical Jodhpur boundary file not found at: ${boundaryPath}`);
  }

  const raw = fs.readFileSync(boundaryPath, 'utf8');
  boundaryData = JSON.parse(raw);

  // Extract metadata
  metadata = boundaryData.metadata || {
    dataset_name: 'Jodhpur Urban Service Area Boundary',
    classification: 'Academic urban settlement proxy (Way 31725312)',
    official_status: 'Academic proxy (NOT an official municipal boundary)'
  };

  // Find Polygon geometry
  let polygonCoords = null;
  if (boundaryData.type === 'FeatureCollection' && Array.isArray(boundaryData.features) && boundaryData.features.length > 0) {
    const feat = boundaryData.features[0];
    if (feat.geometry && feat.geometry.type === 'Polygon') {
      polygonCoords = feat.geometry.coordinates;
    }
  } else if (boundaryData.type === 'Feature' && boundaryData.geometry && boundaryData.geometry.type === 'Polygon') {
    polygonCoords = boundaryData.geometry.coordinates;
  } else if (boundaryData.type === 'Polygon') {
    polygonCoords = boundaryData.coordinates;
  }

  if (!polygonCoords || !Array.isArray(polygonCoords) || polygonCoords.length === 0) {
    throw new Error('[GEO_SERVICE_ERROR] Failed to locate valid Polygon coordinates in boundary GeoJSON');
  }

  // Linear ring: array of [lng, lat]
  const outerRing = polygonCoords[0];
  linearRing = outerRing.map((coord) => ({
    lng: coord[0],
    lat: coord[1]
  }));

  // Calculate bounding box
  for (const pt of linearRing) {
    if (pt.lat < bbox.minLat) bbox.minLat = pt.lat;
    if (pt.lat > bbox.maxLat) bbox.maxLat = pt.lat;
    if (pt.lng < bbox.minLng) bbox.minLng = pt.lng;
    if (pt.lng > bbox.maxLng) bbox.maxLng = pt.lng;
  }
}

/**
 * Validates whether a geographic point (latitude, longitude) is contained within
 * the Jodhpur Urban Service Area settlement boundary using ray-casting.
 *
 * Replicates the exact algorithm implemented in C++ BoundaryValidator::IsInside.
 *
 * @param {number} latitude - WGS84 latitude in degrees [-90, 90]
 * @param {number} longitude - WGS84 longitude in degrees [-180, 180]
 * @returns {boolean} True if strictly inside the service boundary, false otherwise
 */
export function isInsideJodhpurBoundary(latitude, longitude) {
  loadBoundary();

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  if (latitude < -90.0 || latitude > 90.0 || longitude < -180.0 || longitude > 180.0) {
    return false;
  }

  // Preliminary Bounding Box Acceleration
  if (
    latitude < bbox.minLat ||
    latitude > bbox.maxLat ||
    longitude < bbox.minLng ||
    longitude > bbox.maxLng
  ) {
    return false;
  }

  // Ray-Casting Algorithm on Closed Linear Ring
  const n = linearRing.length;
  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = linearRing[i].lat;
    const xi = linearRing[i].lng;
    const yj = linearRing[j].lat;
    const xj = linearRing[j].lng;

    // Check if edge crosses the horizontal ray extending from (longitude, latitude) towards +infinity
    if ((yi > latitude) !== (yj > latitude)) {
      const xinters = ((latitude - yi) * (xj - xi)) / (yj - yi) + xi;
      if (longitude <= xinters) {
        inside = !inside;
      }
    }
  }

  return inside;
}

/**
 * Returns service boundary metadata and bounding box.
 */
export function getBoundaryMetadata() {
  loadBoundary();
  return {
    metadata,
    boundingBox: { ...bbox },
    vertexCount: linearRing.length
  };
}

export default {
  isInsideJodhpurBoundary,
  getBoundaryMetadata
};

