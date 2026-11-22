# Emergency Resource Allocation & Response Management System
## Phase 5.4 — Control Room Incident Management & Verification

> [!NOTE]
> **ACADEMIC SIMULATION & DECISION-SUPPORT PROXY DISCLAIMER**  
> This software is an academic engineering simulation and decision-support prototype developed exclusively for educational and research evaluation within the Jodhpur Urban Service Area (Rajasthan, India). It is not affiliated with, certified by, or connected to real-world emergency dispatch services, public safety answering points (PSAP), fire services, police dispatch, or actual hospital bed management authorities. Do not utilize for life-safety critical operations.

---

## 1. Overview & Objectives

Phase 5.4 delivers the complete operator-facing incident verification and triage management workflow by connecting the React 18 control-room frontend directly to the authenticated Express backend incident APIs (`GET /api/incidents`, `GET /api/incidents/:incidentId`, `PATCH /api/incidents/:incidentId/verify`, and `PATCH /api/incidents/:incidentId/reject`).

Key capabilities delivered:
1. **Live Backend-Driven Incident Queue ([`IncidentQueuePage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/IncidentQueuePage.jsx)):** Real-time queue querying `GET /api/incidents`, defaulting to the actionable `REPORTED` queue while supporting status tabs (`ALL`, `REPORTED`, `VERIFIED`, `ALLOCATED`, `DISPATCHED`, `ON_SCENE`, `RESOLVED`, `REJECTED`), emergency category filters, severity selectors, numeric incident ID search, sorting, and pagination.
2. **Dedicated Control Room Incident Detail View ([`ControlRoomIncidentDetailPage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ControlRoomIncidentDetailPage.jsx)):** Operator-authorized inspection view exposing citizen contact details, location on an interactive Leaflet map with canonical Jodhpur boundary polygon overlay, 6-stage lifecycle progression timeline, priority score / tier indicators, and complete immutable audit history logs.
3. **Atomic Incident Verification Protocol:** Operator verification workflow (`PATCH /api/incidents/:id/verify`) allowing optional notes up to 1000 characters, transitioning status from `REPORTED` to `VERIFIED`, with single-flight concurrency locking and 409 conflict detection (`INCIDENT_STATE_CONFLICT`).
4. **Audit-Mandated Incident Rejection Protocol:** Rejection workflow (`PATCH /api/incidents/:id/reject`) requiring a mandatory operational reason (3 to 1000 characters) to filter false alarms and duplicates, transitioning status to `REJECTED`, with client-side length enforcement and 409 conflict detection.
5. **Command & Dispatch Control Room Dashboard ([`ControlRoomDashboard.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ControlRoomDashboard.jsx)):** Replaces static demonstration metrics with authoritative backend database counts (`totalIncidents`, `pendingReported`, `verifiedCount`, `rejectedCount`) and a live chronological feed of the latest recorded emergency reports.
6. **Reusable Custom Hooks & Service Layer:**
   - [`useControlRoomIncidents.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/hooks/useControlRoomIncidents.js): Filtering, pagination, sorting, clean parameter construction, and stale-request protection.
   - [`useControlRoomIncidentDetail.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/hooks/useControlRoomIncidentDetail.js): Deep inspection of single incident reports for operators.
   - [`useIncidentVerification.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/hooks/useIncidentVerification.js): Action dispatching for verification and rejection with concurrency locking, validation, and error normalization.

---

## 2. Authoritative Backend API Contracts Integrated

All requests and responses strictly adhere to the contracts documented in [`docs/API_REFERENCE.md`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/docs/API_REFERENCE.md).

### 2.1 Operator Incident Registry Queue (`GET /api/incidents`)
- **Role Requirement:** `OPERATOR` or `ADMIN` (Bearer JWT)
- **Supported Query Parameters:**
  - `status`: Allowed enum (`REPORTED`, `VERIFIED`, `ALLOCATED`, `DISPATCHED`, `ON_SCENE`, `RESOLVED`, `REJECTED`, `CANCELLED`). Default queue filters by `REPORTED`.
  - `category`: Allowed enum (`FIRE`, `TRAFFIC_ACCIDENT`, `MEDICAL_EMERGENCY`, `HAZMAT`, `STRUCTURAL_COLLAPSE`, `NATURAL_DISASTER`, `CIVIL_DISTURBANCE`, `OTHER`).
  - `severity`: Integer `1` to `5`.
  - `incidentId`: Exact numeric positive integer.
  - `startDate` / `endDate`: ISO 8601 date strings.
  - `page`: Positive integer (default `1`).
  - `limit`: Integer `1` to `100` (default `20`).
  - `sortBy`: `createdAt`, `severity`, `incidentId`, `reportedAt`.
  - `sortOrder`: `asc` or `desc`.
- **Response `200 OK` Structure:**
  ```json
  {
    "success": true,
    "message": "Incident registry retrieved successfully",
    "data": {
      "incidents": [
        {
          "incidentId": 1731895200001,
          "category": "FIRE",
          "severity": 4,
          "victimCount": 2,
          "status": "REPORTED",
          "location": { "latitude": 26.2978, "longitude": 73.0185 },
          "priorityScore": 76.5,
          "priorityTier": "TIER_1",
          "reportedBy": { "id": "6739f...", "name": "Citizen Reporter", "email": "citizen@example.com" },
          "reportedAt": "2026-11-18T02:00:00.000Z",
          "createdAt": "2026-11-18T02:00:00.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 20,
        "totalCount": 1,
        "totalPages": 1
      }
    }
  }
  ```

### 2.2 Operator Incident Detail (`GET /api/incidents/:incidentId`)
- **Role Requirement:** `OPERATOR` or `ADMIN` (or the reporting citizen owner)
- **Response `200 OK` Details:**
  Includes full operator surveillance fields:
  - `reportedBy`: `{ id, name, email }`
  - `verifiedBy` / `rejectedBy`: `{ id, name, email }`
  - `auditHistory`: Chronological array of audit records with `action`, `performedBy` (`{ id, name, role }`), `performedAt`, `notes`, `reason`, `previousStatus`, and `newStatus`.

### 2.3 Global Incident Statistics Aggregation (`GET /api/incidents/stats`)
- **Role Requirement:** `OPERATOR` or `ADMIN` (Bearer JWT)
- **Purpose:** Serves authoritative global status aggregation directly to the Control Room Dashboard via a single MongoDB aggregation pipeline (`$group` by `$status`) without paginated document scanning.
- **Response `200 OK` Structure:**
  ```json
  {
    "success": true,
    "message": "Incident statistics retrieved successfully",
    "data": {
      "totalIncidents": 42,
      "pendingReported": 5,
      "verifiedCount": 12,
      "rejectedCount": 8,
      "allocatedCount": 3,
      "dispatchedCount": 4,
      "onSceneCount": 2,
      "resolvedCount": 8,
      "cancelledCount": 0,
      "activeIncidents": 26,
      "byStatus": {
        "REPORTED": 5,
        "VERIFIED": 12,
        "ALLOCATED": 3,
        "DISPATCHED": 4,
        "ON_SCENE": 2,
        "RESOLVED": 8,
        "REJECTED": 8
      }
    }
  }
  ```

### 2.4 Atomic Verification (`PATCH /api/incidents/:incidentId/verify`)
- **Role Requirement:** `OPERATOR` or `ADMIN`
- **Request Body:**
  ```json
  {
    "verificationNotes": "Caller confirmed 2 vehicles collided near clock tower. Police unit requested."
  }
  ```
- **Constraints:**
  - `verificationNotes`: Optional string up to 1000 characters.
  - Allowed transition: Only incidents in `REPORTED` status can be verified.
  - Concurrency safety: **Atomic conditional update** using `findOneAndUpdate({ incidentId: idNum, status: 'REPORTED' }, ...)` guarantees single-transition execution without requiring a multi-document transaction.
- **Error Codes:**
  - `400 INVALID_VERIFICATION_NOTES`: Non-string payload.
  - `400 VERIFICATION_NOTES_TOO_LONG`: Notes exceed 1000 characters.
  - `404 INCIDENT_NOT_FOUND`: No incident matches the numeric ID.
  - `409 INCIDENT_STATE_CONFLICT`: Incident is already verified, rejected, dispatched, or resolved.

### 2.5 Audit-Mandated Rejection (`PATCH /api/incidents/:incidentId/reject`)
- **Role Requirement:** `OPERATOR` or `ADMIN`
- **Request Body:**
  ```json
  {
    "rejectionReason": "Duplicate report. Already confirmed and dispatched under #1731895200000."
  }
  ```
- **Constraints:**
  - `rejectionReason`: Mandatory string between 3 and 1000 characters.
  - Allowed transition: Only incidents in `REPORTED` status can be rejected.
  - Concurrency safety: **Atomic conditional update** using `findOneAndUpdate({ incidentId: idNum, status: 'REPORTED' }, ...)` guarantees exactly-once rejection without requiring a multi-document transaction.
- **Error Codes:**
  - `400 INVALID_REJECTION_REASON`: Missing or < 3 characters.
  - `400 REJECTION_REASON_TOO_LONG`: Exceeds 1000 characters.
  - `404 INCIDENT_NOT_FOUND`: No incident matches the numeric ID.
  - `409 INCIDENT_STATE_CONFLICT`: Incident is no longer in `REPORTED` status.

---

## 3. Frontend Component Architecture

### 3.1 Incident Verification Queue ([`IncidentQueuePage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/IncidentQueuePage.jsx))
- **Status Pills / Selector:** Quickly toggles between `Actionable Queue (REPORTED)`, `All Incidents`, `Verified`, `Allocated`, `Dispatched`, `On Scene`, `Resolved`, and `Rejected`.
- **Search & Filtering:**
  - Fast numeric Incident ID search with clean input reset.
  - Category and Severity dropdown selectors.
  - Deterministic sort field and sort order controls.
- **Data Table Columns:**
  - Incident ID (hyperlink to `/control-room/incidents/:incidentId`).
  - Category (formatted badge).
  - Severity level (`SeverityBadge`).
  - Citizen Reporter name.
  - Geographic Coordinates (latitude, longitude).
  - Reported Timestamp (formatted locale time).
  - Operational Status (`StatusBadge`).
  - Actions: If `REPORTED`, displays "Verify" and "Reject" modal triggers. For non-REPORTED items, displays "Inspect".
- **Modals:**
  - Verification modal: Displays incident summary, optional notes textarea with counter, and submit button.
  - Rejection modal: Displays terminal warning banner, mandatory reason textarea (min 3 chars), and submit button.
- **Pagination Footer:** Displays `Showing X to Y of Z incidents` with `Prev` and `Next` buttons.

### 3.2 Operator Incident Detail Page ([`ControlRoomIncidentDetailPage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ControlRoomIncidentDetailPage.jsx))
- **Route:** `/control-room/incidents/:incidentId` (Mapped in [`App.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/App.jsx)).
- **Top Actions:** Quick back to queue, refresh button, and inline Verify / Reject action buttons when in `REPORTED` status.
- **6-Stage Lifecycle Timeline:** Visual indicator showing progression:
  $$\text{REPORTED} \longrightarrow \text{VERIFIED} \longrightarrow \text{ALLOCATED} \longrightarrow \text{DISPATCHED} \longrightarrow \text{ON\_SCENE} \longrightarrow \text{RESOLVED}$$
  Terminal alternative statuses (`REJECTED`, `CANCELLED`) are cleanly differentiated.
- **Geospatial Tactical Map:** Interactive Leaflet map displaying marker at exact incident coordinates with the canonical Jodhpur boundary polygon overlay.
- **Citizen Reporter Card:** Displays reporting citizen's name and email for phone verification triage.
- **Audit History Table:** Full immutable history table displaying action, timestamp, operator/citizen name and role, and operational notes/reasons without exposing raw database `_id` hashes.

### 3.3 Command & Dispatch Control Room Dashboard ([`ControlRoomDashboard.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ControlRoomDashboard.jsx))
- **Authoritative Metrics Cards:**
  - **Total Logged Incidents:** Global MongoDB aggregation count across all records.
  - **Pending Verification:** Global count of incidents currently in `REPORTED` status requiring operator attention.
  - **Verified Incidents:** Global count of incidents confirmed ready for fleet dispatch (`VERIFIED`).
  - **Rejected False Alarms:** Global count of filtered duplicate or invalid calls (`REJECTED`).
- **Live Recent Incidents Feed:** Displays latest 5 incidents with direct links to verify or inspect.
- **Tactical Map Preview:** Shows Jodhpur urban area context with OpenStreetMap tiles.

---

## 4. Concurrency Safety & State Conflicts

1. **Atomic Conditional Updates (Single-Document Concurrency):** Verification and rejection operations act on individual incident documents. They employ MongoDB's native atomic conditional update mechanism (`findOneAndUpdate({ incidentId: idNum, status: 'REPORTED' }, ...)`) rather than multi-document transactions. The condition predicate guarantees that if two operators attempt to transition the same incident concurrently, exactly one atomic conditional update succeeds. The second attempt matches zero documents and returns HTTP 409 `INCIDENT_STATE_CONFLICT`.
2. **Client-Side Concurrency Lockout:** The `useIncidentVerification` hook manages `isActionPending`. While an action is in flight, all confirmation buttons are disabled to prevent duplicate submissions.
3. **User Feedback:** When an `INCIDENT_STATE_CONFLICT` (409) occurs, the UI displays a clear notification banner explaining that the incident's status was modified elsewhere, and refetches the latest state from the database.

---

## 5. Test & Verification Summary

### 5.1 Client Automated Test Suite
Test suite [`client/tests/controlRoomWorkflow.test.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/tests/controlRoomWorkflow.test.js) covers:
- Service methods: `listIncidents`, `getIncidentById`, `verifyIncident`, `rejectIncident`, `getIncidentStats`.
- Validation rules: verification notes bound ($\le 1000$), rejection reason bounds ($[3, 1000]$).
- Error normalization: 409 state conflict handling.
- Query parameter construction: stripping empty strings and preserving active filters.
- Lifecycle progression: verifying only `REPORTED` incidents are actionable.
- Data sanitation: displaying operator display names without raw Mongo IDs.
- Global dashboard metric aggregation: calculating global database counts without pagination.

**Result:**
- Total client tests: **73 passed, 0 failed, 0 skipped** across 22 test suites.

### 5.2 Client Production Build
Executed `npm run build --prefix client`:
- Built successfully in 22.21s with Vite v5.4.21.
- Output: `dist/index.html`, `dist/assets/index-BQa_Vp9r.css` (47.36 kB), `dist/assets/index-BscGdLY8.js` (550.19 kB).

### 5.3 Server Regression Test Suite
Executed `npm test --prefix server`:
- Total server tests: **184 passed, 0 failed, 0 skipped** across 60 suites.

### 5.4 Canonical Dataset Integrity Audit
SHA-256 checksums verified against the approved baseline:
- `jodhpur_graph.json`: `057B9D2CB00AF9C16E8A19079587435DB09A581DA64613EBADB466C7509CA89A` (MATCH)
- `jodhpur_roads.geojson`: `C198080F4369786B980BD6D803DC30CC722DF6F72711C0BBBCB5F8A2C8BC756B` (MATCH)
- `jodhpur_boundary.geojson`: `83D704A1B918E5AF3342C949D3B16513AF273F7A5A923DCE98FC94AA6CF974E9` (MATCH)
- `road_network_metadata.json`: `DDD3A00CEBBB91A4469A2DE23ABC2AFDA424030BED14C6061C10BFF7ED39AB3A` (MATCH)
- Zero canonical datasets were altered, moved, or regenerated.

