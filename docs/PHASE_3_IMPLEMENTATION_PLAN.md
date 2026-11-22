# Phase 3 Implementation Plan: C++17 Graph Ingestion & Dijkstra Shortest Path Engine (Revised Architecture)

**Project:** Emergency Resource Allocation & Response Management System  
**Scope:** Jodhpur Urban Service Area, Rajasthan, India  
**Compiler:** GCC 16.2.0 (MSYS2 UCRT64 64-bit) — `C:\msys64\ucrt64\bin\g++.exe`  
**Language Standard:** C++17 (`-std=c++17 -Wall -Wextra -pedantic -O3`)  
**Canonical Dataset:** `cpp_engine/data/jodhpur_graph.json` (59,334 nodes, 129,778 directed edges)  
**Date:** November 2026  
**Document Status:** Revised Architecture — Pending User Review & Approval (Phase 3.1)

---

## 1. Executive Summary & Design Principles

Phase 2 established and verified the authentic OpenStreetMap road network dataset for the Jodhpur Urban Service Area (derived from OSM Way 31725312). Phase 3 implements the core algorithmic routing engine in modern, standards-conforming C++17.

This document incorporates all architectural decisions from the Phase 3.1 review:
1. **Direct Canonical JSON Ingestion:** The engine will parse the canonical `jodhpur_graph.json` directly using `nlohmann/json` v3.11.3. Binary caching (`jodhpur_graph.bin`) is explicitly **postponed** until JSON ingestion, routing, and benchmarking are fully implemented and verified.
2. **Deterministic Data Integrity:** 64-bit OSM Node IDs (`int64_t`) are preserved, edge weights are stored in meters as high-precision `double`, and strict validation rejects any dangling node references, non-finite values, zero, or negative edge weights.
3. **Realistic Routing Scope & Documented Limitations:** The routing engine uses a node-based Dijkstra algorithm respecting authentic directed edges and one-way restrictions. It does **not** model complex turn-restriction relations (which require edge-expanded state spaces), nor does it claim real-time traffic, live emergency vehicle priority, or live ETA predictions.
4. **Correctness-First Spatial Indexing:** Spatial snapping is scheduled as a dedicated sub-phase requiring boundary validation and configurable distance cutoffs, prioritizing topological correctness over microsecond speed claims.
5. **Empirical Measurement Over Assumptions:** Memory consumption and latency figures are classified strictly as **design targets**. Concrete resident set size (RSS) and micro-benchmarks will be measured empirically during the validation and benchmarking phases.

---

## 2. Existing Architecture & Toolchain Inspection

### 2.1 Directory Layout

```text
cpp_engine/
├── CMakeLists.txt              # Build configuration enforcing C++17
├── compiler_test.cpp           # Verified C++17 feature test
├── compiler_test.exe           # Compiled test binary
├── bin/
│   └── engine.exe              # Current Phase 1 diagnostic binary (40 KB)
├── build/                      # Out-of-source CMake build directory
├── data/
│   ├── .gitkeep
│   ├── data_metadata.json
│   ├── jodhpur_boundary.geojson     # OSM Way 31725312 (117.68 km², 46 vertices)
│   ├── jodhpur_graph.json        # 59,334 nodes, 129,778 directed edges (36.67 MB)
│   ├── jodhpur_roads.geojson     # 68,702 LineString segments (22.02 MB)
│   ├── raw_osm_roads.json        # Filtered Overpass output (10.58 MB)
│   └── road_network_metadata.json# Audited metadata and edge counts
├── include/
│   ├── .gitkeep
│   └── json.hpp                 # nlohmann/json single-header v3.11.3 (920 KB)
├── scripts/                     # Python download, build & audit scripts
├── src/
│   └── main.cpp                 # Phase 1 minimal diagnostic entry point
└── tests/
    └── .gitkeep                 # Designated unit/integration test directory
```

### 2.2 Toolchain Configuration

- **Operating System:** Windows 11 (64-bit)
- **Active C++ Compiler:** `C:\msys64\ucrt64\bin\g++.exe` (GCC 16.2.0, 64-bit)
- **C Standard Library:** UCRT (Universal C Runtime)
- **CMake Version:** 4.4.5 (`C:\msys64\ucrt64\bin\cmake.exe`)
- **Make Tool:** GNU Make 4.4.1 (`C:\msys64\ucrt64\bin\mingw32-make.exe`)
- **Verified Standard Support:** `__cplusplus = 201703L` (Finalized ISO/IEC 14882:2017 C++17)
- **Compiler Flags:** `-std=c++17 -Wall -Wextra -pedantic -O3`
- **Legacy Toolchain Isolation:** Legacy MinGW GCC 6.3.0 at `C:\MinGW\bin` remains untouched and is completely bypassed.

---

## 3. Canonical Dataset Schema & Memory Profile

### 3.1 JSON Schema Specification (`jodhpur_graph.json`)

The canonical dataset consists of 59,334 nodes and 129,778 directed edges across 12 highway classifications:

```json
{
  "metadata": {
    "city": "Jodhpur",
    "state": "Rajasthan",
    "country": "India",
    "source": "OpenStreetMap",
    "boundary_reference": "Jodhpur Urban Service Area (OSM Way 31725312)",
    "coordinate_reference_system": "WGS84 (EPSG:4326)",
    "weight_unit": "meters",
    "nodes_count": 59334,
    "edges_count": 129778
  },
  "nodes": [
    {
      "id": 12198753457,
      "latitude": 26.350903,
      "longitude": 73.0429118,
      "is_boundary_node": false
    }
  ],
  "edges": [
    {
      "from": 12198753457,
      "to": 8553989611,
      "road_id": 31612414,
      "name": "Mandore Flyover",
      "road_type": "trunk",
      "distance_meters": 37.41,
      "oneway": true,
      "access": "yes",
      "geometry": [
        [73.0429118, 26.350903],
        [73.0427755, 26.3505895]
      ]
    }
  ]
}
```

#### Field Specifications:

| Entity | Field | Type | Storage in C++ | Validation Rule |
| :--- | :--- | :--- | :--- | :--- |
| **Node** | `id` | `int64_t` | `int64_t` (8 B) | Must be $> 0$; unique across node list |
| **Node** | `latitude` | `double` | `double` (8 B) | Must be finite; $26.15^\circ \le \text{lat} \le 26.40^\circ$ |
| **Node** | `longitude` | `double` | `double` (8 B) | Must be finite; $72.90^\circ \le \text{lon} \le 73.20^\circ$ |
| **Node** | `is_boundary_node` | `bool` | `bool` (1 B) | Boolean flag |
| **Edge** | `from` | `int64_t` | `uint32_t` index | Must resolve to a valid node in `nodes` |
| **Edge** | `to` | `int64_t` | `uint32_t` index | Must resolve to a valid node in `nodes` |
| **Edge** | `road_id` | `int64_t` | `int64_t` (8 B) | Authentic OSM Way ID |
| **Edge** | `name` | `string` | `uint16_t` pool index | Deduplicated string pool index (117 names) |
| **Edge** | `road_type` | `string` | `uint16_t` enum id | Mapped to 12 enumerated classes |
| **Edge** | `distance_meters`| `double` | `double` (8 B) | Must be finite and strictly $> 0.0$ |
| **Edge** | `oneway` | `bool` | Direct edge policy | Already expanded into directed edges |
| **Edge** | `geometry` | `array` | Polyline buffer | Array of `[lon, lat]` coordinate pairs |

### 3.2 Memory Footprint: Theoretical Estimate vs. Empirical Measurement Plan

The in-memory storage of the graph is estimated theoretically as follows:
- **Node Storage:** 59,334 nodes $\times 32\text{ bytes} \approx 1.90\text{ MB}$.
- **OSM-to-Internal Index Map:** `std::unordered_map<int64_t, uint32_t>` $\approx 2.40\text{ MB}$.
- **Adjacency Edge List:** 129,778 edges $\times 32\text{ bytes} + 59,334\text{ vectors} \approx 5.50\text{ MB}$.
- **Road Name Pool + Geometry Buffer:** $\approx 4.50\text{ MB}$.
- **Theoretical Lower Bound:** $\approx 14.3\text{ MB}$.

> [!IMPORTANT]
> **Measurement Policy:** The ~14 MB figure is an analytical lower bound, not a measured runtime metric. The transient JSON parsing phase will allocate substantially more heap (~180–220 MB). In Sub-phase 3.3 and Sub-phase 3.8, actual peak working set size (Resident Set Size) will be captured via Windows platform APIs (`GetProcessMemoryInfo`) and reported directly.

---

## 4. Graph Data Structures & Internal Representation

### 4.1 Two-Tier Indexing Architecture

Because OSM Node IDs are sparse 64-bit integers (e.g. `12198753457`), using them directly to index arrays is inefficient. We use a **Two-Tier Indexing Architecture**:

```text
[ OSM Node ID: int64_t ] 
          │
          ▼  (std::unordered_map<int64_t, uint32_t> — O(1) average lookup)
[ Dense Internal Index: uint32_t (0 <= u < 59,334) ]
          │
   ┌──────┴───────────────────────────────────────┐
   ▼                                              ▼
[ Contiguous Node Vector ]             [ Adjacency List Vector ]
std::vector<NodeRecord>                std::vector<std::vector<EdgeRecord>>
(Fast cache-friendly coordinate lookups) (Dense direct-indexed edge traversal)
```

### 4.2 Struct Definitions (`GraphTypes.hpp`)

Per design decisions, edge weights are preserved as double-precision floating-point numbers (`double`) in meters:

```cpp
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace EmergencyRouting {

// Geographic coordinate pair in WGS84
struct GeoPoint {
    double latitude{0.0};
    double longitude{0.0};
};

// Node record in contiguous memory
struct NodeRecord {
    int64_t osm_id{0};             // Authentic 64-bit OpenStreetMap Node ID
    double latitude{0.0};          // Geographic latitude
    double longitude{0.0};         // Geographic longitude
    bool is_boundary{false};       // Intersection with urban boundary
};

// Directed edge record
struct EdgeRecord {
    uint32_t target_idx{0};        // Target node internal dense index [0, V-1]
    double distance_meters{0.0};   // Authentic segment distance in meters (double precision)
    uint16_t road_type_id{0};      // Enumerated highway classification
    uint16_t name_id{0};           // Deduplicated string pool index
    int64_t osm_way_id{0};         // Original OSM Way identifier
    uint32_t geometry_offset{0};   // Offset into shared polyline coordinate buffer
    uint16_t geometry_count{0};    // Number of coordinate pairs in polyline
};

} // namespace EmergencyRouting
```

### 4.3 Directed Edge Semantics

During Phase 2 network extraction:
- Every bidirectional road was expanded into **two symmetric directed edges**.
- Every one-way road was emitted only in its legally allowable travel direction.
- Consequently, the C++ engine treats all edges in `jodhpur_graph.json` strictly as **directed edges** ($u \to v$). No synthetic edge reversal is performed during graph construction, guaranteeing exact adherence to one-way restrictions.

---

## 5. Direct Canonical JSON Ingestion & Validation Pipeline

### 5.1 JSON Parsing Strategy

- The ingestion pipeline reads `cpp_engine/data/jodhpur_graph.json` directly using `nlohmann/json` v3.11.3 (located at [`cpp_engine/include/json.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/json.hpp)).
- Memory reservations (`reserve()`) are executed upfront based on top-level metadata (`nodes_count: 59334`, `edges_count: 129778`).
- The canonical JSON dataset is strictly **read-only**; the engine will never mutate, overwrite, or reformat it.

### 5.2 Strict Invariant Validation Rules

During ingestion, every entity is validated. An invariant failure halts loading and throws an explicit exception logged to `stderr`:

1. **Source & Target Node Integrity:** Every edge's `from` and `to` OSM ID must exist in the node index. Any dangling edge is rejected.
2. **Weight Validity:** Every `distance_meters` must be finite (`std::isfinite`), strictly positive ($> 0.0$), and non-zero. Negative, zero, NaN, or infinite weights are immediately rejected.
3. **Coordinate Sanity:** Latitudes must fall in $[26.15^\circ, 26.40^\circ]$ and longitudes in $[72.90^\circ, 73.20^\circ]$.
4. **Metadata Reconciliation:** The parsed node count and edge count must match the counts declared in the JSON metadata object.

### 5.3 Binary Caching Policy

> [!NOTE]
> **Binary Caching Postponed:** The binary cache (`jodhpur_graph.bin`) is explicitly deferred. The initial engine implementation will load exclusively from the canonical JSON. Binary serialization will only be considered in a subsequent optimization phase after JSON ingestion, Dijkstra routing, path reconstruction, and benchmarks are thoroughly validated.

---

## 6. Dijkstra Shortest-Path Engine & Algorithmic Scope

### 6.1 Algorithmic Formulation

The shortest-path engine operates on directed graph $G = (V, E, w)$ with non-negative edge weights $w(u, v) = \text{distance\_meters} \in \mathbb{R}^+$:
- **Min-Priority Queue:** `std::priority_queue<PQElement, std::vector<PQElement>, std::greater<PQElement>>` where `PQElement = std::pair<double, uint32_t>` (accumulated distance, internal node index).
- **Distance Array:** `std::vector<double> dist(V, std::numeric_limits<double>::infinity())`.
- **Predecessor Trace:** `std::vector<ParentTrace> parent(V)` storing the predecessor vertex index and edge index for exact trajectory reconstruction.
- **Early Termination:** For point-to-point queries, the search halts the instant the target node $t$ is popped from the priority queue.

```text
Algorithm: Point-to-Point Dijkstra with Early Stopping
---------------------------------------------------------------------------
Input: Graph G, source node s, target node t
Output: Shortest distance d(s, t) and parent predecessor pointers

1.  Initialize dist[v] = INF for all v in V; dist[s] = 0.0.
2.  Push (0.0, s) into Min-Priority Queue PQ.
3.  While PQ is not empty:
4.      Pop (curr_dist, u) with minimum distance.
5.      If curr_dist > dist[u]: continue   (Skip stale entries)
6.      If u == t: BREAK                   (Early stopping: target settled)
7.      For each outgoing directed edge e = (u, v) in Adj[u]:
8.          new_dist = dist[u] + e.distance_meters
9.          If new_dist < dist[v]:
10.             dist[v] = new_dist
11.             parent[v] = {u, e}
12.             Push (new_dist, v) into PQ.
13. If dist[t] == INF: Return UNREACHABLE.
14. Backtrack parent pointers from t to s to construct ordered path.
---------------------------------------------------------------------------
```

### 6.2 Supported Query Modes

1. **Mode 1: Point-to-Point (1-to-1):** Computes shortest route between source node and target node with early termination.
2. **Mode 2: One-to-Many Emergency Dispatch (`FindShortestToTargets`):** Computes shortest paths from an incident location to multiple facility locations simultaneously, terminating as soon as all requested targets are settled.
3. **Mode 3: Topological Reachability Check:** Verifies directed reachability between two vertices.

### 6.3 Documented Routing Limitations & Scope Boundaries

> [!WARNING]
> **Algorithmic Scope & Limitations:**
> 1. **Node-Based Graph:** Dijkstra operates on vertices ($V$). While it strictly enforces directed edge orientations and one-way streets, it does **not** evaluate complex OSM turn-restriction relations (e.g., `restriction=no_left_turn` or `restriction=only_straight_on`), which would require an edge-expanded line graph ($L(G)$).
> 2. **Static Network:** The system performs static shortest-path calculations. It does **not** integrate live traffic telemetry, dynamic congestion data, or road construction closures.
> 3. **Nominal Travel Times:** Estimated travel times are derived from static road classification speed profiles (e.g. trunk = 50 km/h, residential = 25 km/h). They are **not** real-time predictive ETAs.
> 4. **No Vehicle-Specific Access Routing:** Ambulances and fire trucks are assumed to follow standard navigable vehicular roadways. Special emergency vehicle exemptions (driving against one-way streets, crossing physical medians) are not modeled.

---

## 7. Path Reconstruction & Route Validation

When Dijkstra settles a destination vertex, the route is reconstructed by backtracking parent pointers from target to source:

1. **Topological Sequence:** An ordered sequence of OSM Node IDs $[v_0, v_1, \dots, v_k]$ where $v_0 = s$ and $v_k = t$.
2. **Cumulative Metrics:** Exact total distance in meters (`double`) and nominal traversal time (seconds).
3. **Segment Metadata:** Step-by-step road names, highway classifications, and segment lengths.
4. **Detailed Polyline:** Full sequence of intermediate coordinates `[[lon, lat], ...]` extracted from the edge geometry pool for direct rendering in React Leaflet.
5. **Route Validation:**
   - Verify every consecutive pair $(v_i, v_{i+1})$ corresponds to an actual directed edge in the graph.
   - Verify that the sum of segment lengths equals the total calculated path distance within floating-point tolerance ($\epsilon < 10^{-4}$).

---

## 8. Spatial Indexing & Nearest-Node Snapping

Spatial indexing is scheduled as **Sub-phase 3.6**, emphasizing correctness and geographic validation over microsecond benchmarks.

### 8.1 Spatial Snapping Architecture

When an incident coordinate $(lat, lon)$ is submitted:
1. **Boundary Validation:** Verify the coordinate lies within the Jodhpur Urban Service Area bounding box ($[26.15^\circ, 26.40^\circ]\text{ N}$, $[72.90^\circ, 73.20^\circ]\text{ E}$). Coordinates outside are rejected with a descriptive error.
2. **Grid Partitioning:** A 2D spatial grid (e.g. $50 \times 50$ cells) partitions vertices into spatial buckets.
3. **Candidate Search:** The query evaluates vertices in the target bucket and adjacent neighboring buckets.
4. **Exact Haversine Distance:** Candidate distances are computed using the exact great-circle Haversine formula ($R = 6,371,000\text{ m}$).
5. **Configurable Maximum Snapping Distance:** If the nearest graph node exceeds a configurable maximum snapping radius (e.g. $\text{cutoff} = 1000\text{ meters}$), the coordinate is flagged as unnavigable/isolated.
6. **Correctness Invariant:** Exact verification asserts that no other graph node has a smaller Haversine distance than the returned node.

---

## 9. Subprocess IPC & Communication Protocol

The Node.js backend invokes the C++ engine as a child process. Standard streams are segregated strictly:

```text
+-------------------------------------------------------------------------+
| STANDARD STREAM SEGREGATION                                             |
+-------------------------------------------------------------------------+
| STDOUT: Exclusively valid JSON responses.                               |
|         - Direct consumption by Node.js JSON.parse().                  |
|         - Zero diagnostic echoes, zero progress text.                  |
|                                                                         |
| STDERR: Exclusively structured diagnostic and telemetry logs.           |
|         - Formatted tags: [CPP_INFO], [CPP_WARN], [CPP_ERROR].          |
|                                                                         |
| EXIT CODES:                                                             |
|         0: Success (valid JSON response emitted to stdout).             |
|         1: Invalid CLI arguments or malformed request.                  |
|         2: Dataset missing, inaccessible, or corrupted.                 |
|         3: Unhandled algorithmic or runtime exception.                  |
+-------------------------------------------------------------------------+
```

### CLI Command Specifications

#### 1. Engine Health Check
```bash
engine.exe --health --graph data/jodhpur_graph.json
```
**`stdout` JSON Response:**
```json
{
  "status": "HEALTHY",
  "engine_version": "1.0.0-phase3",
  "cpp_standard": 201703,
  "nodes_loaded": 59334,
  "edges_loaded": 129778,
  "load_time_ms": 384.2,
  "memory_rss_bytes": 22415872
}
```

#### 2. Point-to-Point Route by Node IDs
```bash
engine.exe --route --from 8520698362 --to 5321319416 --graph data/jodhpur_graph.json
```
**`stdout` JSON Response:**
```json
{
  "status": "SUCCESS",
  "source_node": 8520698362,
  "target_node": 5321319416,
  "found": true,
  "distance_meters": 5712.35,
  "estimated_time_seconds": 514.1,
  "hop_count": 84,
  "nodes": [8520698362, 8520698363, 5321319416],
  "road_segments": [
    {
      "name": "Mandore Flyover",
      "road_type": "trunk",
      "distance_meters": 37.41,
      "from_node": 8520698362,
      "to_node": 8520698363
    }
  ],
  "polyline": [
    [73.012589, 26.237482],
    [73.011802, 26.262570]
  ],
  "execution_time_ms": 5.42
}
```

#### 3. Coordinate Route with Automatic Snapping
```bash
engine.exe --route-coords --from-lat 26.2374 --from-lon 73.0125 --to-lat 26.2625 --to-lon 73.0118 --max-snap-dist 1000 --graph data/jodhpur_graph.json
```

#### 4. One-to-Many Emergency Dispatch Matrix
```bash
engine.exe --dispatch-matrix --incident-lat 26.2750 --incident-lon 73.0200 --facility-nodes 8520698362,5321319416,8499684813 --graph data/jodhpur_graph.json
```

#### 5. Nearest-Node Snapping
```bash
engine.exe --snap --lat 26.237482 --lon 73.012589 --max-snap-dist 1000 --graph data/jodhpur_graph.json
```

---

## 10. Performance Budgets: Design Targets vs. Empirical Measurement

All performance figures in this plan are **design targets**, not guaranteed outcomes. Actual metrics will be collected and reported during Sub-phase 3.8 benchmarking:

| Metric | Target Specification | Measurement Protocol |
| :--- | :--- | :--- |
| **Compiler Standard** | Strict C++17 (`201703L`) | Verified via `__cplusplus` preprocessor macro |
| **Node Count Ingested** | Exactly 59,334 vertices | Programmatic assertion against metadata |
| **Edge Count Ingested** | Exactly 129,778 directed edges | Programmatic assertion against metadata |
| **Cold JSON Load Time** | Target: $< 600\text{ ms}$ | High-resolution clock (`std::chrono::steady_clock`) |
| **Peak Memory Footprint (RSS)** | Target: $< 150\text{ MB}$ | Measured via `GetProcessMemoryInfo` (Windows API) |
| **Dijkstra Point-to-Point Latency** | Target: $< 20\text{ ms}$ | Average over 100 random source-target pairs |
| **One-to-Many Dispatch Latency** | Target: $< 35\text{ ms}$ | Single traversal settling 6 facility targets |
| **Spatial Snap Latency** | Target: $< 2\text{ ms}$ | Timing over 50 arbitrary coordinate lookups |
| **Facility Route Integrity** | 100% reachability across 6 facilities | $6 \times 6 = 36$ directed paths asserted valid |
| **Stream Cleanliness** | 100% valid JSON on `stdout` | Piped to JSON parser; zero syntax errors allowed |

---

## 11. Automated Testing & Verification Strategy

The test suite in `cpp_engine/tests/` will be structured into granular verification layers:

```text
cpp_engine/tests/
├── test_graph_core.cpp       # Unit tests for Graph data structures & index mapping
├── test_dijkstra.cpp         # Algorithmic tests on synthetic graph topologies
├── test_path_reconstruct.cpp # Path backtracking and metric accumulation tests
├── test_spatial_grid.cpp     # Spatial index, boundary validation, and snap distance cutoff
├── test_jodhpur_routes.cpp   # Integration tests verifying the 6 canonical emergency facilities
└── benchmark_routing.cpp     # Empirical latency, memory, and throughput benchmarks
```

### 11.1 Synthetic Algorithmic Tests (`test_dijkstra.cpp`)
- **Trivial Two-Node Graph:** Verifies simple forward path, zero distance to self.
- **Diamond Graph (Symmetric Alternatives):** Verifies optimal choice and deterministic tie-breaking.
- **One-Way Cycle:** Verifies that reverse direction correctly reports unreachable (`found = false`).
- **Disconnected Vertices:** Verifies that unlinked components terminate safely without memory corruption.
- **Non-Finite / Invalid Weights:** Verifies that zero, negative, or NaN weights are caught and rejected during construction.

### 11.2 Authentic 6-Facility Routing Suite (`test_jodhpur_routes.cpp`)
Tests directed shortest-path routing between the six verified emergency facility locations in Jodhpur:
1. **AIIMS Jodhpur** (`8520698362`)
2. **MDM Hospital** (`5321319416`)
3. **Mahatma Gandhi Hospital (MGH)** (`8499684813`)
4. **Basni Fire Station** (`2694302020`)
5. **Sojati Gate** (`2688566058`)
6. **Paota Circle** (`3773158752`)

All $6 \times 6 = 36$ directed routes must satisfy:
- `found == true`
- `distance_meters > 0.0`
- `nodes.front() == source` and `nodes.back() == target`
- Strict directed triangle inequality: $\text{dist}(u, w) \le \text{dist}(u, v) + \text{dist}(v, w)$ for one-way compliant routes.

---

## 12. Updated 8-Step Implementation Order

```text
Sub-Phase 3.2: Graph Data Structures and JSON Ingestion
├── Define GraphTypes.hpp (NodeRecord, EdgeRecord with double weight, GeoPoint)
├── Implement Graph.hpp / Graph.cpp (directed adjacency list, 64-bit to 32-bit index mapping)
└── Implement DataLoader.hpp / DataLoader.cpp (direct nlohmann/json ingestion)

Sub-Phase 3.3: Graph Integrity Validation and Memory Measurement
├── Implement validation logic (rejection of dangling edges, non-finite, zero, or negative weights)
├── Build unit tests in test_graph_core.cpp
└── Measure actual cold JSON ingestion time and resident heap memory

Sub-Phase 3.4: Dijkstra Shortest-Path Implementation
├── Implement Dijkstra.hpp / Dijkstra.cpp (min-priority queue, early termination)
├── Implement single-source point-to-point (1-to-1)
├── Implement single-source multi-target (1-to-Many for emergency dispatch)
└── Verify with synthetic graph test cases in test_dijkstra.cpp

Sub-Phase 3.5: Path Reconstruction and Route Validation
├── Implement PathResult.hpp / PathResult.cpp
├── Backtrack parent traces to produce ordered node lists, road names, and polylines
├── Verify metric consistency (sum of segments == total distance)
└── Test in test_path_reconstruct.cpp

Sub-Phase 3.6: Spatial Indexing and Nearest-Node Snapping
├── Implement SpatialGrid.hpp / SpatialGrid.cpp
├── Implement boundary validation and configurable maximum snapping radius
├── Implement exact Haversine distance verification
└── Test in test_spatial_grid.cpp

Sub-Phase 3.7: CLI JSON Subprocess Interface
├── Implement main.cpp CLI argument parser (--health, --route, --route-coords, --dispatch-matrix, --snap)
├── Guarantee 100% pure JSON output on stdout
└── Route all logs and diagnostics to stderr

Sub-Phase 3.8: Automated Testing and Performance Benchmarking
├── Execute test_jodhpur_routes.cpp (36 directed facility paths)
├── Execute benchmark_routing.cpp (empirical latency distribution, memory RSS)
└── Document empirical findings in Phase 3 Completion Report
```

---

## 13. Strict Boundaries & Operating Rules

1. **No Code Implementation in Phase 3.1:** This phase is strictly design and architectural planning. Implementation begins only upon user approval.
2. **Canonical Data Protection:** `cpp_engine/data/jodhpur_graph.json` and `cpp_engine/data/jodhpur_boundary.geojson` remain completely read-only and unmodified.
3. **No Premature Binary Cache:** No binary cache (`.bin`) will be created or introduced until JSON ingestion and routing are implemented, tested, and benchmarked.
4. **Toolchain Discipline:** Builds will use `C:\msys64\ucrt64\bin\g++.exe` with `-std=c++17`. The legacy MinGW at `C:\MinGW` will remain untouched.
5. **No System Creep:** No changes to the React frontend, Node.js backend, or higher-level resource allocation logic until the core C++ routing engine is certified.

---

*Phase 3.1 Revised Architectural Plan is complete and submitted for user review and approval.*
