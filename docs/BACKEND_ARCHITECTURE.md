# Backend Architecture — Emergency Resource Allocation System
**Jodhpur Urban Service Area Simulation Proxy**  
**Document Version:** 1.0.0 (Phase 4.1 Foundation)  
**Target Environment:** Node.js v24+ (ESM), Express 4.x, MongoDB/Mongoose 9.x, C++17 Core Engine

---

## 1. Architectural Overview

The Emergency Resource Allocation & Response Management System utilizes a multi-tiered architecture designed for low-latency decision support, resilient persistence, and computational isolation. The backend layer acts as the orchestrating bridge between the client-facing presentation layer (React + Vite), persistent operational records (MongoDB), and the high-performance compiled decision engine (`engine.exe` written in C++17).

```
                                      +---------------------------------------------+
                                      |            React + Vite Frontend            |
                                      |          (Client Presentation Tier)         |
                                      +---------------------------------------------+
                                                             |
                                                             | HTTP / JSON REST
                                                             v
+--------------------------------------------------------------------------------------------------------------------+
|                                         Node.js Express Backend Service                                            |
|                                                                                                                    |
|   +--------------------------+      +--------------------------+      +----------------------------------------+   |
|   |    Environment Config    |      |    Routing & Middlewares  |      |         Mongoose Data Models           |   |
|   |        (env.js)          |      |  - CORS, JSON Parser     |      |  - Resource, Hospital                  |   |
|   |  - Path Normalization    |      |  - ErrorHandler (4xx/5xx)|      |  - Incident, DispatchRecord            |   |
|   |  - Variable Validation   |      |  - NotFound (404)        |      |  - Schema Validation Invariants        |   |
|   +--------------------------+      +--------------------------+      +----------------------------------------+   |
|                |                                 |                                         |                       |
|                v                                 v                                         v                       |
|   +--------------------------+      +--------------------------+      +----------------------------------------+   |
|   |   Diagnostic Endpoints   |      | C++ Engine Bridge Service|      |          MongoDB Connection            |   |
|   |  - GET /api/health       | ---> |  (cppEngineService.js)   |      |             (database.js)              |   |
|   |  - GET /api/health/engine|      |  - stdin/stdout JSON v1.0|      |  - Non-blocking degraded mode          |   |
|   +--------------------------+      |  - Subprocess Spawn      |      |  - State & lifecycle event hooks       |   |
|                                     |  - Timeout & Buffer Guard|      +----------------------------------------+   |
+--------------------------------------------------------------------------------------------------------------------+
                                                   |                                         |
                                                   | child_process.spawn                     | Mongoose Wire Protocol
                                                   v                                         v
                                      +--------------------------+              +--------------------------+
                                      |     C++ Decision Engine  |              |      MongoDB Database    |
                                      |       (engine.exe)       |              | (emergency_response_...) |
                                      |  - Triage Priority (3.8) |              |  - Audit Records         |
                                      |  - Allocation (3.9)      |              |  - Resource Telemetry    |
                                      |  - Hospital Match (3.10) |              |  - Incident Archive      |
                                      |  - Dijkstra & Grid (3.4) |              +--------------------------+
                                      +--------------------------+
```

---

## 2. Directory Structure & Modular Layout

The backend directory structure enforces strict modularity, clean separation of concerns, and native ECMAScript Modules (`"type": "module"`):

```
server/
├── package.json                   # Dependency and script definitions (Node native test runner)
├── package-lock.json
├── .env.example                   # Baseline environment configuration template
├── src/
│   ├── app.js                     # Express application factory (exported for headless testing)
│   ├── server.js                  # Operational entry point (HTTP listener & lifecycle management)
│   ├── config/
│   │   ├── env.js                 # Environment validation, defaults, and path resolution
│   │   └── database.js            # Mongoose connection manager with degraded fallback
│   ├── controllers/
│   │   └── healthController.js    # Health, readiness, and diagnostic endpoint controllers
│   ├── middleware/
│   │   ├── errorHandler.js        # Centralized HTTP error handler mapping engine & DB faults
│   │   └── notFound.js            # Standard 404 handler for unmapped routes
│   ├── models/
│   │   ├── Resource.js            # Emergency vehicle schema, coordinates & availability
│   │   ├── Hospital.js            # Facility capabilities, bed capacities & node IDs
│   │   ├── Incident.js            # Emergency incident triage schema & demands
│   │   └── DispatchRecord.js      # Optimization decision audit logs & telemetry
│   ├── routes/
│   │   └── healthRoutes.js        # Health route declarations (/api/health, /api/health/engine)
│   └── services/
│       └── cppEngineService.js    # Subprocess bridge managing child_process execution of engine.exe
└── tests/
    ├── env.test.js                # Configuration validation and path normalization tests
    ├── models.test.js             # Mongoose schema validation invariants & protocol converters
    ├── cppEngineService.test.js   # Live C++ subprocess execution, exit codes & timeout tests
    ├── health.test.js             # Diagnostic API integration tests
    └── errorHandler.test.js       # Error middleware mapping tests
```

---

## 3. Data Models & Domain Schema Invariants

All data schemas enforce strict alignment with the C++ Decision Engine domain types to guarantee lossless bidirectional serialization.

### 3.1 Resource Model (`Resource.js`)
Represents deployable emergency vehicles stationed across the Jodhpur urban network.

| Field | Type | Rules & Constraints | Alignment with C++ |
|---|---|---|---|
| `resourceId` | Number | Required, Unique, Integer $\ge 1$ | `resource_id` (`uint64_t`) |
| `name` | String | Trimmed, Default: `"Resource-{resourceId}"` | Display descriptor |
| `resourceType` | String | Enum: `ALS_AMBULANCE`, `BLS_AMBULANCE`, `FIRE_ENGINE`, `FIRE_TENDER`, `RESCUE_VEHICLE` | `ResourceType` enum (`[0..4]`) |
| `status` | String | Enum: `AVAILABLE`, `RESERVED`, `DISPATCHED`, `OUT_OF_SERVICE` | `AvailabilityStatus` enum (`[0..3]`) |
| `capacity` | Number | Integer $\ge 1$, Default: `1` | `capacity` (`uint32_t`) |
| `latitude` | Number | Finite, $\in [-90.0, 90.0]$ | Geographic latitude |
| `longitude` | Number | Finite, $\in [-180.0, 180.0]$ | Geographic longitude |
| `currentNodeOsmId` | Number | Integer, Default: `null` | Pre-snapped OSM node ID |

### 3.2 Hospital Model (`Hospital.js`)
Represents emergency medical centers and trauma facilities within the Jodhpur jurisdiction.

| Field | Type | Rules & Constraints | Alignment with C++ |
|---|---|---|---|
| `hospitalId` | Number | Required, Unique, Integer $\ge 1$ | `hospital_id` (`uint64_t`) |
| `name` | String | Required, Trimmed | `hospital_name` (`std::string`) |
| `status` | String | Enum: `OPERATIONAL`, `TEMPORARILY_UNAVAILABLE`, `CLOSED` | `HospitalStatus` enum (`[0..2]`) |
| `capabilities` | [String] | Array of recognized capabilities: `GENERAL_EMERGENCY`, `TRAUMA`, `ICU`, `OXYGEN_SUPPORT`, `BURN_TREATMENT`, `SURGICAL_SUPPORT` | Bitmask / array matching C++ capabilities |
| `icuBeds` | Object | `{ total: Number >= 0, available: Number >= 0 }` where `available <= total` | `icu_beds_total`, `icu_beds_available` |
| `generalBeds` | Object | `{ total: Number >= 0, available: Number >= 0 }` where `available <= total` | `general_beds_total`, `general_beds_available` |
| `oxygenBeds` | Object | `{ total: Number >= 0, available: Number >= 0 }` where `available <= total` | `oxygen_beds_total`, `oxygen_beds_available` |
| `latitude` | Number | Finite, $\in [-90.0, 90.0]$ | Facility latitude |
| `longitude` | Number | Finite, $\in [-180.0, 180.0]$ | Facility longitude |
| `nodeOsmId` | Number | Integer, Default: `null` | Pre-snapped OSM node ID |

### 3.3 Incident Model (`Incident.js`)
Represents citizen emergency calls or system-detected emergency events requiring response optimization.

| Field | Type | Rules & Constraints | Alignment with C++ |
|---|---|---|---|
| `incidentId` | Number | Required, Unique, Integer $\ge 1$ | `incident_id` (`uint64_t`) |
| `category` | String | Enum: `MEDICAL`, `FIRE`, `ROAD_ACCIDENT`, `INDUSTRIAL` | `EmergencyCategory` enum (`[0..3]`) |
| `severity` | Number | Integer $\in [1, 5]$ | `severity` (`uint32_t`) |
| `victimCount` | Number | Integer $\ge 0$, Default: `0` | `victim_count` (`uint32_t`) |
| `status` | String | Enum: `REPORTED`, `QUEUED`, `DISPATCHED`, `RESOLVED`, `CANCELLED` | Incident workflow lifecycle |
| `latitude` | Number | Finite, $\in [-90.0, 90.0]$ | Incident scene latitude |
| `longitude` | Number | Finite, $\in [-180.0, 180.0]$ | Incident scene longitude |
| `priorityScore` | Number | Calculated floating point priority score | Output of PriorityEngine (3.8) |
| `priorityTier` | String | Enum: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN` | Priority tier classification |

### 3.4 DispatchRecord Model (`DispatchRecord.js`)
Audit log persisting batch optimization results generated by the C++ engine.

- `batchId`: Unique dispatch run identifier.
- `batchStatus`: `SUCCESS`, `PARTIAL`, `FAILED`.
- `totalIncidents`, `fullyAllocatedCount`, `partiallyAllocatedCount`, `unallocatedCount`.
- `incidentResults`: Detailed allocation breakdown containing resource arrival ETAs, route polyline summaries, hospital bed reservations, and travel times.
- `engineTelemetry`: Engine execution wall-clock time, Dijkstra traversal counts, and multi-target calls.

---

## 4. C++ Decision Engine Bridge Architecture

The backend never executes algorithmic routing or multi-incident triage in JavaScript. Instead, it delegates all computational optimization to the native C++ decision engine (`cpp_engine/bin/engine.exe`) via `cppEngineService.js`.

### 4.1 Execution Protocol
1. **Invocation Mechanics:** Invoked via `child_process.spawn(enginePath, ['--data-dir', dataDir], { stdio: ['pipe', 'pipe', 'pipe'] })`.
2. **Environment Isolation:** On Windows systems, the spawn environment dynamically prepends `CPP_EXTRA_PATH` (defaulting to `C:\msys64\ucrt64\bin`) to `PATH` to guarantee that GCC/UCRT runtime libraries (`libstdc++-6.dll`, `libgcc_s_seh-1.dll`) resolve without global system contamination.
3. **Stream Protocol:** Requests are structured conforming to **Protocol v1.0 Envelope**:
   ```json
   {
     "protocol_version": "1.0",
     "request_id": "uuid-v4-string",
     "operation": "dispatch_batch",
     "payload": {
       "evaluated_at_ms": 1700000000000,
       "incidents": [...],
       "resources": [...],
       "hospitals": [...]
     }
   }
   ```
4. **Clean Channel Separation:**
   - **`stdout`**: Reserved strictly for machine-readable JSON envelopes.
   - **`stderr`**: Reserved strictly for diagnostic logging and telemetry.

### 4.2 Security Guards & Process Controls
- **Timeout Protection:** Configurable timeout (default: 10,000 ms). If the subprocess does not exit before the timeout, `SIGTERM` is dispatched, followed by forceful `SIGKILL` after 500 ms. An `EngineTimeoutError` (HTTP 504) is thrown.
- **Buffer Overflow Safeguards:** Configurable stream buffer caps (default: 10 MB). If stdout or stderr accumulation exceeds this threshold, the subprocess is immediately terminated to prevent heap exhaustion.
- **Standard Exit Code Mapping:**
  - `0`: Success (Parse JSON stdout and return optimization plan).
  - `1`: Validation/Protocol Error $\rightarrow$ `EngineValidationError` (HTTP 400).
  - `2`: Dataset/Initialization Error $\rightarrow$ `EngineDatasetError` (HTTP 503).
  - `3`: Engine Execution Error $\rightarrow$ `EngineExecutionError` (HTTP 500).

---

## 5. Non-Blocking Database Lifecycle & Degraded Mode

To support robust deployments and isolated testing environments where a live MongoDB daemon may not be active, the database connection module (`database.js`) enforces **graceful non-blocking degradation**:

1. **Initial Connection Attempt:** Uses a short server selection timeout (`2,500 ms`).
2. **Failure Handling:** If the database daemon is unreachable (`ECONNREFUSED` or `EACCES`), the connection error is logged as a non-fatal warning:
   ```
   [DATABASE_WARNING] Operating in offline/degraded persistence mode. Algorithmic C++ engine remains fully active.
   ```
3. **Application Resilience:** The HTTP server proceeds to initialize and bind the port, allowing the C++ engine routing, health diagnostics, and in-memory optimizations to operate normally.
4. **Health Reporting:** `/api/health` accurately reflects `database: "disconnected"` while reporting overall system status as `degraded` instead of crashing.

---

## 6. Health & Diagnostic Endpoints

The system provides dual-tier health endpoints for monitoring and orchestrator integration:

### `GET /api/health`
Returns high-level system telemetry, runtime metrics, and component availability.

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "Emergency Resource Allocation & Response Management System",
    "region": "Jodhpur Urban Service Area, Rajasthan (Academic Simulation)",
    "environment": "development",
    "timestamp": "2026-11-18T00:30:00.000Z",
    "uptimeSeconds": 145.2,
    "memoryUsageMb": {
      "rss": 54.3,
      "heapUsed": 26.8,
      "heapTotal": 35.1
    },
    "components": {
      "database": {
        "status": "connected",
        "state": "connected",
        "host": "localhost",
        "name": "emergency_response_jodhpur"
      },
      "cppEngine": {
        "status": "healthy",
        "protocolVersion": "1.0",
        "engineName": "Jodhpur Emergency Dispatch Engine",
        "probeLatencyMs": 35
      }
    }
  }
}
```

### `GET /api/health/engine`
Detailed low-level diagnostic verifying the physical existence of canonical datasets and the executable binary.

```json
{
  "success": true,
  "data": {
    "engine": {
      "status": "healthy",
      "versionInfo": {
        "engine": "Jodhpur Emergency Dispatch Engine",
        "protocol_version": "1.0",
        "supported_operations": ["dispatch_batch"],
        "cpp_standard": 201703
      },
      "path": ".../cpp_engine/bin/engine.exe",
      "wallClockMs": 35
    },
    "dataDirectory": {
      "path": ".../cpp_engine/data",
      "allDatasetsPresent": true,
      "datasets": [
        { "file": "jodhpur_graph.json", "exists": true, "sizeBytes": 16168019 },
        { "file": "jodhpur_roads.geojson", "exists": true, "sizeBytes": 20297495 },
        { "file": "jodhpur_boundary.geojson", "exists": true, "sizeBytes": 12285 },
        { "file": "road_network_metadata.json", "exists": true, "sizeBytes": 1205 }
      ]
    },
    "executable": {
      "path": ".../cpp_engine/bin/engine.exe",
      "exists": true
    }
  }
}
```

---

## 7. Error Handling Strategy

The centralized error middleware (`errorHandler.js`) normalizes all system exceptions into a uniform REST envelope:

```json
{
  "success": false,
  "error": {
    "status": 400,
    "code": "ENGINE_VALIDATION_ERROR",
    "message": "C++ engine rejected request payload: validation error",
    "details": {
      "field": "payload.incidents[0].severity",
      "issue": "Missing or invalid integer severity"
    },
    "timestamp": "2026-11-18T00:30:00.000Z"
  }
}
```

| Exception Type | HTTP Status | Error Code | Description |
|---|---|---|---|
| `SyntaxError` (JSON body) | 400 | `INVALID_JSON_BODY` | Client passed malformed JSON in HTTP request body |
| `EngineValidationError` | 400 | `ENGINE_VALIDATION_ERROR` | C++ engine rejected request schema or coordinate bounds |
| `Mongoose ValidationError` | 400 | `SCHEMA_VALIDATION_ERROR` | Document failed Mongoose schema constraints |
| `EngineDatasetError` | 503 | `ENGINE_DATASET_UNAVAILABLE` | Graph data or service boundary files missing on disk |
| `EngineTimeoutError` | 504 | `ENGINE_GATEWAY_TIMEOUT` | Subprocess execution exceeded timeout limit |
| `EngineExecutionError` | 500 | `ENGINE_EXECUTION_FAILURE` | C++ engine crashed or returned exit code 3 |
| `EngineBufferOverflowError` | 500 | `ENGINE_BUFFER_OVERFLOW` | Stream output exceeded memory threshold |
| Unhandled Exceptions | 500 | `INTERNAL_SERVER_ERROR` | Catch-all for unexpected internal runtime faults |

---

## 8. Academic Simulation Disclaimer

> [!NOTE]
> This backend is developed solely as an **academic emergency dispatch decision-support simulation** for the urban service area of Jodhpur, Rajasthan. It does not replace, override, or interface with real-world municipal 112/108/101 emergency response networks. All response times, hospital capacities, and vehicle locations represent synthetic modeling proxies.

