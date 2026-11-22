#pragma once

#include "Graph.hpp"
#include "SpatialGrid.hpp"
#include "BoundaryValidator.hpp"
#include "PriorityEngine.hpp"
#include "ResourceAllocationEngine.hpp"
#include "HospitalMatchingEngine.hpp"

#include <cstdint>
#include <string>
#include <vector>
#include <memory>
#include <chrono>
#include <unordered_set>
#include <unordered_map>
#include <algorithm>

namespace EmergencyRouting {
namespace Orchestration {

/**
 * Incident input payload for batch orchestration.
 * Combines incident triage attributes with optional custom resource and hospital requirements.
 */
struct EmergencyIncident {
    uint64_t incident_id{0};                           // Unique positive incident identifier
    Priority::EmergencyCategory category{Priority::EmergencyCategory::MEDICAL};
    uint32_t severity{1};                             // Severity scale: 1 (Minor) to 5 (Catastrophic)
    uint32_t victim_count{0};                         // Number of victims (>= 0)
    uint64_t created_at_ms{0};                        // Unix epoch timestamp (ms) when call was received

    // Location representation: coordinates or pre-snapped node OSM ID
    double latitude{0.0};
    double longitude{0.0};
    int64_t incident_node_osm_id{0};                  // 0 if using lat/lon coordinates

    // Resource and clinical hospital requirements
    std::vector<Allocation::ResourceDemand> resource_demands;
    Hospital::HospitalRequirement hospital_requirements;
    bool has_custom_hospital_requirements{false};

    /**
     * Default resource demand generator based on incident category, severity, and victim count.
     * Used when explicit resource_demands are not provided.
     */
    static std::vector<Allocation::ResourceDemand> CreateDefaultResourceDemands(
        Priority::EmergencyCategory cat, uint32_t severity, uint32_t victim_count) {
        std::vector<Allocation::ResourceDemand> demands;
        switch (cat) {
            case Priority::EmergencyCategory::MEDICAL:
                if (severity >= 4 || victim_count >= 2) {
                    demands.push_back({Allocation::ResourceType::ALS_AMBULANCE, 1});
                    if (victim_count > 1) {
                        demands.push_back({Allocation::ResourceType::BLS_AMBULANCE, victim_count - 1});
                    }
                } else {
                    demands.push_back({Allocation::ResourceType::BLS_AMBULANCE, 1});
                }
                break;
            case Priority::EmergencyCategory::ROAD_ACCIDENT:
                demands.push_back({Allocation::ResourceType::ALS_AMBULANCE, 1});
                demands.push_back({Allocation::ResourceType::RESCUE_VEHICLE, 1});
                if (victim_count > 1) {
                    demands.push_back({Allocation::ResourceType::BLS_AMBULANCE, victim_count - 1});
                }
                break;
            case Priority::EmergencyCategory::FIRE:
                demands.push_back({Allocation::ResourceType::FIRE_ENGINE, 1});
                demands.push_back({Allocation::ResourceType::FIRE_TENDER, 1});
                demands.push_back({Allocation::ResourceType::BLS_AMBULANCE, 1});
                break;
            case Priority::EmergencyCategory::INDUSTRIAL:
                demands.push_back({Allocation::ResourceType::FIRE_ENGINE, 1});
                demands.push_back({Allocation::ResourceType::FIRE_TENDER, 1});
                demands.push_back({Allocation::ResourceType::RESCUE_VEHICLE, 1});
                demands.push_back({Allocation::ResourceType::ALS_AMBULANCE, 1});
                break;
            case Priority::EmergencyCategory::STRUCTURAL_COLLAPSE:
                demands.push_back({Allocation::ResourceType::RESCUE_VEHICLE, 1});
                demands.push_back({Allocation::ResourceType::FIRE_ENGINE, 1});
                demands.push_back({Allocation::ResourceType::ALS_AMBULANCE, 1});
                if (victim_count > 1) {
                    demands.push_back({Allocation::ResourceType::BLS_AMBULANCE, victim_count - 1});
                }
                break;
            case Priority::EmergencyCategory::OTHER:
                if (severity >= 4) {
                    demands.push_back({Allocation::ResourceType::ALS_AMBULANCE, 1});
                } else {
                    demands.push_back({Allocation::ResourceType::BLS_AMBULANCE, 1});
                }
                break;
            case Priority::EmergencyCategory::HAZMAT:
            case Priority::EmergencyCategory::NATURAL_DISASTER:
            case Priority::EmergencyCategory::CIVIL_DISTURBANCE:
            default:
                // Specialized apparatus/tactical units not present in standard prototype vehicle fleet
                break;
        }
        return demands;
    }
};

/**
 * Batch request payload for simultaneous multi-incident dispatch evaluation.
 */
struct DispatchBatchRequest {
    uint64_t batch_id{0};                                             // Unique positive batch ID
    uint64_t evaluated_at_ms{0};                                      // Uniform evaluation timestamp for fair scoring
    std::vector<EmergencyIncident> incidents;                         // Incidents to process
    std::vector<Allocation::ResourceRecord> fleet_snapshot;           // Available vehicle fleet
    std::vector<Hospital::HospitalRecord> hospital_snapshot;         // Available hospital facilities

    // Operational parameters
    double max_snap_distance_meters{SpatialGrid::DEFAULT_MAX_SNAP_DISTANCE_METERS};
    double simulated_hospital_transit_speed_kmh{30.0};
};

/**
 * Composite dispatch recommendation status for an individual incident.
 */
enum class IncidentDispatchStatus : uint8_t {
    FULLY_DISPATCHED = 0,               // Resources fully allocated & suitable hospital recommended
    PARTIALLY_DISPATCHED = 1,            // Partial resources and/or partial hospital alternative
    RESOURCES_ALLOCATED_NO_HOSPITAL = 2, // Resources allocated, but no suitable hospital
    HOSPITAL_FOUND_NO_RESOURCES = 3,     // Suitable hospital found, but no resources available
    UNABLE_TO_DISPATCH = 4,              // Neither resources nor hospital could be allocated
    INVALID_INCIDENT = 5                 // Malformed incident data, coordinates, or category
};

inline std::string IncidentDispatchStatusToString(IncidentDispatchStatus s) {
    switch (s) {
        case IncidentDispatchStatus::FULLY_DISPATCHED: return "FULLY_DISPATCHED";
        case IncidentDispatchStatus::PARTIALLY_DISPATCHED: return "PARTIALLY_DISPATCHED";
        case IncidentDispatchStatus::RESOURCES_ALLOCATED_NO_HOSPITAL: return "RESOURCES_ALLOCATED_NO_HOSPITAL";
        case IncidentDispatchStatus::HOSPITAL_FOUND_NO_RESOURCES: return "HOSPITAL_FOUND_NO_RESOURCES";
        case IncidentDispatchStatus::UNABLE_TO_DISPATCH: return "UNABLE_TO_DISPATCH";
        case IncidentDispatchStatus::INVALID_INCIDENT: return "INVALID_INCIDENT";
        default: return "UNKNOWN";
    }
}

/**
 * Result record for a single processed incident within a batch.
 */
struct IncidentDispatchResult {
    uint64_t incident_id{0};
    size_t processing_order{0};                        // 1-based priority execution sequence
    Priority::PriorityScoreResult priority_result;     // Triage score and tier

    Allocation::AllocationResult resource_allocation;  // Phase 3.9 vehicle allocation
    Hospital::HospitalMatchingResult hospital_match;   // Phase 3.10 hospital match

    IncidentDispatchStatus dispatch_status{IncidentDispatchStatus::INVALID_INCIDENT};
    std::string summary_notes;
};

/**
 * High-level execution status of the batch dispatch planner.
 */
enum class BatchProcessingStatus : uint8_t {
    SUCCESS = 0,             // All valid incidents processed
    PARTIAL_SUCCESS = 1,     // Some incidents processed, some suffered shortages or invalidity
    FAILED = 2,              // No incidents could be dispatched
    INVALID_BATCH = 3        // Batch validation failure (e.g. ID=0, evaluated_at_ms=0)
};

inline std::string BatchProcessingStatusToString(BatchProcessingStatus s) {
    switch (s) {
        case BatchProcessingStatus::SUCCESS: return "SUCCESS";
        case BatchProcessingStatus::PARTIAL_SUCCESS: return "PARTIAL_SUCCESS";
        case BatchProcessingStatus::FAILED: return "FAILED";
        case BatchProcessingStatus::INVALID_BATCH: return "INVALID_BATCH";
        default: return "UNKNOWN";
    }
}

/**
 * Consolidated batch dispatch plan and conflict-prevention audit report.
 */
struct DispatchBatchResult {
    uint64_t batch_id{0};
    uint64_t evaluated_at_ms{0};
    BatchProcessingStatus batch_status{BatchProcessingStatus::INVALID_BATCH};
    std::string error_message;

    std::vector<IncidentDispatchResult> incident_results; // Ordered by execution sequence

    // Incident volume metrics
    size_t total_incidents_received{0};
    size_t valid_incidents{0};
    size_t invalid_incidents{0};

    // Dispatch outcome metrics
    size_t fully_allocated_incidents{0};
    size_t partially_allocated_incidents{0};
    size_t unallocated_incidents{0};

    // Fleet and facility utilization
    size_t total_unique_resources_recommended{0};
    size_t total_hospital_recommendations{0};

    // Conflict prevention metrics
    size_t resource_conflicts_prevented{0};
    size_t hospital_capacity_conflicts_prevented{0};

    // Remaining capacity snapshots after batch plan generation
    size_t remaining_available_resources{0};
    uint32_t remaining_available_icu_beds{0};
    uint32_t remaining_available_general_beds{0};
    uint32_t remaining_available_oxygen_beds{0};

    // Execution time telemetry (ms)
    double total_execution_time_ms{0.0};
    double priority_scoring_time_ms{0.0};
    double resource_orchestration_time_ms{0.0};
    double hospital_orchestration_time_ms{0.0};
};

/**
 * Multi-Incident Dispatch Orchestration Engine.
 * Integrates Phase 3.8 (Priority Scoring), Phase 3.9 (Resource Allocation),
 * and Phase 3.10 (Hospital Matching) to synthesize a globally conflict-free dispatch recommendation.
 */
class DispatchOrchestrator {
public:
    DispatchOrchestrator(const Graph& graph,
                         const SpatialGrid& spatial_grid,
                         const BoundaryValidator* boundary_validator = nullptr,
                         const Priority::PriorityConfig& priority_config = Priority::PriorityConfig{});

    /**
     * Orchestrate multi-incident batch dispatch recommendations.
     * Thread-safe; strictly read-only on the graph and input request collections.
     */
    DispatchBatchResult ProcessBatch(const DispatchBatchRequest& batch_request) const;

private:
    const Graph& graph_;
    const SpatialGrid& spatial_grid_;
    const BoundaryValidator* boundary_validator_;
    Priority::PriorityEngine priority_engine_;
    Allocation::ResourceAllocationEngine resource_engine_;
    Hospital::HospitalMatchingEngine hospital_engine_;
};

} // namespace Orchestration
} // namespace EmergencyRouting

