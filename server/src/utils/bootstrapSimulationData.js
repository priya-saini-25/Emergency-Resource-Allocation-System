import Resource from '../models/Resource.js';
import Hospital from '../models/Hospital.js';
import { isInsideJodhpurBoundary } from '../services/geographicService.js';

/**
 * Canonical simulated Jodhpur hospitals aligned with authentic OpenStreetMap nodes.
 * Academic simulation data only. Not connected to real emergency healthcare facilities.
 */
export const SIMULATED_HOSPITALS = [
  {
    hospitalId: 701,
    name: 'AIIMS Jodhpur (Simulation)',
    status: 'OPERATIONAL',
    capabilities: [
      'GENERAL_EMERGENCY',
      'TRAUMA',
      'ICU',
      'BURN_TREATMENT',
      'OXYGEN_SUPPORT',
      'SURGICAL_SUPPORT'
    ],
    icuBeds: { total: 50, available: 25 },
    generalBeds: { total: 500, available: 200 },
    oxygenBeds: { total: 200, available: 80 },
    latitude: 26.2400087,
    longitude: 73.0066073,
    nodeOsmId: 8520698362
  },
  {
    hospitalId: 702,
    name: 'MDM Hospital Jodhpur (Simulation)',
    status: 'OPERATIONAL',
    capabilities: [
      'GENERAL_EMERGENCY',
      'TRAUMA',
      'ICU',
      'BURN_TREATMENT',
      'OXYGEN_SUPPORT',
      'SURGICAL_SUPPORT'
    ],
    icuBeds: { total: 30, available: 15 },
    generalBeds: { total: 400, available: 150 },
    oxygenBeds: { total: 150, available: 50 },
    latitude: 26.2659527,
    longitude: 73.0087496,
    nodeOsmId: 5321319416
  },
  {
    hospitalId: 703,
    name: 'Mahatma Gandhi Hospital (Simulation)',
    status: 'OPERATIONAL',
    capabilities: [
      'GENERAL_EMERGENCY',
      'TRAUMA',
      'ICU',
      'OXYGEN_SUPPORT',
      'SURGICAL_SUPPORT'
    ],
    icuBeds: { total: 25, available: 12 },
    generalBeds: { total: 300, available: 120 },
    oxygenBeds: { total: 100, available: 40 },
    latitude: 26.2832499,
    longitude: 73.0181569,
    nodeOsmId: 8499684813
  }
];

/**
 * 15 simulated emergency fleet resources across 5 strategic Jodhpur depots.
 * Academic simulation data only. Not connected to real municipal dispatch.
 */
export const SIMULATED_RESOURCES = [
  // --- Station 1: AIIMS Emergency Depot (South Zone - Basni / Sangariya) ---
  {
    resourceId: 101,
    name: 'ALS Ambulance 101 [AIIMS Depot] (Simulation)',
    resourceType: 'ALS_AMBULANCE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2400087,
    longitude: 73.0066073,
    currentNodeOsmId: 8520698362,
    stationId: 'DEPOT-AIIMS-01'
  },
  {
    resourceId: 102,
    name: 'ALS Ambulance 102 [AIIMS Depot] (Simulation)',
    resourceType: 'ALS_AMBULANCE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2400087,
    longitude: 73.0066073,
    currentNodeOsmId: 8520698362,
    stationId: 'DEPOT-AIIMS-01'
  },
  {
    resourceId: 103,
    name: 'BLS Ambulance 103 [AIIMS Depot] (Simulation)',
    resourceType: 'BLS_AMBULANCE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2405000,
    longitude: 73.0070000,
    currentNodeOsmId: 8520698362,
    stationId: 'DEPOT-AIIMS-01'
  },

  // --- Station 2: Basni Fire & Rescue Station (Industrial Zone) ---
  {
    resourceId: 201,
    name: 'Fire Engine 201 [Basni Station] (Simulation)',
    resourceType: 'FIRE_ENGINE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2230315,
    longitude: 73.0111845,
    currentNodeOsmId: 2694302020,
    stationId: 'STATION-BASNI-02'
  },
  {
    resourceId: 202,
    name: 'Fire Engine 202 [Basni Station] (Simulation)',
    resourceType: 'FIRE_ENGINE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2230315,
    longitude: 73.0111845,
    currentNodeOsmId: 2694302020,
    stationId: 'STATION-BASNI-02'
  },
  {
    resourceId: 203,
    name: 'Fire Tender 203 [Basni Station] (Simulation)',
    resourceType: 'FIRE_TENDER',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2235000,
    longitude: 73.0115000,
    currentNodeOsmId: 2694302020,
    stationId: 'STATION-BASNI-02'
  },
  {
    resourceId: 204,
    name: 'Rescue Vehicle 204 [Basni Station] (Simulation)',
    resourceType: 'RESCUE_VEHICLE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2232000,
    longitude: 73.0110000,
    currentNodeOsmId: 2694302020,
    stationId: 'STATION-BASNI-02'
  },

  // --- Station 3: Paota Fire & Ambulance Depot (North-East Zone) ---
  {
    resourceId: 301,
    name: 'ALS Ambulance 301 [Paota Depot] (Simulation)',
    resourceType: 'ALS_AMBULANCE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.3012733,
    longitude: 73.0429084,
    currentNodeOsmId: 3773158752,
    stationId: 'DEPOT-PAOTA-03'
  },
  {
    resourceId: 302,
    name: 'BLS Ambulance 302 [Paota Depot] (Simulation)',
    resourceType: 'BLS_AMBULANCE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.3015000,
    longitude: 73.0432000,
    currentNodeOsmId: 3773158752,
    stationId: 'DEPOT-PAOTA-03'
  },
  {
    resourceId: 304,
    name: 'Fire Engine 304 [Paota Depot] (Simulation)',
    resourceType: 'FIRE_ENGINE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.3010000,
    longitude: 73.0425000,
    currentNodeOsmId: 3773158752,
    stationId: 'DEPOT-PAOTA-03'
  },
  {
    resourceId: 305,
    name: 'Rescue Vehicle 305 [Paota Depot] (Simulation)',
    resourceType: 'RESCUE_VEHICLE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.3012000,
    longitude: 73.0428000,
    currentNodeOsmId: 3773158752,
    stationId: 'DEPOT-PAOTA-03'
  },

  // --- Station 4: Shastri Nagar / MDM Depot (Central-West Zone) ---
  {
    resourceId: 401,
    name: 'ALS Ambulance 401 [Shastri Nagar] (Simulation)',
    resourceType: 'ALS_AMBULANCE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2659527,
    longitude: 73.0087496,
    currentNodeOsmId: 5321319416,
    stationId: 'DEPOT-SHASTRI-04'
  },
  {
    resourceId: 402,
    name: 'BLS Ambulance 402 [Shastri Nagar] (Simulation)',
    resourceType: 'BLS_AMBULANCE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2665000,
    longitude: 73.0092000,
    currentNodeOsmId: 5321319416,
    stationId: 'DEPOT-SHASTRI-04'
  },

  // --- Station 5: Old City / Jalori Gate Fire Post (Walled City Zone) ---
  {
    resourceId: 501,
    name: 'Fire Tender 501 [Jalori Gate Post] (Simulation)',
    resourceType: 'FIRE_TENDER',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2885993,
    longitude: 73.0180000,
    currentNodeOsmId: 2688566058,
    stationId: 'POST-JALORI-05'
  },
  {
    resourceId: 502,
    name: 'Rescue Vehicle 502 [Jalori Gate Post] (Simulation)',
    resourceType: 'RESCUE_VEHICLE',
    status: 'AVAILABLE',
    capacity: 1,
    latitude: 26.2890000,
    longitude: 73.0185000,
    currentNodeOsmId: 2688566058,
    stationId: 'POST-JALORI-05'
  }
];

/**
 * Idempotently provisions initial simulated hospitals and fleet resources in MongoDB.
 *
 * Requirements:
 * - Checks per-record existence (does NOT skip entire collection if one record exists).
 * - Never overwrites existing operational statuses or modified records.
 * - Validates all coordinates against Jodhpur municipal polygon.
 * - Guarantees deterministic IDs.
 *
 * @returns {Promise<{
 *   hospitalsCreated: number,
 *   hospitalsSkipped: number,
 *   resourcesCreated: number,
 *   resourcesSkipped: number
 * }>}
 */
export async function bootstrapSimulationData() {
  const result = {
    hospitalsCreated: 0,
    hospitalsSkipped: 0,
    resourcesCreated: 0,
    resourcesSkipped: 0
  };

  // 1. Seed Hospitals (Per-record check)
  for (const h of SIMULATED_HOSPITALS) {
    if (!isInsideJodhpurBoundary(h.latitude, h.longitude)) {
      throw new Error(`[BOOTSTRAP_ERROR] Hospital '${h.name}' [${h.latitude}, ${h.longitude}] is outside Jodhpur boundary`);
    }

    const existing = await Hospital.findOne({ hospitalId: h.hospitalId });
    if (!existing) {
      await Hospital.create(h);
      result.hospitalsCreated++;
      console.log(`[BOOTSTRAP] Seeded simulated hospital #${h.hospitalId}: ${h.name}`);
    } else {
      result.hospitalsSkipped++;
    }
  }

  // 2. Seed Fleet Resources (Per-record check)
  for (const r of SIMULATED_RESOURCES) {
    if (!isInsideJodhpurBoundary(r.latitude, r.longitude)) {
      throw new Error(`[BOOTSTRAP_ERROR] Resource #${r.resourceId} [${r.latitude}, ${r.longitude}] is outside Jodhpur boundary`);
    }

    const existing = await Resource.findOne({ resourceId: r.resourceId });
    if (!existing) {
      await Resource.create(r);
      result.resourcesCreated++;
      console.log(`[BOOTSTRAP] Seeded simulated resource #${r.resourceId}: ${r.name}`);
    } else {
      result.resourcesSkipped++;
    }
  }

  return result;
}

export default bootstrapSimulationData;
