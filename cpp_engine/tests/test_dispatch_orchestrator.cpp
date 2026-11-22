#include "DispatchOrchestrator.hpp"
#include "DataLoader.hpp"
#include "MemoryProfiler.hpp"
#include <iostream>
#include <cassert>
#include <cmath>
#include <limits>
#include <chrono>
#include <iomanip>
#include <algorithm>
#include <vector>
#include <numeric>

using namespace EmergencyRouting;
using namespace EmergencyRouting::Orchestration;

#define TEST_ASSERT(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "[TEST_FAIL] " << __FUNCTION__ << ":" << __LINE__ << " - " << msg << std::endl; \
            return false; \
        } \
    } while (0)

// Helper to construct synthetic test graph:
// 0 <-> 1 <-> 2 <-> 3 <-> 4 (linear bidirectional road, 100m each)
Graph BuildSyntheticGraph() {
    Graph g;
    g.AddNode(10, 26.25, 73.00, false); // Node 0
    g.AddNode(20, 26.26, 73.01, false); // Node 1
    g.AddNode(30, 26.27, 73.02, false); // Node 2
    g.AddNode(40, 26.28, 73.03, false); // Node 3
    g.AddNode(50, 26.29, 73.04, false); // Node 4

    for (uint32_t i = 0; i < 4; ++i) {
        g.AddEdge(i, i + 1, 100.0, i + 1, 0, 0, 0, false, {});
        g.AddEdge(i + 1, i, 100.0, i + 1, 0, 0, 0, false, {});
    }
    return g;
}

// ============================================================================
// 1. BATCH VALIDATION TESTS
// ============================================================================

bool Test1_BatchValidation() {
    std::cout << "Running Test1_BatchValidation..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    DispatchBatchRequest req;
    req.batch_id = 0; // Invalid
    req.evaluated_at_ms = 1000000;
    req.incidents = {{101, Priority::EmergencyCategory::MEDICAL, 3, 1, 990000, 26.26, 73.01, 20, {}, {}, false}};

    DispatchBatchResult res1 = orchestrator.ProcessBatch(req);
    TEST_ASSERT(res1.batch_status == BatchProcessingStatus::INVALID_BATCH, "Expected INVALID_BATCH for batch_id=0");

    req.batch_id = 1;
    req.evaluated_at_ms = 0; // Invalid
    DispatchBatchResult res2 = orchestrator.ProcessBatch(req);
    TEST_ASSERT(res2.batch_status == BatchProcessingStatus::INVALID_BATCH, "Expected INVALID_BATCH for evaluated_at_ms=0");

    // Empty incidents list -> SUCCESS (vacuous)
    req.evaluated_at_ms = 1000000;
    req.incidents.clear();
    DispatchBatchResult res3 = orchestrator.ProcessBatch(req);
    TEST_ASSERT(res3.batch_status == BatchProcessingStatus::SUCCESS, "Expected SUCCESS for empty batch");
    TEST_ASSERT(res3.total_incidents_received == 0, "Expected 0 incidents");

    std::cout << "Test1_BatchValidation: PASSED\n" << std::endl;
    return true;
}

bool Test2_DuplicateAndInvalidIncidents() {
    std::cout << "Running Test2_DuplicateAndInvalidIncidents..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    DispatchBatchRequest req;
    req.batch_id = 10;
    req.evaluated_at_ms = 1000000;

    req.incidents = {
        // Valid incident
        {101, Priority::EmergencyCategory::MEDICAL, 3, 1, 990000, 26.26, 73.01, 20, {}, {}, false},
        // Duplicate incident ID 101
        {101, Priority::EmergencyCategory::MEDICAL, 4, 2, 990000, 26.26, 73.01, 20, {}, {}, false},
        // Incident ID 0
        {0, Priority::EmergencyCategory::MEDICAL, 3, 1, 990000, 26.26, 73.01, 20, {}, {}, false},
        // Out of range category
        {102, static_cast<Priority::EmergencyCategory>(99), 3, 1, 990000, 26.26, 73.01, 20, {}, {}, false}
    };

    DispatchBatchResult res = orchestrator.ProcessBatch(req);
    TEST_ASSERT(res.valid_incidents == 1, "Expected exactly 1 valid incident");
    TEST_ASSERT(res.invalid_incidents == 3, "Expected 3 invalid incidents");
    TEST_ASSERT(res.incident_results.size() == 4, "Expected all 4 incidents recorded in results");

    std::cout << "Test2_DuplicateAndInvalidIncidents: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 2. PRIORITY-BASED ORDERING TESTS
// ============================================================================

bool Test3_PriorityOrdering() {
    std::cout << "Running Test3_PriorityOrdering..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    DispatchBatchRequest req;
    req.batch_id = 100;
    req.evaluated_at_ms = 1000000;

    // 3 incidents with varying severity and waiting time:
    // Inc 1: Catastrophic severity 5, 10 victims -> Highest score
    // Inc 2: Minor severity 1, 0 victims, waiting 1000ms -> Lowest score
    // Inc 3: High severity 4, 3 victims -> Medium score
    req.incidents = {
        {101, Priority::EmergencyCategory::MEDICAL, 1, 0, 999000, 26.26, 73.01, 20, {}, {}, false}, // Low
        {102, Priority::EmergencyCategory::MEDICAL, 5, 10, 950000, 26.27, 73.02, 30, {}, {}, false}, // Critical
        {103, Priority::EmergencyCategory::MEDICAL, 4, 3, 980000, 26.28, 73.03, 40, {}, {}, false}  // High
    };

    DispatchBatchResult res = orchestrator.ProcessBatch(req);
    TEST_ASSERT(res.incident_results.size() == 3, "Expected 3 results");
    // Verify priority execution sequence:
    // Order 1: Incident 102 (Score ~ 100.0)
    // Order 2: Incident 103
    // Order 3: Incident 101
    TEST_ASSERT(res.incident_results[0].incident_id == 102, "Incident 102 must execute first");
    TEST_ASSERT(res.incident_results[0].processing_order == 1, "Order should be 1");

    TEST_ASSERT(res.incident_results[1].incident_id == 103, "Incident 103 must execute second");
    TEST_ASSERT(res.incident_results[1].processing_order == 2, "Order should be 2");

    TEST_ASSERT(res.incident_results[2].incident_id == 101, "Incident 101 must execute third");
    TEST_ASSERT(res.incident_results[2].processing_order == 3, "Order should be 3");

    std::cout << "Test3_PriorityOrdering: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 3. GLOBAL RESOURCE CONFLICT PREVENTION
// ============================================================================

bool Test4_GlobalResourceConflictPrevention() {
    std::cout << "Running Test4_GlobalResourceConflictPrevention..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    DispatchBatchRequest req;
    req.batch_id = 200;
    req.evaluated_at_ms = 1000000;

    // Two incidents competing for the SAME sole available ALS Ambulance:
    // High Priority Incident (Sev 5) vs Low Priority Incident (Sev 2)
    req.incidents = {
        {101, Priority::EmergencyCategory::MEDICAL, 2, 1, 990000, 26.26, 73.01, 20,
         {{Allocation::ResourceType::ALS_AMBULANCE, 1}}, {}, true},
        {102, Priority::EmergencyCategory::MEDICAL, 5, 2, 980000, 26.27, 73.02, 30,
         {{Allocation::ResourceType::ALS_AMBULANCE, 1}}, {}, true}
    };

    // Fleet snapshot containing ONLY 1 available ALS Ambulance (#501)
    req.fleet_snapshot = {
        {501, Allocation::ResourceType::ALS_AMBULANCE, Allocation::AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0}
    };

    // Hospital snapshot
    req.hospital_snapshot = {
        {1, "Hospital 1", 26.26, 73.01, 20, Hospital::HospitalStatus::OPERATIONAL, Hospital::HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };

    DispatchBatchResult res = orchestrator.ProcessBatch(req);
    TEST_ASSERT(res.incident_results.size() == 2, "Expected 2 incident results");

    // Incident 102 (Severity 5) must be processed FIRST and win resource #501
    const auto& first_proc = res.incident_results[0];
    TEST_ASSERT(first_proc.incident_id == 102, "Incident 102 should be processed first");
    TEST_ASSERT(first_proc.resource_allocation.status == Allocation::AllocationStatus::FULLY_ALLOCATED, "Incident 102 must be FULLY_ALLOCATED");
    TEST_ASSERT(first_proc.resource_allocation.selected_resources.size() == 1, "Incident 102 gets 1 vehicle");
    TEST_ASSERT(first_proc.resource_allocation.selected_resources[0].resource_id == 501, "Vehicle 501 allocated to Incident 102");

    // Incident 101 (Severity 2) must be processed SECOND and suffer shortage (Resource #501 unavailable)
    const auto& second_proc = res.incident_results[1];
    TEST_ASSERT(second_proc.incident_id == 101, "Incident 101 should be processed second");
    TEST_ASSERT(second_proc.resource_allocation.status == Allocation::AllocationStatus::NO_RESOURCES_AVAILABLE, "Incident 101 status must be NO_RESOURCES_AVAILABLE");
    TEST_ASSERT(second_proc.resource_allocation.selected_resources.empty(), "No vehicle remaining for Incident 101");

    // Global resource uniqueness check: Vehicle #501 must appear at most ONCE
    TEST_ASSERT(res.total_unique_resources_recommended == 1, "Only 1 unique vehicle allocated globally");
    TEST_ASSERT(res.remaining_available_resources == 0, "Working fleet should have 0 available resources");

    std::cout << "Test4_GlobalResourceConflictPrevention: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 4. GLOBAL HOSPITAL CAPACITY CONFLICT PREVENTION
// ============================================================================

bool Test5_GlobalHospitalCapacityConflictPrevention() {
    std::cout << "Running Test5_GlobalHospitalCapacityConflictPrevention..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    DispatchBatchRequest req;
    req.batch_id = 300;
    req.evaluated_at_ms = 1000000;

    // Two incidents competing for ICU beds:
    // Incident 101 (High Priority, Sev 5) requires 2 ICU beds
    // Incident 102 (Lower Priority, Sev 3) requires 1 ICU bed
    Hospital::HospitalRequirement h_req_high;
    h_req_high.required_capabilities = Hospital::HospitalCapability::GENERAL_EMERGENCY;
    h_req_high.required_icu_beds = 2;

    Hospital::HospitalRequirement h_req_low;
    h_req_low.required_capabilities = Hospital::HospitalCapability::GENERAL_EMERGENCY;
    h_req_low.required_icu_beds = 1;

    req.incidents = {
        {102, Priority::EmergencyCategory::MEDICAL, 3, 1, 990000, 26.26, 73.01, 20, {}, h_req_low, true},
        {101, Priority::EmergencyCategory::MEDICAL, 5, 2, 980000, 26.27, 73.02, 30, {}, h_req_high, true}
    };

    // Fleet has plenty of vehicles
    req.fleet_snapshot = {
        {1, Allocation::ResourceType::BLS_AMBULANCE, Allocation::AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0},
        {2, Allocation::ResourceType::BLS_AMBULANCE, Allocation::AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0}
    };

    // Hospital snapshot: Hospital MGH has ONLY 2 available ICU beds
    req.hospital_snapshot = {
        {1, "Hospital MGH", 26.28, 73.03, 40, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY,
         10, 2, 50, 20, 20, 10} // ICU avail = 2
    };

    DispatchBatchResult res = orchestrator.ProcessBatch(req);
    TEST_ASSERT(res.incident_results.size() == 2, "Expected 2 incident results");

    // Incident 101 is processed FIRST:
    // Consumes 2 ICU beds from Hospital MGH -> Hospital MGH is FULLY_SUITABLE
    const auto& first_proc = res.incident_results[0];
    TEST_ASSERT(first_proc.incident_id == 101, "Incident 101 must be processed first");
    TEST_ASSERT(first_proc.hospital_match.status == Hospital::HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND, "Incident 101 gets suitable hospital");
    TEST_ASSERT(first_proc.hospital_match.suitable_hospitals[0].hospital_id == 1, "Hospital 1 matched for Inc 101");

    // Incident 102 is processed SECOND:
    // Hospital MGH now has 0 remaining ICU beds!
    // Since Incident 102 needs 1 ICU bed, Hospital MGH must NOT be FULLY_SUITABLE!
    const auto& second_proc = res.incident_results[1];
    TEST_ASSERT(second_proc.incident_id == 102, "Incident 102 must be processed second");
    TEST_ASSERT(second_proc.hospital_match.status != Hospital::HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND,
                "Hospital MGH cannot be fully suitable for Incident 102 due to bed depletion");
    TEST_ASSERT(!second_proc.hospital_match.partial_alternatives.empty(), "Hospital MGH should appear as partial alternative");
    TEST_ASSERT(second_proc.hospital_match.partial_alternatives[0].icu_bed_shortage == 1, "ICU bed shortage must be 1");

    // Remaining capacity check: MGH remaining ICU beds must be exactly 0
    TEST_ASSERT(res.remaining_available_icu_beds == 0, "Remaining ICU beds in batch plan must be 0");

    std::cout << "Test5_GlobalHospitalCapacityConflictPrevention: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 5. ORIGINAL REQUEST IMMUTABILITY
// ============================================================================

bool Test6_OriginalRequestImmutability() {
    std::cout << "Running Test6_OriginalRequestImmutability..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    DispatchBatchRequest req;
    req.batch_id = 400;
    req.evaluated_at_ms = 1000000;

    req.incidents = {
        {101, Priority::EmergencyCategory::MEDICAL, 4, 1, 990000, 26.26, 73.01, 20, {}, {}, false}
    };

    req.fleet_snapshot = {
        {1, Allocation::ResourceType::BLS_AMBULANCE, Allocation::AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0}
    };

    req.hospital_snapshot = {
        {1, "Hospital MGH", 26.28, 73.03, 40, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY,
         10, 5, 50, 20, 20, 10}
    };

    // Keep copies to verify immutability
    const auto original_fleet = req.fleet_snapshot;
    const auto original_hospitals = req.hospital_snapshot;

    DispatchBatchResult res = orchestrator.ProcessBatch(req);
    (void)res;

    // Verify caller's fleet was not mutated
    TEST_ASSERT(req.fleet_snapshot.size() == original_fleet.size(), "Fleet size mutated");
    TEST_ASSERT(req.fleet_snapshot[0].availability_status == Allocation::AvailabilityStatus::AVAILABLE, "Fleet status mutated");
    TEST_ASSERT(req.fleet_snapshot[0].assigned_incident_id == 0, "Fleet assigned incident ID mutated");

    // Verify caller's hospital snapshot was not mutated
    TEST_ASSERT(req.hospital_snapshot.size() == original_hospitals.size(), "Hospital size mutated");
    TEST_ASSERT(req.hospital_snapshot[0].general_beds_available == original_hospitals[0].general_beds_available, "Beds mutated");

    std::cout << "Test6_OriginalRequestImmutability: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 6. DETERMINISM & IDENTICAL REPEATED RUNS
// ============================================================================

bool Test7_Determinism() {
    std::cout << "Running Test7_Determinism..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    DispatchOrchestrator orchestrator(g, grid);

    DispatchBatchRequest req;
    req.batch_id = 500;
    req.evaluated_at_ms = 1000000;

    req.incidents = {
        {101, Priority::EmergencyCategory::MEDICAL, 3, 1, 990000, 26.26, 73.01, 20, {}, {}, false},
        {102, Priority::EmergencyCategory::ROAD_ACCIDENT, 5, 3, 980000, 26.27, 73.02, 30, {}, {}, false},
        {103, Priority::EmergencyCategory::FIRE, 4, 2, 985000, 26.28, 73.03, 40, {}, {}, false}
    };

    req.fleet_snapshot = {
        {1, Allocation::ResourceType::ALS_AMBULANCE, Allocation::AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0},
        {2, Allocation::ResourceType::FIRE_ENGINE, Allocation::AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0},
        {3, Allocation::ResourceType::RESCUE_VEHICLE, Allocation::AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0}
    };

    req.hospital_snapshot = {
        {1, "Hospital 1", 26.28, 73.03, 40, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY | Hospital::HospitalCapability::TRAUMA | Hospital::HospitalCapability::BURN_TREATMENT,
         10, 5, 50, 20, 20, 10}
    };

    DispatchBatchResult res1 = orchestrator.ProcessBatch(req);
    DispatchBatchResult res2 = orchestrator.ProcessBatch(req);

    TEST_ASSERT(res1.incident_results.size() == res2.incident_results.size(), "Result counts mismatch");
    for (size_t i = 0; i < res1.incident_results.size(); ++i) {
        TEST_ASSERT(res1.incident_results[i].incident_id == res2.incident_results[i].incident_id, "Ordering mismatch");
        TEST_ASSERT(res1.incident_results[i].processing_order == res2.incident_results[i].processing_order, "Order number mismatch");
        TEST_ASSERT(res1.incident_results[i].dispatch_status == res2.incident_results[i].dispatch_status, "Status mismatch");
        TEST_ASSERT(res1.incident_results[i].priority_result.total_priority_score == res2.incident_results[i].priority_result.total_priority_score, "Score mismatch");
    }

    std::cout << "Test7_Determinism: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 7. CANONICAL JODHPUR SIMULTANEOUS DISPATCH INTEGRATION
// ============================================================================

bool Test8_CanonicalJodhpurSimultaneousDispatch() {
    std::cout << "Running Test8_CanonicalJodhpurSimultaneousDispatch..." << std::endl;
    Graph graph;
    std::cout << "  Loading canonical graph..." << std::endl;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    SpatialGrid grid;
    std::cout << "  Building SpatialGrid..." << std::endl;
    grid.Build(graph, 250.0);

    BoundaryValidator boundary;
    boundary.LoadFromFile("data/jodhpur_boundary.geojson");

    DispatchOrchestrator orchestrator(graph, grid, &boundary);

    DispatchBatchRequest batch;
    batch.batch_id = 9001;
    batch.evaluated_at_ms = 1700000000000ULL;

    // Simultaneous Incidents across authentic Jodhpur landmarks:
    // Incident 1: Major Road Accident at Sojati Gate (OSM 2688566058) - Severity 5, 4 victims
    // Incident 2: Structural Fire near Paota Circle (OSM 3773158752) - Severity 4, 2 victims
    // Incident 3: Medical Emergency near MDM Hospital (OSM 5321319416) - Severity 3, 1 victim
    batch.incidents = {
        {1001, Priority::EmergencyCategory::ROAD_ACCIDENT, 5, 4, 1699999000000ULL, 26.2885993, 73.0240565, 2688566058, {}, {}, false},
        {1002, Priority::EmergencyCategory::FIRE, 4, 2, 1699999500000ULL, 26.3012733, 73.0429084, 3773158752, {}, {}, false},
        {1003, Priority::EmergencyCategory::MEDICAL, 3, 1, 1699999800000ULL, 26.2659527, 73.0087496, 5321319416, {}, {}, false}
    };

    // Available Fleet Stationed across city bases:
    batch.fleet_snapshot = {
        // AIIMS Jodhpur base (OSM 8520698362)
        {101, Allocation::ResourceType::ALS_AMBULANCE, Allocation::AvailabilityStatus::AVAILABLE, 26.2400087, 73.0066073, 8520698362, 1, 0},
        {102, Allocation::ResourceType::BLS_AMBULANCE, Allocation::AvailabilityStatus::AVAILABLE, 26.2400087, 73.0066073, 8520698362, 1, 0},
        // Basni Fire Station base (OSM 2694302020)
        {201, Allocation::ResourceType::FIRE_ENGINE, Allocation::AvailabilityStatus::AVAILABLE, 26.2230315, 73.0111845, 2694302020, 1, 0},
        {202, Allocation::ResourceType::FIRE_TENDER, Allocation::AvailabilityStatus::AVAILABLE, 26.2230315, 73.0111845, 2694302020, 1, 0},
        {203, Allocation::ResourceType::RESCUE_VEHICLE, Allocation::AvailabilityStatus::AVAILABLE, 26.2230315, 73.0111845, 2694302020, 1, 0},
        // Paota base (OSM 3773158752)
        {301, Allocation::ResourceType::BLS_AMBULANCE, Allocation::AvailabilityStatus::AVAILABLE, 26.3012733, 73.0429084, 3773158752, 1, 0}
    };

    // Major Hospitals in Jodhpur:
    batch.hospital_snapshot = {
        // AIIMS Jodhpur: Tertiary Trauma Center
        {1, "AIIMS Jodhpur", 26.2400087, 73.0066073, 8520698362, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY | Hospital::HospitalCapability::TRAUMA | Hospital::HospitalCapability::ICU |
         Hospital::HospitalCapability::OXYGEN_SUPPORT | Hospital::HospitalCapability::SURGICAL_SUPPORT,
         50, 10, 500, 80, 200, 30},
        // MDM Hospital: Regional Hospital
        {2, "MDM Hospital", 26.2659527, 73.0087496, 5321319416, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY | Hospital::HospitalCapability::TRAUMA | Hospital::HospitalCapability::ICU |
         Hospital::HospitalCapability::OXYGEN_SUPPORT | Hospital::HospitalCapability::BURN_TREATMENT | Hospital::HospitalCapability::SURGICAL_SUPPORT,
         30, 5, 400, 50, 150, 20},
        // MGH: Central City Hospital
        {3, "Mahatma Gandhi Hospital", 26.2832499, 73.0181569, 8499684813, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY | Hospital::HospitalCapability::TRAUMA | Hospital::HospitalCapability::ICU |
         Hospital::HospitalCapability::OXYGEN_SUPPORT | Hospital::HospitalCapability::SURGICAL_SUPPORT,
         25, 4, 300, 40, 100, 15}
    };

    DispatchBatchResult res = orchestrator.ProcessBatch(batch);
    TEST_ASSERT(res.valid_incidents == 3, "Expected all 3 incidents valid");
    TEST_ASSERT(res.incident_results.size() == 3, "Expected 3 results");

    // Incident 1001 (Severity 5) must be processed FIRST:
    TEST_ASSERT(res.incident_results[0].incident_id == 1001, "Incident 1001 must be processed first");
    std::cout << "  [Order 1] Incident 1001 - Priority Score: "
              << res.incident_results[0].priority_result.total_priority_score
              << " - Status: " << IncidentDispatchStatusToString(res.incident_results[0].dispatch_status) << std::endl;

    // Incident 1002 (Severity 4) must be processed SECOND:
    TEST_ASSERT(res.incident_results[1].incident_id == 1002, "Incident 1002 must be processed second");
    std::cout << "  [Order 2] Incident 1002 - Priority Score: "
              << res.incident_results[1].priority_result.total_priority_score
              << " - Status: " << IncidentDispatchStatusToString(res.incident_results[1].dispatch_status) << std::endl;

    // Incident 1003 (Severity 3) must be processed THIRD:
    TEST_ASSERT(res.incident_results[2].incident_id == 1003, "Incident 1003 must be processed third");
    std::cout << "  [Order 3] Incident 1003 - Priority Score: "
              << res.incident_results[2].priority_result.total_priority_score
              << " - Status: " << IncidentDispatchStatusToString(res.incident_results[2].dispatch_status) << std::endl;

    // Global resource uniqueness check across all 3 incidents
    std::unordered_set<uint64_t> allocated_ids;
    for (const auto& ir : res.incident_results) {
        for (const auto& r : ir.resource_allocation.selected_resources) {
            TEST_ASSERT(allocated_ids.count(r.resource_id) == 0, "Duplicate resource allocation detected in batch!");
            allocated_ids.insert(r.resource_id);
        }
    }
    TEST_ASSERT(allocated_ids.size() == res.total_unique_resources_recommended, "Unique resource count mismatch");

    std::cout << "  Total Unique Resources Recommended: " << res.total_unique_resources_recommended << std::endl;
    std::cout << "  Remaining Available Fleet Resources: " << res.remaining_available_resources << std::endl;
    std::cout << "  Total Execution Duration: " << res.total_execution_time_ms << " ms" << std::endl;

    std::cout << "Test8_CanonicalJodhpurSimultaneousDispatch: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 8. MULTI-INCIDENT BENCHMARKS (50 ITERATIONS)
// ============================================================================

bool RunDispatchOrchestrationBenchmarks() {
    std::cout << "\n====================================================================\n"
              << "  PHASE 3.11 DISPATCH ORCHESTRATION BENCHMARK SUITE (50 ITERATIONS)\n"
              << "====================================================================\n" << std::endl;

    Graph graph;
    std::cout << "Loading canonical graph dataset for benchmarking..." << std::endl;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    SpatialGrid grid;
    std::cout << "Building SpatialGrid..." << std::endl;
    grid.Build(graph, 250.0);

    BoundaryValidator boundary;
    boundary.LoadFromFile("data/jodhpur_boundary.geojson");

    DispatchOrchestrator orchestrator(graph, grid, &boundary);

    static const std::vector<int64_t> locations = {
        2688566058, // Sojati Gate
        3773158752, // Paota Circle
        5321319416, // MDM Hospital
        8520698362, // AIIMS Jodhpur
        2694302020  // Basni
    };

    // Fleet of 100 resources distributed across bases
    std::vector<Allocation::ResourceRecord> fleet;
    fleet.reserve(100);
    for (size_t i = 1; i <= 100; ++i) {
        Allocation::ResourceRecord r;
        r.resource_id = static_cast<uint64_t>(i);
        r.resource_type = static_cast<Allocation::ResourceType>(i % 5);
        r.availability_status = (i % 13 == 0) ? Allocation::AvailabilityStatus::DISPATCHED : Allocation::AvailabilityStatus::AVAILABLE;
        r.capacity = 1;
        r.current_node_osm_id = locations[i % locations.size()];
        fleet.push_back(r);
    }

    // 5 Hospitals with simulated capacities
    std::vector<Hospital::HospitalRecord> hospitals = {
        {1, "AIIMS Jodhpur", 26.2400087, 73.0066073, 8520698362, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY | Hospital::HospitalCapability::TRAUMA | Hospital::HospitalCapability::ICU |
         Hospital::HospitalCapability::OXYGEN_SUPPORT | Hospital::HospitalCapability::SURGICAL_SUPPORT,
         50, 15, 500, 100, 200, 40},
        {2, "MDM Hospital", 26.2659527, 73.0087496, 5321319416, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY | Hospital::HospitalCapability::TRAUMA | Hospital::HospitalCapability::ICU |
         Hospital::HospitalCapability::OXYGEN_SUPPORT | Hospital::HospitalCapability::BURN_TREATMENT | Hospital::HospitalCapability::SURGICAL_SUPPORT,
         30, 8, 400, 60, 150, 25},
        {3, "Mahatma Gandhi Hospital", 26.2832499, 73.0181569, 8499684813, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY | Hospital::HospitalCapability::TRAUMA | Hospital::HospitalCapability::ICU |
         Hospital::HospitalCapability::OXYGEN_SUPPORT | Hospital::HospitalCapability::SURGICAL_SUPPORT,
         25, 5, 300, 50, 100, 20},
        {4, "Paota Satellite Hospital", 26.3012733, 73.0429084, 3773158752, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY | Hospital::HospitalCapability::OXYGEN_SUPPORT,
         5, 1, 50, 15, 20, 10},
        {5, "Basni Health Center", 26.2230315, 73.0111845, 2694302020, Hospital::HospitalStatus::OPERATIONAL,
         Hospital::HospitalCapability::GENERAL_EMERGENCY,
         0, 0, 30, 10, 10, 5}
    };

    std::vector<size_t> batch_sizes = {1, 5, 10, 25, 50};
    const int WARMUP_ROUNDS = 5;
    const int MEASURE_ROUNDS = 50;

    std::cout << std::fixed << std::setprecision(4);
    std::cout << "| Batch Size (N) | Min Latency (ms) | Avg Latency (ms) | Median (ms) | p95 (ms) | Max Latency (ms) | Throughput (batch/s) | Memory RSS (MB) |\n";
    std::cout << "|---|---|---|---|---|---|---|---|\n";

    for (size_t N : batch_sizes) {
        DispatchBatchRequest req;
        req.batch_id = 1000 + N;
        req.evaluated_at_ms = 1700000000000ULL;
        req.fleet_snapshot = fleet;
        req.hospital_snapshot = hospitals;

        req.incidents.reserve(N);
        for (size_t i = 1; i <= N; ++i) {
            EmergencyIncident inc;
            inc.incident_id = static_cast<uint64_t>(i);
            inc.category = static_cast<Priority::EmergencyCategory>(i % 4);
            inc.severity = static_cast<uint32_t>((i % 5) + 1);
            inc.victim_count = static_cast<uint32_t>(i % 4);
            inc.created_at_ms = 1700000000000ULL - (i * 60000);
            inc.incident_node_osm_id = locations[i % locations.size()];
            req.incidents.push_back(inc);
        }

        // Warmup
        for (int w = 0; w < WARMUP_ROUNDS; ++w) {
            volatile auto r = orchestrator.ProcessBatch(req);
            (void)r;
        }

        // Measure
        std::vector<double> latencies;
        latencies.reserve(MEASURE_ROUNDS);

        for (int m = 0; m < MEASURE_ROUNDS; ++m) {
            auto t1 = std::chrono::high_resolution_clock::now();
            DispatchBatchResult res = orchestrator.ProcessBatch(req);
            auto t2 = std::chrono::high_resolution_clock::now();
            latencies.push_back(std::chrono::duration<double, std::milli>(t2 - t1).count());
            assert(res.batch_status == BatchProcessingStatus::SUCCESS || res.batch_status == BatchProcessingStatus::PARTIAL_SUCCESS);
        }

        std::sort(latencies.begin(), latencies.end());
        double min_lat = latencies.front();
        double max_lat = latencies.back();
        double sum = std::accumulate(latencies.begin(), latencies.end(), 0.0);
        double avg_lat = sum / latencies.size();
        double med_lat = latencies[latencies.size() / 2];
        size_t p95_idx = static_cast<size_t>(latencies.size() * 0.95);
        if (p95_idx >= latencies.size()) p95_idx = latencies.size() - 1;
        double p95_lat = latencies[p95_idx];
        double throughput = (avg_lat > 0.0) ? (1000.0 / avg_lat) : 0.0;
        double current_rss_mb = EmergencyRouting::MemoryProfiler::Capture().WorkingSetMb();

        std::cout << "| N = " << std::setw(5) << N << " | "
                  << std::setw(16) << min_lat << " | "
                  << std::setw(16) << avg_lat << " | "
                  << std::setw(11) << med_lat << " | "
                  << std::setw(8) << p95_lat << " | "
                  << std::setw(16) << max_lat << " | "
                  << std::setw(20) << static_cast<size_t>(throughput) << " | "
                  << std::setw(15) << current_rss_mb << " |\n";
    }

    std::cout << "\nBenchmark complete.\n" << std::endl;
    return true;
}

int main() {
    std::cout << "====================================================\n"
              << "  PHASE 3.11 DISPATCH ORCHESTRATOR TEST SUITE\n"
              << "====================================================\n" << std::endl;

    int passed = 0;
    int failed = 0;

    auto run_test = [&](bool (*test_fn)(), const char* name) {
        if (test_fn()) {
            passed++;
        } else {
            failed++;
            std::cerr << "FAIL: " << name << std::endl;
        }
    };

    run_test(Test1_BatchValidation, "Test1_BatchValidation");
    run_test(Test2_DuplicateAndInvalidIncidents, "Test2_DuplicateAndInvalidIncidents");
    run_test(Test3_PriorityOrdering, "Test3_PriorityOrdering");
    run_test(Test4_GlobalResourceConflictPrevention, "Test4_GlobalResourceConflictPrevention");
    run_test(Test5_GlobalHospitalCapacityConflictPrevention, "Test5_GlobalHospitalCapacityConflictPrevention");
    run_test(Test6_OriginalRequestImmutability, "Test6_OriginalRequestImmutability");
    run_test(Test7_Determinism, "Test7_Determinism");
    run_test(Test8_CanonicalJodhpurSimultaneousDispatch, "Test8_CanonicalJodhpurSimultaneousDispatch");
    run_test(RunDispatchOrchestrationBenchmarks, "RunDispatchOrchestrationBenchmarks");

    std::cout << "====================================================\n"
              << "  TEST RESULTS SUMMARY\n"
              << "  Passed: " << passed << " / " << (passed + failed) << "\n"
              << "  Failed: " << failed << "\n"
              << "====================================================\n" << std::endl;

    return (failed == 0) ? 0 : 1;
}
