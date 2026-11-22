# Phase 3.3 Implementation Report: Graph Integrity Validation & Memory Measurement

**Project:** Emergency Resource Allocation & Response Management System  
**Phase:** Sub-phase 3.3 — Graph Integrity Validation & Memory Measurement  
**Status:** Completed & Certified  
**Compiler:** GCC 16.2.0 (MSYS2 UCRT64 64-bit) — `C:\msys64\ucrt64\bin\g++.exe`  
**Language Standard:** C++17 (`-std=c++17 -Wall -Wextra -pedantic -O3`)  
**Canonical Dataset Ingested:** `cpp_engine/data/jodhpur_graph.json`  
**Date:** November 2026  

---

## 1. Phase Objective

The objective of Sub-phase 3.3 is to verify the structural integrity of the fully ingested Jodhpur road graph, execute topological connectivity analysis (Weakly and Strongly Connected Components), verify connectivity across the six canonical emergency facilities, and measure empirical resident process memory on Windows using the Win32 API.

In strict adherence to project guidelines:
- Canonical datasets remained completely read-only and unmodified.
- No Dijkstra, SpatialGrid, binary caching, or CLI IPC components were implemented.
- Empirical runtime measurements were recorded directly and clearly distinguished from theoretical analytical estimates.

---

## 2. Files Inspected, Created, or Modified

### Files Inspected
- `cpp_engine/include/GraphTypes.hpp`
- `cpp_engine/include/Graph.hpp`
- `cpp_engine/src/Graph.cpp`
- `cpp_engine/include/DataLoader.hpp`
- `cpp_engine/src/DataLoader.cpp`
- `cpp_engine/data/jodhpur_graph.json`
- `cpp_engine/data/road_network_metadata.json`

### Files Created or Modified
| File | Action | Purpose |
| :--- | :--- | :--- |
| [`cpp_engine/include/MemoryProfiler.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/MemoryProfiler.hpp) | Created | Platform memory profiling capturing Working Set (RSS), Peak Working Set, and Private Bytes via `GetProcessMemoryInfo`. |
| [`cpp_engine/include/GraphIntegrity.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/GraphIntegrity.hpp) | Created | Structural integrity validator definitions and metric analysis structs. |
| [`cpp_engine/src/GraphIntegrity.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/GraphIntegrity.cpp) | Created | Implementation of 2,102,456 invariant assertions and degree distribution analysis. |
| [`cpp_engine/include/GraphConnectivity.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/GraphConnectivity.hpp) | Created | Interface for WCC (DSU), SCC (Tarjan), and 30-pair facility directed reachability. |
| [`cpp_engine/src/GraphConnectivity.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/GraphConnectivity.cpp) | Created | Implementation of DSU WCC, iterative stack-safe Tarjan's SCC, and directed BFS. |
| [`cpp_engine/src/DataLoader.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/DataLoader.cpp) | Modified | Added explicit geographic coordinate bounding checks ($[-90, 90]$ and $[-180, 180]$) for nodes and geometry points. |
| [`cpp_engine/src/Graph.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/Graph.cpp) | Modified | Added coordinate finiteness and range assertions in `Graph::AddNode`. |
| [`cpp_engine/tests/test_graph_ingestion.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/tests/test_graph_ingestion.cpp) | Modified | Preserved all 9 Phase 3.2 tests; added 7 new dedicated validation tests (16 tests total). |
| [`cpp_engine/tests/test_graph_integrity.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/tests/test_graph_integrity.cpp) | Created | Full canonical graph validation, connectivity audit, and empirical memory profiling runner. |
| [`cpp_engine/CMakeLists.txt`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/CMakeLists.txt) | Modified | Linked `psapi` on Windows; added `test_graph_integrity` executable target. |

---

## 3. Structural Integrity Validation Results

The structural integrity validator (`GraphIntegrityValidator::Validate`) executed an exhaustive check across all nodes, directed edges, adjacency buckets, and geometry buffers.

### Summary Metrics
- **Total Invariant Checks Evaluated:** **2,102,456 checks**
- **Passed Checks:** **2,102,456 (100.0%)**
- **Failed Checks:** **0**
- **Execution Time:** **603.04 ms – 745.93 ms**
- **Structural Integrity Verdict:** **ALL INVARIANTS SATISFIED**

### Detailed Invariant Verification

| Component | Invariant Description | Count / Range | Status |
| :--- | :--- | :---: | :---: |
| **Node Count** | Canonical vertex count | Exactly 59,334 | **PASSED** |
| **OSM ID Uniqueness** | Distinct 64-bit OSM Node IDs | 59,334 / 59,334 | **PASSED** |
| **Index Bounding** | Dense internal indices $\in [0, V-1]$ | $[0, 59333]$ | **PASSED** |
| **Two-Tier Bijection** | Symmetric $OSM \leftrightarrow Index$ mapping | 100% bijective | **PASSED** |
| **Coordinate Bounds** | Latitudes $\in [-90, 90]^\circ\text{ N}$ | $[26.206177, 26.353972]^\circ\text{ N}$ | **PASSED** |
| **Coordinate Bounds** | Longitudes $\in [-180, 180]^\circ\text{ E}$ | $[72.948919, 73.089443]^\circ\text{ E}$ | **PASSED** |
| **Coordinate Finiteness** | Zero NaN or $\pm\infty$ coordinates | 0 non-finite | **PASSED** |
| **Edge Count** | Canonical directed edge count | Exactly 129,778 | **PASSED** |
| **Endpoint Existence** | Valid source & target indices | 129,778 / 129,778 | **PASSED** |
| **Weight Positivity** | Weights finite and strictly $> 0.0$ | $[0.15\text{ m}, 623.05\text{ m}]$ | **PASSED** |
| **Metadata References** | Valid road type, access, and name IDs | 100% in bounds | **PASSED** |
| **Geometry Buffer** | Geometry offsets & counts within pool | 259,556 points | **PASSED** |
| **Geometry Points / Edge**| Minimum 2 intermediate coordinates | $\ge 2$ points on all edges | **PASSED** |
| **Adjacency Buckets** | 1 bucket per node; sum equals edge count | $59,334\text{ buckets} = 129,778\text{ edges}$ | **PASSED** |
| **Reverse Edges** | No synthetic reverse edges introduced | 0 synthetic reversals | **PASSED** |

---

## 4. Graph Topology & Degree Distribution

```text
Bounding Box: Lat [26.206177, 26.353972] N, Lon [72.948919, 73.089443] E
Boundary Nodes: 521
In-Degree Distribution:  Min: 0  | Avg: 2.19 | Max: 6
Out-Degree Distribution: Min: 0  | Avg: 2.19 | Max: 6

Special Vertices:
  - Source Nodes (in=0, out>0):     14
  - Sink Nodes   (in>0, out=0):     16
  - Isolated Vertices (in=0, out=0): 0

Topological Anomalies:
  - Self-Loops (u == v):            0
  - Parallel Directed Edges:        0

Directionality & Length Metrics:
  - Oneway Directed Edges:          7,626
  - Bidirectional Directed Pairs:   122,152 (61,076 physical segments)
  - Total Directed Edge Sum:        4,192.11 km
  - Min Edge Distance:              0.15 meters
  - Max Edge Distance:              623.05 meters
  - Avg Edge Distance:              32.30 meters
```

---

## 5. Connectivity Analysis Results (WCC & SCC)

Connectivity analysis was performed using:
- **Weakly Connected Components (WCC):** Disjoint Set Union (DSU) on undirected edge projections.
- **Strongly Connected Components (SCC):** Iterative stack-safe Tarjan's algorithm on directed edges.

### Comparison Against Phase 2 Audit Reference

| Metric | Phase 2 Audit Reference | Phase 3.3 C++ Engine Measured | Status |
| :--- | :---: | :---: | :---: |
| **Total WCC Components** | **76** | **76** | **EXACT MATCH** |
| **Largest WCC Node Count** | **58,877** | **58,877** | **EXACT MATCH** |
| **Largest WCC Percentage** | **99.23%** | **99.23%** | **EXACT MATCH** |
| **Total SCC Components** | **206** | **206** | **EXACT MATCH** |
| **Largest SCC Node Count** | **58,658** | **58,658** | **EXACT MATCH** |
| **Largest SCC Percentage** | **98.86%** | **98.86%** | **EXACT MATCH** |

The 75 minor WCC components and 205 minor SCC components comprise small disconnected clusters or cul-de-sacs at the outer perimeter of Jodhpur. In accordance with guidelines, these disconnected components are preserved for diagnostic auditability and not deleted.

---

## 6. Emergency Facility Connectivity & 30-Pair Reachability

All six verified emergency facility locations were evaluated for giant component membership and directed reachability:

### Facility Component Membership

| Facility Name | OSM Node ID | Internal Dense Index | WCC ID | SCC ID | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **AIIMS Jodhpur** | `8520698362` | `43232` | `#0` | `#0` | **Giant WCC & Giant SCC** |
| **MDM Hospital** | `5321319416` | `26574` | `#0` | `#0` | **Giant WCC & Giant SCC** |
| **Mathura Das Mathur Hospital (MGH)** | `8499684813` | `43063` | `#0` | `#0` | **Giant WCC & Giant SCC** |
| **Basni Fire Station** | `2694302020` | `11604` | `#0` | `#0` | **Giant WCC & Giant SCC** |
| **Sojati Gate** | `2688566058` | `11545` | `#0` | `#0` | **Giant WCC & Giant SCC** |
| **Paota Circle** | `3773158752` | `19448` | `#0` | `#0` | **Giant WCC & Giant SCC** |

### 30 Directed Pair Reachability Matrix

Directed BFS was executed from each facility to evaluate reachability across all $6 \times 5 = 30$ ordered source-destination pairs:

- **Total Directed Pairs Evaluated:** 30
- **Reachable Directed Pairs:** **30 / 30 (100.0%)**
- **BFS Hop Range:** Minimum 21 hops (Sojati Gate $\to$ Paota Circle) to maximum 89 hops (Paota Circle $\to$ AIIMS Jodhpur).
- **Result:** **100% Reachability Confirmed**. All emergency facilities can navigate to and from every other facility in the network.
- *Note:* BFS was employed strictly to verify topological reachability, not to report shortest physical road distances (which is reserved for Phase 3.4 Dijkstra).

---

## 7. Actual Empirical Memory Measurements

Process memory usage was captured using Windows API `GetProcessMemoryInfo` (`PROCESS_MEMORY_COUNTERS_EX`) under Windows 11 64-bit:

```text
+-----------------------------------------------------------------------------------------+
| EMPIRICAL PROCESS MEMORY PROFILE (WINDOWS API)                                          |
+-----------------------------------------------------------------------------------------+
| Stage                                      | Working Set (RSS) | Private Usage | Peak RSS |
|--------------------------------------------|-------------------|---------------|----------|
| 1. Process Baseline (Before Load)          |          5.09 MB  |       0.98 MB |  5.09 MB |
| 2. Peak During JSON Parsing (Transient)   |        217.77 MB  |     210.45 MB |217.77 MB |
| 3. Post-Ingestion (After JSON DOM Release) |         23.29 MB  |      20.11 MB |217.77 MB |
| 4. Post-Structural Integrity Validation    |         23.20 MB  |      19.32 MB |217.77 MB |
| 5. Post-Connectivity Analysis (WCC/SCC/BFS)|         24.07 MB  |      20.04 MB |217.77 MB |
+-----------------------------------------------------------------------------------------+
| Net Memory Consumed by C++ Graph Object:   |         18.20 MB  |      19.13 MB |          |
| Initial Theoretical Analytical Lower Bound:|         14.30 MB  |               |          |
| Maximum Allowed Phase 3 Memory Budget:     |        150.00 MB  |               |          |
| Memory Headroom Remaining:                 |         83.95%    |               |          |
+-----------------------------------------------------------------------------------------+
```

### Measurement Analysis & Limitations:
1. **Transient DOM Peak:** Ingestion of the 36.67 MB JSON file creates an `nlohmann::json` DOM tree peaking at 217.77 MB heap memory.
2. **Immediate DOM Deallocation:** As soon as `IngestParsedJson` returns, the JSON DOM is destructed. The process working set drops immediately from 217.77 MB to **23.29 MB**.
3. **Net Graph Storage:** The steady-state memory of the C++ `Graph` instance (59,334 vertices, 129,778 edges, 259,556 geometry coordinates, and index maps) is **18.20 MB** Working Set (19.13 MB Private Bytes).
4. **Comparison to Analytical Estimate:** The measured 18.20 MB compares favorably to the theoretical lower-bound estimate of ~14.3 MB (the variance of ~3.9 MB is accounted for by MSYS2 UCRT heap bucket allocator overhead and bucket metadata in `std::unordered_map`).
5. **Headroom:** The steady-state footprint of ~24 MB is well within the 150 MB ceiling, providing 84% margin.

---

## 8. Performance Measurements

Execution times were recorded with `std::chrono::steady_clock` over three consecutive iterations on the full canonical graph:

| Operation | Min Latency | Average Latency | Max Latency | Throughput |
| :--- | :---: | :---: | :---: | :---: |
| **JSON Ingestion & Parsing** | 1,774.23 ms | 2,004.47 ms | 2,289.42 ms | ~30,000 nodes/sec |
| **Structural Integrity Validation** | 603.04 ms | 647.91 ms | 708.31 ms | ~3,480,000 checks/sec |
| **WCC Analysis (DSU)** | 3.82 ms | 4.63 ms | 5.26 ms | ~28,000,000 edges/sec |
| **Tarjan's SCC Analysis** | 7.72 ms | 9.81 ms | 11.90 ms | ~13,200,000 edges/sec |
| **Facility Directed Reachability (BFS)** | 17.71 ms | 21.72 ms | 28.11 ms | 30 directed pairs |
| **Total Phase 3.3 Diagnostic Suite** | **2,406.52 ms** | **2,688.54 ms** | **3,042.00 ms** | Full network audit |

---

## 9. Automated Test Suite Results

Both test binaries were compiled and executed with MSYS2 UCRT64 GCC 16.2.0:

### 1. Ingestion & Boundary Test Suite (`test_graph_ingestion.exe`)
All 16 automated tests passed:
```text
====================================================
  PHASE 3.2 & 3.3 INGESTION & INTEGRITY TEST SUITE
====================================================

Running TestSyntheticDirectedGraph...              PASSED
Running TestDuplicateNodeRejection...             PASSED (Duplicate OSM ID caught)
Running TestMissingSourceNodeRejection...         PASSED (Missing source reference caught)
Running TestMissingDestinationNodeRejection...    PASSED (Missing destination reference caught)
Running TestInvalidZeroWeightRejection...         PASSED (Zero weight caught)
Running TestInvalidNegativeWeightRejection...     PASSED (Negative weight caught)
Running TestMissingFileHandling...                PASSED (File not found handled)
Running TestMalformedJsonHandling...              PASSED (Syntax parse error handled)
Running TestFullJodhpurGraphIngestion...          PASSED (59,334 nodes, 129,778 edges loaded)
Running TestCoordinateNanAndInfiniteLatitude...   PASSED (NaN, +inf, -inf latitude caught)
Running TestCoordinateNanAndInfiniteLongitude...  PASSED (NaN, +inf, -inf longitude caught)
Running TestCoordinateLatitudeRange...            PASSED (lat < -90 and lat > 90 caught)
Running TestCoordinateLongitudeRange...           PASSED (lon < -180 and lon > 180 caught)
Running TestEdgeWeightNanAndInfinity...           PASSED (NaN, +inf, -inf weights caught)
Running TestInvalidTargetIndexRejection...        PASSED (Out of bounds node index caught)
Running TestStructuralIntegrityValidator...       PASSED (Synthetic integrity validated)

====================================================
  TEST RESULTS SUMMARY: Passed: 16 / 16 | Failed: 0
====================================================
```

### 2. Full Canonical Graph Integrity Audit (`test_graph_integrity.exe`)
- 2,102,456 invariant assertions evaluated: **100% Passed**.
- Exact WCC match (76 components, 58,877 giant size): **100% Passed**.
- Exact SCC match (206 components, 58,658 giant size): **100% Passed**.
- All 6 emergency facilities in Giant SCC & Giant WCC: **100% Passed**.
- 30 / 30 directed facility pairs reachable: **100% Passed**.

---

## 10. Build Commands & Toolchain Certification

Compilation was executed via the project CMake build system:

```powershell
$env:PATH = "C:\msys64\ucrt64\bin;" + $env:PATH
Set-Location "cpp_engine/build"
cmake -G "MinGW Makefiles" -DCMAKE_CXX_COMPILER="C:/msys64/ucrt64/bin/g++.exe" -DCMAKE_C_COMPILER="C:/msys64/ucrt64/bin/gcc.exe" -DCMAKE_MAKE_PROGRAM="C:/msys64/ucrt64/bin/mingw32-make.exe" ..
mingw32-make test_graph_ingestion test_graph_integrity engine
```

- **Compiler:** `g++.exe` (MSYS2 project) 16.2.0 (UCRT64 64-bit)
- **Standard:** `-std=c++17 -Wall -Wextra -pedantic -O3`
- **Compiler Flags:** Zero errors, zero warnings.
- **Linked Libraries:** `-lpsapi` (Windows process memory queries).

---

## 11. Known Limitations & Scope Boundaries

1. **Static Topological Reachability:** The 30-pair facility reachability confirms existence of directed paths, but does not provide physical distance metrics or travel times (reserved for Phase 3.4 Dijkstra).
2. **Transient Parsing Memory:** While the steady-state graph occupies only 18.2 MB, parsing the 36.67 MB JSON DOM transiently peaks at 217.7 MB before deallocation. Binary caching (deferred to post-Phase 3) will eliminate this transient peak.
3. **Turn Restrictions:** The graph strictly respects directed edges and one-way streets, but does not enforce complex multi-edge turn restrictions (e.g. `no_left_turn` relations).

---

## 12. Conclusion & Next Step

**Phase 3.3 is complete, audited, and fully certified.**

All acceptance criteria have been achieved:
- 2,102,456 structural checks passed with zero defects.
- Coordinate range validation ($[-90, 90]$ and $[-180, 180]$) implemented and tested.
- `NaN` and $\pm\infty$ edge weights and coordinates strictly rejected and tested.
- WCC (76) and SCC (206) metrics identically match Phase 2 reference values.
- All 6 emergency facilities verified connected and mutually reachable across all 30 directed pairs.
- Actual Windows process memory measured: 18.2 MB net graph footprint (84% headroom under 150 MB budget).
- Canonical geographic datasets remain 100% unmodified.

### Final Stop Condition

In strict accordance with instructions:
- Execution is halted.
- No Phase 3.4 code or Dijkstra routing has been implemented.
- We await your review and approval before proceeding to **Sub-Phase 3.4: Dijkstra Shortest-Path Implementation**.

