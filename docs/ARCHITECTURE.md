# System Architecture Documentation
## Emergency Resource Allocation & Response Management System (Jodhpur City)

---

### 1. Architectural Overview & Multi-Tier Model
The system is architected as an academic decision-support prototype tailored specifically to **Jodhpur, Rajasthan, India**. It decouples presentation, business orchestration, and algorithmic computation into dedicated layers:

```
┌────────────────────────────────────────────────────────┐
│               1. React 18 + Vite (Client)              │
│       - Citizen Portal & Control Room Dashboard        │
│       - React Leaflet Jodhpur Map Overlays             │
│       - Slate × Ice Blue Design System                 │
└───────────────────────────▲────────────────────────────┘
                            │ REST APIs / JSON
┌───────────────────────────▼────────────────────────────┐
│              2. Node.js + Express (Backend)            │
│       - Authentication & Role-Based Access             │
│       - Point-in-Polygon Boundary Verification         │
│       - Subprocess IPC Bridge (stdin/stdout)           │
└─────────────▲────────────────────────────▲─────────────┘
              │ Mongoose                   │ JSON IPC
┌─────────────▼──────────┐   ┌─────────────▼─────────────┐
│  3. MongoDB Database   │   │  4. C++17 Algorithmic Core │
│  - Incident Lifecycle  │   │  - OSM Jodhpur Road Graph │
│  - Fleet Telemetry     │   │  - Dijkstra Shortest Path │
│  - Hospital Capacities │   │  - Priority Queue Triage  │
└────────────────────────┘   └───────────────────────────┘
```

---

### 2. Node.js to C++ Engine Communication Protocol

#### Process Model & Standard Streams
- **Decoupled Execution**: The C++ algorithmic core is compiled into a standalone native binary (`engine.exe` on Windows).
- **Communication Channel**: Node.js spawns the executable as an asynchronous child process using standard streams (`stdin` and `stdout`).
- **Strict Data Contract**:
  - **`stdout` (STRICTLY JSON ONLY)**: All outputs emitted to `stdout` MUST be valid, parseable JSON documents containing computation results (e.g., shortest path node arrays, ETAs, triage priority scores, vehicle assignments). No debugging messages or raw strings are allowed on `stdout`.
  - **`stderr` (DIAGNOSTIC LOGGING ONLY)**: All operational logs, algorithm tracing, execution times, and warning diagnostics MUST be directed to `std::cerr` / `stderr`. This ensures that Node.js stream parsers never encounter contaminated JSON.
- **Process Failure & Timeout Isolation**:
  - The Node.js IPC bridge enforces an explicit timeout (e.g., `5000ms`). If the C++ process deadlocks, exceeds memory limits, or fails to terminate, Node.js forcibly terminates the child process (`SIGKILL`), logs the `stderr` trace, and returns a graceful HTTP 500/504 fallback to the frontend without crashing the API server.

---

### 3. Record of Six Mandatory Architectural Corrections

#### Correction 1: Authentic Jodhpur Geographic Boundary Validation
- **Rule**: Do not use a simple rectangular bounding box as the final city boundary.
- **Specification**: In subsequent phases, the system will ingest an authentic Jodhpur municipal polygon represented as a GeoJSON FeatureCollection. The Node.js backend performs point-in-polygon ray-casting / geometric validation to verify that every reported emergency and base station falls inside the official municipal perimeter. The frontend will render this boundary and display an out-of-area warning for pins placed outside the service zone.

#### Correction 2: Authentic Road Network Representation
- **Rule**: Do not use straight-line Euclidean distance or small manually fabricated landmark graphs to claim actual shortest-path routing.
- **Specification**: The routing module will utilize an authentic road network extracted from OpenStreetMap (OSM) for Jodhpur. The network will be modeled in C++ as an adjacency list of graph vertices (intersections) and directed weighted edges (road segments). Dijkstra's algorithm will initially minimize distance in kilometers, with road speed limits and surface types incorporated later for realistic ETAs.

#### Correction 3: Explicit Emergency Priority Scoring Model
- **Rule**: The emergency priority system must follow an explicit, mathematically defined, configurable formula.
- **Specification**: Triage scores are determined dynamically using the demonstration formula:
  $$\text{Triage Priority Score} = 0.50 \times S_{\text{severity}} + 0.30 \times V_{\text{victims}} + 0.20 \times W_{\text{wait\_time}}$$
  where:
  - $S_{\text{severity}}$: Normalized severity weight (`CRITICAL` = 100, `HIGH` = 70, `MEDIUM` = 40, `LOW` = 10).
  - $V_{\text{victims}}$: Normalized victim factor ($\min(v / 10, 1.0) \times 100$).
  - $W_{\text{wait\_time}}$: Wait time penalty factor accounting for incident aging in queue.
  - *Disclaimer*: These are demonstration weights for computer science simulation, not medically validated clinical triage criteria.

#### Correction 4: Compatible Resource Allocation
- **Rule**: Resource allocation must evaluate incident category, vehicle compatibility, real-time availability, and prevent double allocation.
- **Specification**:
  - Emergency categories map to required equipment (e.g., severe road trauma requires Advanced Life Support ambulances; structural fires require Fire Tenders and Rescue Vans).
  - The backend guarantees atomic reservation when the operator confirms dispatch, instantly locking resource status to `DISPATCHED` to prevent race conditions or duplicate deployments.

#### Correction 5: Capacity-Aware Hospital Recommendation
- **Rule**: Hospital recommendations must evaluate route distance, trauma-care facilities, ICU availability, and general emergency capacity.
- **Specification**:
  - The C++ engine scores candidate hospitals by weighing shortest path road distance against available ICU and emergency beds.
  - *Disclaimer*: All hospital beds and oxygen availability numbers are explicitly flagged as simulated demo data (`isDemoData: true`).

#### Correction 6: Standardized Incident Lifecycle State Machine
- **Rule**: Consistent status transitions across Frontend, Backend, Database, and C++ engine.
- **Allowed Primary Statuses**:
  1. `REPORTED` — Submitted by citizen; awaiting control-room review.
  2. `VERIFIED` — Confirmed valid by dispatcher.
  3. `ALLOCATED` — C++ engine has computed candidate resources & route.
  4. `DISPATCHED` — Dispatch confirmed; units mobilized.
  5. `ON_SCENE` — First responders arrived at incident location.
  6. `RESOLVED` — Emergency mitigated, patients transferred to hospital.
- **Additional Statuses**:
  - `CANCELLED` — Citizen withdrew request or reported by mistake.
  - `REJECTED` — Operator flagged incident as invalid, hoax, or out-of-boundary.
