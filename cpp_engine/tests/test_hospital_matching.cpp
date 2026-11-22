#include "HospitalMatchingEngine.hpp"
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
using namespace EmergencyRouting::Hospital;

#define TEST_ASSERT(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "[TEST_FAIL] " << __FUNCTION__ << ":" << __LINE__ << " - " << msg << std::endl; \
            return false; \
        } \
    } while (0)

// Helper to construct synthetic test graph:
// 0 -> 1 -> 2 -> 3 -> 4 (directed road, 100m each)
// 1 -> 0 (100m)
Graph BuildSyntheticDirectedGraph() {
    Graph g;
    g.AddNode(10, 26.25, 73.00, false); // Node 0
    g.AddNode(20, 26.26, 73.01, false); // Node 1
    g.AddNode(30, 26.27, 73.02, false); // Node 2
    g.AddNode(40, 26.28, 73.03, false); // Node 3
    g.AddNode(50, 26.29, 73.04, false); // Node 4
    g.AddNode(99, 26.35, 73.10, false); // Disconnected component Node 5

    // Forward chain: 0 -> 1 -> 2 -> 3 -> 4
    for (uint32_t i = 0; i < 4; ++i) {
        g.AddEdge(i, i + 1, 100.0, i + 1, 0, 0, 0, true, {});
    }
    // Reverse edge only for 1 -> 0
    g.AddEdge(1, 0, 100.0, 10, 0, 0, 0, true, {});

    return g;
}

// ============================================================================
// 1. INPUT VALIDATION TESTS
// ============================================================================

bool Test1_InvalidIncidentId() {
    std::cout << "Running Test1_InvalidIncidentId..." << std::endl;
    Graph g = BuildSyntheticDirectedGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 0; // Invalid
    req.requirements.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;

    std::vector<HospitalRecord> hospitals = {
        {1, "Hospital 1", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };

    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.status == HospitalMatchStatus::INVALID_REQUEST, "Expected INVALID_REQUEST for incident_id=0");
    std::cout << "Test1_InvalidIncidentId: PASSED\n" << std::endl;
    return true;
}

bool Test2_InvalidCategoryEnum() {
    std::cout << "Running Test2_InvalidCategoryEnum..." << std::endl;
    Graph g = BuildSyntheticDirectedGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 101;
    req.requirements.category = static_cast<Priority::EmergencyCategory>(99); // Invalid enum
    req.incident_node_osm_id = 10;

    std::vector<HospitalRecord> hospitals = {
        {1, "Hospital 1", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };

    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.status == HospitalMatchStatus::INVALID_REQUEST, "Expected INVALID_REQUEST for category=99");
    std::cout << "Test2_InvalidCategoryEnum: PASSED\n" << std::endl;
    return true;
}

bool Test3_InvalidSimulatedSpeed() {
    std::cout << "Running Test3_InvalidSimulatedSpeed..." << std::endl;
    Graph g = BuildSyntheticDirectedGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 101;
    req.requirements.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;

    std::vector<HospitalRecord> hospitals = {
        {1, "Hospital 1", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };

    // Zero speed
    req.simulated_speed_kmh = 0.0;
    HospitalMatchingResult res1 = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res1.status == HospitalMatchStatus::INVALID_REQUEST, "Expected INVALID_REQUEST for speed=0");

    // Negative speed
    req.simulated_speed_kmh = -25.0;
    HospitalMatchingResult res2 = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res2.status == HospitalMatchStatus::INVALID_REQUEST, "Expected INVALID_REQUEST for speed < 0");

    // NaN speed
    req.simulated_speed_kmh = std::numeric_limits<double>::quiet_NaN();
    HospitalMatchingResult res3 = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res3.status == HospitalMatchStatus::INVALID_REQUEST, "Expected INVALID_REQUEST for speed=NaN");

    std::cout << "Test3_InvalidSimulatedSpeed: PASSED\n" << std::endl;
    return true;
}

bool Test4_EmptyHospitalPool() {
    std::cout << "Running Test4_EmptyHospitalPool..." << std::endl;
    Graph g = BuildSyntheticDirectedGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 101;
    req.requirements.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;

    std::vector<HospitalRecord> hospitals; // Empty
    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.status == HospitalMatchStatus::NO_HOSPITALS_AVAILABLE, "Expected NO_HOSPITALS_AVAILABLE");
    std::cout << "Test4_EmptyHospitalPool: PASSED\n" << std::endl;
    return true;
}

bool Test5_InvalidHospitalRecords() {
    std::cout << "Running Test5_InvalidHospitalRecords..." << std::endl;
    Graph g = BuildSyntheticDirectedGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 101;
    req.requirements.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;

    std::vector<HospitalRecord> hospitals = {
        // 1. ID 0
        {0, "Hospital Zero", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5},
        // 2. Empty Name
        {2, "", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5},
        // 3. Available ICU > Total ICU
        {3, "Hospital Bad ICU", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 10, 20, 10, 10, 5},
        // 4. Available General > Total General
        {4, "Hospital Bad General", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 30, 10, 5},
        // 5. Duplicate ID (reuses ID 3)
        {3, "Hospital Duplicate ID", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };

    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.invalid_hospitals.size() == 5, "Expected all 5 records to be invalid");
    TEST_ASSERT(res.status == HospitalMatchStatus::NO_SUITABLE_HOSPITAL, "Expected NO_SUITABLE_HOSPITAL");

    std::cout << "Test5_InvalidHospitalRecords: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 2. OPERATIONAL STATUS FILTERING
// ============================================================================

bool Test6_HospitalOperationalStatusFiltering() {
    std::cout << "Running Test6_HospitalOperationalStatusFiltering..." << std::endl;
    Graph g = BuildSyntheticDirectedGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 101;
    req.requirements.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;
    req.requirements.required_capabilities = HospitalCapability::GENERAL_EMERGENCY;
    req.requirements.required_general_beds = 1;

    std::vector<HospitalRecord> hospitals = {
        // Operational
        {1, "Hospital Operational", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5},
        // Temporarily Unavailable (diversion)
        {2, "Hospital Diverted", 26.27, 73.02, 30, HospitalStatus::TEMPORARILY_UNAVAILABLE, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5},
        // Closed
        {3, "Hospital Closed", 26.28, 73.03, 40, HospitalStatus::CLOSED, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };

    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.status == HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND, "Expected SUITABLE_HOSPITALS_FOUND");
    TEST_ASSERT(res.suitable_hospitals.size() == 1, "Expected exactly 1 suitable hospital");
    TEST_ASSERT(res.suitable_hospitals[0].hospital_id == 1, "Expected Hospital 1 to be suitable");
    TEST_ASSERT(res.unavailable_hospitals.size() == 2, "Expected 2 unavailable hospitals");

    std::cout << "Test6_HospitalOperationalStatusFiltering: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 3. CLINICAL CAPABILITY MATCHING
// ============================================================================

bool Test7_ClinicalCapabilityMatching() {
    std::cout << "Running Test7_ClinicalCapabilityMatching..." << std::endl;
    Graph g = BuildSyntheticDirectedGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 101;
    req.requirements.category = Priority::EmergencyCategory::ROAD_ACCIDENT;
    req.incident_node_osm_id = 10;
    // Mandate Trauma + Surgical Support
    req.requirements.required_capabilities = HospitalCapability::GENERAL_EMERGENCY |
                                            HospitalCapability::TRAUMA |
                                            HospitalCapability::SURGICAL_SUPPORT;
    req.requirements.required_general_beds = 1;

    std::vector<HospitalRecord> hospitals = {
        // Full Match + Extra capability (Burn Unit)
        {1, "Trauma Center Full", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL,
         HospitalCapability::GENERAL_EMERGENCY | HospitalCapability::TRAUMA | HospitalCapability::SURGICAL_SUPPORT | HospitalCapability::BURN_TREATMENT,
         10, 5, 50, 20, 20, 10},
        // Missing Surgical Support
        {2, "Community Clinic Missing Surgery", 26.27, 73.02, 30, HospitalStatus::OPERATIONAL,
         HospitalCapability::GENERAL_EMERGENCY | HospitalCapability::TRAUMA,
         10, 5, 50, 20, 20, 10},
        // Missing Trauma & Surgery
        {3, "Dispensary Basic", 26.28, 73.03, 40, HospitalStatus::OPERATIONAL,
         HospitalCapability::GENERAL_EMERGENCY,
         10, 5, 50, 20, 20, 10}
    };

    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.status == HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND, "Expected SUITABLE_HOSPITALS_FOUND");
    TEST_ASSERT(res.suitable_hospitals.size() == 1, "Only Hospital 1 should be fully suitable");
    TEST_ASSERT(res.suitable_hospitals[0].hospital_id == 1, "Hospital 1 match failed");

    // Partial alternatives check
    TEST_ASSERT(res.partial_alternatives.size() == 2, "Expected 2 partial alternatives");
    // Hospital 2 missing 1 capability (SURGICAL_SUPPORT)
    TEST_ASSERT(res.partial_alternatives[0].hospital_id == 2, "Hospital 2 should rank ahead of Hospital 3");
    TEST_ASSERT(res.partial_alternatives[0].missing_capabilities.size() == 1, "Expected 1 missing cap");
    TEST_ASSERT(res.partial_alternatives[0].missing_capabilities[0] == HospitalCapability::SURGICAL_SUPPORT, "Expected missing SURGICAL_SUPPORT");
    // Hospital 3 missing 2 capabilities
    TEST_ASSERT(res.partial_alternatives[1].hospital_id == 3, "Hospital 3 should rank 2nd");
    TEST_ASSERT(res.partial_alternatives[1].missing_capabilities.size() == 2, "Expected 2 missing caps");

    std::cout << "Test7_ClinicalCapabilityMatching: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 4. CAPACITY EVALUATION & SHORTAGE ACCOUNTING
// ============================================================================

bool Test8_CapacityEvaluationAndShortageAccounting() {
    std::cout << "Running Test8_CapacityEvaluationAndShortageAccounting..." << std::endl;
    Graph g = BuildSyntheticDirectedGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 101;
    req.requirements.category = Priority::EmergencyCategory::INDUSTRIAL;
    req.incident_node_osm_id = 10;
    req.requirements.required_capabilities = HospitalCapability::GENERAL_EMERGENCY;
    // Demands: 2 ICU beds, 3 General beds, 2 Oxygen beds
    req.requirements.required_icu_beds = 2;
    req.requirements.required_general_beds = 3;
    req.requirements.required_oxygen_beds = 2;

    std::vector<HospitalRecord> hospitals = {
        // Hospital 1: Sufficient in all dimensions
        {1, "Hospital Ample", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY,
         10, 5, 50, 10, 20, 8},
        // Hospital 2: ICU deficit (1 avail vs 2 req -> shortage 1)
        {2, "Hospital ICU Deficit", 26.27, 73.02, 30, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY,
         10, 1, 50, 10, 20, 8},
        // Hospital 3: Zero general beds available (0 avail vs 3 req -> shortage 3)
        {3, "Hospital General Full", 26.28, 73.03, 40, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY,
         10, 5, 50, 0, 20, 8}
    };

    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.status == HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND, "Expected SUITABLE_HOSPITALS_FOUND");
    TEST_ASSERT(res.suitable_hospitals.size() == 1, "Expected 1 suitable hospital");
    TEST_ASSERT(res.suitable_hospitals[0].hospital_id == 1, "Hospital 1 expected");

    TEST_ASSERT(res.partial_alternatives.size() == 2, "Expected 2 partial alternatives");
    // Verify shortages recorded accurately
    TEST_ASSERT(res.partial_alternatives[0].hospital_id == 2, "Expected Hospital 2 (shortage=1)");
    TEST_ASSERT(res.partial_alternatives[0].icu_bed_shortage == 1, "ICU shortage should be 1");
    TEST_ASSERT(res.partial_alternatives[0].general_bed_shortage == 0, "Gen shortage should be 0");

    TEST_ASSERT(res.partial_alternatives[1].hospital_id == 3, "Expected Hospital 3 (shortage=3)");
    TEST_ASSERT(res.partial_alternatives[1].general_bed_shortage == 3, "Gen shortage should be 3");

    std::cout << "Test8_CapacityEvaluationAndShortageAccounting: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 5. DIRECTED ROAD DISTANCE & ETA CALCULATION
// ============================================================================

bool Test9_DirectedRoadDistanceAndEta() {
    std::cout << "Running Test9_DirectedRoadDistanceAndEta..." << std::endl;
    Graph g = BuildSyntheticDirectedGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 101;
    req.requirements.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10; // Node 0
    req.requirements.required_capabilities = HospitalCapability::GENERAL_EMERGENCY;
    req.requirements.required_general_beds = 1;
    req.simulated_speed_kmh = 36.0; // 36 km/h = 10.0 m/s for clean integer ETAs

    std::vector<HospitalRecord> hospitals = {
        // Co-located at Node 0 (same node as incident)
        {1, "Hospital On Scene", 26.25, 73.00, 10, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5},
        // Forward 1 hop: Node 1 (100m)
        {2, "Hospital 100m", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5},
        // Forward 3 hops: Node 3 (300m)
        {3, "Hospital 300m", 26.28, 73.03, 40, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5},
        // Disconnected Node 5 (Node 99)
        {4, "Hospital Unreachable", 26.35, 73.10, 99, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };

    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.status == HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND, "Expected SUITABLE_HOSPITALS_FOUND");
    TEST_ASSERT(res.suitable_hospitals.size() == 3, "Expected 3 reachable suitable hospitals");
    TEST_ASSERT(res.unreachable_hospitals.size() == 1, "Expected 1 unreachable hospital");

    // Co-located node: dist = 0, ETA = 0
    TEST_ASSERT(res.suitable_hospitals[0].hospital_id == 1, "Hospital 1 should be first");
    TEST_ASSERT(res.suitable_hospitals[0].road_distance_meters == 0.0, "Dist should be 0.0");
    TEST_ASSERT(res.suitable_hospitals[0].simulated_eta_seconds == 0.0, "ETA should be 0.0");

    // 100m node: dist = 100, ETA = 10s (100m / 10m/s)
    TEST_ASSERT(res.suitable_hospitals[1].hospital_id == 2, "Hospital 2 should be second");
    TEST_ASSERT(std::abs(res.suitable_hospitals[1].road_distance_meters - 100.0) < 1e-4, "Dist should be 100.0");
    TEST_ASSERT(std::abs(res.suitable_hospitals[1].simulated_eta_seconds - 10.0) < 1e-4, "ETA should be 10.0s");

    // 300m node: dist = 300, ETA = 30s
    TEST_ASSERT(res.suitable_hospitals[2].hospital_id == 3, "Hospital 3 should be third");
    TEST_ASSERT(std::abs(res.suitable_hospitals[2].road_distance_meters - 300.0) < 1e-4, "Dist should be 300.0");
    TEST_ASSERT(std::abs(res.suitable_hospitals[2].simulated_eta_seconds - 30.0) < 1e-4, "ETA should be 30.0s");

    // Unreachable
    TEST_ASSERT(res.unreachable_hospitals[0].hospital_id == 4, "Hospital 4 should be unreachable");
    TEST_ASSERT(std::isinf(res.unreachable_hospitals[0].road_distance_meters), "Distance should be inf");

    // Test One-Way Street Directionality:
    // Route from Node 2 -> Node 0 is IMPOSSIBLE because the edges are:
    // 0->1, 1->2, 2->3, 3->4, and 1->0.
    // There is NO edge 2->1! So 2 cannot reach 0 or 1!
    HospitalMatchRequest req_rev;
    req_rev.incident_id = 102;
    req_rev.incident_node_osm_id = 30; // Node 2
    req_rev.requirements = req.requirements;
    req_rev.simulated_speed_kmh = 36.0;

    std::vector<HospitalRecord> rev_hospitals = {
        {1, "Hospital At Node 0", 26.25, 73.00, 10, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };
    HospitalMatchingResult res_rev = engine.MatchHospitals(req_rev, rev_hospitals);
    TEST_ASSERT(res_rev.unreachable_hospitals.size() == 1, "Node 2 -> Node 0 must be UNREACHABLE on one-way street");

    std::cout << "Test9_DirectedRoadDistanceAndEta: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 6. GEOGRAPHIC BOUNDARY & STRICT SNAPPING
// ============================================================================

bool Test10_GeographicBoundaryAndSnapping() {
    std::cout << "Running Test10_GeographicBoundaryAndSnapping..." << std::endl;
    Graph g;
    g.AddNode(101, 26.28, 73.02, false);
    SpatialGrid grid;
    grid.Build(g, 250.0);

    BoundaryValidator boundary;
    boundary.LoadFromFile("data/jodhpur_boundary.geojson");
    HospitalMatchingEngine engine(g, grid, &boundary);

    // Incident outside boundary (e.g., Delhi: lat=28.61, lon=77.20)
    HospitalMatchRequest req_out;
    req_out.incident_id = 101;
    req_out.incident_latitude = 28.61;
    req_out.incident_longitude = 77.20;
    req_out.requirements.category = Priority::EmergencyCategory::MEDICAL;

    std::vector<HospitalRecord> hospitals = {
        {1, "Hospital Jodhpur", 26.28, 73.02, 101, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };

    HospitalMatchingResult res_out = engine.MatchHospitals(req_out, hospitals);
    TEST_ASSERT(res_out.status == HospitalMatchStatus::INVALID_REQUEST, "Incident outside boundary must return INVALID_REQUEST");

    // Hospital outside boundary
    HospitalMatchRequest req_in;
    req_in.incident_id = 102;
    req_in.incident_node_osm_id = 101; // inside
    req_in.requirements.category = Priority::EmergencyCategory::MEDICAL;

    std::vector<HospitalRecord> hospitals_out = {
        {2, "Hospital Delhi", 28.61, 77.20, 0, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 5, 2, 20, 10, 10, 5}
    };

    HospitalMatchingResult res_h_out = engine.MatchHospitals(req_in, hospitals_out);
    TEST_ASSERT(res_h_out.invalid_hospitals.size() == 1, "Hospital outside boundary must be invalid");
    TEST_ASSERT(res_h_out.invalid_hospitals[0].suitability == HospitalSuitability::OUTSIDE_SERVICE_AREA, "Expected OUTSIDE_SERVICE_AREA");

    std::cout << "Test10_GeographicBoundaryAndSnapping: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 7. DETERMINISTIC RANKING & TIE-BREAKING
// ============================================================================

bool Test11_DeterministicRankingAndTieBreaking() {
    std::cout << "Running Test11_DeterministicRankingAndTieBreaking..." << std::endl;
    // Graph with fan-out from Node 0:
    // 0 -> 1 (300m)
    // 0 -> 2 (300m)
    // 0 -> 3 (300m)
    // 0 -> 4 (500m)
    Graph g;
    g.AddNode(10, 26.25, 73.00, false); // Node 0
    g.AddNode(20, 26.26, 73.01, false); // Node 1
    g.AddNode(30, 26.27, 73.02, false); // Node 2
    g.AddNode(40, 26.28, 73.03, false); // Node 3
    g.AddNode(50, 26.29, 73.04, false); // Node 4

    g.AddEdge(0, 1, 300.0, 1, 0, 0, 0, true, {});
    g.AddEdge(0, 2, 300.0, 2, 0, 0, 0, true, {});
    g.AddEdge(0, 3, 300.0, 3, 0, 0, 0, true, {});
    g.AddEdge(0, 4, 500.0, 4, 0, 0, 0, true, {});

    SpatialGrid grid;
    grid.Build(g, 250.0);
    HospitalMatchingEngine engine(g, grid);

    HospitalMatchRequest req;
    req.incident_id = 101;
    req.incident_node_osm_id = 10;
    req.requirements.category = Priority::EmergencyCategory::MEDICAL;
    req.requirements.required_capabilities = HospitalCapability::GENERAL_EMERGENCY;
    req.requirements.required_general_beds = 1;
    req.simulated_speed_kmh = 30.0;

    // We have:
    // Hospital A: Node 4 (500m), general beds avail = 10, ID = 2
    // Hospital B: Node 1 (300m), general beds avail = 5, ID = 3
    // Hospital C: Node 2 (300m), general beds avail = 8, ID = 1
    // Hospital D: Node 3 (300m), general beds avail = 8, ID = 4
    //
    // Ranking expectations:
    // Distance 300m beats 500m -> B, C, D beat A.
    // Between C and D: both 300m, both have 8 available general beds -> Tie broken by ID: C (ID 1) beats D (ID 4)!
    // Between C/D and B: C and D have 8 available beds > B's 5 beds -> C and D beat B!
    // Therefore expected order:
    // 1st: C (ID 1)
    // 2nd: D (ID 4)
    // 3rd: B (ID 3)
    // 4th: A (ID 2)
    std::vector<HospitalRecord> hospitals = {
        {2, "Hospital A (500m)", 26.29, 73.04, 50, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 0, 0, 20, 10, 0, 0},
        {3, "Hospital B (300m, cap 5)", 26.26, 73.01, 20, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 0, 0, 20, 5, 0, 0},
        {1, "Hospital C (300m, cap 8)", 26.27, 73.02, 30, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 0, 0, 20, 8, 0, 0},
        {4, "Hospital D (300m, cap 8)", 26.28, 73.03, 40, HospitalStatus::OPERATIONAL, HospitalCapability::GENERAL_EMERGENCY, 0, 0, 20, 8, 0, 0}
    };

    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.suitable_hospitals.size() == 4, "Expected all 4 hospitals suitable");
    TEST_ASSERT(res.suitable_hospitals[0].hospital_id == 1, "1st place should be Hospital C (ID 1)");
    TEST_ASSERT(res.suitable_hospitals[1].hospital_id == 4, "2nd place should be Hospital D (ID 4)");
    TEST_ASSERT(res.suitable_hospitals[2].hospital_id == 3, "3rd place should be Hospital B (ID 3)");
    TEST_ASSERT(res.suitable_hospitals[3].hospital_id == 2, "4th place should be Hospital A (ID 2)");

    std::cout << "Test11_DeterministicRankingAndTieBreaking: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 8. CANONICAL JODHPUR FACILITY MATCHING
// ============================================================================

bool Test12_CanonicalJodhpurFacilityMatching() {
    std::cout << "Running Test12_CanonicalJodhpurFacilityMatching..." << std::endl;
    Graph graph;
    std::cout << "  Loading canonical graph..." << std::endl;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    SpatialGrid grid;
    std::cout << "  Building SpatialGrid..." << std::endl;
    grid.Build(graph, 250.0);

    BoundaryValidator boundary;
    boundary.LoadFromFile("data/jodhpur_boundary.geojson");

    HospitalMatchingEngine engine(graph, grid, &boundary);

    // Incident at Sojati Gate (OSM 2688566058)
    HospitalMatchRequest req;
    req.incident_id = 999;
    req.incident_node_osm_id = 2688566058;
    req.requirements = HospitalRequirement::CreateDefault(Priority::EmergencyCategory::ROAD_ACCIDENT);
    // Requires: GENERAL_EMERGENCY | TRAUMA | SURGICAL_SUPPORT; 1 general bed, 1 ICU bed
    req.simulated_speed_kmh = 30.0;

    // Authentic Jodhpur hospital facilities:
    std::vector<HospitalRecord> hospitals = {
        // AIIMS Jodhpur: Comprehensive Tertiary Trauma Center
        {101, "AIIMS Jodhpur", 26.2400087, 73.0066073, 8520698362, HospitalStatus::OPERATIONAL,
         HospitalCapability::GENERAL_EMERGENCY | HospitalCapability::TRAUMA | HospitalCapability::ICU |
         HospitalCapability::OXYGEN_SUPPORT | HospitalCapability::BURN_TREATMENT | HospitalCapability::SURGICAL_SUPPORT,
         50, 12, 500, 85, 200, 45},

        // MDM Hospital: Major Regional Referral Hospital
        {102, "Mathura Das Mathur (MDM) Hospital", 26.2659527, 73.0087496, 5321319416, HospitalStatus::OPERATIONAL,
         HospitalCapability::GENERAL_EMERGENCY | HospitalCapability::TRAUMA | HospitalCapability::ICU |
         HospitalCapability::OXYGEN_SUPPORT | HospitalCapability::SURGICAL_SUPPORT,
         30, 8, 400, 60, 150, 30},

        // Mahatma Gandhi Hospital (MGH): Downtown Central Hospital (Closest to Sojati Gate!)
        {103, "Mahatma Gandhi Hospital (MGH)", 26.2832499, 73.0181569, 8499684813, HospitalStatus::OPERATIONAL,
         HospitalCapability::GENERAL_EMERGENCY | HospitalCapability::TRAUMA | HospitalCapability::ICU |
         HospitalCapability::OXYGEN_SUPPORT | HospitalCapability::SURGICAL_SUPPORT,
         25, 4, 300, 40, 100, 20},

        // Paota Satellite Hospital: General Community Hospital (Lacks Trauma & Surgery)
        {104, "Paota Satellite Hospital", 26.3012733, 73.0429084, 3773158752, HospitalStatus::OPERATIONAL,
         HospitalCapability::GENERAL_EMERGENCY | HospitalCapability::OXYGEN_SUPPORT,
         5, 0, 50, 15, 20, 10}
    };

    HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
    TEST_ASSERT(res.status == HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND, "Expected SUITABLE_HOSPITALS_FOUND");
    TEST_ASSERT(res.suitable_hospitals.size() == 3, "Expected AIIMS, MDM, MGH to be suitable");
    TEST_ASSERT(res.partial_alternatives.size() == 1, "Expected Paota to be a partial alternative");

    // Verify MGH is closest to Sojati Gate and ranks 1st!
    std::cout << "  Rank 1: " << res.suitable_hospitals[0].hospital_name
              << " - Road Distance: " << res.suitable_hospitals[0].road_distance_meters << " m"
              << " - ETA: " << res.suitable_hospitals[0].simulated_eta_seconds << " s" << std::endl;
    std::cout << "  Rank 2: " << res.suitable_hospitals[1].hospital_name
              << " - Road Distance: " << res.suitable_hospitals[1].road_distance_meters << " m"
              << " - ETA: " << res.suitable_hospitals[1].simulated_eta_seconds << " s" << std::endl;
    std::cout << "  Rank 3: " << res.suitable_hospitals[2].hospital_name
              << " - Road Distance: " << res.suitable_hospitals[2].road_distance_meters << " m"
              << " - ETA: " << res.suitable_hospitals[2].simulated_eta_seconds << " s" << std::endl;

    TEST_ASSERT(res.suitable_hospitals[0].hospital_id == 103, "MGH should be Rank 1 due to proximity to Sojati Gate");
    TEST_ASSERT(res.suitable_hospitals[0].road_distance_meters < res.suitable_hospitals[1].road_distance_meters, "Ascending distance verification");
    TEST_ASSERT(res.suitable_hospitals[1].road_distance_meters < res.suitable_hospitals[2].road_distance_meters, "Ascending distance verification");

    // Verify Paota missing capabilities reported properly
    TEST_ASSERT(res.partial_alternatives[0].hospital_id == 104, "Paota should be in partial alternatives");
    TEST_ASSERT(res.partial_alternatives[0].suitability == HospitalSuitability::CAPABILITY_MISMATCH, "Expected CAPABILITY_MISMATCH for Paota");

    std::cout << "Test12_CanonicalJodhpurFacilityMatching: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 9. PERFORMANCE BENCHMARKS (50 ITERATIONS)
// ============================================================================

bool RunHospitalMatchingBenchmarks() {
    std::cout << "\n====================================================================\n"
              << "  PHASE 3.10 HOSPITAL MATCHING BENCHMARK SUITE (50 ITERATIONS)\n"
              << "====================================================================\n" << std::endl;

    Graph graph;
    std::cout << "Loading canonical graph dataset for benchmarking..." << std::endl;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    SpatialGrid grid;
    std::cout << "Building SpatialGrid..." << std::endl;
    grid.Build(graph, 250.0);

    BoundaryValidator boundary;
    boundary.LoadFromFile("data/jodhpur_boundary.geojson");

    HospitalMatchingEngine engine(graph, grid, &boundary);

    // Fixed incident at Sojati Gate (OSM 2688566058)
    HospitalMatchRequest req;
    req.incident_id = 9999;
    req.incident_node_osm_id = 2688566058;
    req.requirements = HospitalRequirement::CreateDefault(Priority::EmergencyCategory::ROAD_ACCIDENT);
    req.simulated_speed_kmh = 30.0;

    static const std::vector<int64_t> facility_nodes = {
        8520698362, // AIIMS Jodhpur
        5321319416, // MDM Hospital
        8499684813, // MGH
        2694302020, // Basni Health Facility
        3773158752  // Paota Satellite Hospital
    };

    std::vector<size_t> pool_sizes = {5, 10, 25, 50, 100};
    const int WARMUP_ROUNDS = 5;
    const int MEASURE_ROUNDS = 50;

    std::cout << std::fixed << std::setprecision(4);
    std::cout << "| Pool Size (M) | Min Latency (ms) | Avg Latency (ms) | Median (ms) | p95 (ms) | Max Latency (ms) | Throughput (req/s) | Memory RSS (MB) |\n";
    std::cout << "|---|---|---|---|---|---|---|---|\n";

    for (size_t M : pool_sizes) {
        std::vector<HospitalRecord> hospitals;
        hospitals.reserve(M);
        for (size_t i = 1; i <= M; ++i) {
            HospitalRecord h;
            h.hospital_id = static_cast<uint64_t>(i);
            h.hospital_name = "Simulation Hospital #" + std::to_string(i);
            h.current_node_osm_id = facility_nodes[i % facility_nodes.size()];
            h.hospital_status = (i % 17 == 0) ? HospitalStatus::TEMPORARILY_UNAVAILABLE : HospitalStatus::OPERATIONAL;
            h.emergency_capabilities = HospitalCapability::GENERAL_EMERGENCY |
                                      HospitalCapability::TRAUMA |
                                      HospitalCapability::SURGICAL_SUPPORT |
                                      HospitalCapability::ICU |
                                      HospitalCapability::OXYGEN_SUPPORT;
            h.icu_beds_total = 20;
            h.icu_beds_available = 5;
            h.general_beds_total = 100;
            h.general_beds_available = 25;
            h.oxygen_supported_beds_total = 50;
            h.oxygen_supported_beds_available = 15;
            hospitals.push_back(h);
        }

        // Warm-up
        for (int w = 0; w < WARMUP_ROUNDS; ++w) {
            volatile auto r = engine.MatchHospitals(req, hospitals);
            (void)r;
        }

        // Timed measurement
        std::vector<double> latencies;
        latencies.reserve(MEASURE_ROUNDS);

        for (int m = 0; m < MEASURE_ROUNDS; ++m) {
            auto t1 = std::chrono::high_resolution_clock::now();
            HospitalMatchingResult res = engine.MatchHospitals(req, hospitals);
            auto t2 = std::chrono::high_resolution_clock::now();
            latencies.push_back(std::chrono::duration<double, std::milli>(t2 - t1).count());
            assert(res.status == HospitalMatchStatus::SUITABLE_HOSPITALS_FOUND);
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

        std::cout << "| M = " << std::setw(5) << M << " | "
                  << std::setw(16) << min_lat << " | "
                  << std::setw(16) << avg_lat << " | "
                  << std::setw(11) << med_lat << " | "
                  << std::setw(8) << p95_lat << " | "
                  << std::setw(16) << max_lat << " | "
                  << std::setw(18) << static_cast<size_t>(throughput) << " | "
                  << std::setw(15) << current_rss_mb << " |\n";
    }

    std::cout << "\nBenchmark complete.\n" << std::endl;
    return true;
}

int main() {
    std::cout << "====================================================\n"
              << "  PHASE 3.10 HOSPITAL MATCHING ENGINE TEST SUITE\n"
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

    run_test(Test1_InvalidIncidentId, "Test1_InvalidIncidentId");
    run_test(Test2_InvalidCategoryEnum, "Test2_InvalidCategoryEnum");
    run_test(Test3_InvalidSimulatedSpeed, "Test3_InvalidSimulatedSpeed");
    run_test(Test4_EmptyHospitalPool, "Test4_EmptyHospitalPool");
    run_test(Test5_InvalidHospitalRecords, "Test5_InvalidHospitalRecords");
    run_test(Test6_HospitalOperationalStatusFiltering, "Test6_HospitalOperationalStatusFiltering");
    run_test(Test7_ClinicalCapabilityMatching, "Test7_ClinicalCapabilityMatching");
    run_test(Test8_CapacityEvaluationAndShortageAccounting, "Test8_CapacityEvaluationAndShortageAccounting");
    run_test(Test9_DirectedRoadDistanceAndEta, "Test9_DirectedRoadDistanceAndEta");
    run_test(Test10_GeographicBoundaryAndSnapping, "Test10_GeographicBoundaryAndSnapping");
    run_test(Test11_DeterministicRankingAndTieBreaking, "Test11_DeterministicRankingAndTieBreaking");
    run_test(Test12_CanonicalJodhpurFacilityMatching, "Test12_CanonicalJodhpurFacilityMatching");
    run_test(RunHospitalMatchingBenchmarks, "RunHospitalMatchingBenchmarks");

    std::cout << "====================================================\n"
              << "  TEST RESULTS SUMMARY\n"
              << "  Passed: " << passed << " / " << (passed + failed) << "\n"
              << "  Failed: " << failed << "\n"
              << "====================================================\n" << std::endl;

    return (failed == 0) ? 0 : 1;
}
