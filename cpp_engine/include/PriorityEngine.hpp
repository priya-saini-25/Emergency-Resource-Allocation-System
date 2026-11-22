#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <limits>
#include <cmath>
#include <algorithm>

namespace EmergencyRouting {
namespace Priority {

/**
 * Emergency incident domain category.
 * Valid enum values are strictly in [0, 3].
 */
enum class EmergencyCategory : uint8_t {
    MEDICAL = 0,
    FIRE = 1,
    ROAD_ACCIDENT = 2,
    INDUSTRIAL = 3,
    STRUCTURAL_COLLAPSE = 4,
    HAZMAT = 5,
    NATURAL_DISASTER = 6,
    CIVIL_DISTURBANCE = 7,
    OTHER = 8
};

inline std::string EmergencyCategoryToString(EmergencyCategory cat) {
    switch (cat) {
        case EmergencyCategory::MEDICAL: return "MEDICAL";
        case EmergencyCategory::FIRE: return "FIRE";
        case EmergencyCategory::ROAD_ACCIDENT: return "ROAD_ACCIDENT";
        case EmergencyCategory::INDUSTRIAL: return "INDUSTRIAL";
        case EmergencyCategory::STRUCTURAL_COLLAPSE: return "STRUCTURAL_COLLAPSE";
        case EmergencyCategory::HAZMAT: return "HAZMAT";
        case EmergencyCategory::NATURAL_DISASTER: return "NATURAL_DISASTER";
        case EmergencyCategory::CIVIL_DISTURBANCE: return "CIVIL_DISTURBANCE";
        case EmergencyCategory::OTHER: return "OTHER";
        default: return "UNKNOWN";
    }
}

/**
 * Triage urgency classification tier.
 */
enum class PriorityTier : uint8_t {
    LOW = 0,
    MEDIUM = 1,
    HIGH = 2,
    CRITICAL = 3
};

inline std::string PriorityTierToString(PriorityTier tier) {
    switch (tier) {
        case PriorityTier::LOW: return "LOW";
        case PriorityTier::MEDIUM: return "MEDIUM";
        case PriorityTier::HIGH: return "HIGH";
        case PriorityTier::CRITICAL: return "CRITICAL";
        default: return "UNKNOWN";
    }
}

/**
 * Simplified incident input record containing only priority scoring attributes.
 * Geographic attributes are deliberately excluded and managed by spatial routing layers.
 */
struct IncidentRecord {
    uint64_t incident_id{0};                  // Unique non-zero incident identifier
    EmergencyCategory category{EmergencyCategory::MEDICAL};
    uint32_t severity{1};                     // Integer severity scale: 1 (Minor) to 5 (Catastrophic)
    uint32_t victim_count{0};                 // Number of confirmed/estimated victims (>= 0)
    uint64_t created_at_ms{0};                // Unix epoch timestamp (milliseconds) of call creation
};

/**
 * Validation result for PriorityConfig.
 */
struct ConfigValidationResult {
    bool is_valid{true};
    std::string error_message;
};

/**
 * Configurable weights, thresholds, and saturation parameters for the scoring algorithm.
 */
struct PriorityConfig {
    // Component weights (must be finite, >= 0, non-zero sum, and sum to 1.0 within 1e-6)
    double severity_weight{0.50};
    double victim_weight{0.30};
    double waiting_weight{0.20};

    // Severity mapping
    uint32_t min_severity{1};
    uint32_t max_severity{5};

    // Victim saturation parameters
    uint32_t max_victim_saturation{20};       // Victim count where victim score reaches 100.0

    // Waiting time saturation parameters
    uint64_t max_waiting_time_ms{3600000};    // 60 minutes in milliseconds (saturation point)

    // Tier score boundary thresholds: [lower_bound, upper_bound)
    double medium_threshold{40.0};
    double high_threshold{60.0};
    double critical_threshold{80.0};

    /**
     * Strict validation of configuration parameters.
     * Rejects NaN, Inf, negative weights, all-zero weights, and non-unitary sums.
     */
    ConfigValidationResult Validate() const noexcept;
};

/**
 * Complete evaluation result for an incident.
 * Contains score breakdowns, unrounded total score, classified tier, and tie-breaking attributes.
 */
struct PriorityScoreResult {
    uint64_t incident_id{0};
    bool is_valid{false};
    std::string error_message;

    // Cached attributes for self-contained canonical comparator ordering
    uint32_t severity{0};
    uint32_t victim_count{0};
    uint64_t waiting_duration_ms{0};           // Evaluated duration (evaluated_at_ms - created_at_ms)

    // Normalized components in [0.0, 100.0]
    double normalized_severity_score{0.0};
    double normalized_victim_score{0.0};
    double normalized_waiting_score{0.0};

    // Unrounded composite score in [0.0, 100.0]
    double total_priority_score{0.0};

    // Triage tier classification (derived from unrounded total_priority_score)
    PriorityTier tier{PriorityTier::LOW};
};

/**
 * Canonical deterministic comparator for batch sorting and priority-queue dispatch.
 * Implements strict weak ordering (strict total order on distinct incident_ids).
 * Defines defensive ordering for invalid records (valid records strictly precede invalid records).
 */
struct PriorityComparator {
    bool operator()(const PriorityScoreResult& a, const PriorityScoreResult& b) const noexcept;
};

/**
 * Standalone Emergency Priority Scoring Engine.
 * Decoupled from graph and routing infrastructure for ultra-high throughput evaluation.
 */
class PriorityEngine {
public:
    /**
     * Constructs the engine with the provided configuration.
     * Validates the configuration on construction.
     */
    explicit PriorityEngine(const PriorityConfig& config = PriorityConfig{});

    /**
     * Evaluates a single emergency incident at the explicitly specified evaluation timestamp.
     * Never accesses the system wall clock internally.
     *
     * @param incident Incident record with 5 core attributes.
     * @param evaluated_at_ms Unix epoch timestamp (milliseconds) representing current evaluation time.
     * @return PriorityScoreResult containing normalized breakdown, unrounded score, and tier.
     */
    PriorityScoreResult EvaluateIncident(const IncidentRecord& incident, uint64_t evaluated_at_ms) const noexcept;

    /**
     * Batch evaluates multiple incidents at a uniform evaluation timestamp.
     *
     * @param incidents Vector of incident records.
     * @param evaluated_at_ms Explicit evaluation timestamp applied across all incidents.
     * @return Vector of PriorityScoreResults in 1-to-1 correspondence with the input.
     */
    std::vector<PriorityScoreResult> EvaluateBatch(const std::vector<IncidentRecord>& incidents,
                                                  uint64_t evaluated_at_ms) const;

    /**
     * Returns the active configuration.
     */
    const PriorityConfig& GetConfig() const noexcept { return config_; }

    /**
     * Updates the engine configuration with strict validation.
     * Returns ConfigValidationResult indicating success or specific validation failure.
     */
    ConfigValidationResult SetConfig(const PriorityConfig& config) noexcept;

    /**
     * Classifies a numerical unrounded score into a PriorityTier using active thresholds.
     */
    PriorityTier ClassifyTier(double score) const noexcept;

private:
    PriorityConfig config_;
    ConfigValidationResult config_status_;
};

} // namespace Priority
} // namespace EmergencyRouting

