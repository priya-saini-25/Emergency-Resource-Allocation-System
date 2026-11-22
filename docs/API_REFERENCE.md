# Emergency Resource Allocation & Response Management System
## Backend API Reference Specification (REST API v1.0)

> [!NOTE]
> **ACADEMIC SIMULATION & DECISION-SUPPORT PROXY DISCLAIMER**  
> This software is an academic engineering simulation and decision-support prototype developed exclusively for educational and research evaluation within the Jodhpur Urban Service Area (Rajasthan, India). It is not affiliated with, certified by, or connected to real-world emergency dispatch services, public safety answering points (PSAP), fire services, police dispatch, or actual hospital bed management authorities. Do not utilize for life-safety critical operations.

---

## 1. Global API Standards & Conventions

### 1.1 Base URL & Routing
All backend REST API endpoints are served under the configurable base prefix:
```
http://localhost:5000/api
```

### 1.2 HTTP Headers
| Header Name | Required | Description |
|---|---|---|
| `Content-Type` | Yes (for POST/PATCH/PUT) | Must be `application/json; charset=utf-8`. |
| `Authorization` | Yes (for protected routes) | Standard JWT Bearer token: `Bearer <jwt_token>`. |
| `Idempotency-Key` / `idempotency-key` | Recommended (for dispatch confirmation) | Unique client-generated UUID to guarantee atomic, exactly-once dispatch execution. |
| `X-Request-ID` | Optional | Correlation identifier forwarded for distributed tracing. |

### 1.3 CORS Policy
- Allowed Origins: `env.CORS_ORIGIN` (Default: `http://localhost:5173` or `*` in development)
- Allowed Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`
- Allowed Headers: `Content-Type`, `Authorization`, `X-Request-ID`, `Idempotency-Key`, `idempotency-key`

---

## 2. Standardized Response Envelopes

Every API response follows a strict, predictable JSON envelope structure.

### 2.1 Success Envelope
HTTP Status `200 OK` or `201 Created`
```json
{
  "success": true,
  "message": "Human-readable description of the completed operation",
  "data": {
    /* Target payload entity or collection */
  }
}
```

### 2.2 Error Envelope
HTTP Status `4xx Client Error` or `5xx Server Error`
```json
{
  "success": false,
  "message": "Human-readable error summary",
  "error": {
    "status": 400,
    "code": "ERROR_CATEGORY_CODE",
    "message": "Detailed error explanation",
    "details": null,
    "timestamp": "2026-11-18T02:00:00.000Z"
  }
}
```

### 2.3 Common Error Codes
| HTTP Status | Error Code | Description |
|---|---|---|
| `400` | `INVALID_JSON_BODY` | Request body is malformed or unparseable JSON. |
| `400` | `SCHEMA_VALIDATION_ERROR` | Request payload fails schema validation constraints. |
| `400` | `OUTSIDE_SERVICE_AREA` | Location coordinates fall outside Jodhpur urban boundary. |
| `401` | `UNAUTHORIZED` | Missing or invalid `Authorization: Bearer <token>` header. |
| `401` | `ACCOUNT_INACTIVE` | User account has been deactivated by administrator. |
| `403` | `FORBIDDEN` | Authenticated user lacks required role (`CITIZEN`, `OPERATOR`, `ADMIN`). |
| `404` | `ROUTE_NOT_FOUND` | The requested endpoint URI does not exist. |
| `404` | `INCIDENT_NOT_FOUND` | The specified incident ID does not exist. |
| `409` | `INCIDENT_STATE_CONFLICT` | Illegal state transition attempted (e.g. verifying non-reported incident). |
| `502` | `ENGINE_BRIDGE_ERROR` | C++ decision engine subprocess communication error. |
| `503` | `DATABASE_UNAVAILABLE` | MongoDB persistence tier is offline or unreachable. |
| `503` | `TRANSACTION_UNAVAILABLE` | Environment cannot execute multi-document transactions (e.g. standalone Mongo). |
| `504` | `ENGINE_GATEWAY_TIMEOUT` | C++ decision engine exceeded execution timeout threshold (10,000ms). |

---

## 3. Health & Diagnostic Endpoints

### 3.1 Global Health & Readiness
`GET /api/health`
- **Role Access:** Public
- **Description:** Returns operational status of the Node.js runtime, MongoDB connection, memory utilization, and uptime.
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Emergency Resource Allocation Server is operational",
  "data": {
    "status": "healthy",
    "timestamp": "2026-11-18T02:00:00.000Z",
    "uptimeSeconds": 1420.5,
    "database": {
      "connected": true,
      "state": "connected"
    },
    "memory": {
      "heapUsedMB": 42.15,
      "heapTotalMB": 68.30,
      "rssMB": 105.40
    }
  }
}
```

### 3.2 C++ Decision Engine Diagnostic Health
`GET /api/health/engine`
- **Role Access:** Public
- **Description:** Verifies executable presence of the C++ decision engine binary and canonical dataset files.
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "C++ Decision Engine diagnostics verified",
  "data": {
    "engine": {
      "binaryPath": "cpp_engine/bin/decision_engine.exe",
      "binaryExists": true,
      "protocolVersion": "1.0"
    },
    "datasets": {
      "graphExists": true,
      "hospitalsExists": true,
      "resourcesExists": true,
      "boundaryExists": true
    }
  }
}
```

---

## 4. Authentication & Profile Endpoints

### 4.1 Citizen Public Registration
`POST /api/auth/register`
- **Role Access:** Public
- **Description:** Registers a new citizen user. Prevents role escalation: all registrations are assigned the `CITIZEN` role.
- **Request Body:**
```json
{
  "name": "Sanjay Sharma",
  "email": "sanjay.sharma@example.com",
  "password": "SecurePassword123!"
}
```
- **Response `201 Created`:**
```json
{
  "success": true,
  "message": "Citizen account registered successfully",
  "data": {
    "user": {
      "id": "6739f77bcf86cd799439011a",
      "name": "Sanjay Sharma",
      "email": "sanjay.sharma@example.com",
      "role": "CITIZEN",
      "isActive": true,
      "createdAt": "2026-11-18T02:00:00.000Z"
    }
  }
}
```

### 4.2 User Login & Token Generation
`POST /api/auth/login`
- **Role Access:** Public
- **Description:** Authenticates credentials and returns a signed JWT. Password hashes are never returned.
- **Request Body:**
```json
{
  "email": "operator@jodhpur.gov.in",
  "password": "OperatorSecure2026!"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "6739f77bcf86cd799439011b",
      "name": "Control Room Operator 1",
      "email": "operator@jodhpur.gov.in",
      "role": "OPERATOR",
      "isActive": true,
      "lastLoginAt": "2026-11-18T02:00:00.000Z"
    }
  }
}
```

### 4.3 Authenticated User Profile
`GET /api/auth/me`
- **Role Access:** Authenticated (`CITIZEN`, `OPERATOR`, `ADMIN`)
- **Headers:** `Authorization: Bearer <jwt_token>`
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Current user profile retrieved successfully",
  "data": {
    "user": {
      "id": "6739f77bcf86cd799439011b",
      "name": "Control Room Operator 1",
      "email": "operator@jodhpur.gov.in",
      "role": "OPERATOR",
      "isActive": true
    }
  }
}
```

---

## 5. Emergency Incident Lifecycle Endpoints

### 5.1 Citizen Incident Intake
`POST /api/incidents`
- **Role Access:** `CITIZEN` only
- **Description:** Submits an initial emergency incident. Automatically verifies that coordinates fall within the academic Jodhpur Urban Service Area polygon using ray-casting point-in-polygon algorithm.
- **Request Body:**
```json
{
  "category": "FIRE",
  "severity": 4,
  "victimCount": 2,
  "description": "Structure fire reported near clock tower market",
  "location": {
    "latitude": 26.2978,
    "longitude": 73.0185
  }
}
```
- **Allowed Categories:** `TRAFFIC_ACCIDENT`, `FIRE`, `MEDICAL_EMERGENCY`, `HAZMAT`, `STRUCTURAL_COLLAPSE`, `NATURAL_DISASTER`, `CIVIL_DISTURBANCE`, `OTHER`
- **Severity Range:** Integer `1` (lowest) to `5` (catastrophic)
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
      "description": "Structure fire reported near clock tower market",
      "location": {
        "latitude": 26.2978,
        "longitude": 73.0185
      },
      "reportedAt": "2026-11-18T02:05:00.000Z"
    }
  }
}
```

### 5.2 Citizen Personal Incident History
`GET /api/incidents/my`
- **Role Access:** `CITIZEN` only
- **Description:** Retrieves all incidents reported by the calling citizen, with operator IDs sanitized.
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
        "status": "DISPATCHED",
        "reportedAt": "2026-11-18T02:05:00.000Z",
        "dispatchedAt": "2026-11-18T02:08:30.000Z",
        "arrivedAt": null,
        "resolvedAt": null
      }
    ]
  }
}
```

### 5.3 Control Room Incident Directory (List & Filter)
`GET /api/incidents`
- **Role Access:** `OPERATOR`, `ADMIN`
- **Query Parameters:**
  - `status`: Filter by status (`REPORTED`, `VERIFIED`, `DISPATCHED`, `ON_SCENE`, `RESOLVED`, `REJECTED`)
  - `category`: Filter by emergency category
  - `severity`: Filter by severity integer (`1`..`5`)
  - `limit`: Number of records (default: 50, max: 200)
  - `page`: Page index (default: 1)
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Incidents retrieved successfully",
  "data": {
    "incidents": [ /* array of incident records */ ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 50,
      "pages": 1
    }
  }
}
```

### 5.4 Control Room Incident Verification
`PATCH /api/incidents/:incidentId/verify`
- **Role Access:** `OPERATOR`, `ADMIN`
- **Description:** Atomically marks a `REPORTED` incident as `VERIFIED`. Prevents race conditions via atomic conditional updates.
- **Request Body:**
```json
{
  "verificationNotes": "Confirmed via phone call with shop owner; heavy smoke visible."
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Incident verified successfully",
  "data": {
    "incident": {
      "incidentId": 1731895200001,
      "status": "VERIFIED",
      "verifiedAt": "2026-11-18T02:06:15.000Z",
      "verificationNotes": "Confirmed via phone call with shop owner; heavy smoke visible."
    }
  }
}
```

### 5.5 Control Room Incident Rejection
`PATCH /api/incidents/:incidentId/reject`
- **Role Access:** `OPERATOR`, `ADMIN`
- **Description:** Rejects a false alarm or duplicate `REPORTED` incident.
- **Request Body:**
```json
{
  "rejectionReason": "False alarm; fireworks misunderstanding confirmed by local patrol."
}
```

### 5.6 Active Dispatched Incidents Surveillance
`GET /api/incidents/active`
- **Role Access:** `OPERATOR`, `ADMIN`
- **Description:** Retrieves all incidents currently in active field mobilization (`DISPATCHED` or `ON_SCENE`).
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Active dispatched incidents retrieved successfully",
  "data": {
    "total": 1,
    "incidents": [
      {
        "incidentId": 1731895200001,
        "status": "DISPATCHED",
        "category": "FIRE",
        "severity": 4,
        "dispatchedAt": "2026-11-18T02:08:30.000Z",
        "assignedResourceIds": ["FIRE-01", "AMB-02"],
        "assignedHospitalId": "HOSP-01"
      }
    ]
  }
}
```

### 5.7 First Responder Scene Arrival
`PATCH /api/incidents/:incidentId/arrive`
- **Role Access:** `OPERATOR`, `ADMIN`
- **Description:** Advances incident from `DISPATCHED` to `ON_SCENE`. Enforces that the incident was previously dispatched.
- **Request Body:**
```json
{
  "arrivalNotes": "Engine 1 on scene, initiating fire suppression line."
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Incident marked as arrived on scene successfully",
  "data": {
    "incident": {
      "incidentId": 1731895200001,
      "status": "ON_SCENE",
      "arrivedAt": "2026-11-18T02:14:00.000Z"
    }
  }
}
```

### 5.8 Incident Resolution & Resource De-allocation
`PATCH /api/incidents/:incidentId/resolve`
- **Role Access:** `OPERATOR`, `ADMIN`
- **Description:** Transitions an `ON_SCENE` incident to `RESOLVED`. Releases assigned vehicles (`status: 'AVAILABLE'`) and replenishes reserved hospital beds idempotently.
- **Request Body:**
```json
{
  "resolutionNotes": "Fire extinguished completely. Casualties transported to MDM Hospital."
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Incident resolved successfully, resources released, and hospital capacity restored",
  "data": {
    "incident": {
      "incidentId": 1731895200001,
      "status": "RESOLVED",
      "resolvedAt": "2026-11-18T02:45:00.000Z"
    },
    "releasedResources": ["FIRE-01", "AMB-02"],
    "hospitalCapacityRestored": {
      "hospitalId": "HOSP-01",
      "bedsRestored": 2
    }
  }
}
```

---

## 6. Dispatch Recommendation & Execution Endpoints

### 6.1 Generate Dispatch Recommendations
`POST /api/dispatch/recommendations`
- **Role Access:** `OPERATOR`, `ADMIN`
- **Description:** Gathers verified incidents and available resources/hospitals from MongoDB, validates JSON contracts, and invokes the C++ decision engine subprocess (`cpp_engine/bin/decision_engine.exe`). Persists output as an immutable snapshot.
- **Request Body:**
```json
{
  "incidentIds": [1731895200001]
}
```
- **Response `201 Created`:**
```json
{
  "success": true,
  "message": "Dispatch recommendations generated successfully",
  "data": {
    "recommendation": {
      "batchId": "rec_1731895205_a1b2c3d4",
      "generatedAt": "2026-11-18T02:08:00.000Z",
      "allocations": [
        {
          "incidentId": 1731895200001,
          "allocatedResources": [
            {
              "resourceId": "FIRE-01",
              "type": "FIRE_TRUCK",
              "etaSeconds": 312.4,
              "distanceMeters": 2150.0,
              "route": { "nodeCount": 18, "geometry": [[26.28, 73.01], [26.29, 73.02]] }
            }
          ],
          "destinationHospital": {
            "hospitalId": "HOSP-01",
            "name": "MDM Hospital Jodhpur",
            "etaSeconds": 450.2,
            "allocatedBeds": 2
          }
        }
      ]
    }
  }
}
```

### 6.2 Confirm Dispatch Execution (Atomic Resource Reservation)
`POST /api/dispatch/recommendations/:batchId/confirm`
- **Role Access:** `OPERATOR`, `ADMIN`
- **Header:** `Idempotency-Key: <unique-uuid>`
- **Description:** Atomically executes the dispatch recommendation. In a MongoDB replica set, executes a multi-document ACID transaction:
  1. Transitions `Incident.status` from `VERIFIED` to `DISPATCHED`.
  2. Updates `Resource.status` to `DISPATCHED` with assignment links.
  3. Decrements available hospital bed capacity.
  4. Creates immutable `DispatchRecord`.
  Supports idempotent replays: re-sending the same `Idempotency-Key` safely returns HTTP 200 with the already-confirmed dispatch.
- **Request Body:**
```json
{
  "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "allowPartialDispatch": false,
  "confirmationNotes": "Authorized for immediate mobilization."
}
```
- **Response `201 Created` (or `200 OK` on idempotent replay):**
```json
{
  "success": true,
  "message": "Dispatch confirmed and units mobilized successfully",
  "data": {
    "dispatch": {
      "dispatchId": "disp_1731895210_e5f6g7h8",
      "batchId": "rec_1731895205_a1b2c3d4",
      "status": "CONFIRMED",
      "dispatchedAt": "2026-11-18T02:08:30.000Z",
      "dispatchedUnits": ["FIRE-01", "AMB-02"],
      "hospitalReservation": {
        "hospitalId": "HOSP-01",
        "reservedBeds": 2
      }
    }
  }
}
```

### 6.3 Retrieve Confirmed Dispatch Details
`GET /api/dispatch/:dispatchId`
- **Role Access:** `OPERATOR`, `ADMIN`
- **Description:** Retrieves full audit details of a confirmed dispatch operation.
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Dispatch details retrieved successfully",
  "data": {
    "dispatch": {
      "dispatchId": "disp_1731895210_e5f6g7h8",
      "batchId": "rec_1731895205_a1b2c3d4",
      "status": "CONFIRMED",
      "confirmedBy": "6739f77bcf86cd799439011b",
      "dispatchedAt": "2026-11-18T02:08:30.000Z"
    }
  }
}
```

