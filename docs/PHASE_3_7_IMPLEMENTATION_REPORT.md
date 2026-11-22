# Phase 3.7 Implementation Report — Multi-Target Dijkstra with Early Termination

**Project:** Emergency Resource Allocation & Response Management System for Jodhpur  
**Date:** November 17, 2026  
**Status:** IMPLEMENTATION COMPLETE & VERIFIED  

---

## 1. Executive Summary

Phase 3.7 implements **Multi-Target Dijkstra with Early Termination** within the C++17 routing engine (`DijkstraRouter`), extending the engine's capabilities from single-pair (1-to-1) and full single-source (1-to-all) searches to optimized one-to-many (1-to-$K$) routing.

Emergency resource allocation frequently requires dispatching the closest emergency units (ambulances, police patrols, fire engines) to an incident, or evaluating a set of candidate medical centers from an incident site. In previous phases, evaluating $K$ targets required either:
1. Running $K$ independent single-pair Dijkstra searches, which caused extensive redundant relaxation of the graph around the source ($O(K \cdot (V + E \log V))$); or
2. Running a full single-source Dijkstra search, which relaxed up to 58,768 nodes across the entire Jodhpur road network even when all $K$ targets were located within a few kilometers.

Phase 3.7 introduces `ShortestPathMultiTarget` and `ShortestPathMultiTargetOsm`, which execute a single min-priority queue Dijkstra exploration, track target settlements in $O(1)$ time, and **terminate immediately** the instant all valid reachable requested targets have been finalized.

### Key Milestones Achieved
- **Core Data Structures:** Implemented `MultiTargetDestinationResult` and `MultiTargetResult`.
- **Target Tracking & Deduplication:** Preserves original caller order and duplicates in output while settling unique internal node indices once.
- **Immediate Early Termination:** Evaluates target settlement on node pop from the min-heap; stops when `targets_remaining == 0`.
- **Defensive Error Handling:** Out-of-range/invalid OSM IDs preserve original IDs and return `found=false`, `dist=INF` without aborting search for valid targets. Invalid sources consistently throw `std::out_of_range`.
- **Path Reconstruction Toggle:** Reconstructs exact directed paths (nodes, OSM IDs, segments, geometry offsets) only once per unique target when `reconstruct_paths=true`, or bypasses geometry reconstruction when false.
- **Test Suite Expansion:** Added Tests 18–30 (13 new unit and canonical integration tests), bringing `test_dijkstra` from 18 to 32 tests (100% passing).
- **Formal Benchmarking:** 30 measured iterations across $K \in \{2, 6, 15, 25, 50\}$ comparing Repeated 1-to-1, Single-Source-to-All, and Multi-Target. Multi-Target achieved up to **24.4x speedup** over repeated 1-to-1 searches.
- **Zero Regression:** All 8 test executables pass (100%). All 4 canonical datasets remain bit-for-bit identical (SHA-256 verified).

---

## 2. API & Architecture Design

### 2.1 Data Structures (`cpp_engine/include/Dijkstra.hpp`)

```cpp
/**
 * Result structure for a single destination within a multi-target Dijkstra search.
 */
struct MultiTargetDestinationResult {
    int64_t destination_osm_id{0};
    uint32_t destination_internal_idx{0xFFFFFFFF};
    bool found{false};
    double total_distance_meters{std::numeric_limits<double>::infinity()};

    std::vector<int64_t> path_osm_ids;
    std::vector<uint32_t> path_internal_indices;
    std::vector<PathSegment> path_segments;
    double path_reconstruction_time_ms{0.0};
};

/**
 * Result structure for a 1-to-K multi-target Dijkstra search.
 */
struct MultiTargetResult {
    int64_t source_osm_id{0};
    uint32_t source_internal_idx{0xFFFFFFFF};
    std::vector<MultiTargetDestinationResult> targets;
    size_t unique_targets_requested{0};
    size_t unique_targets_settled{0};
    bool all_targets_found{false};

    size_t visited_nodes{0};
    size_t relaxed_edges{0};
    double algorithm_execution_time_ms{0.0};
    double total_execution_time_ms{0.0};
};
```

### 2.2 Routing Engine Interface

```cpp
class DijkstraRouter {
public:
    // ... existing 1-to-1 and 1-to-all methods ...

    /**
     * Objective E: Multi-Target (1-to-K) shortest path with early stopping.
     */
    MultiTargetResult ShortestPathMultiTarget(
        uint32_t source_idx,
        const std::vector<uint32_t>& dest_indices,
        bool reconstruct_paths = true) const;

    /**
     * Objective E convenience: Multi-Target (1-to-K) shortest path by OSM IDs.
     */
    MultiTargetResult ShortestPathMultiTargetOsm(
        int64_t source_osm_id,
        const std::vector<int64_t>& dest_osm_ids,
        bool reconstruct_paths = true) const;
};
```

---

## 3. Algorithm Implementation & Semantics

### 3.1 Algorithm Flow (`cpp_engine/src/Dijkstra.cpp`)

1. **Source Validation:**
   - Index interface: Throws `std::out_of_range` if `source_idx >= graph_.NodeCount()`.
   - OSM interface: Throws `std::out_of_range` if `source_osm_id` is not present in `graph_`.

2. **Target Deduplication & Slot Mapping:**
   - Allocates `res.targets` with size equal to `dest_indices.size()`.
   - Maintains a fast dense byte array `target_status` of size $V = 59,334$ (59.3 KB):
     - `0`: Not a target.
     - `1`: Target registered (unsettled).
     - `2`: Target finalized/settled.
   - Preserves caller request order and maps duplicate requests to identical unique node indices using `std::unordered_map<uint32_t, std::vector<size_t>> target_slots`.
   - Out-of-range target indices or unknown OSM IDs are initialized with `found=false`, `dist=INF`, and are excluded from `unique_targets_requested`.

3. **Vacuous & Trivial Cases:**
   - If `dest_indices.empty()`: Returns immediately with `unique_targets_requested=0`, `unique_targets_settled=0`, and `all_targets_found=true` (vacuous success).
   - If all target indices are invalid: Returns immediately with `all_targets_found=false`.

4. **Min-Priority Queue Dijkstra:**
   - Standard min-heap `std::priority_queue<PQElement, std::vector<PQElement>, std::greater<PQElement>>`.
   - `dist[source_idx] = 0.0`.
   - Priority queue stores pairs `(distance, node_idx)`.
   - Stale entry rejection: `if (d > dist[u]) continue;`.
   - On pop with finalized distance:
     ```cpp
     if (target_status[u] == 1) {
         target_status[u] = 2; // Settled
         ++res.unique_targets_settled;
         --targets_remaining;
         if (targets_remaining == 0) {
             break; // Early termination: all reachable requested targets settled!
         }
     }
     ```
   - Outgoing edge relaxation: Relaxes edges in `graph_.GetOutgoingEdges(u)` and pushes candidate improvements.

5. **Self-Loop & Source in Target Query:**
   - If `source_idx` is requested as a target, it is popped first with $d = 0.0$.
   - Marked settled at distance $0.0$. If only source was requested (or `[s, s, s]`), terminates immediately with 1 visited node and 0 relaxed edges.

6. **Unreachable Destinations:**
   - If some requested targets are in disconnected components or unreachable due to one-way restrictions, the priority queue empties before `targets_remaining == 0`.
   - The loop terminates safely; unreachable targets remain `found=false`, `total_distance_meters=INF`.

7. **Path Reconstruction:**
   - Reconstructs paths only for unique targets that were settled (`target_status[u] == 2`).
   - Calls `ReconstructPath` once per unique target, and assigns the resulting path to all slots that requested that target.
   - If `reconstruct_paths == false`, skips backtracking and returns valid shortest distances with empty path vectors.

### 3.2 Result Semantics

| Field | Semantics |
| :--- | :--- |
| `found` | `true` if and only if a valid directed shortest path exists from source to destination. |
| `all_targets_found` | `true` if every requested target is valid and reachable. `false` if any target is invalid or unreachable. Empty input yields `true` (vacuous truth). |
| `unique_targets_requested` | Count of unique, valid graph node indices among the requested targets. |
| `unique_targets_settled` | Count of unique, valid graph node indices finalized by Dijkstra before termination. |
| `visited_nodes` | Total non-stale nodes popped from priority queue during search. |
| `relaxed_edges` | Total outgoing directed edges examined during search. |
| `algorithm_execution_time_ms` | Elapsed time for priority queue operations and edge relaxation. |
| `total_execution_time_ms` | `algorithm_execution_time_ms` plus path reconstruction time. |

---

## 4. Test Verification Results

The test suite in [`cpp_engine/tests/test_dijkstra.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/tests/test_dijkstra.cpp) was expanded from 18 to 32 tests. All 32 tests passed with zero failures.

```
====================================================
  PHASE 3.4 & 3.7 DIJKSTRA SHORTEST-PATH TEST SUITE
====================================================

Running Test1_BasicShortestPath...                                    PASSED
Running Test2_MultiplePathsSelectMinWeight...                         PASSED
Running Test3_DirectVsShorterMultiEdge...                             PASSED
Running Test4_DirectedOneWayRoute...                                  PASSED
Running Test5_ReverseDirectionUnreachable...                          PASSED
Running Test6_DisconnectedDestination...                              PASSED
Running Test7_SourceEqualsDestination...                              PASSED
Running Test8_InvalidSourceOsmId...                                   PASSED
Running Test9_InvalidDestinationOsmId...                              PASSED
Running Test10_EqualCostAlternativePaths...                           PASSED
Running Test11_LargeEdgeWeights...                                    PASSED
Running Test12_FloatingPointPrecisionDistances...                     PASSED
Running Test13_PathReconstructionCorrectness...                       PASSED
Running Test14_SingleSourceVsSinglePair...                            PASSED
Running TestCanonicalJodhpurGraphFacilityRoutes (30 pairs)...         PASSED
Running Test15_BrokenPredecessorFromIdx...                            PASSED
Running Test16_BrokenPredecessorEdgeIdx...                            PASSED
Running Test17_ValidPathUnaffectedByHardening...                      PASSED
Running Test18_MultiTarget_EmptyTargetList...                         PASSED
Running Test19_MultiTarget_SingleTargetEquivalence...                 PASSED
Running Test20_MultiTarget_CanonicalEmergencyFacilities...             PASSED
Running Test21_MultiTarget_EarlyTermination...                        PASSED
Running Test22_MultiTarget_DuplicateTargetsAndOrdering...             PASSED
Running Test23_MultiTarget_SourceAmongTargetsAndSelfLoop...           PASSED
Running Test24_MultiTarget_UnreachableAndDisconnected...             PASSED
Running Test25_MultiTarget_InvalidTargetOsmIdsAndSourceGuard...       PASSED
Running Test26_MultiTarget_PathReconstructionToggle...                PASSED
Running Test27_MultiTarget_PathTrajectoryIntegrity...                 PASSED
Running Test28_MultiTarget_ParallelEdgesAndEqualDistances...          PASSED
Running Test29_MultiTarget_StaleQueueEntries...                       PASSED
Running Test30_MultiTarget_FiftyRandomTargets...                      PASSED
Running RunMultiTargetBenchmarks...                                   PASSED

====================================================
  TEST RESULTS SUMMARY
  Passed: 32 / 32
  Failed: 0
====================================================
```

### Detailed Test Coverage

- **Test 18 (Empty Target List):** Validates empty result, zero visited nodes, `all_targets_found=true` for both index and OSM APIs.
- **Test 19 (Single Target Equivalence):** Confirms distance and path bitwise agreement with `ShortestPath(s, d)`.
- **Test 20 (Canonical Emergency Facilities):** Verifies routes from AIIMS Jodhpur to MDM, Mathura Das Mathur, Basni, Sojati Gate, and Paota Circle against single-pair Dijkstra within $10^{-6}\text{ m}$.
- **Test 21 (Early Termination):** Demonstrates that searching for 3 nearby targets visits only 3 nodes vs 58,768 for full search (>99.99% graph pruning).
- **Test 22 (Duplicate Targets & Ordering):** Verifies non-trivial ordering `[3, 1, 3, 2, 1]` preserves slots and duplicates have identical reconstructed paths.
- **Test 23 (Source Among Targets & Self-Loop):** Confirms `[2, 0, 1]` resolves node 0 at $D=0.0$; `[0, 0, 0]` terminates immediately with 1 visited node, 0 relaxed edges.
- **Test 24 (Unreachable Destinations):** Confirms unreachable targets across disconnected components return `found=false`, `dist=INF`, `all_targets_found=false`.
- **Test 25 (Invalid OSM IDs & Source Guard):** Confirms invalid OSM IDs (`-9999`, `88888`) preserve IDs and return `found=false` while valid targets succeed. Invalid source throws `std::out_of_range`.
- **Test 26 (Path Reconstruction Toggle):** Verifies `reconstruct_paths=false` produces valid distances with empty path structures and zero reconstruction latency.
- **Test 27 (Path Trajectory Integrity):** Runs `VerifyPathIntegrity` on multi-target routes to canonical facilities; confirms continuous directed edges and distance equality.
- **Test 28 (Parallel Edges & Equal Cost):** Confirms shorter parallel edge is selected and multiple targets at equal distances are both settled.
- **Test 29 (Stale Queue Entries):** Confirms stale entries do not corrupt settled targets.
- **Test 30 (50 Random Targets):** Selects 50 deterministic nodes across Giant SCC and cross-checks all 50 distances against `ShortestPathToAll` with 0 mismatches.

---

## 5. Benchmark Methodology & Performance Analysis

### 5.1 Benchmark Setup
- **Platform:** Windows 11, MSYS2 UCRT64 GCC 16.2.0, `-O3 -Wall -Wextra -pedantic`.
- **Graph:** Canonical Jodhpur OSM network (59,334 nodes, 129,778 directed edges).
- **Source:** AIIMS Jodhpur (`8520698362`).
- **Iterations:** 5 warm-up iterations, 30 timed measurement iterations per scenario.
- **Targets:** Deterministic distributed nodes across the Giant SCC.

### 5.2 Benchmark Results (30 Iterations per Scenario)

| Scenario ($K$) | Routing Method | Avg Latency (ms) | Median (ms) | p95 (ms) | Visited Nodes | Relaxed Edges | Speedup vs 1-to-1 | Speedup vs All |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **$K = 2$** | Repeated 1-to-1 | 26.429 | 27.786 | 35.684 | 106,302 | 232,994 | 1.000x | 0.635x |
| | ShortestPathToAll | 16.782 | 18.923 | 22.077 | 58,768 | 128,829 | 1.575x | 1.000x |
| | **Multi-Target** | **16.722** | **16.814** | **23.933** | **58,631** | **128,591** | **1.581x** | **1.004x** |
| **$K = 6$** | Repeated 1-to-1 | 63.158 | 57.983 | 94.871 | 245,085 | 538,353 | 1.000x | 0.224x |
| | ShortestPathToAll | 14.173 | 13.321 | 20.169 | 58,768 | 128,829 | 4.456x | 1.000x |
| | **Multi-Target** | **15.897** | **14.713** | **22.873** | **58,631** | **128,591** | **3.973x** | **0.892x** |
| **$K = 15$** | Repeated 1-to-1 | 101.634 | 105.312 | 146.365 | 409,626 | 906,613 | 1.000x | 0.173x |
| | ShortestPathToAll | 17.585 | 20.142 | 23.698 | 58,768 | 128,829 | 5.780x | 1.000x |
| | **Multi-Target** | **19.561** | **20.931** | **25.430** | **58,631** | **128,591** | **5.196x** | **0.899x** |
| **$K = 25$** | Repeated 1-to-1 | 177.454 | 186.331 | 212.941 | 682,838 | 1,511,008 | 1.000x | 0.100x |
| | ShortestPathToAll | 17.741 | 17.982 | 23.901 | 58,768 | 128,829 | 10.002x | 1.000x |
| | **Multi-Target** | **17.976** | **17.997** | **24.765** | **58,631** | **128,591** | **9.872x** | **0.987x** |
| **$K = 50$** | Repeated 1-to-1 | 362.978 | 369.189 | 465.817 | 1,514,327 | 3,343,678 | 1.000x | 0.048x |
| | ShortestPathToAll | 17.415 | 19.641 | 22.344 | 58,768 | 128,829 | 20.842x | 1.000x |
| | **Multi-Target** | **14.880** | **14.805** | **21.515** | **58,631** | **128,591** | **24.394x** | **1.170x** |

### 5.3 Observations & Break-Even Analysis

1. **Scalability vs Repeated 1-to-1:**
   - As $K$ increases from 2 to 50, repeated 1-to-1 latency scales linearly with $K$ from 26.4 ms to 363.0 ms because the same road network near AIIMS is repeatedly explored.
   - Multi-Target eliminates all redundant graph exploration, maintaining latency between 14.8 ms and 19.6 ms regardless of $K$, achieving **24.4x speedup** at $K=50$.

2. **Comparison with ShortestPathToAll:**
   - When targets are distributed across the entire city boundary, Multi-Target and `ShortestPathToAll` visit comparable numbers of nodes (~58,631 vs 58,768) and have roughly identical runtimes (~15–18 ms).
   - When targets are localized (e.g., Test 21 with nearby facilities within 1–2 km), Multi-Target terminates after visiting **3 to 100 nodes** in **< 0.1 ms**, whereas `ShortestPathToAll` continues to exhaust all 58,768 nodes in ~17 ms (**>150x speedup** for localized clusters).

---

## 6. Regression Verification

All 8 project test executables were executed and verified:

| Test Executable | Checks / Tests | Result |
| :--- | :--- | :--- |
| `test_graph_ingestion.exe` | 16 / 16 tests | **100% PASSED** |
| `test_graph_integrity.exe` | 2,102,456 checks | **100% PASSED** (WCC=76, SCC=206, 30/30 reachability) |
| `test_dijkstra.exe` | 32 / 32 tests | **100% PASSED** (includes multi-target & benchmarks) |
| `test_polyline.exe` | 9 / 9 tests | **100% PASSED** |
| `test_geojson.exe` | 10 / 10 tests | **100% PASSED** |
| `test_route_geometry.exe` | 14 / 14 tests | **100% PASSED** (30/30 canonical facility routes) |
| `test_boundary_validator.exe` | 11 / 11 tests | **100% PASSED** |
| `test_spatial_grid.exe` | 21 / 21 tests | **100% PASSED** |

### Canonical Dataset Checksums (Bit-for-Bit Verified)

```
SHA256: 057B9D2CB00AF9C16E8A19079587435DB09A581DA64613EBADB466C7509CA89A  jodhpur_graph.json
SHA256: C198080F4369786B980BD6D803DC30CC722DF6F72711C0BBBCB5F8A2C8BC756B  jodhpur_roads.geojson
SHA256: 83D704A1B918E5AF3342C949D3B16513AF273F7A5A923DCE98FC94AA6CF974E9  jodhpur_boundary.geojson
SHA256: DDD3A00CEBBB91A4469A2DE23ABC2AFDA424030BED14C6061C10BFF7ED39AB3A  road_network_metadata.json
```

---

## 7. Memory Overhead Analysis

- Auxiliary memory per search:
  - `dist` vector: $59,334 \times 8\text{ bytes} = 474.7\text{ KB}$
  - `predecessors` vector: $59,334 \times 8\text{ bytes} = 474.7\text{ KB}$
  - `target_status` byte vector: $59,334 \times 1\text{ byte} = 59.3\text{ KB}$
  - `target_slots` unordered map: $O(K)$ entries ($\approx 2\text{ KB}$ for $K=50$)
  - Total auxiliary memory: $\approx \mathbf{1.01\text{ MB}}$ during execution.
- Heap allocated during search is freed automatically upon return of `ShortestPathMultiTarget`.

---

## 8. Limitations & Known Risks

1. **One-Way Directed Disconnections:** If an incident or vehicle is located on a one-way outgoing road with no return path, the search will correctly explore all reachable forward nodes and mark unreachable targets as `found=false`.
2. **Reverse Dispatch Orientation:** In dispatching vehicles *to* an incident, the incident is the destination, and candidate vehicles are sources. Because the network is directed, routing from $K$ vehicles to 1 incident requires either:
   - $K$ forward searches from each vehicle; or
   - 1 backward search on the transposed (reverse) graph from the incident to all candidate vehicles.
   *(This reverse/transposed search architecture will be designed in downstream dispatch modules).*
3. **Equidistant Targets:** When multiple targets have identical distances, the algorithm settles them in the order popped from the min-heap. Because early stopping triggers only when `targets_remaining == 0`, all equidistant targets are settled before termination.

---

## 9. Conclusion & Readiness

Phase 3.7 is **100% complete, tested, benchmarked, and verified**. All requirements and acceptance criteria have been satisfied. The system is ready for independent technical audit and formal approval.

