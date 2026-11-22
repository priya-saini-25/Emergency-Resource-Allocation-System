# Phase 3.4 Final Technical Audit: Dijkstra Shortest-Path Implementation

**Project:** Emergency Resource Allocation & Response Management System  
**Audit Scope:** Sub-phase 3.4 — Dijkstra Shortest-Path Implementation  
**Auditor:** Independent Technical Auditor (Read-Only Code & Test Inspection)  
**Compiler:** GCC 16.2.0 (MSYS2 UCRT64 64-bit) — `C:\msys64\ucrt64\bin\g++.exe`  
**Language Standard:** C++17 (`-std=c++17 -Wall -Wextra -pedantic -O3`)  
**Canonical Dataset:** `cpp_engine/data/jodhpur_graph.json` (59,334 nodes, 129,778 directed edges)  
**Date:** November 2026  
**Final Audit Verdict:** **READY FOR APPROVAL**

---

## 1. Executive Summary

This report presents an independent, read-only technical audit of Phase 3.4, updated after the Final Corrections pass that resolved the SCC vertex-count discrepancy and hardened path reconstruction. All three test suites (ingestion, integrity, Dijkstra) now pass 100%. No canonical geographic datasets were modified at any point.

---

## 2. Files Inspected

| File | Lines | Role |
| :--- | :---: | :--- |
| [`cpp_engine/include/Dijkstra.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/Dijkstra.hpp) | 138 | Struct definitions: `Predecessor`, `PathSegment`, `RouteResult`, `SingleSourceResult`, `DijkstraRouter` |
| [`cpp_engine/src/Dijkstra.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/Dijkstra.cpp) | 393 | Algorithm implementation, hardened `ReconstructPath` |
| [`cpp_engine/tests/test_dijkstra.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/tests/test_dijkstra.cpp) | 686 | 18 test scenarios (14 synthetic + canonical 30-pair + 3 hardening tests) |
| [`cpp_engine/CMakeLists.txt`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/CMakeLists.txt) | 48 | Build targets |
| [`cpp_engine/include/Graph.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/Graph.hpp) | — | Adjacency list, edge records |
| [`cpp_engine/src/Graph.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/Graph.cpp) | — | Edge and node storage |

---

## 3. SCC Vertex-Count Discrepancy — Root Cause & Resolution

### 3.1 The Two Figures

| Source | Figure | Meaning |
| :--- | ---: | :--- |
| Phase 3.3 Tarjan SCC analysis | **58,658 nodes** | Giant Strongly Connected Component (nodes that can reach each other bidirectionally) |
| Phase 3.4 Dijkstra single-source settled count | **58,768 nodes** | Forward-reachable nodes from AIIMS Jodhpur via directed traversal |

### 3.2 Root Cause: SCC ≠ Forward Reachability

These two figures measure fundamentally different topological properties and are both correct:

- **Giant SCC (58,658):** The largest set of vertices such that every vertex can reach every other vertex via directed paths. Computed by Tarjan's iterative algorithm. Vertices inside the Giant SCC have both paths _into_ them and paths _out_ of them back to any other SCC member.

- **Forward-reachable set (58,768):** All vertices that can be _reached_ via directed edges starting from AIIMS Jodhpur. This includes the entire Giant SCC **plus 110 additional "downstream" vertices** that lie in smaller SCCs reachable from the Giant SCC but which cannot reciprocate (i.e., one-way dead-ends, sink components).

### 3.3 Verification

An independent Python analysis directly on the canonical dataset confirmed:

```
Giant SCC size (Tarjan):         58,658  ← bidirectionally reachable
Forward reachable from AIIMS:    58,768  ← Giant SCC + 110 downstream nodes
Downstream nodes outside SCC:       110  ← one-way reachable sinks
```

The 110 downstream nodes belong to small sink SCCs:

| Sink SCC size | Count of such SCCs | Total nodes |
| :---: | :---: | :---: |
| 1 (isolated sink) | 72 | 72 |
| 2 | 4 | 8 |
| 3 | 2 | 6 |
| 4 | 1 | 4 |
| 5 | 2 | 10 |
| 10 | 1 | 10 |
| **Total** | **82** | **110** |

### 3.4 Conclusion

**No implementation or data error exists.** The 58,658 and 58,768 figures are both accurate measurements of different graph properties. The Phase 3.4 Dijkstra settled count (58,768) is correct: single-source Dijkstra traverses forward edges and settles all 58,768 forward-reachable vertices. The Phase 3.3 SCC count (58,658) is correct: Tarjan's algorithm identifies exactly 58,658 nodes in the bidirectionally reachable Giant SCC.

All 6 emergency facilities reside inside the Giant SCC, confirming 100% mutual reachability.

---

## 4. Dijkstra Algorithmic Correctness

### 4.1 Priority Queue
`std::priority_queue<std::pair<double, uint32_t>, std::vector<...>, std::greater<...>>`. Min-heap ordered by accumulated distance; ties resolved deterministically by dense internal node index.

### 4.2 Directed Traversal
Only `graph_.GetOutgoingEdges(u)` is called — no reverse edges accessed.

### 4.3 Stale Entry Discarding
`if (d > dist[u]) continue;` — $O(1)$ early skip on popping.

### 4.4 Early Termination
Halts immediately when `u == dest_idx` is popped — the exact condition guaranteeing Dijkstra optimality under non-negative weights.

### 4.5 Strict Relaxation
`if (candidate_dist < dist[v])` — no epsilon in the relaxation test.

### 4.6 Edge-Case Handling
- $s = d$: returns `found=true`, `distance=0.0m`, 1-node path.
- Unreachable: returns `found=false`, `distance=∞`, empty path.
- Invalid OSM IDs: throw `std::out_of_range`.
- Non-finite candidates: `std::isfinite(candidate_dist)` guard skips overflow/NaN.

---

## 5. Path Reconstruction & Predecessor Edge Audit

### 5.1 Exact Edge Identification
```cpp
struct Predecessor {
    uint32_t from_idx{0xFFFFFFFF};  // source node
    uint32_t edge_idx{0xFFFFFFFF};  // exact index in adj_[from_idx]
};
```
During relaxation: `predecessors[v] = Predecessor{u, static_cast<uint32_t>(i)};`

During reconstruction: `const auto& edge = out_edges[pred.edge_idx];`

This unambiguously identifies the exact directed edge even when parallel edges connect the same node pair.

### 5.2 All Required Edge Attributes Preserved in `PathSegment`

| Attribute | Field | Type |
| :--- | :--- | :--- |
| OSM Way ID | `osm_way_id` | `int64_t` |
| Road name | `name_id` | `uint16_t` (interned pool index) |
| Road type | `road_type_id` | `uint16_t` |
| Access | `access_id` | `uint16_t` |
| One-way flag | `oneway` | `bool` |
| Distance | `distance_meters` | `double` |
| Geometry offset | `geometry_offset` | `uint32_t` |
| Geometry count | `geometry_count` | `uint16_t` |

### 5.3 Hardened Reconstruction (Phase 3.4 Final Corrections)

Five guards were added to `ReconstructPath` without changing normal-case behaviour:

| Guard | Condition Detected | Action |
| :--- | :--- | :--- |
| **Guard 1** | `curr >= n` (out-of-range node index) | Fail, log `[CPP_WARN]` |
| **Guard 2** | `steps >= max_steps` (cycle/infinite loop prevention) | Fail, log `[CPP_WARN]` |
| **Guard 3** | `pred.from_idx == 0xFFFFFFFF` or `>= n` (invalid predecessor) | Fail, log `[CPP_WARN]` |
| **Guard 4** | `pred.edge_idx >= out_edges.size()` (out-of-bounds edge) | Fail, log `[CPP_WARN]` |
| **Guard 5** | `curr != source_idx` after loop (chain didn't reach source) | Fail, log `[CPP_WARN]` |

**On failure:** `found=false`, `total_distance_meters=∞`, all path collections cleared, partial results discarded. A clean `RouteResult` failure struct is returned.

**Max-steps budget:** `max_steps = graph_.NodeCount()` (59,334). Since Dijkstra produces strictly decreasing distance predecessors, any predecessor tree derived from a valid run has acyclic chains with depth ≤ V − 1. The budget is unreachable in correct usage; it only fires on externally corrupted data.

---

## 6. Numerical Safety

| Property | Mechanism | Verified |
| :--- | :--- | :---: |
| Overflow / NaN guard | `std::isfinite(candidate_dist)` skips bad candidates | ✓ |
| Large weight accuracy | Test11: $3 \times 10^9$ m sums correctly | ✓ |
| Floating-point precision | Test12: $37.412345 + 62.587655 = 100.0$ m within $10^{-6}$ | ✓ |
| No epsilon in relaxation | Strict `<` throughout | ✓ |
| Path sum verification | $|\sum w_e - d| < 10^{-4}$ m on all 30 canonical routes | ✓ |

---

## 7. Test Execution Results

### 7.1 test_graph_ingestion — 16 / 16 PASSED
All Phase 3.2 & 3.3 ingestion and boundary validation tests pass without change.

### 7.2 test_graph_integrity — 2,102,456 / 2,102,456 invariant checks PASSED
76 WCCs (Giant: 58,877), 206 SCCs (Giant: 58,658), 30/30 BFS facility reachability. Fully unchanged.

### 7.3 test_dijkstra — 18 / 18 PASSED

| # | Test | Result |
| :-: | :--- | :---: |
| 1 | `Test1_BasicShortestPath` | PASSED |
| 2 | `Test2_MultiplePathsSelectMinWeight` | PASSED |
| 3 | `Test3_DirectVsShorterMultiEdge` | PASSED |
| 4 | `Test4_DirectedOneWayRoute` | PASSED |
| 5 | `Test5_ReverseDirectionUnreachable` | PASSED |
| 6 | `Test6_DisconnectedDestination` | PASSED |
| 7 | `Test7_SourceEqualsDestination` | PASSED |
| 8 | `Test8_InvalidSourceOsmId` | PASSED |
| 9 | `Test9_InvalidDestinationOsmId` | PASSED |
| 10 | `Test10_EqualCostAlternativePaths` | PASSED |
| 11 | `Test11_LargeEdgeWeights` | PASSED |
| 12 | `Test12_FloatingPointPrecisionDistances` | PASSED |
| 13 | `Test13_PathReconstructionCorrectness` | PASSED |
| 14 | `Test14_SingleSourceVsSinglePair` | PASSED |
| — | `TestCanonicalJodhpurGraphFacilityRoutes` (30 directed pairs) | PASSED |
| **15** | `Test15_BrokenPredecessorFromIdx` | **PASSED** |
| **16** | `Test16_BrokenPredecessorEdgeIdx` | **PASSED** |
| **17** | `Test17_ValidPathUnaffectedByHardening` | **PASSED** |

### 7.4 Canonical 30 Directed Facility Routes (Unchanged)
All 30 directed routes between the 6 emergency facilities returned identical distances and node sequences:

| Origin → Destination | Distance (m) | Hops | Settled |
| :--- | ---: | ---: | ---: |
| AIIMS → MDM Hospital | 4,612.05 | 101 | 9,867 |
| AIIMS → MGH | 6,198.77 | 182 | 20,634 |
| AIIMS → Basni | 2,768.72 | 72 | 2,228 |
| AIIMS → Sojati Gate | 7,038.62 | 221 | 26,261 |
| AIIMS → Paota Circle | 10,023.69 | 313 | 42,353 |
| MDM → AIIMS | 4,634.30 | 105 | 20,861 |
| MDM → MGH | 2,630.64 | 83 | 5,626 |
| MDM → Basni | 6,254.01 | 146 | 35,018 |
| MDM → Sojati Gate | 3,404.83 | 129 | 11,198 |
| MDM → Paota Circle | 6,455.56 | 214 | 36,483 |
| MGH → AIIMS | 6,392.10 | 185 | 37,792 |
| MGH → MDM | 2,831.42 | 93 | 9,242 |
| MGH → Basni | 7,534.93 | 186 | 45,199 |
| MGH → Sojati Gate | 1,154.05 | 53 | 515 |
| MGH → Paota Circle | 4,139.12 | 145 | 20,202 |
| Basni → AIIMS | 2,767.82 | 57 | 4,014 |
| Basni → MDM | 6,157.33 | 140 | 10,259 |
| Basni → MGH | 7,337.84 | 153 | 17,582 |
| Basni → Sojati Gate | 8,177.69 | 192 | 23,613 |
| Basni → Paota Circle | 11,162.76 | 284 | 42,463 |
| Sojati → AIIMS | 7,063.76 | 215 | 44,357 |
| Sojati → MDM | 3,382.70 | 126 | 16,473 |
| Sojati → MGH | 1,497.45 | 74 | 3,643 |
| Sojati → Basni | 8,206.59 | 216 | 51,785 |
| Sojati → Paota Circle | 3,079.25 | 96 | 13,923 |
| Paota → AIIMS | 10,055.07 | 308 | 48,485 |
| Paota → MDM | 6,424.84 | 210 | 33,875 |
| Paota → MGH | 4,488.76 | 167 | 18,657 |
| Paota → Basni | 11,149.88 | 320 | 52,005 |
| Paota → Sojati Gate | 3,100.04 | 99 | 10,624 |

Path integrity independently verified on every route: $|\sum w_e - d| < 10^{-4}\text{ m}$. Single-source vs single-pair distance agreement: 100%.

---

## 8. Performance Benchmark (Post-Correction Run)

| Metric | Value |
| :--- | :--- |
| **Single-Pair Min Latency** | 0.32 ms |
| **Single-Pair Avg Latency** | 6.46 ms |
| **Single-Pair p50 Latency** | 6.43 ms |
| **Single-Pair p95 Latency** | 15.68 ms |
| **Single-Pair Max Latency** | 16.26 ms |
| **Single-Source (1-to-All 59,334) Min** | 10.89 ms |
| **Single-Source Avg** | 11.73 ms |
| **Single-Source Max** | 13.07 ms |
| **Avg Nodes Settled per 1-to-1 Query** | 23,841 |
| **Avg Edges Relaxed per 1-to-1 Query** | 51,707 |

---

## 9. Dataset Immutability — Cryptographic Verification

| File | SHA-256 | Status |
| :--- | :--- | :---: |
| `jodhpur_graph.json` | `057B9D2CB00AF9C16E8A19079587435DB09A581DA64613EBADB466C7509CA89A` | **UNTOUCHED** |
| `jodhpur_roads.geojson` | `C198080F4369786B980BD6D803DC30CC722DF6F72711C0BBBCB5F8A2C8BC756B` | **UNTOUCHED** |
| `jodhpur_boundary.geojson` | `83D704A1B918E5AF3342C949D3B16513AF273F7A5A923DCE98FC94AA6CF974E9` | **UNTOUCHED** |
| `road_network_metadata.json` | `DDD3A00CEBBB91A4469A2DE23ABC2AFDA424030BED14C6061C10BFF7ED39AB3A` | **UNTOUCHED** |

---

## 10. Remaining Limitations

1. **Node-Based Routing:** OSM turn restrictions (e.g., `restriction=no_left_turn`) require an edge-expanded graph and are not modeled.
2. **Static Network Weights:** No live traffic, construction closures, or time-of-day speed profiles.
3. **Vehicle-Specific Access:** Ambulance exemptions (contra-flow on one-way streets) are not modeled.
4. **Multi-Target Early Stopping:** `ShortestPathToAll` settles all reachable vertices; a targeted 1-to-Many variant stopping once a subset of dispatch targets is settled is deferred to Phase 3.7.

---

## 11. Files Modified in Final Corrections Pass

| File | Change |
| :--- | :--- |
| [`cpp_engine/src/Dijkstra.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/Dijkstra.cpp) | 5-guard hardened `ReconstructPath` with failure-state return |
| [`cpp_engine/tests/test_dijkstra.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/tests/test_dijkstra.cpp) | Added Tests 15, 16, 17 for defensive reconstruction; registered in `main()` |
| [`docs/PHASE_3_4_FINAL_AUDIT.md`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/docs/PHASE_3_4_FINAL_AUDIT.md) | This document — updated with SCC resolution, hardening details, new test results |
| [`docs/PHASE_3_4_IMPLEMENTATION_REPORT.md`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/docs/PHASE_3_4_IMPLEMENTATION_REPORT.md) | Updated with corrections |

---

## 12. Final Verdict

```
================================================================================
FINAL AUDIT VERDICT: READY FOR APPROVAL
================================================================================
```

All minor gaps identified in the initial audit have been resolved:
- SCC / forward-reachability discrepancy is explained and documented (not a defect).
- `ReconstructPath` is hardened with 5 defensive guards and a clean failure-state return.
- 3 new targeted tests (Tests 15–17) validate hardening without touching production data.
- All 18 test cases pass. All 30 canonical facility routes pass. All 3 test suites pass.
- Canonical datasets are byte-for-byte identical to Phase 2 records.

Phase 3.4 is ready for approval. Phase 3.5 has not been initiated.
