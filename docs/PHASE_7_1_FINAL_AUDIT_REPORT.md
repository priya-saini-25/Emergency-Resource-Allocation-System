# Phase 7.1: Location Search Safety Audit — Final Audit Report

**Project:** Emergency Resource Allocation System (Academic Simulation Prototype)  
**Target City:** Jodhpur, Rajasthan, India  
**Date:** November 20, 2026  
**Audit Classification:** FOCUSED SAFETY AUDIT  
**Overall Status:** PASS  

---

## 1. Executive Summary

This audit evaluates the safety, reliability, and boundary compliance of the recently implemented Phase 7 Citizen Location Search, Place-Name Geocoding, and Interactive Map Integration.

All audit areas were evaluated using automated unit, integration, and regression test suites across both frontend and backend architectures, as well as strict static code audits.

---

## 2. Audit Findings Matrix

| Section | Audit Criteria | Classification | Summary of Findings |
|---|---|:---:|---|
| **1.1** | Out-of-Service Search Marking | **PASS** | Places outside the canonical boundary are tagged `isInsideServiceArea: false` and display an Amber badge (*"Outside Boundary"*). |
| **1.2** | Out-of-Service Form Selection Guard | **PASS** | Selecting an outside location sets `fieldErrors.latitude` and `fieldErrors.location`, updates boundary warning, and blocks submission. |
| **1.3** | Backend Geographic Submission Guard | **PASS** | `createIncident` strictly rejects outside coordinates with HTTP 400 `OUTSIDE_SERVICE_AREA`. |
| **1.4** | Marker Dragging Boundary Revalidation | **PASS** | Dragging marker outside boundary polygon triggers immediate ray-casting pre-validation, displays warning, and blocks form submission. |
| **2.1** | Stale Response Discarding (Race Conditions) | **PASS** | `latestRequestIdRef` tracking ensures slower older responses cannot overwrite newer search results. |
| **2.2** | Debounce Cancellation on Input Change | **PASS** | Input change clears `debounceTimerRef` and invalidates in-flight request IDs. |
| **2.3** | Repeated Query Caching | **PASS** | 24-hour LRU in-memory cache resolves repeated queries in < 2ms without outbound HTTP calls. |
| **2.4** | Nominatim 1,050ms Rate Limit Interval | **PASS** | Outbound requests are strictly serialized and enforce >= 1,050ms minimum gap. |
| **2.5** | Concurrency Serialization | **PASS** | Concurrent requests chain onto a serialized Promise queue (`requestQueue.then(run, run)`). |
| **2.6** | Provider Timeout & Malformed Responses | **PASS** | 4,000ms `AbortController` timeout and try/catch error normalization prevent unhandled crashes. |
| **2.7** | Rate Limiter Architecture Transparency | **PASS** | Documented that the in-memory rate limiter is process-local and not distributed. |
| **3.1** | Search Coordinates Align with Map Marker | **PASS** | Place selection updates coordinates and smoothly re-centers Leaflet map marker via `MapViewRecenter`. |
| **3.2** | Marker Drag Updates Form | **PASS** | `dragend` updates numeric coordinates and appends `(Pin Refined)`. |
| **3.3** | Map-Click Updates Form | **PASS** | Map clicks update numeric coordinates and validate polygon boundary. |
| **3.4** | Place Name Reference Retention | **PASS** | `locationName` is preserved as a human-readable operational reference. |
| **3.5** | Verbatim Coordinates Sent to Backend | **PASS** | Form submits numeric latitude and longitude to backend API. |
| **3.6** | Legacy Coordinate-Only Backward Compatibility | **PASS** | Payloads without `locationName` continue to be processed and stored safely. |
| **4.1** | Documentation Consistency | **PASS** | `PHASE_7_LOCATION_SEARCH_IMPLEMENTATION_PLAN.md` and `PHASE_7_VERIFICATION_REPORT.md` exist and align. |
| **5.1** | Backend Regression Suite | **PASS** | 236/236 tests passed (70 test suites, 0 failures). |
| **5.2** | Frontend Regression Suite | **PASS** | 112/112 tests passed (46 test suites, 0 failures). |
| **5.3** | Frontend Production Build | **PASS** | `vite build` succeeded cleanly (1748 modules transformed). |
| **6.1** | Browser UI Telemetry | **NOT VERIFIED** | Verified via automated DOM/test harnesses; live human browser execution was not performed. |

---

## 3. Detailed Audit Sections

### Section 1: Out-of-Service-Area Selection
- **Visual Distinction:** Candidates resolved via `/api/location/search` that fall outside the OSM Way 31725312 polygon (e.g. Mandore Garden at `26.3550° N, 73.0400° E`) are tagged with `isInsideServiceArea: false` and display an Amber `Outside Boundary` badge with an `AlertTriangle` icon.
- **Frontend Selection Enforcement:** When an out-of-boundary place is clicked, `CitizenReportEmergency.jsx` runs `isInsideJodhpurPolygon`, sets `fieldErrors.latitude` and `fieldErrors.location`, and updates `boundaryWarning`. The submit handler `validateForm()` checks polygon containment again and prevents submission.
- **Backend Authoritative Enforcement:** In `server/src/controllers/incidentController.js`, `createIncident` validates `isInsideJodhpurBoundary(latNum, lngNum)`. If false, it immediately returns HTTP 400 with `{ code: 'OUTSIDE_SERVICE_AREA' }`. Frontend validation is never solely relied upon.
- **Marker Drag Refinement:** Dragging the pin outside the boundary fires `handleMapLocationSelect`, immediately flagging the coordinates as outside the supported polygon and blocking submission until corrected.
- **Classification:** **PASS**

### Section 2: Search Request Reliability
- **Race Condition Prevention:** In `LocationSearchInput.jsx`, `latestRequestIdRef` records each dispatched request ID. Slower older responses arriving after newer keystrokes are discarded immediately:
  ```javascript
  if (currentRequestId !== latestRequestIdRef.current) return;
  ```
- **Debounce Cancellation:** Clearing input or typing before the 350ms window elapses calls `clearTimeout(debounceTimerRef.current)` and increments `latestRequestIdRef.current`.
- **Caching & Landmarks:** Common emergency hubs (*AIIMS Jodhpur, Sojati Gate, MDM Hospital, Sardarpura, Paota*) are served from pre-seeded landmarks (< 2ms) and dynamic 24-hour LRU cache.
- **Rate Limit Interval:** Outbound requests to Nominatim pass through `scheduleOutboundRequest`, which enforces `NOMINATIM_MIN_INTERVAL_MS = 1050`. Test 8 in `server/tests/locationSearch.test.js` verified that concurrent requests maintain >= 1,000ms spacing.
- **Fail-Safe Timeout:** Outbound requests are governed by a 4,000ms `AbortController` timeout. If the upstream provider fails (500/503/timeout), an empty results array is returned gracefully and the citizen is prompted to pin directly on the map.
- **Process-Local Architecture Limitation:**
  > [!IMPORTANT]
  > The in-memory token-bucket rate limiter and query cache in `geocodingService.js` are **process-local** (single Node.js process). If deployed across multiple clustered or containerized backend instances, a distributed rate-limiting tier (e.g., Redis leaky bucket) would be required to prevent aggregate outbound request bursts to Nominatim.
- **Classification:** **PASS**

### Section 3: Coordinate and Marker Consistency
- **Coordinate Synchronization:** Selecting a suggestion populates `formData.latitude` and `formData.longitude` to 6 decimal places. Leaflet centers on the coordinates without modifying them.
- **Marker Drag & Click:** Moving the marker via drag or map click updates `formData` coordinates and appends `"(Pin Refined)"` to `formData.locationName`.
- **Backend Transmission:** The API payload sends numeric coordinates in `location: { latitude, longitude }`.
- **Backward Compatibility:** Omission of `locationName` in legacy payloads succeeds, and `toEngineProtocol()` continues passing verbatim numeric coordinates without modifying C++ engine schemas.
- **Classification:** **PASS**

### Section 4: Documentation Consistency
- Verified that `docs/PHASE_7_LOCATION_SEARCH_IMPLEMENTATION_PLAN.md` and `docs/PHASE_7_VERIFICATION_REPORT.md` exist and match system behavior.
- **Classification:** **PASS**

### Section 5: Regression Verification
- **Backend Test Suite:** `npm --prefix server test` &rarr; **236 / 236 passed** (70 suites).
- **Frontend Test Suite:** `npm --prefix client test` &rarr; **112 / 112 passed** (46 suites).
- **Frontend Production Build:** `npm --prefix client run build` &rarr; **Built in 6.53s** (0 errors).
- **Scope Constraints:** Zero changes made to C++ routing, Dijkstra, SCC, or database seeds.
- **Classification:** **PASS**

---

## 4. Remaining System Limitations & Notes

1. **Process-Local Rate Limiter:**
   As noted, `scheduleOutboundRequest` is process-local. Clustered deployments will require a Redis-backed rate limiter to ensure multi-instance compliance with Nominatim's 1 req/sec policy.
2. **Academic Polygon Boundary Proxy:**
   Geographic boundary validation uses OSM Way 31725312 as an academic settlement proxy, which does not represent legally notified Jodhpur Municipal Corporation boundaries.
3. **No Live Vehicle GPS:**
   Depot markers represent stationary base facilities (`AIIMS Depot`, `Basni Depot`, `Paota Depot`, `Shastri Nagar Depot`, `Jalori Gate Depot`) and must not be interpreted as live vehicle GPS telemetry.
4. **Live Browser DevTools Observation:**
   All client interactions were verified via headless test runner (`node --test`), component mocks, and Vite production bundle compilation; live interactive browser observation was not performed during this audit turn.
