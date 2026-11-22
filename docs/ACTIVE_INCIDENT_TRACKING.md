# Active Incident Tracking, Scene Arrival & Incident Resolution Architecture

> **ACADEMIC SIMULATION PROXY DISCLAIMER**  
> This software is an academic engineering simulation designed to study multi-criteria decision analysis, graph algorithms, and distributed systems architecture for urban emergency response in Jodhpur, Rajasthan, India. It is not approved or certified for live municipal emergency dispatch.

---

## 1. Executive Summary & Purpose

Phase 4.6 establishes the post-dispatch operational lifecycle for the Emergency Resource Allocation & Response Management System. Once a municipal dispatch recommendation has been reviewed and confirmed by an operator (Phase 4.5), emergency response fleet vehicles are deployed. 

Phase 4.6 enables authorized control room operators to:
1. **Monitor Active Incidents**: Continuously track all incidents currently in active mobilization (`DISPATCHED`) or on-scene operations (`ON_SCENE`).
2. **Mark Scene Arrival**: Record the arrival of emergency units at the incident location, transitioning incident status from `DISPATCHED` $\rightarrow$ `ON_SCENE` with immutable timestamps and operator attribution.
3. **Resolve Incidents**: Formally complete the incident lifecycle (`ON_SCENE` $\rightarrow$ `RESOLVED`), recording final clinical and operational resolution notes.
4. **Safely Release Fleet Resources**: Atomically restore assigned emergency vehicles from `DISPATCHED` back to `AVAILABLE` status with cleared assignment IDs and timestamps, ensuring no resource assigned to another incident is ever inadvertently released.
5. **Safely Restore Hospital Bed Capacities**: Identify exact hospital bed reservations deducted during Phase 4.5 dispatch, restore them to available inventory without exceeding total configured beds, and mark reservations released exactly once.
6. **Maintain Multi-Incident Batch Ledgers**: In multi-incident dispatch batches, manage independent operational lifecycles per incident, updating the parent dispatch status to `PARTIALLY_RESOLVED` and finally `COMPLETED` when all constituent emergencies are resolved.

---

## 2. Complete Incident Lifecycle State Machine

```
              ┌───────────────┐
              │   REPORTED    │ (Citizen Intake)
              └───────┬───────┘
                      │
         [ Operator Verification ]
                      │
                      ▼
              ┌───────────────┐
              │   VERIFIED    │ (Control Room Verification)
              └───────┬───────┘
                      │
      [ Algorithm Recommendation + Batch Confirmation ]
                      │
                      ▼
              ┌───────────────┐
              │  DISPATCHED   │ (Phase 4.5: Resources Reserved)
              └───────┬───────┘
                      │
        [ PATCH /api/incidents/:id/arrive ]
                      │
                      ▼
              ┌───────────────┐
              │   ON_SCENE    │ (Phase 4.6: Units at Scene)
              └───────┬───────┘
                      │
        [ PATCH /api/incidents/:id/resolve ]
                      │
                      ▼
              ┌───────────────┐
              │   RESOLVED    │ (Phase 4.6: Resources & Beds Released)
              └───────────────┘
```

### Transition Invariants & Guard Rules:
- $\text{DISPATCHED} \rightarrow \text{ON_SCENE}$: Allowed only if the incident is currently `DISPATCHED` and belongs to a confirmed dispatch.
- $\text{ON_SCENE} \rightarrow \text{RESOLVED}$: Allowed only if the incident is currently `ON_SCENE`.
- $\text{VERIFIED} \rightarrow \text{RESOLVED}$: **Strictly Prohibited** (HTTP 409 Conflict).
- $\text{DISPATCHED} \rightarrow \text{RESOLVED}$: **Strictly Prohibited** (HTTP 409 Conflict; emergency units must first mark arrival on scene).
- Duplicate transitions (e.g. calling `/arrive` on an `ON_SCENE` incident or `/resolve` on a `RESOLVED` incident) are rejected with HTTP 409 Conflict.

---

## 3. API Contracts

### 3.1 Scene Arrival API
- **Endpoint**: `PATCH /api/incidents/:incidentId/arrive`
- **Authorization**: `OPERATOR`, `ADMIN`
- **Request Headers**: `Authorization: Bearer <JWT>`
- **Request Body** (optional):
  ```json
  {
    "notes": "Ambulance ALS-01 arrived at scene. Triage commenced."
  }
  ```
- **Responses**:
  - `200 OK`:
    ```json
    {
      "success": true,
      "message": "Emergency response units marked arrived on scene successfully",
      "data": {
        "incident": {
          "incidentId": 1001,
          "category": "MEDICAL",
          "severity": 4,
          "status": "ON_SCENE",
          "arrivedAt": "2026-11-18T00:25:00.000Z",
          "dispatchedAt": "2026-11-18T00:15:00.000Z",
          "dispatchId": "DISPATCH-20261118-001"
        },
        "dispatchId": "DISPATCH-20261118-001",
        "dispatchedBatchId": "BATCH-20261118-001"
      }
    }
    ```
  - `400 Bad Request`: Invalid incident ID or notes exceeding 1000 characters.
  - `403 Forbidden`: Authenticated user is `CITIZEN`.
  - `404 Not Found`: Incident ID does not exist in database.
  - `409 Conflict`: Incident not in `DISPATCHED` status or not part of a confirmed dispatch.
  - `503 Service Unavailable`: Database disconnected.

### 3.2 Incident Resolution API
- **Endpoint**: `PATCH /api/incidents/:incidentId/resolve`
- **Authorization**: `OPERATOR`, `ADMIN`
- **Request Headers**: `Authorization: Bearer <JWT>`
- **Request Body** (optional):
  ```json
  {
    "resolutionNotes": "Patient treated on scene and safely admitted to MDM Hospital Trauma ICU."
  }
  ```
- **Responses**:
  - `200 OK`:
    ```json
    {
      "success": true,
      "message": "Incident resolved and assigned resources released successfully",
      "data": {
        "incident": {
          "incidentId": 1001,
          "status": "RESOLVED",
          "resolvedAt": "2026-11-18T00:50:00.000Z",
          "resolutionNotes": "Patient treated on scene and safely admitted to MDM Hospital Trauma ICU."
        },
        "releasedResources": [
          {
            "resourceId": 501,
            "resourceType": "ALS_AMBULANCE",
            "status": "AVAILABLE",
            "releasedAt": "2026-11-18T00:50:00.000Z"
          }
        ],
        "releasedHospitalCapacities": [
          {
            "hospitalId: 701,
            "hospitalName": "MDM Hospital Jodhpur",
            "restoredIcuBeds": 1,
            "restoredGeneralBeds": 1,
            "restoredOxygenBeds": 0,
            "releasedAt": "2026-11-18T00:50:00.000Z"
          }
        ],
        "dispatchSummary": {
          "dispatchId": "DISPATCH-20261118-001",
          "batchId": "BATCH-20261118-001",
          "confirmationStatus": "COMPLETED",
          "completedAt": "2026-11-18T00:50:00.000Z"
        }
      }
    }
    ```
  - `400 Bad Request`: Invalid incident ID or notes exceeding 1000 characters.
  - `403 Forbidden`: Authenticated user is `CITIZEN`.
  - `404 Not Found`: Incident ID does not exist.
  - `409 Conflict`: Incident is not in `ON_SCENE` status.
  - `503 Service Unavailable`: Database disconnected or transactions unavailable.

### 3.3 Active Incident Tracking API
- **Endpoint**: `GET /api/incidents/active`
- **Authorization**: `OPERATOR`, `ADMIN`
- **Query Parameters**:
  - `status`: Filter by `'DISPATCHED'` or `'ON_SCENE'` (defaults to both).
  - `category`: Filter by emergency category (`MEDICAL`, `FIRE`, `ROAD_ACCIDENT`, `INDUSTRIAL`).
  - `severity`: Filter by severity integer (1 to 5).
  - `page`: Page index (default: 1).
  - `limit`: Records per page (default: 20, max: 100).
  - `sortBy`: Field to sort on (`reportedAt`, `dispatchedAt`, `arrivedAt`, `severity`).
  - `sortOrder`: `asc` or `desc` (default: `desc`).
- **Responses**:
  - `200 OK`: Paginated list of matching active incidents.
  - `400 Bad Request`: Invalid filter parameter.
  - `403 Forbidden`: `CITIZEN` role.

---

## 4. Resource Release Semantics & Concurrency Safety

### 4.1 Strict Incident Association Filter
When an incident is resolved, only resources assigned to that specific incident are released. To prevent race conditions or accidentally releasing a resource assigned to another incident, the update specifies both `resourceId` and `assignedIncidentId`:

```javascript
const releasedRes = await Resource.findOneAndUpdate(
  {
    resourceId: resId,
    assignedIncidentId: cleanId, // Strictly associate with this incident
    status: 'DISPATCHED'          // Only release if currently DISPATCHED
  },
  {
    $set: {
      status: 'AVAILABLE',
      assignedIncidentId: null,
      assignedBatchId: null,
      assignedDispatchId: null,
      reservedAt: null,
      dispatchedAt: null
    }
  },
  { session, new: true }
);
```

### Invariants:
1. **No Accidental Release**: If Resource 501 was reassigned or belongs to another incident, `{ resourceId: 501, assignedIncidentId: 1001 }` matches 0 documents and no write occurs.
2. **Idempotency**: Retrying resolution on an already released resource matches 0 documents without altering state.
3. **Atomicity**: If an error occurs while releasing any vehicle in the incident, the entire transaction is aborted, leaving all vehicle assignments intact.

---

## 5. Hospital Capacity Restoration Semantics

### 5.1 Exact Reservation Inspection
During resolution, the backend inspects the stored `DispatchRecord.hospitalReservations` for the incident:
- It checks only entries where `assignedIncidentId === cleanId && !isReleased`.
- If no beds were reserved (`reservedIcuBeds === 0 && reservedGeneralBeds === 0 && reservedOxygenBeds === 0`), no hospital modification is executed.

### 5.2 Capacity Ceiling Protection
To prevent race conditions or administrative adjustments from causing available beds to exceed the configured total capacity:
$$\text{toRestore} = \min(\text{reservedBeds}, \max(0, \text{totalBeds} - \text{availableBeds}))$$

```javascript
const maxRestore = Math.max(0, (hosp.icuBeds.total || 0) - (hosp.icuBeds.available || 0));
const toRestore = Math.min(r.reservedIcuBeds, maxRestore);
if (toRestore > 0) incFields['icuBeds.available'] = toRestore;
```

### 5.3 Idempotent Release Marker
Each reservation entry records:
- `isReleased = true`
- `releasedAt = now`
- `releasedBy = operatorUser._id`

Once `isReleased` is true, subsequent operations ignore the entry, preventing double restoration.

---

## 6. Multi-Incident Batch Handling

A single dispatch batch may mobilize resources for multiple incidents (e.g., a major chemical fire triggering both `INDUSTRIAL` containment and multiple `MEDICAL` triage casualties).

1. **Independent Arrival**: Each incident transitions `DISPATCHED` $\rightarrow$ `ON_SCENE` independently with its own `arrivedAt` timestamp. Marking Incident A arrived leaves Incident B in `DISPATCHED`.
2. **Independent Resolution**: Resolving Incident A releases only Incident A's vehicles and hospital beds. Incident B's vehicles remain `DISPATCHED`.
3. **Dispatch Status Progression**:
   - Initial Confirmation: `CONFIRMED`
   - Some (but not all) incidents resolved: `PARTIALLY_RESOLVED`
   - All incidents resolved: `COMPLETED` (`completedAt` recorded)

---

## 7. Citizen Privacy and Visibility Rules

Citizens who reported an emergency can query their incident via `GET /api/incidents/:incidentId` or `GET /api/incidents/my`.

### Visible to Citizen:
- Current status (`REPORTED`, `VERIFIED`, `DISPATCHED`, `ON_SCENE`, `RESOLVED`, `REJECTED`)
- Safe timestamps: `reportedAt`, `verifiedAt`, `dispatchedAt`, `arrivedAt`, `resolvedAt`
- Safe `statusHistory`: Ordered array of status milestones with timestamps

### Masked from Citizen:
- Operator identities (`verifiedBy`, `dispatchedBy`, `arrivedBy`, `resolvedBy`)
- Internal operator dispatch IDs and batch correlation keys
- Internal operator audit history and clinical triage notes
- Specific fleet vehicle identifier codes

