# Backend Dispatch Architecture & C++ Engine Integration

> **ACADEMIC SIMULATION PROXY DISCLAIMER**  
> This software is an academic engineering simulation designed to study multi-criteria decision analysis, graph algorithms, and distributed systems architecture for urban emergency response in Jodhpur, Rajasthan, India. It is not approved or certified for real-world municipal dispatch.

---

## 1. System Overview & End-to-End Data Flow

The dispatch decision subsystem bridges the asynchronous, web-facing Node.js/Express application with the deterministic, high-performance C++17 routing and allocation engine (`engine.exe`). 

The pipeline ensures that municipal emergency dispatch operations are driven by validated data snapshots and mathematical algorithms without sacrificing web security, process isolation, or state consistency.

### End-to-End Data Flow Architecture

```
[ Control Room Operator ]
         │
         │ POST /api/dispatch/recommendations { incidentIds: [1001, 1002] }
         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Node.js / Express Web Layer                       │
│  1. Authenticate JWT token & verify live User role from MongoDB.       │
│  2. Validate request parameters, bounds, and unauthorized injections.  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Dispatch Recommendation Service                      │
│                   (dispatchRecommendationService.js)                   │
│                                                                        │
│  3. Authoritative Snapshot Ingestion:                                  │
│     - Incident.find({ incidentId: { $in: [...] }, status: 'VERIFIED' })│
│     - Resource.find({ status: 'AVAILABLE' })                           │
│     - Hospital.find({ status: 'OPERATIONAL' })                         │
│  4. Convert documents to JSON Protocol v1.0 envelope.                  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   │ JSON stdin via child_process.spawn
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     C++ Decision Engine (engine.exe)                   │
│                                                                        │
│  5. Protocol Parser & Spatial Coordinate Snapping (SpatialGrid)        │
│  6. Priority Scoring Engine (Phase 3.8: Normalized MCDA)               │
│  7. Priority-First Fleet Greedy Allocator (Phase 3.9: Dijkstra Routing)│
│  8. Hospital Matching & Capacity Engine (Phase 3.10: Multi-Target)     │
│  9. JSON Protocol Serializer (NaN/Inf sanitized to null)               │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   │ JSON stdout
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Dispatch Recommendation Service                      │
│                                                                        │
│ 10. Engine Response Validation (request_id correlation, completeness,  │
│     mutual vehicle exclusivity, hospital ID validity, finite numbers). │
│ 11. Persist immutable DispatchRecord snapshot in MongoDB.              │
│ 12. Return 201 Created with sanitized recommendation payload.          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Protocol v1.0 Request Mapping

The C++ Decision Engine accepts a strictly formatted JSON envelope on `stdin` conforming to Protocol v1.0:

### Request Envelope:
```json
{
  "protocol_version": "1.0",
  "request_id": "<UUIDv4>",
  "operation": "dispatch_batch",
  "payload": {
    "batch_id": 1042,
    "evaluated_at_ms": 1700000000000,
    "max_snap_distance_meters": 2000.0,
    "simulated_hospital_transit_speed_kmh": 30.0,
    "incidents": [ ... ],
    "resources": [ ... ],
    "hospitals": [ ... ]
  }
}
```

### Entity Transformation Mapping:

| MongoDB Model Field | Protocol v1.0 Field | Description / Constraints |
|---|---|---|
| `Incident.incidentId` | `incident_id` | Positive unsigned integer. |
| `Incident.category` | `category` | String enum (`FIRE`, `MEDICAL`, `ROAD_ACCIDENT`, `INDUSTRIAL`). |
| `Incident.severity` | `severity` | Integer 1 to 5. |
| `Incident.victimCount` | `victim_count` | Unsigned integer $\ge 0$. |
| `Incident.latitude`, `longitude` | `latitude`, `longitude` | WGS-84 decimal degrees inside Jodhpur boundary. |
| `Incident.reportedAt` | `created_at_ms` | Unix epoch timestamp in milliseconds. |
| `Resource.resourceId` | `resource_id` | Positive unsigned integer. |
| `Resource.resourceType` | `resource_type` | `ALS_AMBULANCE`, `BLS_AMBULANCE`, `FIRE_ENGINE`, `FIRE_TENDER`, `RESCUE_VEHICLE`. |
| `Resource.status` | `status` | Must be `'AVAILABLE'`. |
| `Resource.latitude`, `longitude` | `latitude`, `longitude` | Vehicle station or current stationary coordinates. |
| `Hospital.hospitalId` | `hospital_id` | Positive unsigned integer. |
| `Hospital.name` | `hospital_name` | Facility string name. |
| `Hospital.status` | `status` | Must be `'OPERATIONAL'`. |
| `Hospital.capabilities` | `capabilities` | Array of capability strings (`ICU`, `TRAUMA`, etc.). |
| `Hospital.generalBeds.available` | `available_general_beds` | Non-negative integer. |
| `Hospital.icuBeds.available` | `available_icu_beds` | Non-negative integer. |
| `Hospital.oxygenBeds.available` | `available_oxygen_beds` | Non-negative integer. |

---

## 3. Database Snapshot Consistency & Isolation

To prevent race conditions and conflicting state updates across concurrent operators:

1. **Snapshot Read**:
   - Resources and hospitals are read immediately prior to C++ engine execution using MongoDB queries (`Resource.find({ status: 'AVAILABLE' })`, `Hospital.find({ status: 'OPERATIONAL' })`).
   - The entire set of candidate resources and hospitals passed to the engine reflects a single point-in-time snapshot.
2. **Read-Only Engine Invocations**:
   - The recommendation pipeline **does not mutate** any MongoDB entities during evaluation.
   - Incidents remain in status `VERIFIED`.
   - Fleet vehicles remain in status `AVAILABLE`.
   - Hospital bed counts remain unmodified.
3. **Immutable Recommendation Records**:
   - Every generated recommendation is written as a new document in `DispatchRecord` with a unique `batchId` (e.g. `BATCH-<timestamp>-<hash>`).
   - Once written, the record represents a permanent audit log of the algorithmic advice provided to the dispatcher.

---

## 4. Engine Response Validation & Defenses

Node.js does not treat the C++ engine output as trusted data simply because the process exited with code `0`. A rigorous defensive validation suite executes prior to persistence:

1. **Envelope Verification**:
   - Confirms `status === 'success'` and `protocol_version === '1.0'`.
   - Verifies `request_id` matches the correlation UUID sent in the request envelope.
   - Verifies `operation === 'dispatch_batch'`.
2. **Completeness & Identity Verification**:
   - Asserts that every requested incident ID has exactly one matching result entry in `incident_results`.
   - Rejects duplicate incident results from the engine.
3. **Mutual Exclusivity Enforcement**:
   - Tracks all vehicle IDs recommended across the batch.
   - Asserts that **no vehicle is assigned to more than one incident** within the same batch. If a duplicate vehicle assignment is detected, the response is rejected with HTTP 502 Bad Gateway (`UPSTREAM_ENGINE_INVALID_RESPONSE`).
4. **Referential Integrity**:
   - Asserts that every recommended resource ID and hospital ID existed in the input snapshot.
5. **Finite Metric Validation**:
   - Asserts that distances, ETAs, and priority scores are finite, non-negative numbers (or `null` for unreachable targets). Non-finite or negative values trigger an immediate error.

---

## 5. Performance Characteristics: Cold Start vs. Algorithmic Latency

A critical distinction must be drawn between full child-process wall-clock time and internal C++ algorithmic execution latency:

1. **Child Process Cold Start (OS & File I/O)**:
   - On each discrete invocation, `engine.exe` initializes the C++ runtime, parses the 42,000+ node Jodhpur road graph JSON from disk, parses the GeoJSON service perimeter, and builds the spatial grid index.
   - This cold-start initialization requires approximately **2.2 to 2.5 seconds** on Windows.
2. **Internal Algorithmic Execution**:
   - Once initialized, the actual computation (SpatialGrid snapping, PriorityEngine MCDA scoring, Dijkstra shortest paths, and hospital multi-target evaluation) completes in **10 to 30 milliseconds** for typical batch sizes (1 to 25 incidents).
3. **Validation & Persistence Latency**:
   - Response validation in Node.js requires **0.05 to 0.15 milliseconds**.
   - MongoDB indexed snapshot insert requires **~0.5 to 2.0 milliseconds**.

---

## 6. Academic Simulation Limitations

1. **Greedy Priority-First Allocation**:
   - The orchestrator processes incidents strictly in descending priority order. An incident evaluated earlier in the batch receives first claim on proximate vehicles.
   - It is a fast, deterministic greedy heuristic, not a mathematically globally optimal assignment solver (such as the Hungarian algorithm or Mixed-Integer Linear Programming).
2. **Simulated Transit Speeds**:
   - Response ETAs are computed using constant simulated road speeds based on OSM highway tags (primary roads: 40 km/h, secondary: 30 km/h, residential: 20 km/h) and a constant simulated hospital transit speed (30 km/h).
   - Real-world traffic congestion, construction delays, and weather events are not modeled in this phase.
3. **Graph Topology Constraints**:
   - The road network graph models one-way driving directions based on OSM tags, but complex multi-lane turn restrictions and temporary road closures are not modeled.
4. **Simulated Hospital Capacities**:
   - Hospital bed occupancies reflect values in the MongoDB collection; real-time integration with Rajasthan state health hospital management systems (HMS) is outside the scope of this academic project.

