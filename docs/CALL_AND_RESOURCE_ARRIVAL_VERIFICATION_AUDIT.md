# Architectural Audit: Reporter Call Verification & Resource Arrival Verification

**System:** Emergency Resource Allocation & Response Management System (Jodhpur Urban Service Area Simulation)  
**Audit Date:** November 20, 2026  
**Audit Type:** Deep Implementation & Operational Integrity Review  
**Target File:** `docs/CALL_AND_RESOURCE_ARRIVAL_VERIFICATION_AUDIT.md`  

---

## Executive Summary

This audit assesses the technical reality, architectural boundaries, and operational mechanisms of two core emergency management workflows:
1. **Reporter Call Verification Workflow**
2. **Resource Arrival Verification Workflow**

> [!IMPORTANT]
> **Key Finding:** Both workflows are designed as **control-room decision-support and operational accounting mechanisms**, not automated telecommunications or IoT vehicle-telemetry systems. 
> - Call handling uses standard OS-level `tel:` protocols without telecom carrier hookup, call-completion detection, or automated PBX recording.
> - Arrival verification is an authenticated **operator-confirmed operational milestone** recorded via transactional database state transitions. There is **no live GPS vehicle tracking, geofencing, or mobile driver application** integrated into the system.

---

## Part A: Reporter Call Verification Workflow

### 1. Architectural Overview & Component Inventory

| Component Layer | Source File | Responsibilities |
|---|---|---|
| **Frontend UI (Contact Card & Modal)** | [`client/src/pages/control-room/ControlRoomIncidentDetailPage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ControlRoomIncidentDetailPage.jsx) | Renders Citizen Reporter Info card, `tel:` dialer anchors, and Structured Operator Verification Modal |
| **Frontend Service Client** | [`client/src/services/incidentService.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/services/incidentService.js) | Dispatches `PATCH /api/incidents/:id/verify` payload |
| **Frontend Verification Hook** | [`client/src/hooks/useIncidentVerification.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/hooks/useIncidentVerification.js) | Manages modal form state, outcome validation, and optimistic updates |
| **Backend Route Middleware** | [`server/src/routes/incidentRoutes.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/routes/incidentRoutes.js) | Enforces authentication and `OPERATOR` / `ADMIN` role-based access |
| **Backend Controller** | [`server/src/controllers/incidentController.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/controllers/incidentController.js) | Validates verification payload, checks state conflict, updates incident |
| **Database Schema** | [`server/src/models/Incident.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/models/Incident.js) | Defines `verificationHistory` subdocument, outcome enums, and RBAC filters |

---

### 2. Detailed Technical Audit Findings

#### Question A.1: Does the application only open the device dialer?
**Yes.**
- The application implements standard HTML5 `href="tel:${incident.reporterPhone}"` hyperlinks:
  ```jsx
  // ControlRoomIncidentDetailPage.jsx (Lines 454-477)
  <a
    href={`tel:${incident.reporterPhone}`}
    className="..."
    title="Click to dial reporter"
  >
    <span>{incident.reporterPhone}</span>
    <PhoneCall className="w-3.5 h-3.5 ml-1" />
  </a>
  ```
- Clicking this link prompts the client operating system (Windows Phone Link, Android Dialer, iOS Phone app, or default VoIP desktop softphone) to populate the telephone number.
- There is no custom in-browser dial pad, embedded WebRTC SIP phone, or browser audio stream.

#### Question A.2: Does it detect whether a call was actually placed, answered, missed, or completed?
**No.**
- Standard `tel:` protocol invocations are completely unidirectional browser-to-OS commands.
- The web browser receives **zero callback, DOM event, or socket signal** regarding what occurs after the OS dialer launches.
- The application cannot determine:
  - Whether the operator actually pressed the call button in the external dialer.
  - Whether the carrier network connected the call.
  - Ring duration, call answer, busy signal, or voicemail reach.
  - Call duration, conversation audio, or call termination time.
- All verification tracking is **manual operator documentation** entered into the system.

#### Question A.3: Which call outcomes can the operator currently record?
The backend model (`Incident.js`) and UI modal enforce 5 canonical structured outcomes:

| Outcome Value | Lifecycle Transition | Operational Meaning | Life-Safety Policy |
|---|---|---|---|
| `CONFIRMED` | `REPORTED` $\rightarrow$ `VERIFIED` | Caller confirmed genuine on-scene conditions. | Incident becomes eligible for automated C++ dispatch recommendation and unit reservation. |
| `UNABLE_TO_CONTACT` | Retains `REPORTED` | Phone rang without answer, was busy, or went to voicemail. | **Critical Safety Policy:** An uncontactable reporter does **not** mark an incident as a false alarm. The incident remains active in the queue for operator retry or supervisor override. |
| `INFORMATION_REQUIRED` | Retains `REPORTED` | Contact made, but additional details or scene clarification are required before dispatch. | Records operational assessment into audit history without halting triage. |
| `REJECTED` | `REPORTED` $\rightarrow$ `REJECTED` | Incident verified as hoax, prank call, or accidental report. | Irreversible terminal state; halts all dispatch recommendations. Mandatory notes required ($\ge 3$ characters). |
| `DUPLICATE` | `REPORTED` $\rightarrow$ `REJECTED` | Incident confirmed already reported under another record. | Links primary incident ID (`duplicateOfIncidentId`) and archives record. |

#### Question A.4: Are call attempts and verification notes persisted?
**Yes.**
All verification attempts are persisted in MongoDB within the `Incident` document:
- **Top-Level Metadata:**
  - `latestVerificationOutcome`: String (`CONFIRMED`, `UNABLE_TO_CONTACT`, etc.)
  - `verificationNotes`: String (up to 1,000 characters)
  - `verifiedBy`: `ObjectId` referencing `User` (authenticated operator)
  - `verifiedAt`: `Date` timestamp
  - `duplicateOfIncidentId`: `Number` (when `DUPLICATE`)
- **Chronological Verification History Subdocument (`verificationHistory`):**
  ```javascript
  // server/src/models/Incident.js (Lines 46-81)
  const verificationEntrySchema = new Schema({
    outcome: { type: String, required: true, enum: VERIFICATION_OUTCOMES },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    performedAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true, default: '' },
    relatedIncidentId: { type: Number, default: null },
    previousStatus: { type: String, default: null },
    resultingStatus: { type: String, default: null }
  }, { _id: false });
  ```
- **Audit History Trail (`auditHistory`):** Records lifecycle transitions (`previousStatus`, `newStatus`, `action`, `performedBy`, `performedAt`, `notes`).
- **Privacy Enforcement (RBAC):** `verificationHistory`, `verificationNotes`, and `reporterPhone` are stripped from citizen-facing GET endpoints (`/api/incidents/my` and `/api/incidents/:id` for citizen owners) to prevent internal operator assessment leakage.

#### Question A.5: Is any telephony provider integrated?
**No.**
- Inspection of `server/package.json`, `client/package.json`, and backend services confirms:
  - **No telephony SDKs:** Twilio, Exotel, Plivo, Vonage, AWS Connect, or Asterisk are neither installed nor referenced.
  - **No WebRTC / SIP:** No signaling gateways or voice protocols exist in client or server code.
  - **No Carrier Webhooks:** No incoming webhook endpoints exist to receive CDRs (Call Detail Records) or delivery receipts.

---

### 3. API Contract Example: Verification Submission

**Endpoint:** `PATCH /api/incidents/:incidentId/verify`  
**Headers:** `Authorization: Bearer <operator_token>`, `Content-Type: application/json`

```http
PATCH /api/incidents/17951953993483/verify HTTP/1.1
Host: localhost:5001
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsIn...

{
  "outcome": "UNABLE_TO_CONTACT",
  "verificationNotes": "Called reporter twice at 23:15 IST. Line was busy. Will re-attempt in 3 minutes.",
  "proceedWithDispatch": false
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Incident verification attempt recorded successfully",
  "data": {
    "incident": {
      "incidentId": 17951953993483,
      "status": "REPORTED",
      "latestVerificationOutcome": "UNABLE_TO_CONTACT",
      "verificationHistory": [
        {
          "outcome": "UNABLE_TO_CONTACT",
          "notes": "Called reporter twice at 23:15 IST. Line was busy. Will re-attempt in 3 minutes.",
          "performedAt": "2026-11-20T17:45:00.000Z",
          "performedBy": {
            "name": "Operator Duty Desk",
            "email": "operator@jodhpur.emergency.gov.in"
          }
        }
      ]
    }
  }
}
```

---

## Part B: Resource Arrival Verification Workflow

### 1. Architectural Overview & Component Inventory

| Component Layer | Source File | Responsibilities |
|---|---|---|
| **Active Operations UI** | [`client/src/pages/control-room/ActiveOperationsPage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ActiveOperationsPage.jsx) | Renders dispatched fleet table, "Mark Arrived" action, and Scene Arrival Modal |
| **Incident Detail UI** | [`client/src/pages/control-room/ControlRoomIncidentDetailPage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ControlRoomIncidentDetailPage.jsx) | Displays operational progression milestone (`Units On Scene`) and timestamp |
| **Frontend Service Client** | [`client/src/services/incidentService.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/services/incidentService.js) | Issues `PATCH /api/incidents/:id/arrive` with arrival notes |
| **Backend Route Middleware** | [`server/src/routes/incidentRoutes.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/routes/incidentRoutes.js) | Enforces authentication and `OPERATOR` / `ADMIN` role requirements |
| **Backend Arrival Controller** | [`server/src/controllers/incidentController.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/controllers/incidentController.js) | Delegates to tracking service; normalizes `IncidentTrackingError` codes |
| **Active Tracking Service** | [`server/src/services/activeIncidentTrackingService.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/services/activeIncidentTrackingService.js) | Implements atomic `DISPATCHED` $\rightarrow$ `ON_SCENE` transaction |
| **Incident Database Schema** | [`server/src/models/Incident.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/models/Incident.js) | Holds `arrivedAt`, `arrivedBy`, `auditHistory` |
| **Dispatch Record Schema** | [`server/src/models/DispatchRecord.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/models/DispatchRecord.js) | Holds `incidentTracking[].arrivedAt` and `confirmationAuditTrail` |
| **Resource Database Schema** | [`server/src/models/Resource.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/models/Resource.js) | Defines resource statuses (`AVAILABLE`, `RESERVED`, `DISPATCHED`, `OUT_OF_SERVICE`) |

---

### 2. Detailed Technical Audit Findings

#### Question B.1: Who can mark a resource as arrived?
- **Authorized Control Room Operators and Admins only.**
- Enforced at route level:
  ```javascript
  // server/src/routes/incidentRoutes.js (Line 45)
  router.patch('/:incidentId/arrive', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), arriveIncident);
  ```
- Field responders, vehicle drivers, citizens, and unauthenticated actors cannot access or invoke this route (returns HTTP 401 or HTTP 403 Forbidden).

#### Question B.2: What exact action changes status to `ON_SCENE`?
- **User Action:** In [`ActiveOperationsPage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ActiveOperationsPage.jsx), the operator clicks the `"Mark Arrived"` button on a `DISPATCHED` incident row. In the Scene Arrival Modal, the operator enters optional arrival notes and clicks `"Confirm Scene Arrival"`.
- **API Call:** The client dispatches:
  `PATCH /api/incidents/:incidentId/arrive` with `{ notes: "..." }`
- **Database Transaction (`activeIncidentTrackingService.js`):**
  An atomic conditional update updates the incident document:
  ```javascript
  const updatedIncident = await Incident.findOneAndUpdate(
    {
      incidentId: cleanId,
      status: 'DISPATCHED' // Atomic conditional invariant
    },
    {
      $set: {
        status: 'ON_SCENE',
        arrivedAt: now,
        arrivedBy: operatorUser ? operatorUser._id : null
      },
      $push: {
        auditHistory: {
          action: 'ON_SCENE',
          performedBy: operatorUser ? operatorUser._id : null,
          performedAt: now,
          previousStatus: 'DISPATCHED',
          newStatus: 'ON_SCENE',
          notes: cleanNotes || 'Emergency response units arrived on scene'
        }
      }
    },
    { session, new: true }
  );
  ```
- Simultaneously, the associated `DispatchRecord.incidentTracking` entry has its status set to `'ON_SCENE'` and `arrivedAt: now`.

#### Question B.3: Is arrival based on operator confirmation, driver confirmation, GPS, geofencing, or simulation?
- **Manual Operator Confirmation only.**
- There is **no driver mobile app, in-cab terminal, automated geofence listener, or simulation timer**.
- Arrival represents a verbal/radio confirmation logged by a human operator sitting at the control-room console.

#### Question B.4: Does the system verify vehicle coordinates against incident coordinates?
- **No.**
- The system performs **zero spatial proximity checks, distance calculations, or coordinate validations** during the arrival transition.
- **Architectural Clarification:** Stored coordinates in the `Resource` collection (`Resource.latitude`, `Resource.longitude`) represent **fixed base depots** (e.g. AIIMS Depot, Basni Fire Station, Paota Depot), not mobile telemetric coordinates. The application frontend explicitly warns users:
  > *"Marker positions represent authentic OSM coordinates within the Jodhpur Urban Settlement polygon. Vehicle locations indicate base depots rather than live GPS feeds."* ([`TacticalMapPage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/TacticalMapPage.jsx#L101))

#### Question B.5: Are arrival timestamp, operator ID, verification method, and notes persisted?
- **Persisted Fields:**
  - `arrivedAt`: `Date` (`Date.now()` at moment of execution).
  - `arrivedBy`: `ObjectId` referencing the authenticated operator in `User`.
  - `notes`: `String` (up to 1,000 characters persisted in `Incident.auditHistory` and `DispatchRecord.confirmationAuditTrail`).
- **Verification Method Field:**
  - **No explicit verification method enum.** The system does not have an enum field distinguishing `RADIO_DISPATCH`, `PHONE_CONFIRMATION`, or `MANUAL_OVERRIDE`. It is recorded as a generic operator `SCENE_ARRIVAL` action with optional operator notes.

#### Question B.6: Can arrival be marked for an undispatched resource?
- **No.**
- `markSceneArrival` enforces strict pre-condition validation before allowing the transition:
  1. **Status Guard:** If `existingIncident.status !== 'DISPATCHED'`, it rejects the call with `409 INCIDENT_STATE_CONFLICT`. Incidents in `REPORTED`, `VERIFIED`, `ALLOCATED`, `ON_SCENE`, `RESOLVED`, or `REJECTED` cannot be marked as arrived.
  2. **Dispatch Confirmation Guard:** If `!existingIncident.dispatchId && !existingIncident.dispatchedBatchId`, it throws `409 DISPATCH_NOT_CONFIRMED`.
  3. **Atomic Concurrency Guard:** The update specifies `{ incidentId: cleanId, status: 'DISPATCHED' }`. If another request or rollback changed the state, the update modifies zero records and aborts.
- Individual vehicles cannot be marked arrived independently; arrival is executed at the incident level for all assigned units responding to that dispatch.

#### Question B.7: Can the same arrival action be submitted multiple times?
- **No.**
- **Duplicate Prevention:**
  - If an incident is already in `ON_SCENE` status, `markSceneArrival` explicitly catches this condition:
    ```javascript
    if (existingIncident.status === 'ON_SCENE') {
      throw new IncidentTrackingError(
        `Incident ${cleanId} is already marked ON_SCENE.`,
        'INCIDENT_STATE_CONFLICT',
        { incidentId: cleanId, currentStatus: existingIncident.status },
        409
      );
    }
    ```
  - The UI button `"Mark Arrived"` in [`ActiveOperationsPage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/ActiveOperationsPage.jsx#L230-L240) only renders when `row.status === 'DISPATCHED'`. Once marked arrived, the row status becomes `ON_SCENE` and the action button changes to `"Resolve Incident"`.

#### Question B.8: Does arrival affect resource availability and dispatch integrity?
- **No, arrival maintains resource reservation and preserves dispatch integrity:**
  - When an incident transitions to `ON_SCENE`, the assigned resources in the `Resource` collection are **not altered**. They remain in `status: 'DISPATCHED'` with their `assignedIncidentId` intact.
  - Notice that the `Resource` schema has no `ON_SCENE` status (its statuses are `AVAILABLE`, `RESERVED`, `DISPATCHED`, `OUT_OF_SERVICE`).
  - Units on scene remain unavailable for other dispatches. This prevents resource hijacking while responders are actively treating casualties or suppressing fires.
  - Assigned resources are returned to `AVAILABLE` only when the operator resolves the incident via `PATCH /api/incidents/:id/resolve`.
  - Hospital bed allocations remain in `RESERVED` status until incident resolution.

---

### 3. API Contract Example: Scene Arrival Execution

**Endpoint:** `PATCH /api/incidents/:incidentId/arrive`  
**Headers:** `Authorization: Bearer <operator_token>`, `Content-Type: application/json`

```http
PATCH /api/incidents/17951953993483/arrive HTTP/1.1
Host: localhost:5001
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsIn...

{
  "notes": "ALS Ambulance 101 and Fire Engine 201 on scene. Incident commander established at Sojati Gate circle."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Emergency response units marked arrived on scene successfully",
  "data": {
    "incident": {
      "incidentId": 17951953993483,
      "status": "ON_SCENE",
      "arrivedAt": "2026-11-20T17:50:12.450Z",
      "dispatchedAt": "2026-11-20T17:42:00.000Z",
      "dispatchId": "DISPATCH-17951953993483-a1b2c3d4",
      "dispatchedBatchId": "BATCH-20261120-7789"
    },
    "dispatchId": "DISPATCH-17951953993483-a1b2c3d4",
    "dispatchedBatchId": "BATCH-20261120-7789"
  }
}
```

---

## 4. Synthesis & Direct Comparative Matrix

| Verification Attribute | A. Reporter Call Verification | B. Resource Arrival Verification |
|---|---|---|
| **Initiating Actor** | Control Room Operator / Admin | Control Room Operator / Admin |
| **Trigger Mechanism** | Native OS dialer protocol (`tel:+91...`) | Interactive modal submit (`PATCH /.../arrive`) |
| **Automated Verification Hardware** | None (No carrier PBX / No WebRTC) | None (No GPS telemetry / No in-cab MDT) |
| **State Detection Capability** | Cannot detect if call placed, answered, or hung up | Cannot detect if vehicle physically arrived at coordinates |
| **State Transitions** | `CONFIRMED` $\rightarrow$ `VERIFIED`<br>`REJECTED` $\rightarrow$ `REJECTED`<br>`UNABLE_TO_CONTACT` $\rightarrow$ Retains `REPORTED` | `DISPATCHED` $\rightarrow$ `ON_SCENE` |
| **Pre-Condition Validation** | Must be in `REPORTED` status (409 conflict otherwise) | Must be in `DISPATCHED` status with valid `dispatchId` (409 conflict otherwise) |
| **Double-Submission Handling** | State conflict 409 after transition to `VERIFIED`/`REJECTED` | State conflict 409 if already `ON_SCENE` |
| **Persisted Audit Data** | `latestVerificationOutcome`, notes, operator, timestamp, `verificationHistory[]` | `arrivedAt`, `arrivedBy`, notes, `auditHistory[]`, `DispatchRecord.incidentTracking[]` |
| **Effect on Fleet Availability** | None (Incident not yet dispatched) | None (Resources remain locked in `DISPATCHED` status) |

---

## 5. Audit Conclusion

Both workflows are cleanly implemented and robustly guarded against concurrency errors and state collisions:
1. **Reporter Call Verification** safely protects citizen data (RBAC stripping) and enforces an essential life-safety policy: failing to contact a reporter does **not** terminate an incident or mark it as a false alarm. However, telecom tracking is purely manual—the system does not monitor phone line states.
2. **Resource Arrival Verification** provides transactional tracking between `DISPATCHED` and `ON_SCENE` milestones without releasing assigned resources prematurely. However, vehicle arrival is purely operator-reported—the system does not track vehicle GPS positions or compute geofenced boundary crossings.
