# Phase 5.5–5.11 Master Implementation Document
## Emergency Resource Allocation & Response Management System
### Academic Decision-Support System — Jodhpur Urban Service Area Proxy

> **DISCLAIMER:** Academic Simulation & Engineering Decision-Support Prototype.  
> This system is **NOT** connected to live emergency services, actual 112/108/101 dispatch networks, real hospital bed management systems, or active GPS vehicle telemetry. All coordinates, response times, hospital occupancies, and operational outcomes represent simulated algorithmic approximations within the Jodhpur Urban Service Area.

---

## 1. Executive Summary & Architectural Overview

The Master Execution covering Phases 5.5 through 5.11 integrates all control-room operator modules, real backend REST APIs, C++17 algorithmic optimization, and Leaflet tactical mapping into a single, cohesive emergency operations interface.

```
+-----------------------------------------------------------------------------------------+
|                                    React 18 Frontend                                    |
|   +-----------------------+  +----------------------+  +----------------------------+   |
|   | DispatchPlannerPage   |  | ActiveOperationsPage |  | TacticalMapPage (Leaflet)  |   |
|   +-----------+-----------+  +----------+-----------+  +-------------+--------------+   |
|               |                         |                            |                  |
|   +-----------+-----------+  +----------+-----------+                |                  |
|   | ResourceFleetPage     |  | HospitalNetworkPage  |                |                  |
|   +-----------+-----------+  +----------+-----------+                |                  |
+---------------|-------------------------|----------------------------|------------------+
                |                         |                            |
                v                         v                            v
+-----------------------------------------------------------------------------------------+
|                              Express.js Backend & API Gateway                           |
|   - /api/dispatch/recommendations (C++ sub-process invocation, max 25 batch validation) |
|   - /api/dispatch/recommendations/:id/confirm (Idempotency-Key, partial dispatch flags) |
|   - /api/incidents/active, /arrive, /resolve (Two-phase state progression & release)    |
|   - /api/resources, /stats, /:id (Fleet inventory & OsmNode assignment)                |
|   - /api/hospitals, /stats, /:id (Capacity tracking & ICU/oxygen metrics)              |
+--------------------------------------------+--------------------------------------------+
                                             |
             +-------------------------------+-------------------------------+
             |                                                               |
             v                                                               v
+--------------------------+                                   +--------------------------+
|     MongoDB Database     |                                   |  C++17 Decision Engine   |
| - Incidents collection   |                                   | - Contraction Hierarchies|
| - Resources collection   |                                   | - Dijkstra Shortest Path |
| - Hospitals collection   |                                   | - Multi-Criteria Knapsack|
| - Dispatches collection  |                                   | - Jodhpur Road Graph     |
+--------------------------+                                   +--------------------------+
```

---

## 2. Stage Breakdown & Module Specifications

### Phase 5.5 — Dispatch Recommendation Interface
- **Primary View:** [DispatchPlannerPage.jsx](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/DispatchPlannerPage.jsx)
- **Backend API:** `POST /api/dispatch/recommendations`
- **Capabilities:**
  - Multi-select interface for verified incidents (`status === 'VERIFIED'`).
  - Batch boundary validation ($1 \le N \le 25$). Rejects unauthorized client payload injections.
  - Subprocess execution of the native C++ decision engine within a 10,000ms ceiling.
  - Interactive route geometry rendering: decodes Google Encoded Polylines into Leaflet coordinate arrays `[[lat, lng], ...]`.
  - Recommendation summary cards highlighting estimated transit durations, unit allocations, and assigned receiving hospitals.

### Phase 5.6 — Dispatch Confirmation & Execution Interface
- **Primary View:** Modal within [DispatchPlannerPage.jsx](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/DispatchPlannerPage.jsx)
- **Backend API:** `POST /api/dispatch/recommendations/:batchId/confirm`
- **Header:** `Idempotency-Key: <UUIDv4>`
- **Capabilities:**
  - Idempotent confirmation prevents double-dispatch upon network retries (201 on new dispatch, 200 on replay with identical key).
  - Explicit operator toggle for `allowPartialDispatch` when some recommended units or beds are constrained.
  - Atomic reservation of assigned resources (`AVAILABLE` $\to$ `DISPATCHED`) and hospital beds.
  - Clear user alerts on transactional conflicts (HTTP 409) or standalone MongoDB environments (HTTP 503 `TRANSACTION_UNAVAILABLE`).

### Phase 5.7 — Active Incident Tracking & Resolution Interface
- **Primary View:** [ActiveOperationsPage.jsx](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ActiveOperationsPage.jsx)
- **Backend APIs:**
  - `GET /api/incidents/active` (strictly queries `DISPATCHED` and `ON_SCENE` incidents)
  - `PATCH /api/incidents/:id/arrive` (transitions `DISPATCHED` $\to$ `ON_SCENE`, records `arrivedAt`)
  - `PATCH /api/incidents/:id/resolve` (transitions `ON_SCENE` $\to$ `RESOLVED`, records `resolvedAt`)
- **Capabilities:**
  - Strict two-phase operational progression: an incident cannot jump directly from `DISPATCHED` to `RESOLVED` without on-scene confirmation.
  - Atomic release of allocated emergency vehicles back to `AVAILABLE`.
  - Capacity restoration for admitted hospital beds bounded by total licensed capacity.
  - Immutable audit trail recording timestamps and operator notes.

### Phase 5.8 — Resource Management Dashboard
- **Primary View:** [ResourceFleetPage.jsx](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ResourceFleetPage.jsx)
- **Backend APIs:**
  - `GET /api/resources` (filtering by status, vehicle type, station; pagination & sorting)
  - `GET /api/resources/stats` (fleet metrics: total, available, reserved, dispatched)
  - `GET /api/resources/:id` (detail inspection)
- **Capabilities:**
  - Real-time fleet status cards using the Slate $\times$ Ice Blue design system.
  - Search by vehicle name or station identifier.
  - Detailed modal presenting stored coordinates, OSM Node ID, vehicle class, and active incident assignment links.
  - Clear visual indicator: *"Static Registered Location (Simulation Proxy — No live GPS tracking)"*.

### Phase 5.9 — Hospital Management Dashboard
- **Primary View:** [HospitalNetworkPage.jsx](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/HospitalNetworkPage.jsx)
- **Backend APIs:**
  - `GET /api/hospitals` (facility listing with pagination & operational filters)
  - `GET /api/hospitals/stats` (network-wide bed availability, ICU beds, oxygen equipment)
  - `GET /api/hospitals/:id` (facility detail)
- **Capabilities:**
  - Aggregate capacity statistics and visual occupancy progress bars.
  - Categorized breakdown: General Beds, ICU Beds, and Oxygen-Equipped Units.
  - Facility modal showing trauma capabilities, burn units, and surgical suites.
  - Clear visual indicator: *"Simulated Capacity Proxy (Not integrated with live hospital HMIS)"*.

### Phase 5.10 — Integrated Geographic Visualization
- **Primary View:** [TacticalMapPage.jsx](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/TacticalMapPage.jsx)
- **Route:** `/control-room/map`
- **Capabilities:**
  - Interactive Leaflet map centered on Jodhpur Urban Service Area `[26.2918, 73.0168]`.
  - Multi-layer toggles:
    - Active Emergencies (color-coded by priority P1–P5)
    - Fleet Depots & Vehicle Units (status-coded)
    - Hospital Network (occupancy-coded)
  - Visual overlay of the authentic Jodhpur administrative boundary polygon.
  - Interactive popups with direct links to Dispatch Planner and Active Operations.

### Phase 5.11 — Complete Workflow Integration & UI/UX Polish
- **Navigation Enhancements:**
  - Updated [ControlRoomLayout.jsx](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/layouts/ControlRoomLayout.jsx) with direct sidebar navigation to Tactical Map, Dispatch Planner, Active Operations, Resource Fleet, and Hospital Network.
  - Updated [ControlRoomDashboard.jsx](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ControlRoomDashboard.jsx) with rapid action shortcuts and system status health monitors.
  - Global simulation banner preserved across all authenticated operator screens.

---

## 3. Data Flow & Polyline Routing Mechanics

When the C++ decision engine generates dispatch recommendations, it calculates optimal routes using the pre-indexed contraction hierarchy over the Jodhpur road network:

1. **Algorithm:** Bi-directional Dijkstra / CH query executed by `cpp_engine/bin/decision_engine`.
2. **Output Serialization:** Route vertex sequences are encoded as Google Encoded Polyline strings (5-decimal precision) to minimize JSON payload size across the subprocess stdout pipe.
3. **Frontend Decoding:** [polylineDecoder.js](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/utils/polylineDecoder.js) unpacks the byte sequence:
   $$\text{lat}_{i} = \text{lat}_{i-1} + \Delta\text{lat}_i \times 10^{-5}$$
   $$\text{lng}_{i} = \text{lng}_{i-1} + \Delta\text{lng}_i \times 10^{-5}$$
4. **Leaflet Polyline Layer:** Rendered as styled blue and red paths with tooltips indicating estimated travel time in minutes.

---

## 4. Canonical Dataset & Algorithmic Invariants

All operations strictly respect the four canonical datasets:

| Dataset Filename | Exact SHA-256 Checksum | Invariant Properties |
|---|---|---|
| `jodhpur_graph.json` | `057B9D2CB00AF9C16E8A19079587435DB09A581DA64613EBADB466C7509CA89A` | 59,334 nodes, 129,778 directed edges |
| `jodhpur_roads.geojson` | `C198080F4369786B980BD6D803DC30CC722DF6F72711C0BBBCB5F8A2C8BC756B` | Canonical road segments |
| `jodhpur_boundary.geojson` | `83D704A1B918E5AF3342C949D3B16513AF273F7A5A923DCE98FC94AA6CF974E9` | Authoritative settlement boundary polygon |
| `road_network_metadata.json` | `DDD3A00CEBBB91A4469A2DE23ABC2AFDA424030BED14C6061C10BFF7ED39AB3A` | Network bounding box & coordinate bounds |

