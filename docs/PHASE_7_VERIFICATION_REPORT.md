# Phase 7: Citizen Location Search, Place-Name Geocoding & Interactive Map Integration — Final Verification Report

**Project:** Emergency Resource Allocation System (Academic Simulation Prototype)  
**Target City:** Jodhpur, Rajasthan, India  
**Date:** November 20, 2026  
**Status:** COMPLETE & VERIFIED  

---

## 1. Executive Summary

Phase 7 delivers a seamless, citizen-centric location search experience for emergency incident reporting in Jodhpur without requiring citizens to manually enter or know raw geographic coordinates. Citizens can enter familiar place names and landmarks (e.g., *"Sojati Gate"*, *"AIIMS Jodhpur"*, *"MDM Hospital"*, *"Sardarpura"*, *"Paota"*), select from verified suggestions biased to Jodhpur, and observe the interactive Leaflet map automatically center, place, and synchronize the incident marker.

Citizens retain full control to drag the marker or click the map to fine-tune the exact scene. The system clearly communicates that geocoded coordinates are approximations, preserves the citizen place name as an operational reference, records an optional `locationName` field in the `Incident` database model, and displays stationary simulated depot labels on control-room tactical maps without misrepresenting vehicle telemetry.

---

## 2. Nominatim Public Policy & Rate-Limiting Architecture

To strictly comply with the [OpenStreetMap Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/), the backend implements a secure, resilient caching proxy (`GET /api/location/search`):

1. **Strict Outbound Rate Limiting:**
   - Enforces a minimum interval of 1,050ms between outbound HTTP requests to `nominatim.openstreetmap.org`, ensuring outbound traffic never exceeds 1 request per second.
2. **In-Memory LRU Cache (24-Hour TTL):**
   - High-speed in-memory cache stores up to 500 normalized query results for 24 hours. Repeated queries for common emergency locations (e.g. *"AIIMS Jodhpur"*, *"Sojati Gate"*) resolve instantly in < 2ms without issuing outbound requests.
3. **Pre-Seeded Canonical Landmarks:**
   - Pre-seeds prominent Jodhpur emergency hubs and landmarks (*Sojati Gate, AIIMS Jodhpur, MDM Hospital, Sardarpura, Paota Circle, Clock Tower / Ghanta Ghar, MGH Hospital, Jalori Gate, Basni Station, Shastri Nagar*) to ensure instant resolution even if outbound connectivity is interrupted.
4. **Identifiable User-Agent:**
   - All outbound requests send:
     `EmergencyResourceAllocationSystem/1.0 (academic-simulation; Jodhpur-ERAS; contact: admin@jodhpur.emergency.gov.in)`
5. **Geographic Viewbox Biasing:**
   - Injects canonical Jodhpur Urban bounding box parameters (`viewbox=72.95,26.35,73.12,26.20&bounded=0`) to bias Nominatim search results towards Jodhpur while allowing global fallback.
6. **Graceful Degradation:**
   - If Nominatim returns HTTP 503 or experiences timeouts (> 4,000ms), the frontend displays a non-blocking advisory encouraging citizens to pin or click their location directly on the interactive map.

---

## 3. Geographic Boundary & Ray-Casting Polygon Enforcement

- **Academic Settlement Proxy (OSM Way 31725312):**
  - All geocoded results are evaluated against the canonical Jodhpur settlement polygon using ray-casting point-in-polygon algorithm (`isInsideJodhpurBoundary` / `isInsideJodhpurPolygon`).
  - Search results inside the polygon are tagged with `isInsideServiceArea: true` and sorted first.
  - Outlying areas (such as Mandore Garden at `26.3550° N, 73.0400° E`) are clearly badged with Amber tags (*"Outside Service Area"*), and client-side pre-validation blocks form submission if selected without dragging into the service polygon.
  - Authoritative point-in-polygon validation is strictly enforced on the Express backend (`400 OUTSIDE_SERVICE_AREA`).

---

## 4. Interactive Leaflet Map & Draggable Marker Integration

1. **Dynamic Map Re-Centering:**
   - Selecting a search suggestion triggers `MapViewRecenter`, smoothly flying and centering the Leaflet map at the resolved coordinate pair `[latitude, longitude]`.
2. **Draggable Marker (`draggable={isInteractive}`):**
   - The incident marker is draggable. Upon `dragend`, coordinates are extracted (`position.lat.toFixed(6)`, `position.lng.toFixed(6)`), the form fields update, and the place name reference is annotated with `"(Pin Refined)"` to indicate manual adjustment.
3. **Interactive Click-to-Pin:**
   - Citizens can click anywhere within the interactive map viewport to reposition the pin. Coordinates update in real-time with automatic polygon revalidation.
4. **Coordinate Accuracy & Transparency Notice:**
   - Prominently displays:
     > *"Place name search provides approximate coordinates. Please inspect the pin on the map and drag it or click to indicate the exact scene of the emergency."*

---

## 5. Incident Model & API Compatibility

- **Mongoose Schema (`server/src/models/Incident.js`):**
  - Added optional `locationName: { type: String, trim: true, default: '' }`.
  - Maintained virtual `location` getter/setter returning `{ latitude, longitude, locationName }`.
- **C++ Decision Engine Protocol Preservation (`toEngineProtocol`):**
  - Strictly preserves the existing JSON contract:
    ```javascript
    toEngineProtocol() {
      return {
        incident_id: this.incidentId,
        latitude: this.latitude,
        longitude: this.longitude,
        incident_node_osm_id: this.incidentNodeOsmId || null,
        // ...
      };
    }
    ```
  - Zero modification to C++ engine input schemas, Dijkstra routing, or Strongly Connected Components.
- **Backward Compatibility:**
  - Full support for legacy coordinate-only POST payloads omitting `locationName`.
  - When provided, `locationName` is persisted and returned in incident envelopes (`createIncident`, `getIncidentById`, `getMyIncidents`, `listIncidents`).

---

## 6. Resource Station Map Labels & Tactical Transparency

To eliminate ambiguity between stationary base depots and real-time vehicle GPS:

- **Station Name Normalizer (`client/src/utils/stationUtils.js`):**
  - Standardizes simulated station labels:
    - `DEPOT-AIIMS-01` &rarr; `AIIMS Depot — Simulated Station`
    - `STATION-BASNI-02` &rarr; `Basni Depot — Simulated Station`
    - `DEPOT-PAOTA-03` &rarr; `Paota Depot — Simulated Station`
    - `DEPOT-SHASTRI-04` &rarr; `Shastri Nagar Depot — Simulated Station`
    - `POST-JALORI-05` &rarr; `Jalori Gate Depot — Simulated Station`
- **Control Room Tactical Map & Resource Fleet Page:**
  - Displays unit type, ID, simulated station, operational availability status, and an explicit disclaimer:
    > *"Stationary simulated base depot · Live vehicle telemetry is not connected."*
- **Control Room Incident Detail Page Diagnostics:**
  - Displays the citizen's reported place-name reference (`incident.locationName`).
  - Exposes road-network snap point diagnostics (`OSM Node #${incident.incidentNodeOsmId}`) with transparency text explaining that this is a topological routing node on the C++ road graph, not real-time GPS telemetry from the citizen's mobile device.

---

## 7. Automated Test Suite & Regression Verification

### 7.1 Client Test Suite (`client/tests/locationSearchWorkflow.test.js`)
All 15 required test areas verified across 19 assertions:

| # | Test Area | Status | Description |
|---|-----------|--------|-------------|
| 1 | Valid Place-Name Search | **PASS** | Queries `/location/search`, unrolls results with coordinates and tags. |
| 2 | Short/Empty Query Guard | **PASS** | Queries < 2 chars return empty array without triggering network calls. |
| 3 | Keystroke Debouncing | **PASS** | Collapses rapid keystrokes within 350ms into a single execution. |
| 4 | Repeated-Query Caching | **PASS** | Resolves repeated queries from cache with 0 redundant API calls. |
| 5 | Empty Search Results | **PASS** | Safely handles unresolvable queries returning empty array. |
| 6 | Provider Failure Handling | **PASS** | Gracefully handles 500/503 upstream errors enabling manual pin fallback. |
| 7 | Polygon Ray-Casting Filter | **PASS** | Accurately classifies points inside vs outside Jodhpur polygon proxy. |
| 8 | Out-of-Area Guard | **PASS** | Out-of-service area places block form submission. |
| 9 | Form State Population | **PASS** | Place selection populates `latitude`, `longitude`, and `locationName`. |
| 10 | Map Center Synchronization | **PASS** | Leaflet center aligns with selected place coordinates. |
| 11 | Marker Drag Updates | **PASS** | Dragging marker updates coordinates and appends `(Pin Refined)`. |
| 12 | Drag Boundary Warning | **PASS** | Dragging marker outside boundary updates warning banner. |
| 13 | Map Click Updates | **PASS** | Clicking map updates marker coordinates and retains place name reference. |
| 14 | Invalid Coordinates Guard | **PASS** | Rejects `NaN`, `null`, and out-of-range coordinates. |
| 15 | Legacy Coordinate Payload | **PASS** | Submits valid incident without `locationName` (backward compatibility). |
| 16 | New `locationName` Payload | **PASS** | Submits valid incident with `locationName` and verifies persistence. |
| 17 | Resource Station Labels | **PASS** | Formats all 5 simulated depots with standardized station titles. |
| 18 | Rate Limit 429 Handling | **PASS** | Normalizes backend 429 rate limit response. |
| 19 | Timeout 504 Handling | **PASS** | Normalizes 504 gateway timeout response. |

### 7.2 Full Regression Test Execution Summary

- **Backend Test Suite (`npm --prefix server test`):**
  - **235 passed**, 0 failed (70 test suites, duration: 36.7s).
  - Includes `server/tests/locationSearch.test.js` (8 assertions covering rate limiting, caching, polygon filtering, and controller validation).
- **Frontend Test Suite (`npm --prefix client test`):**
  - **111 passed**, 0 failed (46 test suites, duration: 1.36s).
  - Includes `client/tests/locationSearchWorkflow.test.js` (19 assertions).
- **Frontend Production Build (`npm --prefix client run build`):**
  - `vite build` completed cleanly in 13.50s (0 errors, 1748 modules transformed).

---

## 8. Compliance & Boundary Guarantees

1. **Nominatim Fair Use:** Minimum 1,050ms outbound interval, identifiable User-Agent, bounding box biasing, and 24-hour LRU caching strictly adhered to.
2. **C++ Algorithm & Protocol Invariance:** Zero changes made to C++ Dijkstra, SCC component analysis, spatial snapping, or JSON serialization contracts.
3. **Database Integrity:** No modifications to existing seed scripts, migrations, or database collections.
4. **Transparency Integrity:** Academic simulation labels and stationary depot disclaimers maintained throughout all views.
