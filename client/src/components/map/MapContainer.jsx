import React, { useEffect } from 'react';
import { MapContainer as LeafletMap, TileLayer, Marker, Popup, GeoJSON, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  JODHPUR_COORDINATES,
  OSM_TILE_LAYER,
  isInsideJodhpurPolygon,
  JODHPUR_BOUNDARY_GEOJSON,
} from '../../config/geoConfig.js';
import { MapPin, AlertTriangle } from 'lucide-react';

// Fix default marker icon issue with Webpack/Vite bundlers
if (typeof window !== 'undefined' && L && L.Icon && L.Icon.Default && L.Icon.Default.prototype) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  });
}

/**
 * Helper to handle map clicks for interactive coordinate selection
 */
function MapClickHandler({ onLocationSelect, interactive }) {
  useMapEvents({
    click(e) {
      if (!interactive || !onLocationSelect) return;
      const lat = Number(e.latlng.lat.toFixed(6));
      const lng = Number(e.latlng.lng.toFixed(6));
      // Do not silently alter coordinates - pass verbatim clicked coordinates
      onLocationSelect({ latitude: lat, longitude: lng });
    },
  });
  return null;
}

/**
 * Helper to synchronize map center view when coordinates change externally
 */
function MapViewRecenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && Array.isArray(center) && center.length === 2 && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

export function MapContainer({
  center = JODHPUR_COORDINATES.center,
  zoom = JODHPUR_COORDINATES.defaultZoom,
  height = '350px',
  children = null,
  showDefaultMarker = true,
  markerTitle = 'Jodhpur City Center (Reference)',
  selectedLocation = null,
  locationName = '',
  onLocationSelect = null,
  interactive = false,
  showBoundaryPolygon = true,
  className = '',
}) {
  // Normalize selected location to [lat, lng] array
  let selectedCoords = null;
  if (selectedLocation) {
    if (Array.isArray(selectedLocation) && selectedLocation.length === 2) {
      selectedCoords = [Number(selectedLocation[0]), Number(selectedLocation[1])];
    } else if (typeof selectedLocation === 'object' && selectedLocation.latitude && selectedLocation.longitude) {
      selectedCoords = [Number(selectedLocation.latitude), Number(selectedLocation.longitude)];
    }
  }

  const isInteractive = interactive || Boolean(onLocationSelect);
  // Perform exact client-side point-in-polygon validation against canonical OSM settlement polygon
  const isSelectedInPolygon = selectedCoords
    ? isInsideJodhpurPolygon(selectedCoords[0], selectedCoords[1])
    : true;

  return (
    <div
      className={`w-full rounded-xl overflow-hidden border border-theme-border shadow-sm relative ${className}`}
      style={{ height }}
    >
      {/* Interactive Helper Overlay Banner */}
      {isInteractive && (
        <div className="absolute top-2 left-12 z-[1000] bg-white/95 backdrop-blur-sm border border-theme-border rounded-lg shadow-md px-3 py-1.5 text-xs flex items-center space-x-2 pointer-events-none">
          <MapPin className="w-3.5 h-3.5 text-theme-primary flex-shrink-0" />
          {selectedCoords ? (
            <div className="flex items-center space-x-2">
              <span className="font-medium text-theme-heading">
                Pinned: {selectedCoords[0].toFixed(4)}° N, {selectedCoords[1].toFixed(4)}° E
              </span>
              {!isSelectedInPolygon && (
                <span className="inline-flex items-center text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Outside Service Polygon (Academic Proxy)
                </span>
              )}
            </div>
          ) : (
            <span className="text-gray-600">
              Click anywhere on the map to pin incident location
            </span>
          )}
        </div>
      )}

      <LeafletMap
        center={selectedCoords || center}
        zoom={zoom}
        scrollWheelZoom={false}
        className={`h-full w-full ${isInteractive ? 'cursor-crosshair' : ''}`}
      >
        <TileLayer
          url={OSM_TILE_LAYER.url}
          attribution={OSM_TILE_LAYER.attribution}
          maxZoom={OSM_TILE_LAYER.maxZoom}
        />

        {/* Canonical Jodhpur Urban Settlement Polygon Overlay */}
        {showBoundaryPolygon && JODHPUR_BOUNDARY_GEOJSON && (
          <GeoJSON
            data={JODHPUR_BOUNDARY_GEOJSON}
            style={{
              color: '#789CB8',
              weight: 2,
              dashArray: '4, 4',
              fillColor: '#789CB8',
              fillOpacity: 0.06,
            }}
          />
        )}

        {isInteractive && (
          <MapClickHandler
            onLocationSelect={onLocationSelect}
            interactive={isInteractive}
          />
        )}

        <MapViewRecenter center={selectedCoords || center} />

        {/* Selected Location Marker - Supports interactive dragging and click adjustment */}
        {selectedCoords && (
          <Marker
            position={selectedCoords}
            draggable={isInteractive}
            eventHandlers={{
              dragend(e) {
                if (!isInteractive || !onLocationSelect) return;
                const marker = e.target;
                const position = marker.getLatLng();
                const lat = Number(position.lat.toFixed(6));
                const lng = Number(position.lng.toFixed(6));
                onLocationSelect({ latitude: lat, longitude: lng, isDrag: true });
              },
            }}
          >
            <Popup>
              <div className="text-xs p-1">
                <strong className="block font-semibold text-theme-heading">
                  {locationName || 'Selected Incident Location'}
                </strong>
                <span className="text-gray-600 block font-mono">
                  {selectedCoords[0].toFixed(5)}° N, {selectedCoords[1].toFixed(5)}° E
                </span>
                <span className={`text-[11px] mt-1 block font-medium ${
                  isSelectedInPolygon ? 'text-emerald-700' : 'text-amber-700'
                }`}>
                  {isSelectedInPolygon
                    ? '✓ Inside Jodhpur Urban Area (OSM Way 31725312 Proxy)'
                    : '⚠ Outside Jodhpur Settlement Polygon (Will be rejected by backend)'}
                </span>
                {isInteractive && (
                  <span className="text-[10px] text-gray-400 block mt-1 italic">
                    Drag pin or click map to fine-tune exact scene
                  </span>
                )}
              </div>
            </Popup>
          </Marker>
        )}

        {/* Default / Reference Center Marker if no custom location is pinned */}
        {!selectedCoords && showDefaultMarker && (
          <Marker position={center}>
            <Popup>
              <div className="text-xs p-1">
                <strong className="block font-semibold text-theme-heading">{markerTitle}</strong>
                <span className="text-gray-500 font-mono">
                  {center[0].toFixed(4)}° N, {center[1].toFixed(4)}° E
                </span>
              </div>
            </Popup>
          </Marker>
        )}

        {children}
      </LeafletMap>
    </div>
  );
}

export default MapContainer;
