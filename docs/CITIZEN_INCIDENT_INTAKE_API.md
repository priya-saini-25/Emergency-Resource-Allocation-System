# Citizen Emergency Intake & Incident Surveillance API
**Jodhpur Urban Service Area Simulation Proxy**  
**Document Version:** 1.0.0 (Phase 4.2 Specification)  
**Geographic Reference:** OpenStreetMap Way 31725312 Settlement Boundary  
**Endpoints:** `POST /api/incidents`, `GET /api/incidents/my`, `GET /api/incidents`

---

## 1. Overview & Intake Workflow

The Citizen Emergency Intake API provides a secure, validated interface for citizens to submit urgent calls for assistance within the Jodhpur Urban Service Area. The intake process guarantees rigorous geographic validation and strict status gating:

```
  Citizen HTTP Client
          |
          | POST /api/incidents (Bearer JWT)
          v
+---------------------------------------------------------------------------------------------------+
|                                 Citizen Incident Intake Pipeline                                  |
|                                                                                                   |
|  1. Authentication & Role Check:                                                                  |
|     - Verify JWT token and confirm user role is strictly CITIZEN                                  |
|                                                                                                   |
|  2. Domain Validation:                                                                            |
|     - Category: MEDICAL, FIRE, ROAD_ACCIDENT, INDUSTRIAL                                          |
|     - Severity: Integer [1..5]                                                                    |
|     - Victim count: Integer >= 0                                                                  |
|     - Coordinates: Valid finite WGS84 latitude and longitude                                      |
|                                                                                                   |
|  3. Geographic Service Boundary Check:                                                            |
|     - Evaluate coordinates against Jodhpur GeoJSON polygon (Way 31725312)                         |
|     - Fast Bounding Box check -> Ray-Casting Point-in-Polygon check                               |
|     - Reject if outside: HTTP 400 OUTSIDE_SERVICE_AREA                                            |
|                                                                                                   |
|  4. Incident Record Creation:                                                                     |
|     - Assign unique positive integer incidentId                                                   |
|     - Link reportedBy = req.user._id                                                              |
|     - Enforce initial status = 'REPORTED'                                                         |
|     - NO automatic dispatch or C++ optimization triggered                                         |
+---------------------------------------------------------------------------------------------------+
          |
          v
    MongoDB Persistence
```

---

## 2. Citizen Incident Submission (`POST /api/incidents`)

### 2.1 Request Schema
- **Endpoint:** `POST /api/incidents`
- **Authentication:** Required (`Authorization: Bearer <token>`)
- **Authorized Role:** `CITIZEN` only
- **Payload Schema:**
  ```json
  {
    "category": "ROAD_ACCIDENT",
    "severity": 4,
    "victimCount": 2,
    "description": "Two vehicle collision on Pali Road near AIIMS Jodhpur",
    "location": {
      "latitude": 26.2550,
      "longitude": 73.0050
    }
  }
  ```

### 2.2 Validation Invariants
1. **Category:** Must match one of the four domain categories:
   - `MEDICAL`
   - `FIRE`
   - `ROAD_ACCIDENT`
   - `INDUSTRIAL`
2. **Severity:** Integer $\in [1, 5]$. Floating point or numbers outside this range return `400 INVALID_SEVERITY`.
3. **Victim Count:** Integer $\ge 0$. Defaults to `0`. Negative numbers return `400 INVALID_VICTIM_COUNT`.
4. **Description:** Optional string, trimmed, capped at 1,000 characters.
5. **Coordinates:** Must be finite floating-point numbers with $\text{latitude} \in [-90, 90]$ and $\text{longitude} \in [-180, 180]$.
6. **Geographic Boundary:** Evaluated by `isInsideJodhpurBoundary(lat, lng)`:
   - If coordinates lie outside the closed polygon, the request is rejected with `400 OUTSIDE_SERVICE_AREA`.

### 2.3 Success Response (`201 Created`)
```json
{
  "success": true,
  "message": "Emergency incident reported successfully",
  "data": {
    "incident": {
      "incidentId": 1771383049102,
      "category": "ROAD_ACCIDENT",
      "severity": 4,
      "victimCount": 2,
      "status": "REPORTED",
      "description": "Two vehicle collision on Pali Road near AIIMS Jodhpur",
      "location": {
        "latitude": 26.2550,
        "longitude": 73.0050
      },
      "reportedAt": "2026-11-18T00:45:00.000Z",
      "reportedBy": "607f1f77bcf86cd799439011"
    }
  }
}
```

### 2.4 Status Gating Guarantees
- The incident status is strictly initialized to `REPORTED`.
- Priority tier defaults to `UNKNOWN` and priority score to `null`.
- The incident **never** automatically transitions to `QUEUED`, `VERIFIED`, `ALLOCATED`, or `DISPATCHED`.
- The C++ Decision Engine is **never** invoked during citizen reporting, avoiding unmetered algorithmic load.

---

## 3. Geographic Boundary Validation Service

The validation service (`server/src/services/geographicService.js`) enforces spatial boundaries using the canonical GeoJSON dataset (`cpp_engine/data/jodhpur_boundary.geojson`):

- **Data Origin:** Academic proxy derived from OpenStreetMap Way 31725312 (Urban Settlement Footprint).
- **Bounding Box Acceleration:** Coordinates are first checked against the extreme envelope ($\text{minLat}: 26.2059842, \text{maxLat}: 26.3536661, \text{minLng}: 72.9485753, \text{maxLng}: 73.0888716$). Points outside are rejected immediately in $O(1)$ time.
- **Ray-Casting Algorithm:** Points inside the bounding box are evaluated against the 46-vertex closed linear ring using the standard Jordan curve ray-casting algorithm:
  $$\text{crossing} \iff (y_i > y) \ne (y_j > y) \land x \le \frac{(y - y_i)(x_j - x_i)}{y_j - y_i} + x_i$$
  Matches the exact mathematical implementation of C++ `BoundaryValidator::IsInside`.

---

## 4. Citizen Incident History (`GET /api/incidents/my`)

- **Endpoint:** `GET /api/incidents/my`
- **Authentication:** Required (`Authorization: Bearer <token>`)
- **Authorized Role:** `CITIZEN` only
- **Security Scoping:** Queries are hardcoded to `{ reportedBy: req.user._id }`. Citizens can **never** inspect other citizens' submissions, even by passing query parameters or IDs.
- **Query Parameters:**
  - `page`: Page index (integer $\ge 1$, default: `1`).
  - `limit`: Page size (integer $\ge 1$ and $\le 50$, default: `10`).
- **Sorting:** Deterministic reverse chronological order (`createdAt: -1, incidentId: -1`).
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Citizen incident history retrieved successfully",
    "data": {
      "incidents": [
        {
          "incidentId": 1771383049102,
          "category": "ROAD_ACCIDENT",
          "severity": 4,
          "victimCount": 2,
          "status": "REPORTED",
          "description": "Two vehicle collision on Pali Road near AIIMS Jodhpur",
          "location": {
            "latitude": 26.2550,
            "longitude": 73.0050
          },
          "priorityScore": null,
          "priorityTier": "UNKNOWN",
          "reportedAt": "2026-11-18T00:45:00.000Z",
          "createdAt": "2026-11-18T00:45:00.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 10,
        "totalCount": 1,
        "totalPages": 1
      }
    }
  }
  ```

---

## 5. Operator Incident View (`GET /api/incidents`)

- **Endpoint:** `GET /api/incidents`
- **Authentication:** Required (`Authorization: Bearer <token>`)
- **Authorized Roles:** `OPERATOR`, `ADMIN` (Citizens denied with `403 FORBIDDEN`).
- **Purpose:** Control-room visibility into all incoming reported emergency incidents across the city.
- **Optional Query Filters:**
  - `category`: Filter by emergency domain (`MEDICAL`, `FIRE`, `ROAD_ACCIDENT`, `INDUSTRIAL`).
  - `status`: Filter by status (`REPORTED`, `QUEUED`, `DISPATCHED`, `RESOLVED`, `CANCELLED`).
  - `page`: Page index (default: `1`).
  - `limit`: Page size (integer $\le 100$, default: `20`).
- **Sorting:** Deterministic order (`createdAt: -1, incidentId: -1`).
- **Reporter Details:** Populates safe fields (`name`, `email`) without exposing user passwords or sensitive metadata.

---

## 6. Error Codes Reference

| Error Code | HTTP Status | Trigger Condition |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or malformed Bearer authorization token |
| `FORBIDDEN` | 403 | User role not authorized for target endpoint |
| `INVALID_CATEGORY` | 400 | Category not in `[MEDICAL, FIRE, ROAD_ACCIDENT, INDUSTRIAL]` |
| `INVALID_SEVERITY` | 400 | Severity not an integer in `[1..5]` |
| `INVALID_VICTIM_COUNT` | 400 | Victim count negative or not an integer |
| `MISSING_COORDINATES` | 400 | Latitude or longitude missing |
| `INVALID_COORDINATES` | 400 | Coordinate values non-finite or out of geographical bounds |
| `OUTSIDE_SERVICE_AREA` | 400 | Location lies outside Jodhpur urban boundary polygon |
| `DESCRIPTION_TOO_LONG` | 400 | Description exceeds 1,000 characters |
| `INVALID_CATEGORY_FILTER` | 400 | Operator query category filter unrecognized |
| `INVALID_STATUS_FILTER` | 400 | Operator query status filter unrecognized |
| `DATABASE_UNAVAILABLE` | 503 | Database disconnected while attempting persistence operation |

---

## 7. Academic Simulation Disclaimer

> [!NOTE]
> All incident records, geographic boundary validations, and response classifications are conducted as part of an **academic simulation** representing the urban service perimeter of Jodhpur, Rajasthan. This system does not interface with or replace real 112/108 emergency call centers.

