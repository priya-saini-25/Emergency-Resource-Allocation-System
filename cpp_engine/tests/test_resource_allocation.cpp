#include "ResourceAllocationEngine.hpp"
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
using namespace EmergencyRouting::Allocation;

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
    g.AddNode(10, 26.25, 73.00, false); // 0
    g.AddNode(20, 26.26, 73.01, false); // 1
    g.AddNode(30, 26.27, 73.02, false); // 2
    g.AddNode(40, 26.28, 73.03, false); // 3
    g.AddNode(50, 26.29, 73.04, false); // 4

    // Bidirectional edges of 100.0m between i and i+1
    for (uint32_t i = 0; i < 4; ++i) {
        g.AddEdge(i, i + 1, 100.0, i + 1, 0, 0, 0, false, {});
        g.AddEdge(i + 1, i, 100.0, i + 1, 0, 0, 0, false, {});
    }
    return g;
}

// ============================================================================
// 1. INPUT VALIDATION TESTS
// ============================================================================

bool Test1_InvalidIncidentId() {
    std::cout << "Running Test1_InvalidIncidentId..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    AllocationRequest req;
    req.incident_id = 0; // Invalid
    req.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;

    std::vector<ResourceRecord> resources = {
        {1, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0}
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.status == AllocationStatus::INVALID_REQUEST, "Zero incident ID must be rejected");
    TEST_ASSERT(res.selected_resources.empty(), "No resources selected");

    std::cout << "Test1_InvalidIncidentId: PASSED\n" << std::endl;
    return true;
}

bool Test2_InvalidCategoryEnum() {
    std::cout << "Running Test2_InvalidCategoryEnum..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    AllocationRequest req;
    req.incident_id = 101;
    req.category = static_cast<Priority::EmergencyCategory>(99); // Invalid
    req.incident_node_osm_id = 10;

    std::vector<ResourceRecord> resources = {
        {1, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0}
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.status == AllocationStatus::INVALID_REQUEST, "Invalid category enum must be rejected");

    std::cout << "Test2_InvalidCategoryEnum: PASSED\n" << std::endl;
    return true;
}

bool Test3_EmptyResourcePool() {
    std::cout << "Running Test3_EmptyResourcePool..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    AllocationRequest req;
    req.incident_id = 103;
    req.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;

    AllocationResult res = engine.AllocateResources(req, {});
    TEST_ASSERT(res.status == AllocationStatus::NO_RESOURCES_AVAILABLE, "Empty pool yields NO_RESOURCES_AVAILABLE");
    TEST_ASSERT(res.selected_resources.empty(), "Zero resources allocated");

    std::cout << "Test3_EmptyResourcePool: PASSED\n" << std::endl;
    return true;
}

bool Test4_InvalidResourceRecords() {
    std::cout << "Running Test4_InvalidResourceRecords..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    AllocationRequest req;
    req.incident_id = 104;
    req.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;
    req.requirements = {{ResourceType::ALS_AMBULANCE, 1}};

    // Pool contains:
    // r1: invalid ID 0
    // r2: capacity 0
    // r3: duplicate ID 2
    // r4: duplicate ID 2
    std::vector<ResourceRecord> resources = {
        {0, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0},
        {1, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 0, 0},
        {2, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0},
        {2, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.26, 73.01, 20, 1, 0}
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.candidate_evaluations.size() == 4, "All 4 evaluated");
    TEST_ASSERT(res.candidate_evaluations[0].eligibility == CandidateEligibility::REJECTED_INVALID_RECORD, "ID 0 rejected");
    TEST_ASSERT(res.candidate_evaluations[1].eligibility == CandidateEligibility::REJECTED_INVALID_RECORD, "Cap 0 rejected");
    TEST_ASSERT(res.candidate_evaluations[2].is_selected, "First occurrence of ID 2 selected");
    TEST_ASSERT(res.candidate_evaluations[3].eligibility == CandidateEligibility::REJECTED_DUPLICATE_ID, "Duplicate ID 2 rejected");

    std::cout << "Test4_InvalidResourceRecords: PASSED\n" << std::endl;
    return true;
}

bool Test5_ZeroRequestedQuantityRejection() {
    std::cout << "Running Test5_ZeroRequestedQuantityRejection..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    AllocationRequest req;
    req.incident_id = 105;
    req.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;
    req.requirements = {{ResourceType::ALS_AMBULANCE, 0}}; // Quantity 0 invalid

    std::vector<ResourceRecord> resources = {
        {1, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0}
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.status == AllocationStatus::INVALID_REQUEST, "Zero requested quantity must be rejected");

    std::cout << "Test5_ZeroRequestedQuantityRejection: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 2. AVAILABILITY & EXISTING ASSIGNMENTS TESTS
// ============================================================================

bool Test6_AvailabilityFiltering() {
    std::cout << "Running Test6_AvailabilityFiltering..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    AllocationRequest req;
    req.incident_id = 106;
    req.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;
    req.requirements = {{ResourceType::ALS_AMBULANCE, 2}};

    std::vector<ResourceRecord> resources = {
        {1, ResourceType::ALS_AMBULANCE, AvailabilityStatus::RESERVED, 26.25, 73.00, 10, 1, 0},
        {2, ResourceType::ALS_AMBULANCE, AvailabilityStatus::DISPATCHED, 26.26, 73.01, 20, 1, 0},
        {3, ResourceType::ALS_AMBULANCE, AvailabilityStatus::OUT_OF_SERVICE, 26.27, 73.02, 30, 1, 0},
        {4, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.28, 73.03, 40, 1, 999}, // already assigned
        {5, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.29, 73.04, 50, 1, 0}     // ONLY THIS IS ELIGIBLE
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.status == AllocationStatus::PARTIALLY_ALLOCATED, "Only 1 available of 2 requested");
    TEST_ASSERT(res.selected_resources.size() == 1, "Only 1 selected");
    TEST_ASSERT(res.selected_resources[0].resource_id == 5, "Resource 5 selected");
    TEST_ASSERT(res.requirements_summary[0].allocated_quantity == 1, "Allocated 1");
    TEST_ASSERT(res.requirements_summary[0].shortage_quantity == 1, "Shortage 1");

    std::cout << "Test6_AvailabilityFiltering: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 3. COMPATIBILITY POLICY TESTS
// ============================================================================

bool Test7_CompatibilityRules() {
    std::cout << "Running Test7_CompatibilityRules..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    // Request MEDICAL incident
    AllocationRequest req_med;
    req_med.incident_id = 107;
    req_med.category = Priority::EmergencyCategory::MEDICAL;
    req_med.incident_node_osm_id = 10;
    req_med.requirements = {{ResourceType::ALS_AMBULANCE, 1}};

    // Pool contains Fire Engine only (incompatible with MEDICAL)
    std::vector<ResourceRecord> fire_only = {
        {1, ResourceType::FIRE_ENGINE, AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0}
    };

    AllocationResult res_med = engine.AllocateResources(req_med, fire_only);
    TEST_ASSERT(res_med.status == AllocationStatus::NO_COMPATIBLE_RESOURCES, "Fire Engine incompatible with Medical");

    // Request FIRE incident with Fire Engine
    AllocationRequest req_fire;
    req_fire.incident_id = 108;
    req_fire.category = Priority::EmergencyCategory::FIRE;
    req_fire.incident_node_osm_id = 10;
    req_fire.requirements = {{ResourceType::FIRE_ENGINE, 1}};

    AllocationResult res_fire = engine.AllocateResources(req_fire, fire_only);
    TEST_ASSERT(res_fire.status == AllocationStatus::FULLY_ALLOCATED, "Fire Engine compatible with Fire");
    TEST_ASSERT(res_fire.selected_resources[0].resource_id == 1, "Fire Engine selected");

    std::cout << "Test7_CompatibilityRules: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 4. ROUTING, DISTANCE & ETA TESTS
// ============================================================================

bool Test8_DirectedRoadDistanceAndEta() {
    std::cout << "Running Test8_DirectedRoadDistanceAndEta..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    // Speed config: ALS = 36 km/h (10 m/s for clean integer calculation)
    SpeedConfig speeds;
    speeds.als_ambulance_kmh = 36.0; // 36 km/h = 10 m/s
    engine.SetSpeedConfig(speeds);

    AllocationRequest req;
    req.incident_id = 109;
    req.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10; // Node 0
    req.requirements = {{ResourceType::ALS_AMBULANCE, 1}};

    // Resource at Node 3 (OSM 40) -> distance to Node 0 is 300.0m
    std::vector<ResourceRecord> resources = {
        {1, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.28, 73.03, 40, 1, 0}
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.status == AllocationStatus::FULLY_ALLOCATED, "Allocated");
    TEST_ASSERT(res.selected_resources.size() == 1, "1 selected");
    TEST_ASSERT(std::abs(res.selected_resources[0].road_distance_meters - 300.0) < 1e-6, "Distance 300m");
    // ETA = 300m / (36 km/h * 1000/3600) = 300m / 10 m/s = 30.0s
    TEST_ASSERT(std::abs(res.selected_resources[0].estimated_eta_seconds - 30.0) < 1e-6, "ETA 30.0s");

    std::cout << "Test8_DirectedRoadDistanceAndEta: PASSED\n" << std::endl;
    return true;
}

bool Test9_UnreachableResourceHandling() {
    std::cout << "Running Test9_UnreachableResourceHandling..." << std::endl;
    // Graph with disconnected components: Component 1 (0, 1), Component 2 (2, 3)
    Graph g;
    g.AddNode(10, 26.25, 73.00, false); // 0
    g.AddNode(20, 26.26, 73.01, false); // 1
    g.AddEdge(0, 1, 100.0, 1, 0, 0, 0, false, {});

    g.AddNode(30, 26.30, 73.05, false); // 2
    g.AddNode(40, 26.31, 73.06, false); // 3
    g.AddEdge(2, 3, 100.0, 2, 0, 0, 0, false, {});

    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    // Incident at Node 0 (Comp 1)
    AllocationRequest req;
    req.incident_id = 110;
    req.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;
    req.requirements = {{ResourceType::ALS_AMBULANCE, 1}};

    // Resource at Node 3 (Comp 2 - Disconnected!)
    std::vector<ResourceRecord> resources = {
        {1, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.31, 73.06, 40, 1, 0}
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.status == AllocationStatus::NO_RESOURCES_AVAILABLE, "Unreachable resource cannot be allocated");
    TEST_ASSERT(res.selected_resources.empty(), "Zero selected");
    TEST_ASSERT(res.candidate_evaluations[0].eligibility == CandidateEligibility::REJECTED_UNREACHABLE,
                "Candidate marked REJECTED_UNREACHABLE");

    std::cout << "Test9_UnreachableResourceHandling: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 5. QUANTITY, SHORTAGE & RANKING TESTS
// ============================================================================

bool Test10_DeterministicRankingAndTieBreaking() {
    std::cout << "Running Test10_DeterministicRankingAndTieBreaking..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    // Incident at Node 0
    AllocationRequest req;
    req.incident_id = 111;
    req.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 10;
    req.requirements = {{ResourceType::ALS_AMBULANCE, 2}};

    // Candidate resources:
    // r1: Node 2 (dist 200m), ID 30
    // r2: Node 1 (dist 100m), ID 20  <-- Closest
    // r3: Node 1 (dist 100m), ID 10  <-- Closest and smaller ID (Wins tie-break over r2)
    // r4: Node 3 (dist 300m), ID 5
    std::vector<ResourceRecord> resources = {
        {30, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.27, 73.02, 30, 1, 0},
        {20, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.26, 73.01, 20, 1, 0},
        {10, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.26, 73.01, 20, 1, 0},
        {5,  ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.28, 73.03, 40, 1, 0}
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.status == AllocationStatus::FULLY_ALLOCATED, "Fully allocated");
    TEST_ASSERT(res.selected_resources.size() == 2, "2 allocated");

    // First selected must be ID 10 (100m, smaller ID than 20)
    TEST_ASSERT(res.selected_resources[0].resource_id == 10, "Rank 1: ID 10");
    // Second selected must be ID 20 (100m, larger ID than 10 but closer than 30)
    TEST_ASSERT(res.selected_resources[1].resource_id == 20, "Rank 2: ID 20");

    std::cout << "Test10_DeterministicRankingAndTieBreaking: PASSED\n" << std::endl;
    return true;
}

bool Test11_MultiTypeRequirementFulfillment() {
    std::cout << "Running Test11_MultiTypeRequirementFulfillment..." << std::endl;
    Graph g = BuildSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 250.0);
    ResourceAllocationEngine engine(g, grid);

    // ROAD_ACCIDENT incident requiring 1 ALS Ambulance and 1 Rescue Vehicle
    AllocationRequest req;
    req.incident_id = 112;
    req.category = Priority::EmergencyCategory::ROAD_ACCIDENT;
    req.incident_node_osm_id = 10;
    req.requirements = {
        {ResourceType::ALS_AMBULANCE, 1},
        {ResourceType::RESCUE_VEHICLE, 1}
    };

    std::vector<ResourceRecord> resources = {
        {1, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 26.26, 73.01, 20, 1, 0},
        {2, ResourceType::RESCUE_VEHICLE, AvailabilityStatus::AVAILABLE, 26.27, 73.02, 30, 1, 0},
        {3, ResourceType::FIRE_ENGINE, AvailabilityStatus::AVAILABLE, 26.25, 73.00, 10, 1, 0} // Incompatible
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.status == AllocationStatus::FULLY_ALLOCATED, "Both types allocated");
    TEST_ASSERT(res.selected_resources.size() == 2, "2 selected");
    TEST_ASSERT(res.total_allocated_resources == 2, "Total allocated 2");
    TEST_ASSERT(res.requirements_summary.size() == 2, "2 requirements tracked");

    std::cout << "Test11_MultiTypeRequirementFulfillment: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 6. CANONICAL JODHPUR ROAD GRAPH INTEGRATION TESTS
// ============================================================================

bool Test12_CanonicalJodhpurFacilityAllocation() {
    std::cout << "Running Test12_CanonicalJodhpurFacilityAllocation..." << std::endl;

    Graph graph;
    std::cout << "  Loading canonical graph..." << std::endl;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    SpatialGrid grid;
    std::cout << "  Building SpatialGrid..." << std::endl;
    grid.Build(graph, 250.0);

    BoundaryValidator boundary;
    boundary.LoadFromFile("data/jodhpur_boundary.geojson");

    ResourceAllocationEngine engine(graph, grid, &boundary);

    // Emergency Incident at Sojati Gate (OSM 2688566058)
    AllocationRequest req;
    req.incident_id = 999;
    req.category = Priority::EmergencyCategory::MEDICAL;
    req.incident_node_osm_id = 2688566058; // Sojati Gate
    req.requirements = {
        {ResourceType::ALS_AMBULANCE, 1},
        {ResourceType::BLS_AMBULANCE, 1}
    };

    // Candidate ambulances stationed at major canonical hospitals:
    // 1. Mathura Das Mathur Hospital (OSM 8499684813) - ALS 1 (Very close: ~1.5 km)
    // 2. MDM Hospital (OSM 5321319416) - BLS 1 (~3.4 km)
    // 3. AIIMS Jodhpur (OSM 8520698362) - ALS 2 (~7.0 km)
    // 4. Paota Circle (OSM 3773158752) - BLS 2 (~3.1 km)
    std::vector<ResourceRecord> resources = {
        {101, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 0, 0, 8499684813, 1, 0},
        {102, ResourceType::BLS_AMBULANCE, AvailabilityStatus::AVAILABLE, 0, 0, 5321319416, 1, 0},
        {103, ResourceType::ALS_AMBULANCE, AvailabilityStatus::AVAILABLE, 0, 0, 8520698362, 1, 0},
        {104, ResourceType::BLS_AMBULANCE, AvailabilityStatus::AVAILABLE, 0, 0, 3773158752, 1, 0}
    };

    AllocationResult res = engine.AllocateResources(req, resources);
    TEST_ASSERT(res.status == AllocationStatus::FULLY_ALLOCATED, "Both ambulances allocated");
    TEST_ASSERT(res.selected_resources.size() == 2, "2 selected");

    // Verify selected ALS is #101 (from Mathura Das Mathur Hospital, which is closest to Sojati Gate)
    TEST_ASSERT(res.selected_resources[0].resource_type == ResourceType::ALS_AMBULANCE ||
                res.selected_resources[1].resource_type == ResourceType::ALS_AMBULANCE, "ALS selected");

    // Locate selected ALS and BLS
    uint64_t selected_als_id = 0;
    uint64_t selected_bls_id = 0;
    for (const auto& s : res.selected_resources) {
        if (s.resource_type == ResourceType::ALS_AMBULANCE) selected_als_id = s.resource_id;
        if (s.resource_type == ResourceType::BLS_AMBULANCE) selected_bls_id = s.resource_id;
    }

    TEST_ASSERT(selected_als_id == 101, "Closest ALS (Mathura Das Mathur Hosp) must be selected");
    TEST_ASSERT(selected_bls_id == 104, "Closest BLS (Paota Circle) must be selected");

    // Cross-check road distances with DijkstraRouter directly:
    DijkstraRouter router(graph);
    RouteResult d_als = router.ShortestPathOsm(8499684813, 2688566058);
    RouteResult d_bls = router.ShortestPathOsm(3773158752, 2688566058);

    double als_reported_dist = 0.0;
    double bls_reported_dist = 0.0;
    for (const auto& s : res.selected_resources) {
        if (s.resource_id == 101) als_reported_dist = s.road_distance_meters;
        if (s.resource_id == 104) bls_reported_dist = s.road_distance_meters;
    }

    TEST_ASSERT(std::abs(als_reported_dist - d_als.total_distance_meters) < 1e-4,
                "Reported ALS distance matches Dijkstra shortest path");
    TEST_ASSERT(std::abs(bls_reported_dist - d_bls.total_distance_meters) < 1e-4,
                "Reported BLS distance matches Dijkstra shortest path");

    std::cout << "  Selected ALS #101 distance: " << als_reported_dist << " m (ETA: "
              << res.selected_resources[0].estimated_eta_seconds << " s)\n";
    std::cout << "  Selected BLS #104 distance: " << bls_reported_dist << " m (ETA: "
              << res.selected_resources[1].estimated_eta_seconds << " s)\n";

    std::cout << "Test12_CanonicalJodhpurFacilityAllocation: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// 7. PERFORMANCE BENCHMARKING SUITE
// ============================================================================

bool RunAllocationBenchmarks() {
    std::cout << "\n====================================================================\n"
              << "  PHASE 3.9 RESOURCE ALLOCATION BENCHMARK SUITE (50 ITERATIONS)\n"
              << "====================================================================\n" << std::endl;

    Graph graph;
    std::cout << "Loading canonical graph dataset for benchmarking..." << std::endl;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    SpatialGrid grid;
    std::cout << "Building SpatialGrid..." << std::endl;
    grid.Build(graph, 250.0);

    BoundaryValidator boundary;
    boundary.LoadFromFile("data/jodhpur_boundary.geojson");

    ResourceAllocationEngine engine(graph, grid, &boundary);

    // Fixed incident at Sojati Gate (OSM 2688566058)
    AllocationRequest req;
    req.incident_id = 12345;
    req.category = Priority::EmergencyCategory::ROAD_ACCIDENT;
    req.incident_node_osm_id = 2688566058;
    req.requirements = {
        {ResourceType::ALS_AMBULANCE, 2},
        {ResourceType::RESCUE_VEHICLE, 1}
    };

    // Major candidate facility nodes for realistic vehicle base stations
    static const std::vector<int64_t> facility_nodes = {
        8520698362, // AIIMS Jodhpur
        5321319416, // MDM Hospital
        8499684813, // Mathura Das Mathur Hospital
        2694302020, // Basni Fire Station
        3773158752  // Paota Circle
    };

    std::vector<size_t> pool_sizes = {10, 50, 100, 500, 1000};
    const int WARMUP_ROUNDS = 5;
    const int MEASURE_ROUNDS = 50;

    std::cout << std::fixed << std::setprecision(4);
    std::cout << "| Pool Size (M) | Min Latency (ms) | Avg Latency (ms) | Median (ms) | p95 (ms) | Max Latency (ms) | Throughput (req/s) | Memory RSS (MB) |\n";
    std::cout << "|---|---|---|---|---|---|---|---|\n";

    for (size_t M : pool_sizes) {
        // Generate M candidate resources distributed across facility nodes
        std::vector<ResourceRecord> resources;
        resources.reserve(M);
        for (size_t i = 1; i <= M; ++i) {
            ResourceRecord r;
            r.resource_id = static_cast<uint64_t>(i);
            r.resource_type = static_cast<ResourceType>(i % 5);
            r.availability_status = (i % 13 == 0) ? AvailabilityStatus::DISPATCHED : AvailabilityStatus::AVAILABLE;
            r.capacity = 1;
            r.assigned_incident_id = (i % 13 == 0) ? 999 : 0;
            r.current_node_osm_id = facility_nodes[i % facility_nodes.size()];
            resources.push_back(r);
        }

        // Warm-up
        for (int w = 0; w < WARMUP_ROUNDS; ++w) {
            volatile auto r = engine.AllocateResources(req, resources);
            (void)r;
        }

        // Timed measurement
        std::vector<double> latencies;
        latencies.reserve(MEASURE_ROUNDS);

        for (int m = 0; m < MEASURE_ROUNDS; ++m) {
            auto t1 = std::chrono::high_resolution_clock::now();
            AllocationResult res = engine.AllocateResources(req, resources);
            auto t2 = std::chrono::high_resolution_clock::now();
            latencies.push_back(std::chrono::duration<double, std::milli>(t2 - t1).count());
            assert(res.status == AllocationStatus::FULLY_ALLOCATED);
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
              << "  PHASE 3.9 RESOURCE ALLOCATION ENGINE TEST SUITE\n"
              << "====================================================\n" << std::endl;

    int passed = 0;
    int failed = 0;

    auto run_test = [&](bool (*test_fn)(), const char* name) {
        if (test_fn()) {
            ++passed;
        } else {
            ++failed;
            std::cerr << "FAILED: " << name << std::endl;
        }
    };

    // 1. Input Validation Tests
    run_test(Test1_InvalidIncidentId, "Test1_InvalidIncidentId");
    run_test(Test2_InvalidCategoryEnum, "Test2_InvalidCategoryEnum");
    run_test(Test3_EmptyResourcePool, "Test3_EmptyResourcePool");
    run_test(Test4_InvalidResourceRecords, "Test4_InvalidResourceRecords");
    run_test(Test5_ZeroRequestedQuantityRejection, "Test5_ZeroRequestedQuantityRejection");

    // 2. Availability & Existing Assignments Tests
    run_test(Test6_AvailabilityFiltering, "Test6_AvailabilityFiltering");

    // 3. Compatibility Policy Tests
    run_test(Test7_CompatibilityRules, "Test7_CompatibilityRules");

    // 4. Routing, Distance & ETA Tests
    run_test(Test8_DirectedRoadDistanceAndEta, "Test8_DirectedRoadDistanceAndEta");
    run_test(Test9_UnreachableResourceHandling, "Test9_UnreachableResourceHandling");

    // 5. Quantity, Shortage & Ranking Tests
    run_test(Test10_DeterministicRankingAndTieBreaking, "Test10_DeterministicRankingAndTieBreaking");
    run_test(Test11_MultiTypeRequirementFulfillment, "Test11_MultiTypeRequirementFulfillment");

    // 6. Canonical Jodhpur Graph Integration Tests
    run_test(Test12_CanonicalJodhpurFacilityAllocation, "Test12_CanonicalJodhpurFacilityAllocation");

    // 7. Benchmarks
    run_test(RunAllocationBenchmarks, "RunAllocationBenchmarks");

    std::cout << "====================================================\n"
              << "  TEST RESULTS SUMMARY\n"
              << "  Passed: " << passed << " / " << (passed + failed) << "\n"
              << "  Failed: " << failed << "\n"
              << "====================================================" << std::endl;

    return (failed == 0) ? 0 : 1;
}
