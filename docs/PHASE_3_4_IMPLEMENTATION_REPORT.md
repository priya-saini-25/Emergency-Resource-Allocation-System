# Phase 3.4 Implementation Report: Dijkstra Shortest-Path Engine

**Project:** Emergency Resource Allocation & Response Management System  
**Phase:** Sub-phase 3.4 — Dijkstra Shortest-Path Implementation  
**Status:** Completed & Fully Certified  
**Compiler:** GCC 16.2.0 (MSYS2 UCRT64 64-bit) — `C:\msys64\ucrt64\bin\g++.exe`  
**Language Standard:** C++17 (`-std=c++17 -Wall -Wextra -pedantic -O3`)  
**Canonical Dataset:** `cpp_engine/data/jodhpur_graph.json` (59,334 nodes, 129,778 directed edges)  
**Date:** November 2026  

---

## 1. Executive Summary

Sub-phase 3.4 delivers the core algorithmic routing engine for the Jodhpur Urban Service Area. The implementation provides single-pair (1-to-1) shortest-path routing with early stopping, full single-source (1-to-All) distance computation, and exact route reconstruction with structural and numerical integrity verification.

In strict adherence to the Phase 3 architectural plan:
- Canonical datasets (`jodhpur_graph.json`, `jodhpur_roads.geojson`, `jodhpur_boundary.geojson`, `road_network_metadata.json`) remained 100% read-only and unmodified.
- No synthetic reverse edges were created; one-way directional constraints were strictly enforced.
- Path reconstruction was verified through independent edge-weight summation ($|\sum w_e - d| < 10^{-4}\text{ m}$).
- Phase boundaries were strictly maintained: Phase 3.5 (GeoJSON/polyline reconstruction), Phase 3.6 (SpatialGrid snapping), Phase 3.7 (CLI JSON IPC), and binary caching were **not** implemented in this phase.

All 14 synthetic unit tests and all 30 canonical emergency facility route evaluations passed with **zero errors and zero warnings**.

---

## 2. Architecture & Algorithmic Design

### 2.1 Core Routing Structures (`cpp_engine/include/Dijkstra.hpp`)

The router introduces five lightweight data structures designed for cache efficiency and seamless handoff to Phase 3.5:

1. **`Predecessor`**
   ```cpp
   struct Predecessor {
       uint32_t from_idx{0xFFFFFFFF}; // Source node internal index
       uint32_t edge_idx{0xFFFFFFFF}; // Edge index within adj_[from_idx]
   };
   ```
   Stores the exact incoming directed edge that relaxed each node. This allows $O(L)$ backtracking (where $L$ is path length in hops) without searching adjacency lists.

2. **`PathSegment`**
   ```cpp
   struct PathSegment {
       uint32_t from_idx, to_idx;
       int64_t from_osm_id, to_osm_id, osm_way_id;
       double distance_meters;
       uint16_t road_type_id, name_id, access_id;
       bool oneway;
       uint32_t geometry_offset;
       uint16_t geometry_count;
   };
   ```
   Retains all edge metadata and intermediate geometry coordinate offsets from the contiguous geometry pool, directly preparing the path for Phase 3.5 GeoJSON rendering.

3. **`RouteResult`**
   Carries the complete route payload:
   - `found` (`bool`): Route existence flag.
   - `source_osm_id`, `destination_osm_id` (`int64_t`): Original 64-bit OSM IDs.
   - `source_internal_idx`, `destination_internal_idx` (`uint32_t`): Dense internal indices.
   - `total_distance_meters` (`double`): Exact shortest distance in meters.
   - `path_osm_ids` (`std::vector<int64_t>`): Sequence of OSM IDs from origin to destination.
   - `path_internal_indices` (`std::vector<uint32_t>`): Sequence of internal indices.
   - `path_segments` (`std::vector<PathSegment>`): Detailed sequence of traversed edges.
   - `visited_nodes`, `relaxed_edges` (`size_t`): Search space metrics.
   - `algorithm_execution_time_ms`, `path_reconstruction_time_ms` (`double`): High-resolution timers.

4. **`SingleSourceResult`**
   Contains distances and predecessor vectors to all $V = 59,334$ graph nodes from a given source node.

5. **`DijkstraRouter`**
   Encapsulates routing operations on a `const Graph&`.

### 2.2 Algorithmic Implementation (`cpp_engine/src/Dijkstra.cpp`)

#### Objective A: Single-Pair (1-to-1) Dijkstra with Early Stopping
- **Priority Queue:** Min-heap using standard library `std::priority_queue<std::pair<double, uint32_t>, std::vector<std::pair<double, uint32_t>>, std::greater<std::pair<double, uint32_t>>>`.
- **Early Stopping:** Halts relaxation immediately when the destination node $t$ is popped from the priority queue, ensuring minimal edge explorations.
- **Stale Entry Discarding:** Elements popped with $d > \text{dist}[u]$ are skipped in $O(1)$.
- **Time Complexity:** $O((V' + E') \log V')$, where $V', E'$ are vertices and edges settled before reaching $t$. On Jodhpur's Giant SCC, this runs in **0.30 ms – 21.63 ms** (average **7.64 ms**).
- **Space Complexity:** $O(V)$ auxiliary vectors for distances and predecessors ($59,334 \times 16\text{ bytes} \approx 949\text{ KB}$).

#### Objective D: Single-Source (1-to-All) Dijkstra
- Computes shortest paths from a single origin to all reachable vertices in the graph.
- Runs until the priority queue is empty.
- Settles all 58,768 reachable nodes in the Giant SCC in **12.03 ms – 22.58 ms** (average **18.50 ms**).

#### Objective C: Path Reconstruction & Verification
- Traverses backwards from $t$ to $s$ using `predecessors[curr]`.
- Assembles `path_internal_indices` and `path_segments` in reverse, then reverses both in $O(L)$ to yield forward trajectory order $[s, \dots, t]$.
- Independent distance verification computes $\sum_{e \in \text{path}} w_e$ and confirms $|\sum w_e - d| < 10^{-4}\text{ m}$.

---

## 3. Files Inspected, Created, or Modified

| File | Action | Purpose |
| :--- | :--- | :--- |
| [`cpp_engine/include/Dijkstra.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/Dijkstra.hpp) | Created | Definitions for `Predecessor`, `PathSegment`, `RouteResult`, `SingleSourceResult`, and `DijkstraRouter`. |
| [`cpp_engine/src/Dijkstra.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/Dijkstra.cpp) | Created | Implementation of 1-to-1 Dijkstra with early stopping, 1-to-All Dijkstra, and path reconstruction. |
| [`cpp_engine/tests/test_dijkstra.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/tests/test_dijkstra.cpp) | Created | Comprehensive test suite covering 14 synthetic scenarios and 30 canonical facility pairs. |
| [`cpp_engine/CMakeLists.txt`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/CMakeLists.txt) | Modified | Added `src/Dijkstra.cpp` to `routing_core` static library and registered `test_dijkstra` executable. |

---

## 4. Synthetic Test Suite Verification (14 Scenarios)

The test suite in `cpp_engine/tests/test_dijkstra.cpp` tests corner cases, edge cases, numeric stability, and failure handling on synthetic graphs before evaluating the canonical dataset.

| # | Test Scenario | Description / Conditions | Result |
| :-: | :--- | :--- | :---: |
| **1** | `Test1_BasicShortestPath` | Simple chain $A \xrightarrow{100} B \xrightarrow{150} C$. Verifies distance = 250.0m and path integrity. | **PASSED** |
| **2** | `Test2_MultiplePathsSelectMinWeight` | Diamond graph ($0 \to 1 \to 3 = 100\text{m}$ vs $0 \to 2 \to 3 = 70\text{m}$). Selects optimal path $0 \to 2 \to 3$. | **PASSED** |
| **3** | `Test3_DirectVsShorterMultiEdge` | Direct $0 \xrightarrow{500} 2$ vs multi-edge $0 \xrightarrow{120} 1 \xrightarrow{130} 2$. Selects multi-edge (250m). | **PASSED** |
| **4** | `Test4_DirectedOneWayRoute` | Directed edge $0 \xrightarrow{80} 1$. Route found in forward direction. | **PASSED** |
| **5** | `Test5_ReverseDirectionUnreachable` | Attempts $1 \to 0$ on one-way edge. Returns `found = false`, `distance = inf`, empty path. | **PASSED** |
| **6** | `Test6_DisconnectedDestination` | Disconnected components $\{0, 1\}$ and $\{2, 3\}$. Returns `found = false`, `distance = inf`. | **PASSED** |
| **7** | `Test7_SourceEqualsDestination` | $s = d$. Returns `found = true`, `distance = 0.0m`, 1-node path, 0 segments. | **PASSED** |
| **8** | `Test8_InvalidSourceOsmId` | Non-existent source OSM ID `999999`. Throws `std::out_of_range`. | **PASSED** |
| **9** | `Test9_InvalidDestinationOsmId` | Non-existent destination OSM ID `999999`. Throws `std::out_of_range`. | **PASSED** |
| **10** | `Test10_EqualCostAlternativePaths` | Two distinct paths of equal cost (80.0m). Deterministic tie-breaking verified over identical runs. | **PASSED** |
| **11** | `Test11_LargeEdgeWeights` | Edge weights $10^9\text{ m}$ and $2 \times 10^9\text{ m}$. Sums accurately to $3 \times 10^9\text{ m}$ without overflow. | **PASSED** |
| **12** | `Test12_FloatingPointPrecisionDistances` | Edge weights $37.412345\text{ m} + 62.587655\text{ m}$. Sums exactly to $100.000000\text{ m}$ within $\epsilon = 10^{-6}$. | **PASSED** |
| **13** | `Test13_PathReconstructionCorrectness` | 5-node chain $0 \to 1 \to 2 \to 3 \to 4$. Verifies exact sequence of internal indices and OSM IDs. | **PASSED** |
| **14** | `Test14_SingleSourceVsSinglePair` | Compares single-pair results against single-source extraction for all nodes. 100% equivalence. | **PASSED** |

**Synthetic Suite Summary:** **14 / 14 Passed (100%)**

---

## 5. Canonical Jodhpur Road Graph Evaluation (30 Directed Facility Pairs)

The router was evaluated across all 30 directed pairs among the six approved emergency facilities in the canonical Jodhpur graph (`59,334` nodes, `129,778` edges).

### Facility Locations Under Test
1. **AIIMS Jodhpur:** OSM Node `8520698362`
2. **MDM Hospital:** OSM Node `5321319416`
3. **Mathura Das Mathur Hospital (MGH):** OSM Node `8499684813`
4. **Basni Fire Station:** OSM Node `2694302020`
5. **Sojati Gate:** OSM Node `2688566058`
6. **Paota Circle:** OSM Node `3773158752`

### 30-Pair Routing Results Matrix

| # | Origin Facility | Destination Facility | Distance (m) | Hops | Settled Nodes | Time (ms) | Path Integrity |
| :-: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| 1 | AIIMS Jodhpur | MDM Hospital | 4,612.05 | 101 | 9,867 | 4.15 | **VERIFIED** |
| 2 | AIIMS Jodhpur | Mathura Das Mathur Hospital | 6,198.77 | 182 | 20,634 | 9.28 | **VERIFIED** |
| 3 | AIIMS Jodhpur | Basni | 2,768.72 | 72 | 2,228 | 1.52 | **VERIFIED** |
| 4 | AIIMS Jodhpur | Sojati Gate | 7,038.62 | 221 | 26,261 | 11.07 | **VERIFIED** |
| 5 | AIIMS Jodhpur | Paota Circle | 10,023.69 | 313 | 42,353 | 15.12 | **VERIFIED** |
| 6 | MDM Hospital | AIIMS Jodhpur | 4,634.30 | 105 | 20,861 | 8.10 | **VERIFIED** |
| 7 | MDM Hospital | Mathura Das Mathur Hospital | 2,630.64 | 83 | 5,626 | 2.58 | **VERIFIED** |
| 8 | MDM Hospital | Basni | 6,254.01 | 146 | 35,018 | 13.99 | **VERIFIED** |
| 9 | MDM Hospital | Sojati Gate | 3,404.83 | 129 | 11,198 | 4.76 | **VERIFIED** |
| 10 | MDM Hospital | Paota Circle | 6,455.56 | 214 | 36,483 | 16.53 | **VERIFIED** |
| 11 | Mathura Das Mathur Hospital | AIIMS Jodhpur | 6,392.10 | 185 | 37,792 | 9.20 | **VERIFIED** |
| 12 | Mathura Das Mathur Hospital | MDM Hospital | 2,831.42 | 93 | 9,242 | 2.19 | **VERIFIED** |
| 13 | Mathura Das Mathur Hospital | Basni | 7,534.93 | 186 | 45,199 | 9.23 | **VERIFIED** |
| 14 | Mathura Das Mathur Hospital | Sojati Gate | 1,154.05 | 53 | 515 | 0.30 | **VERIFIED** |
| 15 | Mathura Das Mathur Hospital | Paota Circle | 4,139.12 | 145 | 20,202 | 4.96 | **VERIFIED** |
| 16 | Basni | AIIMS Jodhpur | 2,767.82 | 57 | 4,014 | 0.98 | **VERIFIED** |
| 17 | Basni | MDM Hospital | 6,157.33 | 140 | 10,259 | 2.41 | **VERIFIED** |
| 18 | Basni | Mathura Das Mathur Hospital | 7,337.84 | 153 | 17,582 | 3.16 | **VERIFIED** |
| 19 | Basni | Sojati Gate | 8,177.69 | 192 | 23,613 | 4.29 | **VERIFIED** |
| 20 | Basni | Paota Circle | 11,162.76 | 284 | 42,463 | 8.36 | **VERIFIED** |
| 21 | Sojati Gate | AIIMS Jodhpur | 7,063.76 | 215 | 44,357 | 14.86 | **VERIFIED** |
| 22 | Sojati Gate | MDM Hospital | 3,382.70 | 126 | 16,473 | 7.16 | **VERIFIED** |
| 23 | Sojati Gate | Mathura Das Mathur Hospital | 1,497.45 | 74 | 3,643 | 2.02 | **VERIFIED** |
| 24 | Sojati Gate | Basni | 8,206.59 | 216 | 51,785 | 21.63 | **VERIFIED** |
| 25 | Sojati Gate | Paota Circle | 3,079.25 | 96 | 13,923 | 5.93 | **VERIFIED** |
| 26 | Paota Circle | AIIMS Jodhpur | 10,055.07 | 308 | 48,485 | 18.43 | **VERIFIED** |
| 27 | Paota Circle | MDM Hospital | 6,424.84 | 210 | 33,875 | 9.12 | **VERIFIED** |
| 28 | Paota Circle | Mathura Das Mathur Hospital | 4,488.76 | 167 | 18,657 | 4.78 | **VERIFIED** |
| 29 | Paota Circle | Basni | 11,149.88 | 320 | 52,005 | 10.97 | **VERIFIED** |
| 30 | Paota Circle | Sojati Gate | 3,100.04 | 99 | 10,624 | 2.04 | **VERIFIED** |

### 5.1 Route Symmetry Observations (One-Way Street Impact)
Due to authentic one-way streets, forward and reverse shortest paths exhibit slight distance asymmetries, demonstrating the accuracy of the directed graph:
- **AIIMS $\to$ MDM:** $4,612.05\text{ m}$ (101 hops) vs **MDM $\to$ AIIMS:** $4,634.30\text{ m}$ (105 hops) [$\Delta = 22.25\text{ m}$]
- **MGH $\to$ Sojati:** $1,154.05\text{ m}$ (53 hops) vs **Sojati $\to$ MGH:** $1,497.45\text{ m}$ (74 hops) [$\Delta = 343.40\text{ m}$]
- **Basni $\to$ AIIMS:** $2,767.82\text{ m}$ (57 hops) vs **AIIMS $\to$ Basni:** $2,768.72\text{ m}$ (72 hops) [$\Delta = 0.90\text{ m}$]

### 5.2 Triangle Inequality Verification
Shortest paths in non-negative weighted graphs must strictly satisfy the metric property $d(u, v) \le d(u, w) + d(w, v)$ for all vertices $u, w, v$:
1. $\text{dist}(\text{AIIMS}, \text{MGH}) \le \text{dist}(\text{AIIMS}, \text{MDM}) + \text{dist}(\text{MDM}, \text{MGH})$  
   $$6,198.77\text{ m} \le 4,612.05\text{ m} + 2,630.64\text{ m} = 7,242.69\text{ m} \quad \text{[PASSED]}$$
2. $\text{dist}(\text{Basni}, \text{Paota}) \le \text{dist}(\text{Basni}, \text{Sojati}) + \text{dist}(\text{Sojati}, \text{Paota})$  
   $$11,162.76\text{ m} \le 8,177.69\text{ m} + 3,079.25\text{ m} = 11,256.94\text{ m} \quad \text{[PASSED]}$$
3. $\text{dist}(\text{Sojati}, \text{MDM}) \le \text{dist}(\text{Sojati}, \text{AIIMS}) + \text{dist}(\text{AIIMS}, \text{MDM})$  
   $$3,382.70\text{ m} \le 7,063.76\text{ m} + 4,612.05\text{ m} = 11,675.81\text{ m} \quad \text{[PASSED]}$$

---

## 6. Empirical Performance Benchmarking

### 6.1 Single-Pair (1-to-1) Latency Distribution (30 Facility Pairs)
- **Minimum Query Latency:** **0.30 ms** (MGH $\to$ Sojati Gate, 515 nodes settled)
- **Median Query Latency (p50):** **7.16 ms**
- **Average Query Latency:** **7.64 ms**
- **95th Percentile Latency (p95):** **18.43 ms**
- **Maximum Query Latency:** **21.63 ms** (Sojati Gate $\to$ Basni, 51,785 nodes settled)
- **Total Visited Nodes:** **715,237** (average 23,841 nodes/query)
- **Total Relaxed Edges:** **1,551,228** (average 51,707 edges/query)

### 6.2 Single-Source (1-to-All) Benchmark (All 59,334 Nodes)
Three independent full-graph iterations were run from AIIMS Jodhpur (`8520698362`):
- **Iteration 1:** **12.03 ms** (58,768 nodes visited, 128,829 edges relaxed)
- **Iteration 2:** **20.88 ms** (58,768 nodes visited, 128,829 edges relaxed)
- **Iteration 3:** **22.58 ms** (58,768 nodes visited, 128,829 edges relaxed)
- **Minimum Latency:** **12.03 ms**
- **Average Latency:** **18.50 ms**
- **Maximum Latency:** **22.58 ms**

> [!NOTE]
> Single-Source Dijkstra settles **all 58,768 reachable vertices** across the entire Jodhpur Urban Service Area in under **23 milliseconds**, providing exceptional throughput for real-time dispatch and multi-facility resource ranking.

---

## 7. Independent Path Verification

Every reconstructed path was verified by an independent verification function (`VerifyPathIntegrity`):
1. **Edge Existence:** Every sequential step $(u_i, u_{i+1})$ in `path_internal_indices` corresponds to an actual directed edge in `adj_[u_i]`.
2. **Metadata Consistency:** Segment endpoints match internal indices and 64-bit OSM IDs exactly.
3. **Numerical Precision:** The independent sum of edge weights $\sum_{i} \text{edge\_dist}_i$ matches `res.total_distance_meters` within $\epsilon = 10^{-4}\text{ m}$.
4. **Single-Source Equivalence:** For all 30 pairs, `ShortestPath(s, t)` produced identical distances and identical vertex sequences as `ReconstructRouteFromSingleSource(ShortestPathToAll(s), t)`.

---

## 8. Regression Suite Verification

The existing Phase 3.2 and Phase 3.3 regression test suites were re-executed to verify zero regressions:
- `test_graph_ingestion.exe`: **16 / 16 PASSED** (All syntax, numeric bounds, NaN/infinity checks passed).
- `test_graph_integrity.exe`: **2,102,456 / 2,102,456 invariant checks PASSED**, 76 WCCs verified, 206 SCCs verified, 30/30 BFS reachability verified.

---

## 9. Limitations & Strict Scope Boundaries

To maintain scientific integrity and project scope, the following limitations are documented:
1. **Node-Based Routing:** Edge weights represent physical road distances in meters. Turn restrictions at intersections (e.g., "no left turn" OSM relations) and traffic signal delays are not modeled.
2. **Static Network Weights:** Live traffic congestion data, time-of-day speeds, and road construction closures are not integrated.
3. **Vehicle Constraints:** Physical clearance limits (bridge heights, narrow alleyway widths) are not gated on edge traversals.
4. **Next Sub-Phases:**
   - **Phase 3.5:** Path reconstruction into GeoJSON LineString / polyline for React Leaflet frontend rendering.
   - **Phase 3.6:** SpatialGrid coordinate snapping ($O(1)$ nearest-node lookup from GPS coordinates).
   - **Phase 3.7:** Subprocess JSON CLI for Node.js IPC.
   - **Binary Caching:** Postponed until after Phase 3.7.

---

## 10. Conclusion & Certification

Phase 3.4 is **100% complete, fully verified, and certified**. All algorithms operate with deterministic precision and exceed performance targets on the authentic Jodhpur road network. Development is paused in accordance with instructions to await user review and explicit approval.

