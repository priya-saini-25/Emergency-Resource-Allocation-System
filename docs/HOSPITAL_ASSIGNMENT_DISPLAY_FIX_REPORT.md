# Hospital Assignment Display Fix & API Contract Integration Report

**Project:** Emergency Resource Allocation & Dispatch Optimization System (Jodhpur Urban Service Area Simulation)  
**Date:** November 22, 2026  
**Status:** COMPLETE & VERIFIED  
**Auditor / Engineer:** Antigravity AI  

---

## 1. Executive Summary

During operational testing of the Control Room Active Operations Dashboard (`/control-room/active-incidents`), active incidents displayed `"None assigned"` under the **Assigned Hospital** column, even when hospital facilities had been successfully recommended by the C++ engine and confirmed during dispatch.

A technical investigation determined that this was **not** an algorithm or database persistence failure, but a **backend API response serialization contract mismatch**:
1. During dispatch confirmation, the backend correctly persisted `assignedHospitalId` on the MongoDB `Incident` document and recorded full reservation metadata (including `hospitalId` and `hospitalName`) on the `DispatchRecord`.
2. However, the active tracking endpoint (`GET /api/incidents/active`) and incident registry endpoints serialized only `assignedHospitalId: inc.assignedHospitalId || null`, omitting the structured `assignedHospital` object.
3. The frontend `ActiveOperationsPage.jsx` expected `row.assignedHospital.hospitalName` (or `row.assignedHospital.name`). Because `assignedHospital` was undefined in the JSON response, the frontend gracefully defaulted to rendering `"None assigned"`.

This fix implemented the expected API contract with bulk hospital lookups, preserved backward compatibility, respected strict role-based access control (RBAC), and updated the frontend renderer to support cross-schema naming (`hospitalName` and `name`).

---

## 2. Root Cause Analysis

```
+-----------------------------------------------------------------------------------------+
|                                    C++ Engine                                           |
| - Matches incidents to nearest eligible hospital with beds                               |
| - Emits hospital recommendation: { hospitalId: 703, hospitalName: "Mahatma Gandhi..." } |
+-----------------------------------------------------------------------------------------+
                                            │
                                            ▼
+-----------------------------------------------------------------------------------------+
|                             Dispatch Confirmation Backend                               |
| - Saves hospitalReservations into DispatchRecord: [{ hospitalId: 703, hospitalName }]    |
| - Updates Incident document: assignedHospitalId = 703                                   |
+-----------------------------------------------------------------------------------------+
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
          [Previous Broken Flow]                         [Rectified Flow]
+-----------------------------------------+   +-----------------------------------------+
| activeIncidentTrackingService.js        |   | activeIncidentTrackingService.js        |
| formatIncidentTrackingResponse:         |   | formatIncidentTrackingResponse:         |
|   assignedHospitalId: 703               |   |   assignedHospitalId: 703               |
|   (assignedHospital object OMITTED)     |   |   assignedHospital: {                   |
|                                         |   |     hospitalId: 703,                    |
|                                         |   |     hospitalName: "Mahatma Gandhi..."   |
|                                         |   |   }                                     |
+-----------------------------------------+   +-----------------------------------------+
                     │                                             │
                     ▼                                             ▼
+-----------------------------------------+   +-----------------------------------------+
| ActiveOperationsPage.jsx (Table Render) |   | ActiveOperationsPage.jsx (Table Render) |
| row.assignedHospital is undefined       |   | row.assignedHospital.hospitalName found |
| Renders: "None assigned"                |   | Renders: "Mahatma Gandhi Hospital"      |
+-----------------------------------------+   +-----------------------------------------+
```

### Key Architectural Findings:
1. **Hospital Model vs DispatchRecord Schema:** The MongoDB `Hospital` model defines the facility name as `name`, whereas `DispatchRecord.hospitalReservations` stores it as `hospitalName`.
2. **N+1 Query Prevention:** Querying `Hospital.findOne` individually for each active incident in a loop would introduce an N+1 query vulnerability under load. The fix collects all unique `assignedHospitalId` values across active incidents and executes a single bulk query: `Hospital.find({ hospitalId: { $in: uniqueIds } }).select('hospitalId name').lean()`.
3. **Role-Based Access Control (RBAC):** Internal hospital assignments, triage facility destinations, and operational resource identifiers are operator-only operational telemetry. In `incidentController.js`, `assignedHospital` and `assignedHospitalId` remain strictly gated to `isControlRoom` (`OPERATOR` and `ADMIN`) roles. Citizen-facing endpoints (`GET /api/incidents/:id` as `CITIZEN`) never expose assigned hospital telemetry.

---

## 3. Files Modified

### A. Backend Services & Controllers
1. **`server/src/services/activeIncidentTrackingService.js`**:
   - In `getActiveIncidents()`: Implemented bulk hospital lookup querying unique `assignedHospitalId` values in a single `Hospital.find()` call and indexed them into a `hospitalMap`.
   - In `markSceneArrival()` and `resolveIncident()`: Populated `assignedHospital` from `dispatchRecord.hospitalReservations` (0 extra queries) or via `Hospital.findOne()` fallback.
   - In `formatIncidentTrackingResponse(inc, hospitalMap)`: Added `assignedHospital: { hospitalId, hospitalName }` alongside the backward-compatible `assignedHospitalId`.
   - Exported `formatIncidentTrackingResponse` for unit testing and modular reuse.

2. **`server/src/controllers/incidentController.js`**:
   - In `getIncidentById()`: Populated `assignedHospital: { hospitalId, hospitalName }` within the `isControlRoom` block while maintaining strict privacy for citizen callers.
   - In `listIncidents()`: Added bulk query for unique hospital IDs and serialized `assignedHospital` for control-room incident listing.

### B. Frontend Dashboard
1. **`client/src/pages/control-room/ActiveOperationsPage.jsx`**:
   - Updated the `Assigned Hospital` column renderer to support both `hosp?.hospitalName` and `hosp?.name`:
     ```jsx
     {
       key: 'assignedHospital',
       header: 'Assigned Hospital',
       render: (hosp) => {
         const hospitalName = hosp?.hospitalName || hosp?.name;
         return (
           <div className="text-xs text-gray-600 max-w-[160px] truncate" title={hospitalName || 'None assigned'}>
             {hospitalName ? (
               <span className="font-medium text-theme-heading flex items-center space-x-1">
                 <Building2 className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
                 <span>{hospitalName}</span>
               </span>
             ) : (
               <span className="text-gray-400">None assigned</span>
             )}
           </div>
         );
       },
     }
     ```

---

## 4. Live Verification of Target Incidents

Querying the running backend service (`http://127.0.0.1:5001/api/incidents/active`) with authorized operator credentials verified that all target incidents from the active session now contain both `assignedHospitalId` and the populated `assignedHospital` object:

### Target Incident 1: `#17953274762873`
- **Category:** `MEDICAL_EMERGENCY`
- **Assigned Hospital ID:** `703`
- **Assigned Hospital Object:**
  ```json
  {
    "hospitalId": 703,
    "hospitalName": "Mahatma Gandhi Hospital (Simulation)"
  }
  ```
- **Display Result:** Renders `"Mahatma Gandhi Hospital (Simulation)"` with building icon.

### Target Incident 2: `#17953263399575`
- **Category:** `FIRE`
- **Assigned Hospital ID:** `702`
- **Assigned Hospital Object:**
  ```json
  {
    "hospitalId": 702,
    "hospitalName": "MDM Hospital Jodhpur (Simulation)"
  }
  ```
- **Display Result:** Renders `"MDM Hospital Jodhpur (Simulation)"` with building icon.

### Target Incident 3: `#17953262752797`
- **Category:** `ROAD_ACCIDENT`
- **Assigned Hospital ID:** `703`
- **Assigned Hospital Object:**
  ```json
  {
    "hospitalId": 703,
    "hospitalName": "Mahatma Gandhi Hospital (Simulation)"
  }
  ```
- **Display Result:** Renders `"Mahatma Gandhi Hospital (Simulation)"` with building icon.

### Live Browser Visual Inspection Results
A live visual audit of the Active Operations dashboard was conducted in an automated browser session at `http://localhost:3001/control-room/active-incidents`.

- **Live Session Verification:**
  - Authenticated as: `operator@jodhpur.emergency.gov.in`
  - URL: `http://localhost:3001/control-room/active-incidents`
  - `#17953274762873` (MEDICAL EMERGENCY): Verified displaying `"Mahatma Gandhi Hospital (Simulation)"`
  - `#17953263399575` (FIRE): Verified displaying `"MDM Hospital Jodhpur (Simulation)"`
  - `#17953262752797` (ROAD ACCIDENT): Verified displaying `"Mahatma Gandhi Hospital (Simulation)"`
  - Zero instances of `"None assigned"` for allocated incidents.
- **Verification Screenshot Saved:** `docs/active_operations_hospital_display_verified.png`
- **Session Video Artifact:** `recording.mp4`

---

## 5. Automated Test Suites & Regression Evidence

### A. Dedicated Backend Contract Tests
File: `server/tests/hospitalAssignmentContract.test.js`  
Command: `node --test server/tests/hospitalAssignmentContract.test.js`  
**Result:** **9 / 9 passed (0 failures, 12.6ms)**

Covered scenarios:
1. Incident with assigned hospital returns hospital ID and `hospitalName`.
2. Incident without assigned hospital returns `assignedHospital: null`.
3. Multiple incidents with different hospitals return correct hospital names in bulk.
4. Multiple incidents assigned to the same hospital deduplicate queried hospital IDs in bulk query.
5. Missing hospital record (`assignedHospitalId: 9999`) safely returns `assignedHospital: null` without crashing.
6. Backward compatibility: `assignedHospitalId` remains available alongside `assignedHospital`.
7. Citizen RBAC & privacy: `GET /api/incidents/:id` as `CITIZEN` never exposes `assignedHospital` or `assignedHospitalId`.
8. Operator RBAC: `GET /api/incidents/:id` as `OPERATOR` exposes populated `assignedHospital`.
9. Incident registry: `GET /api/incidents` list populates `assignedHospital` via bulk lookup.

### B. Full Backend Regression Suite
Command: `npm --prefix server test`  
**Result:** **294 / 294 passed (0 failures, 84 test suites)**  
All previous suites (active incident tracking, dispatch execution, RBAC, auth, hardening, seeders) passed with zero regressions.

### C. Dedicated Frontend Unit Tests
File: `client/tests/ActiveOperationsHospitalDisplay.test.js`  
Command: `node --test client/tests/ActiveOperationsHospitalDisplay.test.js`  
**Result:** **6 / 6 passed (0 failures, 2.7ms)**

Covered scenarios:
1. Renders `hospitalName` and correct tooltip title when `assignedHospital` contains `hospitalName`.
2. Falls back to `"None assigned"` when `assignedHospital` is null.
3. Falls back to `"None assigned"` when `assignedHospital` is undefined.
4. Falls back to `"None assigned"` when `assignedHospital` is an empty object.
5. Cross-schema support: handles `hosp.name` for MongoDB `Hospital` model documents.
6. Validates rendering against all live target incidents.

### D. Full Client Regression Suite
Command: `npm --prefix client test`  
**Result:** **144 / 144 passed (0 failures, 57 test suites)**  
All frontend workflows (call attempt logging, per-resource arrival, control room incident management, location search, reporter verification) passed cleanly.

### E. Frontend Production Build
Command: `npm --prefix client run build`  
**Result:** **SUCCESS (0 errors, built in 7.61s)**

---

## 6. Architecture & Academic Simulation Integrity

- **C++ Dispatch Engine:** Untouched. No algorithms, priority weights, or matching heuristics were modified.
- **Hospital Bed Capacity & Reservations:** Untouched. Bed reservation formulas and arrival/release logic remain unchanged.
- **Academic Simulation Disclaimer:** The application maintains all simulation notices across citizen and control room interfaces.

---

## 7. Conclusion

The hospital assignment display issue has been resolved at both the API contract and frontend display layers. The Active Operations dashboard now accurately reflects C++ hospital allocation outcomes across all categories of emergency incidents.
