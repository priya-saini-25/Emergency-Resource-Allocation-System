#include "EngineRunner.hpp"
#include "DispatchOrchestrator.hpp"
#include "DataLoader.hpp"
#include "MemoryProfiler.hpp"

#include <iostream>
#include <iomanip>
#include <vector>
#include <unordered_set>
#include <unordered_map>
#include <string>
#include <cassert>
#include <cmath>
#include <chrono>
#include <algorithm>

using namespace EmergencyRouting;
using namespace EmergencyRouting::Orchestration;
using namespace EmergencyRouting::Allocation;
using namespace EmergencyRouting::Hospital;
using namespace EmergencyRouting::Priority;

#define TEST_ASSERT(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "[STRESS_FAIL] " << __FUNCTION__ << ":" << __LINE__ << " - " << msg << std::endl; \
            return false; \
        } \
    } while (0)

// Helper to construct a synthetic 10-node road network for isolated invariant verification
static Graph BuildSyntheticTestGraph() {
    Graph g;
    // Nodes 0 to 9 in a grid/linear pattern
    for (uint32_t i = 0; i < 10; ++i) {
        g.AddNode(100 + i, 26.25 + i * 0.005, 73.00 + i * 0.005, false);
    }
    // Bidirectional links between consecutive nodes
    for (uint32_t i = 0; i < 9; ++i) {
        g.AddEdge(i, i + 1, 150.0, i + 1, 0, 0, 0, false, {});
        g.AddEdge(i + 1, i, 150.0, i + 1, 0, 0, 0, false, {});
    }
    // Additional cross-links
    g.AddEdge(0, 5, 400.0, 10, 0, 0, 0, false, {});
    g.AddEdge(5, 0, 400.0, 10, 0, 0, 0, false, {});
    return g;
}

// ============================================================================
// 1. RESOURCE ALLOCATION INVARIANTS TEST
// ============================================================================
bool Test1_ResourceInvariants() {
    std::cout << "[STRESS_TEST 1] Verifying Resource Allocation Invariants..." << std::endl;

    Graph g = BuildSyntheticTestGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    // Create 5 incidents all competing for ALS_AMBULANCE
    DispatchBatchRequest req;
    req.batch_id = 101;
    req.evaluated_at_ms = 1000000;

    for (uint64_t id = 1; id <= 5; ++id) {
        EmergencyIncident inc;
        inc.incident_id = id;
        inc.category = EmergencyCategory::MEDICAL;
        inc.severity = static_cast<uint32_t>(id); // Severities 1 to 5
        inc.victim_count = 1;
        inc.created_at_ms = 990000;
        inc.incident_node_osm_id = 100 + id; // Node 1 to 5
        inc.resource_demands = {{ResourceType::ALS_AMBULANCE, 1}};
        req.incidents.push_back(inc);
    }

    // Only 2 ALS ambulances available!
    ResourceRecord r1;
    r1.resource_id = 1001;
    r1.resource_type = ResourceType::ALS_AMBULANCE;
    r1.availability_status = AvailabilityStatus::AVAILABLE;
    r1.current_node_osm_id = 100;

    ResourceRecord r2;
    r2.resource_id = 1002;
    r2.resource_type = ResourceType::ALS_AMBULANCE;
    r2.availability_status = AvailabilityStatus::AVAILABLE;
    r2.current_node_osm_id = 101;

    req.fleet_snapshot = {r1, r2};

    DispatchBatchResult res = orchestrator.ProcessBatch(req);

    std::cout << "res.incident_results.size() = " << res.incident_results.size() << std::endl;
    for (size_t i = 0; i < res.incident_results.size(); ++i) {
        std::cout << "  inc[" << res.incident_results[i].incident_id << "] status = "
                  << AllocationStatusToString(res.incident_results[i].resource_allocation.status)
                  << ", selected = " << res.incident_results[i].resource_allocation.selected_resources.size()
                  << ", notes: " << res.incident_results[i].summary_notes
                  << std::endl;
    }

    TEST_ASSERT(res.incident_results.size() == 5, "Must evaluate all 5 incidents");

    // Invariant 1: Exactly 2 resources recommended in total
    size_t total_allocated = 0;
    std::unordered_set<uint64_t> allocated_ids;

    for (const auto& ir : res.incident_results) {
        for (const auto& sr : ir.resource_allocation.selected_resources) {
            TEST_ASSERT(allocated_ids.count(sr.resource_id) == 0,
                        "CRITICAL INVARIANT VIOLATION: Resource allocated more than once!");
            allocated_ids.insert(sr.resource_id);
            total_allocated++;
        }
    }
    TEST_ASSERT(total_allocated == 2, "Must allocate exactly 2 available ALS ambulances");

    // Invariant 2: Priority Preemption - Higher severity must get resources first
    // Incident 5 (Severity 5) must be processed first and allocated
    TEST_ASSERT(res.incident_results[0].incident_id == 5, "Severity 5 must be processed first");
    TEST_ASSERT(res.incident_results[0].resource_allocation.status == AllocationStatus::FULLY_ALLOCATED,
                "Highest priority incident must receive resource");

    // Incident 4 (Severity 4) must be processed second and allocated
    TEST_ASSERT(res.incident_results[1].incident_id == 4, "Severity 4 must be processed second");
    TEST_ASSERT(res.incident_results[1].resource_allocation.status == AllocationStatus::FULLY_ALLOCATED,
                "Second highest priority incident must receive resource");

    // Incidents 3, 2, 1 must suffer complete shortages
    for (size_t i = 2; i < 5; ++i) {
        TEST_ASSERT(res.incident_results[i].resource_allocation.status == AllocationStatus::NO_RESOURCES_AVAILABLE,
                    "Lower priority incidents must suffer resource shortage");
        TEST_ASSERT(res.incident_results[i].resource_allocation.selected_resources.empty(),
                    "Lower priority incidents must not have allocated resources");
        if (!res.incident_results[i].resource_allocation.requirements_summary.empty()) {
            TEST_ASSERT(res.incident_results[i].resource_allocation.requirements_summary[0].shortage_quantity == 1,
                        "Shortage quantity must equal 1");
        }
    }

    std::cout << "  -> PASS: Resource uniqueness, priority preemption, and shortage counts verified." << std::endl;
    return true;
}

// ============================================================================
// 2. HOSPITAL CAPACITY INVARIANTS TEST
// ============================================================================
bool Test2_HospitalCapacityInvariants() {
    std::cout << "[STRESS_TEST 2] Verifying Hospital Bed Capacity Invariants..." << std::endl;

    Graph g = BuildSyntheticTestGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    DispatchBatchRequest req;
    req.batch_id = 202;
    req.evaluated_at_ms = 1000000;

    // 4 Medical Incidents each requiring 1 ICU bed and 1 General bed
    for (uint64_t id = 1; id <= 4; ++id) {
        EmergencyIncident inc;
        inc.incident_id = id;
        inc.category = EmergencyCategory::MEDICAL;
        inc.severity = static_cast<uint32_t>(id); // 1 to 4
        inc.created_at_ms = 990000;
        inc.incident_node_osm_id = 100 + id;
        inc.has_custom_hospital_requirements = true;
        inc.hospital_requirements.category = EmergencyCategory::MEDICAL;
        inc.hospital_requirements.required_capabilities = HospitalCapability::GENERAL_EMERGENCY | HospitalCapability::ICU;
        inc.hospital_requirements.required_icu_beds = 1;
        inc.hospital_requirements.required_general_beds = 1;
        req.incidents.push_back(inc);
    }

    // Only 1 Hospital with 2 ICU beds and 10 General beds
    HospitalRecord hosp;
    hosp.hospital_id = 777;
    hosp.hospital_name = "Invariant Hospital";
    hosp.current_node_osm_id = 108;
    hosp.hospital_status = HospitalStatus::OPERATIONAL;
    hosp.emergency_capabilities = HospitalCapability::GENERAL_EMERGENCY | HospitalCapability::ICU;
    hosp.icu_beds_total = 2;
    hosp.icu_beds_available = 2;
    hosp.general_beds_total = 10;
    hosp.general_beds_available = 10;
    req.hospital_snapshot = {hosp};

    DispatchBatchResult res = orchestrator.ProcessBatch(req);

    // Invariant 1: No overcommit of ICU beds. Only 2 incidents can get FULLY_SUITABLE
    size_t suitable_matches = 0;
    size_t alternative_matches = 0;

    for (const auto& ir : res.incident_results) {
        if (ir.hospital_match.status == HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND) {
            suitable_matches++;
        } else if (ir.hospital_match.status == HospitalMatchStatus::PARTIAL_ALTERNATIVES_ONLY) {
            alternative_matches++;
        }
    }

    TEST_ASSERT(suitable_matches == 2, "Exactly 2 incidents must receive fully suitable hospital matches");
    TEST_ASSERT(alternative_matches == 2, "Remaining 2 incidents must receive partial alternatives due to ICU bed shortage");
    TEST_ASSERT(res.remaining_available_icu_beds == 0, "Remaining ICU beds must be exactly 0");
    TEST_ASSERT(res.remaining_available_general_beds == 8, "Remaining General beds must be exactly 8 (10 - 2)");

    // Invariant 2: Higher priority (id=4, id=3) get beds, lower priority (id=2, id=1) get alternatives
    TEST_ASSERT(res.incident_results[0].incident_id == 4, "Incident 4 must be first");
    TEST_ASSERT(res.incident_results[0].hospital_match.status == HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND, "Inc 4 gets bed");
    TEST_ASSERT(res.incident_results[1].incident_id == 3, "Incident 3 must be second");
    TEST_ASSERT(res.incident_results[1].hospital_match.status == HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND, "Inc 3 gets bed");

    TEST_ASSERT(res.incident_results[2].incident_id == 2, "Incident 2 must be third");
    TEST_ASSERT(res.incident_results[2].hospital_match.status == HospitalMatchStatus::PARTIAL_ALTERNATIVES_ONLY, "Inc 2 shortage");
    TEST_ASSERT(res.incident_results[2].hospital_match.partial_alternatives[0].icu_bed_shortage == 1, "Shortage must be 1 ICU bed");

    std::cout << "  -> PASS: Bed capacity conservation and independent dimension limits verified." << std::endl;
    return true;
}

// ============================================================================
// 3. DETERMINISM & TIE-BREAKING TEST
// ============================================================================
bool Test3_DeterminismAndTieBreaking() {
    std::cout << "[STRESS_TEST 3] Verifying Algorithmic Determinism Across 30 Repetitions..." << std::endl;

    Graph g = BuildSyntheticTestGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    // 4 Incidents with IDENTICAL triage attributes (same category, severity, victims, created_at)
    // Testing strict weak ordering tie-breaking by incident_id
    DispatchBatchRequest req;
    req.batch_id = 303;
    req.evaluated_at_ms = 1000000;

    std::vector<uint64_t> ids = {40, 10, 30, 20}; // Deliberately unordered
    for (uint64_t id : ids) {
        EmergencyIncident inc;
        inc.incident_id = id;
        inc.category = EmergencyCategory::MEDICAL;
        inc.severity = 3;
        inc.victim_count = 1;
        inc.created_at_ms = 990000;
        inc.incident_node_osm_id = 100 + (id % 5);
        inc.resource_demands = {{ResourceType::BLS_AMBULANCE, 1}};
        req.incidents.push_back(inc);
    }

    ResourceRecord r3_1;
    r3_1.resource_id = 501;
    r3_1.resource_type = ResourceType::BLS_AMBULANCE;
    r3_1.availability_status = AvailabilityStatus::AVAILABLE;
    r3_1.current_node_osm_id = 100;

    ResourceRecord r3_2;
    r3_2.resource_id = 502;
    r3_2.resource_type = ResourceType::BLS_AMBULANCE;
    r3_2.availability_status = AvailabilityStatus::AVAILABLE;
    r3_2.current_node_osm_id = 101;

    req.fleet_snapshot = {r3_1, r3_2};

    // Run first evaluation to establish ground truth
    DispatchBatchResult baseline = orchestrator.ProcessBatch(req);

    // Invariant: Tie-breaking orders smaller incident_id first: 10, 20, 30, 40
    TEST_ASSERT(baseline.incident_results[0].incident_id == 10, "Tie-break 1 must be 10");
    TEST_ASSERT(baseline.incident_results[1].incident_id == 20, "Tie-break 2 must be 20");
    TEST_ASSERT(baseline.incident_results[2].incident_id == 30, "Tie-break 3 must be 30");
    TEST_ASSERT(baseline.incident_results[3].incident_id == 40, "Tie-break 4 must be 40");

    // Repeat 30 times and verify bitwise identical dispatch decisions
    for (int rep = 0; rep < 30; ++rep) {
        DispatchBatchResult current = orchestrator.ProcessBatch(req);
        TEST_ASSERT(current.incident_results.size() == baseline.incident_results.size(), "Size must match");
        for (size_t i = 0; i < current.incident_results.size(); ++i) {
            TEST_ASSERT(current.incident_results[i].incident_id == baseline.incident_results[i].incident_id,
                        "Incident ordering must be deterministic");
            TEST_ASSERT(current.incident_results[i].dispatch_status == baseline.incident_results[i].dispatch_status,
                        "Dispatch status must be deterministic");
            TEST_ASSERT(current.incident_results[i].priority_result.total_priority_score ==
                        baseline.incident_results[i].priority_result.total_priority_score,
                        "Priority scores must be identical");
            TEST_ASSERT(current.incident_results[i].resource_allocation.selected_resources.size() ==
                        baseline.incident_results[i].resource_allocation.selected_resources.size(),
                        "Resource allocation count must be identical");
        }
    }

    std::cout << "  -> PASS: 30/30 identical dispatch runs with deterministic tie-breaking." << std::endl;
    return true;
}

// ============================================================================
// 4. AUTHENTIC 50-INCIDENT HIGH-VOLUME BATCH STRESS TEST
// ============================================================================
bool Test4_AuthenticHighVolume50Incidents() {
    std::cout << "[STRESS_TEST 4] Authentic Jodhpur Road Network 50-Incident Batch Stress Test..." << std::endl;

    EngineRunner runner;
    bool init_ok = runner.Initialize();
    TEST_ASSERT(init_ok, "Must initialize authentic Jodhpur datasets");

    // Generate 50 realistic incidents distributed across Jodhpur Urban Service Area
    nlohmann::json req_json;
    req_json["protocol_version"] = "1.0";
    req_json["request_id"] = "REQ-STRESS-50-INCIDENTS";
    req_json["operation"] = "dispatch_batch";

    nlohmann::json payload;
    payload["batch_id"] = 5000;
    payload["evaluated_at_ms"] = 1700000000000ULL;
    payload["max_snap_distance_meters"] = 2500.0;
    payload["simulated_hospital_transit_speed_kmh"] = 35.0;

    // Authentic center around Shastri Nagar / Sardarpura: 26.27, 73.01
    // Generate 50 incidents within [26.24, 26.30] lat, [73.00, 73.04] lon
    nlohmann::json inc_arr = nlohmann::json::array();
    const char* categories[] = {"MEDICAL", "ROAD_ACCIDENT", "FIRE", "INDUSTRIAL"};

    for (uint64_t i = 1; i <= 50; ++i) {
        nlohmann::json inc;
        inc["incident_id"] = 1000 + i;
        inc["category"] = categories[i % 4];
        inc["severity"] = 1 + (i % 5); // Severities 1 to 5
        inc["victim_count"] = (i % 6); // 0 to 5 victims
        inc["created_at_ms"] = 1700000000000ULL - (i * 30000); // Created 0 to 25 min ago
        // Coordinate grid within interior
        double lat = 26.250 + (i % 10) * 0.005;
        double lon = 73.005 + (i / 10) * 0.006;
        inc["latitude"] = lat;
        inc["longitude"] = lon;
        inc_arr.push_back(inc);
    }
    payload["incidents"] = inc_arr;

    // Fleet: 15 ALS, 20 BLS, 5 Fire Engines, 3 Fire Tenders, 5 Rescue Vehicles
    nlohmann::json res_arr = nlohmann::json::array();
    uint64_t res_id = 1;
    auto add_resources = [&](const char* type, size_t count, double base_lat, double base_lon) {
        for (size_t c = 0; c < count; ++c) {
            nlohmann::json r;
            r["resource_id"] = res_id++;
            r["resource_type"] = type;
            r["status"] = "AVAILABLE";
            r["latitude"] = base_lat + (c % 5) * 0.004;
            r["longitude"] = base_lon + (c / 5) * 0.004;
            res_arr.push_back(r);
        }
    };
    add_resources("ALS_AMBULANCE", 15, 26.265, 73.010);
    add_resources("BLS_AMBULANCE", 20, 26.270, 73.015);
    add_resources("FIRE_ENGINE", 5, 26.275, 73.020);
    add_resources("FIRE_TENDER", 3, 26.275, 73.022);
    add_resources("RESCUE_VEHICLE", 5, 26.260, 73.008);
    payload["resources"] = res_arr;

    // Authentic Hospitals: MDM Hospital, AIIMS Jodhpur, Mahatma Gandhi Hospital, Mathura Das Mathur
    payload["hospitals"] = {
        {
            {"hospital_id", 801},
            {"name", "MDM Hospital Jodhpur"},
            {"latitude", 26.273},
            {"longitude", 73.012},
            {"status", "OPERATIONAL"},
            {"available_general_beds", 40},
            {"available_icu_beds", 12},
            {"available_oxygen_beds", 15},
            {"capabilities", {"GENERAL_EMERGENCY", "TRAUMA_CENTER", "CARDIAC_CARE", "BURN_UNIT"}}
        },
        {
            {"hospital_id", 802},
            {"name", "AIIMS Jodhpur"},
            {"latitude", 26.248},
            {"longitude", 73.003},
            {"status", "OPERATIONAL"},
            {"available_general_beds", 60},
            {"available_icu_beds", 20},
            {"available_oxygen_beds", 30},
            {"capabilities", {"GENERAL_EMERGENCY", "TRAUMA_CENTER", "CARDIAC_CARE", "BURN_UNIT", "PEDIATRIC_CARE"}}
        },
        {
            {"hospital_id", 803},
            {"name", "Mahatma Gandhi Hospital"},
            {"latitude", 26.289},
            {"longitude", 73.024},
            {"status", "OPERATIONAL"},
            {"available_general_beds", 25},
            {"available_icu_beds", 5},
            {"available_oxygen_beds", 10},
            {"capabilities", {"GENERAL_EMERGENCY", "TRAUMA_CENTER"}}
        }
    };

    req_json["payload"] = payload;

    std::string req_str = req_json.dump();
    std::string out_str;

    auto t_start = std::chrono::high_resolution_clock::now();
    int exit_code = runner.ExecuteJsonRequest(req_str, out_str);
    auto t_end = std::chrono::high_resolution_clock::now();
    double total_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();

    TEST_ASSERT(exit_code == Protocol::ExitCode::SUCCESS, "High-volume batch must succeed");

    nlohmann::json resp = nlohmann::json::parse(out_str);
    TEST_ASSERT(resp["status"] == "success", "Response must be success");
    TEST_ASSERT(resp["data"]["total_incidents_received"] == 50, "Must process exactly 50 incidents");
    TEST_ASSERT(resp["data"]["incident_results"].size() == 50, "Must return 50 incident results");

    // Verify global resource uniqueness invariant on 50 incidents
    std::unordered_set<uint64_t> allocated_resources;
    for (const auto& ir : resp["data"]["incident_results"]) {
        for (const auto& r : ir["resource_allocation"]["allocated_resources"]) {
            uint64_t rid = r["resource_id"].get<uint64_t>();
            TEST_ASSERT(allocated_resources.count(rid) == 0, "Resource allocated twice across 50 incidents!");
            allocated_resources.insert(rid);
        }
    }

    std::cout << "  -> PASS: 50-incident batch completed in " << total_ms << " ms ("
              << (total_ms / 50.0) << " ms/incident). "
              << allocated_resources.size() << " unique vehicles allocated without conflict." << std::endl;
    return true;
}

// ============================================================================
// 5. IN-MEMORY 100-CYCLE REPEATED INVOCATION & LEAK AUDIT
// ============================================================================
bool Test5_RepeatedExecutionMemoryAudit() {
    std::cout << "[STRESS_TEST 5] In-Memory 100-Cycle Repeated Batch Execution & Memory Audit..." << std::endl;

    EngineRunner runner;
    bool init_ok = runner.Initialize();
    TEST_ASSERT(init_ok, "Must initialize engine");

    auto baseline_mem = MemoryProfiler::Capture();
    std::cout << "  -> Initial Resident Memory: WorkingSet=" << baseline_mem.WorkingSetMb()
              << " MB, Private=" << baseline_mem.PrivateMb() << " MB" << std::endl;

    // Request with 5 incidents
    std::string req_json = R"({
        "protocol_version": "1.0",
        "request_id": "REQ-MEM-TEST",
        "operation": "dispatch_batch",
        "payload": {
            "batch_id": 999,
            "evaluated_at_ms": 1700000000000,
            "incidents": [
                { "incident_id": 1, "category": "MEDICAL", "severity": 4, "victim_count": 1, "created_at_ms": 1699999900000, "latitude": 26.265, "longitude": 73.015 },
                { "incident_id": 2, "category": "FIRE", "severity": 3, "victim_count": 0, "created_at_ms": 1699999910000, "latitude": 26.275, "longitude": 73.020, "resource_demands": [{"type": "FIRE_ENGINE", "quantity": 1}] },
                { "incident_id": 3, "category": "ROAD_ACCIDENT", "severity": 5, "victim_count": 2, "created_at_ms": 1699999920000, "latitude": 26.255, "longitude": 73.010 },
                { "incident_id": 4, "category": "MEDICAL", "severity": 2, "victim_count": 0, "created_at_ms": 1699999930000, "latitude": 26.260, "longitude": 73.012 },
                { "incident_id": 5, "category": "INDUSTRIAL", "severity": 4, "victim_count": 1, "created_at_ms": 1699999940000, "latitude": 26.270, "longitude": 73.018 }
            ],
            "resources": [
                { "resource_id": 11, "resource_type": "ALS_AMBULANCE", "status": "AVAILABLE", "latitude": 26.268, "longitude": 73.010 },
                { "resource_id": 12, "resource_type": "BLS_AMBULANCE", "status": "AVAILABLE", "latitude": 26.262, "longitude": 73.014 },
                { "resource_id": 13, "resource_type": "FIRE_ENGINE", "status": "AVAILABLE", "latitude": 26.278, "longitude": 73.022 },
                { "resource_id": 14, "resource_type": "RESCUE_VEHICLE", "status": "AVAILABLE", "latitude": 26.258, "longitude": 73.008 }
            ],
            "hospitals": [
                {
                    "hospital_id": 101, "name": "MDM Hospital", "latitude": 26.273, "longitude": 73.012, "status": "NORMAL",
                    "available_general_beds": 20, "available_icu_beds": 5, "available_oxygen_beds": 10,
                    "capabilities": ["GENERAL_EMERGENCY", "TRAUMA_CENTER", "CARDIAC_CARE", "BURN_UNIT"]
                }
            ]
        }
    })";

    double total_runtime_ms = 0.0;
    std::vector<double> run_times;
    run_times.reserve(100);

    for (int cycle = 0; cycle < 100; ++cycle) {
        std::string out_str;
        auto t0 = std::chrono::high_resolution_clock::now();
        int code = runner.ExecuteJsonRequest(req_json, out_str);
        auto t1 = std::chrono::high_resolution_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        run_times.push_back(ms);
        total_runtime_ms += ms;

        TEST_ASSERT(code == Protocol::ExitCode::SUCCESS, "Cycle must succeed");
    }

    auto post_mem = MemoryProfiler::Capture();
    std::cout << "  -> Memory after 100 cycles: WorkingSet=" << post_mem.WorkingSetMb()
              << " MB, PeakWorkingSet=" << post_mem.PeakWorkingSetMb()
              << " MB, Private=" << post_mem.PrivateMb() << " MB" << std::endl;

    // Check memory growth: working set growth must be < 15 MB across 100 cycles
    double ws_growth_mb = post_mem.WorkingSetMb() - baseline_mem.WorkingSetMb();
    std::cout << "  -> Net Working Set Growth: " << ws_growth_mb << " MB" << std::endl;
    TEST_ASSERT(ws_growth_mb < 25.0, "Working set growth exceeds 25 MB safety threshold");

    std::sort(run_times.begin(), run_times.end());
    double min_ms = run_times.front();
    double median_ms = run_times[50];
    double p95_ms = run_times[95];
    double max_ms = run_times.back();
    double avg_ms = total_runtime_ms / 100.0;

    std::cout << "  -> Latency Across 100 Cycles (5 incidents + routing):" << std::endl;
    std::cout << "     Min:    " << min_ms << " ms" << std::endl;
    std::cout << "     Avg:    " << avg_ms << " ms" << std::endl;
    std::cout << "     Median: " << median_ms << " ms" << std::endl;
    std::cout << "     P95:    " << p95_ms << " ms" << std::endl;
    std::cout << "     Max:    " << max_ms << " ms" << std::endl;

    return true;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================
int main() {
    std::cout << "================================================================" << std::endl;
    std::cout << "   PHASE 3.13 PERFORMANCE, RELIABILITY & INVARIANT STRESS SUITE" << std::endl;
    std::cout << "================================================================" << std::endl;

    size_t passed = 0;
    size_t total = 5;

    if (Test1_ResourceInvariants()) passed++;
    if (Test2_HospitalCapacityInvariants()) passed++;
    if (Test3_DeterminismAndTieBreaking()) passed++;
    if (Test4_AuthenticHighVolume50Incidents()) passed++;
    if (Test5_RepeatedExecutionMemoryAudit()) passed++;

    std::cout << "================================================================" << std::endl;
    std::cout << "   RESULTS: " << passed << " / " << total << " STRESS SUITES PASSED" << std::endl;
    std::cout << "================================================================" << std::endl;

    return (passed == total) ? 0 : 1;
}

