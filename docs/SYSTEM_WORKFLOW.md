# System Workflow & Lifecycle Documentation
## Emergency Resource Allocation & Response Management System

---

### 1. End-to-End Operational Lifecycle

The lifecycle follows an operator-in-the-loop decision support workflow:

```
[Citizen Portal]
       │
       ▼ (1) Reports Incident: Category, Severity, Victims, GPS / Map Pin
[Backend API]
       │
       ▼ (2) Point-in-Polygon Validation & Persists as REPORTED
[Control Room Feed]
       │
       ▼ (3) Operator verifies incident -> status updated to VERIFIED
[Dispatch Recommendation Request]
       │
       ▼ (4) Node.js spawns C++ Engine with Incident, Available Fleet & Hospitals JSON
[C++ Engine Execution]
       │ ├── Multi-Criteria Priority Queue scores urgency
       │ ├── Dijkstra's Algorithm traverses Jodhpur OSM Road Graph
       │ └── Selects nearest compatible fleet units + optimal hospital
       ▼ (5) Emits structured recommendation JSON on stdout
[Operator Review & Confirmation]
       │
       ▼ (6) Operator confirms or overrides proposal -> status updated to ALLOCATED -> DISPATCHED
[Atomic State Lock]
       │
       ├── Resource status locked to DISPATCHED (prevents double allocation)
       └── Citizen tracker receives route polyline, vehicle callsign, and ETA
[Resolution Phase]
       │
       ▼ (7) Units arrive -> ON_SCENE -> emergency resolved -> RESOLVED
```

---

### 2. Detailed Lifecycle Stages

| Stage | Triggering Actor | System Action & State Transition | Output & User Visibility |
| :--- | :--- | :--- | :--- |
| **1. Reporting** | Citizen | Submits form with category, severity, victim count, and coordinates. Backend checks Jodhpur boundary polygon. If valid, persists with state `REPORTED`. | Citizen receives unique Incident Code (e.g. `JDH-2026-0042`) and tracking link. |
| **2. Verification** | Control Room Operator | Operator reviews incident description and photos/details. Updates status to `VERIFIED` or `REJECTED`. | Filtered out of queue if invalid; prioritized in incident feed if verified. |
| **3. Recommendation Calculation** | System / C++ Engine | Operator clicks "Generate Recommendation". Node gathers live telemetry and passes JSON to C++ subprocess via `stdin`. C++ runs Dijkstra and Priority Queue triage. | Structured proposal returned: optimal vehicle, ETA, waypoint node sequence, and hospital. |
| **4. Dispatch Confirmation** | Control Room Operator | Operator approves recommendation. Status transitions to `ALLOCATED` then `DISPATCHED`. | Selected resource status atomically updated to `DISPATCHED` in MongoDB. |
| **5. On-Scene Operation** | First Responders / Dispatcher | Responders reach coordinates; dispatcher marks incident `ON_SCENE`. | Live tracking indicates responders are actively providing aid. |
| **6. Resolution & Closure** | First Responders / Dispatcher | Incident mitigated; patients transferred to hospital. Status transitions to `RESOLVED`. | Resource freed to `AVAILABLE`; incident archived with historical response audit metrics. |

---

### 3. Exception Handling & Alternate Flows
- **Out-of-Area Report**: Citizen pin falls outside the Jodhpur boundary polygon. The backend rejects the submission with HTTP 422 Unprocessable Entity, advising the citizen of the supported geographic zone.
- **Resource Depletion**: If no compatible resource is currently `AVAILABLE`, the C++ engine flags the incident with `INSUFFICIENT_RESOURCES`, queues it in the Max-Heap Priority Queue, and suggests reallocation upon the next returning unit.
- **Cancellation**: Citizen cancels the report before dispatch confirmation. Status updates to `CANCELLED` and allocated resources are immediately released.
