#include "PriorityEngine.hpp"
#include <sstream>

namespace EmergencyRouting {
namespace Priority {

ConfigValidationResult PriorityConfig::Validate() const noexcept {
    ConfigValidationResult result;

    // 1. Finite checks for weights
    if (!std::isfinite(severity_weight) || !std::isfinite(victim_weight) || !std::isfinite(waiting_weight)) {
        result.is_valid = false;
        result.error_message = "Weights must be finite numbers (NaN and Infinity are not permitted)";
        return result;
    }

    // 2. Non-negative weights
    if (severity_weight < 0.0 || victim_weight < 0.0 || waiting_weight < 0.0) {
        result.is_valid = false;
        result.error_message = "Weights must be non-negative";
        return result;
    }

    // 3. Non-zero sum
    const double sum = severity_weight + victim_weight + waiting_weight;
    if (sum == 0.0) {
        result.is_valid = false;
        result.error_message = "All-zero weights are not permitted";
        return result;
    }

    // 4. Unit sum within tolerance of 1e-6 (No silent normalization)
    if (std::abs(sum - 1.0) > 1e-6) {
        result.is_valid = false;
        result.error_message = "Weights sum to " + std::to_string(sum) +
                               ", but must equal 1.0 within tolerance of 1e-6";
        return result;
    }

    // 5. Tier thresholds validation
    if (!std::isfinite(medium_threshold) || !std::isfinite(high_threshold) || !std::isfinite(critical_threshold)) {
        result.is_valid = false;
        result.error_message = "Tier thresholds must be finite numbers";
        return result;
    }

    if (medium_threshold <= 0.0 || high_threshold <= medium_threshold ||
        critical_threshold <= high_threshold || critical_threshold >= 100.0) {
        result.is_valid = false;
        result.error_message = "Thresholds must satisfy: 0.0 < medium (" + std::to_string(medium_threshold) +
                               ") < high (" + std::to_string(high_threshold) +
                               ") < critical (" + std::to_string(critical_threshold) + ") < 100.0";
        return result;
    }

    // 6. Severity range validation
    if (min_severity < 1 || max_severity <= min_severity) {
        result.is_valid = false;
        result.error_message = "Severity bounds must satisfy: min >= 1 and max > min";
        return result;
    }

    // 7. Saturation parameters
    if (max_victim_saturation == 0) {
        result.is_valid = false;
        result.error_message = "max_victim_saturation must be strictly positive";
        return result;
    }

    if (max_waiting_time_ms == 0) {
        result.is_valid = false;
        result.error_message = "max_waiting_time_ms must be strictly positive";
        return result;
    }

    result.is_valid = true;
    result.error_message.clear();
    return result;
}

bool PriorityComparator::operator()(const PriorityScoreResult& a,
                                    const PriorityScoreResult& b) const noexcept {
    // Defensive check: valid results strictly precede invalid results
    if (a.is_valid != b.is_valid) {
        return a.is_valid && !b.is_valid;
    }

    // If both are invalid, order by smaller incident_id for determinism
    if (!a.is_valid && !b.is_valid) {
        return a.incident_id < b.incident_id;
    }

    // Both valid: strict lexicographical comparison
    // 1. Primary: Higher total priority score (descending)
    if (a.total_priority_score != b.total_priority_score) {
        return a.total_priority_score > b.total_priority_score;
    }

    // 2. Secondary: Higher severity level (descending)
    if (a.severity != b.severity) {
        return a.severity > b.severity;
    }

    // 3. Tertiary: Higher victim count (descending)
    if (a.victim_count != b.victim_count) {
        return a.victim_count > b.victim_count;
    }

    // 4. Quaternary: Longer waiting duration (descending)
    if (a.waiting_duration_ms != b.waiting_duration_ms) {
        return a.waiting_duration_ms > b.waiting_duration_ms;
    }

    // 5. Quinary: Smaller incident ID (ascending arbiter)
    return a.incident_id < b.incident_id;
}

PriorityEngine::PriorityEngine(const PriorityConfig& config)
    : config_(config), config_status_(config.Validate()) {}

ConfigValidationResult PriorityEngine::SetConfig(const PriorityConfig& config) noexcept {
    ConfigValidationResult val = config.Validate();
    if (val.is_valid) {
        config_ = config;
        config_status_ = val;
    }
    return val;
}

PriorityTier PriorityEngine::ClassifyTier(double score) const noexcept {
    if (score >= config_.critical_threshold) {
        return PriorityTier::CRITICAL;
    }
    if (score >= config_.high_threshold) {
        return PriorityTier::HIGH;
    }
    if (score >= config_.medium_threshold) {
        return PriorityTier::MEDIUM;
    }
    return PriorityTier::LOW;
}

PriorityScoreResult PriorityEngine::EvaluateIncident(const IncidentRecord& incident,
                                                    uint64_t evaluated_at_ms) const noexcept {
    PriorityScoreResult res;
    res.incident_id = incident.incident_id;
    res.severity = incident.severity;
    res.victim_count = incident.victim_count;
    res.is_valid = false;
    res.total_priority_score = 0.0;
    res.tier = PriorityTier::LOW;

    // Guard: Configuration must be valid
    if (!config_status_.is_valid) {
        res.error_message = "Engine configuration is invalid: " + config_status_.error_message;
        return res;
    }

    // 1. Validate Incident ID
    if (incident.incident_id == 0) {
        res.error_message = "Incident ID must be non-zero";
        return res;
    }

    // 2. Validate Category Enum bounds
    if (static_cast<uint8_t>(incident.category) > 8) {
        res.error_message = "Invalid emergency category enum value: " +
                            std::to_string(static_cast<uint32_t>(static_cast<uint8_t>(incident.category)));
        return res;
    }

    // 3. Validate Severity range
    if (incident.severity < config_.min_severity || incident.severity > config_.max_severity) {
        res.error_message = "Severity " + std::to_string(incident.severity) +
                            " out of valid range [" + std::to_string(config_.min_severity) +
                            ", " + std::to_string(config_.max_severity) + "]";
        return res;
    }

    // 4. Validate Creation Timestamp
    if (incident.created_at_ms == 0) {
        res.error_message = "Creation timestamp must be non-zero";
        return res;
    }

    // 5. Validate Evaluation Timestamp (must not precede creation timestamp)
    if (evaluated_at_ms < incident.created_at_ms) {
        res.error_message = "Evaluation timestamp (" + std::to_string(evaluated_at_ms) +
                            " ms) precedes incident creation timestamp (" +
                            std::to_string(incident.created_at_ms) + " ms)";
        return res;
    }

    // Compute waiting duration deterministically
    const uint64_t wait_ms = evaluated_at_ms - incident.created_at_ms;
    res.waiting_duration_ms = wait_ms;

    // Component normalization
    // Severity: [min_severity, max_severity] -> [20.0, 100.0] by default (severity / max_severity * 100.0)
    const double s_norm = (static_cast<double>(incident.severity) /
                           static_cast<double>(config_.max_severity)) * 100.0;

    // Victims: [0, max_victim_saturation] -> [0.0, 100.0]
    const double v_norm = std::min(100.0,
        (static_cast<double>(incident.victim_count) / static_cast<double>(config_.max_victim_saturation)) * 100.0);

    // Waiting time: [0, max_waiting_time_ms] -> [0.0, 100.0]
    const double t_norm = std::min(100.0,
        (static_cast<double>(wait_ms) / static_cast<double>(config_.max_waiting_time_ms)) * 100.0);

    res.normalized_severity_score = s_norm;
    res.normalized_victim_score = v_norm;
    res.normalized_waiting_score = t_norm;

    // Composite scoring
    double raw_score = (config_.severity_weight * s_norm) +
                       (config_.victim_weight * v_norm) +
                       (config_.waiting_weight * t_norm);

    // Mandatory numerical safeguard: NaN/Inf defense and clamp to [0.0, 100.0]
    if (!std::isfinite(raw_score) || std::isnan(raw_score)) {
        raw_score = 0.0;
    }
    res.total_priority_score = std::clamp(raw_score, 0.0, 100.0);

    // Unrounded tier classification
    res.tier = ClassifyTier(res.total_priority_score);

    res.is_valid = true;
    res.error_message.clear();
    return res;
}

std::vector<PriorityScoreResult> PriorityEngine::EvaluateBatch(
    const std::vector<IncidentRecord>& incidents,
    uint64_t evaluated_at_ms) const {

    std::vector<PriorityScoreResult> results;
    results.reserve(incidents.size());
    for (const auto& incident : incidents) {
        results.push_back(EvaluateIncident(incident, evaluated_at_ms));
    }
    return results;
}

} // namespace Priority
} // namespace EmergencyRouting

