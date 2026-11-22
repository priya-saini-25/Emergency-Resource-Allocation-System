# Phase 3.2 Implementation Report: Graph Data Structures & JSON Ingestion

**Project:** Emergency Resource Allocation & Response Management System  
**Phase:** Sub-phase 3.2 — Graph Data Structures & JSON Ingestion  
**Status:** Completed & Certified  
**Compiler:** GCC 16.2.0 (MSYS2 UCRT64 64-bit) — `C:\msys64\ucrt64\bin\g++.exe`  
**Language Standard:** C++17 (`-std=c++17 -Wall -Wextra -pedantic -O3`)  
**Canonical Dataset Ingested:** `cpp_engine/data/jodhpur_graph.json`  
**Date:** November 2026  

---

## 1. Executive Summary

Sub-phase 3.2 of the Emergency Resource Allocation System has been successfully completed. 
The core in-memory directed graph data structures and the dedicated JSON data loader have been fully implemented, integrated, and validated against both synthetic regression scenarios and the full canonical OpenStreetMap road network dataset for Jodhpur, Rajasthan.

All strict acceptance criteria have been satisfied:
- **Canonical Nodes Ingested:** Exactly **59,334** nodes.
- **Canonical Directed Edges Ingested:** Exactly **129,778** edges.
- **Missing Node References:** **0** (100% referential integrity).
- **Invalid Edge Weights:** **0** (all weights are finite, strictly positive, and stored as `double` in meters).
- **Facility Recoverability:** All 6 verified emergency facilities (AIIMS, MDM, MGH, Basni Fire, Sojati Gate, Paota Circle) are verified and recoverable via two-tier 64-bit OSM ID indexing.
- **Test Pass Rate:** **9 / 9 tests passed (100%)**.

---

## 2. Files Created and Modified

| File | Action | Purpose |
| :--- | :--- | :--- |
| [`cpp_engine/include/GraphTypes.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/GraphTypes.hpp) | Created | Core data structures: `GeoPoint`, `NodeRecord`, `EdgeRecord` (with `double` precision weight), road classification enum, access types, and nominal speed profiles. |
| [`cpp_engine/include/Graph.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/Graph.hpp) | Created | Graph class header: directed adjacency list, two-tier OSM-to-internal index mapping, string pooling, and query methods. |
| [`cpp_engine/src/Graph.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/Graph.cpp) | Created | Implementation of graph construction, memory reservation, duplicate rejection, and edge traversal. |
| [`cpp_engine/include/DataLoader.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/DataLoader.hpp) | Created | JSON ingestion interface with file and string buffer ingestion entry points. |
| [`cpp_engine/src/DataLoader.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/DataLoader.cpp) | Created | Implementation of JSON parser via `nlohmann/json` v3.11.3, topology validation, and strict error handling. |
| [`cpp_engine/tests/test_graph_ingestion.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/tests/test_graph_ingestion.cpp) | Created | Unit & integration test suite covering 9 automated test scenarios. |
| [`cpp_engine/CMakeLists.txt`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/CMakeLists.txt) | Modified | Added `routing_core` static library and `test_graph_ingestion` test executable target. |
| [`cpp_engine/src/main.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/main.cpp) | Modified | Suppressed unused parameter warnings for `-Wall -Wextra -pedantic` compliance. |

---

## 3. Graph Data Structures Architecture

### 3.1 Two-Tier Indexing Architecture

To achieve $O(1)$ edge traversal while preserving authentic 64-bit OpenStreetMap identifiers:
- **64-bit OSM Node IDs (`int64_t`):** Stored in `NodeRecord::osm_id` and indexed in `std::unordered_map<int64_t, uint32_t> osm_to_internal_`.
- **Dense Internal Index (`uint32_t`):** Vertices are assigned contiguous dense indices $[0, V-1]$, allowing direct indexing into contiguous memory arrays for subsequent Dijkstra priority queues and distance arrays.

### 3.2 Record Definitions

```cpp
// Coordinate pair (WGS84 EPSG:4326)
struct GeoPoint {
    double latitude{0.0};
    double longitude{0.0};
};

// Vertex Record
struct NodeRecord {
    int64_t osm_id{0};             // Authentic 64-bit OSM Node ID
    double latitude{0.0};          // Latitude (WGS84)
    double longitude{0.0};         // Longitude (WGS84)
    bool is_boundary{false};       // Boundary vertex indicator
};

// Directed Edge Record
struct EdgeRecord {
    uint32_t target_idx{0};        // Dense index of destination vertex [0, V-1]
    double distance_meters{0.0};   // Weight in meters (preserved as double)
    int64_t osm_way_id{0};         // Original OSM Way identifier
    uint16_t road_type_id{0};      // Enumerated highway classification
    uint16_t name_id{0};           // Deduplicated string pool index
    uint16_t access_id{0};         // Evaluated access classification
    bool oneway{true};             // Original directionality indicator
    uint32_t geometry_offset{0};   // Offset into shared polyline coordinate buffer
    uint16_t geometry_count{0};    // Number of coordinate pairs in polyline
};
```

### 3.3 Directed Adjacency Structure
- Outgoing connections are maintained as `std::vector<std::vector<EdgeRecord>> adj_`.
- **No Reverse Edges Synthesized:** The canonical dataset already expanded two-way roads into symmetric directed pairs. Edges are loaded strictly in their stated directed orientation.

---

## 4. JSON Ingestion & Validation Pipeline

The `DataLoader` enforces strict invariants on ingestion:
1. **File I/O Verification:** Fails gracefully with `std::runtime_error` if the dataset file is absent or inaccessible.
2. **JSON Syntax Parsing:** Catches `nlohmann::json::parse_error` and translates into descriptive diagnostic errors.
3. **Array Structure Validation:** Verifies top-level `"nodes"` and `"edges"` arrays exist.
4. **Duplicate Node ID Rejection:** Throws `std::invalid_argument` upon encountering any duplicate `int64_t` OSM Node ID.
5. **Dangling Edge Rejection:** Verifies both `from` and `to` node IDs exist in the populated node map. Throws `std::runtime_error` if either is missing.
6. **Edge Weight Validation:** Rejects any `distance_meters` that is non-finite (`!std::isfinite`), zero, or negative (`<= 0.0`).
7. **String & Geometry Pooling:** Road names are deduplicated into a centralized string pool, and intermediate geometry coordinates are appended to a contiguous `geometry_pool_` vector.

---

## 5. Build & Compilation Toolchain

Compilation was executed using MSYS2 UCRT64 GCC 16.2.0:

```powershell
$env:PATH = "C:\msys64\ucrt64\bin;" + $env:PATH
Set-Location "cpp_engine/build"
cmake -G "MinGW Makefiles" -DCMAKE_CXX_COMPILER="C:/msys64/ucrt64/bin/g++.exe" -DCMAKE_C_COMPILER="C:/msys64/ucrt64/bin/gcc.exe" -DCMAKE_MAKE_PROGRAM="C:/msys64/ucrt64/bin/mingw32-make.exe" ..
mingw32-make test_graph_ingestion engine
```

**Build Status:** Clean compilation, 0 errors, 0 warnings with `-Wall -Wextra -pedantic -O3`.

---

## 6. Automated Ingestion Test Results

Execution of `test_graph_ingestion.exe`:

```text
====================================================
  PHASE 3.2 INGESTION TEST SUITE
====================================================

Running TestSyntheticDirectedGraph...
TestSyntheticDirectedGraph: PASSED

Running TestDuplicateNodeRejection...
  (Expected exception caught: Duplicate OSM Node ID: 201)
TestDuplicateNodeRejection: PASSED

Running TestMissingSourceNodeRejection...
  (Expected exception caught: DataLoader Error: Edge at index 0 references non-existent source node ID: 9999)
TestMissingSourceNodeRejection: PASSED

Running TestMissingDestinationNodeRejection...
  (Expected exception caught: DataLoader Error: Edge at index 0 references non-existent destination node ID: 9999)
TestMissingDestinationNodeRejection: PASSED

Running TestInvalidZeroWeightRejection...
  (Expected exception caught: DataLoader Error: Edge at index 0 has invalid weight: 0.000000. Weights must be finite and strictly positive (> 0.0).)
TestInvalidZeroWeightRejection: PASSED

Running TestInvalidNegativeWeightRejection...
  (Expected exception caught: DataLoader Error: Edge at index 0 has invalid weight: -50.250000. Weights must be finite and strictly positive (> 0.0).)
TestInvalidNegativeWeightRejection: PASSED

Running TestMissingFileHandling...
  (Expected exception caught: DataLoader Error: Cannot open file: non_existent_file_xyz123.json)
TestMissingFileHandling: PASSED

Running TestMalformedJsonHandling...
  (Expected exception caught: DataLoader Error: JSON syntax parse error in string buffer: [json.exception.parse_error.101] parse error at line 1, column 4: syntax error while parsing object key - invalid literal; last read: '{ no'; expected string literal)
TestMalformedJsonHandling: PASSED

Running TestFullJodhpurGraphIngestion on canonical dataset...
[CPP_INFO] Ingestion complete from file: data/jodhpur_graph.json
[CPP_INFO]   Nodes loaded: 59334
[CPP_INFO]   Edges loaded: 129778
[CPP_INFO]   Road names interned: 118
[CPP_INFO]   Wall-clock time: 2355.43 ms
Ingested nodes: 59334
Ingested edges: 129778
Unique road names: 118
Load wall-clock time: 2355.43 ms
TestFullJodhpurGraphIngestion: PASSED (All acceptance criteria met)

====================================================
  TEST RESULTS SUMMARY
  Passed: 9 / 9
  Failed: 0
====================================================
```

### Detailed Scenario Validation Matrix

| # | Test Scenario | Verified Invariant | Result |
| :---: | :--- | :--- | :---: |
| 1 | `TestSyntheticDirectedGraph` | Synthetic 4-node topology, directed edges, 1-way preservation, metadata interning, OSM ID recovery. | **PASSED** |
| 2 | `TestDuplicateNodeRejection` | Reject duplicate OSM node IDs with descriptive exception. | **PASSED** |
| 3 | `TestMissingSourceNodeRejection` | Reject edge referencing non-existent source vertex. | **PASSED** |
| 4 | `TestMissingDestinationNodeRejection` | Reject edge referencing non-existent destination vertex. | **PASSED** |
| 5 | `TestInvalidZeroWeightRejection` | Reject edge with `distance_meters == 0.0`. | **PASSED** |
| 6 | `TestInvalidNegativeWeightRejection` | Reject edge with `distance_meters < 0.0`. | **PASSED** |
| 7 | `TestMissingFileHandling` | Reject non-existent file path gracefully. | **PASSED** |
| 8 | `TestMalformedJsonHandling` | Reject corrupted/malformed JSON string syntax. | **PASSED** |
| 9 | `TestFullJodhpurGraphIngestion` | Load authentic `jodhpur_graph.json`: exactly 59,334 nodes, 129,778 edges, 0 errors, all 6 emergency facilities recoverable. | **PASSED** |

---

## 7. Canonical Facility Recoverability Verification

During `TestFullJodhpurGraphIngestion`, all 6 canonical emergency facility nodes were verified:

| Facility Name | Authentic OSM Node ID | Internal Dense Index | Presence Verified | ID Bidirectional Recovery |
| :--- | :---: | :---: | :---: | :---: |
| **AIIMS Jodhpur** | `8520698362` | Verified | **YES** | Verified ($8520698362 \to \text{idx} \to 8520698362$) |
| **MDM Hospital** | `5321319416` | Verified | **YES** | Verified ($5321319416 \to \text{idx} \to 5321319416$) |
| **Mahatma Gandhi Hospital** | `8499684813` | Verified | **YES** | Verified ($8499684813 \to \text{idx} \to 8499684813$) |
| **Basni Fire Station** | `2694302020` | Verified | **YES** | Verified ($2694302020 \to \text{idx} \to 2694302020$) |
| **Sojati Gate** | `2688566058` | Verified | **YES** | Verified ($2688566058 \to \text{idx} \to 2688566058$) |
| **Paota Circle** | `3773158752` | Verified | **YES** | Verified ($3773158752 \to \text{idx} \to 3773158752$) |

---

## 8. Dataset Integrity Confirmation

- `cpp_engine/data/jodhpur_graph.json` has remained completely **unmodified and read-only**.
- `cpp_engine/data/jodhpur_roads.geojson`, `jodhpur_boundary.geojson`, and `road_network_metadata.json` remain untouched.
- No binary cache (`.bin`) was created.
- No Dijkstra, SpatialGrid, or CLI IPC code has been implemented prematurely.

---

## 9. Conclusion & Next Step

Sub-phase 3.2 is fully verified and complete. 

In strict accordance with the stop condition, execution has halted. We await user review and approval before proceeding to **Sub-Phase 3.3: Graph Integrity Validation and Memory Measurement**.

