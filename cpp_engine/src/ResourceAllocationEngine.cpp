#include "ResourceAllocationEngine.hpp"
#include <chrono>
#include <unordered_set>
#include <algorithm>

namespace EmergencyRouting {
namespace Allocation {

ResourceAllocationEngine::ResourceAllocationEngine(
    const Graph& graph,
    const SpatialGrid& spatial_grid,
    const BoundaryValidator* boundary_validator)
    : graph_(graph),
      spatial_grid_(spatial_grid),
      boundary_validator_(boundary_validator),
      router_(graph) {}

std::vector<ResourceDemand> ResourceAllocationEngine::GetDefaultRequirements(
    Priority::EmergencyCategory category) {
    switch (category) {
        case Priority::EmergencyCategory::MEDICAL:
            return {
                {ResourceType::ALS_AMBULANCE, 1},
                {ResourceType::BLS_AMBULANCE, 1}
            };
        case Priority::EmergencyCategory::FIRE:
            return {
                {ResourceType::FIRE_ENGINE, 1},
                {ResourceType::FIRE_TENDER, 1}
            };
        case Priority::EmergencyCategory::ROAD_ACCIDENT:
            return {
                {ResourceType::ALS_AMBULANCE, 1},
                {ResourceType::RESCUE_VEHICLE, 1}
            };
        case Priority::EmergencyCategory::INDUSTRIAL:
            return {
                {ResourceType::FIRE_ENGINE, 1},
                {ResourceType::FIRE_TENDER, 1},
                {ResourceType::RESCUE_VEHICLE, 1}
            };
        case Priority::EmergencyCategory::STRUCTURAL_COLLAPSE:
            return {
                {ResourceType::RESCUE_VEHICLE, 1},
                {ResourceType::FIRE_ENGINE, 1},
                {ResourceType::ALS_AMBULANCE, 1}
            };
        case Priority::EmergencyCategory::OTHER:
            return {
                {ResourceType::BLS_AMBULANCE, 1}
            };
        case Priority::EmergencyCategory::HAZMAT:
        case Priority::EmergencyCategory::NATURAL_DISASTER:
        case Priority::EmergencyCategory::CIVIL_DISTURBANCE:
        default:
            return {};
    }
}

AllocationResult ResourceAllocationEngine::AllocateResources(
    const AllocationRequest& request,
    const std::vector<ResourceRecord>& candidate_resources) const {

    auto t_start = std::chrono::steady_clock::now();
    AllocationResult res;
    res.incident_id = request.incident_id;
    res.status = AllocationStatus::INVALID_REQUEST;
    res.total_requested_resources = 0;
    res.total_allocated_resources = 0;

    // 1. Validate Incident ID
    if (request.incident_id == 0) {
        res.status_message = "Validation Error: Incident ID must be non-zero";
        return res;
    }

    // 2. Validate Category Enum bounds
    if (static_cast<uint8_t>(request.category) > 8) {
        res.status_message = "Validation Error: Invalid emergency category enum value";
        return res;
    }

    // 3. Validate Speed Policy
    if (!speed_config_.Validate()) {
        res.status_message = "Configuration Error: Invalid speed policy (all speeds must be finite and > 0.0)";
        return res;
    }

    // 4. Validate Requirements
    std::vector<ResourceDemand> demands = request.requirements;
    if (demands.empty()) {
        demands = GetDefaultRequirements(request.category);
    }

    if (demands.empty()) {
        if (request.category == Priority::EmergencyCategory::HAZMAT) {
            res.status = AllocationStatus::NO_COMPATIBLE_RESOURCES;
            res.status_message = "Specialized chemical/HAZMAT containment apparatus required but not available in prototype emergency fleet";
            return res;
        }
        if (request.category == Priority::EmergencyCategory::NATURAL_DISASTER) {
            res.status = AllocationStatus::NO_COMPATIBLE_RESOURCES;
            res.status_message = "Specialized flood/water rescue apparatus required but not available in prototype emergency fleet";
            return res;
        }
        if (request.category == Priority::EmergencyCategory::CIVIL_DISTURBANCE) {
            res.status = AllocationStatus::NO_COMPATIBLE_RESOURCES;
            res.status_message = "Law enforcement / police response units required but not available in fire/EMS simulation prototype fleet";
            return res;
        }
        res.status_message = "Validation Error: No resource requirements specified and no default defined";
        return res;
    }

    // Validate quantities and aggregate demands by type
    std::unordered_map<ResourceType, uint32_t> demand_map;
    for (const auto& d : demands) {
        if (d.quantity == 0) {
            res.status_message = "Validation Error: Requested resource quantity must be strictly positive (> 0)";
            return res;
        }
        demand_map[d.type] += d.quantity;
        res.total_requested_resources += d.quantity;
    }

    // 5. Check Compatibility Policy for Category
    std::vector<ResourceType> compatible_types = compatibility_policy_.GetCompatibleTypes(request.category);
    if (compatible_types.empty()) {
        res.status = AllocationStatus::NO_COMPATIBLE_RESOURCES;
        if (request.category == Priority::EmergencyCategory::HAZMAT) {
            res.status_message = "Specialized chemical/HAZMAT containment apparatus required but not available in prototype emergency fleet";
        } else if (request.category == Priority::EmergencyCategory::NATURAL_DISASTER) {
            res.status_message = "Specialized flood/water rescue apparatus required but not available in prototype emergency fleet";
        } else if (request.category == Priority::EmergencyCategory::CIVIL_DISTURBANCE) {
            res.status_message = "Law enforcement / police response units required but not available in fire/EMS simulation prototype fleet";
        } else {
            res.status_message = "No compatible resource types configured for incident category";
        }
        return res;
    }

    // 6. Validate and Snap Incident Location
    uint32_t incident_node_idx = 0xFFFFFFFF;
    int64_t incident_osm_id = 0;

    if (request.incident_node_osm_id > 0) {
        if (!graph_.TryGetInternalIndex(request.incident_node_osm_id, incident_node_idx)) {
            res.status_message = "Validation Error: Specified incident OSM node ID not found in graph: " +
                                 std::to_string(request.incident_node_osm_id);
            return res;
        }
        incident_osm_id = request.incident_node_osm_id;
    } else {
        // Validate coordinates finiteness and ranges
        if (!std::isfinite(request.incident_latitude) || !std::isfinite(request.incident_longitude) ||
            request.incident_latitude < -90.0 || request.incident_latitude > 90.0 ||
            request.incident_longitude < -180.0 || request.incident_longitude > 180.0) {
            res.status_message = "Validation Error: Non-finite or out-of-range incident coordinates";
            return res;
        }

        SnapResult inc_snap = spatial_grid_.SnapCoordinate(
            request.incident_latitude,
            request.incident_longitude,
            SnapPolicy::STRICT_INTERIOR_ONLY,
            boundary_validator_,
            request.max_snap_distance_meters);

        if (!inc_snap.found) {
            res.status_message = "Incident location snapping failed: " + SnapStatusToString(inc_snap.status);
            return res;
        }

        incident_node_idx = inc_snap.snapped_internal_index;
        incident_osm_id = inc_snap.snapped_osm_id;
    }

    res.incident_snapped_node_idx = incident_node_idx;
    res.incident_snapped_osm_id = incident_osm_id;

    // 7. Validate Resource Pool Not Empty
    if (candidate_resources.empty()) {
        res.status = AllocationStatus::NO_RESOURCES_AVAILABLE;
        res.status_message = "No candidate resources provided in input collection";
        return res;
    }

    // 8. Filter, Validate, and Snap Candidate Resources
    std::unordered_set<uint64_t> seen_ids;
    std::vector<ResourceCandidateResult> candidates;
    candidates.reserve(candidate_resources.size());

    bool has_any_compatible = false;

    for (const auto& r : candidate_resources) {
        ResourceCandidateResult cand;
        cand.resource_id = r.resource_id;
        cand.resource_type = r.resource_type;
        cand.latitude = r.latitude;
        cand.longitude = r.longitude;
        cand.is_selected = false;

        // Check 1: Resource ID non-zero
        if (r.resource_id == 0) {
            cand.eligibility = CandidateEligibility::REJECTED_INVALID_RECORD;
            cand.rejection_reason = "Resource ID must be non-zero";
            candidates.push_back(cand);
            continue;
        }

        // Check 2: Duplicate Resource ID
        if (!seen_ids.insert(r.resource_id).second) {
            cand.eligibility = CandidateEligibility::REJECTED_DUPLICATE_ID;
            cand.rejection_reason = "Duplicate resource ID " + std::to_string(r.resource_id) + " in candidate pool";
            candidates.push_back(cand);
            continue;
        }

        // Check 3: Valid Capacity
        if (r.capacity == 0) {
            cand.eligibility = CandidateEligibility::REJECTED_INVALID_RECORD;
            cand.rejection_reason = "Resource capacity must be strictly positive (>= 1)";
            candidates.push_back(cand);
            continue;
        }

        // Check 4: Not already assigned
        if (r.assigned_incident_id != 0) {
            cand.eligibility = CandidateEligibility::REJECTED_ALREADY_ASSIGNED;
            cand.rejection_reason = "Resource is currently assigned to incident ID " +
                                    std::to_string(r.assigned_incident_id);
            candidates.push_back(cand);
            continue;
        }

        // Check 5: Availability Status
        if (r.availability_status != AvailabilityStatus::AVAILABLE) {
            cand.eligibility = CandidateEligibility::REJECTED_UNAVAILABLE;
            cand.rejection_reason = "Resource availability status is " +
                                    AvailabilityStatusToString(r.availability_status);
            candidates.push_back(cand);
            continue;
        }

        // Check 6: Compatibility Policy
        if (!compatibility_policy_.IsCompatible(request.category, r.resource_type)) {
            cand.eligibility = CandidateEligibility::REJECTED_INCOMPATIBLE;
            cand.rejection_reason = "Resource type " + ResourceTypeToString(r.resource_type) +
                                    " is not compatible with incident category";
            candidates.push_back(cand);
            continue;
        }

        has_any_compatible = true;

        // Check 7: Location Snapping
        uint32_t r_node_idx = 0xFFFFFFFF;
        int64_t r_osm_id = 0;

        if (r.current_node_osm_id > 0) {
            if (!graph_.TryGetInternalIndex(r.current_node_osm_id, r_node_idx)) {
                cand.eligibility = CandidateEligibility::REJECTED_SNAP_FAILED;
                cand.rejection_reason = "Specified resource current_node_osm_id not found in graph: " +
                                        std::to_string(r.current_node_osm_id);
                candidates.push_back(cand);
                continue;
            }
            r_osm_id = r.current_node_osm_id;
        } else {
            if (!std::isfinite(r.latitude) || !std::isfinite(r.longitude) ||
                r.latitude < -90.0 || r.latitude > 90.0 ||
                r.longitude < -180.0 || r.longitude > 180.0) {
                cand.eligibility = CandidateEligibility::REJECTED_INVALID_RECORD;
                cand.rejection_reason = "Non-finite or out-of-range resource coordinates";
                candidates.push_back(cand);
                continue;
            }

            SnapResult r_snap = spatial_grid_.SnapCoordinate(
                r.latitude,
                r.longitude,
                SnapPolicy::STRICT_INTERIOR_ONLY,
                boundary_validator_,
                request.max_snap_distance_meters);

            if (!r_snap.found) {
                if (r_snap.status == SnapStatus::OUTSIDE_SERVICE_AREA) {
                    cand.eligibility = CandidateEligibility::REJECTED_OUTSIDE_SERVICE_AREA;
                } else {
                    cand.eligibility = CandidateEligibility::REJECTED_SNAP_FAILED;
                }
                cand.rejection_reason = "Resource location snapping failed: " + SnapStatusToString(r_snap.status);
                candidates.push_back(cand);
                continue;
            }

            r_node_idx = r_snap.snapped_internal_index;
            r_osm_id = r_snap.snapped_osm_id;
        }

        cand.snapped_node_internal_idx = r_node_idx;
        cand.snapped_node_osm_id = r_osm_id;
        cand.eligibility = CandidateEligibility::ELIGIBLE_CANDIDATE; // Pending reachability check
        candidates.push_back(cand);
    }

    if (!has_any_compatible) {
        res.status = AllocationStatus::NO_COMPATIBLE_RESOURCES;
        res.status_message = "No compatible resources found in candidate collection for this incident category";
        res.candidate_evaluations = std::move(candidates);
        return res;
    }

    // 9. Directed Road-Network Routing from Candidate Nodes to Incident Node
    // Deduplicate unique candidate source nodes to prevent redundant Dijkstra searches
    std::unordered_set<uint32_t> unique_source_nodes;
    for (const auto& c : candidates) {
        if (c.eligibility == CandidateEligibility::ELIGIBLE_CANDIDATE) {
            unique_source_nodes.insert(c.snapped_node_internal_idx);
        }
    }

    std::unordered_map<uint32_t, double> distance_cache;
    for (uint32_t src_node : unique_source_nodes) {
        if (src_node == incident_node_idx) {
            distance_cache[src_node] = 0.0;
        } else {
            RouteResult route = router_.ShortestPath(src_node, incident_node_idx);
            if (route.found && !std::isinf(route.total_distance_meters)) {
                distance_cache[src_node] = route.total_distance_meters;
            } else {
                distance_cache[src_node] = std::numeric_limits<double>::infinity();
            }
        }
    }

    // Apply distances and calculate simulated ETAs
    for (auto& c : candidates) {
        if (c.eligibility != CandidateEligibility::ELIGIBLE_CANDIDATE) {
            continue;
        }

        double road_dist = distance_cache[c.snapped_node_internal_idx];
        if (std::isinf(road_dist)) {
            c.eligibility = CandidateEligibility::REJECTED_UNREACHABLE;
            c.rejection_reason = "No directed road-network route from resource node to incident node";
        } else {
            c.road_distance_meters = road_dist;
            double speed_kmh = speed_config_.GetSpeedKmh(c.resource_type);
            c.estimated_eta_seconds = (road_dist / speed_kmh) * 3.6;
        }
    }

    // 10. Group Eligible Candidates by ResourceType and Rank Deterministically
    std::unordered_map<ResourceType, std::vector<size_t>> eligible_indices_by_type;
    for (size_t i = 0; i < candidates.size(); ++i) {
        if (candidates[i].eligibility == CandidateEligibility::ELIGIBLE_CANDIDATE) {
            eligible_indices_by_type[candidates[i].resource_type].push_back(i);
        }
    }

    // Ranking comparator:
    // 1. Lower road distance (meters)
    // 2. Lower simulated ETA (seconds)
    // 3. Smaller resource ID (ascending arbiter)
    auto candidate_rank_comp = [&](size_t idx_a, size_t idx_b) {
        const auto& a = candidates[idx_a];
        const auto& b = candidates[idx_b];
        if (a.road_distance_meters != b.road_distance_meters) {
            return a.road_distance_meters < b.road_distance_meters;
        }
        if (a.estimated_eta_seconds != b.estimated_eta_seconds) {
            return a.estimated_eta_seconds < b.estimated_eta_seconds;
        }
        return a.resource_id < b.resource_id;
    };

    // 11. Allocation and Shortage Calculation per Demand
    for (const auto& [req_type, req_qty] : demand_map) {
        TypeShortage ts;
        ts.resource_type = req_type;
        ts.requested_quantity = req_qty;
        ts.allocated_quantity = 0;
        ts.shortage_quantity = req_qty;

        auto& pool = eligible_indices_by_type[req_type];
        std::sort(pool.begin(), pool.end(), candidate_rank_comp);

        size_t alloc_count = std::min(static_cast<size_t>(req_qty), pool.size());
        for (size_t k = 0; k < alloc_count; ++k) {
            size_t cand_idx = pool[k];
            candidates[cand_idx].eligibility = CandidateEligibility::ELIGIBLE_SELECTED;
            candidates[cand_idx].is_selected = true;
            res.selected_resources.push_back(candidates[cand_idx]);
        }

        ts.allocated_quantity = static_cast<uint32_t>(alloc_count);
        ts.shortage_quantity = req_qty - ts.allocated_quantity;
        res.total_allocated_resources += ts.allocated_quantity;
        res.requirements_summary.push_back(ts);
    }

    // Sort selected resources by ranking for clear presentation
    std::sort(res.selected_resources.begin(), res.selected_resources.end(),
              [](const ResourceCandidateResult& a, const ResourceCandidateResult& b) {
                  if (a.road_distance_meters != b.road_distance_meters) {
                      return a.road_distance_meters < b.road_distance_meters;
                  }
                  if (a.estimated_eta_seconds != b.estimated_eta_seconds) {
                      return a.estimated_eta_seconds < b.estimated_eta_seconds;
                  }
                  return a.resource_id < b.resource_id;
              });

    // 12. Determine Overall Status
    if (res.total_allocated_resources == res.total_requested_resources) {
        res.status = AllocationStatus::FULLY_ALLOCATED;
        res.status_message = "All requested resources successfully allocated";
    } else if (res.total_allocated_resources > 0) {
        res.status = AllocationStatus::PARTIALLY_ALLOCATED;
        res.status_message = "Partial allocation: shortages exist for requested resource types";
    } else {
        res.status = AllocationStatus::NO_RESOURCES_AVAILABLE;
        bool had_unreachable = false;
        bool had_available = false;
        for (const auto& c : candidates) {
            if (c.eligibility == CandidateEligibility::REJECTED_UNREACHABLE) {
                had_unreachable = true;
            } else if (c.eligibility == CandidateEligibility::REJECTED_UNAVAILABLE) {
                had_available = true;
            }
        }
        if (had_unreachable && !had_available) {
            res.status_message = "Incident location unreachable: no directed road path exists from available emergency depots to incident location";
        } else if (had_unreachable && had_available) {
            res.status_message = "No resources available: available depots cannot reach incident via directed road network, and remaining units are depleted";
        } else {
            res.status_message = "Fleet exhaustion: all compatible emergency vehicles are currently dispatched or depleted";
        }
    }

    res.candidate_evaluations = std::move(candidates);

    auto t_end = std::chrono::steady_clock::now();
    res.processing_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();

    return res;
}

} // namespace Allocation
} // namespace EmergencyRouting

