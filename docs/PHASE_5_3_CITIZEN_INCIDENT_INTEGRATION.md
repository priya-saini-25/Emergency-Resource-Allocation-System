# Emergency Resource Allocation & Response Management System
## Phase 5.3 — Citizen Emergency Reporting & Incident History Integration

> [!NOTE]
> **ACADEMIC SIMULATION & DECISION-SUPPORT PROXY DISCLAIMER**  
> This software is an academic engineering simulation and decision-support prototype developed exclusively for educational and research evaluation within the Jodhpur Urban Service Area (Rajasthan, India). It is not affiliated with, certified by, or connected to real-world emergency dispatch services, public safety answering points (PSAP), fire services, police dispatch, or actual hospital bed management authorities. Do not utilize for life-safety critical operations.

---

## 1. Overview & Objectives

Phase 5.3 delivers the end-to-end citizen emergency reporting and incident tracking workflows by integrating the React 18 client directly with the authenticated Express backend incident APIs (`POST /api/incidents`, `GET /api/incidents/my`, and `GET /api/incidents/:incidentId`).

Key capabilities delivered:
1. **Interactive Jodhpur Map Coordinate Selection:** OpenStreetMap Leaflet integration centered at `[26.2918, 73.0168]` with click-to-pin, visual coordinate display, boundary polygon overlay, and early out-of-area advisory warnings.
2. **Citizen Emergency Reporting Form (`CitizenReportEmergency.jsx`):** Input validation, category and severity mapping, casualty count, description length enforcement, concurrent submission lockout, and immediate submission confirmation card.
3. **Exact Point-in-Polygon Boundary Validation:** Client-side ray-casting point-in-polygon validation against the canonical Jodhpur settlement boundary (OSM Way 31725312 proxy). Distinguishes fast preliminary bounding-box filtering from exact polygon validation. Mandore is treated as an outside-boundary negative control. Form submission is blocked if coordinates establish the point is outside the polygon.
4. **Citizen Incident History (`CitizenMyIncidents.jsx`):** Direct retrieval from `GET /api/incidents/my` with loading skeletons, pagination controls, empty state CTA, and error/retry states.
5. **Role-Sanitized Incident Detail View (`CitizenIncidentDetail.jsx`):** Retrieval from `GET /api/incidents/:incidentId` with a 6-stage operational progression timeline (`REPORTED → VERIFIED → ALLOCATED → DISPATCHED → ON_SCENE → RESOLVED`), handling `REJECTED` and `CANCELLED` as terminal alternatives, embedding an incident location map, and strictly omitting internal operator identities or audit history notes. Never fabricates missing timestamps.
6. **Dynamic Citizen Dashboard (`CitizenDashboard.jsx`):** Aggregates real backend records to calculate total lifetime reports, active emergencies (counting all non-terminal states: `REPORTED`, `VERIFIED`, `ALLOCATED`, `DISPATCHED`, `ON_SCENE`), and resolved incidents (`RESOLVED`), with a live chronological recent report feed.
7. **Modular Incident Service, Lifecycle Utils & Hooks:** Centralized in [`client/src/services/incidentService.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/services/incidentService.js), [`client/src/utils/incidentLifecycle.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/utils/incidentLifecycle.js), and custom hooks (`useMyIncidents`, `useIncidentDetail`, `useIncidentSubmission`) with stale-request race condition guards.

---

## 2. Exact Backend API Contracts Integrated

All requests and responses strictly adhere to the contracts documented in [`docs/API_REFERENCE.md`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/docs/API_REFERENCE.md).

### 2.1 Citizen Emergency Intake (`POST /api/incidents`)
- **Role Requirement:** `CITIZEN` (Authenticated with Bearer JWT)
- **Request Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <JWT_TOKEN>`
- **Request Payload:**
  ```json
  {
    "category": "FIRE",
    "severity": 4,
    "victimCount": 2,
    "description": "Structure fire near Ghanta Ghar market square with heavy smoke.",
    "location": {
      "latitude": 26.2978,
      "longitude": 73.0185
    }
  }
  ```
- **Allowed Categories:**
  - `FIRE` (Structure / Vehicle Fire)
  - `TRAFFIC_ACCIDENT` (Traffic Collision / Road Accident)
  - `MEDICAL_EMERGENCY` (Severe Medical Crisis / Trauma)
  - `HAZMAT` (Hazardous Chemical / Gas Release)
  - `STRUCTURAL_COLLAPSE` (Building / Infrastructure Collapse)
  - `NATURAL_DISASTER` (Severe Weather / Flood Inundation)
  - `CIVIL_DISTURBANCE` (Public Safety Disturbance)
  - `OTHER` (Other Critical Emergency)
- **Allowed Severity:** Integer `1` (Low) to `5` (Critical). Severity selection is user-reported perception for academic simulation purposes (not clinical triage).
- **Victim Count:** Non-negative integer ($\ge 0$).
- **Description:** String $\le 1000$ characters.
- **Coordinates:** Finite numbers with latitude $\in [-90, 90]$ and longitude $\in [-180, 180]$.
- **Response `201 Created`:**
  ```json
  {
    "success": true,
    "message": "Emergency incident reported successfully",
    "data": {
      "incident": {
        "incidentId": 1731895200001,
        "category": "FIRE",
        "severity": 4,
        "victimCount": 2,
        "status": "REPORTED",
        "description": "Structure fire near Ghanta Ghar market square with heavy smoke.",
        "location": {
          "latitude": 26.2978,
          "longitude": 73.0185
        },
        "reportedAt": "2026-11-18T02:00:00.000Z",
        "reportedBy": "6739f77bcf86cd799439011a"
      }
    }
  }
  ```
- **Architectural Invariant:** New citizen reports always start in the `REPORTED` state. No C++ engine dispatch recommendation or resource reservation occurs during intake.

### 2.2 Citizen Incident History (`GET /api/incidents/my`)
- **Role Requirement:** `CITIZEN` (Authenticated with Bearer JWT)
- **Query Parameters:** `page` (integer $\ge 1$, default 1), `limit` (integer 1..50, default 10)
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Citizen incident history retrieved successfully",
    "data": {
      "incidents": [
        {
          "incidentId": 1731895200001,
          "category": "FIRE",
          "severity": 4,
          "victimCount": 2,
          "status": "REPORTED",
          "description": "Structure fire near Ghanta Ghar market square.",
          "location": {
            "latitude": 26.2978,
            "longitude": 73.0185
          },
          "reportedAt": "2026-11-18T02:00:00.000Z",
          "dispatchedAt": null,
          "arrivedAt": null,
          "resolvedAt": null,
          "createdAt": "2026-11-18T02:00:00.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 10,
        "totalCount": 1,
        "totalPages": 1
      }
    }
  }
  ```

### 2.3 Individual Incident Detail (`GET /api/incidents/:incidentId`)
- **Role Requirement:** `CITIZEN` (owner check enforced: `incident.reportedBy === req.user._id`), `OPERATOR`, or `ADMIN`.
- **Response `200 OK` (Role-Sanitized for CITIZEN):**
  ```json
  {
    "success": true,
    "message": "Incident details retrieved successfully",
    "data": {
      "incident": {
        "incidentId": 1731895200001,
        "category": "FIRE",
        "severity": 4,
        "victimCount": 2,
        "status": "VERIFIED",
        "description": "Structure fire near Ghanta Ghar market square.",
        "location": {
          "latitude": 26.2978,
          "longitude": 73.0185
        },
        "reportedAt": "2026-11-18T02:00:00.000Z",
        "verifiedAt": "2026-11-18T02:02:15.000Z",
        "verificationNotes": "Control room verified smoke plume on CCTV.",
        "dispatchedAt": null,
        "arrivedAt": null,
        "resolvedAt": null,
        "createdAt": "2026-11-18T02:00:00.000Z",
        "statusHistory": [
          { "status": "REPORTED", "timestamp": "2026-11-18T02:00:00.000Z" },
          { "status": "VERIFIED", "timestamp": "2026-11-18T02:02:15.000Z" }
        ]
      }
    }
  }
  ```
- **Security & Privacy Boundary:** The response for `CITIZEN` excludes `operatorId`, `verifiedBy`, `dispatchedBy`, `arrivedBy`, `resolvedBy`, `assignedResourceIds`, `assignedHospitalId`, and `auditHistory`. If an unowned incident is requested, the backend returns `403 FORBIDDEN`.

---

## 3. Geographic Boundary & Exact Polygon Validation Architecture

```
   +------------------------------------------------------------------------+
   |                     Interactive Map Location Picker                   |
   |                                                                        |
   |   [User clicks on Leaflet OSM Map] -> Captures verbatim (lat, lng)    |
   |   * Selected marker is NEVER silently moved or altered                 |
   +------------------------------------+-----------------------------------+
                                        |
                                        v
   +------------------------------------------------------------------------+
   |                 Fast Preliminary Bounding Box Check                    |
   |                                                                        |
   |   isWithinJodhpurBoundingBox(lat, lng):                               |
   |   minLat: 26.2059842, maxLat: 26.3536661                              |
   |   minLng: 72.9485753, maxLng: 73.0888716                              |
   |                                                                        |
   |   * Fast preliminary reject if coordinate is outside bounding box     |
   |   * If inside bounding box, proceeds to exact ray-casting             |
   +------------------------------------+-----------------------------------+
                                        |
                                        v
   +------------------------------------------------------------------------+
   |               Exact Ray-Casting Point-in-Polygon Check                 |
   |                                                                        |
   |   isInsideJodhpurPolygon(lat, lng, JODHPUR_BOUNDARY_GEOJSON)           |
   |   Ray-Casting Algorithm across outer rings & interior holes            |
   |   Canonical GeoJSON: cpp_engine/data/jodhpur_boundary.geojson (mirrored)|
   |   Academic Proxy: OSM Way 31725312 (117.68 km² perimeter)             |
   |                                                                        |
   |   * If outside polygon: Clear advisory warning displayed in UI         |
   |   * Blocks form submission if frontend establishes point is outside    |
   +------------------------------------+-----------------------------------+
                                        |
                                        | HTTP POST /api/incidents
                                        v
   +------------------------------------------------------------------------+
   |             Authoritative Backend Geographic Validation                |
   |                                                                        |
   |   isInsideJodhpurBoundary(lat, lng)                                    |
   |   Canonical GeoJSON: cpp_engine/data/jodhpur_boundary.geojson         |
   |   * Inside -> Status 201 Created                                       |
   |   * Outside -> Status 400 OUTSIDE_SERVICE_AREA                         |
   +------------------------------------------------------------------------+
```

### 3.1 Academic Proxy vs Official Municipal Boundary
- The service area polygon is derived from **OSM Way 31725312**, an academic settlement place boundary.
- It is **not** an official Jodhpur Municipal Corporation boundary.
- Prominent landmarks:
  - Clock Tower (Ghanta Ghar) `[26.2978, 73.0185]` — INSIDE polygon.
  - MDM Hospital `[26.2800, 73.0200]` — INSIDE polygon.
  - AIIMS Jodhpur `[26.2550, 73.0050]` — INSIDE polygon.
- Negative controls:
  - Mandore `[26.3550, 73.0400]` — OUTSIDE polygon (negative control).
  - BBox North-West corner `[26.3400, 72.9600]` — INSIDE bounding box, but OUTSIDE actual polygon.
  - BBox South-East corner `[26.2100, 73.0800]` — INSIDE bounding box, but OUTSIDE actual polygon.

---

## 4. Incident Progression Timeline & Status Accounting

### 4.1 Six-Stage Normal Progression Lifecycle
The citizen incident progression timeline strictly models the 6 sequential operational stages:
$$\text{REPORTED} \longrightarrow \text{VERIFIED} \longrightarrow \text{ALLOCATED} \longrightarrow \text{DISPATCHED} \longrightarrow \text{ON\_SCENE} \longrightarrow \text{RESOLVED}$$

- **Completed Stages:** All stages prior to the current active status are marked completed.
- **Current Stage:** The active stage is highlighted with an active pulsating status indicator.
- **Pending Stages:** All stages following the current status remain pending. Future stages are NEVER marked completed.
- **Terminal Alternatives:** `REJECTED` and `CANCELLED` are handled as alternative terminal terminal outcomes with dedicated alert notices and reason summaries.
- **Missing Timestamps:** Timestamps are displayed only when genuinely returned by the backend. No dates are fabricated.

### 4.2 Dashboard Metric Aggregation
- **Active Emergencies:** Non-terminal states: `REPORTED`, `VERIFIED`, `ALLOCATED`, `DISPATCHED`, `ON_SCENE`.
- **Resolved Incidents:** Terminal state: `RESOLVED`.
- **Terminal Exclusions:** `RESOLVED`, `REJECTED`, and `CANCELLED` are strictly excluded from the active emergency count.
- **Audited Note on `QUEUED`:** `QUEUED` was audited across backend controllers and services. It exists as a schema enum in `Incident.js` but has no implemented backend transition. The actual implemented progression uses `ALLOCATED` during recommendation generation and reservation confirmation.

---

## 5. Security and Privacy Invariants

1. **Owner-Restricted Incident Access:** Non-owner citizens querying `/api/incidents/:id` are rejected with HTTP 403 Forbidden.
2. **Sanitized Public Attributes:** Control-room operator user IDs, internal triage notes, priority scoring formulas, and assigned resource IDs are never leaked to citizens.
3. **No Frontend Triage Fabrication:** Client does not generate priority scores or call the C++ engine. Incident intake strictly persists in status `REPORTED`.
4. **Mandatory Academic Disclaimer:** Every citizen page explicitly displays:
   `DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES`
