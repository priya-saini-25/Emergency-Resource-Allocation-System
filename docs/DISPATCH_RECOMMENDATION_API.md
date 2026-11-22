# Dispatch Recommendation API Specification

> **ACADEMIC SIMULATION PROXY DISCLAIMER**  
> This software is an academic engineering simulation designed to study multi-criteria decision analysis, graph algorithms, and distributed systems architecture for urban emergency response in Jodhpur, Rajasthan, India. It is not approved or certified for real-world municipal dispatch.

---

## 1. Overview & Operational Principles

The **Dispatch Recommendation API** (Phase 4.4) allows certified control room operators (`OPERATOR` or `ADMIN`) to generate, inspect, and retrieve algorithmic dispatch recommendations for verified emergency incidents.

### Fundamental Operational Rules:
1. **Recommendations Only**: This API computes and stores **recommendations**. It does **not** mobilize fleet vehicles, reserve hospital beds, transition incidents to `ALLOCATED` or `DISPATCHED`, or mark resources `RESERVED`.
2. **Authoritative Database Snapshot**: Clients cannot supply external vehicle inventories, hospital capacities, or priority scores. All fleet vehicles and hospital occupancies are queried authoritatively from MongoDB at the moment of evaluation.
3. **Verified Incidents Only**: Only incidents in status `VERIFIED` are eligible. Incidents in `REPORTED`, `REJECTED`, `ALLOCATED`, `ON_SCENE`, `RESOLVED`, or `CANCELLED` are rejected with HTTP 409 Conflict.
4. **Deterministic Greedy Allocation**: The C++ decision engine implements deterministic priority-first greedy allocation; it does not promise global mathematical optimality or live GPS traffic accuracy.

---

## 2. API Endpoints

### 2.1. Generate Dispatch Recommendations
- **Endpoint**: `POST /api/dispatch/recommendations`
- **Access Control**: `OPERATOR` or `ADMIN` (Live database-backed check; `CITIZEN` receives `403 Forbidden`).
- **Request Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <JWT_TOKEN>`

#### Request Body Options:
**Option A: Explicit Incident Selection**
```json
{
  "incidentIds": [1001, 1002]
}
```

**Option B: Batch Verification Queue Selection**
```json
{
  "selectAllVerified": true
}
```

#### Request Validation Rules:
- `incidentIds`: Array of positive integers ($1 \le \text{length} \le \text{CPP\_MAX\_BATCH\_SIZE}$, default 25).
- Duplicates in `incidentIds` are strictly rejected with HTTP 400 `DUPLICATE_INCIDENT_IDS`.
- Injection of `resources`, `hospitals`, `priorityScores`, or `assignments` is rejected with HTTP 400.
- If any requested incident does not exist: HTTP 404 `INCIDENT_NOT_FOUND`.
- If any requested incident is not in `VERIFIED` status: HTTP 409 `INELIGIBLE_INCIDENT`.

#### Success Response (`201 Created`):
```json
{
  "success": true,
  "message": "Dispatch recommendations generated successfully",
  "data": {
    "recommendation": {
      "batchId": "BATCH-1700000000000-a1b2c3d4",
      "requestId": "4c9d5f7e-1234-5678-90ab-cdef12345678",
      "evaluatedAt": "2026-11-18T00:30:00.000Z",
      "recommendationStatus": "RECOMMENDED",
      "batchStatus": "SUCCESS",
      "batchStatusMessage": "",
      "totalIncidents": 2,
      "fullyAllocatedCount": 2,
      "partiallyAllocatedCount": 0,
      "unallocatedCount": 0,
      "includedIncidentIds": [1001, 1002],
      "priorityExecutionOrder": [1001, 1002],
      "incidentResults": [
        {
          "incidentId": 1001,
          "priorityScore": 85.5,
          "priorityTier": "CRITICAL",
          "triageRank": 1,
          "allocationStatus": "FULLY_ALLOCATED",
          "summaryNotes": "Optimal resource allocation and hospital recommendation formulated.",
          "assignedResources": [
            {
              "resourceId": 501,
              "resourceType": "FIRE_ENGINE",
              "snappedNodeOsmId": 123450,
              "estimatedArrivalSeconds": 144.5,
              "distanceMeters": 1205.0,
              "routePolyline": ""
            }
          ],
          "resourceShortages": [],
          "recommendedHospital": {
            "hospitalId": 701,
            "hospitalName": "MDM Hospital Jodhpur",
            "suitability": "FULL_MATCH",
            "hospitalNodeOsmId": 201,
            "estimatedTransportSeconds": 300.0,
            "distanceMeters": 2500.0,
            "routePolyline": ""
          },
          "hospitalShortages": {
            "icuBedShortage": 0,
            "generalBedShortage": 0,
            "oxygenBedShortage": 0
          }
        }
      ],
      "summary": {
        "totalIncidentsReceived": 2,
        "validIncidents": 2,
        "invalidIncidents": 0,
        "fullyAllocatedIncidents": 2,
        "partiallyAllocatedIncidents": 0,
        "unallocatedIncidents": 0,
        "totalUniqueResourcesRecommended": 2,
        "totalHospitalRecommendations": 2,
        "resourceConflictsPrevented": 0,
        "hospitalCapacityConflictsPrevented": 0,
        "remainingAvailableResources": 18,
        "remainingAvailableIcuBeds": 14,
        "remainingAvailableGeneralBeds": 59,
        "remainingAvailableOxygenBeds": 29
      },
      "engineMetadata": {
        "totalExecutionTimeMs": 14.2,
        "priorityScoringTimeMs": 0.05,
        "resourceOrchestrationTimeMs": 4.1,
        "hospitalOrchestrationTimeMs": 9.8,
        "totalPipelineTimeMs": 2350.0
      },
      "engineTelemetry": {
        "engineExecutionTimeUs": 14200,
        "processWallClockMs": 2345,
        "dijkstraCalls": 4,
        "multiTargetCalls": 2,
        "protocolVersion": "1.0"
      }
    }
  }
}
```

---

### 2.2. Retrieve Recommendation Snapshot by Batch ID
- **Endpoint**: `GET /api/dispatch/recommendations/:batchId`
- **Access Control**: `OPERATOR` or `ADMIN`.
- **Purpose**: Returns the exact immutable historical snapshot persisted in MongoDB. Does **not** re-invoke the C++ engine or recompute allocations.
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "message": "Dispatch recommendation retrieved successfully",
  "data": {
    "recommendation": {
      "batchId": "BATCH-1700000000000-a1b2c3d4",
      "requestId": "4c9d5f7e-1234-5678-90ab-cdef12345678",
      "evaluatedAt": "2026-11-18T00:30:00.000Z",
      "requestedBy": {
        "id": "673b0f...",
        "name": "Operator Sharma",
        "email": "operator.sharma@jodhpur.emergency.gov.in",
        "role": "OPERATOR"
      },
      "recommendationStatus": "RECOMMENDED",
      "batchStatus": "SUCCESS",
      "totalIncidents": 2,
      "incidentResults": [ ... ]
    }
  }
}
```
- **Error Response**:
  - `404 Not Found`:
    ```json
    {
      "success": false,
      "message": "Dispatch recommendation batch 'BATCH-NON-EXISTENT' not found",
      "error": { "code": "BATCH_NOT_FOUND", "batchId": "BATCH-NON-EXISTENT" }
    }
    ```

---

### 2.3. List Historical Recommendations
- **Endpoint**: `GET /api/dispatch/recommendations`
- **Access Control**: `OPERATOR` or `ADMIN`.
- **Query Parameters**:
  - `page`: Integer $\ge 1$ (default: 1).
  - `limit`: Integer between 1 and 100 (default: 20).
  - `status`: Filter by `recommendationStatus` (`RECOMMENDED`, `FAILED`).
  - `batchStatus`: Filter by engine batch status (`SUCCESS`, `PARTIAL_SUCCESS`, `FAILED`).
  - `incidentId`: Exact integer incident ID (finds all batches containing this incident).
  - `startDate` / `from`: ISO 8601 date string filtering `evaluatedAt >= startDate`.
  - `endDate` / `to`: ISO 8601 date string filtering `evaluatedAt <= endDate`.
  - `sortBy`: Field name (`evaluatedAt`, `totalIncidents`, `createdAt`; default: `evaluatedAt`).
  - `sortOrder`: `asc` or `desc` (default: `desc`).

- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "message": "Dispatch recommendations retrieved successfully",
  "data": {
    "recommendations": [ ... ],
    "pagination": {
      "totalCount": 15,
      "page": 1,
      "limit": 20,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

---

## 3. Error Codes & HTTP Status Mapping

| HTTP Code | Error Code | Description |
|:---:|:---|:---|
| `400` | `INVALID_REQUEST_BODY` | Request body missing or not a JSON object. |
| `400` | `INVALID_INCIDENT_IDS` | `incidentIds` is not an array or contains invalid entries. |
| `400` | `EMPTY_INCIDENT_BATCH` | `incidentIds` array is empty. |
| `400` | `DUPLICATE_INCIDENT_IDS` | Duplicate incident IDs specified in batch request. |
| `400` | `BATCH_SIZE_EXCEEDED` | Requested incident count exceeds `CPP_MAX_BATCH_SIZE`. |
| `400` | `UNAUTHORIZED_INVENTORY_INJECTION` | Client attempted to supply resources or hospitals. |
| `400` | `UNAUTHORIZED_ASSIGNMENT_INJECTION` | Client attempted to supply priority scores or assignments. |
| `401` | `UNAUTHORIZED` | Missing or invalid JWT authorization header. |
| `403` | `FORBIDDEN` | Caller lacks `OPERATOR` or `ADMIN` role. |
| `404` | `INCIDENT_NOT_FOUND` | One or more requested incident IDs do not exist in database. |
| `404` | `BATCH_NOT_FOUND` | Specified recommendation batch ID not found. |
| `409` | `INELIGIBLE_INCIDENT` | Requested incident is not in `VERIFIED` status. |
| `502` | `UPSTREAM_ENGINE_INVALID_RESPONSE`| C++ engine emitted malformed, inconsistent, or invalid output. |
| `503` | `DATABASE_UNAVAILABLE` | MongoDB is disconnected or unreachable. |
| `503` | `ENGINE_DATASET_UNAVAILABLE` | Canonical road graph dataset missing from engine data dir. |
| `504` | `ENGINE_GATEWAY_TIMEOUT` | C++ engine subprocess execution timed out ($> 10,000$ ms). |

