# C++ Decision Engine Bridge & JSON Protocol Integration
**Jodhpur Urban Service Area Simulation Proxy**  
**Document Version:** 1.0.0 (Phase 4.1 Specification)  
**Protocol Version:** 1.0  
**Interface:** stdin / stdout JSON Stream

---

## 1. Protocol Architecture & Channel Separation

The C++ Decision Engine (`engine.exe`) exposes a machine-readable JSON protocol over standard input/output streams. To guarantee reliable programmatic parsing by the Node.js backend, the engine enforces strict stream separation:

- **Standard Input (`stdin`)**: Ingests JSON request envelopes containing batch incidents, resource fleets, and hospital inventories.
- **Standard Output (`stdout`)**: Exclusively reserved for single, well-formed JSON response envelopes. No diagnostic text or debug traces are ever emitted to `stdout`.
- **Standard Error (`stderr`)**: Reserved for system initialization telemetry, memory audits, and diagnostic logs.

```
       +---------------------------------------------+
       |             Node.js Backend                 |
       |      (services/cppEngineService.js)         |
       +---------------------------------------------+
             |                                 ^
             | JSON Payload                    | JSON Result
             | (stdin)                         | (stdout)
             v                                 |
       +---------------------------------------------+
       |              C++ Decision Engine            |
       |                 (engine.exe)                |
       |  - Priority Scoring (Phase 3.8)             |
       |  - Resource Allocation (Phase 3.9)          |
       |  - Hospital Matching (Phase 3.10)           |
       |  - Dispatch Orchestration (Phase 3.11)      |
       +---------------------------------------------+
             |
             | Telemetry & Audit Logs
             v
       (stderr: discarded or captured for tracing)
```

---

## 2. Protocol Envelope Specification (Version 1.0)

### 2.1 Request Envelope Format
All requests delivered to `stdin` must conform to the **Protocol Envelope v1.0**:

```json
{
  "protocol_version": "1.0",
  "request_id": "c1f7b822-7ad2-43bb-a579-679cefd184c7",
  "operation": "dispatch_batch",
  "payload": {
    "evaluated_at_ms": 1700000000000,
    "incidents": [
      {
        "incident_id": 101,
        "category": "MEDICAL",
        "severity": 4,
        "victim_count": 2,
        "created_at_ms": 1699999950000,
        "latitude": 26.2918,
        "longitude": 73.0168
      }
    ],
    "resources": [
      {
        "resource_id": 501,
        "resource_type": "ALS_AMBULANCE",
        "status": "AVAILABLE",
        "capacity": 1,
        "latitude": 26.2950,
        "longitude": 73.0200
      }
    ],
    "hospitals": [
      {
        "hospital_id": 901,
        "hospital_name": "AIIMS Jodhpur Proxy",
        "status": "OPERATIONAL",
        "capabilities": ["TRAUMA", "ICU", "GENERAL_EMERGENCY"],
        "icu_beds_total": 20,
        "icu_beds_available": 8,
        "general_beds_total": 100,
        "general_beds_available": 45,
        "oxygen_beds_total": 30,
        "oxygen_beds_available": 15,
        "latitude": 26.2550,
        "longitude": 73.0050
      }
    ]
  }
}
```

### 2.2 Response Envelope Format
The C++ engine serializes optimization plans in the following schema:

```json
{
  "protocol_version": "1.0",
  "request_id": "c1f7b822-7ad2-43bb-a579-679cefd184c7",
  "operation": "dispatch_batch",
  "status": "success",
  "success": true,
  "data": {
    "batch_id": 1,
    "batch_status": "SUCCESS",
    "batch_status_message": "All incidents successfully processed and optimized.",
    "summary": {
      "total_incidents_received": 1,
      "valid_incidents": 1,
      "invalid_incidents": 0,
      "fully_allocated_incidents": 1,
      "partially_allocated_incidents": 0,
      "unallocated_incidents": 0,
      "total_unique_resources_recommended": 1,
      "total_hospital_recommendations": 1,
      "resource_conflicts_prevented": 0,
      "hospital_capacity_conflicts_prevented": 0
    },
    "incident_results": [
      {
        "incident_id": 101,
        "processing_order": 1,
        "dispatch_status": "FULLY_DISPATCHED",
        "priority": {
          "total_priority_score": 43.17,
          "tier": "MEDIUM",
          "severity": 4,
          "victim_count": 2,
          "waiting_duration_ms": 50000
        },
        "resource_allocation": {
          "status": "FULLY_ALLOCATED",
          "total_allocated_resources": 1,
          "total_requested_resources": 1,
          "allocated_resources": [
            {
              "resource_id": 501,
              "resource_type": "ALS_AMBULANCE",
              "road_distance_meters": 610.11,
              "estimated_eta_seconds": 62.75,
              "snapped_node_osm_id": 12953145631
            }
          ]
        },
        "hospital_matching": {
          "status": "SUITABLE_HOSPITALS_FOUND",
          "recommended_hospital_id": 901,
          "recommended_hospital_name": "AIIMS Jodhpur Proxy",
          "route_to_hospital": {
            "distance_meters": 5117.29,
            "simulated_eta_seconds": 614.07,
            "node_count": 168
          }
        }
      }
    ]
  },
  "metadata": {
    "total_execution_time_ms": 4.84,
    "priority_scoring_time_ms": 0.01,
    "resource_orchestration_time_ms": 4.82,
    "hospital_orchestration_time_ms": 0.01
  },
  "telemetry": {
    "total_engine_time_ms": 1107.47,
    "process_bridge_wall_clock_ms": 1426
  }
}
```

---

## 3. Node.js Process Bridge Implementation (`cppEngineService.js`)

### 3.1 Invocation Pattern
The service invokes the engine binary directly through `child_process.spawn`:

```javascript
import { spawn } from 'child_process';
import { env } from '../config/env.js';

const child = spawn(env.CPP_ENGINE_PATH, ['--data-dir', env.CPP_DATA_DIR], {
  env: buildSpawnEnvironment(),
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
});

child.stdin.write(JSON.stringify(requestEnvelope), 'utf8');
child.stdin.end();
```

### 3.2 UCRT64 / MSYS2 Runtime DLL Path Resolution
On Windows development and deployment environments compiled with MSYS2 GCC UCRT64, native executables link dynamically to runtime components (`libstdc++-6.dll`, `libgcc_s_seh-1.dll`, `libwinpthread-1.dll`).

To prevent runtime failures (`STATUS_DLL_NOT_FOUND` / Exit Code 1) without polluting the Windows system PATH, `buildSpawnEnvironment()` prepends the configured `CPP_EXTRA_PATH` (`C:\msys64\ucrt64\bin`) to the subprocess environment:

```javascript
function buildSpawnEnvironment() {
  const currentPath = process.env.PATH || '';
  if (process.platform === 'win32' && env.CPP_EXTRA_PATH) {
    return {
      ...process.env,
      PATH: `${env.CPP_EXTRA_PATH};${currentPath}`
    };
  }
  return { ...process.env };
}
```

---

## 4. Standard Exit Codes & Error Mapping

The C++ Decision Engine emits standardized exit codes. The Node.js bridge maps each exit code to an explicit exception class and HTTP status code:

| Exit Code | Engine Meaning | Node.js Exception | HTTP Status | Action Taken |
|---|---|---|---|---|
| **`0`** | **Success** | None | `200 OK` | Parse JSON stdout; return optimization data |
| **`1`** | **Protocol / Validation Error** | `EngineValidationError` | `400 Bad Request` | Capture validation errors; inform client of malformed request |
| **`2`** | **Dataset / Initialization Error** | `EngineDatasetError` | `503 Service Unavailable` | Log missing canonical graph or boundary file |
| **`3`** | **Internal Engine Failure** | `EngineExecutionError` | `500 Internal Error` | Log core dump or algorithmic assertion failure |
| **Signal / Crash** | **Abnormal Termination** | `EngineError` | `500 Internal Error` | Terminate process; record signal |

---

## 5. Security & Reliability Controls

### 5.1 Timeout Protection
Subprocess execution is constrained by `CPP_TIMEOUT_MS` (default: 10,000 ms). If the subprocess hangs or enters an infinite loop, the timeout handler issues `SIGTERM`, followed by a non-catchable `SIGKILL` after 500 ms. The promise rejects with an `EngineTimeoutError` (HTTP 504).

### 5.2 Stream Buffer Limits
To prevent out-of-memory denial of service from unbounded subprocess output, both `stdout` and `stderr` streams are monitored byte-by-byte against `CPP_MAX_BUFFER_BYTES` (default: 10 MB). Exceeding this cap instantly kills the child process with `SIGKILL` and raises `EngineBufferOverflowError`.

### 5.3 Diagnostic Version Handshake (`checkEngineHealth()`)
During startup and periodic readiness probes, the backend invokes `engine.exe --version`:
```bash
engine.exe --version
```
Output:
```json
{
  "engine": "Jodhpur Emergency Dispatch Engine",
  "protocol_version": "1.0",
  "supported_operations": ["dispatch_batch"],
  "cpp_standard": 201703
}
```
This guarantees that the binary is present, executable, and compatible with Protocol v1.0 before processing live emergency dispatch requests.

---

## 6. Academic Simulation Notice

> [!NOTE]
> All routing calculations, response ETAs, and geographic coordinate systems are based on the canonical OpenStreetMap snapshot for the Jodhpur Urban Service Area (Rajasthan, India). This bridge operates strictly as an academic decision-support proxy for emergency resource allocation simulation.

