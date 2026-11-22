#include "JsonConverters.hpp"
#include <cmath>
#include <iostream>

namespace EmergencyRouting {
namespace Protocol {

bool ParseEmergencyCategory(const nlohmann::json& j, Priority::EmergencyCategory& out, std::string& err) {
    if (j.is_string()) {
        std::string s = j.get<std::string>();
        if (s == "MEDICAL" || s == "MEDICAL_EMERGENCY") { out = Priority::EmergencyCategory::MEDICAL; return true; }
        if (s == "FIRE") { out = Priority::EmergencyCategory::FIRE; return true; }
        if (s == "ROAD_ACCIDENT") { out = Priority::EmergencyCategory::ROAD_ACCIDENT; return true; }
        if (s == "INDUSTRIAL") { out = Priority::EmergencyCategory::INDUSTRIAL; return true; }
        if (s == "STRUCTURAL_COLLAPSE") { out = Priority::EmergencyCategory::STRUCTURAL_COLLAPSE; return true; }
        if (s == "HAZMAT") { out = Priority::EmergencyCategory::HAZMAT; return true; }
        if (s == "NATURAL_DISASTER") { out = Priority::EmergencyCategory::NATURAL_DISASTER; return true; }
        if (s == "CIVIL_DISTURBANCE") { out = Priority::EmergencyCategory::CIVIL_DISTURBANCE; return true; }
        if (s == "OTHER") { out = Priority::EmergencyCategory::OTHER; return true; }
        err = "Unknown category string: " + s;
        return false;
    }
    if (j.is_number_integer()) {
        int v = j.get<int>();
        if (v >= 0 && v <= 8) {
            out = static_cast<Priority::EmergencyCategory>(v);
            return true;
        }
        err = "Category integer out of range [0, 8]: " + std::to_string(v);
        return false;
    }
    err = "Category must be string or integer enum";
    return false;
}

bool ParseResourceType(const nlohmann::json& j, Allocation::ResourceType& out, std::string& err) {
    if (j.is_string()) {
        std::string s = j.get<std::string>();
        if (s == "ALS_AMBULANCE") { out = Allocation::ResourceType::ALS_AMBULANCE; return true; }
        if (s == "BLS_AMBULANCE") { out = Allocation::ResourceType::BLS_AMBULANCE; return true; }
        if (s == "FIRE_ENGINE") { out = Allocation::ResourceType::FIRE_ENGINE; return true; }
        if (s == "FIRE_TENDER") { out = Allocation::ResourceType::FIRE_TENDER; return true; }
        if (s == "RESCUE_VEHICLE") { out = Allocation::ResourceType::RESCUE_VEHICLE; return true; }
        err = "Unknown resource_type string: " + s;
        return false;
    }
    if (j.is_number_integer()) {
        int v = j.get<int>();
        if (v >= 0 && v <= 4) {
            out = static_cast<Allocation::ResourceType>(v);
            return true;
        }
        err = "ResourceType integer out of range [0, 4]: " + std::to_string(v);
        return false;
    }
    err = "ResourceType must be string or integer enum";
    return false;
}

bool ParseAvailabilityStatus(const nlohmann::json& j, Allocation::AvailabilityStatus& out, std::string& err) {
    if (j.is_string()) {
        std::string s = j.get<std::string>();
        if (s == "AVAILABLE") { out = Allocation::AvailabilityStatus::AVAILABLE; return true; }
        if (s == "RESERVED") { out = Allocation::AvailabilityStatus::RESERVED; return true; }
        if (s == "DISPATCHED") { out = Allocation::AvailabilityStatus::DISPATCHED; return true; }
        if (s == "OUT_OF_SERVICE") { out = Allocation::AvailabilityStatus::OUT_OF_SERVICE; return true; }
        err = "Unknown availability status string: " + s;
        return false;
    }
    if (j.is_number_integer()) {
        int v = j.get<int>();
        if (v >= 0 && v <= 3) {
            out = static_cast<Allocation::AvailabilityStatus>(v);
            return true;
        }
        err = "AvailabilityStatus integer out of range [0, 3]: " + std::to_string(v);
        return false;
    }
    err = "AvailabilityStatus must be string or integer enum";
    return false;
}

bool ParseHospitalStatus(const nlohmann::json& j, Hospital::HospitalStatus& out, std::string& err) {
    if (j.is_string()) {
        std::string s = j.get<std::string>();
        if (s == "OPERATIONAL" || s == "NORMAL" || s == "AVAILABLE") { out = Hospital::HospitalStatus::OPERATIONAL; return true; }
        if (s == "TEMPORARILY_UNAVAILABLE") { out = Hospital::HospitalStatus::TEMPORARILY_UNAVAILABLE; return true; }
        if (s == "CLOSED") { out = Hospital::HospitalStatus::CLOSED; return true; }
        err = "Unknown hospital status string: " + s;
        return false;
    }
    if (j.is_number_integer()) {
        int v = j.get<int>();
        if (v >= 0 && v <= 2) {
            out = static_cast<Hospital::HospitalStatus>(v);
            return true;
        }
        err = "HospitalStatus integer out of range [0, 2]: " + std::to_string(v);
        return false;
    }
    err = "HospitalStatus must be string or integer enum";
    return false;
}

bool ParseHospitalCapability(const nlohmann::json& j, Hospital::HospitalCapability& out, std::string& err) {
    if (j.is_string()) {
        std::string s = j.get<std::string>();
        if (s == "GENERAL_EMERGENCY" || s == "GENERAL") { out = Hospital::HospitalCapability::GENERAL_EMERGENCY; return true; }
        if (s == "TRAUMA" || s == "TRAUMA_CENTER") { out = Hospital::HospitalCapability::TRAUMA; return true; }
        if (s == "ICU" || s == "INTENSIVE_CARE") { out = Hospital::HospitalCapability::ICU; return true; }
        if (s == "OXYGEN_SUPPORT" || s == "OXYGEN") { out = Hospital::HospitalCapability::OXYGEN_SUPPORT; return true; }
        if (s == "BURN_TREATMENT" || s == "BURN_UNIT") { out = Hospital::HospitalCapability::BURN_TREATMENT; return true; }
        if (s == "SURGICAL_SUPPORT" || s == "SURGERY" || s == "CARDIAC_CARE" || s == "PEDIATRIC_CARE") { out = Hospital::HospitalCapability::SURGICAL_SUPPORT; return true; }
        if (s == "NONE") { out = Hospital::HospitalCapability::NONE; return true; }
        err = "Unknown hospital capability: " + s;
        return false;
    }
    if (j.is_number_integer()) {
        out = static_cast<Hospital::HospitalCapability>(j.get<uint32_t>());
        return true;
    }
    err = "Capability must be string or integer bitmask";
    return false;
}

bool ParseIncident(const nlohmann::json& j, size_t index, Orchestration::EmergencyIncident& out, std::vector<ProtocolErrorDetail>& errors) {
    std::string prefix = "payload.incidents[" + std::to_string(index) + "]";
    if (!j.is_object()) {
        errors.push_back({prefix, "Incident record must be a JSON object"});
        return false;
    }

    // Required fields: incident_id, category, severity, victim_count, created_at_ms
    if (!j.contains("incident_id") || !j["incident_id"].is_number_unsigned()) {
        errors.push_back({prefix + ".incident_id", "Missing or invalid unsigned integer incident_id"});
    } else {
        out.incident_id = j["incident_id"].get<uint64_t>();
    }

    if (!j.contains("category")) {
        errors.push_back({prefix + ".category", "Missing category field"});
    } else {
        std::string cat_err;
        if (!ParseEmergencyCategory(j["category"], out.category, cat_err)) {
            errors.push_back({prefix + ".category", cat_err});
        }
    }

    if (!j.contains("severity") || !j["severity"].is_number_integer()) {
        errors.push_back({prefix + ".severity", "Missing or invalid integer severity (1 to 5)"});
    } else {
        int sev = j["severity"].get<int>();
        if (sev < 1 || sev > 5) {
            errors.push_back({prefix + ".severity", "Severity must be between 1 and 5"});
        } else {
            out.severity = static_cast<uint32_t>(sev);
        }
    }

    if (j.contains("victim_count")) {
        if (!j["victim_count"].is_number_unsigned()) {
            errors.push_back({prefix + ".victim_count", "Invalid unsigned integer victim_count"});
        } else {
            out.victim_count = j["victim_count"].get<uint32_t>();
        }
    } else {
        out.victim_count = 0;
    }

    if (!j.contains("created_at_ms") || !j["created_at_ms"].is_number_unsigned()) {
        errors.push_back({prefix + ".created_at_ms", "Missing or invalid timestamp created_at_ms"});
    } else {
        out.created_at_ms = j["created_at_ms"].get<uint64_t>();
    }

    // Location: coordinates or pre-snapped node OSM ID
    if (j.contains("incident_node_osm_id") && j["incident_node_osm_id"].is_number_integer()) {
        out.incident_node_osm_id = j["incident_node_osm_id"].get<int64_t>();
    }

    if (out.incident_node_osm_id == 0) {
        if (!j.contains("latitude") || !j["latitude"].is_number() ||
            !j.contains("longitude") || !j["longitude"].is_number()) {
            errors.push_back({prefix, "Incident must provide either valid (latitude, longitude) or incident_node_osm_id"});
        } else {
            out.latitude = j["latitude"].get<double>();
            out.longitude = j["longitude"].get<double>();
            if (!std::isfinite(out.latitude) || out.latitude < -90.0 || out.latitude > 90.0 ||
                !std::isfinite(out.longitude) || out.longitude < -180.0 || out.longitude > 180.0) {
                errors.push_back({prefix, "Coordinates out of geographic range or non-finite"});
            }
        }
    }

    // Optional custom resource demands
    if (j.contains("resource_demands") && j["resource_demands"].is_array()) {
        for (size_t d_idx = 0; d_idx < j["resource_demands"].size(); ++d_idx) {
            const auto& dj = j["resource_demands"][d_idx];
            if (dj.is_object() && dj.contains("type") && dj.contains("quantity")) {
                Allocation::ResourceType rtype;
                std::string r_err;
                if (ParseResourceType(dj["type"], rtype, r_err) && dj["quantity"].is_number_unsigned()) {
                    uint32_t q = dj["quantity"].get<uint32_t>();
                    if (q > 0) {
                        out.resource_demands.push_back({rtype, q});
                    }
                }
            }
        }
    }

    // Optional custom hospital requirements
    if (j.contains("hospital_requirements") && j["hospital_requirements"].is_object()) {
        const auto& hj = j["hospital_requirements"];
        out.has_custom_hospital_requirements = true;
        out.hospital_requirements.category = out.category;

        if (hj.contains("required_capabilities")) {
            if (hj["required_capabilities"].is_array()) {
                Hospital::HospitalCapability caps = Hospital::HospitalCapability::NONE;
                for (const auto& cap_j : hj["required_capabilities"]) {
                    Hospital::HospitalCapability c;
                    std::string c_err;
                    if (ParseHospitalCapability(cap_j, c, c_err)) {
                        caps = caps | c;
                    }
                }
                out.hospital_requirements.required_capabilities = caps;
            } else if (hj["required_capabilities"].is_number_unsigned()) {
                out.hospital_requirements.required_capabilities =
                    static_cast<Hospital::HospitalCapability>(hj["required_capabilities"].get<uint32_t>());
            }
        }
        if (hj.contains("required_icu_beds") && hj["required_icu_beds"].is_number_unsigned()) {
            out.hospital_requirements.required_icu_beds = hj["required_icu_beds"].get<uint32_t>();
        }
        if (hj.contains("required_general_beds") && hj["required_general_beds"].is_number_unsigned()) {
            out.hospital_requirements.required_general_beds = hj["required_general_beds"].get<uint32_t>();
        }
        if (hj.contains("required_oxygen_beds") && hj["required_oxygen_beds"].is_number_unsigned()) {
            out.hospital_requirements.required_oxygen_beds = hj["required_oxygen_beds"].get<uint32_t>();
        }
    }

    return errors.empty();
}

bool ParseResource(const nlohmann::json& j, size_t index, Allocation::ResourceRecord& out, std::vector<ProtocolErrorDetail>& errors) {
    std::string prefix = "payload.resources[" + std::to_string(index) + "]";
    if (!j.is_object()) {
        errors.push_back({prefix, "Resource record must be a JSON object"});
        return false;
    }

    if (!j.contains("resource_id") || !j["resource_id"].is_number_unsigned()) {
        errors.push_back({prefix + ".resource_id", "Missing or invalid unsigned integer resource_id"});
    } else {
        out.resource_id = j["resource_id"].get<uint64_t>();
    }

    if (!j.contains("resource_type")) {
        errors.push_back({prefix + ".resource_type", "Missing resource_type"});
    } else {
        std::string r_err;
        if (!ParseResourceType(j["resource_type"], out.resource_type, r_err)) {
            errors.push_back({prefix + ".resource_type", r_err});
        }
    }

    if (!j.contains("status")) {
        out.availability_status = Allocation::AvailabilityStatus::AVAILABLE;
    } else {
        std::string s_err;
        if (!ParseAvailabilityStatus(j["status"], out.availability_status, s_err)) {
            errors.push_back({prefix + ".status", s_err});
        }
    }

    out.capacity = 1;
    if (j.contains("capacity") && j["capacity"].is_number_unsigned()) {
        out.capacity = j["capacity"].get<uint32_t>();
    }

    if (j.contains("current_node_osm_id") && j["current_node_osm_id"].is_number_integer()) {
        out.current_node_osm_id = j["current_node_osm_id"].get<int64_t>();
    }

    if (j.contains("latitude") && j["latitude"].is_number() &&
        j.contains("longitude") && j["longitude"].is_number()) {
        out.latitude = j["latitude"].get<double>();
        out.longitude = j["longitude"].get<double>();
        if (!std::isfinite(out.latitude) || !std::isfinite(out.longitude)) {
            errors.push_back({prefix, "Coordinates must be finite numbers"});
        }
    }

    return errors.empty();
}

bool ParseHospital(const nlohmann::json& j, size_t index, Hospital::HospitalRecord& out, std::vector<ProtocolErrorDetail>& errors) {
    std::string prefix = "payload.hospitals[" + std::to_string(index) + "]";
    if (!j.is_object()) {
        errors.push_back({prefix, "Hospital record must be a JSON object"});
        return false;
    }

    if (!j.contains("hospital_id") || !j["hospital_id"].is_number_unsigned()) {
        errors.push_back({prefix + ".hospital_id", "Missing or invalid unsigned integer hospital_id"});
    } else {
        out.hospital_id = j["hospital_id"].get<uint64_t>();
    }

    if (j.contains("hospital_name") && j["hospital_name"].is_string()) {
        out.hospital_name = j["hospital_name"].get<std::string>();
    } else if (j.contains("name") && j["name"].is_string()) {
        out.hospital_name = j["name"].get<std::string>();
    } else {
        out.hospital_name = "Hospital #" + std::to_string(out.hospital_id);
    }

    if (j.contains("status")) {
        std::string s_err;
        if (!ParseHospitalStatus(j["status"], out.hospital_status, s_err)) {
            errors.push_back({prefix + ".status", s_err});
        }
    }

    if (j.contains("current_node_osm_id") && j["current_node_osm_id"].is_number_integer()) {
        out.current_node_osm_id = j["current_node_osm_id"].get<int64_t>();
    } else if (j.contains("hospital_node_osm_id") && j["hospital_node_osm_id"].is_number_integer()) {
        out.current_node_osm_id = j["hospital_node_osm_id"].get<int64_t>();
    }

    if (j.contains("latitude") && j["latitude"].is_number() &&
        j.contains("longitude") && j["longitude"].is_number()) {
        out.latitude = j["latitude"].get<double>();
        out.longitude = j["longitude"].get<double>();
    }

    // Emergency capabilities (support both emergency_capabilities and capabilities)
    out.emergency_capabilities = Hospital::HospitalCapability::NONE;
    const nlohmann::json* caps_node = nullptr;
    if (j.contains("emergency_capabilities")) {
        caps_node = &j["emergency_capabilities"];
    } else if (j.contains("capabilities")) {
        caps_node = &j["capabilities"];
    }

    if (caps_node) {
        if (caps_node->is_array()) {
            for (const auto& cap_j : *caps_node) {
                Hospital::HospitalCapability c;
                std::string c_err;
                if (ParseHospitalCapability(cap_j, c, c_err)) {
                    out.emergency_capabilities = out.emergency_capabilities | c;
                }
            }
        } else if (caps_node->is_number_unsigned()) {
            out.emergency_capabilities = static_cast<Hospital::HospitalCapability>(caps_node->get<uint32_t>());
        }
    }

    // Capacities (support multiple naming conventions)
    if (j.contains("icu_beds_available") && j["icu_beds_available"].is_number_unsigned()) {
        out.icu_beds_available = j["icu_beds_available"].get<uint32_t>();
    } else if (j.contains("available_icu_beds") && j["available_icu_beds"].is_number_unsigned()) {
        out.icu_beds_available = j["available_icu_beds"].get<uint32_t>();
    }

    if (j.contains("icu_beds_total") && j["icu_beds_total"].is_number_unsigned()) {
        out.icu_beds_total = j["icu_beds_total"].get<uint32_t>();
    } else if (j.contains("total_icu_beds") && j["total_icu_beds"].is_number_unsigned()) {
        out.icu_beds_total = j["total_icu_beds"].get<uint32_t>();
    } else {
        out.icu_beds_total = out.icu_beds_available;
    }
    if (out.icu_beds_total < out.icu_beds_available) {
        out.icu_beds_total = out.icu_beds_available;
    }

    if (j.contains("general_beds_available") && j["general_beds_available"].is_number_unsigned()) {
        out.general_beds_available = j["general_beds_available"].get<uint32_t>();
    } else if (j.contains("available_general_beds") && j["available_general_beds"].is_number_unsigned()) {
        out.general_beds_available = j["available_general_beds"].get<uint32_t>();
    }

    if (j.contains("general_beds_total") && j["general_beds_total"].is_number_unsigned()) {
        out.general_beds_total = j["general_beds_total"].get<uint32_t>();
    } else if (j.contains("total_general_beds") && j["total_general_beds"].is_number_unsigned()) {
        out.general_beds_total = j["total_general_beds"].get<uint32_t>();
    } else {
        out.general_beds_total = out.general_beds_available;
    }
    if (out.general_beds_total < out.general_beds_available) {
        out.general_beds_total = out.general_beds_available;
    }

    if (j.contains("oxygen_supported_beds_available") && j["oxygen_supported_beds_available"].is_number_unsigned()) {
        out.oxygen_supported_beds_available = j["oxygen_supported_beds_available"].get<uint32_t>();
    } else if (j.contains("available_oxygen_beds") && j["available_oxygen_beds"].is_number_unsigned()) {
        out.oxygen_supported_beds_available = j["available_oxygen_beds"].get<uint32_t>();
    }

    if (j.contains("oxygen_supported_beds_total") && j["oxygen_supported_beds_total"].is_number_unsigned()) {
        out.oxygen_supported_beds_total = j["oxygen_supported_beds_total"].get<uint32_t>();
    } else if (j.contains("total_oxygen_beds") && j["total_oxygen_beds"].is_number_unsigned()) {
        out.oxygen_supported_beds_total = j["total_oxygen_beds"].get<uint32_t>();
    } else {
        out.oxygen_supported_beds_total = out.oxygen_supported_beds_available;
    }
    if (out.oxygen_supported_beds_total < out.oxygen_supported_beds_available) {
        out.oxygen_supported_beds_total = out.oxygen_supported_beds_available;
    }

    return errors.empty();
}

bool ParseBatchRequestPayload(const nlohmann::json& payload,
                              Orchestration::DispatchBatchRequest& out,
                              std::vector<ProtocolErrorDetail>& errors) {
    if (!payload.is_object()) {
        errors.push_back({"payload", "Payload must be a JSON object"});
        return false;
    }

    if (payload.contains("batch_id")) {
        if (payload["batch_id"].is_number_unsigned()) {
            out.batch_id = payload["batch_id"].get<uint64_t>();
        } else if (payload["batch_id"].is_string()) {
            // Hash or extract numerical portion
            std::string s = payload["batch_id"].get<std::string>();
            uint64_t id = 0;
            for (char c : s) {
                if (c >= '0' && c <= '9') {
                    id = id * 10 + (c - '0');
                }
            }
            out.batch_id = (id > 0) ? id : 1;
        }
    } else {
        out.batch_id = 1;
    }

    uint64_t eval_ms = 0;
    if (payload.contains("evaluated_at_ms") && payload["evaluated_at_ms"].is_number_unsigned()) {
        eval_ms = payload["evaluated_at_ms"].get<uint64_t>();
    } else if (payload.contains("evaluation_timestamp_ms") && payload["evaluation_timestamp_ms"].is_number_unsigned()) {
        eval_ms = payload["evaluation_timestamp_ms"].get<uint64_t>();
    } else {
        errors.push_back({"payload.evaluated_at_ms", "Missing or invalid unsigned integer evaluated_at_ms / evaluation_timestamp_ms"});
    }
    out.evaluated_at_ms = eval_ms;

    if (payload.contains("max_snap_distance_meters") && payload["max_snap_distance_meters"].is_number()) {
        out.max_snap_distance_meters = payload["max_snap_distance_meters"].get<double>();
    }
    if (payload.contains("simulated_hospital_transit_speed_kmh") && payload["simulated_hospital_transit_speed_kmh"].is_number()) {
        out.simulated_hospital_transit_speed_kmh = payload["simulated_hospital_transit_speed_kmh"].get<double>();
    }

    // Incidents
    if (!payload.contains("incidents") || !payload["incidents"].is_array()) {
        errors.push_back({"payload.incidents", "Missing or invalid incidents array"});
    } else if (payload["incidents"].empty()) {
        errors.push_back({"payload.incidents", "Incidents array must not be empty"});
    } else {
        const auto& inc_arr = payload["incidents"];
        out.incidents.reserve(inc_arr.size());
        std::unordered_set<uint64_t> seen_inc_ids;
        for (size_t i = 0; i < inc_arr.size(); ++i) {
            Orchestration::EmergencyIncident inc;
            if (ParseIncident(inc_arr[i], i, inc, errors)) {
                if (seen_inc_ids.count(inc.incident_id)) {
                    errors.push_back({"payload.incidents[" + std::to_string(i) + "].incident_id",
                                      "Duplicate incident_id: " + std::to_string(inc.incident_id)});
                } else {
                    seen_inc_ids.insert(inc.incident_id);
                    out.incidents.push_back(std::move(inc));
                }
            }
        }
    }

    // Resources
    if (payload.contains("resources") && payload["resources"].is_array()) {
        const auto& res_arr = payload["resources"];
        out.fleet_snapshot.reserve(res_arr.size());
        std::unordered_set<uint64_t> seen_res_ids;
        for (size_t i = 0; i < res_arr.size(); ++i) {
            Allocation::ResourceRecord r;
            if (ParseResource(res_arr[i], i, r, errors)) {
                if (seen_res_ids.count(r.resource_id)) {
                    errors.push_back({"payload.resources[" + std::to_string(i) + "].resource_id",
                                      "Duplicate resource_id: " + std::to_string(r.resource_id)});
                } else {
                    seen_res_ids.insert(r.resource_id);
                    out.fleet_snapshot.push_back(std::move(r));
                }
            }
        }
    }

    // Hospitals
    if (payload.contains("hospitals") && payload["hospitals"].is_array()) {
        const auto& hosp_arr = payload["hospitals"];
        out.hospital_snapshot.reserve(hosp_arr.size());
        std::unordered_set<uint64_t> seen_hosp_ids;
        for (size_t i = 0; i < hosp_arr.size(); ++i) {
            Hospital::HospitalRecord h;
            if (ParseHospital(hosp_arr[i], i, h, errors)) {
                if (seen_hosp_ids.count(h.hospital_id)) {
                    errors.push_back({"payload.hospitals[" + std::to_string(i) + "].hospital_id",
                                      "Duplicate hospital_id: " + std::to_string(h.hospital_id)});
                } else {
                    seen_hosp_ids.insert(h.hospital_id);
                    out.hospital_snapshot.push_back(std::move(h));
                }
            }
        }
    }

    return errors.empty();
}

nlohmann::json SerializeBatchResult(const Orchestration::DispatchBatchResult& res,
                                    const std::string& request_id,
                                    double process_time_ms) {
    nlohmann::json root;
    root["status"] = "success";
    root["protocol_version"] = CURRENT_PROTOCOL_VERSION;
    root["request_id"] = request_id;
    root["success"] = (res.batch_status == Orchestration::BatchProcessingStatus::SUCCESS ||
                       res.batch_status == Orchestration::BatchProcessingStatus::PARTIAL_SUCCESS);
    root["operation"] = OP_DISPATCH_BATCH;

    nlohmann::json data;
    data["batch_id"] = res.batch_id;
    data["batch_status"] = Orchestration::BatchProcessingStatusToString(res.batch_status);
    if (!res.error_message.empty()) {
        data["batch_status_message"] = res.error_message;
    }

    // Top-level summary attributes on data
    data["total_incidents_received"] = res.total_incidents_received;
    data["valid_incidents"] = res.valid_incidents;
    data["invalid_incidents"] = res.invalid_incidents;
    data["fully_allocated_incidents"] = res.fully_allocated_incidents;
    data["partially_allocated_incidents"] = res.partially_allocated_incidents;
    data["unallocated_incidents"] = res.unallocated_incidents;
    data["total_unique_resources_recommended"] = res.total_unique_resources_recommended;
    data["total_hospital_recommendations"] = res.total_hospital_recommendations;
    data["resource_conflicts_prevented"] = res.resource_conflicts_prevented;
    data["hospital_capacity_conflicts_prevented"] = res.hospital_capacity_conflicts_prevented;
    data["remaining_available_resources"] = res.remaining_available_resources;
    data["remaining_available_icu_beds"] = res.remaining_available_icu_beds;
    data["remaining_available_general_beds"] = res.remaining_available_general_beds;
    data["remaining_available_oxygen_beds"] = res.remaining_available_oxygen_beds;

    // Summary nested object
    nlohmann::json summary;
    summary["total_incidents_received"] = res.total_incidents_received;
    summary["valid_incidents"] = res.valid_incidents;
    summary["invalid_incidents"] = res.invalid_incidents;
    summary["fully_allocated_incidents"] = res.fully_allocated_incidents;
    summary["partially_allocated_incidents"] = res.partially_allocated_incidents;
    summary["unallocated_incidents"] = res.unallocated_incidents;
    summary["total_unique_resources_recommended"] = res.total_unique_resources_recommended;
    summary["total_hospital_recommendations"] = res.total_hospital_recommendations;
    summary["resource_conflicts_prevented"] = res.resource_conflicts_prevented;
    summary["hospital_capacity_conflicts_prevented"] = res.hospital_capacity_conflicts_prevented;
    summary["remaining_available_resources"] = res.remaining_available_resources;
    summary["remaining_available_icu_beds"] = res.remaining_available_icu_beds;
    summary["remaining_available_general_beds"] = res.remaining_available_general_beds;
    summary["remaining_available_oxygen_beds"] = res.remaining_available_oxygen_beds;
    data["summary"] = summary;

    // Incidents
    nlohmann::json inc_results = nlohmann::json::array();
    for (const auto& ir : res.incident_results) {
        nlohmann::json ij;
        ij["incident_id"] = ir.incident_id;
        ij["processing_order"] = ir.processing_order;
        ij["dispatch_status"] = Orchestration::IncidentDispatchStatusToString(ir.dispatch_status);
        ij["summary_notes"] = ir.summary_notes;

        // Priority
        nlohmann::json pri;
        pri["total_priority_score"] = SafeNumber(ir.priority_result.total_priority_score);
        pri["tier"] = Priority::PriorityTierToString(ir.priority_result.tier);
        pri["severity"] = ir.priority_result.severity;
        pri["victim_count"] = ir.priority_result.victim_count;
        pri["waiting_duration_ms"] = ir.priority_result.waiting_duration_ms;
        pri["normalized_severity_score"] = SafeNumber(ir.priority_result.normalized_severity_score);
        pri["normalized_victim_score"] = SafeNumber(ir.priority_result.normalized_victim_score);
        pri["normalized_waiting_score"] = SafeNumber(ir.priority_result.normalized_waiting_score);
        ij["priority"] = pri;

        // Resource Allocation
        nlohmann::json r_alloc;
        r_alloc["status"] = Allocation::AllocationStatusToString(ir.resource_allocation.status);
        r_alloc["status_message"] = ir.resource_allocation.status_message;
        r_alloc["incident_snapped_osm_id"] = ir.resource_allocation.incident_snapped_osm_id;
        r_alloc["total_requested_resources"] = ir.resource_allocation.total_requested_resources;
        r_alloc["total_allocated_resources"] = ir.resource_allocation.total_allocated_resources;

        nlohmann::json sel_res = nlohmann::json::array();
        for (const auto& sr : ir.resource_allocation.selected_resources) {
            nlohmann::json sj;
            sj["resource_id"] = sr.resource_id;
            sj["resource_type"] = Allocation::ResourceTypeToString(sr.resource_type);
            sj["snapped_node_osm_id"] = sr.snapped_node_osm_id;
            sj["road_distance_meters"] = SafeNumber(sr.road_distance_meters);
            sj["estimated_eta_seconds"] = SafeNumber(sr.estimated_eta_seconds);
            sel_res.push_back(sj);
        }
        r_alloc["selected_resources"] = sel_res;
        r_alloc["allocated_resources"] = sel_res;

        nlohmann::json req_sum = nlohmann::json::array();
        for (const auto& ts : ir.resource_allocation.requirements_summary) {
            nlohmann::json tj;
            tj["resource_type"] = Allocation::ResourceTypeToString(ts.resource_type);
            tj["requested_quantity"] = ts.requested_quantity;
            tj["allocated_quantity"] = ts.allocated_quantity;
            tj["shortage_quantity"] = ts.shortage_quantity;
            req_sum.push_back(tj);
        }
        r_alloc["requirements_summary"] = req_sum;
        ij["resource_allocation"] = r_alloc;

        // Hospital Matching
        nlohmann::json h_match;
        h_match["status"] = Hospital::HospitalMatchStatusToString(ir.hospital_match.status);
        h_match["error_message"] = ir.hospital_match.error_message;

        if (!ir.hospital_match.suitable_hospitals.empty()) {
            const auto& top = ir.hospital_match.suitable_hospitals[0];
            nlohmann::json hj;
            hj["hospital_id"] = top.hospital_id;
            hj["hospital_name"] = top.hospital_name;
            hj["suitability"] = Hospital::HospitalSuitabilityToString(top.suitability);
            hj["hospital_node_osm_id"] = top.hospital_node_osm_id;
            hj["road_distance_meters"] = SafeNumber(top.road_distance_meters);
            hj["simulated_eta_seconds"] = SafeNumber(top.simulated_eta_seconds);
            h_match["selected_hospital"] = hj;
            h_match["recommended_hospital_id"] = top.hospital_id;
            h_match["recommended_hospital_name"] = top.hospital_name;

            nlohmann::json rth;
            rth["distance_meters"] = SafeNumber(top.road_distance_meters);
            rth["simulated_eta_seconds"] = SafeNumber(top.simulated_eta_seconds);
            rth["node_count"] = top.path_node_osm_ids.size();
            rth["path_node_osm_ids"] = top.path_node_osm_ids;
            rth["encoded_polyline"] = "encoded_polyline_placeholder";
            h_match["route_to_hospital"] = rth;
        } else {
            h_match["selected_hospital"] = nullptr;
            h_match["recommended_hospital_id"] = nullptr;
            h_match["recommended_hospital_name"] = nullptr;
            h_match["route_to_hospital"] = nullptr;
        }

        nlohmann::json suit_arr = nlohmann::json::array();
        for (const auto& sh : ir.hospital_match.suitable_hospitals) {
            nlohmann::json hj;
            hj["hospital_id"] = sh.hospital_id;
            hj["hospital_name"] = sh.hospital_name;
            hj["road_distance_meters"] = SafeNumber(sh.road_distance_meters);
            hj["simulated_eta_seconds"] = SafeNumber(sh.simulated_eta_seconds);
            suit_arr.push_back(hj);
        }
        h_match["suitable_hospitals"] = suit_arr;

        nlohmann::json alt_arr = nlohmann::json::array();
        for (const auto& pa : ir.hospital_match.partial_alternatives) {
            nlohmann::json hj;
            hj["hospital_id"] = pa.hospital_id;
            hj["hospital_name"] = pa.hospital_name;
            hj["suitability"] = Hospital::HospitalSuitabilityToString(pa.suitability);
            hj["road_distance_meters"] = SafeNumber(pa.road_distance_meters);
            hj["simulated_eta_seconds"] = SafeNumber(pa.simulated_eta_seconds);
            hj["icu_bed_shortage"] = pa.icu_bed_shortage;
            hj["general_bed_shortage"] = pa.general_bed_shortage;
            hj["oxygen_bed_shortage"] = pa.oxygen_bed_shortage;
            alt_arr.push_back(hj);
        }
        h_match["partial_alternatives"] = alt_arr;

        ij["hospital_matching"] = h_match;
        ij["hospital_recommendation"] = h_match;
        inc_results.push_back(ij);
    }
    data["incident_results"] = inc_results;
    root["data"] = data;

    // Metadata & Telemetry
    nlohmann::json meta;
    meta["total_execution_time_ms"] = res.total_execution_time_ms;
    meta["priority_scoring_time_ms"] = res.priority_scoring_time_ms;
    meta["resource_orchestration_time_ms"] = res.resource_orchestration_time_ms;
    meta["hospital_orchestration_time_ms"] = res.hospital_orchestration_time_ms;
    meta["total_pipeline_time_ms"] = process_time_ms;
    root["metadata"] = meta;

    nlohmann::json telemetry;
    telemetry["total_engine_time_ms"] = process_time_ms;
    telemetry["priority_scoring_time_ms"] = res.priority_scoring_time_ms;
    telemetry["resource_orchestration_time_ms"] = res.resource_orchestration_time_ms;
    telemetry["hospital_orchestration_time_ms"] = res.hospital_orchestration_time_ms;
    root["telemetry"] = telemetry;

    root["error"] = nullptr;
    return root;
}

nlohmann::json SerializeErrorResponse(const std::string& protocol_version,
                                      const std::string& request_id,
                                      const std::string& operation,
                                      const ProtocolError& error,
                                      double process_time_ms) {
    nlohmann::json root;
    root["status"] = "error";
    root["protocol_version"] = protocol_version.empty() ? CURRENT_PROTOCOL_VERSION : protocol_version;
    root["request_id"] = request_id.empty() ? "UNKNOWN" : request_id;
    root["success"] = false;
    root["operation"] = operation.empty() ? OP_DISPATCH_BATCH : operation;
    root["data"] = nullptr;

    nlohmann::json meta;
    meta["processing_time_ms"] = process_time_ms;
    root["metadata"] = meta;

    root["error"] = error.ToJson();
    return root;
}

} // namespace Protocol
} // namespace EmergencyRouting

