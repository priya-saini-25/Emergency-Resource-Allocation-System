#pragma once

#include "Graph.hpp"
#include "Dijkstra.hpp"
#include "SpatialGrid.hpp"
#include "BoundaryValidator.hpp"
#include "PriorityEngine.hpp"

#include <cstdint>
#include <string>
#include <vector>
#include <limits>
#include <chrono>
#include <cmath>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>

namespace EmergencyRouting {
namespace Hospital {

/**
 * Operational availability status of a hospital facility.
 * Only OPERATIONAL facilities may be recommended as fully suitable.
 */
enum class HospitalStatus : uint8_t {
    OPERATIONAL = 0,             // Normal emergency services active
    TEMPORARILY_UNAVAILABLE = 1, // On emergency diversion, decontamination, or localized power/equipment fault
    CLOSED = 2                   // Facility closed or non-operational
};

inline std::string HospitalStatusToString(HospitalStatus status) {
    switch (status) {
        case HospitalStatus::OPERATIONAL: return "OPERATIONAL";
        case HospitalStatus::TEMPORARILY_UNAVAILABLE: return "TEMPORARILY_UNAVAILABLE";
        case HospitalStatus::CLOSED: return "CLOSED";
        default: return "UNKNOWN";
    }
}

/**
 * Strongly typed bitmask flags for emergency clinical capabilities.
 * NOTE: Academic simulation proxy capabilities; not an official clinical certification.
 */
enum class HospitalCapability : uint32_t {
    NONE               = 0,
    GENERAL_EMERGENCY  = 1 << 0,  // Basic 24/7 ER reception and stabilization
    TRAUMA             = 1 << 1,  // Level 1/2 Trauma Resuscitation Center
    ICU                = 1 << 2,  // Intensive Care Unit with mechanical ventilation
    OXYGEN_SUPPORT     = 1 << 3,  // High-flow oxygen and medical gas pipeline
    BURN_TREATMENT     = 1 << 4,  // Specialized Burn Unit and thermal trauma care
    SURGICAL_SUPPORT   = 1 << 5   // 24/7 Emergency Operating Theatres
};

inline constexpr HospitalCapability operator|(HospitalCapability a, HospitalCapability b) noexcept {
    return static_cast<HospitalCapability>(static_cast<uint32_t>(a) | static_cast<uint32_t>(b));
}

inline constexpr HospitalCapability operator&(HospitalCapability a, HospitalCapability b) noexcept {
    return static_cast<HospitalCapability>(static_cast<uint32_t>(a) & static_cast<uint32_t>(b));
}

inline constexpr HospitalCapability operator~(HospitalCapability a) noexcept {
    return static_cast<HospitalCapability>(~static_cast<uint32_t>(a));
}

inline constexpr bool HasCapability(HospitalCapability set, HospitalCapability cap) noexcept {
    return (static_cast<uint32_t>(set) & static_cast<uint32_t>(cap)) == static_cast<uint32_t>(cap);
}

inline std::string HospitalCapabilityToString(HospitalCapability cap) {
    switch (cap) {
        case HospitalCapability::GENERAL_EMERGENCY: return "GENERAL_EMERGENCY";
        case HospitalCapability::TRAUMA: return "TRAUMA";
        case HospitalCapability::ICU: return "ICU";
        case HospitalCapability::OXYGEN_SUPPORT: return "OXYGEN_SUPPORT";
        case HospitalCapability::BURN_TREATMENT: return "BURN_TREATMENT";
        case HospitalCapability::SURGICAL_SUPPORT: return "SURGICAL_SUPPORT";
        default: return "NONE";
    }
}

inline std::vector<HospitalCapability> DecomposeCapabilities(HospitalCapability caps) {
    std::vector<HospitalCapability> res;
    static const HospitalCapability all_caps[] = {
        HospitalCapability::GENERAL_EMERGENCY,
        HospitalCapability::TRAUMA,
        HospitalCapability::ICU,
        HospitalCapability::OXYGEN_SUPPORT,
        HospitalCapability::BURN_TREATMENT,
        HospitalCapability::SURGICAL_SUPPORT
    };
    for (auto c : all_caps) {
        if (HasCapability(caps, c)) {
            res.push_back(c);
        }
    }
    return res;
}

/**
 * Strongly typed representation of a hospital facility in the emergency network.
 */
struct HospitalRecord {
    uint64_t hospital_id{0};                           // Unique positive non-zero identifier
    std::string hospital_name;                         // Facility name
    double latitude{0.0};                              // WGS-84 latitude (degrees)
    double longitude{0.0};                             // WGS-84 longitude (degrees)
    int64_t current_node_osm_id{0};                    // Optional prevalidated graph node OSM ID (0 if using coordinates)

    HospitalStatus hospital_status{HospitalStatus::OPERATIONAL};
    HospitalCapability emergency_capabilities{HospitalCapability::NONE};

    // Capacity dimensions (modeled as distinct non-additive categories)
    uint32_t icu_beds_total{0};
    uint32_t icu_beds_available{0};
    uint32_t general_beds_total{0};
    uint32_t general_beds_available{0};
    uint32_t oxygen_supported_beds_total{0};
    uint32_t oxygen_supported_beds_available{0};
};

/**
 * Emergency hospital requirement specification for an incident.
 */
struct HospitalRequirement {
    Priority::EmergencyCategory category{Priority::EmergencyCategory::MEDICAL};
    HospitalCapability required_capabilities{HospitalCapability::NONE};

    // Required capacity dimensions
    uint32_t required_icu_beds{0};
    uint32_t required_general_beds{0};
    uint32_t required_oxygen_beds{0};

    /**
     * Factory for academic simulation default requirements by category.
     * All defaults can be overridden by explicit incident-level requirements.
     */
    static HospitalRequirement CreateDefault(Priority::EmergencyCategory cat) {
        HospitalRequirement req;
        req.category = cat;
        switch (cat) {
            case Priority::EmergencyCategory::MEDICAL:
                req.required_capabilities = HospitalCapability::GENERAL_EMERGENCY;
                req.required_general_beds = 1;
                break;
            case Priority::EmergencyCategory::ROAD_ACCIDENT:
                req.required_capabilities = HospitalCapability::GENERAL_EMERGENCY |
                                            HospitalCapability::TRAUMA |
                                            HospitalCapability::SURGICAL_SUPPORT;
                req.required_general_beds = 1;
                req.required_icu_beds = 1;
                break;
            case Priority::EmergencyCategory::FIRE:
                req.required_capabilities = HospitalCapability::GENERAL_EMERGENCY |
                                            HospitalCapability::BURN_TREATMENT |
                                            HospitalCapability::OXYGEN_SUPPORT;
                req.required_general_beds = 1;
                req.required_oxygen_beds = 1;
                break;
            case Priority::EmergencyCategory::INDUSTRIAL:
                req.required_capabilities = HospitalCapability::GENERAL_EMERGENCY |
                                            HospitalCapability::TRAUMA |
                                            HospitalCapability::BURN_TREATMENT |
                                            HospitalCapability::OXYGEN_SUPPORT;
                req.required_general_beds = 1;
                req.required_icu_beds = 1;
                req.required_oxygen_beds = 1;
                break;
            case Priority::EmergencyCategory::STRUCTURAL_COLLAPSE:
                req.required_capabilities = HospitalCapability::GENERAL_EMERGENCY |
                                            HospitalCapability::TRAUMA |
                                            HospitalCapability::ICU;
                req.required_general_beds = 1;
                req.required_icu_beds = 1;
                break;
            case Priority::EmergencyCategory::HAZMAT:
                req.required_capabilities = HospitalCapability::GENERAL_EMERGENCY |
                                            HospitalCapability::OXYGEN_SUPPORT |
                                            HospitalCapability::BURN_TREATMENT;
                req.required_general_beds = 1;
                req.required_oxygen_beds = 1;
                break;
            case Priority::EmergencyCategory::NATURAL_DISASTER:
            case Priority::EmergencyCategory::CIVIL_DISTURBANCE:
                req.required_capabilities = HospitalCapability::GENERAL_EMERGENCY |
                                            HospitalCapability::TRAUMA;
                req.required_general_beds = 1;
                break;
            case Priority::EmergencyCategory::OTHER:
            default:
                req.required_capabilities = HospitalCapability::GENERAL_EMERGENCY;
                req.required_general_beds = 1;
                break;
        }
        return req;
    }
};

/**
 * Request payload for hospital matching evaluation.
 */
struct HospitalMatchRequest {
    uint64_t incident_id{0};                           // Unique positive incident ID
    double incident_latitude{0.0};                     // WGS-84 latitude
    double incident_longitude{0.0};                    // WGS-84 longitude
    int64_t incident_node_osm_id{0};                   // Optional pre-snapped incident node OSM ID
    HospitalRequirement requirements;                  // Clinical requirements
    double max_snap_distance_meters{SpatialGrid::DEFAULT_MAX_SNAP_DISTANCE_METERS};
    double simulated_speed_kmh{30.0};                  // Default simulated ambulance transit speed
};

/**
 * Suitability classification for a single evaluated hospital candidate.
 */
enum class HospitalSuitability : uint8_t {
    FULLY_SUITABLE          = 0, // Operational, all capabilities met, all capacities met, within boundary, reachable
    CAPABILITY_MISMATCH     = 1, // Operational and reachable, but missing mandatory clinical capabilities
    CAPACITY_INSUFFICIENT   = 2, // Operational, capabilities met, reachable, but has bed shortages
    OUTSIDE_SERVICE_AREA    = 3, // Facility coordinates outside Jodhpur Urban Service Area boundary
    INVALID_LOCATION        = 4, // Non-finite or out-of-range coordinates
    SNAP_FAILED             = 5, // Nearest road node exceeds maximum snap distance threshold
    UNREACHABLE             = 6, // No directed road path from incident to hospital
    HOSPITAL_UNAVAILABLE    = 7, // Hospital status is TEMPORARILY_UNAVAILABLE or CLOSED
    INVALID_HOSPITAL_RECORD = 8  // Corrupt record (invalid ID, avail > total, empty name, etc.)
};

inline std::string HospitalSuitabilityToString(HospitalSuitability s) {
    switch (s) {
        case HospitalSuitability::FULLY_SUITABLE: return "FULLY_SUITABLE";
        case HospitalSuitability::CAPABILITY_MISMATCH: return "CAPABILITY_MISMATCH";
        case HospitalSuitability::CAPACITY_INSUFFICIENT: return "CAPACITY_INSUFFICIENT";
        case HospitalSuitability::OUTSIDE_SERVICE_AREA: return "OUTSIDE_SERVICE_AREA";
        case HospitalSuitability::INVALID_LOCATION: return "INVALID_LOCATION";
        case HospitalSuitability::SNAP_FAILED: return "SNAP_FAILED";
        case HospitalSuitability::UNREACHABLE: return "UNREACHABLE";
        case HospitalSuitability::HOSPITAL_UNAVAILABLE: return "HOSPITAL_UNAVAILABLE";
        case HospitalSuitability::INVALID_HOSPITAL_RECORD: return "INVALID_HOSPITAL_RECORD";
        default: return "UNKNOWN";
    }
}

/**
 * Granular evaluation result for a single candidate hospital.
 */
struct HospitalCandidateResult {
    uint64_t hospital_id{0};
    std::string hospital_name;
    HospitalStatus operational_status{HospitalStatus::CLOSED};
    HospitalSuitability suitability{HospitalSuitability::INVALID_HOSPITAL_RECORD};
    bool is_reachable{false};
    int64_t hospital_node_osm_id{0};

    // Directed road routing metrics (Incident -> Hospital)
    double road_distance_meters{std::numeric_limits<double>::infinity()};
    double simulated_eta_seconds{std::numeric_limits<double>::infinity()};

    // Shortage and capability mismatch reporting
    std::vector<HospitalCapability> missing_capabilities;
    uint32_t icu_bed_shortage{0};
    uint32_t general_bed_shortage{0};
    uint32_t oxygen_bed_shortage{0};

    // Capacity sum for relevant demanded dimensions (used for tie-breaking)
    uint32_t total_relevant_available_capacity{0};

    std::string rejection_reason;
    std::vector<int64_t> path_node_osm_ids;
};

/**
 * High-level matching status for the overall recommendation query.
 */
enum class HospitalMatchStatus : uint8_t {
    SUITABLE_HOSPITALS_FOUND  = 0, // One or more FULLY_SUITABLE hospitals identified
    PARTIAL_ALTERNATIVES_ONLY = 1, // No fully suitable hospitals, but partial alternatives found
    NO_SUITABLE_HOSPITAL      = 2, // Evaluated candidates were operational/reachable, but all unsuitable
    NO_HOSPITALS_AVAILABLE    = 3, // Candidate pool empty or all facilities closed/unavailable
    INVALID_REQUEST           = 4  // Malformed incident parameters or coordinates
};

inline std::string HospitalMatchStatusToString(HospitalMatchStatus s) {
    switch (s) {
        case HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND: return "SUITABLE_HOSPITALS_FOUND";
        case HospitalMatchStatus::PARTIAL_ALTERNATIVES_ONLY: return "PARTIAL_ALTERNATIVES_ONLY";
        case HospitalMatchStatus::NO_SUITABLE_HOSPITAL: return "NO_SUITABLE_HOSPITAL";
        case HospitalMatchStatus::NO_HOSPITALS_AVAILABLE: return "NO_HOSPITALS_AVAILABLE";
        case HospitalMatchStatus::INVALID_REQUEST: return "INVALID_REQUEST";
        default: return "UNKNOWN";
    }
}

/**
 * Complete recommendation response returned by the matching engine.
 */
struct HospitalMatchingResult {
    uint64_t incident_id{0};
    HospitalMatchStatus status{HospitalMatchStatus::INVALID_REQUEST};
    std::string error_message;
    HospitalRequirement requirements_evaluated;

    // Structured candidate groups
    std::vector<HospitalCandidateResult> suitable_hospitals;     // Fully suitable, deterministically ranked
    std::vector<HospitalCandidateResult> partial_alternatives;   // Sub-optimal alternatives, deterministically ranked
    std::vector<HospitalCandidateResult> unavailable_hospitals; // Closed or diversion facilities
    std::vector<HospitalCandidateResult> unreachable_hospitals; // Operational facilities with no forward road path
    std::vector<HospitalCandidateResult> invalid_hospitals;     // Corrupt records, out-of-bounds, snap failures

    size_t total_candidates_evaluated{0};
    double computation_time_ms{0.0};
};

/**
 * Deterministic hospital recommendation engine for emergency medical response in Jodhpur.
 * Coordinates clinical capability filtering, capacity verification, boundary snapping,
 * and authentic directed road-network routing (Incident -> Hospital).
 */
class HospitalMatchingEngine {
public:
    HospitalMatchingEngine(const Graph& graph,
                           const SpatialGrid& spatial_grid,
                           const BoundaryValidator* boundary_validator = nullptr);

    /**
     * Evaluate a candidate hospital collection against an incident match request.
     * Thread-safe; read-only operations on Graph, SpatialGrid, and BoundaryValidator.
     */
    HospitalMatchingResult MatchHospitals(
        const HospitalMatchRequest& request,
        const std::vector<HospitalRecord>& hospitals) const;

    /**
     * Validate internal consistency of a single hospital record.
     */
    static bool ValidateHospitalRecord(const HospitalRecord& record, std::string& error_out);

private:
    const Graph& graph_;
    const SpatialGrid& spatial_grid_;
    const BoundaryValidator* boundary_validator_;
};

} // namespace Hospital
} // namespace EmergencyRouting

