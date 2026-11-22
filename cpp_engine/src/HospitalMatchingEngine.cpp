#include "HospitalMatchingEngine.hpp"
#include <iostream>

namespace EmergencyRouting {
namespace Hospital {

HospitalMatchingEngine::HospitalMatchingEngine(const Graph& graph,
                                               const SpatialGrid& spatial_grid,
                                               const BoundaryValidator* boundary_validator)
    : graph_(graph), spatial_grid_(spatial_grid), boundary_validator_(boundary_validator) {}

bool HospitalMatchingEngine::ValidateHospitalRecord(const HospitalRecord& record, std::string& error_out) {
    if (record.hospital_id == 0) {
        error_out = "Hospital ID must be strictly positive (> 0).";
        return false;
    }
    if (record.hospital_name.empty()) {
        error_out = "Hospital name cannot be empty.";
        return false;
    }
    if (static_cast<uint8_t>(record.hospital_status) > 2) {
        error_out = "Invalid hospital status enum value: " + std::to_string(static_cast<int>(record.hospital_status));
        return false;
    }
    // Capacity consistency rules
    if (record.icu_beds_available > record.icu_beds_total) {
        error_out = "Available ICU beds (" + std::to_string(record.icu_beds_available) +
                    ") exceeds total ICU beds (" + std::to_string(record.icu_beds_total) + ").";
        return false;
    }
    if (record.general_beds_available > record.general_beds_total) {
        error_out = "Available general beds (" + std::to_string(record.general_beds_available) +
                    ") exceeds total general beds (" + std::to_string(record.general_beds_total) + ").";
        return false;
    }
    if (record.oxygen_supported_beds_available > record.oxygen_supported_beds_total) {
        error_out = "Available oxygen-supported beds (" + std::to_string(record.oxygen_supported_beds_available) +
                    ") exceeds total oxygen-supported beds (" + std::to_string(record.oxygen_supported_beds_total) + ").";
        return false;
    }

    // Coordinate validation if using coordinates
    if (record.current_node_osm_id == 0) {
        if (!std::isfinite(record.latitude) || !std::isfinite(record.longitude) ||
            record.latitude < -90.0 || record.latitude > 90.0 ||
            record.longitude < -180.0 || record.longitude > 180.0) {
            error_out = "Hospital coordinates are invalid or non-finite: lat=" +
                        std::to_string(record.latitude) + ", lon=" + std::to_string(record.longitude);
            return false;
        }
    }
    return true;
}

HospitalMatchingResult HospitalMatchingEngine::MatchHospitals(
    const HospitalMatchRequest& request,
    const std::vector<HospitalRecord>& hospitals) const {

    auto t_start = std::chrono::steady_clock::now();
    HospitalMatchingResult result;
    result.incident_id = request.incident_id;
    result.requirements_evaluated = request.requirements;
    result.total_candidates_evaluated = hospitals.size();

    // 1. Validate Incident ID
    if (request.incident_id == 0) {
        result.status = HospitalMatchStatus::INVALID_REQUEST;
        result.error_message = "Incident ID must be strictly positive (> 0).";
        return result;
    }

    // 2. Validate Category Enum
    if (static_cast<uint8_t>(request.requirements.category) > 8) {
        result.status = HospitalMatchStatus::INVALID_REQUEST;
        result.error_message = "Invalid emergency category enum: " +
                               std::to_string(static_cast<int>(request.requirements.category));
        return result;
    }

    // 3. Validate Simulated Transit Speed
    if (!std::isfinite(request.simulated_speed_kmh) || request.simulated_speed_kmh <= 0.0) {
        result.status = HospitalMatchStatus::INVALID_REQUEST;
        result.error_message = "Simulated transit speed must be finite and strictly positive (> 0.0 km/h).";
        return result;
    }

    // 4. Resolve Incident Location on Graph
    uint32_t incident_internal_idx{0xFFFFFFFF};
    int64_t incident_node_osm_id = request.incident_node_osm_id;

    if (incident_node_osm_id != 0) {
        if (!graph_.TryGetInternalIndex(incident_node_osm_id, incident_internal_idx)) {
            result.status = HospitalMatchStatus::INVALID_REQUEST;
            result.error_message = "Incident OSM Node ID not found in road network graph: " +
                                   std::to_string(incident_node_osm_id);
            return result;
        }
    } else {
        if (!std::isfinite(request.incident_latitude) || !std::isfinite(request.incident_longitude) ||
            request.incident_latitude < -90.0 || request.incident_latitude > 90.0 ||
            request.incident_longitude < -180.0 || request.incident_longitude > 180.0) {
            result.status = HospitalMatchStatus::INVALID_REQUEST;
            result.error_message = "Incident coordinates are invalid or non-finite: lat=" +
                                   std::to_string(request.incident_latitude) +
                                   ", lon=" + std::to_string(request.incident_longitude);
            return result;
        }

        if (boundary_validator_ && boundary_validator_->IsLoaded()) {
            if (!boundary_validator_->IsInside(request.incident_latitude, request.incident_longitude)) {
                result.status = HospitalMatchStatus::INVALID_REQUEST;
                result.error_message = "Incident coordinate (" + std::to_string(request.incident_latitude) +
                                       ", " + std::to_string(request.incident_longitude) +
                                       ") lies outside the approved Jodhpur Urban Service Area boundary.";
                return result;
            }
        }

        SnapResult snap = spatial_grid_.SnapCoordinate(
            request.incident_latitude,
            request.incident_longitude,
            SnapPolicy::STRICT_INTERIOR_ONLY,
            boundary_validator_,
            request.max_snap_distance_meters
        );

        if (!snap.found) {
            result.status = HospitalMatchStatus::INVALID_REQUEST;
            result.error_message = "Incident coordinate snapping failed: " + snap.error_message;
            return result;
        }
        incident_internal_idx = snap.snapped_internal_index;
        incident_node_osm_id = snap.snapped_osm_id;
    }

    // 5. Check Candidate Pool
    if (hospitals.empty()) {
        result.status = HospitalMatchStatus::NO_HOSPITALS_AVAILABLE;
        result.error_message = "Hospital candidate collection is empty.";
        auto t_end = std::chrono::steady_clock::now();
        result.computation_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return result;
    }

    // 6. Pre-filter and Evaluate Hospital Candidates
    struct RoutableHospitalCandidate {
        HospitalCandidateResult base_res;
        uint32_t dest_internal_idx{0xFFFFFFFF};
        bool has_capability_mismatch{false};
        bool has_capacity_shortage{false};
    };

    std::vector<RoutableHospitalCandidate> routable_candidates;
    std::unordered_set<uint64_t> seen_hospital_ids;

    for (const auto& h : hospitals) {
        HospitalCandidateResult cand;
        cand.hospital_id = h.hospital_id;
        cand.hospital_name = h.hospital_name;
        cand.operational_status = h.hospital_status;

        // Check duplicate hospital ID
        if (h.hospital_id != 0 && seen_hospital_ids.count(h.hospital_id)) {
            cand.suitability = HospitalSuitability::INVALID_HOSPITAL_RECORD;
            cand.rejection_reason = "Duplicate hospital ID: " + std::to_string(h.hospital_id);
            result.invalid_hospitals.push_back(cand);
            continue;
        }
        if (h.hospital_id != 0) {
            seen_hospital_ids.insert(h.hospital_id);
        }

        // Validate record
        std::string rec_err;
        if (!ValidateHospitalRecord(h, rec_err)) {
            cand.suitability = HospitalSuitability::INVALID_HOSPITAL_RECORD;
            cand.rejection_reason = rec_err;
            result.invalid_hospitals.push_back(cand);
            continue;
        }

        // Check operational status
        if (h.hospital_status != HospitalStatus::OPERATIONAL) {
            cand.suitability = HospitalSuitability::HOSPITAL_UNAVAILABLE;
            cand.rejection_reason = "Hospital is " + HospitalStatusToString(h.hospital_status) +
                                    "; unavailable for emergency admissions.";
            result.unavailable_hospitals.push_back(cand);
            continue;
        }

        // Geographic location resolution and snapping
        uint32_t h_internal_idx{0xFFFFFFFF};
        int64_t h_osm_id = h.current_node_osm_id;

        if (h_osm_id != 0) {
            if (!graph_.TryGetInternalIndex(h_osm_id, h_internal_idx)) {
                cand.suitability = HospitalSuitability::INVALID_LOCATION;
                cand.rejection_reason = "Hospital pre-assigned OSM Node ID not found in graph: " +
                                        std::to_string(h_osm_id);
                result.invalid_hospitals.push_back(cand);
                continue;
            }
        } else {
            if (boundary_validator_ && boundary_validator_->IsLoaded()) {
                if (!boundary_validator_->IsInside(h.latitude, h.longitude)) {
                    cand.suitability = HospitalSuitability::OUTSIDE_SERVICE_AREA;
                    cand.rejection_reason = "Hospital coordinate lies outside Jodhpur Urban Service Area boundary.";
                    result.invalid_hospitals.push_back(cand);
                    continue;
                }
            }

            SnapResult snap = spatial_grid_.SnapCoordinate(
                h.latitude,
                h.longitude,
                SnapPolicy::STRICT_INTERIOR_ONLY,
                boundary_validator_,
                request.max_snap_distance_meters
            );

            if (!snap.found) {
                cand.suitability = (snap.status == SnapStatus::OUTSIDE_SERVICE_AREA)
                                       ? HospitalSuitability::OUTSIDE_SERVICE_AREA
                                       : HospitalSuitability::SNAP_FAILED;
                cand.rejection_reason = "Hospital coordinate snapping failed: " + snap.error_message;
                result.invalid_hospitals.push_back(cand);
                continue;
            }
            h_internal_idx = snap.snapped_internal_index;
            h_osm_id = snap.snapped_osm_id;
        }

        cand.hospital_node_osm_id = h_osm_id;

        // Clinical Capability Evaluation
        HospitalCapability req_caps = request.requirements.required_capabilities;
        HospitalCapability missing_bits = req_caps & (~h.emergency_capabilities);
        cand.missing_capabilities = DecomposeCapabilities(missing_bits);
        bool capability_mismatch = !cand.missing_capabilities.empty();

        // Capacity Evaluation (distinct non-additive dimensions)
        uint32_t icu_req = request.requirements.required_icu_beds;
        uint32_t gen_req = request.requirements.required_general_beds;
        uint32_t oxy_req = request.requirements.required_oxygen_beds;

        cand.icu_bed_shortage = (h.icu_beds_available < icu_req) ? (icu_req - h.icu_beds_available) : 0;
        cand.general_bed_shortage = (h.general_beds_available < gen_req) ? (gen_req - h.general_beds_available) : 0;
        cand.oxygen_bed_shortage = (h.oxygen_supported_beds_available < oxy_req) ? (oxy_req - h.oxygen_supported_beds_available) : 0;

        bool capacity_shortage = (cand.icu_bed_shortage > 0 ||
                                  cand.general_bed_shortage > 0 ||
                                  cand.oxygen_bed_shortage > 0);

        // Sum relevant available capacity across requested dimensions only (used for deterministic tie-breaking)
        uint32_t relevant_cap = 0;
        if (icu_req > 0) relevant_cap += h.icu_beds_available;
        if (gen_req > 0) relevant_cap += h.general_beds_available;
        if (oxy_req > 0) relevant_cap += h.oxygen_supported_beds_available;
        cand.total_relevant_available_capacity = relevant_cap;

        RoutableHospitalCandidate routable;
        routable.base_res = std::move(cand);
        routable.dest_internal_idx = h_internal_idx;
        routable.has_capability_mismatch = capability_mismatch;
        routable.has_capacity_shortage = capacity_shortage;

        routable_candidates.push_back(std::move(routable));
    }

    // 7. Execute Forward Directed Routing: Incident Node -> Hospital Nodes
    if (!routable_candidates.empty()) {
        std::vector<uint32_t> dest_indices;
        dest_indices.reserve(routable_candidates.size());
        for (const auto& r : routable_candidates) {
            dest_indices.push_back(r.dest_internal_idx);
        }

        DijkstraRouter router(graph_);
        MultiTargetResult mt_res = router.ShortestPathMultiTarget(incident_internal_idx, dest_indices, true);

        const double speed_mps = (request.simulated_speed_kmh * 1000.0) / 3600.0;

        for (size_t i = 0; i < routable_candidates.size(); ++i) {
            auto& cand = routable_candidates[i].base_res;
            const auto& target_res = mt_res.targets[i];

            if (!target_res.found) {
                cand.is_reachable = false;
                cand.suitability = HospitalSuitability::UNREACHABLE;
                cand.road_distance_meters = std::numeric_limits<double>::infinity();
                cand.simulated_eta_seconds = std::numeric_limits<double>::infinity();
                cand.rejection_reason = "No directed road-network path exists from incident to hospital.";
                result.unreachable_hospitals.push_back(cand);
            } else {
                cand.is_reachable = true;
                cand.road_distance_meters = target_res.total_distance_meters;
                cand.simulated_eta_seconds = (cand.road_distance_meters == 0.0)
                                                ? 0.0
                                                : (cand.road_distance_meters / speed_mps);
                cand.path_node_osm_ids = target_res.path_osm_ids;

                if (routable_candidates[i].has_capability_mismatch) {
                    cand.suitability = HospitalSuitability::CAPABILITY_MISMATCH;
                    cand.rejection_reason = "Missing mandatory emergency clinical capabilities.";
                    result.partial_alternatives.push_back(cand);
                } else if (routable_candidates[i].has_capacity_shortage) {
                    cand.suitability = HospitalSuitability::CAPACITY_INSUFFICIENT;
                    cand.rejection_reason = "Insufficient available bed capacity for one or more requested dimensions.";
                    result.partial_alternatives.push_back(cand);
                } else {
                    cand.suitability = HospitalSuitability::FULLY_SUITABLE;
                    cand.rejection_reason.clear();
                    result.suitable_hospitals.push_back(cand);
                }
            }
        }
    }

    // 8. Deterministic Ranking for Fully Suitable Hospitals
    // Hierarchy:
    // 1. Lower road-network distance (m)
    // 2. Lower simulated ETA (s)
    // 3. Greater relevant available capacity
    // 4. Smaller hospital ID (strict deterministic arbiter)
    constexpr double EPSILON = 1e-4;
    std::sort(result.suitable_hospitals.begin(), result.suitable_hospitals.end(),
        [](const HospitalCandidateResult& a, const HospitalCandidateResult& b) {
            if (std::abs(a.road_distance_meters - b.road_distance_meters) > EPSILON) {
                return a.road_distance_meters < b.road_distance_meters;
            }
            if (std::abs(a.simulated_eta_seconds - b.simulated_eta_seconds) > EPSILON) {
                return a.simulated_eta_seconds < b.simulated_eta_seconds;
            }
            if (a.total_relevant_available_capacity != b.total_relevant_available_capacity) {
                return a.total_relevant_available_capacity > b.total_relevant_available_capacity;
            }
            return a.hospital_id < b.hospital_id;
        });

    // 9. Deterministic Ranking for Partial Alternatives
    // Hierarchy:
    // 1. Fewer missing clinical capabilities
    // 2. Lower total shortage quantity (beds)
    // 3. Lower road-network distance (m)
    // 4. Smaller hospital ID
    std::sort(result.partial_alternatives.begin(), result.partial_alternatives.end(),
        [](const HospitalCandidateResult& a, const HospitalCandidateResult& b) {
            if (a.missing_capabilities.size() != b.missing_capabilities.size()) {
                return a.missing_capabilities.size() < b.missing_capabilities.size();
            }
            uint32_t short_a = a.icu_bed_shortage + a.general_bed_shortage + a.oxygen_bed_shortage;
            uint32_t short_b = b.icu_bed_shortage + b.general_bed_shortage + b.oxygen_bed_shortage;
            if (short_a != short_b) {
                return short_a < short_b;
            }
            if (std::abs(a.road_distance_meters - b.road_distance_meters) > EPSILON) {
                return a.road_distance_meters < b.road_distance_meters;
            }
            return a.hospital_id < b.hospital_id;
        });

    // 10. Formulate Overall Recommendation Status
    if (!result.suitable_hospitals.empty()) {
        result.status = HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND;
    } else if (!result.partial_alternatives.empty()) {
        result.status = HospitalMatchStatus::PARTIAL_ALTERNATIVES_ONLY;
        result.error_message = "No fully suitable hospitals found; partial alternatives available.";
    } else if (result.unavailable_hospitals.size() == hospitals.size()) {
        result.status = HospitalMatchStatus::NO_HOSPITALS_AVAILABLE;
        result.error_message = "All evaluated hospital facilities are closed or temporarily unavailable.";
    } else if (!result.unreachable_hospitals.empty() && (result.unreachable_hospitals.size() + result.unavailable_hospitals.size() == hospitals.size())) {
        result.status = HospitalMatchStatus::NO_SUITABLE_HOSPITAL;
        result.error_message = "Incident location unreachable: no operational hospital is reachable from incident location via directed road network";
    } else {
        result.status = HospitalMatchStatus::NO_SUITABLE_HOSPITAL;
        result.error_message = "No suitable or alternative hospitals could be matched for this incident.";
    }

    auto t_end = std::chrono::steady_clock::now();
    result.computation_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();

    return result;
}

} // namespace Hospital
} // namespace EmergencyRouting
