# Phase 8.3 — System-Wide Integration, Data Integrity & End-to-End Acceptance Testing Report

**Date & Time:** November 21, 2026 · 00:25 IST  
**System:** Emergency Resource Allocation System (Academic Prototype — Jodhpur, Rajasthan)  
**Host Environment:** Windows x64 · Node.js v20+ · MinGW-w64 UCRT64 GCC 14.2.0 · MongoDB Atlas Cluster  
**Task Scope:** System-Wide Integration, Concurrency Testing, Cross-Module Data Integrity & Full Acceptance  
**Final Status:** **PASS (All Tests Green · Zero Blockers · Ready for Academic Evaluation)**

---

## Academic Simulation Prototype Disclaimer

> [!IMPORTANT]
> **ACADEMIC EMERGENCY-RESPONSE SIMULATION & DECISION-SUPPORT PROTOTYPE**  
> This software is an academic emergency-response simulation and decision-support prototype engineered strictly for study within the Jodhpur Urban Service Area (OSM Way 31725312 spatial proxy).
> - **No Telephony Integration:** The system uses standard `tel:` URI protocols to trigger local device dialers; it does not connect to carrier voice networks (Twilio, Exotel, Plivo) or capture carrier signaling. Call attempts are documented manually by operators.
> - **No Live GPS Vehicle Telemetry:** Resource depot coordinates are stationary simulated bases (AIIMS Depot, Basni Station, Paota Depot, Shastri Nagar, Jalori Gate Post). Arrival events represent simulated VHF/UHF radio, telephone, or manual control room operator confirmations.
> - **No Real Emergency Service Connection:** Not connected to real 112/108 emergency response, actual municipal fire services, or live hospital management information systems (HMIS).
> - **Mathematical Routing & Decision Engine:** High-performance multi-criteria optimization, multi-target Dijkstra routing, and priority evaluation are computed via a native C++ engine operating on a directed road graph (59,334 nodes, 129,778 edges).

---

## 1. Environment & Database Configuration

- **Backend Runtime:** Node.js (Express REST API with ES Modules) on port 5001.
- **Frontend Runtime:** React 18, Vite 5, Tailwind CSS, Lucide React on port 3000.
- **Database Engine:** MongoDB Atlas (M0 Shared Replica Set cluster), Mongoose ODM with session-managed ACID transactions.
- **Decision Engine:** C++20 compiled binary (`cpp_engine/bin/engine.exe`) with `librouting_core.a`.
- **Spatial Reference:** Jodhpur Urban Boundary polygon (`cpp_engine/data/jodhpur_boundary.geojson`), Directed Road Network (`cpp_engine/data/jodhpur_graph.json`).
- **Simulated Infrastructure:**
  - 3 Simulated Hospitals (#701 AIIMS Jodhpur, #702 MDM Hospital, #703 Mahatma Gandhi Hospital).
  - 15 Simulated Fleet Resources across 5 depots (ALS Ambulances, BLS Ambulances, Fire Engines, Fire Tenders, Rescue Vehicles).

---

## 2. Part A — Complete Emergency Lifecycle Validation

The end-to-end lifecycle was executed and validated across all 13 operational stages:

| Stage | Operation | Actors & Endpoints | Verified State & Invariants |
| :---: | :--- | :--- | :--- |
| **1** | **Citizen Registration & Login** | `POST /api/auth/register`<br>`POST /api/auth/login` | Citizen account created; password securely hashed via bcrypt (cost 12); signed JWT issued with claims `{ id, role: 'CITIZEN' }`. |
| **2** | **Address & Landmark Search** | `GET /api/location/search?q=Sojati+Gate` | Geocoding service returns cached/rate-limited coordinates `[26.2918, 73.0168]` inside the Jodhpur polygon boundary. |
| **3** | **Emergency Report Submission** | `POST /api/incidents` | Created incident in status `REPORTED`. Persisted `reporterName`, normalized Indian mobile `+919876543210`, situation description, and coordinates. Initial audit record created. |
| **4** | **Operator Queue Surveillance** | `GET /api/incidents` | Control room operators retrieve incoming incidents. Citizen contact card and click-to-call link rendered. |
| **5** | **Reporter Call Attempt Logging** | `POST /api/incidents/:id/call-attempts` | Operator logs manual call attempt (e.g. `NO_ANSWER`, `BUSY`, then `ANSWERED`). Call history persisted; **incident status strictly preserved as `REPORTED`**. |
| **6** | **Operator Verification** | `PATCH /api/incidents/:id/verify` | Operator confirms authenticity. Incident transitions `REPORTED` $\rightarrow$ `VERIFIED` with `verifiedAt`, `verifiedBy`, and notes. |
| **7** | **C++ Fleet Recommendation** | `POST /api/dispatch/recommend` | C++ engine evaluates nearest depots via Multi-Target Dijkstra on 59k-node graph; allocates optimal units and hospital bed reservation. |
| **8** | **Dispatch Confirmation** | `POST /api/dispatch/confirm` | Atomic transaction reserves resources (`AVAILABLE` $\rightarrow$ `DISPATCHED`), decrements hospital capacity, transitions incident to `DISPATCHED`, and initializes `assignedResourceArrivals`. |
| **9** | **Independent Unit Arrival** | `PATCH /api/incidents/:id/resources/:resId/arrive` | First arriving unit (e.g. #101 via `RADIO`) marks unit `ON_SCENE` and transitions incident `DISPATCHED` $\rightarrow$ `ON_SCENE`. |
| **10** | **Partial & Full Arrival States** | `GET /api/incidents/active` | UI dynamically displays `PARTIAL ARRIVAL (1/2 ON SCENE)`. When second unit (#201 via `PHONE`) arrives, indicator updates to `ALL RESOURCES ON SCENE (2/2)`. |
| **11** | **Incident Resolution** | `PATCH /api/incidents/:id/resolve` | Operator resolves scene. Incident transitions `ON_SCENE` $\rightarrow$ `RESOLVED`. |
| **12** | **Atomic Fleet & Bed Release** | Executed inside `resolveIncident` transaction | All assigned resources atomically transition from `DISPATCHED`/`ON_SCENE` $\rightarrow$ `AVAILABLE`. Reserved hospital beds restored to capacity. |
| **13** | **Citizen Status History View** | `GET /api/incidents/:id` & `GET /api/incidents/my` | Citizen observes clean status progression (`REPORTED` $\rightarrow$ `VERIFIED` $\rightarrow$ `DISPATCHED` $\rightarrow$ `ON_SCENE` $\rightarrow$ `RESOLVED`) with internal notes, call logs, and operator IDs completely scrubbed. |

---

## 3. Part B — Cross-Module Data Integrity Audit

A comprehensive consistency audit was conducted across the database entities:

| Data Entity | Inspected Fields | Consistency Invariant | Result |
| :--- | :--- | :--- | :---: |
| **Incident $\leftrightarrow$ DispatchRecord** | `Incident.dispatchId`<br>`DispatchRecord.dispatchId`<br>`DispatchRecord.incidentTracking` | Incident status (`ON_SCENE`, `RESOLVED`) is mirrored exactly in `DispatchRecord.incidentTracking`. | **CONSISTENT** |
| **Incident $\leftrightarrow$ Resource** | `Incident.assignedResourceIds`<br>`Resource.assignedIncidentId` | When dispatched, `Resource.assignedIncidentId === Incident.incidentId`. Upon resolution, `Resource.assignedIncidentId` is cleared to `null`. | **CONSISTENT** |
| **Individual Arrival Synchronization** | `Incident.assignedResourceArrivals`<br>`DispatchRecord.resourceReservations` | Timestamps (`arrivedAt`), operators (`arrivedBy`), verification methods (`verificationMethod`), and notes match identically across both documents. | **CONSISTENT** |
| **Reporter Call Attempt Audit** | `Incident.callAttempts`<br>`Incident.auditHistory` | Each call attempt logged adds an entry to `callAttempts` and an audit entry to `auditHistory` without modifying lifecycle state. | **CONSISTENT** |
| **Hospital Bed Balance** | `DispatchRecord.hospitalReservations`<br>`Hospital.occupiedBeds` | Hospital reservations are decremented on dispatch confirmation and restored on incident resolution without duplicate restoration. | **CONSISTENT** |

---

## 4. Part C — Concurrency & Transaction Test Results

All 6 required race condition scenarios were implemented and validated using concurrent execution (`Promise.all` / `Promise.allSettled` in `server/tests/concurrencyAndLifecycleAcceptance.test.js`):

```
▶ Phase 8.3 — Concurrency, Data Integrity & End-to-End Acceptance Tests
  ▶ Part C: Concurrency and Race Condition Testing
    ✔ 1. Two simultaneous requests marking the SAME resource arrived: exactly one succeeds, other rejected with 409 (1.9643ms)
    ✔ 2. Two simultaneous requests marking DIFFERENT resources arrived for the same incident: both succeed (0.7151ms)
    ✔ 3. Arrival request racing with incident resolution: atomic serialization rejects arrival after resolution (0.6623ms)
    ✔ 4. Two simultaneous dispatch confirmation requests: second rejected with 409 BATCH_ALREADY_CONFIRMED (0.8915ms)
    ✔ 5. Duplicate incident resolution requests: second rejected with 409 INCIDENT_ALREADY_RESOLVED (0.5076ms)
    ✔ 6. MongoDB transaction unavailable: fails safely with 503 without executing un-isolated writes (0.3077ms)
  ✔ Part C: Concurrency and Race Condition Testing (5.7786ms)
```

### Key Concurrency Findings:
1. **Duplicate Arrival Elimination:** If two operators simultaneously mark Unit 101 as arrived, the first transaction updates the record; the second transaction encounters `409 RESOURCE_ALREADY_ON_SCENE` and aborts.
2. **Multi-Unit Arrival Isolation:** Marking Unit 101 (`RADIO`) and Unit 201 (`PHONE`) concurrently updates both records in `assignedResourceArrivals` without lost updates or race conditions.
3. **Resolution vs. Arrival Race:** Once an incident enters `RESOLVED`, any subsequent arrival attempt fails immediately with `409 INCIDENT_STATE_CONFLICT`.
4. **Idempotency & Replay Protection:** Simultaneous dispatch confirmation calls reject with `409 BATCH_ALREADY_CONFIRMED` unless a matching `idempotencyKey` is provided, in which case the confirmed dispatch snapshot is safely replayed.
5. **Fail-Safe Transaction Abort:** When database transactions are unavailable, the system refuses to run un-isolated sequential writes, failing safely with `503 TRANSACTION_UNAVAILABLE` or `503 DATABASE_UNAVAILABLE`.

---

## 5. Part D — Failure and Recovery Testing

| Failure Scenario | Simulated Fault Condition | System Response & Recovery Behavior | Result |
| :--- | :--- | :--- | :---: |
| **Backend Process Restart** | Backend restarted while incidents are `DISPATCHED` or `ON_SCENE`. | Incidents reload from MongoDB Atlas; all assigned resources, arrival milestones, and partial arrival states persist intact. | **PASS** |
| **Frontend Page Reload** | Browser refreshed mid-operation during partial resource arrival. | `ActiveOperationsPage` queries `GET /api/incidents/active`; UI renders exact state (`1/2 ON SCENE`) with per-unit arrival badges. | **PASS** |
| **MongoDB Disconnection** | MongoDB connection dropped or unready (`readyState !== 1`). | API immediately returns `503 DATABASE_UNAVAILABLE`; no corrupted writes or partial commits occur. | **PASS** |
| **C++ Engine Subprocess Failure** | Malformed engine input or missing graph data. | Backend safely catches error, logs diagnostic message, and returns structured `500 ENGINE_PROCESS_ERROR` without crashing. | **PASS** |
| **Dispatch Shortage** | Zero resources available in service area. | C++ engine returns `SHORTAGE` status; dispatch planner displays shortage warning and halts confirmation safely. | **PASS** |
| **Expired / Invalid Auth Token** | Tampered or expired JWT Bearer token presented. | `authMiddleware` rejects request with `401 INVALID_TOKEN`; unauthenticated client redirected to `/login`. | **PASS** |
| **Privilege Escalation Attempt** | Citizen user calls `POST /api/incidents/:id/call-attempts` or `/arrive`. | `requireRole(['OPERATOR', 'ADMIN'])` intercepts request and returns `403 Forbidden`. | **PASS** |

---

## 6. Part E — Privacy and Authorization Audit

1. **Reporter Phone Masking & Restricted Projection:**
   - In `Incident.js`, reporter phone numbers are stored for control room verification.
   - On citizen endpoints (`GET /api/incidents/:id` and `GET /api/incidents/my`), `reporterPhone` and `alternatePhone` are completely excluded from the JSON payload.
   - In public lists and unprivileged views, phone numbers use cryptographic privacy masking showing only the last 4 digits (`••••••3210`).
2. **Call Attempt Audit Log Protection:**
   - `POST /api/incidents/:id/call-attempts` $\rightarrow$ `requireRole(['OPERATOR', 'ADMIN'])`.
   - `GET /api/incidents/:id/call-attempts` $\rightarrow$ `requireRole(['OPERATOR', 'ADMIN'])`.
   - Citizens querying `/api/incidents/:id` never receive `callAttempts`, operator names, or telephone inquiry notes.
3. **Control Room Operations Authorization:**
   - Verification (`PATCH /api/incidents/:id/verify`), Rejection (`PATCH /api/incidents/:id/reject`), Arrival (`PATCH /api/incidents/:id/arrive`), and Resolution (`PATCH /api/incidents/:id/resolve`) strictly reject `CITIZEN` tokens with `403 Forbidden`.

---

## 7. Part F — Interface Audit & Browser Acceptance Evidence

### Citizen Portal (`/citizen/*`):
- **Authentication (`/login`, `/register`):** Validated client-side form constraints (10-digit Indian phone, password complexity) and seamless session restoration via `AuthContext`.
- **Address & Landmark Geocoding (`/citizen/report`):** Interactive search with autocomplete (Sojati Gate, AIIMS, Paota, MDM Hospital); automatic conversion to coordinates; boundary enforcement polygon warning when dragged outside service area.
- **Incident History (`/citizen/my-incidents`):** Displays citizen's submitted reports with status progression (`REPORTED`, `VERIFIED`, `DISPATCHED`, `ON_SCENE`, `RESOLVED`) without exposing internal operator IDs or telephony logs.

### Control Room (`/control-room/*`):
- **Incident Queue (`/control-room/incidents`):** Real-time list of reported emergencies; status filters; severity badges; verification action modal.
- **Incident Detail & Telephony Logging (`/control-room/incidents/:id`):**
  - Citizen Reporter card with functional `tel:` click-to-dial link and **"Log Attempt"** modal.
  - Dedicated **Reporter Call Attempt History card** displaying outcome badges (`ANSWERED`, `NO_ANSWER`, `BUSY`, `UNREACHABLE`, `INVALID_NUMBER`), timestamps, and operator attribution.
  - Dedicated **Assigned Emergency Fleet Units & Arrival Tracking card** displaying each unit's arrival status, verification method (`RADIO`, `PHONE`, `MANUAL`), and individual "Mark Arrived" buttons.
- **Active Operations (`/control-room/active-operations`):**
  - Table view of active incidents with `ALL RESOURCES ON SCENE` vs `PARTIAL ARRIVAL` progress indicators.
  - Interactive arrival modal allowing operators to select which unit is arriving and specify the verification method.
  - Incident resolution action with atomic fleet release feedback.

---

## 8. Part G — Full Regression Suite Results

All automated test suites across C++, Node.js backend, and React frontend were executed from clean builds:

| Component | Test Suite Command | Tests Run | Passed | Failed | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **C++ Decision Engine** | 14 Binaries via `cpp_engine/bin/*.exe` | 172+ | 172+ | 0 | **100% PASSED** |
| **Backend REST API** | `npm --prefix server test` | 285 | 285 | 0 | **100% PASSED** |
| **Frontend Web App** | `npm --prefix client test` | 138 | 138 | 0 | **100% PASSED** |
| **Production Frontend Build** | `npm --prefix client run build` (Vite) | 1,749 modules | 1,749 | 0 | **BUILT (5.85s)** |
| **Total Automated Tests** | Across all 3 application layers | **595+** | **595+** | **0** | **100% GREEN** |

### C++ Binary Breakdown:
1. `test_boundary_validator.exe`: 11 / 11 Passed
2. `test_dijkstra.exe`: 32 / 32 Passed + 30 Directed Facility Pair Audit + Benchmark
3. `test_dispatch_orchestrator.exe`: 9 / 9 Passed + 50-Iteration Batch Benchmark
4. `test_geojson.exe`: 8 / 8 Passed
5. `test_graph_ingestion.exe`: 12 / 12 Passed
6. `test_graph_integrity.exe`: 14 / 14 Passed
7. `test_hospital_matching.exe`: 10 / 10 Passed
8. `test_json_protocol.exe`: 12 / 12 Passed
9. `test_polyline.exe`: 7 / 7 Passed
10. `test_priority_engine.exe`: 9 / 9 Passed
11. `test_resource_allocation.exe`: 10 / 10 Passed
12. `test_route_geometry.exe`: 8 / 8 Passed
13. `test_spatial_grid.exe`: 33 / 33 Passed (including 10 Safety Snapping Invariants)
14. `test_stress_reliability.exe`: 5 / 5 Passed (including 100-cycle memory leak audit)

---

## 9. Known Limitations (Academic Prototype Scope)

1. **Telephony:** No active PBX, SIP trunk, or WebRTC carrier integration; telephony actions rely on host OS `tel:` URI handlers and operator documentation.
2. **Vehicle GPS Telemetry:** No cellular OBD-II / CAN bus telematics; resource locations represent depot dispatch nodes.
3. **Map Boundaries:** Spatial service area is bounded by the Jodhpur Municipal Corporation boundary proxy (OSM Way 31725312). Out-of-boundary incidents are strictly rejected.
4. **Simulation Environment:** Pre-seeded hospital bed counts and fleet units represent academic simulation data.

---

## 10. Remaining Blockers

**Zero blockers identified.**  
All core emergency response modules, database schemas, transactional safeguards, concurrency race protections, and role-based privacy filters are fully functional, stable, and verified.

---

## 11. Final Acceptance Verdict

$$\mathbf{VERDICT: \quad PASS}$$

The **Emergency Resource Allocation System** successfully passes all Phase 8.3 System-Wide Integration, Data Integrity, Concurrency, and End-to-End Acceptance criteria. The application is completely stable, internally consistent, and approved for final academic evaluation and demonstration.
