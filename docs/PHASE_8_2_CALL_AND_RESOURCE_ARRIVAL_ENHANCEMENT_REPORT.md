# Phase 8.2 — Call Attempt Logging & Individual Resource Arrival Tracking Report

## Executive Summary

Phase 8.2 enhances the **Emergency Resource Allocation System** (an academic emergency-response simulation and decision-support prototype for the Jodhpur Urban Service Area) by addressing two critical operational workflows:

1. **Reporter Call Attempt Logging (Part A):** Introduces structured, manual call-attempt documentation for control room operators without conflating telephony attempts with incident verification status. Operators can log outcomes (`ANSWERED`, `NO_ANSWER`, `BUSY`, `UNREACHABLE`, `INVALID_NUMBER`), notes, and timestamps while preserving life-safety dispatch guarantees (an uncontactable reporter never cancels emergency response).
2. **Individual Resource Arrival Tracking (Part B):** Transitions arrival tracking from a monolithic incident-wide flag into granular, per-unit arrival monitoring. Each assigned fleet unit tracks independent arrival milestones, verification methods (`RADIO`, `PHONE`, `MANUAL`), operator attribution, and notes. The overall incident enters `ON_SCENE` upon the first arriving unit, displaying clear `ALL RESOURCES ON SCENE` vs `PARTIAL ARRIVAL` progress metrics.

---

## Academic Simulation Prototype Disclaimer

> [!IMPORTANT]
> **ACADEMIC EMERGENCY-RESPONSE SIMULATION PROTOTYPE**  
> This software is an academic emergency-response simulation and decision-support prototype developed for study within the Jodhpur Urban Service Area (OSM Way 31725312 proxy).
> - **No Telephony Provider Integration:** The system integrates `tel:` URI schemes to launch host device dialers. It does not interface with carrier telephony APIs (Twilio, Exotel, Plivo) or intercept cellular voice telemetry. All call attempts represent structured operator-recorded logs.
> - **No Live GPS Vehicle Telemetry:** Resource coordinates represent stationary base depots (AIIMS, Basni, Paota, Shastri Nagar, Jalori Gate). Arrival events represent simulated radio, cellular, or manual control room check-ins.
> - **Invariable C++ Engine Protocol:** The underlying C++ multi-criteria optimization engine and Dijkstra routing graphs remain completely decoupled and unmodified.

---

## Part A: Reporter Call Attempt Logging

### 1. Architectural Decoupling from Incident Verification

In previous iterations, the click-to-call link launched the device dialer, but operators lacked a structured way to document phone attempts without simultaneously verifying or rejecting the incident.

In Phase 8.2:
- The existing `tel:` click-to-call hyperlink is preserved.
- A dedicated **"Log Call Attempt"** action is introduced on both the Citizen Reporter Information card and the dedicated Call Attempt History card.
- **Strict Decoupling:** Recording a call attempt (even `NO_ANSWER` or `UNREACHABLE`) strictly records an audit log entry. It does **not** alter `incident.status` or `incident.latestVerificationOutcome`.
- **Life-Safety Invariant:** In accordance with emergency dispatch standards, a citizen unable to answer their phone while escaping a fire or medical distress must never have their emergency cancelled as a false alarm. The incident remains in its current status (e.g., `REPORTED`) until verified or dispatched via secondary protocols.

### 2. Canonical Call Attempt Outcomes

The system defines 5 canonical call attempt outcomes in `Incident.js`:

| Outcome | Description | UI Badge Style | Lifecycle Effect |
| :--- | :--- | :--- | :--- |
| `ANSWERED` | Direct contact established; spoke with reporter | Success (`emerald`) | None (Audit Log Only) |
| `NO_ANSWER` | Call rang until timeout; subscriber did not pick up | Warning (`amber`) | None (Audit Log Only) |
| `BUSY` | Line engaged or caller actively declined the call | Secondary (`orange`) | None (Audit Log Only) |
| `UNREACHABLE` | Subscriber switched off, out of coverage, or network failure | Danger (`rose`) | None (Audit Log Only) |
| `INVALID_NUMBER` | Number disconnected, non-existent, or malformed | Danger (`red`) | None (Audit Log Only) |

### 3. Data Schema & Persistence

A dedicated `callAttemptSchema` was added to `server/src/models/Incident.js`:

```javascript
const callAttemptSchema = new mongoose.Schema(
  {
    attemptId: { type: String, required: true },
    incidentId: { type: Number, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    attemptedAt: { type: Date, required: true, default: Date.now },
    phoneCalled: { type: String, required: true },
    outcome: { type: String, enum: CALL_ATTEMPT_OUTCOMES, required: true },
    notes: { type: String, default: '', maxlength: 1000 }
  },
  { _id: false }
);
```

Stored under `Incident.callAttempts` as an array of chronological attempts.

---

## Part B: Individual Resource Arrival Tracking

### 1. Independent Resource Milestones

Emergency response frequently involves multi-unit deployment (e.g., an ALS Ambulance and a Fire Tender). Units arrive at different times depending on depot distance, traffic, and topological routing.

Phase 8.2 implements individual arrival tracking:
- When dispatch is confirmed, each assigned resource is initialized with status `DISPATCHED`.
- In the Control Room (`ActiveOperationsPage.jsx` and `ControlRoomIncidentDetailPage.jsx`), every unit is listed with its individual status badge, dispatch time, arrival time, verification method, and an individual **"Mark Arrived"** action.

### 2. Arrival Verification Methods

The system defines 3 canonical verification methods:

| Method | Identifier | Protocol Description |
| :--- | :--- | :--- |
| **Radio Dispatch** | `RADIO` | VHF/UHF tactical radio check-in from mobile unit |
| **Cellular Phone** | `PHONE` | Direct voice telephone call from responder on scene |
| **Manual Check** | `MANUAL` | Control room operator or on-scene supervisor check-in |

### 3. Incident Lifecycle Transitions

- **First Arrival Transition:** When the *first* assigned unit arrives, the overall incident transitions from `DISPATCHED` $\rightarrow$ `ON_SCENE`.
- **Subsequent Arrivals:** Subsequent unit arrivals update their respective records (`DISPATCHED` $\rightarrow$ `ON_SCENE`) while the incident remains `ON_SCENE`.
- **Arrival Progress Indicators:**
  - `ALL RESOURCES ON SCENE` (green badge, $N/N$ units arrived).
  - `PARTIAL ARRIVAL` (amber badge, $X/N$ units on scene).
  - `DISPATCHED — EN ROUTE` (blue badge, $0/N$ units on scene).
- **Integrity Constraints:**
  - Marking an unassigned resource ID returns `400 RESOURCE_NOT_ASSIGNED_TO_INCIDENT`.
  - Duplicate arrival on an already `ON_SCENE` resource returns `409 RESOURCE_ALREADY_ON_SCENE`.
  - Marking arrival on an undispatched incident returns `409 INCIDENT_STATE_CONFLICT`.
  - Dispatched vehicles remain associated and on-scene until terminal incident resolution (`resolveIncident`), ensuring fleet capacity is never prematurely released.

---

## Part C: Security, Privacy & Role-Based Access Control (RBAC)

1. **Endpoint Protection:**
   - `POST /api/incidents/:id/call-attempts`: Restricted strictly to `OPERATOR` and `ADMIN`.
   - `GET /api/incidents/:id/call-attempts`: Restricted strictly to `OPERATOR` and `ADMIN`.
   - `PATCH /api/incidents/:id/resources/:resourceId/arrive`: Restricted strictly to `OPERATOR` and `ADMIN`.
2. **Citizen Privacy Filtering:**
   - In `getIncidentById`, when requested by a citizen (the reporting user), `callAttempts`, `assignedResourceArrivals`, `reporterPhone`, and `alternatePhone` are completely stripped from the response payload.
   - Citizens only receive safe status history progression (`REPORTED`, `VERIFIED`, `DISPATCHED`, `ON_SCENE`, `RESOLVED`) without operator notes or internal radio check-in logs.

---

## Part D: API Contracts & Endpoints Reference

### 1. Record Call Attempt
- **Endpoint:** `POST /api/incidents/:incidentId/call-attempts`
- **Headers:** `Authorization: Bearer <OPERATOR_JWT>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "outcome": "ANSWERED",
    "notes": "Citizen verified smoke visible from Paota circle commercial building."
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Call attempt recorded successfully",
    "callAttempt": {
      "attemptId": "CALL-1732128000000-abcd1234",
      "incidentId": 1001,
      "performedBy": { "id": "...", "name": "Operator Patel", "role": "OPERATOR" },
      "attemptedAt": "2026-11-20T18:30:00.000Z",
      "phoneCalled": "+919876543210",
      "outcome": "ANSWERED",
      "notes": "Citizen verified smoke visible from Paota circle commercial building."
    },
    "data": { ... }
  }
  ```

### 2. Get Call Attempt History
- **Endpoint:** `GET /api/incidents/:incidentId/call-attempts`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Call attempts retrieved successfully",
    "callAttempts": [ ... ],
    "data": { ... }
  }
  ```

### 3. Mark Individual Resource Arrived
- **Endpoint:** `PATCH /api/incidents/:incidentId/resources/:resourceId/arrive`
- **Headers:** `Authorization: Bearer <OPERATOR_JWT>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "verificationMethod": "RADIO",
    "arrivalNotes": "Ambulance 101 arrived at Paota site; command post active."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Resource 101 marked arrived on scene successfully",
    "data": {
      "incident": {
        "incidentId": 1001,
        "status": "ON_SCENE",
        "allResourcesOnScene": false,
        "onSceneResourceCount": 1,
        "totalAssignedResourceCount": 2,
        "assignedResourceArrivals": [
          {
            "resourceId": 101,
            "resourceType": "ALS_AMBULANCE",
            "status": "ON_SCENE",
            "verificationMethod": "RADIO",
            "arrivedAt": "2026-11-20T18:35:00.000Z"
          },
          {
            "resourceId": 201,
            "resourceType": "FIRE_ENGINE",
            "status": "DISPATCHED",
            "verificationMethod": null,
            "arrivedAt": null
          }
        ]
      }
    }
  }
  ```

---

## Part E: Verification & Test Summary

| Test Domain | Target Suite | Tests Run | Tests Passed | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Unit & Integration** | `server/tests/callAttemptAndArrivalTracking.test.js` | 19 | 19 | 100% Passed |
| **Full Backend Regression** | `server/tests/**/*.test.js` | 277 | 277 | 100% Passed |
| **Frontend Unit & Workflow** | `client/tests/callAttemptAndArrivalWorkflow.test.js` | 8 | 8 | 100% Passed |
| **Full Frontend Regression** | `client/tests/**/*.test.js` | 138 | 138 | 100% Passed |
| **Frontend Production Build** | `npm --prefix client run build` (Vite) | — | — | 10.00s Zero Errors |
| **C++ Engine Invariance** | `server/src/models/Incident.js` (`toEngineProtocol`) | Invariant | Invariant | Verified |

### Core Invariants Confirmed:
1. Logging call attempts does not prematurely transition incidents out of `REPORTED` or alter `latestVerificationOutcome`.
2. First arriving unit transitions the overall incident to `ON_SCENE`; subsequent arrivals update independently without state conflict.
3. Multiple units display individual arrival statuses, timestamps, and verification methods in both Active Operations and Incident Detail views.
4. Privacy is maintained: citizen endpoints reject or sanitize phone numbers and operator call history.
5. C++ routing engine protocols and benchmarked dispatch heuristics remain completely isolated from telephony audit structures.
