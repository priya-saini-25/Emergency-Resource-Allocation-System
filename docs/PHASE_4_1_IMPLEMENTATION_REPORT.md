# PHASE 4.1 IMPLEMENTATION AND VERIFICATION REPORT
## Backend Foundation, MongoDB Integration & C++ Engine Bridge

**Project:** Emergency Resource Allocation & Response Management System  
**Jurisdiction:** Jodhpur Urban Service Area, Rajasthan, India (Academic Simulation Proxy)  
**Phase:** 4.1 — Backend Foundation, MongoDB Integration & Node.js–C++ Process Bridge  
**Execution Date:** 2026-11-18  
**Status:** COMPLETE & VERIFIED — ALL 33 NODE.JS TESTS PASSED, ALL 14 C++ REGRESSION TESTS PASSED (100%)

---

## 1. Executive Summary

Phase 4.1 successfully establishes the backend infrastructure for the **Emergency Resource Allocation & Response Management System**, bridging the Node.js / Express API tier with the previously completed and verified C++17 decision engine (`engine.exe`, Phases 3.1–3.13) and the MongoDB persistence layer.

The implementation delivers:
1. An asynchronous process bridge (`server/src/services/cppEngineService.js`) that communicates with `engine.exe` via standard input/output conforming to **Protocol v1.0 Envelope**, supporting live multi-incident dispatch optimization.
2. A non-blocking Mongoose connection module (`server/src/config/database.js`) providing graceful degradation when MongoDB is disconnected, allowing routing and decision-support features to remain operational.
3. Four core Mongoose domain models (`Resource`, `Hospital`, `Incident`, `DispatchRecord`) with strict schema constraints aligned 1-to-1 with C++ algorithmic enums and bidirectional protocol converters.
4. Centralized error handling (`server/src/middleware/errorHandler.js`) mapping C++ engine exit codes and runtime exceptions to standard HTTP error codes (`400`, `500`, `503`, `504`).
5. Dual-tier health endpoints (`GET /api/health` and `GET /api/health/engine`) providing deep diagnostic inspection of executable presence, dataset integrity, probe latency, and database status.
6. A comprehensive automated test suite (33 tests across 5 suites using Node.js v24 native `node:test`), all passing with zero failures.
7. 100% regression pass rate across all 14 compiled C++ regression executables, with zero modifications to canonical routing algorithms and verified SHA-256 integrity of all datasets.

---

## 2. Implementation Scope & Completed Deliverables

| Deliverable | File Path | Status | Verification Summary |
|---|---|---|---|
| Environment Configuration | `server/src/config/env.js` | Complete | Validates `PORT`, `NODE_ENV`, `CPP_TIMEOUT_MS`, resolves absolute paths |
| Environment Example | `server/.env.example` & `.env.example` | Complete | Full documentation of server and engine environment variables |
| Database Connection Manager | `server/src/config/database.js` | Complete | Non-blocking connection, lifecycle hooks, state interrogation |
| Resource Model | `server/src/models/Resource.js` | Complete | Enforces `RESOURCE_TYPES`, coordinate limits, `toEngineProtocol()` |
| Hospital Model | `server/src/models/Hospital.js` | Complete | Enforces bed invariants (`available <= total`), `capabilities` |
| Incident Model | `server/src/models/Incident.js` | Complete | Enforces `EMERGENCY_CATEGORIES`, severity $\in [1, 5]$, `toEngineProtocol()` |
| Dispatch Record Model | `server/src/models/DispatchRecord.js` | Complete | Audit log persisting batch results, status, and engine telemetry |
| C++ Process Bridge Service | `server/src/services/cppEngineService.js` | Complete | Subprocess spawn, timeout, buffer limits, exit code mapping |
| Centralized Error Handler | `server/src/middleware/errorHandler.js` | Complete | Maps `EngineValidationError` (400), `EngineDatasetError` (503), etc. |
| 404 Route Handler | `server/src/middleware/notFound.js` | Complete | Structured JSON 404 response |
| Health Controller | `server/src/controllers/healthController.js` | Complete | Evaluates system uptime, database state, and engine diagnostics |
| Health Routes | `server/src/routes/healthRoutes.js` | Complete | Declares `/api/health` and `/api/health/engine` |
| Express App Factory | `server/src/app.js` | Complete | Configures CORS, JSON parser (10MB cap), routes, error handling |
| Server Entry Point | `server/src/server.js` | Complete | Starts HTTP listener on `PORT`, graceful shutdown hooks |
| Automated Test Suite | `server/tests/` (5 test files) | Complete | 33 automated tests passing in 2.16s via native `node:test` |
| Backend Architecture Guide | `docs/BACKEND_ARCHITECTURE.md` | Complete | Architectural guide, tier layouts, schema invariants |
| C++ Engine Integration Spec | `docs/CPP_ENGINE_INTEGRATION.md` | Complete | JSON protocol v1.0, stream separation, Windows DLL pathing |
| Implementation Report | `docs/PHASE_4_1_IMPLEMENTATION_REPORT.md` | Complete | Comprehensive 21-section audit report |

---

## 3. Architecture & Modular Layout

```
server/
├── package.json
├── .env.example
├── src/
│   ├── app.js                         # Headless Express app export
│   ├── server.js                      # HTTP server listener & graceful shutdown
│   ├── config/
│   │   ├── env.js                     # Environment variable validation & paths
│   │   └── database.js                # Mongoose connection & degraded fallback
│   ├── controllers/
│   │   └── healthController.js        # Health & engine diagnostics
│   ├── middleware/
│   │   ├── errorHandler.js            # Centralized exception to HTTP mapper
│   │   └── notFound.js                # Unmapped 404 handler
│   ├── models/
│   │   ├── Resource.js                # Resource schema & C++ converter
│   │   ├── Hospital.js                # Hospital schema & bed validation
│   │   ├── Incident.js                # Incident triage schema & demands
│   │   └── DispatchRecord.js          # Optimization decision audit logs
│   ├── routes/
│   │   └── healthRoutes.js            # Mounted at /api/health
│   └── services/
│       └── cppEngineService.js        # Child process execution of engine.exe
└── tests/
    ├── env.test.js                    # Config & path resolution tests
    ├── models.test.js                 # Schema validation & protocol conversion
    ├── cppEngineService.test.js       # Live engine execution & exit codes
    ├── health.test.js                 # Health and diagnostic API tests
    └── errorHandler.test.js           # Error status mapping tests
```

---

## 4. Environment Configuration & Path Normalization

`server/src/config/env.js` validates environment variables on startup:

- `PORT`: Normalized to an integer $\in [1, 65535]$ (default: `5000`).
- `NODE_ENV`: Validated against `['development', 'production', 'test']` (default: `'development'`).
- `MONGODB_URI`: Connection string (default: `'mongodb://localhost:27017/emergency_response_jodhpur'`).
- `CPP_ENGINE_PATH`: Normalized to an absolute path targeting `cpp_engine/bin/engine.exe`.
- `CPP_DATA_DIR`: Normalized to an absolute path targeting `cpp_engine/data`.
- `CPP_TIMEOUT_MS`: Subprocess execution timeout in milliseconds (default: `10000`).
- `CPP_MAX_BUFFER_BYTES`: Buffer overflow limit in bytes (default: `10485760` / 10MB).
- `CPP_EXTRA_PATH`: Toolchain DLL directory on Windows (default: `C:\msys64\ucrt64\bin`).
- `JODHPUR_CENTER`: Center coordinate reference (`lat: 26.2918, lng: 73.0168`).

---

## 5. MongoDB Lifecycle & Non-Blocking Degraded Persistence Mode

In `server/src/config/database.js`, database connectivity is decoupled from core routing availability:

1. **Short Initial Timeout:** When attempting connection, `serverSelectionTimeoutMS: 2500` ensures the server never hangs indefinitely if MongoDB is offline.
2. **Degraded Execution:** If MongoDB is unreachable, the exception is caught, logged as a non-fatal warning, and the server proceeds in **offline/degraded persistence mode**.
3. **State Transparency:** `getConnectionStatus()` returns `{ connected, state, host, port, name }`.
4. **Health Integration:** `GET /api/health` reports `status: "degraded"` when the database is offline while keeping the C++ engine active and accessible.
5. **Teardown Hooks:** `disconnectDatabase()` cleanly closes active connections during graceful shutdown.

---

## 6. Mongoose Data Models & Invariant Rules

### 6.1 Resource Model (`Resource.js`)
- Enforces equipment types: `ALS_AMBULANCE`, `BLS_AMBULANCE`, `FIRE_ENGINE`, `FIRE_TENDER`, `RESCUE_VEHICLE`.
- Enforces status values: `AVAILABLE`, `RESERVED`, `DISPATCHED`, `OUT_OF_SERVICE`.
- Coordinates bounded to $\text{lat} \in [-90, 90]$, $\text{lng} \in [-180, 180]$ and verified finite.
- `toEngineProtocol()` formats records into C++ `resource_id`, `resource_type`, `status`, `capacity`, `latitude`, `longitude`, `current_node_osm_id`.

### 6.2 Hospital Model (`Hospital.js`)
- Enforces status values: `OPERATIONAL`, `TEMPORARILY_UNAVAILABLE`, `CLOSED`.
- Capabilities restricted to recognized types: `GENERAL_EMERGENCY`, `TRAUMA`, `ICU`, `OXYGEN_SUPPORT`, `BURN_TREATMENT`, `SURGICAL_SUPPORT`.
- Bed capacity validation: for `icuBeds`, `generalBeds`, and `oxygenBeds`, `available <= total` is strictly enforced.
- `toEngineProtocol()` serializes bed totals and availability into C++ fields.

### 6.3 Incident Model (`Incident.js`)
- Enforces categories: `MEDICAL`, `FIRE`, `ROAD_ACCIDENT`, `INDUSTRIAL`.
- Enforces severity: integer $\in [1, 5]$.
- Enforces victim count: integer $\ge 0$.
- `toEngineProtocol()` outputs `incident_id`, `category`, `severity`, `victim_count`, `created_at_ms`, `latitude`, `longitude`.

### 6.4 DispatchRecord Model (`DispatchRecord.js`)
- Stores complete batch results: `batchId`, `batchStatus` (`SUCCESS`, `PARTIAL`, `FAILED`), incident allocations, travel distances, ETAs, and engine execution telemetry.

---

## 7. C++ Engine Process Bridge Service (`cppEngineService.js`)

The bridge service implements safe execution of the C++ decision engine executable:

- Direct invocation via `child_process.spawn(enginePath, ['--data-dir', dataDir], { stdio: ['pipe', 'pipe', 'pipe'] })`.
- Never invokes shell wrappers (`cmd.exe` or `powershell.exe`), preventing injection risks.
- Formulates Protocol v1.0 request envelope and writes to `stdin`.
- Accumulates `stdout` and `stderr` independently.
- Measures subprocess wall-clock execution time and injects `process_bridge_wall_clock_ms` into the response telemetry.

---

## 8. JSON Protocol v1.0 Envelope & Serialization Mechanics

### Request Envelope:
```json
{
  "protocol_version": "1.0",
  "request_id": "<uuid>",
  "operation": "dispatch_batch",
  "payload": {
    "evaluated_at_ms": 1700000000000,
    "incidents": [...],
    "resources": [...],
    "hospitals": [...]
  }
}
```

### Response Envelope:
```json
{
  "protocol_version": "1.0",
  "request_id": "<uuid>",
  "operation": "dispatch_batch",
  "status": "success",
  "success": true,
  "data": {
    "batch_id": 1,
    "batch_status": "SUCCESS",
    "summary": { ... },
    "incident_results": [ ... ]
  },
  "metadata": { ... },
  "telemetry": {
    "total_engine_time_ms": 1107.47,
    "process_bridge_wall_clock_ms": 1426
  }
}
```

---

## 9. Process Exit Codes & Error Mapping Strategy

| Exit Code | C++ Engine Meaning | Node.js Exception | HTTP Status | Response Code |
|---|---|---|---|---|
| `0` | Success | None | `200 OK` | `SUCCESS` |
| `1` | Protocol / Payload Error | `EngineValidationError` | `400 Bad Request` | `ENGINE_VALIDATION_ERROR` |
| `2` | Missing Dataset / Load Error | `EngineDatasetError` | `503 Service Unavailable` | `ENGINE_DATASET_UNAVAILABLE` |
| `3` | Internal Engine Execution Error | `EngineExecutionError` | `500 Internal Error` | `ENGINE_EXECUTION_FAILURE` |
| Signal | Subprocess Crash / Terminated | `EngineError` | `500 Internal Error` | `ENGINE_BRIDGE_ERROR` |
| Timeout | Subprocess execution exceeded limit | `EngineTimeoutError` | `504 Gateway Timeout` | `ENGINE_GATEWAY_TIMEOUT` |
| Overflow | Stream buffer exceeded memory limit | `EngineBufferOverflowError` | `500 Internal Error` | `ENGINE_BUFFER_OVERFLOW` |

---

## 10. Timeout Protection & Buffer Overflow Guards

1. **Subprocess Timeout Guard:** Every spawn schedules a timeout handle for `CPP_TIMEOUT_MS` (default 10s). If the subprocess hangs, it dispatches `SIGTERM`, followed by `SIGKILL` after 500ms, and rejects with `EngineTimeoutError` (HTTP 504). Verified by unit test `should reject with EngineTimeoutError if engine execution exceeds timeout threshold`.
2. **Buffer Overflow Guard:** Both `stdout` and `stderr` streams tally received chunk lengths against `CPP_MAX_BUFFER_BYTES` (10MB). Exceeding this limit forces immediate `SIGKILL` termination, protecting the Node.js event loop from memory exhaustion.

---

## 11. Windows UCRT64 / MSYS2 Toolchain Compatibility

Executables compiled under MSYS2 GCC UCRT64 require standard dynamic runtime DLLs (`libstdc++-6.dll`, `libgcc_s_seh-1.dll`, `libwinpthread-1.dll`).

To enable reliable invocation from Node.js on Windows without modifying global system environment variables, `buildSpawnEnvironment()` inspects `process.platform === 'win32'` and prepends `CPP_EXTRA_PATH` (`C:\msys64\ucrt64\bin`) to `process.env.PATH`. This eliminates `EACCES` or `STATUS_DLL_NOT_FOUND` launch failures.

---

## 12. Centralized Error Handling & HTTP Status Code Mapping

`server/src/middleware/errorHandler.js` normalizes all exceptions into a consistent schema:

```json
{
  "success": false,
  "error": {
    "status": 400,
    "code": "ENGINE_VALIDATION_ERROR",
    "message": "C++ engine rejected request payload: validation error",
    "details": { ... },
    "timestamp": "2026-11-18T00:30:00.000Z"
  }
}
```

- Handles `SyntaxError` for invalid JSON request bodies (`400 INVALID_JSON_BODY`).
- Handles `Mongoose.ValidationError` for schema constraint failures (`400 SCHEMA_VALIDATION_ERROR`).
- Handles `Mongoose.CastError` for malformed IDs (`400 INVALID_FIELD_TYPE`).
- Handles engine error classes with corresponding HTTP status codes (`400`, `500`, `503`, `504`).
- Logs `CRITICAL_SERVER_ERROR` with stack traces for 5xx errors in non-test environments.

---

## 13. Health & Diagnostic Endpoints

### 13.1 `GET /api/health`
Evaluates high-level system readiness and status:
- Response Status: `200 OK` (when healthy or degraded), `503 Service Unavailable` (when critical).
- Telemetry: Express runtime uptime, RSS and heap memory consumption.
- Components: Database connectivity status (`connected` vs `disconnected`), C++ engine responsiveness (`healthy` vs `unhealthy`), protocol version (`1.0`), and probe latency in milliseconds.

### 13.2 `GET /api/health/engine`
Dedicated low-level diagnostic verifying the physical existence of canonical datasets and the compiled binary:
- Physical presence and byte size of `jodhpur_graph.json` (16,168,019 bytes).
- Physical presence and byte size of `jodhpur_roads.geojson` (20,297,495 bytes).
- Physical presence and byte size of `jodhpur_boundary.geojson` (12,285 bytes).
- Physical presence and byte size of `road_network_metadata.json` (1,205 bytes).
- Verifies output of `engine.exe --version` matches Protocol v1.0.

---

## 14. Automated Test Suite Results (`node:test`)

The test suite was executed using Node.js v24 native test runner (`node --test tests/**/*.test.js`).

### Test Execution Summary:
- **Total Tests:** 33
- **Passed:** 33 (100%)
- **Failed:** 0
- **Duration:** 2,163 ms

```
▶ C++ Decision Engine Bridge Service
  ✔ should verify engine health via --version protocol negotiation (51.3358ms)
  ✔ should successfully execute a live multi-incident dispatch optimization batch (1430.4915ms)
  ✔ should map engine Exit Code 1 to EngineValidationError with statusCode 400 (36.9022ms)
  ✔ should map invalid dataset directory (Exit Code 2) to EngineDatasetError with statusCode 503 (0.8733ms)
  ✔ should reject with EngineTimeoutError if engine execution exceeds timeout threshold (9.4817ms)
✔ C++ Decision Engine Bridge Service (1530.7179ms)

▶ Environment Configuration Module
  ✔ should expose validated environment defaults (1.0088ms)
  ✔ should resolve C++ binary and data paths to absolute filesystem locations (0.1938ms)
  ✔ should provide default Jodhpur geographical center coordinates (0.1711ms)
✔ Environment Configuration Module (4.0657ms)

▶ Error Handler Middleware
  ✔ should map SyntaxError (malformed body) to 400 INVALID_JSON_BODY (3.5407ms)
  ✔ should map EngineValidationError to 400 ENGINE_VALIDATION_ERROR (1.3585ms)
  ✔ should map EngineDatasetError to 503 ENGINE_DATASET_UNAVAILABLE (0.5054ms)
  ✔ should map EngineExecutionError to 500 ENGINE_EXECUTION_FAILURE (0.2687ms)
  ✔ should map EngineTimeoutError to 504 ENGINE_GATEWAY_TIMEOUT (0.2846ms)
  ✔ should map EngineBufferOverflowError to 500 ENGINE_BUFFER_OVERFLOW (0.2821ms)
  ✔ should map generic Error to 500 INTERNAL_SERVER_ERROR (0.3077ms)
✔ Error Handler Middleware (8.296ms)

▶ Health and Diagnostic Endpoints API
  ✔ should evaluate global health via getHealth controller (47.1401ms)
  ✔ should report engine binary and dataset status via getEngineHealth controller (36.812ms)
  ✔ should handle unmapped routes through Express app and return 404 (1.8257ms)
  ✔ should dispatch GET /api/health through Express app middleware chain (38.2493ms)
  ✔ should dispatch GET /api/health/engine through Express app middleware chain (31.0627ms)
✔ Health and Diagnostic Endpoints API (156.4627ms)

▶ Mongoose Models & Schema Constraints
  ▶ Resource Model
    ✔ should validate a properly structured resource document (7.1332ms)
    ✔ should reject invalid resource types not aligned with C++ enums (2.2689ms)
    ✔ should reject coordinates outside geographical ranges (0.7255ms)
    ✔ should transform to valid C++ engine protocol object (0.2998ms)
  ✔ Resource Model (11.2755ms)
  ▶ Hospital Model
    ✔ should validate a valid hospital document with bed categories (4.8303ms)
    ✔ should reject hospital if available beds exceed total beds (2.0025ms)
    ✔ should reject invalid capability strings (0.8321ms)
    ✔ should serialize to C++ hospital protocol format (1.0668ms)
  ✔ Hospital Model (9.0558ms)
  ▶ Incident Model
    ✔ should validate a valid emergency incident document (2.7561ms)
    ✔ should reject incident severity less than 1 or greater than 5 (1.4117ms)
    ✔ should reject negative victim count (0.6103ms)
    ✔ should serialize to C++ incident protocol format (1.1333ms)
  ✔ Incident Model (6.1457ms)
  ▶ DispatchRecord Model
    ✔ should validate a complete dispatch record document (1.4336ms)
  ✔ DispatchRecord Model (1.4985ms)
✔ Mongoose Models & Schema Constraints (28.5042ms)
```

---

## 15. End-to-End Live Decision Engine Verification

The bridge service was tested against the compiled C++ executable `engine.exe` running the authentic Jodhpur road network graph (59,334 nodes, 129,778 edges):

1. **Protocol Handshake (`engine.exe --version`):**
   - Probe Latency: 35–50 ms.
   - Output parsed successfully as valid JSON with `protocol_version: "1.0"`.
2. **Live Dispatch Batch (2 Incidents, 3 Resources, 1 Hospital):**
   - Incident 201: `ROAD_ACCIDENT`, Severity 4, 2 victims at $(26.2918, 73.0168)$.
   - Incident 202: `MEDICAL`, Severity 3, 1 victim at $(26.2800, 73.0200)$.
   - Resource Fleet: 1 ALS Ambulance, 1 BLS Ambulance, 1 Rescue Vehicle.
   - Hospital: AIIMS Jodhpur Proxy (Trauma, ICU, General Emergency).
   - **Result:** Exit code 0, status `"success"`, `batch_status: "SUCCESS"`.
   - Incident 201 triage score: 43.17 (`MEDIUM` tier), allocated ALS ambulance within 610.11 meters (ETA 62.75s), matched to AIIMS Jodhpur Proxy with route of 168 nodes (5,117.29m, simulated ETA 614.07s).
   - Engine internal execution time: 4.84 ms.
   - Total process bridge wall-clock time: 1,430 ms (including graph load and process spawn).

---

## 16. C++ Core Regression Test Suite Verification (14/14 Executables)

All 14 approved C++ test executables were executed from `cpp_engine/`:

| Executable | Module Tested | Result | Passed Checks |
|---|---|---|---|
| `test_graph_ingestion.exe` | Phase 3.2 Ingestion & Error Handling | **PASSED** | 8/8 suites passed |
| `test_graph_integrity.exe` | Phase 3.3 Graph Invariants & Memory Audit | **PASSED** | 59,334 nodes, 129,778 edges verified |
| `test_dijkstra.exe` | Phase 3.4 Shortest Path Dijkstra Routing | **PASSED** | 14/14 tests + 30 canonical pairs passed |
| `test_polyline.exe` | Phase 3.5 Polyline Encoding (Google Algorithm) | **PASSED** | 8/8 tests passed |
| `test_geojson.exe` | Phase 3.5 GeoJSON Geometry Serialization | **PASSED** | 10/10 tests passed |
| `test_route_geometry.exe` | Phase 3.5 Coordinate Extraction & Length Checks | **PASSED** | 30/30 pairs passed |
| `test_boundary_validator.exe`| Phase 3.6 Ray-Casting Point-in-Polygon | **PASSED** | 16/16 boundary tests passed |
| `test_spatial_grid.exe` | Phase 3.6 Spatial Indexing & Snapping | **PASSED** | 12/12 spatial tests passed |
| `test_priority_engine.exe` | Phase 3.8 Emergency Priority Scoring Engine | **PASSED** | 22/22 triage scoring tests passed |
| `test_resource_allocation.exe`| Phase 3.9 Resource Allocation Engine | **PASSED** | 17/17 allocation tests passed |
| `test_hospital_matching.exe` | Phase 3.10 Hospital Matching Engine | **PASSED** | 15/15 matching tests passed |
| `test_dispatch_orchestrator.exe`| Phase 3.11 Multi-Incident Dispatch Orchestrator | **PASSED** | 10/10 multi-incident suites passed |
| `test_json_protocol.exe` | Phase 3.12 stdin/stdout JSON Protocol Interface | **PASSED** | 6/6 protocol test suites passed |
| `test_stress_reliability.exe`| Phase 3.13 Reliability, Invariants & Stress | **PASSED** | 5/5 stress suites passed |

**Final Regression Result:** 14 / 14 executables passed (100%). Zero regressions detected.

---

## 17. Canonical Dataset SHA-256 Integrity Audit

The canonical datasets in `cpp_engine/data/` were audited via SHA-256 cryptographic hashing to confirm zero modification:

| Canonical Dataset File | Verified SHA-256 Hash | Integrity Status |
|---|---|---|
| `jodhpur_graph.json` | `057B9D2CB00AF9C16E8A19079587435DB09A581DA64613EBADB466C7509CA89A` | **MATCH (UNTOUCHED)** |
| `jodhpur_roads.geojson` | `C198080F4369786B980BD6D803DC30CC722DF6F72711C0BBBCB5F8A2C8BC756B` | **MATCH (UNTOUCHED)** |
| `jodhpur_boundary.geojson` | `83D704A1B918E5AF3342C949D3B16513AF273F7A5A923DCE98FC94AA6CF974E9` | **MATCH (UNTOUCHED)** |
| `road_network_metadata.json` | `DDD3A00CEBBB91A4469A2DE23ABC2AFDA424030BED14C6061C10BFF7ED39AB3A` | **MATCH (UNTOUCHED)** |

---

## 18. Performance & Latency Telemetry

| Operation | Component | Execution Latency | Evaluation |
|---|---|---|---|
| Engine Version Handshake | `engine.exe --version` | 35 – 51 ms | Near-instantaneous process negotiation |
| Batch Dispatch Spawn & Load | Subprocess + Graph Load (59k nodes) | ~1,100 ms | One-time dataset parsing per batch process |
| Pure Decision Optimization | Priority + Routing + Hospital | 4.84 ms | Sub-5ms algorithmic execution |
| Health Endpoint (`/api/health`) | Controller Execution | 25 – 47 ms | Low-latency status evaluation |
| Engine Health (`/api/health/engine`)| Diagnostic Inspection | 27 – 36 ms | Real-time dataset & process verification |
| Mongoose Schema Validation | In-Memory Object Model | 0.3 – 7.1 ms | Negligible schema overhead |

---

## 19. Security, Isolation & Resource Governance

1. **Process Isolation:** The C++ engine is executed in an isolated child process. An unhandled exception or memory fault in the C++ binary cannot crash or destabilize the Node.js event loop.
2. **Path Sanitization:** Command line arguments are passed as discrete elements in an array (`[enginePath, '--data-dir', dataDir]`), preventing shell injection vulnerabilities.
3. **Execution Guards:** Timeout caps (10s) and buffer caps (10MB) prevent CPU spinlocks and memory leaks from unbounded subprocess output.
4. **Environment Isolation:** Windows PATH enhancements are restricted to the spawned child environment and do not pollute the parent Node.js host environment.

---

## 20. Non-Goals & Phase 4.2 Transition Plan

The following items were explicitly excluded from Phase 4.1 scope per architectural boundaries and are scheduled for subsequent phases:

- **JWT Authentication & RBAC (Role-Based Access Control):** Slated for Phase 4.2.
- **Citizen Incident Submission REST Endpoints:** Slated for Phase 4.2.
- **Dispatcher Batch Trigger & Live Lifecycle Endpoints:** Slated for Phase 4.3.
- **WebSocket / Socket.IO Real-Time Dispatch Streaming:** Slated for Phase 4.4.
- **React Frontend Integration:** Slated for Phase 5.x.

Phase 4.1 establishes the solid, verified backend foundation that enables Phase 4.2 to proceed immediately.

---

## 21. Academic Simulation Disclaimer & Sign-Off

> [!IMPORTANT]
> **Academic Decision-Support Simulation Notice:**  
> The Emergency Resource Allocation & Response Management System is engineered strictly for academic research and educational decision-support modeling within the Jodhpur Urban Service Area (Rajasthan, India). It does not interface with, control, or replace authentic municipal emergency services (112, 108, 101).

**Phase 4.1 Verification Sign-Off:**  
- C++ Decision Engine Protocol: `v1.0` (Active and Verified)  
- Backend Architecture: Modular ESM, Express 4.x, Mongoose 9.x  
- Automated Unit & Integration Tests: 33 / 33 Passed (100%)  
- C++ Regression Executables: 14 / 14 Passed (100%)  
- Canonical Dataset Hashes: 100% Cryptographically Matched  
- Status: **PHASE 4.1 COMPLETE & FULLY VERIFIED**

