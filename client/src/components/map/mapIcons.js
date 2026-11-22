import L from 'leaflet';

/**
 * Creates a circular styled SVG divIcon for map markers matching the Slate x Ice Blue theme.
 */
function createCustomIcon(color, text, size = 28, extraClass = '') {
  return L.divIcon({
    className: `custom-map-marker ${extraClass}`.trim(),
    html: `
      <div style="
        background-color: ${color};
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 11px;
        font-weight: bold;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        border: 2px solid #ffffff;
      ">
        ${text}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export const incidentIcon = (severity, status) => {
  let color = '#5685B5'; // Dispatched
  if (status === 'RESOLVED') color = '#56866B';
  else if (status === 'REJECTED' || status === 'CANCELLED') color = '#94A3B8';
  else if (status === 'ON_SCENE') color = '#6366F1';
  else if (severity === 5) color = '#DC4545'; // Critical
  else if (severity === 4) color = '#E89543'; // High
  else if (severity === 3) color = '#D5B34F'; // Medium
  else color = '#789CB8';

  return createCustomIcon(color, `P${severity || '!'}`, 28, 'incident-map-icon');
};

export const resourceIcon = (status, type) => {
  let color = '#56866B'; // Available
  if (status === 'RESERVED') color = '#E89543';
  if (status === 'DISPATCHED') color = '#5685B5';
  if (status === 'OUT_OF_SERVICE') color = '#64748B';

  const label = type ? String(type).substring(0, 2) : 'RS';
  return createCustomIcon(color, label, 26, 'resource-map-icon');
};

export const hospitalIcon = () => {
  return createCustomIcon('#0D9488', 'H', 28, 'hospital-map-icon');
};

import { getStationDisplayName } from '../../utils/stationUtils.js';

export { getStationDisplayName };

export default {
  incidentIcon,
  resourceIcon,
  hospitalIcon,
  getStationDisplayName,
};
