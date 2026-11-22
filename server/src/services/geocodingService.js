import { isInsideJodhpurBoundary, getBoundaryMetadata } from './geographicService.js';

/**
 * OpenStreetMap Nominatim Geocoding Service with strict rate limiting,
 * in-memory caching, bounding-box biasing, and service-area polygon filtering.
 */

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT = 'EmergencyResourceAllocationSystem/1.0 (academic-simulation; Jodhpur-ERAS; contact: admin@jodhpur.emergency.gov.in)';
const NOMINATIM_MIN_INTERVAL_MS = 1050; // Nominatim policy: max 1 request/sec
const NOMINATIM_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 500;

// In-memory LRU cache
const geocodeCache = new Map();

// Serialized rate limiter state
let lastOutboundTime = 0;
let requestQueue = Promise.resolve();

// Test mock hook
let mockFetcher = null;

export function setMockFetcher(fn) {
  mockFetcher = fn;
}

export function clearGeocodeCache() {
  geocodeCache.clear();
}

export function getGeocodeCacheStats() {
  return {
    size: geocodeCache.size,
    maxSize: MAX_CACHE_SIZE
  };
}

/**
 * Sanitizes and normalizes query strings.
 */
export function normalizeQuery(rawQuery) {
  if (typeof rawQuery !== 'string') return '';
  return rawQuery
    .replace(/[^\w\s,.-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Known Jodhpur landmarks seed dictionary for instant sub-millisecond lookups.
 */
const KNOWN_JODHPUR_LANDMARKS = [
  {
    aliases: ['sojati gate', 'sojati gate jodhpur', 'sojati circle'],
    name: 'Sojati Gate',
    displayName: 'Sojati Gate, Rawaton Ka Bass, Jodhpur, Rajasthan, 342001, India',
    latitude: 26.2906,
    longitude: 73.0232,
    type: 'landmark'
  },
  {
    aliases: ['aiims jodhpur', 'aiims hospital', 'aiims depot', 'aiims'],
    name: 'AIIMS Jodhpur',
    displayName: 'All India Institute of Medical Sciences (AIIMS) Jodhpur, Basni Industrial Area, Jodhpur, Rajasthan, 342005, India',
    latitude: 26.240009,
    longitude: 73.006607,
    type: 'hospital'
  },
  {
    aliases: ['mdm hospital', 'mdm hospital jodhpur', 'mathura das mathur', 'mathuradas mathur hospital'],
    name: 'MDM Hospital Jodhpur',
    displayName: 'Mathura Das Mathur (MDM) Hospital, Shastri Nagar, Jodhpur, Rajasthan, 342003, India',
    latitude: 26.265953,
    longitude: 73.00875,
    type: 'hospital'
  },
  {
    aliases: ['sardarpura', 'sardarpura jodhpur', 'sardarpura c road'],
    name: 'Sardarpura',
    displayName: 'Sardarpura, Jodhpur, Rajasthan, 342003, India',
    latitude: 26.2785,
    longitude: 73.0112,
    type: 'suburb'
  },
  {
    aliases: ['paota', 'paota jodhpur', 'paota circle', 'paota depot'],
    name: 'Paota',
    displayName: 'Paota, Jodhpur, Rajasthan, 342006, India',
    latitude: 26.301273,
    longitude: 73.042908,
    type: 'suburb'
  },
  {
    aliases: ['clock tower', 'ghanta ghar', 'ghanta ghar jodhpur', 'clock tower jodhpur'],
    name: 'Clock Tower (Ghanta Ghar)',
    displayName: 'Ghanta Ghar (Clock Tower), Nai Sadak, Rawaton Ka Bass, Jodhpur, Rajasthan, 342001, India',
    latitude: 26.2978,
    longitude: 73.0185,
    type: 'landmark'
  },
  {
    aliases: ['mahatma gandhi hospital', 'mgh jodhpur', 'mgh hospital'],
    name: 'Mahatma Gandhi Hospital',
    displayName: 'Mahatma Gandhi Hospital, Station Road, Jodhpur, Rajasthan, 342001, India',
    latitude: 26.28325,
    longitude: 73.018157,
    type: 'hospital'
  },
  {
    aliases: ['jalori gate', 'jalori gate post', 'jalori circle'],
    name: 'Jalori Gate',
    displayName: 'Jalori Gate, Jodhpur, Rajasthan, 342001, India',
    latitude: 26.2885,
    longitude: 73.0203,
    type: 'landmark'
  },
  {
    aliases: ['basni', 'basni industrial area', 'basni station', 'basni depot'],
    name: 'Basni Industrial Area',
    displayName: 'Basni Phase II, Jodhpur, Rajasthan, 342005, India',
    latitude: 26.223032,
    longitude: 73.011185,
    type: 'industrial'
  },
  {
    aliases: ['shastri nagar', 'shastri nagar jodhpur'],
    name: 'Shastri Nagar',
    displayName: 'Shastri Nagar, Jodhpur, Rajasthan, 342003, India',
    latitude: 26.268,
    longitude: 73.01,
    type: 'suburb'
  }
];

/**
 * Searches local known landmarks before hitting Nominatim.
 */
function searchLocalLandmarks(normQuery) {
  const matches = [];
  for (const landmark of KNOWN_JODHPUR_LANDMARKS) {
    const isMatch = landmark.aliases.some((alias) =>
      alias.includes(normQuery) || normQuery.includes(alias)
    );
    if (isMatch) {
      const isInside = isInsideJodhpurBoundary(landmark.latitude, landmark.longitude);
      matches.push({
        placeId: `seed_${landmark.name.replace(/\s+/g, '_').toLowerCase()}`,
        name: landmark.name,
        displayName: landmark.displayName,
        latitude: landmark.latitude,
        longitude: landmark.longitude,
        type: landmark.type,
        category: landmark.type === 'hospital' ? 'emergency' : 'place',
        isInsideServiceArea: isInside
      });
    }
  }
  return matches;
}

/**
 * Enforces rate limiting on outbound requests to Nominatim (max 1 req/sec).
 */
export async function scheduleOutboundRequest(fn) {
  // Chain onto existing queue to strictly serialize outbound requests
  const run = async () => {
    const now = Date.now();
    const elapsed = now - lastOutboundTime;
    if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
      const delay = NOMINATIM_MIN_INTERVAL_MS - elapsed;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    lastOutboundTime = Date.now();
    return fn();
  };

  requestQueue = requestQueue.then(run, run);
  return requestQueue;
}

/**
 * Executes geocoding search for place names in Jodhpur.
 *
 * @param {string} rawQuery - The place name to search
 * @returns {Promise<Array<object>>}
 */
export async function searchPlaces(rawQuery) {
  const query = normalizeQuery(rawQuery);
  if (!query || query.length < 2) {
    return [];
  }

  // 1. Check in-memory cache
  const cached = geocodeCache.get(query);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.results;
  }

  // 2. Check known landmarks for fast deterministic matching
  const localMatches = searchLocalLandmarks(query);
  if (localMatches.length > 0) {
    // Cache and return known landmarks immediately
    setCache(query, localMatches);
    return localMatches;
  }

  // 3. Prepare Nominatim Request
  const boundaryInfo = getBoundaryMetadata();
  const bbox = boundaryInfo.boundingBox;
  // Viewbox: minLon, maxLat, maxLon, minLat
  const viewboxStr = `${bbox.minLng.toFixed(4)},${bbox.maxLat.toFixed(4)},${bbox.maxLng.toFixed(4)},${bbox.minLat.toFixed(4)}`;

  const searchParam = query.includes('jodhpur') ? query : `${query}, Jodhpur, Rajasthan`;
  const url = new URL(NOMINATIM_BASE_URL);
  url.searchParams.set('q', searchParam);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '8');
  url.searchParams.set('viewbox', viewboxStr);
  url.searchParams.set('bounded', '0');

  // 4. Execute with rate limiter
  let rawResults = [];
  try {
    if (mockFetcher) {
      rawResults = await mockFetcher(query, url.toString());
    } else {
      rawResults = await scheduleOutboundRequest(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

        try {
          const res = await fetch(url.toString(), {
            headers: {
              'User-Agent': NOMINATIM_USER_AGENT,
              'Accept': 'application/json'
            },
            signal: controller.signal
          });

          if (!res.ok) {
            throw new Error(`Nominatim returned HTTP ${res.status}`);
          }

          return await res.json();
        } finally {
          clearTimeout(timeoutId);
        }
      });
    }
  } catch (err) {
    console.warn(`[GEOCODING_SERVICE] Outbound geocoding failed for query '${query}': ${err.message}`);
    // If external search fails, fall back to any partial local matches
    return [];
  }

  // 5. Parse, validate against service area boundary, and format
  const formatted = [];
  if (Array.isArray(rawResults)) {
    for (const item of rawResults) {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const isInside = isInsideJodhpurBoundary(lat, lon);
      const name = item.name || (item.display_name ? item.display_name.split(',')[0].trim() : query);

      formatted.push({
        placeId: String(item.place_id || item.osm_id || Math.random()),
        name,
        displayName: item.display_name || name,
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lon.toFixed(6)),
        type: item.type || 'place',
        category: item.category || item.class || 'place',
        isInsideServiceArea: isInside
      });
    }
  }

  // 6. Sort: Places strictly inside the service area polygon are prioritized first
  formatted.sort((a, b) => {
    if (a.isInsideServiceArea === b.isInsideServiceArea) return 0;
    return a.isInsideServiceArea ? -1 : 1;
  });

  // 7. Store in LRU Cache
  setCache(query, formatted);

  return formatted;
}

function setCache(query, results) {
  if (geocodeCache.size >= MAX_CACHE_SIZE) {
    const firstKey = geocodeCache.keys().next().value;
    geocodeCache.delete(firstKey);
  }
  geocodeCache.set(query, {
    results,
    timestamp: Date.now()
  });
}

export default {
  searchPlaces,
  normalizeQuery,
  clearGeocodeCache,
  getGeocodeCacheStats,
  setMockFetcher
};
