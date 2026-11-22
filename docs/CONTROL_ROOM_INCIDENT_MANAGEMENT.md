# Control Room Incident Verification & Management System

> **ACADEMIC SIMULATION PROXY DISCLAIMER**  
> This software is an academic engineering simulation designed to demonstrate distributed systems architecture, geographic routing algorithms, and decision-support mechanisms for emergency response management in Jodhpur, Rajasthan, India. It is not approved for live municipal emergency dispatch.

---

## 1. Executive Summary & Purpose

In an urban emergency response system, raw incident reports submitted by citizens must not trigger emergency resource mobilization without verification. Inadvertent dispatch caused by prank calls, erroneous duplicates, or miscategorized reports wastes municipal resources and endangers life-critical operations.

The **Control Room Incident Verification & Management System** (Phase 4.3) introduces the operational layer where certified human operators (`OPERATOR` or `ADMIN`) review incoming emergency reports, perform triage, verify legitimate emergencies, or reject invalid/duplicate reports.

---

## 2. Operational Workflow

```
[ Citizen Report ] (POST /api/incidents)
        │
        ▼
   [ REPORTED ] ──(Pending Review in Operator Queue)
        │
        ├─────────────────────────────┐
        │ Operator Verifies           │ Operator Rejects
        ▼                             ▼
   [ VERIFIED ]                  [ REJECTED ]
(Ready for Allocation          (Terminal State:
 in Phase 4.4)                  Duplicate, Prank, Out of Scope)
```

1. **Intake Queue Monitoring**:
   - Control room operators monitor incoming calls/reports via `GET /api/incidents?status=REPORTED`.
   - Operators can filter by emergency `category` (`FIRE`, `MEDICAL`, `POLICE`, `HAZMAT`), `severity` (1–5), or date ranges.
2. **Detailed Incident Assessment**:
   - Operator selects an incident to view full details via `GET /api/incidents/:incidentId`.
   - The view exposes citizen reporter identity (`reportedBy`), exact spatial coordinates, caller-reported victim count, severity, and initial audit record.
3. **Verification**:
   - The operator verifies caller legitimacy, gathers additional context, and executes `PATCH /api/incidents/:incidentId/verify`.
   - Optional `verificationNotes` (up to 1,000 characters) document operational notes (e.g., "Caller confirmed smoke on 3rd floor; fire station notified").
   - The incident transitions to `VERIFIED`.
4. **Rejection**:
   - If the report is determined to be a prank, duplicate, or resolved before dispatch, the operator calls `PATCH /api/incidents/:incidentId/reject`.
   - A mandatory `rejectionReason` (3–1,000 characters) must be supplied (e.g., "Confirmed duplicate of incident #1042").
   - The incident transitions to `REJECTED` (terminal state).

---

## 3. API Specifications

### 3.1. Incident Detail API
- **Endpoint**: `GET /api/incidents/:incidentId`
- **Access Control**:
  - `OPERATOR` & `ADMIN`: Full surveillance view, including `reportedBy`, `verifiedBy`, `rejectedBy`, priority score, and complete `auditHistory`.
  - `CITIZEN`: Strict ownership check; citizen can only view incidents where `reportedBy._id === req.user._id`. Attempts to view other citizens' reports return `403 Forbidden`.
- **URL Parameters**:
  - `incidentId` (integer, positive): The unique sequential incident ID.
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Incident details retrieved successfully",
  "data": {
    "incident": {
      "incidentId": 1045,
      "category": "FIRE",
      "severity": 4,
      "victimCount": 2,
      "status": "VERIFIED",
      "description": "Commercial kitchen grease fire near Clock Tower",
      "location": {
        "latitude": 26.2978,
        "longitude": 73.0234
      },
      "reportedAt": "2026-11-18T00:15:00.000Z",
      "verifiedAt": "2026-11-18T00:16:30.000Z",
      "verifiedBy": {
        "id": "673b0f...",
        "name": "Operator Sharma",
        "email": "operator.sharma@jodhpur.emergency.gov.in"
      },
      "verificationNotes": "Caller confirms grease fire spreading to ventilation duct.",
      "auditHistory": [
        {
          "action": "REPORTED",
          "performedBy": { "id": "673b0a...", "name": "Rajesh Kumar", "role": "CITIZEN" },
          "performedAt": "2026-11-18T00:15:00.000Z",
          "previousStatus": null,
          "newStatus": "REPORTED"
        },
        {
          "action": "VERIFIED",
          "performedBy": { "id": "673b0f...", "name": "Operator Sharma", "role": "OPERATOR" },
          "performedAt": "2026-11-18T00:16:30.000Z",
          "notes": "Caller confirms grease fire spreading to ventilation duct.",
          "previousStatus": "REPORTED",
          "newStatus": "VERIFIED"
        }
      ]
    }
  }
}
```

---

### 3.2. Incident Verification API
- **Endpoint**: `PATCH /api/incidents/:incidentId/verify`
- **Access Control**: Authenticated `OPERATOR` or `ADMIN` only (`CITIZEN` receives `403 Forbidden`).
- **Request Body**:
```json
{
  "verificationNotes": "Caller confirmed location and visible smoke from kitchen."
}
```
- **Validation Rules**:
  - `verificationNotes`: Optional string, trimmed, maximum 1,000 characters.
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Incident verified successfully",
  "data": {
    "incident": {
      "incidentId": 1045,
      "category": "FIRE",
      "severity": 4,
      "status": "VERIFIED",
      "verifiedAt": "2026-11-18T00:16:30.000Z",
      "verifiedBy": {
        "id": "673b0f...",
        "name": "Operator Sharma",
        "email": "operator.sharma@jodhpur.emergency.gov.in"
      },
      "verificationNotes": "Caller confirmed location and visible smoke from kitchen."
    }
  }
}
```
- **Error Responses**:
  - `400 Bad Request`: `INVALID_INCIDENT_ID`, `INVALID_VERIFICATION_NOTES`, or `VERIFICATION_NOTES_TOO_LONG`.
  - `403 Forbidden`: Authenticated user is `CITIZEN`.
  - `404 Not Found`: `INCIDENT_NOT_FOUND` (no incident exists with `incidentId`).
  - `409 Conflict`: `INCIDENT_STATE_CONFLICT` (current status is not `REPORTED`, e.g. already `VERIFIED` or `REJECTED`).

---

### 3.3. Incident Rejection API
- **Endpoint**: `PATCH /api/incidents/:incidentId/reject`
- **Access Control**: Authenticated `OPERATOR` or `ADMIN` only (`CITIZEN` receives `403 Forbidden`).
- **Request Body**:
```json
{
  "rejectionReason": "Duplicate call for incident #1045 already under dispatch."
}
```
- **Validation Rules**:
  - `rejectionReason`: Mandatory string, trimmed, length between 3 and 1,000 characters.
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Incident rejected successfully",
  "data": {
    "incident": {
      "incidentId": 1046,
      "category": "FIRE",
      "severity": 4,
      "status": "REJECTED",
      "rejectedAt": "2026-11-18T00:17:15.000Z",
      "rejectedBy": {
        "id": "673b0f...",
        "name": "Operator Sharma",
        "email": "operator.sharma@jodhpur.emergency.gov.in"
      },
      "rejectionReason": "Duplicate call for incident #1045 already under dispatch."
    }
  }
}
```
- **Error Responses**:
  - `400 Bad Request`: `MISSING_REJECTION_REASON` or `REJECTION_REASON_TOO_LONG`.
  - `403 Forbidden`: Authenticated user is `CITIZEN`.
  - `404 Not Found`: `INCIDENT_NOT_FOUND`.
  - `409 Conflict`: `INCIDENT_STATE_CONFLICT`.

---

### 3.4. Operator Registry Listing API
- **Endpoint**: `GET /api/incidents`
- **Access Control**: `OPERATOR` or `ADMIN` only (`CITIZEN` receives `403 Forbidden`).
- **Query Filters**:
  - `status`: One of `['REPORTED', 'VERIFIED', 'QUEUED', 'ALLOCATED', 'DISPATCHED', 'ON_SCENE', 'RESOLVED', 'REJECTED', 'CANCELLED']`.
  - `category`: One of `['FIRE', 'MEDICAL', 'POLICE', 'TRAFFIC', 'HAZMAT', 'DISASTER', 'RESCUE', 'OTHER']`.
  - `severity`: Integer between 1 and 5.
  - `incidentId`: Integer positive ID for exact lookup.
  - `startDate` / `from`: ISO 8601 string (e.g. `2026-11-18T00:00:00.000Z`) filtering `createdAt >= startDate`.
  - `endDate` / `to`: ISO 8601 string filtering `createdAt <= endDate`.
  - `page`: Positive integer (default: 1).
  - `limit`: Integer between 1 and 100 (default: 20).
  - `sortBy`: Field name (`createdAt`, `severity`, `incidentId`, `reportedAt`; default: `createdAt`).
  - `sortOrder`: `asc` or `desc` (default: `desc`).

---

### 3.5. Citizen History Visibility API
- **Endpoint**: `GET /api/incidents/my`
- **Access Control**: Authenticated `CITIZEN`, `OPERATOR`, or `ADMIN`.
- **Response Enhancements**:
  - Returns only incidents created by the caller.
  - Exposes `verifiedAt`, `verificationNotes`, `rejectedAt`, and `rejectionReason` so citizens have transparent status updates on their emergency reports.

---

## 4. Concurrency Model & Conflict Resolution

### The Double-Operator Race Condition
In a high-intensity municipal control room, multiple operators may simultaneously open the same incoming emergency report. If Operator A clicks "Verify" and Operator B clicks "Reject" (or "Verify") simultaneously:
- Without atomic concurrency control, the second write could overwrite the first, creating corrupted state transitions, conflicting audit logs, or duplicate dispatch invocations.

### Atomic Conditional Execution
Phase 4.3 guarantees strict state integrity using MongoDB's single-document atomic update semantics (`findOneAndUpdate`):

```javascript
const updated = await Incident.findOneAndUpdate(
  {
    incidentId: idNum,
    status: 'REPORTED' // Enforces prerequisite condition
  },
  {
    $set: {
      status: 'VERIFIED',
      verifiedBy: req.user._id,
      verifiedAt: now,
      verificationNotes: cleanNotes
    },
    $push: {
      auditHistory: {
        action: 'VERIFIED',
        performedBy: req.user._id,
        performedAt: now,
        notes: cleanNotes,
        previousStatus: 'REPORTED',
        newStatus: 'VERIFIED'
      }
    }
  },
  { new: true }
);
```

### Result Analysis:
1. **First Operator**: Matches `{ incidentId: idNum, status: 'REPORTED' }`. Document status becomes `VERIFIED`. Operation succeeds with HTTP 200.
2. **Second Operator**: Query matches 0 documents because status is now `VERIFIED`, not `REPORTED`. `findOneAndUpdate` returns `null`.
3. **Conflict Detection**: The controller performs `Incident.findOne({ incidentId: idNum })`. It sees that the incident exists but is in status `VERIFIED`.
4. **Resolution**: Returns HTTP 409 Conflict with structured payload:
```json
{
  "success": false,
  "message": "Cannot verify incident with status 'VERIFIED'. Only incidents in REPORTED status can be verified.",
  "error": {
    "code": "INCIDENT_STATE_CONFLICT",
    "incidentId": 1045,
    "currentStatus": "VERIFIED",
    "requiredStatus": "REPORTED"
  }
}
```

---

## 5. Audit History Architecture

Every incident maintains an immutable, append-only `auditHistory` array embedded directly in the document.

### Schema:
```javascript
const AuditEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: ['REPORTED', 'VERIFIED', 'REJECTED', 'ALLOCATED', 'DISPATCHED', 'STATUS_CHANGE']
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    performedAt: {
      type: Date,
      default: Date.now,
      required: true
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    reason: { type: String, trim: true, maxlength: 1000 },
    previousStatus: { type: String, enum: INCIDENT_STATUSES, default: null },
    newStatus: { type: String, enum: INCIDENT_STATUSES, required: true }
  },
  { _id: false }
);
```

### Audit Invariants:
1. **Creation Audit**: `createIncident` automatically writes the initial `REPORTED` audit entry.
2. **Transition Audit**: `verifyIncident` and `rejectIncident` atomically push new entries with exact timestamps and operator IDs.
3. **No Retroactive Alteration**: Audit records are never updated or deleted; they form an indelible ledger of dispatch decisions.

