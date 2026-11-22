# Phase 7: Citizen Location Search, Place-Name Geocoding & Interactive Map Integration — Implementation Plan

## 1. Executive Summary & Objective

The objective of Phase 7 is to deliver a seamless, citizen-centric location search experience for emergency incident reporting in Jodhpur. Citizens should be able to type common place names (e.g., *"Sojati Gate"*, *"AIIMS Jodhpur"*, *"MDM Hospital"*, *"Sardarpura"*, *"Paota"*), select from verified suggestions within the Jodhpur Urban Service Area, and have the interactive Leaflet map automatically center, place, and synchronize the marker without manually entering latitude and longitude.

Citizens retain full control to drag the marker or click the map to refine the location. The system clearly communicates that geocoded coordinates are approximations, preserves the original place name as an operational reference, stores an optional `locationName` field in the `Incident` model, and enhances tactical resource map markers with clear simulated depot labels.

---

## 2. Architecture & Design Principles

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Citizen Browser UI                              │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ LocationSearchInput (Debounced 400ms, Suggestions Dropdown)    │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │ GET /api/location/search?q=...     │
│                                   ▼                                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ MapContainer (Leaflet, Draggable Marker, Polygon Overlay)      │   │
│   │   • Pinned Marker with Drag & Click Refinement                 │   │
│   │   • Ray-Casting Client Pre-Validation (OSM Way 31725312)       │   │
│   │   • Geocoding Approximation & Transparency Advisory            │   │
│   └────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP API Request
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    Express Backend Application                         │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ locationRoutes & locationController (GET /api/location/search) │   │
│   │   1. Input Sanitization & Length Guard (2..100 chars)          │   │
│   │   2. In-Memory LRU Cache (Fast Repeated Query Response)        │   │
│   │   3. Strict Token Bucket Rate Limiter (Max 1 req/s outbound)   │   │
│   │   4. Bounding Box Biasing (Jodhpur Urban Boundary)             │   │
│   │   5. Point-in-Polygon Filtering (isInsideJodhpurBoundary)      │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │ Outbound HTTPS (Identifiable UA)   │
│                                   ▼                                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ OpenStreetMap Nominatim Public Geocoding Service               │   │
│   │   (https://nominatim.openstreetmap.org/search)                 │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ incidentController & Incident Model                            │   │
│   │   • Optional locationName field in schema & createIncident     │   │
│   │   • 100% backward compatible with coordinate-only payloads     │   │
│   │   • Authoritative isInsideJodhpurBoundary() validation         │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Plan

### 3.1 Backend Geocoding Service & API (`/api/location/search`)
- **Route**: `GET /api/location/search?q=<query>`
- **Controller & Service**: `server/src/controllers/locationController.js` and `server/src/services/geocodingService.js`
- **Nominatim Policy Compliance**:
  - Outbound rate-limiting: Leaky bucket / queue ensuring no more than 1 request per second hits Nominatim.
  - In-memory cache (TTL 24 hours, max 500 entries) caching normalized query strings.
  - Explicit User-Agent: `EmergencyResourceAllocationSystem/1.0 (academic-simulation; Jodhpur-ERAS; contact: admin@jodhpur.emergency.gov.in)`.
  - Bounding box viewbox parameters derived from canonical boundary metadata: `viewbox=72.95,26.35,73.12,26.20`.
- **Filtering & Annotation**:
  - Each candidate result parsed from Nominatim (`lat`, `lon`, `display_name`, `type`, `class`).
  - Evaluated against `isInsideJodhpurBoundary(lat, lon)`.
  - Decorated with `isInsideServiceArea: boolean`.
  - Sorted to prioritize results inside the Jodhpur Urban Service Area.
- **Error Handling & Reliability**:
  - Provider timeout (4,000ms ceiling).
  - Graceful degradation: If Nominatim fails or times out, returns HTTP 503 or 200 with empty list and warning flag, ensuring frontend continues operating in manual map-click/pin mode.

### 3.2 Incident Schema & API Compatibility
- **Model Update (`server/src/models/Incident.js`)**:
  - Add optional `locationName: { type: String, trim: true, default: '' }`.
  - Virtual getter/setter `location` returns `{ latitude, longitude, locationName }`.
  - `toEngineProtocol()` continues passing verbatim numeric coordinates (`latitude`, `longitude`, `incident_node_osm_id`), preserving the C++ JSON protocol without modification.
- **Controller Update (`server/src/controllers/incidentController.js`)**:
  - Extract `locationName` from `body.locationName` or `body.location.name` or `body.location.locationName`.
  - Persist `locationName` when provided.
  - Omitted `locationName` defaults safely to empty string (full legacy backward compatibility).

### 3.3 Frontend Location Search Component (`LocationSearchInput.jsx`)
- Reusable search input with:
  - Magnifying glass icon & clear button (X).
  - Debounced keystroke input (400ms).
  - Dropdown suggestion list displaying:
    - Primary title (e.g. *"Sojati Gate"*, *"MDM Hospital"*).
    - Secondary subtitle / address context (e.g. *"Jodhpur, Rajasthan, India"*).
    - Coordinates badge (e.g. `26.29° N, 73.02° E`).
    - Service Area tag (Green for *"Inside Service Area"*, Amber for *"Outside Service Area"*).
  - Loading spinner while search is in-flight.
  - Informative empty state (*"No locations found in Jodhpur matching '...' "*).
  - Offline/Error state (*"Location search unavailable. You can pin location directly on the map."*).

### 3.4 Interactive Map Integration (`MapContainer.jsx` & `CitizenReportEmergency.jsx`)
- **Map Synchronization**:
  - When a suggestion is selected, the map smoothly pans/animates to `[latitude, longitude]`.
  - Marker is placed and configured as `draggable={true}`.
- **Marker Drag & Click Refinement**:
  - Dragging the marker triggers `onLocationSelect` with updated `latitude` and `longitude`.
  - Map clicks update the marker position.
  - Place name reference is retained: when refined, indicates `"(Map Refined)"` or preserves the place name as the search reference.
  - Pre-validates coordinates against `isInsideJodhpurPolygon` in real time, updating the boundary advisory banner.
- **Transparency & Accuracy Notice**:
  - Prominent banner explaining:
    > *"Place name search provides approximate coordinates. Please inspect the pin on the map and drag it or click to indicate the exact scene of the emergency."*

### 3.5 Resource Station Map Labels (Control Room Tactical Views)
- **Depot Labeling**:
  - In `client/src/components/map/mapIcons.js`, `TacticalMapPage.jsx`, and `ResourceFleetPage.jsx`, update resource marker popups and tooltips to explicitly show:
    - Unit ID and Resource Type (e.g. `Unit #501 (Fire Tender)`).
    - Official simulated station:
      - `AIIMS Depot — Simulated Station`
      - `Basni Depot — Simulated Station`
      - `Paota Depot — Simulated Station`
      - `Shastri Nagar Depot — Simulated Station`
      - `Jalori Gate Depot — Simulated Station`
    - Availability status (`AVAILABLE`, `DISPATCHED`, `RESERVED`, `OUT_OF_SERVICE`).
    - Explicit disclaimer: *"Stationary simulated base depot. Live vehicle telemetry is not connected."*

---

## 4. Test Strategy & Coverage Plan

### Automated Test Suite (15 Test Areas)
1. **Valid Place-Name Search**: Query returns 200 with structured results, coordinates, and `isInsideServiceArea: true`.
2. **Search Debouncing**: Rapid client keystrokes trigger only 1 network request after debounce delay.
3. **Repeated-Query Caching**: Identical queries return cached results instantly without outbound provider requests.
4. **No Search Results**: Obscure query returns empty array without throwing errors.
5. **Geocoding Provider/Network Failure**: Handles 500/timeout from Nominatim with graceful error envelope and fallback instruction.
6. **Out-of-Service-Area Results**: Place outside Jodhpur polygon is flagged as `isInsideServiceArea: false` and prevented from form submission.
7. **Successful Location Selection**: Selecting a suggestion populates form coordinates and place name.
8. **Map Center Synchronization**: Selecting a suggestion recenters the Leaflet map.
9. **Marker Drag Coordinate Updates**: Dragging marker updates form coordinates and re-evaluates polygon boundary.
10. **Map-Click Coordinate Updates**: Clicking map updates marker coordinates and re-evaluates polygon boundary.
11. **Invalid Coordinates**: Non-numeric or out-of-range coordinates are safely rejected.
12. **Legacy Coordinate-Only Submission**: Submitting `{ category, severity, victimCount, description, location: { latitude, longitude } }` without `locationName` succeeds.
13. **New Incident Submission with `locationName`**: Submitting with `locationName` persists and returns `locationName`.
14. **Resource Station Map Labels**: Markers display simulated depot name and status clearly.
15. **Backend Rate Limiting**: Outbound requests never exceed 1 req/sec; backend route has burst limits.

*All automated tests will use mocked geocoding responses to prevent external network dependence.*

---

## 5. Security & Reliability Mitigations
- Input sanitization on query string: stripped of dangerous characters, bounded to 2–100 characters.
- Backend rate limiter on `/api/location/search` (max 30 requests per minute per IP).
- Outbound token-bucket limiter to Nominatim enforcing 1-second spacing between requests.
- Fail-open fallback: if geocoding is unavailable, citizen reporting remains 100% functional via map-click / coordinate pinning.
