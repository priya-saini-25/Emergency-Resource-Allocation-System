# Dispatch Execution & Atomic Resource Reservation Architecture

> **ACADEMIC SIMULATION PROXY DISCLAIMER**  
> This software is an academic engineering simulation designed to demonstrate distributed systems architecture, geographic routing algorithms, and decision-support mechanisms for emergency response management in Jodhpur, Rajasthan, India. It is not approved or certified for live municipal emergency dispatch.

---

## 1. Executive Summary & Purpose

In an urban emergency management platform, computing algorithmic recommendations (Phase 4.4) must be strictly separated from committing live municipal resources (Phase 4.5). Algorithms propose optimal fleet allocations, but certified control room operators retain operational authority to review, approve, and confirm execution.

The **Dispatch Execution & Resource Reservation Subsystem** (Phase 4.5) implements this operational commitment. When an operator confirms a recommendation batch, the backend executes an all-or-nothing transactional reservation:
1. Verifies that all incidents remain in `VERIFIED` status.
2. Atomically marks all recommended vehicles as `DISPATCHED`, preventing double-booking.
3. Atomically decrements the corresponding hospital bed capacities (ICU, general, oxygen) where required.
4. Transitions incident lifecycles from `VERIFIED` $\rightarrow$ `ALLOCATED` $\rightarrow$ `DISPATCHED`.
5. Records immutable dispatch execution metadata and append-only audit histories.
6. Automatically aborts and rolls back all writes if any vehicle is no longer available or hospital capacity is insufficient.

---

## 2. Dispatch Confirmation Workflow

```
[ Operator Reviews Stored Recommendation ] (GET /api/dispatch/recommendations/:batchId)
                     │
                     ▼
[ Operator Confirms Execution ] (POST /api/dispatch/recommendations/:batchId/confirm)
  Headers: Idempotency-Key: <UUID>
  Body: { "allowPartialDispatch": false, "confirmationNotes": "Units mobilized" }
                     │
                     ├─────────────────────────────────────────────────┐
                     │ 1. Check Idempotency Key                        │ Key already confirmed?
                     │                                                 ▼
                     │                                    [ Return HTTP 200 OK ]
                     │                                    (Idempotent Replay)
                     ▼
           [ Begin MongoDB Transaction ]
                     │
     ┌───────────────┴───────────────┐
     │ 2. Validate Incidents Status  │ Any incident != VERIFIED?
     │    (Must be VERIFIED)         ▼
     │                      [ Abort & Return 409 ]
     │
     │ 3. Atomic Vehicle Reservation │ Any vehicle != AVAILABLE?
     │    (AVAILABLE -> DISPATCHED)  ▼
     │                      [ Abort & Return 409 ]
     │
     │ 4. Hospital Capacity Reserve  │ Insufficient beds / not OPERATIONAL?
     │    (Decrement available beds) ▼
     │                      [ Abort & Return 409 ]
     │
     │ 5. Incident Transitions       │
     │    (VERIFIED -> DISPATCHED)   │
     │
     │ 6. Update DispatchRecord      │
     │    (CONFIRMED, dispatchId)    │
     └───────────────┬───────────────┘
                     │
                     ▼
           [ Commit Transaction ]
                     │
                     ▼
        [ HTTP 201 Created Response ]
```

---

## 3. Resource Reservation Model & State Invariants

### 3.1. Permitted Resource Lifecycle Transitions
```
   [ AVAILABLE ] ──(Stage 1 Reservation)──► [ RESERVED ] ──(Stage 2 Dispatch)──► [ DISPATCHED ]
         ▲                                                                               │
         │                                                                               ▼
(Phase 4.6 Release) ◄───────────────────────────────────────────────────────────── [ ON_SCENE ]
```

### 3.2. Two-Stage Atomic Conditional Updates
To eliminate race conditions when two operators simultaneously attempt to confirm dispatches competing for the same emergency vehicle, the backend executes a two-stage state transition within the same active MongoDB transaction session:

**Stage 1: Enforce Availability & Transition to RESERVED**
```javascript
const reservedRes = await Resource.findOneAndUpdate(
  {
    resourceId: alloc.resourceId,
    status: 'AVAILABLE' // Precondition invariant
  },
  {
    $set: {
      status: 'RESERVED',
      assignedIncidentId: alloc.targetIncidentId,
      assignedBatchId: batchId,
      assignedDispatchId: dispatchId,
      reservedAt: now
    }
  },
  { session, new: true }
);
```

**Stage 2: Mobilize Resource & Transition to DISPATCHED**
```javascript
const dispatchedRes = await Resource.findOneAndUpdate(
  {
    resourceId: alloc.resourceId,
    status: 'RESERVED' // Enforce immediate reservation ownership
  },
  {
    $set: {
      status: 'DISPATCHED',
      dispatchedAt: now
    }
  },
  { session, new: true }
);
```

### Invariant Guarantees:
- If `reservedRes === null`, the vehicle has already been committed to another incident or is out of service.
- The transaction immediately aborts, rolls back any previously reserved vehicles in the batch, and returns HTTP 409 Conflict (`RESOURCE_ALREADY_COMMITTED`).
- If an abort occurs at any point before transaction commit, all resources are cleanly restored to `AVAILABLE` with assignment fields cleared.
- A vehicle can never belong to more than one active dispatch assignment.
- Both `reservedAt` and `dispatchedAt` timestamps are recorded on the resource document and in the `resourceReservations` ledger.

---

## 4. Hospital Capacity Reservation Semantics

Hospital capacity dimensions are independent clinical units and are never aggregated into a single generic number:
- **ICU Beds (`icuBeds.available`)**
- **General Beds (`generalBeds.available`)**
- **Oxygen-Supported Beds (`oxygenBeds.available`)**

### 4.1. Atomic Capacity Decrements
When an incident recommendation includes patient transport with allocated beds, the corresponding dimensions are conditionally decremented:

```javascript
const query = {
  hospitalId: hId,
  status: 'OPERATIONAL'
};
if (demand.icuBeds > 0) query['icuBeds.available'] = { $gte: demand.icuBeds };
if (demand.generalBeds > 0) query['generalBeds.available'] = { $gte: demand.generalBeds };
if (demand.oxygenBeds > 0) query['oxygenBeds.available'] = { $gte: demand.oxygenBeds };

const update = {
  $inc: {
    'icuBeds.available': -demand.icuBeds,
    'generalBeds.available': -demand.generalBeds,
    'oxygenBeds.available': -demand.oxygenBeds
  }
};

const updatedHosp = await Hospital.findOneAndUpdate(query, update, { session, new: true });
```

### Capacity Invariants:
1. Available capacity can never become negative.
2. If available beds are insufficient, `findOneAndUpdate` returns `null`, the transaction aborts, and HTTP 409 Conflict (`HOSPITAL_CAPACITY_INSUFFICIENT`) is returned.
3. If the hospital is in status `CLOSED` or `TEMPORARILY_UNAVAILABLE`, HTTP 409 Conflict (`HOSPITAL_UNAVAILABLE`) is returned.
4. If the C++ recommendation assigns a destination hospital without bed consumption (0 beds), the hospital destination is recorded without decrementing bed inventory.

---

## 5. Partial Recommendation Policy

The C++ orchestrator may return batches where certain resource demands could not be satisfied due to fleet depletion.

### The Two-Tier Confirmation Policy:
1. **Strict Confirmation (`allowPartialDispatch: false`, default)**:
   - If any incident in the recommendation batch has an unmet resource demand (`shortageQuantity > 0` or status `UNALLOCATED`), the confirmation is rejected with HTTP 409 Conflict (`INCOMPLETE_ALLOCATION_SHORTAGE`).
   - Prevents accidental mobilization of insufficient emergency response.
2. **Explicit Partial Confirmation (`allowPartialDispatch: true`)**:
   - The operator explicitly elects to mobilize available recommended resources despite partial shortages.
   - Recommended units are mobilized and shortages are prominently recorded in `resourceShortages` and the audit log.

---

## 6. Incident State Transitions

The incident progresses along the verified lifecycle path:
$$\text{VERIFIED} \longrightarrow \text{ALLOCATED} \longrightarrow \text{DISPATCHED}$$

Within the confirmation transaction:
1. Incident status is updated to `DISPATCHED`.
2. Metadata is attached: `dispatchedAt`, `dispatchedBy`, `dispatchedBatchId`, `dispatchId`, `assignedResourceIds`, `assignedHospitalId`.
3. Two distinct audit entries are atomically appended to `auditHistory`:
   - Action `ALLOCATED`: Documents the algorithmic allocation batch.
   - Action `DISPATCHED`: Documents operator confirmation and mobilization.

---

## 7. Idempotency & Concurrency Strategy

Network retries or operator double-clicks must not create duplicate dispatches.

### Strategy Implementation:
1. **Idempotency Key Support**: Clients supply a unique key via the `Idempotency-Key` header or request body.
2. **First Invocation**:
   - The key is bound to the `DispatchRecord`.
   - The transaction commits and returns HTTP 201 Created.
3. **Identical Replay**:
   - If the same key is submitted for the same batch, the service returns HTTP 200 OK with `isIdempotentReplay: true` and the existing confirmed dispatch details.
4. **Key Collisions**:
   - If an idempotency key is submitted for a *different* batch, the request is rejected with HTTP 409 Conflict (`IDEMPOTENCY_KEY_COLLISION`).
5. **Duplicate Confirmation Prevention**:
   - If a batch is already confirmed and a different key (or no key) is submitted, the request is rejected with HTTP 409 Conflict (`BATCH_ALREADY_CONFIRMED`).

---

## 8. API Reference

### 8.1. Confirm Dispatch
- **Endpoint**: `POST /api/dispatch/recommendations/:batchId/confirm`
- **Access Control**: `OPERATOR` or `ADMIN`.
- **Request Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <TOKEN>`
  - `Idempotency-Key: <UUID>` (optional)
- **Request Body**:
```json
{
  "allowPartialDispatch": false,
  "confirmationNotes": "Units mobilized to Station 4 incident"
}
```
- **Success Response (`201 Created` / `200 OK`)**:
```json
{
  "success": true,
  "message": "Dispatch confirmed and units mobilized successfully",
  "data": {
    "dispatch": {
      "dispatchId": "DISPATCH-1700000000000-a1b2c3d4",
      "batchId": "BATCH-1700000000000-e5f6g7h8",
      "confirmationStatus": "CONFIRMED",
      "isIdempotentReplay": false,
      "confirmedAt": "2026-11-18T01:45:00.000Z",
      "dispatchedAt": "2026-11-18T01:45:00.000Z",
      "confirmedBy": {
        "id": "673b0f...",
        "name": "Operator Dan",
        "email": "operator@jodhpur.emergency.gov.in",
        "role": "OPERATOR"
      },
      "confirmationNotes": "Units mobilized to Station 4 incident",
      "associatedIncidentIds": [1001],
      "resourceReservations": [
        {
          "resourceId": 501,
          "resourceType": "FIRE_ENGINE",
          "status": "DISPATCHED",
          "assignedIncidentId": 1001,
          "reservedAt": "2026-11-18T01:45:00.000Z"
        }
      ],
      "hospitalReservations": [
        {
          "hospitalId": 701,
          "hospitalName": "MDM Hospital Jodhpur",
          "assignedIncidentId": 1001,
          "reservedIcuBeds": 1,
          "reservedGeneralBeds": 1,
          "reservedOxygenBeds": 0,
          "reservedAt": "2026-11-18T01:45:00.000Z"
        }
      ],
      "recommendationSummary": {
        "totalIncidents": 1,
        "fullyAllocatedCount": 1,
        "partiallyAllocatedCount": 0,
        "unallocatedCount": 0
      },
      "auditTrail": [ ... ]
    }
  }
}
```

---

### 8.2. Retrieve Confirmed Dispatch
- **Endpoint**: `GET /api/dispatch/:dispatchId`
- **Access Control**: `OPERATOR` or `ADMIN`.
- **URL Parameter**: `dispatchId` (e.g. `DISPATCH-...` or associated `batchId`).
- **Success Response (`200 OK`)**: Returns full dispatch confirmation record.
- **Error Response (`404 Not Found`)**: Code `DISPATCH_NOT_FOUND`.

---

### 8.3. List Confirmed Dispatches
- **Endpoint**: `GET /api/dispatch`
- **Access Control**: `OPERATOR` or `ADMIN`.
- **Query Parameters**:
  - `page`: Integer $\ge 1$ (default: 1).
  - `limit`: Integer 1 to 100 (default: 20).
  - `incidentId`: Filter by exact incident ID.
  - `startDate` / `from`, `endDate` / `to`: Date range on `confirmedAt`.
  - `status`: Default `'CONFIRMED'`.
- **Success Response (`200 OK`)**: Returns `{ dispatches: [ ... ], pagination: { totalCount, page, limit, totalPages } }`.

