/**
 * Decodes a Google Encoded Polyline algorithm string (precision 5) into an array of [lat, lng] coordinates.
 * Compatible with Leaflet's L.polyline coordinates.
 *
 * @param {string} str - Encoded polyline string
 * @param {number} [precision=5] - Precision factor (default 5 for 1e5)
 * @returns {Array<[number, number]>} Array of [latitude, longitude] pairs
 */
export function decodePolyline(str, precision = 5) {
  if (!str || typeof str !== 'string') return [];

  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  const factor = Math.pow(10, precision);

  while (index < str.length) {
    let byte = null;
    let shift = 0;
    let result = 0;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push([lat / factor, lng / factor]);
  }

  return coordinates;
}

export default decodePolyline;

