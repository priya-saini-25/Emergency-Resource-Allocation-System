# C++ Decision Engine — JSON stdin/stdout Protocol Specification (v1.0)

> **ACADEMIC SIMULATION PROXY NOTICE**  
> This specification defines the inter-process protocol between the Node.js/Express backend and the C++ Decision Engine for the **Emergency Resource Allocation & Response Management System** for the Jodhpur Urban Service Area (Rajasthan, India).  
> All transit speeds, priority formulas, clinical hospital capabilities, and service area boundaries are academic simulation models designed for emergency dispatch research, NOT operational municipal protocols or certified clinical triage standards.

---

## 1. Overview & Process Contract

The C++ Decision Engine (`engine.exe`) is invoked as a discrete child process or persistent service that accepts structured JSON requests on standard input (`stdin`), computes optimized triage scores, fleet allocations, and hospital recommendations, and emits strictly structured JSON responses on standard output (`stdout`).

### 1.1 Process Execution Model
```
+--------------------+        JSON Request (stdin)         +--------------------+
|                    | ----------------------------------> |                    |
|  Node.js / Express |                                     |  C++ Engine        |
|  Backend Process   | <---------------------------------- |  (engine.exe)      |
|                    |        JSON Response (stdout)       +--------------------+
+--------------------+                                               |
                               Diagnostic Traces / Telemetry         v
                               (std::cerr -> logs)             [stderr]
```

### 1.2 Channel Separation Guarantees
1. **Standard Output (`stdout`)**:
   - Reserved **exclusively** for machine-readable JSON responses.
   - Guaranteed to contain exactly one JSON root object per request.
   - Formatted with 2-space indentation (or compact JSON) suitable for direct stream parsing.
   - Zero diagnostic messages, banners, or informational lines are ever written to `stdout`.
2. **Standard Error (`stderr`)**:
   - All initialization logs, dataset loading benchmarks, graph node/edge counts, and diagnostic warnings are written strictly to `stderr`.
   - Logging prefixes: `[ENGINE_RUNNER]`, `[LOADER]`, `[CPP_INFO]`, `[ENGINE_ERROR]`.

### 1.3 Process Exit Codes
| Exit Code | Constant Name | Description | Response on `stdout` |
|:---:|:---|:---|:---|
| `0` | `SUCCESS` | Request successfully processed and optimal dispatch plan formulated. | Valid success JSON response object (`status: "success"`). |
| `1` | `PROTOCOL_OR_REQUEST_ERROR` | Malformed JSON syntax, invalid protocol version, unknown operation, or schema validation failure. | Valid error JSON envelope (`status: "error"`). |
| `2` | `INITIALIZATION_OR_DATA_ERR` | Dataset file not found (`jodhpur_graph.json` or `jodhpur_boundary.geojson`), corrupt GeoJSON, or engine initialization failure. | Valid error JSON envelope (`status: "error"`). |
| `3` | `EXECUTION_OR_INTERNAL_ERR` | Unhandled runtime exception or internal algorithmic fault. | Valid error JSON envelope (`status: "error"`). |

---

## 2. Command-Line Arguments

The C++ executable supports the following command-line flags:

```bash
engine.exe [OPTIONS] < request.json > response.json
```

| Flag | Long Flag | Description |
|:---|:---|:---|
| `-d <DIR>` | `--data-dir <DIR>` | Specify explicit directory containing `jodhpur_graph.json` and `jodhpur_boundary.geojson`. |
| `-v` | `--version` | Output engine protocol version, supported operations, and C++ compiler standard to `stdout` in JSON format and exit `0`. |
| `-h` | `--help` | Display command-line usage manual and exit `0`. |

If `--data-dir` is omitted, the engine automatically checks standard relative directories (`data/`, `../data/`, `cpp_engine/data/`).

---

## 3. Envelope Specifications

Every communication between the client and engine uses a standard top-level JSON envelope.

### 3.1 Request Envelope Schema
```json
{
  "protocol_version": "1.0",
  "request_id": "REQ-20261117-001",
  "operation": "dispatch_batch",
  "payload": { ... }
}
```

| Field | Type | Mandatory | Description |
|:---|:---|:---:|:---|
| `protocol_version` | `string` | **Yes** | Protocol contract version. Must equal `"1.0"`. |
| `request_id` | `string` | **Yes** | Unique client-generated correlation ID (e.g. UUIDv4). Returned unmodified in response. |
| `operation` | `string` | **Yes** | Operational task to execute. Currently supported: `"dispatch_batch"`. |
| `payload` | `object` | **Yes** | Operation-specific parameter payload. |

### 3.2 Success Response Envelope Schema
```json
{
  "status": "success",
  "success": true,
  "protocol_version": "1.0",
  "request_id": "REQ-20261117-001",
  "operation": "dispatch_batch",
  "data": { ... },
  "metadata": {
    "total_execution_time_ms": 12.4,
    "priority_scoring_time_ms": 0.05,
    "resource_orchestration_time_ms": 3.8,
    "hospital_orchestration_time_ms": 8.5,
    "total_pipeline_time_ms": 14.1
  },
  "telemetry": {
    "total_engine_time_ms": 14.1,
    "priority_scoring_time_ms": 0.05,
    "resource_orchestration_time_ms": 3.8,
    "hospital_orchestration_time_ms": 8.5
  },
  "error": null
}
```

### 3.3 Error Response Envelope Schema
```json
{
  "status": "error",
  "success": false,
  "protocol_version": "1.0",
  "request_id": "REQ-20261117-001",
  "operation": "dispatch_batch",
  "data": null,
  "metadata": {
    "processing_time_ms": 0.42
  },
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Payload validation failed with 1 error(s)",
    "details": [
      {
        "field": "payload.incidents[0].severity",
        "issue": "Severity must be between 1 and 5"
      }
    ]
  }
}
```

---

## 4. Operation: `dispatch_batch`

The `dispatch_batch` operation coordinates priority triage scoring (Phase 3.8), fleet allocation with conflict prevention (Phase 3.9), and hospital recommendation with capacity auditing (Phase 3.10) across a collection of emergency incidents.

### 4.1 Payload Parameters
```json
{
  "batch_id": 9001,
  "evaluated_at_ms": 1700000000000,
  "max_snap_distance_meters": 2000.0,
  "simulated_hospital_transit_speed_kmh": 30.0,
  "incidents": [ ... ],
  "resources": [ ... ],
  "hospitals": [ ... ]
}
```

| Field | Type | Required | Default | Description |
|:---|:---|:---:|:---:|:---|
| `batch_id` | `unsigned int` / `string` | No | `1` | Batch identifier. Numerical string IDs are parsed automatically. |
| `evaluated_at_ms` | `unsigned int (uint64)` | **Yes** | - | Deterministic evaluation timestamp (Unix epoch in ms). Alias: `evaluation_timestamp_ms`. |
| `max_snap_distance_meters` | `double` | No | `2000.0` | Maximum allowable distance from coordinate to nearest road graph node. |
| `simulated_hospital_transit_speed_kmh` | `double` | No | `30.0` | Constant simulated speed for hospital transit ETA calculations. |
| `incidents` | `array<object>` | **Yes** | - | Array of incidents to triage and dispatch (must not be empty). |
| `resources` | `array<object>` | No | `[]` | Snapshot of available emergency fleet vehicles. |
| `hospitals` | `array<object>` | No | `[]` | Snapshot of emergency hospital facilities and current bed occupancies. |

### 4.2 Incident Schema
```json
{
  "incident_id": 1001,
  "category": "MEDICAL",
  "severity": 4,
  "victim_count": 2,
  "created_at_ms": 1699999900000,
  "latitude": 26.265,
  "longitude": 73.015,
  "incident_node_osm_id": 0,
  "resource_demands": [
    { "type": "ALS_AMBULANCE", "quantity": 1 }
  ]
}
```
- `category`: `"MEDICAL"`, `"FIRE"`, `"ROAD_ACCIDENT"`, `"INDUSTRIAL"` (or integers `0`..`3`).
- `severity`: Integer `1` (Minor) to `5` (Catastrophic).
- `victim_count`: Unsigned integer `>= 0` (optional, defaults to `0`).
- `created_at_ms`: Unix epoch ms when call was logged.
- Location: Provide either `(latitude, longitude)` OR `incident_node_osm_id > 0`.
- `resource_demands`: Optional custom demands. If omitted, default requirements based on category and severity are generated automatically.

### 4.3 Resource Schema
```json
{
  "resource_id": 501,
  "resource_type": "ALS_AMBULANCE",
  "status": "AVAILABLE",
  "latitude": 26.268,
  "longitude": 73.010,
  "current_node_osm_id": 0
}
```
- `resource_type`: `"ALS_AMBULANCE"`, `"BLS_AMBULANCE"`, `"FIRE_ENGINE"`, `"FIRE_TENDER"`, `"RESCUE_VEHICLE"`, `"POLICE_INTERCEPTOR"`.
- `status`: `"AVAILABLE"`, `"DISPATCHED"`, `"MAINTENANCE"`, `"OFF_DUTY"`. Only `"AVAILABLE"` vehicles can be allocated.
- Location: Provide either `(latitude, longitude)` OR `current_node_osm_id > 0`.

### 4.4 Hospital Schema
```json
{
  "hospital_id": 701,
  "name": "MDM Hospital Jodhpur",
  "status": "OPERATIONAL",
  "latitude": 26.273,
  "longitude": 73.012,
  "available_general_beds": 20,
  "available_icu_beds": 8,
  "available_oxygen_beds": 10,
  "capabilities": ["GENERAL_EMERGENCY", "TRAUMA_CENTER", "CARDIAC_CARE", "BURN_UNIT"]
}
```
- `name`: Hospital facility name (alias: `hospital_name`).
- `status`: `"OPERATIONAL"` (or `"NORMAL"`, `"AVAILABLE"`), `"TEMPORARILY_UNAVAILABLE"`, `"CLOSED"`.
- Capacities: Supports `available_general_beds`, `available_icu_beds`, `available_oxygen_beds` (or `general_beds_available`, etc.).
- Capabilities: Array containing any of `"GENERAL_EMERGENCY"`, `"TRAUMA"`, `"TRAUMA_CENTER"`, `"ICU"`, `"OXYGEN_SUPPORT"`, `"BURN_TREATMENT"`, `"BURN_UNIT"`, `"SURGICAL_SUPPORT"`, `"CARDIAC_CARE"`.

---

## 5. Floating-Point NaN and Infinity Serialization Policy

Per the JSON standard (RFC 8259, Section 6), `NaN` and `Infinity` are invalid JSON tokens. In standard C++ serialization, emitting `NaN` produces non-standard literal strings that break Node.js `JSON.parse()`.

**The C++ Engine implements an explicit `SafeNumber()` sanitizer:**
- Non-finite numbers (`std::isnan` or `std::isinf`) serialize strictly as JSON `null`.
- Unreachable paths, missing metrics, or unbounded durations are represented cleanly as `null`.
- Finite numbers serialize with full double-precision floating-point fidelity.

---

## 6. Standardized Error Codes

When `status` is `"error"`, `error.code` contains one of the following machine-readable identifiers:

| Error Code | Description |
|:---|:---|
| `EMPTY_INPUT` | Empty string or whitespace-only input received on `stdin`. |
| `INVALID_JSON` | Malformed JSON syntax rejected by the parser. |
| `INVALID_PROTOCOL_VERSION` | Envelope `protocol_version` does not match `"1.0"`. |
| `INVALID_REQUEST` | Missing required envelope fields or schema validation violations. |
| `UNKNOWN_OPERATION` | Unsupported `operation` requested. |
| `INVALID_INCIDENT` | Malformed incident attributes (invalid category, severity out of bounds, etc.). |
| `INVALID_RESOURCE` | Malformed resource attributes (invalid type, status, or duplicate ID). |
| `INVALID_HOSPITAL` | Malformed hospital attributes (invalid status, negative beds, or duplicate ID). |
| `DATASET_LOAD_ERROR` | Road network graph or boundary GeoJSON file missing or corrupt. |
| `ENGINE_INITIALIZATION_ERROR`| Spatial grid or graph indexing could not be built. |
| `ENGINE_EXECUTION_ERROR` | Internal exception thrown during algorithmic execution. |
| `INTERNAL_ERROR` | Generic fallback internal fault. |

---

## 7. Node.js Integration Example (`child_process.spawn`)

The following production-grade Node.js service demonstrates spawning the C++ Decision Engine, streaming request JSON to `stdin`, buffering `stdout`, isolating `stderr`, and handling process exit codes:

```typescript
import { spawn } from 'child_process';
import path from 'path';

interface DispatchBatchRequest {
  protocol_version: string;
  request_id: string;
  operation: string;
  payload: Record<string, unknown>;
}

interface DispatchBatchResponse {
  status: 'success' | 'error';
  success: boolean;
  protocol_version: string;
  request_id: string;
  operation: string;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details: Array<{ field: string; issue: string }>;
  };
  metadata?: Record<string, number>;
  telemetry?: Record<string, number>;
}

export class CppDecisionEngineService {
  private executablePath: string;
  private dataDir: string;

  constructor(executablePath?: string, dataDir?: string) {
    this.executablePath = executablePath || path.resolve(__dirname, '../../cpp_engine/bin/engine.exe');
    this.dataDir = dataDir || path.resolve(__dirname, '../../cpp_engine/data');
  }

  public async executeBatchDispatch(request: DispatchBatchRequest): Promise<DispatchBatchResponse> {
    return new Promise((resolve, reject) => {
      const args = ['--data-dir', this.dataDir];
      const child = spawn(this.executablePath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdoutData = '';
      let stderrData = '';

      child.stdout.setEncoding('utf-8');
      child.stdout.on('data', (chunk) => {
        stdoutData += chunk;
      });

      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (chunk) => {
        stderrData += chunk;
        // Optionally forward engine logs to application logger
        // console.error(`[CPP_ENGINE_STDERR] ${chunk}`);
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn C++ decision engine: ${err.message}`));
      });

      child.on('close', (exitCode) => {
        if (!stdoutData.trim()) {
          return reject(new Error(`C++ Engine exited with code ${exitCode} without emitting stdout JSON. Stderr: ${stderrData}`));
        }

        try {
          const parsedResponse = JSON.parse(stdoutData) as DispatchBatchResponse;
          if (exitCode === 0) {
            resolve(parsedResponse);
          } else {
            // Structured error envelope returned by engine
            resolve(parsedResponse);
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse C++ Engine stdout JSON (Exit code ${exitCode}): ${(parseError as Error).message}. Raw: ${stdoutData}`));
        }
      });

      // Write JSON payload to stdin and close write stream
      const requestJson = JSON.stringify(request);
      child.stdin.write(requestJson, 'utf-8', () => {
        child.stdin.end();
      });
    });
  }
}
```

