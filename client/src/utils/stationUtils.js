/**
 * Emergency Station & Depot Utility Functions
 *
 * Clearly distinguishes stationary base depots from live vehicle GPS.
 */

/**
 * Returns formatted simulated base station depot name.
 *
 * @param {string} stationId - Identifier (e.g. 'DEPOT-AIIMS-01')
 * @param {string} name - Optional name (e.g. 'AIIMS Depot')
 * @returns {string} - Formatted station label
 */
export function getStationDisplayName(stationId, name = '') {
  if (stationId === 'DEPOT-AIIMS-01' || name.includes('AIIMS Depot')) {
    return 'AIIMS Depot — Simulated Station';
  }
  if (stationId === 'STATION-BASNI-02' || name.includes('Basni Station') || name.includes('Basni Depot')) {
    return 'Basni Depot — Simulated Station';
  }
  if (stationId === 'DEPOT-PAOTA-03' || name.includes('Paota Depot')) {
    return 'Paota Depot — Simulated Station';
  }
  if (stationId === 'DEPOT-SHASTRI-04' || name.includes('Shastri Nagar')) {
    return 'Shastri Nagar Depot — Simulated Station';
  }
  if (stationId === 'POST-JALORI-05' || name.includes('Jalori Gate')) {
    return 'Jalori Gate Depot — Simulated Station';
  }
  if (stationId) {
    return `${stationId} — Simulated Station`;
  }
  return 'Simulated Base Depot';
}

export default {
  getStationDisplayName,
};
