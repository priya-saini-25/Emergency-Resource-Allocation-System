#include "DispatchOrchestrator.hpp"
#include <iostream>

namespace EmergencyRouting {
namespace Orchestration {

DispatchOrchestrator::DispatchOrchestrator(const Graph& graph,
                                           const SpatialGrid& spatial_grid,
                                           const BoundaryValidator* boundary_validator,
                                           const Priority::PriorityConfig& priority_config)
    : graph_(graph),
      spatial_grid_(spatial_grid),
      boundary_validator_(boundary_validator),
      priority_engine_(priority_config),
      resource_engine_(graph, spatial_grid, boundary_validator),
      hospital_engine_(graph, spatial_grid, boundary_validator) {}

DispatchBatchResult DispatchOrchestrator::ProcessBatch(const DispatchBatchRequest& batch_request) const {
    auto t_batch_start = std::chrono::steady_clock::now();
    DispatchBatchResult result;
    result.batch_id = batch_request.batch_id;
    result.evaluated_at_ms = batch_request.evaluated_at_ms;
    result.total_incidents_received = batch_request.incidents.size();

    // 1. Batch Request Validation
    if (batch_request.batch_id == 0) {
        result.batch_status = BatchProcessingStatus::INVALID_BATCH;
        result.error_message = "Batch ID must be strictly positive (> 0).";
        return result;
    }
    if (batch_request.evaluated_at_ms == 0) {
        result.batch_status = BatchProcessingStatus::INVALID_BATCH;
        result.error_message = "Evaluation timestamp must be strictly positive (> 0).";
        return result;
    }
    if (batch_request.incidents.empty()) {
        result.batch_status = BatchProcessingStatus::SUCCESS;
        result.error_message = "Incident collection is empty; no dispatch required.";
        return result;
    }

    // 2. Incident Validation & Priority Scoring
    auto t_pri_start = std::chrono::steady_clock::now();

    struct ScoredIncident {
        EmergencyIncident incident;
        Priority::PriorityScoreResult priority_result;
    };

    std::vector<ScoredIncident> valid_incidents;
    std::vector<IncidentDispatchResult> invalid_results;
    std::unordered_set<uint64_t> seen_incident_ids;

    for (const auto& inc : batch_request.incidents) {
        IncidentDispatchResult invalid_res;
        invalid_res.incident_id = inc.incident_id;

        // Check ID validity and uniqueness
        if (inc.incident_id == 0) {
            invalid_res.dispatch_status = IncidentDispatchStatus::INVALID_INCIDENT;
            invalid_res.summary_notes = "Incident ID must be positive non-zero.";
            invalid_results.push_back(std::move(invalid_res));
            result.invalid_incidents++;
            continue;
        }
        if (seen_incident_ids.count(inc.incident_id)) {
            invalid_res.dispatch_status = IncidentDispatchStatus::INVALID_INCIDENT;
            invalid_res.summary_notes = "Duplicate incident ID: " + std::to_string(inc.incident_id);
            invalid_results.push_back(std::move(invalid_res));
            result.invalid_incidents++;
            continue;
        }
        seen_incident_ids.insert(inc.incident_id);

        // Evaluate priority with explicit uniform batch timestamp
        Priority::IncidentRecord rec;
        rec.incident_id = inc.incident_id;
        rec.category = inc.category;
        rec.severity = inc.severity;
        rec.victim_count = inc.victim_count;
        rec.created_at_ms = inc.created_at_ms;

        Priority::PriorityScoreResult pri_res = priority_engine_.EvaluateIncident(rec, batch_request.evaluated_at_ms);

        if (!pri_res.is_valid) {
            invalid_res.priority_result = pri_res;
            invalid_res.dispatch_status = IncidentDispatchStatus::INVALID_INCIDENT;
            invalid_res.summary_notes = "Priority evaluation failed: " + pri_res.error_message;
            invalid_results.push_back(std::move(invalid_res));
            result.invalid_incidents++;
            continue;
        }

        // Validate coordinates if not using pre-snapped OSM node
        if (inc.incident_node_osm_id == 0) {
            if (!std::isfinite(inc.latitude) || !std::isfinite(inc.longitude) ||
                inc.latitude < -90.0 || inc.latitude > 90.0 ||
                inc.longitude < -180.0 || inc.longitude > 180.0) {
                invalid_res.priority_result = pri_res;
                invalid_res.dispatch_status = IncidentDispatchStatus::INVALID_INCIDENT;
                invalid_res.summary_notes = "Incident coordinates non-finite or out of geographic range.";
                invalid_results.push_back(std::move(invalid_res));
                result.invalid_incidents++;
                continue;
            }

            if (boundary_validator_ && boundary_validator_->IsLoaded()) {
                if (!boundary_validator_->IsInside(inc.latitude, inc.longitude)) {
                    invalid_res.priority_result = pri_res;
                    invalid_res.dispatch_status = IncidentDispatchStatus::INVALID_INCIDENT;
                    invalid_res.summary_notes = "Incident location lies outside the approved Jodhpur Urban Service Area boundary.";
                    invalid_results.push_back(std::move(invalid_res));
                    result.invalid_incidents++;
                    continue;
                }
            }
        }

        valid_incidents.push_back({inc, pri_res});
        result.valid_incidents++;
    }

    // 3. Sort Valid Incidents in Deterministic Priority Order
    Priority::PriorityComparator comparator;
    std::sort(valid_incidents.begin(), valid_incidents.end(),
        [&comparator](const ScoredIncident& a, const ScoredIncident& b) {
            return comparator(a.priority_result, b.priority_result);
        });

    auto t_pri_end = std::chrono::steady_clock::now();
    result.priority_scoring_time_ms = std::chrono::duration<double, std::milli>(t_pri_end - t_pri_start).count();

    // 4. Initialize In-Memory Batch-Local State
    // Working fleet snapshot and allocated resources set to prevent duplicate allocation
    std::vector<Allocation::ResourceRecord> working_fleet = batch_request.fleet_snapshot;
    std::unordered_set<uint64_t> allocated_resource_ids;

    // Working hospital capacity snapshot
    std::vector<Hospital::HospitalRecord> working_hospitals = batch_request.hospital_snapshot;
    std::unordered_map<uint64_t, size_t> hospital_index_map;
    for (size_t i = 0; i < working_hospitals.size(); ++i) {
        hospital_index_map[working_hospitals[i].hospital_id] = i;
    }

    auto t_dispatch_start = std::chrono::steady_clock::now();

    // 5. Sequential Priority-First Dispatch Execution
    size_t execution_order = 1;
    for (const auto& item : valid_incidents) {
        const auto& inc = item.incident;
        IncidentDispatchResult inc_res;
        inc_res.incident_id = inc.incident_id;
        inc_res.processing_order = execution_order++;
        inc_res.priority_result = item.priority_result;

        // A. Resource Allocation
        // Determine demands (custom vs default)
        std::vector<Allocation::ResourceDemand> demands = inc.resource_demands;
        if (demands.empty()) {
            demands = EmergencyIncident::CreateDefaultResourceDemands(inc.category, inc.severity, inc.victim_count);
        }

        Allocation::AllocationRequest alloc_req;
        alloc_req.incident_id = inc.incident_id;
        alloc_req.category = inc.category;
        alloc_req.incident_latitude = inc.latitude;
        alloc_req.incident_longitude = inc.longitude;
        alloc_req.incident_node_osm_id = inc.incident_node_osm_id;
        alloc_req.requirements = demands;
        alloc_req.max_snap_distance_meters = batch_request.max_snap_distance_meters;

        // Candidate fleet filtering: exclude resources already committed in current batch
        std::vector<Allocation::ResourceRecord> eligible_fleet;
        eligible_fleet.reserve(working_fleet.size());
        for (const auto& r : working_fleet) {
            if (allocated_resource_ids.count(r.resource_id) == 0 &&
                r.availability_status == Allocation::AvailabilityStatus::AVAILABLE &&
                r.assigned_incident_id == 0) {
                eligible_fleet.push_back(r);
            }
        }

        inc_res.resource_allocation = resource_engine_.AllocateResources(alloc_req, eligible_fleet);

        // Commit allocated resources to batch ledger
        for (const auto& alloc_res : inc_res.resource_allocation.selected_resources) {
            allocated_resource_ids.insert(alloc_res.resource_id);

            // Update working fleet copy to prevent subsequent selection
            for (auto& r : working_fleet) {
                if (r.resource_id == alloc_res.resource_id) {
                    r.availability_status = Allocation::AvailabilityStatus::DISPATCHED;
                    r.assigned_incident_id = inc.incident_id;
                    break;
                }
            }
        }

        // B. Hospital Matching
        Hospital::HospitalRequirement hosp_req = inc.hospital_requirements;
        if (!inc.has_custom_hospital_requirements) {
            hosp_req = Hospital::HospitalRequirement::CreateDefault(inc.category);
        }

        Hospital::HospitalMatchRequest hosp_match_req;
        hosp_match_req.incident_id = inc.incident_id;
        hosp_match_req.incident_latitude = inc.latitude;
        hosp_match_req.incident_longitude = inc.longitude;
        hosp_match_req.incident_node_osm_id = inc.incident_node_osm_id;
        hosp_match_req.requirements = hosp_req;
        hosp_match_req.max_snap_distance_meters = batch_request.max_snap_distance_meters;
        hosp_match_req.simulated_speed_kmh = batch_request.simulated_hospital_transit_speed_kmh;

        inc_res.hospital_match = hospital_engine_.MatchHospitals(hosp_match_req, working_hospitals);

        // Commit hospital capacity to batch ledger for fully suitable recommendations
        if (!inc_res.hospital_match.suitable_hospitals.empty()) {
            const auto& top_hosp = inc_res.hospital_match.suitable_hospitals[0];
            auto it = hospital_index_map.find(top_hosp.hospital_id);
            if (it != hospital_index_map.end()) {
                auto& h = working_hospitals[it->second];

                uint32_t req_icu = hosp_req.required_icu_beds;
                uint32_t req_gen = hosp_req.required_general_beds;
                uint32_t req_oxy = hosp_req.required_oxygen_beds;

                h.icu_beds_available = (h.icu_beds_available >= req_icu) ? (h.icu_beds_available - req_icu) : 0;
                h.general_beds_available = (h.general_beds_available >= req_gen) ? (h.general_beds_available - req_gen) : 0;
                h.oxygen_supported_beds_available = (h.oxygen_supported_beds_available >= req_oxy) ? (h.oxygen_supported_beds_available - req_oxy) : 0;
                result.total_hospital_recommendations++;
            }
        }

        // C. Formulate Composite Incident Dispatch Status
        bool has_full_resources = (inc_res.resource_allocation.status == Allocation::AllocationStatus::FULLY_ALLOCATED);
        bool has_any_resources = !inc_res.resource_allocation.selected_resources.empty();

        bool has_suitable_hospital = (inc_res.hospital_match.status == Hospital::HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND);
        bool has_part_hospital = (inc_res.hospital_match.status == Hospital::HospitalMatchStatus::PARTIAL_ALTERNATIVES_ONLY);

        if (has_full_resources && has_suitable_hospital) {
            inc_res.dispatch_status = IncidentDispatchStatus::FULLY_DISPATCHED;
            inc_res.summary_notes = "Full resource allocation and optimal hospital match achieved.";
            result.fully_allocated_incidents++;
        } else if (has_any_resources && (has_suitable_hospital || has_part_hospital)) {
            inc_res.dispatch_status = IncidentDispatchStatus::PARTIALLY_DISPATCHED;
            inc_res.summary_notes = "Partial dispatch recommendation: some resources or hospital capacity constrained.";
            result.partially_allocated_incidents++;
        } else if (has_any_resources && !has_suitable_hospital) {
            inc_res.dispatch_status = IncidentDispatchStatus::RESOURCES_ALLOCATED_NO_HOSPITAL;
            inc_res.summary_notes = "Resources successfully allocated, but no suitable hospital available.";
            result.partially_allocated_incidents++;
        } else if (!has_any_resources && has_suitable_hospital) {
            inc_res.dispatch_status = IncidentDispatchStatus::HOSPITAL_FOUND_NO_RESOURCES;
            if (inc_res.resource_allocation.status_message.find("unreachable") != std::string::npos) {
                inc_res.summary_notes = inc_res.resource_allocation.status_message;
            } else if (inc_res.resource_allocation.status == Allocation::AllocationStatus::NO_COMPATIBLE_RESOURCES) {
                inc_res.summary_notes = inc_res.resource_allocation.status_message.empty() ?
                    "Hospital available, but no compatible resources in prototype fleet." :
                    inc_res.resource_allocation.status_message;
            } else {
                inc_res.summary_notes = inc_res.resource_allocation.status_message.empty() ?
                    "Hospital available, but fleet resources depleted or unavailable." :
                    inc_res.resource_allocation.status_message;
            }
            result.unallocated_incidents++;
        } else {
            inc_res.dispatch_status = IncidentDispatchStatus::UNABLE_TO_DISPATCH;
            if (inc_res.resource_allocation.status_message.find("unreachable") != std::string::npos ||
                inc_res.hospital_match.error_message.find("unreachable") != std::string::npos) {
                inc_res.summary_notes = "Incident location unreachable from available emergency depots or hospitals via directed road network.";
            } else if (inc_res.resource_allocation.status == Allocation::AllocationStatus::NO_COMPATIBLE_RESOURCES) {
                inc_res.summary_notes = inc_res.resource_allocation.status_message.empty() ?
                    "No compatible resources in prototype fleet." :
                    inc_res.resource_allocation.status_message;
            } else {
                inc_res.summary_notes = "No resources available and no suitable hospital found.";
            }
            result.unallocated_incidents++;
        }

        result.incident_results.push_back(std::move(inc_res));
    }

    auto t_dispatch_end = std::chrono::steady_clock::now();
    result.resource_orchestration_time_ms = std::chrono::duration<double, std::milli>(t_dispatch_end - t_dispatch_start).count();

    // 6. Append Invalid Incidents to Results
    for (auto& inv : invalid_results) {
        inv.processing_order = execution_order++;
        result.incident_results.push_back(std::move(inv));
    }

    // 7. Global Batch Telemetry & Metrics
    result.total_unique_resources_recommended = allocated_resource_ids.size();

    // Calculate remaining resources in working fleet
    result.remaining_available_resources = 0;
    for (const auto& r : working_fleet) {
        if (r.availability_status == Allocation::AvailabilityStatus::AVAILABLE &&
            allocated_resource_ids.count(r.resource_id) == 0) {
            result.remaining_available_resources++;
        }
    }

    // Calculate remaining bed capacity
    result.remaining_available_icu_beds = 0;
    result.remaining_available_general_beds = 0;
    result.remaining_available_oxygen_beds = 0;
    for (const auto& h : working_hospitals) {
        result.remaining_available_icu_beds += h.icu_beds_available;
        result.remaining_available_general_beds += h.general_beds_available;
        result.remaining_available_oxygen_beds += h.oxygen_supported_beds_available;
    }

    // Evaluate conflicts prevented:
    // Any resource allocated in batch that was demanded by multiple incidents represents a conflict prevented
    // Hospital capacity reserved that constrained later incidents represents capacity conflict prevented
    result.resource_conflicts_prevented = 0;
    for (size_t i = 1; i < result.incident_results.size(); ++i) {
        if (result.incident_results[i].resource_allocation.status == Allocation::AllocationStatus::NO_RESOURCES_AVAILABLE ||
            result.incident_results[i].resource_allocation.status == Allocation::AllocationStatus::PARTIALLY_ALLOCATED) {
            result.resource_conflicts_prevented++;
            continue;
        }
        for (const auto& shortage : result.incident_results[i].resource_allocation.requirements_summary) {
            if (shortage.shortage_quantity > 0) {
                result.resource_conflicts_prevented++;
                break;
            }
        }
    }

    result.hospital_capacity_conflicts_prevented = 0;
    for (size_t i = 1; i < result.incident_results.size(); ++i) {
        if (result.incident_results[i].hospital_match.status == Hospital::HospitalMatchStatus::PARTIAL_ALTERNATIVES_ONLY) {
            result.hospital_capacity_conflicts_prevented++;
        }
    }

    // Overall Batch Status
    if (result.valid_incidents == 0 && result.invalid_incidents > 0) {
        result.batch_status = BatchProcessingStatus::FAILED;
        result.error_message = "All incidents in batch were invalid.";
    } else if (result.fully_allocated_incidents == result.valid_incidents) {
        result.batch_status = BatchProcessingStatus::SUCCESS;
        result.error_message = "All valid incidents fully dispatched with suitable hospitals.";
    } else if (result.fully_allocated_incidents > 0 || result.partially_allocated_incidents > 0) {
        result.batch_status = BatchProcessingStatus::PARTIAL_SUCCESS;
        result.error_message = "Batch partially dispatched with resource/capacity constraints.";
    } else {
        result.batch_status = BatchProcessingStatus::FAILED;
        result.error_message = "No incidents could be dispatched due to resource or hospital exhaustion.";
    }

    auto t_batch_end = std::chrono::steady_clock::now();
    result.total_execution_time_ms = std::chrono::duration<double, std::milli>(t_batch_end - t_batch_start).count();

    return result;
}

} // namespace Orchestration
} // namespace EmergencyRouting
