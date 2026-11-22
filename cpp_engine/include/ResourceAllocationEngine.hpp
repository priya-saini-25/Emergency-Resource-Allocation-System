#pragma once

#include "Graph.hpp"
#include "SpatialGrid.hpp"
#include "BoundaryValidator.hpp"
#include "Dijkstra.hpp"
#include "PriorityEngine.hpp"

#include <cstdint>
#include <string>
#include <vector>
#include <unordered_map>
#include <limits>
#include <cmath>
#include <algorithm>

namespace EmergencyRouting {
namespace Allocation {

/**
 * Supported emergency resource equipment types.
 */
enum class ResourceType : uint8_t {
    ALS_AMBULANCE = 0,    // Advanced Life Support Ambulance (Medical)
    BLS_AMBULANCE = 1,    // Basic Life Support Ambulance (Medical)
    FIRE_ENGINE = 2,      // Fire Engine / Pumper (Fire & Industrial)
    FIRE_TENDER = 3,      // Water / Foam Fire Tender (Fire & Industrial)
    RESCUE_VEHICLE = 4    // Heavy Rescue Vehicle (Road Accident & Industrial)
};

inline std::string ResourceTypeToString(ResourceType type) {
    switch (type) {
        case ResourceType::ALS_AMBULANCE: return "ALS_AMBULANCE";
        case ResourceType::BLS_AMBULANCE: return "BLS_AMBULANCE";
        case ResourceType::FIRE_ENGINE: return "FIRE_ENGINE";
        case ResourceType::FIRE_TENDER: return "FIRE_TENDER";
        case ResourceType::RESCUE_VEHICLE: return "RESCUE_VEHICLE";
        default: return "UNKNOWN";
    }
}

/**
 * Operational availability status of emergency resources.
 */
enum class AvailabilityStatus : uint8_t {
    AVAILABLE = 0,       // Ready for immediate dispatch recommendation
    RESERVED = 1,        // Temporarily held for pending incident confirmation
    DISPATCHED = 2,      // Actively en route or deployed on scene
    OUT_OF_SERVICE = 3   // Maintenance, off-shift, or mechanical failure
};

inline std::string AvailabilityStatusToString(AvailabilityStatus status) {
    switch (status) {
        case AvailabilityStatus::AVAILABLE: return "AVAILABLE";
        case AvailabilityStatus::RESERVED: return "RESERVED";
        case AvailabilityStatus::DISPATCHED: return "DISPATCHED";
        case AvailabilityStatus::OUT_OF_SERVICE: return "OUT_OF_SERVICE";
        default: return "UNKNOWN";
    }
}

/**
 * Emergency resource record representing a mobile response asset.
 */
struct ResourceRecord {
    uint64_t resource_id{0};                           // Unique non-zero asset identifier
    ResourceType resource_type{ResourceType::ALS_AMBULANCE};
    AvailabilityStatus availability_status{AvailabilityStatus::AVAILABLE};
    double latitude{0.0};                              // WGS-84 latitude in degrees
    double longitude{0.0};                             // WGS-84 longitude in degrees
    int64_t current_node_osm_id{0};                    // Optional pre-snapped node OSM ID (0 if using coordinates)
    uint32_t capacity{1};                              // Crew / patient capacity (must be >= 1)
    uint64_t assigned_incident_id{0};                  // 0 if unassigned; non-zero if actively assigned
};

/**
 * Required quantity specification for a specific resource type.
 */
struct ResourceDemand {
    ResourceType type{ResourceType::ALS_AMBULANCE};
    uint32_t quantity{1};                              // Must be >= 1
};

/**
 * Incident dispatch request specifying incident attributes and requested resource demands.
 */
struct AllocationRequest {
    uint64_t incident_id{0};                           // Unique non-zero incident identifier
    Priority::EmergencyCategory category{Priority::EmergencyCategory::MEDICAL};
    double incident_latitude{0.0};                     // Incident WGS-84 latitude
    double incident_longitude{0.0};                    // Incident WGS-84 longitude
    int64_t incident_node_osm_id{0};                   // Optional pre-snapped incident node OSM ID
    std::vector<ResourceDemand> requirements;          // Explicit resource demands
    double max_snap_distance_meters{SpatialGrid::DEFAULT_MAX_SNAP_DISTANCE_METERS};
};

/**
 * Eligibility classification for candidate resources.
 */
enum class CandidateEligibility : uint8_t {
    ELIGIBLE_SELECTED = 0,            // Compatible, available, reachable, and selected
    ELIGIBLE_CANDIDATE = 1,           // Compatible, available, reachable, but surplus
    REJECTED_UNAVAILABLE = 2,         // Status not AVAILABLE
    REJECTED_ALREADY_ASSIGNED = 3,    // assigned_incident_id != 0
    REJECTED_INCOMPATIBLE = 4,        // Type not compatible with incident category
    REJECTED_OUTSIDE_SERVICE_AREA = 5,// Location outside Jodhpur Urban Service Area polygon
    REJECTED_SNAP_FAILED = 6,         // Exceeded max snap distance or invalid coordinates
    REJECTED_UNREACHABLE = 7,         // No directed road-network path to incident
    REJECTED_DUPLICATE_ID = 8,        // Duplicate resource ID in input collection
    REJECTED_INVALID_RECORD = 9       // Invalid ID, non-finite coords, or invalid capacity
};

inline std::string CandidateEligibilityToString(CandidateEligibility el) {
    switch (el) {
        case CandidateEligibility::ELIGIBLE_SELECTED: return "ELIGIBLE_SELECTED";
        case CandidateEligibility::ELIGIBLE_CANDIDATE: return "ELIGIBLE_CANDIDATE";
        case CandidateEligibility::REJECTED_UNAVAILABLE: return "REJECTED_UNAVAILABLE";
        case CandidateEligibility::REJECTED_ALREADY_ASSIGNED: return "REJECTED_ALREADY_ASSIGNED";
        case CandidateEligibility::REJECTED_INCOMPATIBLE: return "REJECTED_INCOMPATIBLE";
        case CandidateEligibility::REJECTED_OUTSIDE_SERVICE_AREA: return "REJECTED_OUTSIDE_SERVICE_AREA";
        case CandidateEligibility::REJECTED_SNAP_FAILED: return "REJECTED_SNAP_FAILED";
        case CandidateEligibility::REJECTED_UNREACHABLE: return "REJECTED_UNREACHABLE";
        case CandidateEligibility::REJECTED_DUPLICATE_ID: return "REJECTED_DUPLICATE_ID";
        case CandidateEligibility::REJECTED_INVALID_RECORD: return "REJECTED_INVALID_RECORD";
        default: return "UNKNOWN";
    }
}

/**
 * Detailed evaluation result for an individual resource candidate.
 */
struct ResourceCandidateResult {
    uint64_t resource_id{0};
    ResourceType resource_type{ResourceType::ALS_AMBULANCE};
    CandidateEligibility eligibility{CandidateEligibility::REJECTED_INVALID_RECORD};
    std::string rejection_reason;

    double latitude{0.0};
    double longitude{0.0};
    int64_t snapped_node_osm_id{0};
    uint32_t snapped_node_internal_idx{0xFFFFFFFF};

    double road_distance_meters{std::numeric_limits<double>::infinity()};
    double estimated_eta_seconds{std::numeric_limits<double>::infinity()};
    bool is_selected{false};
};

/**
 * Overall outcome status of an allocation recommendation.
 */
enum class AllocationStatus : uint8_t {
    FULLY_ALLOCATED = 0,         // All requested quantities completely satisfied
    PARTIALLY_ALLOCATED = 1,     // Some resources allocated, but one or more shortages exist
    NO_RESOURCES_AVAILABLE = 2,  // Compatible resource types exist, but none available or reachable
    NO_COMPATIBLE_RESOURCES = 3, // No compatible resource types defined for incident category
    INVALID_REQUEST = 4          // Validation failure on incident, coordinates, or requirements
};

inline std::string AllocationStatusToString(AllocationStatus st) {
    switch (st) {
        case AllocationStatus::FULLY_ALLOCATED: return "FULLY_ALLOCATED";
        case AllocationStatus::PARTIALLY_ALLOCATED: return "PARTIALLY_ALLOCATED";
        case AllocationStatus::NO_RESOURCES_AVAILABLE: return "NO_RESOURCES_AVAILABLE";
        case AllocationStatus::NO_COMPATIBLE_RESOURCES: return "NO_COMPATIBLE_RESOURCES";
        case AllocationStatus::INVALID_REQUEST: return "INVALID_REQUEST";
        default: return "UNKNOWN";
    }
}

/**
 * Summary breakdown of demand, fulfillment, and shortage for a single resource type.
 */
struct TypeShortage {
    ResourceType resource_type{ResourceType::ALS_AMBULANCE};
    uint32_t requested_quantity{0};
    uint32_t allocated_quantity{0};
    uint32_t shortage_quantity{0};
};

/**
 * Complete structured allocation recommendation returned by the engine.
 */
struct AllocationResult {
    uint64_t incident_id{0};
    AllocationStatus status{AllocationStatus::INVALID_REQUEST};
    std::string status_message;

    int64_t incident_snapped_osm_id{0};
    uint32_t incident_snapped_node_idx{0xFFFFFFFF};

    // Demand and fulfillment summary
    std::vector<TypeShortage> requirements_summary;
    uint32_t total_requested_resources{0};
    uint32_t total_allocated_resources{0};

    // Selected resources recommended for dispatch
    std::vector<ResourceCandidateResult> selected_resources;

    // Full candidate audit trail (including rejected and surplus resources)
    std::vector<ResourceCandidateResult> candidate_evaluations;

    // Diagnostic timing
    double processing_time_ms{0.0};
};

/**
 * Configurable simulation speed policy for travel-time estimation.
 */
struct SpeedConfig {
    double als_ambulance_kmh{35.0};
    double bls_ambulance_kmh{35.0};
    double fire_engine_kmh{25.0};
    double fire_tender_kmh{25.0};
    double rescue_vehicle_kmh{30.0};

    double GetSpeedKmh(ResourceType type) const noexcept {
        switch (type) {
            case ResourceType::ALS_AMBULANCE: return als_ambulance_kmh;
            case ResourceType::BLS_AMBULANCE: return bls_ambulance_kmh;
            case ResourceType::FIRE_ENGINE: return fire_engine_kmh;
            case ResourceType::FIRE_TENDER: return fire_tender_kmh;
            case ResourceType::RESCUE_VEHICLE: return rescue_vehicle_kmh;
            default: return 30.0;
        }
    }

    bool Validate() const noexcept {
        return std::isfinite(als_ambulance_kmh) && als_ambulance_kmh > 0.0 &&
               std::isfinite(bls_ambulance_kmh) && bls_ambulance_kmh > 0.0 &&
               std::isfinite(fire_engine_kmh) && fire_engine_kmh > 0.0 &&
               std::isfinite(fire_tender_kmh) && fire_tender_kmh > 0.0 &&
               std::isfinite(rescue_vehicle_kmh) && rescue_vehicle_kmh > 0.0;
    }
};

/**
 * Configurable compatibility policy governing which resource types are eligible for incident categories.
 */
class CompatibilityPolicy {
public:
    CompatibilityPolicy() {
        SetDefaultRules();
    }

    void SetDefaultRules() {
        rules_.clear();
        rules_[Priority::EmergencyCategory::MEDICAL] = {
            ResourceType::ALS_AMBULANCE, ResourceType::BLS_AMBULANCE
        };
        rules_[Priority::EmergencyCategory::ROAD_ACCIDENT] = {
            ResourceType::ALS_AMBULANCE, ResourceType::BLS_AMBULANCE, ResourceType::RESCUE_VEHICLE
        };
        rules_[Priority::EmergencyCategory::FIRE] = {
            ResourceType::FIRE_ENGINE, ResourceType::FIRE_TENDER, ResourceType::BLS_AMBULANCE
        };
        rules_[Priority::EmergencyCategory::INDUSTRIAL] = {
            ResourceType::FIRE_ENGINE, ResourceType::FIRE_TENDER, ResourceType::RESCUE_VEHICLE, ResourceType::ALS_AMBULANCE
        };
        rules_[Priority::EmergencyCategory::STRUCTURAL_COLLAPSE] = {
            ResourceType::RESCUE_VEHICLE, ResourceType::FIRE_ENGINE, ResourceType::ALS_AMBULANCE, ResourceType::BLS_AMBULANCE
        };
        rules_[Priority::EmergencyCategory::OTHER] = {
            ResourceType::BLS_AMBULANCE, ResourceType::ALS_AMBULANCE
        };
        // HAZMAT, NATURAL_DISASTER, and CIVIL_DISTURBANCE require specialized apparatus/tactical units
        // not present in the standard prototype vehicle fleet, so rules_ has no entries for them.
    }

    bool IsCompatible(Priority::EmergencyCategory cat, ResourceType type) const noexcept {
        auto it = rules_.find(cat);
        if (it == rules_.end()) return false;
        const auto& vec = it->second;
        return std::find(vec.begin(), vec.end(), type) != vec.end();
    }

    std::vector<ResourceType> GetCompatibleTypes(Priority::EmergencyCategory cat) const {
        auto it = rules_.find(cat);
        if (it == rules_.end()) return {};
        return it->second;
    }

    void SetRule(Priority::EmergencyCategory cat, const std::vector<ResourceType>& types) {
        rules_[cat] = types;
    }

    void Clear() noexcept {
        rules_.clear();
    }

private:
    std::unordered_map<Priority::EmergencyCategory, std::vector<ResourceType>> rules_;
};

/**
 * High-performance, geographically aware Emergency Resource Allocation Engine.
 */
class ResourceAllocationEngine {
public:
    /**
     * Constructs the engine using existing approved graph, spatial grid, and boundary validator dependencies.
     */
    ResourceAllocationEngine(const Graph& graph,
                             const SpatialGrid& spatial_grid,
                             const BoundaryValidator* boundary_validator = nullptr);

    /**
     * Recommends optimal compatible available resources for the given emergency incident request.
     * Does not mutate resource records or persist reservations (recommendation only).
     *
     * @param request Incident request specifying location, category, and resource demands.
     * @param candidate_resources Available pool of candidate emergency resources.
     * @return AllocationResult containing selected resources, shortages, and candidate audit trail.
     */
    AllocationResult AllocateResources(
        const AllocationRequest& request,
        const std::vector<ResourceRecord>& candidate_resources) const;

    // Policy accessors and mutators
    const SpeedConfig& GetSpeedConfig() const noexcept { return speed_config_; }
    void SetSpeedConfig(const SpeedConfig& config) noexcept { speed_config_ = config; }

    const CompatibilityPolicy& GetCompatibilityPolicy() const noexcept { return compatibility_policy_; }
    void SetCompatibilityPolicy(const CompatibilityPolicy& policy) noexcept { compatibility_policy_ = policy; }

    /**
     * Automatic default requirement generator when callers omit explicit requirements.
     * Academic simulation defaults:
     * - MEDICAL: 1 ALS, 1 BLS
     * - FIRE: 1 Fire Engine, 1 Fire Tender
     * - ROAD_ACCIDENT: 1 ALS, 1 Rescue Vehicle
     * - INDUSTRIAL: 1 Fire Engine, 1 Fire Tender, 1 Rescue Vehicle
     */
    static std::vector<ResourceDemand> GetDefaultRequirements(Priority::EmergencyCategory category);

private:
    const Graph& graph_;
    const SpatialGrid& spatial_grid_;
    const BoundaryValidator* boundary_validator_;
    DijkstraRouter router_;

    SpeedConfig speed_config_;
    CompatibilityPolicy compatibility_policy_;
};

} // namespace Allocation
} // namespace EmergencyRouting

