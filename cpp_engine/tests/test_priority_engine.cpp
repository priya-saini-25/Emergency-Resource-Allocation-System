#include "PriorityEngine.hpp"
#include "MemoryProfiler.hpp"
#include <iostream>
#include <cassert>
#include <cmath>
#include <limits>
#include <chrono>
#include <iomanip>
#include <algorithm>
#include <vector>
#include <queue>
#include <numeric>
#include <random>

using namespace EmergencyRouting::Priority;

#define TEST_ASSERT(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "[TEST_FAIL] " << __FUNCTION__ << ":" << __LINE__ << " - " << msg << std::endl; \
            return false; \
        } \
    } while (0)

// ============================================================================
// TESTS 1 - 11: STANDARD FUNCTIONAL TESTS
// ============================================================================

bool Test1_MinimumBaseCase() {
    std::cout << "Running Test1_MinimumBaseCase..." << std::endl;
    PriorityEngine engine;
    IncidentRecord inc{1, EmergencyCategory::MEDICAL, 1, 0, 1000000};
    uint64_t eval_time = 1000000; // Delta t = 0

    PriorityScoreResult res = engine.EvaluateIncident(inc, eval_time);
    TEST_ASSERT(res.is_valid, "Minimum incident must be valid");
    TEST_ASSERT(res.incident_id == 1, "Incident ID match");
    // S=1 -> 20.0 (w=0.5 -> 10.0), V=0 -> 0.0, T=0 -> 0.0 => Total 10.0
    TEST_ASSERT(std::abs(res.normalized_severity_score - 20.0) < 1e-9, "Severity norm 20.0");
    TEST_ASSERT(std::abs(res.normalized_victim_score - 0.0) < 1e-9, "Victim norm 0.0");
    TEST_ASSERT(std::abs(res.normalized_waiting_score - 0.0) < 1e-9, "Waiting norm 0.0");
    TEST_ASSERT(std::abs(res.total_priority_score - 10.0) < 1e-9, "Total score must be 10.0");
    TEST_ASSERT(res.tier == PriorityTier::LOW, "Tier must be LOW");

    std::cout << "Test1_MinimumBaseCase: PASSED\n" << std::endl;
    return true;
}

bool Test2_MaximumCeilingCase() {
    std::cout << "Running Test2_MaximumCeilingCase..." << std::endl;
    PriorityEngine engine;
    IncidentRecord inc{2, EmergencyCategory::FIRE, 5, 25, 1000000};
    uint64_t eval_time = 1000000 + 5400000; // Delta t = 90 mins (saturated > 60 mins)

    PriorityScoreResult res = engine.EvaluateIncident(inc, eval_time);
    TEST_ASSERT(res.is_valid, "Maximum incident must be valid");
    TEST_ASSERT(std::abs(res.normalized_severity_score - 100.0) < 1e-9, "Severity norm 100.0");
    TEST_ASSERT(std::abs(res.normalized_victim_score - 100.0) < 1e-9, "Victim norm 100.0 (saturated at 20)");
    TEST_ASSERT(std::abs(res.normalized_waiting_score - 100.0) < 1e-9, "Waiting norm 100.0 (saturated at 60m)");
    TEST_ASSERT(std::abs(res.total_priority_score - 100.0) < 1e-9, "Total score must be 100.0");
    TEST_ASSERT(res.tier == PriorityTier::CRITICAL, "Tier must be CRITICAL");

    std::cout << "Test2_MaximumCeilingCase: PASSED\n" << std::endl;
    return true;
}

bool Test3_ZeroVictimsSemantics() {
    std::cout << "Running Test3_ZeroVictimsSemantics..." << std::endl;
    PriorityEngine engine;
    IncidentRecord inc{3, EmergencyCategory::ROAD_ACCIDENT, 3, 0, 1000000};
    uint64_t eval_time = 1000000;

    PriorityScoreResult res = engine.EvaluateIncident(inc, eval_time);
    TEST_ASSERT(res.is_valid, "Zero victims incident must be valid");
    TEST_ASSERT(res.victim_count == 0, "Victim count 0");
    TEST_ASSERT(res.normalized_victim_score == 0.0, "Zero victims must have 0.0 normalized score");

    std::cout << "Test3_ZeroVictimsSemantics: PASSED\n" << std::endl;
    return true;
}

bool Test4_ProportionalVictimScaling() {
    std::cout << "Running Test4_ProportionalVictimScaling..." << std::endl;
    PriorityEngine engine;

    std::vector<uint32_t> victim_counts = {1, 5, 10, 20, 40};
    std::vector<double> expected_norms = {5.0, 25.0, 50.0, 100.0, 100.0};

    for (size_t i = 0; i < victim_counts.size(); ++i) {
        IncidentRecord inc{100 + i, EmergencyCategory::MEDICAL, 3, victim_counts[i], 1000000};
        PriorityScoreResult res = engine.EvaluateIncident(inc, 1000000);
        TEST_ASSERT(res.is_valid, "Valid victim scaling");
        TEST_ASSERT(std::abs(res.normalized_victim_score - expected_norms[i]) < 1e-9,
                    "Victim score must scale proportionally up to saturation");
    }

    std::cout << "Test4_ProportionalVictimScaling: PASSED\n" << std::endl;
    return true;
}

bool Test5_ZeroWaitingDuration() {
    std::cout << "Running Test5_ZeroWaitingDuration..." << std::endl;
    PriorityEngine engine;
    IncidentRecord inc{5, EmergencyCategory::INDUSTRIAL, 4, 2, 2500000};
    uint64_t eval_time = 2500000;

    PriorityScoreResult res = engine.EvaluateIncident(inc, eval_time);
    TEST_ASSERT(res.is_valid, "Incident must be valid");
    TEST_ASSERT(res.waiting_duration_ms == 0, "Waiting duration must be 0 ms");
    TEST_ASSERT(res.normalized_waiting_score == 0.0, "Normalized waiting score must be 0.0");

    std::cout << "Test5_ZeroWaitingDuration: PASSED\n" << std::endl;
    return true;
}

bool Test6_SaturatedWaitingDuration() {
    std::cout << "Running Test6_SaturatedWaitingDuration..." << std::endl;
    PriorityEngine engine;

    std::vector<uint64_t> delays_ms = {
        3600000,           // 60 minutes (exact saturation point)
        7200000,           // 120 minutes (2 hours)
        86400000           // 24 hours
    };

    for (size_t i = 0; i < delays_ms.size(); ++i) {
        IncidentRecord inc{200 + i, EmergencyCategory::FIRE, 2, 0, 1000000};
        PriorityScoreResult res = engine.EvaluateIncident(inc, 1000000 + delays_ms[i]);
        TEST_ASSERT(res.is_valid, "Incident must be valid");
        TEST_ASSERT(std::abs(res.normalized_waiting_score - 100.0) < 1e-9,
                    "Waiting time must saturate at 100.0 beyond 60 minutes");
    }

    std::cout << "Test6_SaturatedWaitingDuration: PASSED\n" << std::endl;
    return true;
}

bool Test7_NegativeWaitingTimeRejection() {
    std::cout << "Running Test7_NegativeWaitingTimeRejection..." << std::endl;
    PriorityEngine engine;
    IncidentRecord inc{7, EmergencyCategory::MEDICAL, 3, 1, 2000000};
    uint64_t eval_time = 1000000; // Evaluation is 1000s BEFORE creation!

    PriorityScoreResult res = engine.EvaluateIncident(inc, eval_time);
    TEST_ASSERT(!res.is_valid, "Negative waiting time must be rejected");
    TEST_ASSERT(!res.error_message.empty(), "Error message must be present");
    TEST_ASSERT(res.total_priority_score == 0.0, "Score must be 0.0 for invalid input");

    std::cout << "Test7_NegativeWaitingTimeRejection: PASSED\n" << std::endl;
    return true;
}

bool Test8_InvalidSeverityRejection() {
    std::cout << "Running Test8_InvalidSeverityRejection..." << std::endl;
    PriorityEngine engine;

    // Severity 0 (too low)
    IncidentRecord inc_low{81, EmergencyCategory::MEDICAL, 0, 1, 1000000};
    PriorityScoreResult res_low = engine.EvaluateIncident(inc_low, 1000000);
    TEST_ASSERT(!res_low.is_valid, "Severity 0 must be rejected");

    // Severity 6 (too high)
    IncidentRecord inc_high{82, EmergencyCategory::MEDICAL, 6, 1, 1000000};
    PriorityScoreResult res_high = engine.EvaluateIncident(inc_high, 1000000);
    TEST_ASSERT(!res_high.is_valid, "Severity 6 must be rejected");

    std::cout << "Test8_InvalidSeverityRejection: PASSED\n" << std::endl;
    return true;
}

bool Test9_InvalidIncidentIdRejection() {
    std::cout << "Running Test9_InvalidIncidentIdRejection..." << std::endl;
    PriorityEngine engine;
    IncidentRecord inc{0, EmergencyCategory::FIRE, 3, 1, 1000000};

    PriorityScoreResult res = engine.EvaluateIncident(inc, 1000000);
    TEST_ASSERT(!res.is_valid, "Incident ID 0 must be rejected");
    TEST_ASSERT(!res.error_message.empty(), "Error message must state non-zero ID requirement");

    std::cout << "Test9_InvalidIncidentIdRejection: PASSED\n" << std::endl;
    return true;
}

bool Test10_CategoryInvariance() {
    std::cout << "Running Test10_CategoryInvariance..." << std::endl;
    PriorityEngine engine;
    std::vector<EmergencyCategory> cats = {
        EmergencyCategory::MEDICAL,
        EmergencyCategory::FIRE,
        EmergencyCategory::ROAD_ACCIDENT,
        EmergencyCategory::INDUSTRIAL,
        EmergencyCategory::STRUCTURAL_COLLAPSE,
        EmergencyCategory::HAZMAT,
        EmergencyCategory::NATURAL_DISASTER,
        EmergencyCategory::CIVIL_DISTURBANCE,
        EmergencyCategory::OTHER
    };

    double baseline_score = -1.0;
    for (size_t i = 0; i < cats.size(); ++i) {
        IncidentRecord inc{10 + i, cats[i], 4, 3, 1000000};
        PriorityScoreResult res = engine.EvaluateIncident(inc, 1000000 + 900000);
        TEST_ASSERT(res.is_valid, "Category must be valid");
        if (i == 0) {
            baseline_score = res.total_priority_score;
        } else {
            TEST_ASSERT(std::abs(res.total_priority_score - baseline_score) < 1e-9,
                        "Category must not arbitrarily skew score without explicit policy weights");
        }
    }

    std::cout << "Test10_CategoryInvariance: PASSED\n" << std::endl;
    return true;
}

bool Test11_ExtremeOverflowGuard() {
    std::cout << "Running Test11_ExtremeOverflowGuard..." << std::endl;
    PriorityEngine engine;
    // 1 Million victims and creation near uint64 max (safely bounded below uint64_max to avoid eval_time wrap)
    uint64_t huge_time = 0xFFFFFFFFFF800000ULL;
    IncidentRecord inc{11, EmergencyCategory::INDUSTRIAL, 5, 1000000, huge_time};

    PriorityScoreResult res = engine.EvaluateIncident(inc, huge_time + 7200000);
    TEST_ASSERT(res.is_valid, "Incident must evaluate without overflow");
    TEST_ASSERT(std::isfinite(res.total_priority_score), "Total score must be finite");
    TEST_ASSERT(res.total_priority_score <= 100.0, "Score must remain <= 100.0");
    TEST_ASSERT(res.tier == PriorityTier::CRITICAL, "Must be CRITICAL tier");

    std::cout << "Test11_ExtremeOverflowGuard: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// TESTS 12 - 19: AUDIT-REQUIRED CONFIGURATION & VALIDATION TESTS
// ============================================================================

bool Test12_InvalidCategoryEnumValue() {
    std::cout << "Running Test12_InvalidCategoryEnumValue..." << std::endl;
    PriorityEngine engine;
    IncidentRecord inc;
    inc.incident_id = 12;
    inc.category = static_cast<EmergencyCategory>(99); // Undefined enum value
    inc.severity = 3;
    inc.victim_count = 1;
    inc.created_at_ms = 1000000;

    PriorityScoreResult res = engine.EvaluateIncident(inc, 1000000);
    TEST_ASSERT(!res.is_valid, "Invalid category enum must be rejected");
    TEST_ASSERT(!res.error_message.empty(), "Error message must report enum rejection");

    std::cout << "Test12_InvalidCategoryEnumValue: PASSED\n" << std::endl;
    return true;
}

bool Test13_NanWeightRejection() {
    std::cout << "Running Test13_NanWeightRejection..." << std::endl;
    PriorityConfig cfg;
    cfg.severity_weight = std::numeric_limits<double>::quiet_NaN();
    ConfigValidationResult val = cfg.Validate();
    TEST_ASSERT(!val.is_valid, "NaN weight must be rejected");

    PriorityEngine engine;
    ConfigValidationResult set_res = engine.SetConfig(cfg);
    TEST_ASSERT(!set_res.is_valid, "SetConfig must reject NaN weight");

    std::cout << "Test13_NanWeightRejection: PASSED\n" << std::endl;
    return true;
}

bool Test14_InfiniteWeightRejection() {
    std::cout << "Running Test14_InfiniteWeightRejection..." << std::endl;
    PriorityConfig cfg_pos;
    cfg_pos.victim_weight = std::numeric_limits<double>::infinity();
    TEST_ASSERT(!cfg_pos.Validate().is_valid, "Positive infinity weight must be rejected");

    PriorityConfig cfg_neg;
    cfg_neg.waiting_weight = -std::numeric_limits<double>::infinity();
    TEST_ASSERT(!cfg_neg.Validate().is_valid, "Negative infinity weight must be rejected");

    std::cout << "Test14_InfiniteWeightRejection: PASSED\n" << std::endl;
    return true;
}

bool Test15_NegativeWeightRejection() {
    std::cout << "Running Test15_NegativeWeightRejection..." << std::endl;
    PriorityConfig cfg;
    cfg.severity_weight = -0.10;
    cfg.victim_weight = 0.60;
    cfg.waiting_weight = 0.50; // sum is 1.0, but negative weight!
    ConfigValidationResult val = cfg.Validate();
    TEST_ASSERT(!val.is_valid, "Negative weight must be rejected even if sum equals 1.0");

    std::cout << "Test15_NegativeWeightRejection: PASSED\n" << std::endl;
    return true;
}

bool Test16_AllZeroWeightRejection() {
    std::cout << "Running Test16_AllZeroWeightRejection..." << std::endl;
    PriorityConfig cfg;
    cfg.severity_weight = 0.0;
    cfg.victim_weight = 0.0;
    cfg.waiting_weight = 0.0;
    ConfigValidationResult val = cfg.Validate();
    TEST_ASSERT(!val.is_valid, "All-zero weights must be rejected");

    std::cout << "Test16_AllZeroWeightRejection: PASSED\n" << std::endl;
    return true;
}

bool Test17_WeightSumSlightlyBelowTolerance() {
    std::cout << "Running Test17_WeightSumSlightlyBelowTolerance..." << std::endl;
    PriorityConfig cfg;
    // sum is 1.0 - 2e-6 (strictly beyond 1e-6 tolerance)
    cfg.severity_weight = 0.50;
    cfg.victim_weight = 0.30;
    cfg.waiting_weight = 0.20 - 2e-6;
    ConfigValidationResult val = cfg.Validate();
    TEST_ASSERT(!val.is_valid, "Weight sum slightly below tolerance must be rejected");

    std::cout << "Test17_WeightSumSlightlyBelowTolerance: PASSED\n" << std::endl;
    return true;
}

bool Test18_WeightSumSlightlyAboveTolerance() {
    std::cout << "Running Test18_WeightSumSlightlyAboveTolerance..." << std::endl;
    PriorityConfig cfg;
    // sum is 1.0 + 2e-6 (strictly beyond 1e-6 tolerance)
    cfg.severity_weight = 0.50;
    cfg.victim_weight = 0.30;
    cfg.waiting_weight = 0.20 + 2e-6;
    ConfigValidationResult val = cfg.Validate();
    TEST_ASSERT(!val.is_valid, "Weight sum slightly above tolerance must be rejected");

    std::cout << "Test18_WeightSumSlightlyAboveTolerance: PASSED\n" << std::endl;
    return true;
}

bool Test19_ValidCustomWeights() {
    std::cout << "Running Test19_ValidCustomWeights..." << std::endl;
    PriorityConfig cfg;
    cfg.severity_weight = 0.40;
    cfg.victim_weight = 0.40;
    cfg.waiting_weight = 0.20;
    TEST_ASSERT(cfg.Validate().is_valid, "Valid custom weights must pass validation");

    PriorityEngine engine(cfg);
    IncidentRecord inc{19, EmergencyCategory::MEDICAL, 5, 20, 1000000};
    PriorityScoreResult res = engine.EvaluateIncident(inc, 1000000 + 3600000);
    TEST_ASSERT(res.is_valid, "Incident must evaluate under custom weights");
    // S=100 (0.4) + V=100 (0.4) + T=100 (0.2) = 100.0
    TEST_ASSERT(std::abs(res.total_priority_score - 100.0) < 1e-9, "Score must evaluate correctly with custom weights");

    std::cout << "Test19_ValidCustomWeights: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// TESTS 20 - 26: PRECISION, DETERMINISM & COMPARATOR TESTS
// ============================================================================

bool Test20_UnroundedTierBoundaryChecks() {
    std::cout << "Running Test20_UnroundedTierBoundaryChecks..." << std::endl;
    PriorityEngine engine;

    // Test tier boundaries: LOW [0, 40), MEDIUM [40, 60), HIGH [60, 80), CRITICAL [80, 100]
    TEST_ASSERT(engine.ClassifyTier(0.0) == PriorityTier::LOW, "0.0 is LOW");
    TEST_ASSERT(engine.ClassifyTier(39.999999) == PriorityTier::LOW, "39.999999 is LOW");
    TEST_ASSERT(engine.ClassifyTier(40.0) == PriorityTier::MEDIUM, "40.0 is MEDIUM");
    TEST_ASSERT(engine.ClassifyTier(59.999999) == PriorityTier::MEDIUM, "59.999999 is MEDIUM");
    TEST_ASSERT(engine.ClassifyTier(60.0) == PriorityTier::HIGH, "60.0 is HIGH");
    TEST_ASSERT(engine.ClassifyTier(79.999999) == PriorityTier::HIGH, "79.999999 is HIGH");
    TEST_ASSERT(engine.ClassifyTier(80.0) == PriorityTier::CRITICAL, "80.0 is CRITICAL");
    TEST_ASSERT(engine.ClassifyTier(100.0) == PriorityTier::CRITICAL, "100.0 is CRITICAL");

    std::cout << "Test20_UnroundedTierBoundaryChecks: PASSED\n" << std::endl;
    return true;
}

bool Test21_IdenticalRecordsAtIdenticalTimestamps() {
    std::cout << "Running Test21_IdenticalRecordsAtIdenticalTimestamps..." << std::endl;
    PriorityEngine engine;
    IncidentRecord inc{21, EmergencyCategory::ROAD_ACCIDENT, 4, 3, 1000000};
    uint64_t eval_time = 1500000;

    PriorityScoreResult baseline = engine.EvaluateIncident(inc, eval_time);
    for (int run = 0; run < 1000; ++run) {
        PriorityScoreResult current = engine.EvaluateIncident(inc, eval_time);
        TEST_ASSERT(baseline.total_priority_score == current.total_priority_score,
                    "Repeated evaluations must be bitwise identical");
        TEST_ASSERT(baseline.tier == current.tier, "Tiers must be bitwise identical");
    }

    std::cout << "Test21_IdenticalRecordsAtIdenticalTimestamps: PASSED\n" << std::endl;
    return true;
}

bool Test22_IdenticalRecordsAtDifferentTimestamps() {
    std::cout << "Running Test22_IdenticalRecordsAtDifferentTimestamps..." << std::endl;
    PriorityEngine engine;
    IncidentRecord inc{22, EmergencyCategory::MEDICAL, 2, 0, 1000000};

    // Evaluate over time: 0m, 15m, 30m, 45m, 60m
    std::vector<uint64_t> times = {
        1000000,
        1000000 + 900000,
        1000000 + 1800000,
        1000000 + 2700000,
        1000000 + 3600000
    };

    double prev_score = -1.0;
    for (uint64_t t : times) {
        PriorityScoreResult res = engine.EvaluateIncident(inc, t);
        TEST_ASSERT(res.is_valid, "Valid at advancing time");
        TEST_ASSERT(res.total_priority_score > prev_score, "Score must grow monotonically with elapsed time");
        prev_score = res.total_priority_score;
    }

    std::cout << "Test22_IdenticalRecordsAtDifferentTimestamps: PASSED\n" << std::endl;
    return true;
}

bool Test23_CanonicalComparatorMultiTierTieBreaking() {
    std::cout << "Running Test23_CanonicalComparatorMultiTierTieBreaking..." << std::endl;
    PriorityComparator comp;

    // Base template
    PriorityScoreResult a, b;
    a.is_valid = b.is_valid = true;

    // Case 1: Score difference
    a.incident_id = 1; a.total_priority_score = 75.0;
    b.incident_id = 2; b.total_priority_score = 70.0;
    TEST_ASSERT(comp(a, b), "Higher score must precede lower score");
    TEST_ASSERT(!comp(b, a), "Asymmetry check");

    // Case 2: Equal score, severity difference
    a.total_priority_score = b.total_priority_score = 60.0;
    a.severity = 4; b.severity = 3;
    TEST_ASSERT(comp(a, b), "Higher severity must precede lower severity on equal score");

    // Case 3: Equal score & severity, victim difference
    a.severity = b.severity = 4;
    a.victim_count = 5; b.victim_count = 2;
    TEST_ASSERT(comp(a, b), "Higher victim count must precede lower victim count on equal score & severity");

    // Case 4: Equal score, severity, victims; waiting duration difference
    a.victim_count = b.victim_count = 5;
    a.waiting_duration_ms = 1800000; b.waiting_duration_ms = 900000;
    TEST_ASSERT(comp(a, b), "Longer waiting time must precede shorter waiting time");

    // Case 5: All metrics equal; smaller incident ID wins
    a.waiting_duration_ms = b.waiting_duration_ms = 1800000;
    a.incident_id = 10; b.incident_id = 20;
    TEST_ASSERT(comp(a, b), "Smaller incident ID must precede larger incident ID as final tie breaker");
    TEST_ASSERT(!comp(b, a), "Reverse must be false");

    std::cout << "Test23_CanonicalComparatorMultiTierTieBreaking: PASSED\n" << std::endl;
    return true;
}

bool Test24_StrictWeakOrderingFormalCheck() {
    std::cout << "Running Test24_StrictWeakOrderingFormalCheck..." << std::endl;
    PriorityComparator comp;

    // Create 4 distinct results
    PriorityScoreResult r1, r2, r3, r4;
    r1.is_valid = r2.is_valid = r3.is_valid = r4.is_valid = true;
    r1.incident_id = 1; r1.total_priority_score = 90.0;
    r2.incident_id = 2; r2.total_priority_score = 80.0;
    r3.incident_id = 3; r3.total_priority_score = 70.0;
    r4.incident_id = 4; r4.total_priority_score = 70.0; r4.severity = 2; r3.severity = 3;

    std::vector<PriorityScoreResult> set = {r1, r2, r3, r4};

    // 1. Irreflexivity: comp(x, x) == false
    for (const auto& x : set) {
        TEST_ASSERT(!comp(x, x), "Irreflexivity check failed");
    }

    // 2. Asymmetry: comp(x, y) => !comp(y, x)
    for (const auto& x : set) {
        for (const auto& y : set) {
            if (comp(x, y)) {
                TEST_ASSERT(!comp(y, x), "Asymmetry check failed");
            }
        }
    }

    // 3. Transitivity: comp(x, y) && comp(y, z) => comp(x, z)
    for (const auto& x : set) {
        for (const auto& y : set) {
            for (const auto& z : set) {
                if (comp(x, y) && comp(y, z)) {
                    TEST_ASSERT(comp(x, z), "Transitivity check failed");
                }
            }
        }
    }

    std::cout << "Test24_StrictWeakOrderingFormalCheck: PASSED\n" << std::endl;
    return true;
}

bool Test25_LargeBatchWithDuplicateScores() {
    std::cout << "Running Test25_LargeBatchWithDuplicateScores..." << std::endl;
    PriorityEngine engine;
    PriorityComparator comp;

    const size_t N = 1000;
    std::vector<IncidentRecord> incidents;
    incidents.reserve(N);

    // Generate many incidents with synthetic identical severities and victims
    for (size_t i = 1; i <= N; ++i) {
        incidents.push_back(IncidentRecord{
            i,
            EmergencyCategory::ROAD_ACCIDENT,
            static_cast<uint32_t>((i % 5) + 1),
            static_cast<uint32_t>(i % 10),
            1000000
        });
    }

    std::vector<PriorityScoreResult> results = engine.EvaluateBatch(incidents, 1000000 + 600000);
    TEST_ASSERT(results.size() == N, "Batch evaluation size match");

    // Sort using canonical comparator
    std::sort(results.begin(), results.end(), comp);

    // Verify ordering is strictly non-increasing by comparator
    for (size_t i = 0; i + 1 < results.size(); ++i) {
        TEST_ASSERT(!comp(results[i + 1], results[i]),
                    "Sorted batch must strictly satisfy non-increasing priority");
    }

    std::cout << "Test25_LargeBatchWithDuplicateScores: PASSED\n" << std::endl;
    return true;
}

bool Test26_ContinuousPriorityQueueDispatchOrdering() {
    std::cout << "Running Test26_ContinuousPriorityQueueDispatchOrdering..." << std::endl;
    PriorityEngine engine;

    // Min-heap vs Max-heap semantics:
    // In C++, std::priority_queue uses a less-comparator to pop the MAX element first.
    // Our PriorityComparator defines operator()(a, b) as "a has strictly HIGHER priority than b" (i.e. GreaterThan).
    // To pop highest priority first from std::priority_queue, we can use an inverse comparator,
    // or verify std::sort descending directly.
    struct PQDispatcher {
        bool operator()(const PriorityScoreResult& a, const PriorityScoreResult& b) const noexcept {
            PriorityComparator c;
            // Reverse of PriorityComparator: returns true if 'a' has LOWER priority than 'b'
            return c(b, a);
        }
    };

    std::priority_queue<PriorityScoreResult, std::vector<PriorityScoreResult>, PQDispatcher> pq;

    std::vector<IncidentRecord> incidents = {
        {1, EmergencyCategory::MEDICAL, 1, 0, 1000000}, // LOW
        {2, EmergencyCategory::FIRE, 5, 20, 1000000},   // CRITICAL
        {3, EmergencyCategory::ROAD_ACCIDENT, 3, 2, 1000000}, // MEDIUM
        {4, EmergencyCategory::INDUSTRIAL, 4, 10, 1000000}    // HIGH
    };

    for (const auto& inc : incidents) {
        pq.push(engine.EvaluateIncident(inc, 1000000 + 300000));
    }

    std::vector<uint64_t> pop_order;
    while (!pq.empty()) {
        pop_order.push_back(pq.top().incident_id);
        pq.pop();
    }

    // Expected pop order: ID 2 (CRITICAL) -> ID 4 (HIGH) -> ID 3 (MEDIUM) -> ID 1 (LOW)
    std::vector<uint64_t> expected = {2, 4, 3, 1};
    TEST_ASSERT(pop_order == expected, "Priority queue must pop incidents in exact descending priority order");

    std::cout << "Test26_ContinuousPriorityQueueDispatchOrdering: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// TESTS 27 & 28: ADDITIONAL NUMERICAL & DEFENSIVE COVERAGE
// ============================================================================

bool Test27_WeightsToleranceBoundingAndClamp() {
    std::cout << "Running Test27_WeightsToleranceBoundingAndClamp..." << std::endl;

    // Scenario A: Weights sum slightly above 1.0 (1.0 + 0.5e-6, within tolerance)
    PriorityConfig cfg_above;
    cfg_above.severity_weight = 0.50;
    cfg_above.victim_weight = 0.30;
    cfg_above.waiting_weight = 0.20 + 0.5e-6; // sum = 1.0000005
    TEST_ASSERT(cfg_above.Validate().is_valid, "Weight sum within 1e-6 must be valid");

    PriorityEngine engine_above(cfg_above);
    IncidentRecord max_inc{101, EmergencyCategory::FIRE, 5, 30, 1000000};
    PriorityScoreResult res_above = engine_above.EvaluateIncident(max_inc, 1000000 + 7200000);
    TEST_ASSERT(res_above.is_valid, "Max incident valid");
    TEST_ASSERT(res_above.total_priority_score <= 100.0, "Score must be clamped to <= 100.0");
    TEST_ASSERT(res_above.total_priority_score >= 0.0, "Score must be >= 0.0");
    TEST_ASSERT(res_above.tier == PriorityTier::CRITICAL, "Must be CRITICAL tier");

    // Scenario B: Weights sum slightly below 1.0 (1.0 - 0.5e-6, within tolerance)
    PriorityConfig cfg_below;
    cfg_below.severity_weight = 0.50;
    cfg_below.victim_weight = 0.30;
    cfg_below.waiting_weight = 0.20 - 0.5e-6; // sum = 0.9999995
    TEST_ASSERT(cfg_below.Validate().is_valid, "Weight sum within 1e-6 must be valid");

    PriorityEngine engine_below(cfg_below);
    PriorityScoreResult res_below = engine_below.EvaluateIncident(max_inc, 1000000 + 7200000);
    TEST_ASSERT(res_below.is_valid, "Max incident valid");
    TEST_ASSERT(res_below.total_priority_score <= 100.0, "Score must be <= 100.0");
    TEST_ASSERT(res_below.total_priority_score >= 0.0, "Score must be >= 0.0");

    std::cout << "Test27_WeightsToleranceBoundingAndClamp: PASSED\n" << std::endl;
    return true;
}

bool Test28_InvalidComparatorInputs() {
    std::cout << "Running Test28_InvalidComparatorInputs..." << std::endl;
    PriorityComparator comp;

    PriorityScoreResult valid_res;
    valid_res.incident_id = 1;
    valid_res.is_valid = true;
    valid_res.total_priority_score = 50.0;

    PriorityScoreResult invalid_res_a;
    invalid_res_a.incident_id = 10;
    invalid_res_a.is_valid = false;
    invalid_res_a.error_message = "Invalid severity";

    PriorityScoreResult invalid_res_b;
    invalid_res_b.incident_id = 20;
    invalid_res_b.is_valid = false;
    invalid_res_b.error_message = "Negative wait";

    // 1. Valid strictly precedes invalid
    TEST_ASSERT(comp(valid_res, invalid_res_a), "Valid record must precede invalid record");
    TEST_ASSERT(!comp(invalid_res_a, valid_res), "Invalid record must not precede valid record");

    // 2. Two invalid records order deterministically by incident_id
    TEST_ASSERT(comp(invalid_res_a, invalid_res_b), "Invalid record with smaller ID must precede larger ID");
    TEST_ASSERT(!comp(invalid_res_b, invalid_res_a), "Asymmetry for invalid records");

    std::cout << "Test28_InvalidComparatorInputs: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// PHASE 3.8 PERFORMANCE BENCHMARKS (50 ITERATIONS PER SCENARIO)
// ============================================================================

bool RunPriorityEngineBenchmarks() {
    std::cout << "\n====================================================================\n"
              << "  PHASE 3.8 PRIORITY ENGINE BENCHMARK SUITE (50 ITERATIONS)\n"
              << "====================================================================\n" << std::endl;

    PriorityEngine engine;
    PriorityComparator comp;

    std::vector<size_t> batch_sizes = {1, 100, 1000, 10000};
    const int WARMUP_ROUNDS = 5;
    const int MEASURE_ROUNDS = 50;

    std::cout << std::fixed << std::setprecision(4);
    std::cout << "| Incidents (N) | Phase | Avg Latency (ms) | Median (ms) | p95 (ms) | Throughput (evals/s) | RSS Memory Delta (MB) |\n";
    std::cout << "|---|---|---|---|---|---|---|\n";

    for (size_t N : batch_sizes) {
        // Generate deterministic synthetic incidents
        std::vector<IncidentRecord> incidents;
        incidents.reserve(N);
        for (size_t i = 1; i <= N; ++i) {
            incidents.push_back(IncidentRecord{
                static_cast<uint64_t>(i),
                static_cast<EmergencyCategory>(i % 4),
                static_cast<uint32_t>((i % 5) + 1),
                static_cast<uint32_t>(i % 15),
                1000000 + static_cast<uint64_t>(i * 100)
            });
        }
        uint64_t eval_time = 1000000 + 3600000; // 60 min mark

        // -------------------------------------------------------------
        // Benchmarking Scoring Phase
        // -------------------------------------------------------------
        for (int w = 0; w < WARMUP_ROUNDS; ++w) {
            volatile auto res = engine.EvaluateBatch(incidents, eval_time);
            (void)res;
        }

        std::vector<double> score_latencies;
        score_latencies.reserve(MEASURE_ROUNDS);
        double baseline_mem = EmergencyRouting::MemoryProfiler::Capture().WorkingSetMb();

        for (int m = 0; m < MEASURE_ROUNDS; ++m) {
            auto t1 = std::chrono::high_resolution_clock::now();
            auto res = engine.EvaluateBatch(incidents, eval_time);
            auto t2 = std::chrono::high_resolution_clock::now();
            score_latencies.push_back(std::chrono::duration<double, std::milli>(t2 - t1).count());
        }

        double peak_mem = EmergencyRouting::MemoryProfiler::Capture().WorkingSetMb();
        double mem_delta_mb = (peak_mem > baseline_mem) ? (peak_mem - baseline_mem) : 0.0;

        auto compute_stats = [](std::vector<double>& v) {
            std::sort(v.begin(), v.end());
            double sum = std::accumulate(v.begin(), v.end(), 0.0);
            double avg = sum / v.size();
            double med = v[v.size() / 2];
            size_t p95_idx = static_cast<size_t>(v.size() * 0.95);
            if (p95_idx >= v.size()) p95_idx = v.size() - 1;
            double p95 = v[p95_idx];
            return std::make_tuple(avg, med, p95);
        };

        auto [avg_score, med_score, p95_score] = compute_stats(score_latencies);
        double throughput_score = (avg_score > 0.0) ? (static_cast<double>(N) / (avg_score / 1000.0)) : 0.0;

        std::cout << "| N = " << std::setw(6) << N << " | **Scoring** | "
                  << std::setw(16) << avg_score << " | "
                  << std::setw(11) << med_score << " | "
                  << std::setw(8) << p95_score << " | "
                  << std::setw(20) << static_cast<size_t>(throughput_score) << " | "
                  << std::setw(21) << mem_delta_mb << " |\n";

        // -------------------------------------------------------------
        // Benchmarking Sorting Phase
        // -------------------------------------------------------------
        auto pre_evaluated = engine.EvaluateBatch(incidents, eval_time);

        for (int w = 0; w < WARMUP_ROUNDS; ++w) {
            auto copy = pre_evaluated;
            std::sort(copy.begin(), copy.end(), comp);
        }

        std::vector<double> sort_latencies;
        sort_latencies.reserve(MEASURE_ROUNDS);

        for (int m = 0; m < MEASURE_ROUNDS; ++m) {
            auto copy = pre_evaluated;
            auto t1 = std::chrono::high_resolution_clock::now();
            std::sort(copy.begin(), copy.end(), comp);
            auto t2 = std::chrono::high_resolution_clock::now();
            sort_latencies.push_back(std::chrono::duration<double, std::milli>(t2 - t1).count());
        }

        auto [avg_sort, med_sort, p95_sort] = compute_stats(sort_latencies);
        double throughput_sort = (avg_sort > 0.0) ? (static_cast<double>(N) / (avg_sort / 1000.0)) : 0.0;

        std::cout << "| N = " << std::setw(6) << N << " | **Sorting** | "
                  << std::setw(16) << avg_sort << " | "
                  << std::setw(11) << med_sort << " | "
                  << std::setw(8) << p95_sort << " | "
                  << std::setw(20) << static_cast<size_t>(throughput_sort) << " | "
                  << std::setw(21) << 0.0 << " |\n";
    }

    std::cout << "\nBenchmark complete.\n" << std::endl;
    return true;
}

int main() {
    std::cout << "====================================================\n"
              << "  PHASE 3.8 EMERGENCY PRIORITY SCORING TEST SUITE\n"
              << "====================================================\n" << std::endl;

    int passed = 0;
    int failed = 0;

    auto run_test = [&](bool (*test_fn)(), const char* name) {
        if (test_fn()) {
            ++passed;
        } else {
            ++failed;
            std::cerr << "FAILED: " << name << std::endl;
        }
    };

    // Tests 1 - 11: Standard Functional Tests
    run_test(Test1_MinimumBaseCase, "Test1_MinimumBaseCase");
    run_test(Test2_MaximumCeilingCase, "Test2_MaximumCeilingCase");
    run_test(Test3_ZeroVictimsSemantics, "Test3_ZeroVictimsSemantics");
    run_test(Test4_ProportionalVictimScaling, "Test4_ProportionalVictimScaling");
    run_test(Test5_ZeroWaitingDuration, "Test5_ZeroWaitingDuration");
    run_test(Test6_SaturatedWaitingDuration, "Test6_SaturatedWaitingDuration");
    run_test(Test7_NegativeWaitingTimeRejection, "Test7_NegativeWaitingTimeRejection");
    run_test(Test8_InvalidSeverityRejection, "Test8_InvalidSeverityRejection");
    run_test(Test9_InvalidIncidentIdRejection, "Test9_InvalidIncidentIdRejection");
    run_test(Test10_CategoryInvariance, "Test10_CategoryInvariance");
    run_test(Test11_ExtremeOverflowGuard, "Test11_ExtremeOverflowGuard");

    // Tests 12 - 19: Audit-Required Configuration & Validation Tests
    run_test(Test12_InvalidCategoryEnumValue, "Test12_InvalidCategoryEnumValue");
    run_test(Test13_NanWeightRejection, "Test13_NanWeightRejection");
    run_test(Test14_InfiniteWeightRejection, "Test14_InfiniteWeightRejection");
    run_test(Test15_NegativeWeightRejection, "Test15_NegativeWeightRejection");
    run_test(Test16_AllZeroWeightRejection, "Test16_AllZeroWeightRejection");
    run_test(Test17_WeightSumSlightlyBelowTolerance, "Test17_WeightSumSlightlyBelowTolerance");
    run_test(Test18_WeightSumSlightlyAboveTolerance, "Test18_WeightSumSlightlyAboveTolerance");
    run_test(Test19_ValidCustomWeights, "Test19_ValidCustomWeights");

    // Tests 20 - 26: Precision, Determinism & Comparator Tests
    run_test(Test20_UnroundedTierBoundaryChecks, "Test20_UnroundedTierBoundaryChecks");
    run_test(Test21_IdenticalRecordsAtIdenticalTimestamps, "Test21_IdenticalRecordsAtIdenticalTimestamps");
    run_test(Test22_IdenticalRecordsAtDifferentTimestamps, "Test22_IdenticalRecordsAtDifferentTimestamps");
    run_test(Test23_CanonicalComparatorMultiTierTieBreaking, "Test23_CanonicalComparatorMultiTierTieBreaking");
    run_test(Test24_StrictWeakOrderingFormalCheck, "Test24_StrictWeakOrderingFormalCheck");
    run_test(Test25_LargeBatchWithDuplicateScores, "Test25_LargeBatchWithDuplicateScores");
    run_test(Test26_ContinuousPriorityQueueDispatchOrdering, "Test26_ContinuousPriorityQueueDispatchOrdering");

    // Tests 27 - 28: Additional Numerical & Defensive Coverage
    run_test(Test27_WeightsToleranceBoundingAndClamp, "Test27_WeightsToleranceBoundingAndClamp");
    run_test(Test28_InvalidComparatorInputs, "Test28_InvalidComparatorInputs");

    // Benchmarking
    run_test(RunPriorityEngineBenchmarks, "RunPriorityEngineBenchmarks");

    std::cout << "====================================================\n"
              << "  TEST RESULTS SUMMARY\n"
              << "  Passed: " << passed << " / " << (passed + failed) << "\n"
              << "  Failed: " << failed << "\n"
              << "====================================================" << std::endl;

    return (failed == 0) ? 0 : 1;
}
