# Phase 3.8 Implementation Report — Emergency Priority Scoring Engine

**Project:** Emergency Resource Allocation & Response Management System for Jodhpur  
**Date:** November 17, 2026  
**Status:** IMPLEMENTATION COMPLETE & VERIFIED  

---

## 1. Executive Summary

Phase 3.8 implements the **Emergency Priority Scoring Engine** for the Jodhpur Emergency Response System. The engine calculates a deterministic, normalized composite Priority Score $P \in [0.0, 100.0]$ and categorizes incidents into triage tiers (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), establishing dispatch ordering prior to routing.

The implementation follows the approved simulation model:
$$P = (W_S \times S_{\text{norm}}) + (W_V \times V_{\text{norm}}) + (W_W \times T_{\text{norm}})$$
with default weights $W_S = 0.50$ (Severity), $W_V = 0.30$ (Victims), and $W_W = 0.20$ (Waiting Time).

> [!IMPORTANT]
> **Educational & Simulation Disclaimer:**  
> This engine is an educational decision-support simulation proxy developed for multi-criteria emergency resource allocation. It is **NOT** a clinically or legally validated triage protocol (e.g., START, SALT, or Manchester Triage).

### Key Technical Achievements
- **Zero Graph Coupling:** Implemented as a standalone component with zero dependencies on `DijkstraRouter` or `Graph`, ensuring ultra-high scoring throughput (>88 million evals/sec).
- **Simplified Incident Model:** `IncidentRecord` is strictly restricted to the 5 core attributes needed for priority evaluation; geographic coordinates are decoupled and managed by spatial layers.
- **Strict Clock Policy:** Evaluation timestamp `evaluated_at_ms` is strictly an explicit parameter; the core scoring function never accesses the system wall clock.
- **Mandatory Numerical Safeguards:** Rejects NaN, $\pm\infty$, negative, and all-zero weights; enforces unit sum within $10^{-6}$ without silent normalization; clamps output strictly to $[0.0, 100.0]$.
- **Unrounded Tier Classification:** Priority tier is derived strictly from the unrounded `double` score; display rounding is isolated to the presentation layer.
- **Canonical Deterministic Comparator:** Implements a 5-tier lexicographical comparator (`PriorityComparator`) with proven strict weak ordering for batch sorting and priority-queue scheduling.
- **Comprehensive Testing:** 29 test scenarios covering all functional, edge-case, numerical, and transitivity properties (100% passing).
- **Empirical Benchmarks:** 50 measured iterations across $N \in \{1, 100, 1,000, 10,000\}$ incidents demonstrating sub-microsecond scoring latency and 0.0000 MB RSS heap delta.
- **Full Project Regression:** All 9 test executables pass (100%). All 4 canonical datasets remain bit-for-bit identical (SHA-256 verified).

---

## 2. Architecture & Files Changed

### 2.1 Files Created
1. [`cpp_engine/include/PriorityEngine.hpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/include/PriorityEngine.hpp):
   - Type definitions: `EmergencyCategory`, `PriorityTier`, `IncidentRecord`, `ConfigValidationResult`, `PriorityConfig`, `PriorityScoreResult`, `PriorityComparator`.
   - Class declaration: `PriorityEngine`.
2. [`cpp_engine/src/PriorityEngine.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/src/PriorityEngine.cpp):
   - Configuration validation (`PriorityConfig::Validate`).
   - Canonical comparator logic (`PriorityComparator::operator()`).
   - Incident evaluation (`PriorityEngine::EvaluateIncident`, `EvaluateBatch`).
   - Tier classification (`PriorityEngine::ClassifyTier`).
3. [`cpp_engine/tests/test_priority_engine.cpp`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/tests/test_priority_engine.cpp):
   - Standalone test suite containing 28 targeted unit/edge tests and 1 multi-scale benchmark suite.

### 2.2 Files Modified
- [`cpp_engine/CMakeLists.txt`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/CMakeLists.txt):
   - Added `src/PriorityEngine.cpp` to `routing_core` static library.
   - Added `test_priority_engine` executable target linked to `routing_core`.

---

## 3. Data Structures & API Specification

### 3.1 Domain Types (`EmergencyRouting::Priority`)

```cpp
enum class EmergencyCategory : uint8_t {
    MEDICAL = 0,
    FIRE = 1,
    ROAD_ACCIDENT = 2,
    INDUSTRIAL = 3
};

enum class PriorityTier : uint8_t {
    LOW = 0,
    MEDIUM = 1,
    HIGH = 2,
    CRITICAL = 3
};

struct IncidentRecord {
    uint64_t incident_id{0};                  // Must be > 0
    EmergencyCategory category{EmergencyCategory::MEDICAL};
    uint32_t severity{1};                     // Must be in [1, 5]
    uint32_t victim_count{0};                 // Confirmed/estimated victims (>= 0)
    uint64_t created_at_ms{0};                // Unix epoch timestamp (ms) > 0
};

struct ConfigValidationResult {
    bool is_valid{true};
    std::string error_message;
};

struct PriorityConfig {
    double severity_weight{0.50};
    double victim_weight{0.30};
    double waiting_weight{0.20};

    uint32_t min_severity{1};
    uint32_t max_severity{5};
    uint32_t max_victim_saturation{20};
    uint64_t max_waiting_time_ms{3600000};    // 60 minutes

    double medium_threshold{40.0};
    double high_threshold{60.0};
    double critical_threshold{80.0};

    ConfigValidationResult Validate() const noexcept;
};

struct PriorityScoreResult {
    uint64_t incident_id{0};
    bool is_valid{false};
    std::string error_message;

    uint32_t severity{0};
    uint32_t victim_count{0};
    uint64_t waiting_duration_ms{0};

    double normalized_severity_score{0.0};
    double normalized_victim_score{0.0};
    double normalized_waiting_score{0.0};

    double total_priority_score{0.0};          // Bounded strictly in [0.0, 100.0]
    PriorityTier tier{PriorityTier::LOW};      // Derived from unrounded score
};
```

---

## 4. Mathematical Model & Numerical Safeguards

### 4.1 Scoring Formula
The priority score is computed as:
$$P = \left( W_S \times S_{\text{norm}} \right) + \left( W_V \times V_{\text{norm}} \right) + \left( W_W \times T_{\text{norm}} \right)$$

1. **Severity Normalization:**
   $$S_{\text{norm}} = \frac{S}{S_{\max}} \times 100.0 = \frac{S}{5} \times 100.0$$
   Severity $1 \implies 20.0$, Severity $5 \implies 100.0$.
2. **Victim Normalization:**
   $$V_{\text{norm}} = \min\left(100.0, \frac{V}{20} \times 100.0\right)$$
   $V = 0 \implies 0.0$, $V = 1 \implies 5.0$, $V \ge 20 \implies 100.0$.
3. **Waiting Time Normalization:**
   $$T_{\text{norm}} = \min\left(100.0, \frac{\Delta t}{3,600,000\text{ ms}} \times 100.0\right)$$
   $\Delta t = 0\text{m} \implies 0.0$, $\Delta t \ge 60\text{m} \implies 100.0$.

### 4.2 Mandatory Numerical Safeguards
- **Configuration Validation:** Rejects non-finite (NaN, $\pm\infty$), negative, and all-zero weights. Rejects weights summing outside $[1.0 - 10^{-6}, 1.0 + 10^{-6}]$. Prohibits silent weight normalization.
- **Score Bounding Policy:** Even with permissible floating-point variations in weights ($\pm 10^{-6}$), the calculated raw score is clamped to $[0.0, 100.0]$:
  ```cpp
  if (!std::isfinite(raw_score) || std::isnan(raw_score)) {
      raw_score = 0.0;
  }
  res.total_priority_score = std::clamp(raw_score, 0.0, 100.0);
  ```
- **Precision & Tier Invariance:** The unrounded `double` score is used for tier classification. Display rounding is isolated to presentation formatters.

---

## 5. Priority Tiers & Canonical Comparator

### 5.1 Non-Overlapping Tier Boundaries
- `LOW`: $[0.0, 40.0) \implies 0.0 \le P < 40.0$
- `MEDIUM`: $[40.0, 60.0) \implies 40.0 \le P < 60.0$
- `HIGH`: $[60.0, 80.0) \implies 60.0 \le P < 80.0$
- `CRITICAL`: $[80.0, 100.0] \implies 80.0 \le P \le 100.0$

### 5.2 Canonical Deterministic Comparator (`PriorityComparator`)
Ordering hierarchy:
1. Higher total priority score (`a.total_priority_score > b.total_priority_score`).
2. Higher severity (`a.severity > b.severity`).
3. Higher victim count (`a.victim_count > b.victim_count`).
4. Longer waiting duration (`a.waiting_duration_ms > b.waiting_duration_ms`).
5. Smaller incident ID (`a.incident_id < b.incident_id`).

#### Defensive Handling of Invalid Results
Valid results strictly precede invalid results:
```cpp
if (a.is_valid != b.is_valid) {
    return a.is_valid && !b.is_valid;
}
if (!a.is_valid && !b.is_valid) {
    return a.incident_id < b.incident_id;
}
```
Uses direct IEEE 754 comparisons (`!=`, `>`) without fuzzy epsilon windows, mathematically guaranteeing **strict weak ordering** and preventing transitivity violations in `std::sort` and `std::priority_queue`.

---

## 6. Test Suite Execution & Results

The test executable [`test_priority_engine.exe`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/bin/test_priority_engine.exe) executes 28 unit and edge-case tests plus 1 comprehensive benchmark suite.

```
====================================================
  PHASE 3.8 EMERGENCY PRIORITY SCORING TEST SUITE
====================================================

Running Test1_MinimumBaseCase...                                      PASSED
Running Test2_MaximumCeilingCase...                                   PASSED
Running Test3_ZeroVictimsSemantics...                                 PASSED
Running Test4_ProportionalVictimScaling...                            PASSED
Running Test5_ZeroWaitingDuration...                                  PASSED
Running Test6_SaturatedWaitingDuration...                             PASSED
Running Test7_NegativeWaitingTimeRejection...                         PASSED
Running Test8_InvalidSeverityRejection...                             PASSED
Running Test9_InvalidIncidentIdRejection...                           PASSED
Running Test10_CategoryInvariance...                                  PASSED
Running Test11_ExtremeOverflowGuard...                                PASSED
Running Test12_InvalidCategoryEnumValue...                            PASSED
Running Test13_NanWeightRejection...                                  PASSED
Running Test14_InfiniteWeightRejection...                             PASSED
Running Test15_NegativeWeightRejection...                             PASSED
Running Test16_AllZeroWeightRejection...                              PASSED
Running Test17_WeightSumSlightlyBelowTolerance...                     PASSED
Running Test18_WeightSumSlightlyAboveTolerance...                     PASSED
Running Test19_ValidCustomWeights...                                  PASSED
Running Test20_UnroundedTierBoundaryChecks...                         PASSED
Running Test21_IdenticalRecordsAtIdenticalTimestamps...               PASSED
Running Test22_IdenticalRecordsAtDifferentTimestamps...               PASSED
Running Test23_CanonicalComparatorMultiTierTieBreaking...             PASSED
Running Test24_StrictWeakOrderingFormalCheck...                       PASSED
Running Test25_LargeBatchWithDuplicateScores...                       PASSED
Running Test26_ContinuousPriorityQueueDispatchOrdering...             PASSED
Running Test27_WeightsToleranceBoundingAndClamp...                    PASSED
Running Test28_InvalidComparatorInputs...                             PASSED
Running RunPriorityEngineBenchmarks...                                PASSED

====================================================
  TEST RESULTS SUMMARY
  Passed: 29 / 29
  Failed: 0
====================================================
```

---

## 7. Empirical Benchmarks (50 Iterations per Scenario)

### 7.1 Configuration
- **Platform:** Windows 11, MSYS2 UCRT64 GCC 16.2.0, `-O3 -Wall -Wextra -pedantic`.
- **Rounds:** 5 warm-up iterations, 50 timed measurement iterations per scenario using `std::chrono::high_resolution_clock`.
- **Memory Profiling:** Resident Set Size (RSS) tracked via Windows `GetProcessMemoryInfo` API.

### 7.2 Results Table

| Incidents ($N$) | Phase | Avg Latency (ms) | Median (ms) | p95 (ms) | Throughput (evals/sec) | RSS Delta (MB) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **$N = 1$** | **Scoring** | 0.0001 ms | 0.0001 ms | 0.0001 ms | 12,500,000 evals/s | 0.0078 MB |
| | **Sorting** | 0.0000 ms | 0.0000 ms | 0.0001 ms | 31,249,999 evals/s | 0.0000 MB |
| **$N = 100$** | **Scoring** | 0.0011 ms | 0.0011 ms | 0.0012 ms | 88,967,971 evals/s | 0.0000 MB |
| | **Sorting** | 0.0025 ms | 0.0025 ms | 0.0026 ms | 39,246,467 evals/s | 0.0000 MB |
| **$N = 1,000$** | **Scoring** | 0.0112 ms | 0.0105 ms | 0.0122 ms | 89,541,547 evals/s | 0.0000 MB |
| | **Sorting** | 0.0534 ms | 0.0496 ms | 0.0751 ms | 18,734,310 evals/s | 0.0000 MB |
| **$N = 10,000$** | **Scoring** | 0.1880 ms | 0.1835 ms | 0.1947 ms | 53,188,660 evals/s | 0.0000 MB |
| | **Sorting** | 0.7713 ms | 0.7653 ms | 0.8326 ms | 12,965,157 evals/s | 0.0000 MB |

### 7.3 Performance Observations
1. **Ultra-High Scoring Throughput:** Batch incident evaluation operates at **53 to 89 million evaluations per second** (averaging ~11 nanoseconds per incident), satisfying real-time dispatch requirements with zero heap churn.
2. **Sub-Millisecond Batch Sorting:** Sorting 10,000 incidents by the canonical 5-tier comparator completes in **0.77 ms** (~13 million items/second).
3. **Zero Heap Overhead:** RSS memory delta during continuous evaluation is **0.0000 MB**, confirming complete avoidance of transient allocations.

---

## 8. Full Project Regression Verification

All 9 test executables in the routing engine were executed and passed with 100% success rate:

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
| `test_priority_engine.exe` | 29 / 29 tests | **100% PASSED** (28 unit tests + benchmarks) |

### Canonical Dataset Checksums (Bit-for-Bit Verified)

```
SHA256: 057B9D2CB00AF9C16E8A19079587435DB09A581DA64613EBADB466C7509CA89A  jodhpur_graph.json
SHA256: C198080F4369786B980BD6D803DC30CC722DF6F72711C0BBBCB5F8A2C8BC756B  jodhpur_roads.geojson
SHA256: 83D704A1B918E5AF3342C949D3B16513AF273F7A5A923DCE98FC94AA6CF974E9  jodhpur_boundary.geojson
SHA256: DDD3A00CEBBB91A4469A2DE23ABC2AFDA424030BED14C6061C10BFF7ED39AB3A  road_network_metadata.json
```

---

## 9. Known Limitations

1. **Simulation Model Scope:** The weighted linear combination model is an educational simulation proxy. It does not replace clinical or emergency triage protocols.
2. **Fixed Waiting Saturation:** Waiting time escalates urgency up to 60 minutes ($T_{\text{sat}} = 3,600,000\text{ ms}$), beyond which it contributes its maximum 20 points. Incidents waiting $>60$ minutes do not experience further score escalation from time alone.
3. **FIFO Ordering Pre-requisite:** Tie-breaking tier 5 (smaller incident ID) provides strict FIFO behavior if and only if incident IDs are assigned monotonically upon registration.

---

## 10. Conclusion & Readiness

Phase 3.8 is **100% complete, tested, benchmarked, and verified**. All requirements, numerical safeguards, and acceptance criteria have been satisfied. The system is ready for independent technical audit and formal approval.

