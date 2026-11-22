#include "SpatialGrid.hpp"
#include "BoundaryValidator.hpp"
#include "DataLoader.hpp"
#include "Graph.hpp"
#include "RouteGeometry.hpp"
#include <iostream>
#include <vector>
#include <cmath>
#include <cassert>
#include <string>
#include <chrono>
#include <iomanip>
#include <numeric>
#include <algorithm>

using namespace EmergencyRouting;

#define ASSERT_TRUE(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "[FAIL] Line " << __LINE__ << ": " << msg << std::endl; \
            return false; \
        } \
    } while (0)

// Helper to construct a synthetic 5-node graph for targeted tests
Graph CreateSyntheticGraph() {
    Graph g;
    // Node 0: Center (26.290, 73.010), OSM ID: 1000
    g.AddNode(1000, 26.290, 73.010);
    // Node 1: North (26.295, 73.010), OSM ID: 1001 (~554m)
    g.AddNode(1001, 26.295, 73.010);
    // Node 2: East (26.290, 73.015), OSM ID: 1002 (~499m)
    g.AddNode(1002, 26.290, 73.015);
    // Node 3: South (26.285, 73.010), OSM ID: 1003 (~554m)
    g.AddNode(1003, 26.285, 73.010);
    // Node 4: West (26.290, 73.005), OSM ID: 1004 (~499m)
    g.AddNode(1004, 26.290, 73.005);
    return g;
}

// Test 1: Basic nearest-node search
bool Test1_BasicNearestNodeSearch() {
    Graph g = CreateSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Query close to Node 2 (East)
    SnapResult res = grid.FindNearestNode(26.2901, 73.0149, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(res.found, "Snap should succeed");
    ASSERT_TRUE(res.status == SnapStatus::SUCCESS, "Status should be SUCCESS");
    ASSERT_TRUE(res.snapped_osm_id == 1002, "Should snap to Node 2 (OSM 1002)");
    ASSERT_TRUE(res.snapped_internal_index == 2, "Internal index should be 2");
    ASSERT_TRUE(res.snap_distance_meters < 20.0, "Snap distance should be < 20m");
    return true;
}

// Test 2: Query at an exact graph node coordinate
bool Test2_QueryAtExactNode() {
    Graph g = CreateSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Exact coordinate of Node 0
    SnapResult res = grid.FindNearestNode(26.290, 73.010, SnapPolicy::ALLOW_ALL_NODES, 100.0);
    ASSERT_TRUE(res.found, "Snap should succeed");
    ASSERT_TRUE(res.snapped_osm_id == 1000, "Should snap to Node 0");
    ASSERT_TRUE(res.snap_distance_meters < 1e-4, "Distance at exact node should be ~0.0");
    return true;
}

// Test 3: Exactly equal computed distances with deterministic OSM ID tie-breaking
bool Test3_DeterministicOSMTieBreakingOnExactEquality() {
    Graph g;
    // Two nodes at exactly symmetric positions on meridian:
    // Node A: (26.001, 73.0), OSM ID: 2000
    // Node B: (25.999, 73.0), OSM ID: 1000 (smaller OSM ID)
    g.AddNode(2000, 26.001, 73.0);
    g.AddNode(1000, 25.999, 73.0);

    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Query is at exact midpoint: lat=26.0, lon=73.0
    // Note: Equality is based on computed double-precision IEEE 754 distances,
    // where HaversineDistanceMeters returns identical double values.
    SnapResult res = grid.FindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(res.found, "Snap should succeed");
    ASSERT_TRUE(res.snapped_osm_id == 1000, "Exact tie-break must select smaller OSM ID (1000)");

    // Independent Brute Force must make the exact same choice
    SnapResult bf_res = grid.BruteForceFindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(bf_res.snapped_osm_id == 1000, "Brute force must also choose 1000 on exact equality");
    ASSERT_TRUE(res.snapped_osm_id == bf_res.snapped_osm_id, "Grid and Brute Force must agree exactly");
    return true;
}

// Test 4A: Slightly closer candidate with a larger OSM ID must strictly win
bool Test4A_StrictCloserCandidateWithLargerOSMID() {
    Graph g;
    constexpr double PI = 3.14159265358979323846;
    constexpr double m_per_deg_lat = 6371008.8 * (PI / 180.0);

    // Node A: Distance ~100.0000000005 meters, OSM ID: 100 (smaller OSM ID, farther)
    const double dlat_A = 100.0000000005 / m_per_deg_lat;
    // Node B: Distance ~100.0000000000 meters, OSM ID: 200 (larger OSM ID, strictly closer)
    const double dlat_B = 100.0 / m_per_deg_lat;

    g.AddNode(100, 26.0 + dlat_A, 73.0);
    g.AddNode(200, 26.0 + dlat_B, 73.0);

    SpatialGrid grid;
    grid.Build(g, 100.0);

    const double dA = RouteGeometry::HaversineDistanceMeters(26.0, 73.0, 26.0 + dlat_A, 73.0);
    const double dB = RouteGeometry::HaversineDistanceMeters(26.0, 73.0, 26.0 + dlat_B, 73.0);
    ASSERT_TRUE(dB < dA, "Node B must be strictly closer in double precision");

    // Under strict nearest-node ordering, Node B (OSM 200) MUST win despite having a larger OSM ID
    SnapResult res = grid.FindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(res.found, "Snap should succeed");
    ASSERT_TRUE(res.snapped_osm_id == 200, "Strictly closer Node B (OSM 200) must win over farther Node A (OSM 100)");

    SnapResult bf_res = grid.BruteForceFindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(bf_res.snapped_osm_id == 200, "Brute force must also choose Node B (OSM 200)");
    ASSERT_TRUE(res.snapped_osm_id == bf_res.snapped_osm_id, "Grid and Brute Force must agree");
    return true;
}

// Test 4B: Two candidates whose distances differ by less than 1e-9 meters
bool Test4B_SubNanometerDifferenceStrictOrdering() {
    Graph g;
    constexpr double PI = 3.14159265358979323846;
    constexpr double m_per_deg_lat = 6371008.8 * (PI / 180.0);

    // Difference of 2e-10 meters (0.2 nm)
    const double dlat_closer = 50.0 / m_per_deg_lat;
    const double dlat_farther = (50.0 + 2e-10) / m_per_deg_lat;

    // Node Closer has OSM ID 5000 (larger)
    g.AddNode(5000, 26.0 + dlat_closer, 73.0);
    // Node Farther has OSM ID 10 (smaller)
    g.AddNode(10, 26.0 + dlat_farther, 73.0);

    SpatialGrid grid;
    grid.Build(g, 100.0);

    SnapResult res = grid.FindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 200.0);
    ASSERT_TRUE(res.found, "Snap should succeed");
    ASSERT_TRUE(res.snapped_osm_id == 5000, "Sub-nanometer closer candidate must win regardless of OSM ID");

    SnapResult bf_res = grid.BruteForceFindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 200.0);
    ASSERT_TRUE(bf_res.snapped_osm_id == 5000, "Brute force must also select the sub-nanometer closer candidate");
    ASSERT_TRUE(res.snapped_osm_id == bf_res.snapped_osm_id, "Grid and Brute Force must agree exactly");
    return true;
}

// Test 4C: Potentially winning candidate in an unvisited cell and pruning consistency
bool Test4C_UnvisitedCellCandidateConsistency() {
    Graph g;
    // Incumbent Node 1 in Cell 0: (26.0005, 73.0), OSM ID: 200 (~55.5m away)
    g.AddNode(200, 26.0005, 73.0);
    // Node 2 in an adjacent cell: (26.0015, 73.0015), OSM ID: 100 (farther, ~226m away, but lower OSM ID)
    g.AddNode(100, 26.0015, 73.0015);
    // Node 3 in another cell: (26.0002, 73.0002), OSM ID: 300 (closest, ~31m away)
    g.AddNode(300, 26.0002, 73.0002);

    SpatialGrid grid;
    grid.Build(g, 50.0); // 50m cells forces them into distinct cells

    SnapResult res = grid.FindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(res.found, "Snap should succeed");
    ASSERT_TRUE(res.snapped_osm_id == 300, "Node 3 (OSM 300) is globally closest and must be found");

    SnapResult bf_res = grid.BruteForceFindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(bf_res.snapped_osm_id == 300, "Brute force must also find Node 3");
    ASSERT_TRUE(res.snapped_osm_id == bf_res.snapped_osm_id, "Grid and Brute Force must agree");
    return true;
}

// Test 5: Nearest node in an adjacent cell
bool Test5_NearestInAdjacentCell() {
    Graph g = CreateSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Query slightly outside Node 0's cell towards Node 1 (North)
    SnapResult res = grid.FindNearestNode(26.293, 73.010, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(res.found, "Snap should succeed");
    // At lat=26.293, distance to Node 1 (26.295) is ~222m, to Node 0 (26.290) is ~332m
    ASSERT_TRUE(res.snapped_osm_id == 1001, "Should snap to Node 1 in adjacent cell");
    return true;
}

// Test 6: Nearest node several cells away across empty cells
bool Test6_NearestSeveralCellsAway() {
    Graph g;
    // Node at (26.0, 73.0)
    g.AddNode(500, 26.0, 73.0);
    // Node at (26.01, 73.01) -> ~1.5 km away
    g.AddNode(501, 26.01, 73.01);

    SpatialGrid grid;
    // With 100m cell size, ~1.5 km spans ~15 cells of empty space
    grid.Build(g, 100.0);

    // Query in the middle of empty space (26.002, 73.002)
    SnapResult res = grid.FindNearestNode(26.002, 73.002, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(res.found, "Snap should succeed across empty cells");
    ASSERT_TRUE(res.snapped_osm_id == 500, "Should find closest node across multiple empty cells");
    return true;
}

// Test 7: Nearest node across a cell boundary
bool Test7_NearestAcrossCellBoundary() {
    Graph g;
    // Two nodes right near a boundary line
    g.AddNode(601, 26.0009, 73.0);
    g.AddNode(602, 26.0011, 73.0);

    SpatialGrid grid;
    grid.Build(g, 100.0);

    SnapResult res = grid.FindNearestNode(26.00105, 73.0, SnapPolicy::ALLOW_ALL_NODES, 200.0);
    ASSERT_TRUE(res.found, "Snap should succeed");
    ASSERT_TRUE(res.snapped_osm_id == 602, "Should snap to 602 across boundary");
    return true;
}

// Test 8: Empty grid handling
bool Test8_EmptyGrid() {
    Graph empty_g;
    SpatialGrid grid;
    grid.Build(empty_g, 100.0);

    SnapResult res = grid.FindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(!res.found, "Empty grid should return found = false");
    ASSERT_TRUE(res.status == SnapStatus::NO_NODES_AVAILABLE, "Status should be NO_NODES_AVAILABLE");
    return true;
}

// Test 9: Single-node grid
bool Test9_SingleNodeGrid() {
    Graph g;
    g.AddNode(42, 26.290, 73.010);
    SpatialGrid grid;
    grid.Build(g, 100.0);

    SnapResult res = grid.FindNearestNode(26.292, 73.012, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(res.found, "Single node should be found");
    ASSERT_TRUE(res.snapped_osm_id == 42, "Snapped OSM ID should be 42");
    return true;
}

// Test 10 & 11: Invalid coordinate ranges
bool Test10_11_InvalidCoordinates() {
    Graph g = CreateSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 100.0);

    SnapResult r1 = grid.FindNearestNode(95.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(!r1.found && r1.status == SnapStatus::INVALID_COORDINATES, "Lat > 90 rejected");

    SnapResult r2 = grid.FindNearestNode(-95.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(!r2.found && r2.status == SnapStatus::INVALID_COORDINATES, "Lat < -90 rejected");

    SnapResult r3 = grid.FindNearestNode(26.0, 185.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(!r3.found && r3.status == SnapStatus::INVALID_COORDINATES, "Lon > 180 rejected");

    SnapResult r4 = grid.FindNearestNode(26.0, -185.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(!r4.found && r4.status == SnapStatus::INVALID_COORDINATES, "Lon < -180 rejected");
    return true;
}

// Test 12 & 13: NaN and Infinity handling
bool Test12_13_NanAndInfinity() {
    Graph g = CreateSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 100.0);

    SnapResult r1 = grid.FindNearestNode(std::numeric_limits<double>::quiet_NaN(), 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(!r1.found && r1.status == SnapStatus::INVALID_COORDINATES, "NaN lat rejected");

    SnapResult r2 = grid.FindNearestNode(26.0, std::numeric_limits<double>::infinity(), SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(!r2.found && r2.status == SnapStatus::INVALID_COORDINATES, "Inf lon rejected");
    return true;
}

// Test 14 & 15: Maximum snap distance enforcement
bool Test14_15_MaxSnapDistanceEnforcement() {
    Graph g;
    g.AddNode(700, 26.0, 73.0);
    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Query 500 meters away (approx 0.0045 deg lat)
    const double qlat = 26.0045;
    const double qlon = 73.0;

    // Test with max_dist = 200m -> Should FAIL with SNAP_DISTANCE_EXCEEDED
    SnapResult r1 = grid.FindNearestNode(qlat, qlon, SnapPolicy::ALLOW_ALL_NODES, 200.0);
    ASSERT_TRUE(!r1.found, "500m distance exceeds 200m limit");
    ASSERT_TRUE(r1.status == SnapStatus::SNAP_DISTANCE_EXCEEDED, "Status must be SNAP_DISTANCE_EXCEEDED");

    // Test with max_dist = 1000m -> Should SUCCEED
    SnapResult r2 = grid.FindNearestNode(qlat, qlon, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(r2.found, "500m distance is within 1000m limit");
    ASSERT_TRUE(r2.status == SnapStatus::SUCCESS, "Status must be SUCCESS");
    ASSERT_TRUE(r2.snapped_osm_id == 700, "Must snap to Node 700");
    return true;
}

// Test 16: Multi-stage SnapCoordinate with BoundaryValidator
bool Test16_SnapWithBoundaryValidation() {
    Graph g;
    // Node inside Jodhpur: near AIIMS (26.257, 73.007)
    g.AddNode(800, 26.257643, 73.007812);
    SpatialGrid grid;
    grid.Build(g, 250.0);

    BoundaryValidator val;
    val.LoadFromFile("data/jodhpur_boundary.geojson");

    // Query inside Jodhpur service area
    SnapResult r_in = grid.SnapCoordinate(26.258, 73.008, SnapPolicy::ALLOW_ALL_NODES, &val, 500.0);
    ASSERT_TRUE(r_in.found, "In-boundary point should succeed");
    ASSERT_TRUE(r_in.status == SnapStatus::SUCCESS, "Status should be SUCCESS");
    ASSERT_TRUE(r_in.snapped_osm_id == 800, "Snapped to Node 800");

    // Query outside Jodhpur service area (Far South: 26.15, 73.00)
    SnapResult r_out = grid.SnapCoordinate(26.15, 73.00, SnapPolicy::ALLOW_ALL_NODES, &val, 500.0);
    ASSERT_TRUE(!r_out.found, "Out-of-boundary point must fail");
    ASSERT_TRUE(r_out.status == SnapStatus::OUTSIDE_SERVICE_AREA, "Status must be OUTSIDE_SERVICE_AREA");
    return true;
}

// Test 17: Query near and outside grid bounding limits
bool Test17_QueryNearGridLimits() {
    Graph g = CreateSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Query 200m north of the entire graph bounding box
    SnapResult res = grid.FindNearestNode(26.297, 73.010, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(res.found, "Query outside grid boundary should find closest border node");
    ASSERT_TRUE(res.snapped_osm_id == 1001, "Closest border node is Node 1 (North)");
    return true;
}

// Test 18: Canonical Jodhpur 59,334-node Verification and Performance Benchmarking
bool Test18_CanonicalJodhpurVerificationAndBenchmarks() {
    std::cout << "\n========================================================\n"
              << "TEST 18: CANONICAL JODHPUR (59,334 NODES) AUDIT & BENCHMARKS\n"
              << "========================================================\n";

    Graph graph;
    std::cout << "[STAGE 1] Loading canonical graph dataset...\n";
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    BoundaryValidator validator;
    std::cout << "[STAGE 2] Loading canonical boundary GeoJSON...\n";
    validator.LoadFromFile("data/jodhpur_boundary.geojson");

    // 1. Benchmark SpatialGrid Construction across cell sizes (100m, 250m, 500m)
    std::cout << "\n[STAGE 3] Benchmarking Grid Construction & Cell Dimensions:\n";
    std::cout << std::string(80, '-') << "\n";
    std::cout << std::left
              << std::setw(12) << "Cell Size"
              << std::setw(12) << "Grid Dim"
              << std::setw(14) << "Total Cells"
              << std::setw(16) << "Non-Empty Cells"
              << std::setw(14) << "Memory (KB)"
              << std::setw(12) << "Build (ms)"
              << "\n"
              << std::string(80, '-') << "\n";

    for (double cell_size : {100.0, 250.0, 500.0}) {
        SpatialGrid test_grid;
        auto t0 = std::chrono::steady_clock::now();
        test_grid.Build(graph, cell_size);
        auto t1 = std::chrono::steady_clock::now();
        double build_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

        std::string dim = std::to_string(test_grid.RowCount()) + "x" + std::to_string(test_grid.ColCount());
        size_t mem_kb = test_grid.MemoryFootprintBytes() / 1024;

        std::cout << std::left
                  << std::setw(12) << (std::to_string(static_cast<int>(cell_size)) + "m")
                  << std::setw(12) << dim
                  << std::setw(14) << test_grid.CellCount()
                  << std::setw(16) << test_grid.NonEmptyCellCount()
                  << std::setw(14) << mem_kb
                  << std::setw(12) << std::fixed << std::setprecision(2) << build_ms
                  << "\n";
    }

    // Build production SpatialGrid with optimal 250m cell size
    SpatialGrid prod_grid;
    prod_grid.Build(graph, 250.0);

    // 2. Representative Canonical Jodhpur Queries
    struct QueryCase {
        std::string name;
        double lat;
        double lon;
        bool expected_in_boundary;
    };

    const std::vector<QueryCase> queries = {
        {"AIIMS Jodhpur Area", 26.257643, 73.007812, true},
        {"MDM Hospital Area", 26.262500, 73.008000, true},
        {"MGH Hospital Area", 26.289000, 73.021000, true},
        {"Basni Area", 26.234500, 73.011200, true},
        {"Sojati Gate Area", 26.291200, 73.023400, true},
        {"Paota Circle Area", 26.302300, 73.041200, true},
        {"Mehrangarh Fort Area", 26.297800, 73.018500, true},
        {"Jodhpur Junction Area", 26.285000, 73.017500, true},
        {"Shastri Nagar Area", 26.273000, 73.010000, true},
        {"Paota Sub-district", 26.305000, 73.045000, true},
        {"Near South Boundary", 26.210000, 73.015000, true},
        {"Outside Far South", 26.150000, 73.000000, false},
        {"Outside Far East", 26.280000, 73.250000, false}
    };

    std::cout << "\n[STAGE 4] Executing Canonical Queries against Independent Brute Force:\n";
    std::cout << std::string(110, '-') << "\n";
    std::cout << std::left
              << std::setw(24) << "Query Location"
              << std::setw(12) << "Status"
              << std::setw(14) << "Snapped OSM"
              << std::setw(12) << "Distance(m)"
              << std::setw(10) << "Cells"
              << std::setw(10) << "Nodes"
              << std::setw(12) << "Grid(ms)"
              << std::setw(12) << "BF(ms)"
              << std::setw(10) << "Speedup"
              << "\n"
              << std::string(110, '-') << "\n";

    std::vector<double> grid_times, bf_times;

    for (const auto& q : queries) {
        SnapResult res = prod_grid.SnapCoordinate(q.lat, q.lon, SnapPolicy::ALLOW_ALL_NODES, &validator, 1000.0);

        if (!q.expected_in_boundary) {
            ASSERT_TRUE(!res.found, "Outside query should return found = false");
            ASSERT_TRUE(res.status == SnapStatus::OUTSIDE_SERVICE_AREA, "Status must be OUTSIDE_SERVICE_AREA");

            std::cout << std::left
                      << std::setw(24) << q.name
                      << std::setw(12) << SnapStatusToString(res.status)
                      << std::setw(14) << "N/A"
                      << std::setw(12) << "N/A"
                      << std::setw(10) << 0
                      << std::setw(10) << 0
                      << std::setw(12) << "0.001"
                      << std::setw(12) << "N/A"
                      << std::setw(10) << "N/A"
                      << "\n";
            continue;
        }

        ASSERT_TRUE(res.found, "In-boundary query must succeed: " + q.name);
        ASSERT_TRUE(res.status == SnapStatus::SUCCESS, "Status must be SUCCESS");

        // Independent brute-force comparison
        SnapResult bf_res = prod_grid.BruteForceFindNearestNode(q.lat, q.lon, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
        ASSERT_TRUE(bf_res.found, "Brute force must also find a node");

        // EXACTNESS VERIFICATION: Exact same OSM node ID and internal index!
        ASSERT_TRUE(res.snapped_osm_id == bf_res.snapped_osm_id,
                    "OSM ID mismatch for " + q.name + " (Grid=" + std::to_string(res.snapped_osm_id) +
                    ", BF=" + std::to_string(bf_res.snapped_osm_id) + ")");
        ASSERT_TRUE(res.snapped_internal_index == bf_res.snapped_internal_index,
                    "Internal index mismatch for " + q.name);
        ASSERT_TRUE(std::abs(res.snap_distance_meters - bf_res.snap_distance_meters) < 1e-6,
                    "Distance mismatch for " + q.name);

        grid_times.push_back(res.execution_time_ms);
        bf_times.push_back(bf_res.execution_time_ms);

        double speedup = (res.execution_time_ms > 0.0) ? (bf_res.execution_time_ms / res.execution_time_ms) : 1000.0;

        std::cout << std::left
                  << std::setw(24) << q.name
                  << std::setw(12) << SnapStatusToString(res.status)
                  << std::setw(14) << res.snapped_osm_id
                  << std::setw(12) << std::fixed << std::setprecision(2) << res.snap_distance_meters
                  << std::setw(10) << res.grid_cells_examined
                  << std::setw(10) << res.candidate_nodes_examined
                  << std::setw(12) << std::fixed << std::setprecision(4) << res.execution_time_ms
                  << std::setw(12) << std::fixed << std::setprecision(4) << bf_res.execution_time_ms
                  << std::setw(10) << (std::to_string(static_cast<int>(speedup)) + "x")
                  << "\n";
    }

    std::cout << std::string(110, '-') << "\n";

    // Summary statistics
    double min_g = *std::min_element(grid_times.begin(), grid_times.end());
    double max_g = *std::max_element(grid_times.begin(), grid_times.end());
    double avg_g = std::accumulate(grid_times.begin(), grid_times.end(), 0.0) / grid_times.size();

    double avg_bf = std::accumulate(bf_times.begin(), bf_times.end(), 0.0) / bf_times.size();

    std::sort(grid_times.begin(), grid_times.end());
    double p50_g = grid_times[grid_times.size() / 2];
    double p95_g = grid_times[static_cast<size_t>(std::ceil(0.95 * grid_times.size())) - 1];

    std::cout << "\n========================================================\n"
              << "SPATIALGRID PERFORMANCE SUMMARY (59,334 GRAPH NODES)\n"
              << "========================================================\n"
              << "  Average SpatialGrid Latency: " << avg_g << " ms (" << (avg_g * 1000.0) << " microseconds)\n"
              << "  p50 SpatialGrid Latency:     " << p50_g << " ms\n"
              << "  p95 SpatialGrid Latency:     " << p95_g << " ms\n"
              << "  Min SpatialGrid Latency:     " << min_g << " ms\n"
              << "  Max SpatialGrid Latency:     " << max_g << " ms\n"
              << "  Average Brute-Force Latency: " << avg_bf << " ms\n"
              << "  Measured Average Speedup:    " << std::fixed << std::setprecision(1) << (avg_bf / avg_g) << "x faster than brute force\n"
              << "========================================================\n";

    return true;
}

// Test 19: Conservative Haversine Lower Bound — Exact Mathematical Review Counterexample
bool Test19_ConservativeLowerBound_Counterexample() {
    const double qlat = 26.25;
    const double qlon = 73.0;
    const double min_lat = 26.25;
    const double max_lat = 26.255;
    const double min_lon = 73.02;
    const double max_lon = 73.025;

    const double plat = 26.2500010;
    const double plon = 73.0200000;

    double lb = SpatialGrid::CellLowerBound(qlat, qlon, min_lat, max_lat, min_lon, max_lon);
    double d = RouteGeometry::HaversineDistanceMeters(qlat, qlon, plat, plon);

    // Guaranteed conservative lower bound: lb <= d
    ASSERT_TRUE(lb <= d, "CellLowerBound must be <= true distance to candidate P");
    // Tight bound: difference within 5 cm (0.05 meters)
    ASSERT_TRUE((d - lb) < 0.05, "CellLowerBound must be tight within 0.05 meters");

    // Single-node grid test
    Graph g;
    g.AddNode(9999, plat, plon);
    SpatialGrid grid;
    grid.Build(g, 100.0);
    SnapResult res = grid.FindNearestNode(qlat, qlon, SnapPolicy::ALLOW_ALL_NODES, 5000.0);
    ASSERT_TRUE(res.found, "Must find node in cell");
    ASSERT_TRUE(res.snapped_osm_id == 9999, "Must snap to node 9999");
    ASSERT_TRUE(std::abs(res.snap_distance_meters - d) < 1e-6, "Snap distance must match Haversine");
    return true;
}

// Test 20: Conservative Lower Bound — Cardinal Directions, Diagonals, Corners, and Edge Cases
bool Test20_ConservativeLowerBound_DirectionalAndEdgeCases() {
    const double min_lat = 26.0;
    const double max_lat = 26.1;
    const double min_lon = 73.0;
    const double max_lon = 73.1;

    struct DirectionalCase {
        std::string label;
        double qlat;
        double qlon;
    };

    const std::vector<DirectionalCase> test_cases = {
        {"North", 26.2, 73.05},
        {"South", 25.9, 73.05},
        {"East",  26.05, 73.2},
        {"West",  26.05, 72.9},
        {"North-East", 26.2, 73.2},
        {"North-West", 26.2, 72.9},
        {"South-East", 25.9, 73.2},
        {"South-West", 25.9, 72.9},
        {"Inside", 26.05, 73.05}
    };

    for (const auto& tc : test_cases) {
        double lb = SpatialGrid::CellLowerBound(tc.qlat, tc.qlon, min_lat, max_lat, min_lon, max_lon);
        if (tc.label == "Inside") {
            ASSERT_TRUE(lb == 0.0, "Lower bound for inside point must be exactly 0.0");
        } else {
            ASSERT_TRUE(lb > 0.0, "Lower bound for outside point must be > 0.0");
        }

        // Test against multiple points inside cell
        for (double plat : {min_lat, min_lat + 0.05, max_lat}) {
            for (double plon : {min_lon, min_lon + 0.05, max_lon}) {
                double d = RouteGeometry::HaversineDistanceMeters(tc.qlat, tc.qlon, plat, plon);
                ASSERT_TRUE(lb <= d, "CellLowerBound must be <= Haversine distance for " + tc.label);
            }
        }
    }

    // Corner and boundary tests
    for (double clat : {min_lat, max_lat}) {
        for (double clon : {min_lon, max_lon}) {
            double lb_corner = SpatialGrid::CellLowerBound(clat, clon, min_lat, max_lat, min_lon, max_lon);
            ASSERT_TRUE(lb_corner == 0.0, "Query on cell corner must have lower bound 0.0");
        }
    }

    // Floating-point edge cases
    double lb_nan = SpatialGrid::CellLowerBound(std::numeric_limits<double>::quiet_NaN(), 73.0, min_lat, max_lat, min_lon, max_lon);
    ASSERT_TRUE(std::isinf(lb_nan), "NaN latitude must return infinity lower bound");

    double lb_inv = SpatialGrid::CellLowerBound(26.0, 73.0, 26.1, 26.0, min_lon, max_lon);
    ASSERT_TRUE(std::isinf(lb_inv), "Inverted cell must return infinity lower bound");

    return true;
}

// Test 21: Conservative Lower Bound — Randomized Stress Test (1,000 Cells, 50,000 Points)
bool Test21_ConservativeLowerBound_RandomizedStressTest() {
    uint32_t seed = 424242;
    auto lcg_rand = [&seed]() -> double {
        seed = seed * 1664525u + 1013904223u;
        return static_cast<double>(seed) / 4294967296.0;
    };

    size_t total_checks = 0;

    for (int cell_iter = 0; cell_iter < 1000; ++cell_iter) {
        double min_lat = 26.15 + lcg_rand() * 0.20;
        double max_lat = min_lat + 0.001 + lcg_rand() * 0.01;
        double min_lon = 72.90 + lcg_rand() * 0.20;
        double max_lon = min_lon + 0.001 + lcg_rand() * 0.01;

        double qlat = 26.10 + lcg_rand() * 0.30;
        double qlon = 72.85 + lcg_rand() * 0.30;

        double lb = SpatialGrid::CellLowerBound(qlat, qlon, min_lat, max_lat, min_lon, max_lon);

        for (int pt_iter = 0; pt_iter < 50; ++pt_iter) {
            double plat = min_lat + lcg_rand() * (max_lat - min_lat);
            double plon = min_lon + lcg_rand() * (max_lon - min_lon);

            double d = RouteGeometry::HaversineDistanceMeters(qlat, qlon, plat, plon);
            ASSERT_TRUE(lb <= d, "Lower bound violation in randomized stress test");
            ++total_checks;
        }
    }

    ASSERT_TRUE(total_checks == 50000, "Must have completed 50,000 verification checks");
    return true;
}

// Test 22: Boundary-Node Snapping Policy Verification (ALLOW_ALL_NODES vs STRICT_INTERIOR_ONLY)
bool Test22_BoundaryNodeSnappingPolicies_ReproducibleCase() {
    Graph graph;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    BoundaryValidator validator;
    validator.LoadFromFile("data/jodhpur_boundary.geojson");

    SpatialGrid grid;
    grid.Build(graph, 250.0);

    // Reproducible query coordinate from technical review
    const double qlat = 26.3360636429;
    const double qlon = 73.0676052582;

    // 1. Verify query coordinate lies inside the approved service area
    ASSERT_TRUE(validator.IsInside(qlat, qlon), "Query must be strictly inside Jodhpur boundary");

    // 2. Policy: ALLOW_ALL_NODES (Unrestricted)
    // Snaps to true nearest road element: exterior boundary endpoint 8478025616 (~4.994m)
    SnapResult r_all = grid.SnapCoordinate(qlat, qlon, SnapPolicy::ALLOW_ALL_NODES, &validator, 500.0);
    ASSERT_TRUE(r_all.found, "Snap should succeed under ALLOW_ALL_NODES");
    ASSERT_TRUE(r_all.status == SnapStatus::SUCCESS, "Status should be SUCCESS");
    ASSERT_TRUE(r_all.snapped_osm_id == 8478025616, "Must snap to exterior boundary node 8478025616");
    ASSERT_TRUE(std::abs(r_all.snap_distance_meters - 4.994) < 0.05, "Snap distance should be ~4.994m");
    ASSERT_TRUE(r_all.snapped_is_boundary_node == true, "snapped_is_boundary_node must be TRUE");

    // Brute Force must yield the exact same result
    SnapResult bf_all = grid.BruteForceFindNearestNode(qlat, qlon, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(bf_all.snapped_osm_id == 8478025616, "Brute force must also select 8478025616");
    ASSERT_TRUE(bf_all.snapped_is_boundary_node == true, "Brute force snapped_is_boundary_node must be TRUE");

    // 3. Policy: STRICT_INTERIOR_ONLY
    // Must NOT select 8478025616; must select interior node 1616854065 (~26.566m)
    SnapResult r_int = grid.SnapCoordinate(qlat, qlon, SnapPolicy::STRICT_INTERIOR_ONLY, &validator, 500.0);
    ASSERT_TRUE(r_int.found, "Snap should succeed under STRICT_INTERIOR_ONLY");
    ASSERT_TRUE(r_int.status == SnapStatus::SUCCESS, "Status should be SUCCESS");
    ASSERT_TRUE(r_int.snapped_osm_id == 1616854065, "Must snap to nearest interior node 1616854065");
    ASSERT_TRUE(std::abs(r_int.snap_distance_meters - 26.566) < 0.05, "Snap distance should be ~26.566m");
    ASSERT_TRUE(r_int.snapped_is_boundary_node == false, "snapped_is_boundary_node must be FALSE");

    // Brute Force must yield the exact same interior node
    SnapResult bf_int = grid.BruteForceFindNearestNode(qlat, qlon, SnapPolicy::STRICT_INTERIOR_ONLY, 500.0);
    ASSERT_TRUE(bf_int.snapped_osm_id == 1616854065, "Brute force must also select 1616854065");
    ASSERT_TRUE(bf_int.snapped_is_boundary_node == false, "Brute force snapped_is_boundary_node must be FALSE");

    // 4. Maximum Snapping Distance Confinement
    // With max_dist = 10.0m:
    // ALLOW_ALL_NODES succeeds (4.994m <= 10m)
    SnapResult r_lim_all = grid.SnapCoordinate(qlat, qlon, SnapPolicy::ALLOW_ALL_NODES, &validator, 10.0);
    ASSERT_TRUE(r_lim_all.found, "ALLOW_ALL_NODES should succeed within 10m limit");
    ASSERT_TRUE(r_lim_all.snapped_osm_id == 8478025616, "Should snap to 8478025616");

    // STRICT_INTERIOR_ONLY fails because 1616854065 (26.566m) exceeds 10m limit
    SnapResult r_lim_int = grid.SnapCoordinate(qlat, qlon, SnapPolicy::STRICT_INTERIOR_ONLY, &validator, 10.0);
    ASSERT_TRUE(!r_lim_int.found, "STRICT_INTERIOR_ONLY must fail when closest interior exceeds limit");
    ASSERT_TRUE(r_lim_int.status == SnapStatus::SNAP_DISTANCE_EXCEEDED, "Status must be SNAP_DISTANCE_EXCEEDED");

    return true;
}

// Test 23: Component-Aware Snapping for Disconnected Subgraphs (Synthetic Verification)
bool Test23_ComponentAwareSnapping_SyntheticDisconnectedGraph() {
    Graph g;
    // Component A (Principal, 3 nodes): center around lat 26.300
    uint32_t n0 = g.AddNode(1001, 26.300, 73.000);
    uint32_t n1 = g.AddNode(1002, 26.301, 73.000);
    uint32_t n2 = g.AddNode(1003, 26.302, 73.000);
    g.AddEdge(n0, n1, 111.0, 10, 1, 1, 1, false, {});
    g.AddEdge(n1, n2, 111.0, 11, 1, 1, 1, false, {});

    // Component B (Isolated, 2 nodes): center around lat 26.295 (~555m south of n0)
    uint32_t n3 = g.AddNode(2001, 26.295, 73.000);
    uint32_t n4 = g.AddNode(2002, 26.296, 73.000);
    g.AddEdge(n3, n4, 111.0, 20, 1, 1, 1, false, {});

    SpatialGrid grid;
    grid.Build(g, 100.0);

    ASSERT_TRUE(grid.HasPrincipalComponent(), "Grid should detect principal component");
    ASSERT_TRUE(grid.GetPrincipalComponentSize() == 3, "Principal component size should be 3");
    ASSERT_TRUE(grid.IsNodeInPrincipalComponent(n0), "Node 1001 should be in GCC");
    ASSERT_TRUE(!grid.IsNodeInPrincipalComponent(n3), "Node 2001 should not be in GCC");

    // Query very close to isolated Node 2001 (e.g. 26.29505, ~5.5m away)
    // Distance to Node 2001: ~5.5m
    // Distance to Node 1001 (GCC): ~550m

    // With max_dist = 1000m: must prefer Node 1001 (GCC) over Node 2001
    SnapResult res_gcc = grid.FindNearestNode(26.29505, 73.000, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(res_gcc.found, "Snap should succeed");
    ASSERT_TRUE(res_gcc.snapped_osm_id == 1001, "Should prefer GCC node 1001 over isolated node 2001");
    ASSERT_TRUE(res_gcc.snapped_is_in_gcc == true, "Must be flagged as GCC");
    ASSERT_TRUE(res_gcc.snapped_component_id == 0, "Component ID must be 0");

    // With max_dist = 100m: GCC node is out of range. Under safe snapping policy,
    // isolated components must NOT be silently returned. Must return found = false
    // and status = NO_CONNECTED_ROAD_NETWORK_AVAILABLE.
    SnapResult res_fallback = grid.FindNearestNode(26.29505, 73.000, SnapPolicy::ALLOW_ALL_NODES, 100.0);
    ASSERT_TRUE(!res_fallback.found, "Unsafe fallback to isolated component must be rejected");
    ASSERT_TRUE(res_fallback.status == SnapStatus::NO_CONNECTED_ROAD_NETWORK_AVAILABLE,
                "Status must be NO_CONNECTED_ROAD_NETWORK_AVAILABLE");

    return true;
}

// Test 24: Canonical Jodhpur Incident #17950910249861 Snapping Regression
bool Test24_CanonicalJodhpur_Incident17950910249861_SnappingRegression() {
    Graph graph;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    BoundaryValidator validator;
    validator.LoadFromFile("data/jodhpur_boundary.geojson");

    SpatialGrid grid;
    grid.Build(graph, 250.0);

    // Incident #17950910249861 coordinates
    const double inc_lat = 26.252378;
    const double inc_lon = 73.050945;

    // 1. Verify coordinate lies inside Jodhpur Service Area
    ASSERT_TRUE(validator.IsInside(inc_lat, inc_lon), "Incident coordinates must be inside Jodhpur service area");

    // 2. Multi-stage snap under production policy (STRICT_INTERIOR_ONLY) with 1000m limit
    SnapResult res = grid.SnapCoordinate(inc_lat, inc_lon, SnapPolicy::STRICT_INTERIOR_ONLY, &validator, 1000.0);
    ASSERT_TRUE(res.found, "Snap must succeed within 1000m");
    ASSERT_TRUE(res.status == SnapStatus::SUCCESS, "Status must be SUCCESS");
    ASSERT_TRUE(res.snapped_osm_id == 5727986926,
                "Must snap to connected GCC Node 5727986926, not isolated node 5733751433");
    ASSERT_TRUE(res.snapped_is_in_gcc == true, "Snapped node must be in GCC");
    ASSERT_TRUE(res.snapped_component_id == 0, "Snapped node component ID must be 0 (GCC)");
    ASSERT_TRUE(res.snap_distance_meters > 750.0 && res.snap_distance_meters < 800.0,
                "Distance to GCC node 5727986926 must be ~769.97m");

    // 3. Independent Brute Force must yield the exact same GCC node
    SnapResult bf = grid.BruteForceFindNearestNode(inc_lat, inc_lon, SnapPolicy::STRICT_INTERIOR_ONLY, 1000.0);
    ASSERT_TRUE(bf.found, "Brute force must also find node");
    ASSERT_TRUE(bf.snapped_osm_id == 5727986926, "Brute force must snap to 5727986926");
    ASSERT_TRUE(res.snapped_internal_index == bf.snapped_internal_index, "Internal indices must match exactly");
    ASSERT_TRUE(std::abs(res.snap_distance_meters - bf.snap_distance_meters) < 1e-6,
                "Computed distances must match in IEEE-754 precision");

    return true;
}

// Test 25 (Safety 1): No GCC/SCC candidate within maximum snapping radius returns NO_CONNECTED_ROAD_NETWORK_AVAILABLE
bool Test25_NoSccCandidateWithinMaxRadius() {
    Graph g;
    // Giant SCC component (3 nodes): at lat 26.300
    uint32_t n0 = g.AddNode(1001, 26.300, 73.000);
    uint32_t n1 = g.AddNode(1002, 26.301, 73.000);
    uint32_t n2 = g.AddNode(1003, 26.302, 73.000);
    g.AddEdge(n0, n1, 111.0, 10, 1, 1, 1, false, {});
    g.AddEdge(n1, n2, 111.0, 11, 1, 1, 1, false, {});
    g.AddEdge(n2, n0, 111.0, 12, 1, 1, 1, false, {});

    // Isolated component (2 nodes): at lat 26.250 (~5.5km away)
    uint32_t n3 = g.AddNode(2001, 26.250, 73.000);
    uint32_t n4 = g.AddNode(2002, 26.251, 73.000);
    g.AddEdge(n3, n4, 111.0, 20, 1, 1, 1, false, {});
    g.AddEdge(n4, n3, 111.0, 21, 1, 1, 1, false, {});

    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Query 20 meters from isolated node 2001, but 5.5 km from Giant SCC
    // With max_dist = 500m: Isolated nodes exist within 500m, but NO SCC node exists.
    SnapResult res = grid.FindNearestNode(26.2501, 73.000, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(!res.found, "Snap must fail because no connected SCC node is within radius");
    ASSERT_TRUE(res.status == SnapStatus::NO_CONNECTED_ROAD_NETWORK_AVAILABLE,
                "Status must explicitly be NO_CONNECTED_ROAD_NETWORK_AVAILABLE");
    return true;
}

// Test 26 (Safety 2): Isolated-component fallback rejection (returns found = false)
bool Test26_IsolatedComponentFallbackRejection() {
    Graph g;
    // Component A (Giant SCC, 3 nodes in cycle)
    uint32_t n0 = g.AddNode(100, 26.300, 73.000);
    uint32_t n1 = g.AddNode(101, 26.301, 73.000);
    uint32_t n2 = g.AddNode(102, 26.302, 73.000);
    g.AddEdge(n0, n1, 100.0, 1, 1, 1, 1, false, {});
    g.AddEdge(n1, n2, 100.0, 2, 1, 1, 1, false, {});
    g.AddEdge(n2, n0, 100.0, 3, 1, 1, 1, false, {});

    // Component B (Disconnected 1 node)
    g.AddNode(999, 26.290, 73.000);

    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Query directly on node 999 with 200m radius
    SnapResult res = grid.FindNearestNode(26.290, 73.000, SnapPolicy::ALLOW_ALL_NODES, 200.0);
    ASSERT_TRUE(!res.found, "Must not silently fall back to isolated component node 999");
    ASSERT_TRUE(res.status == SnapStatus::NO_CONNECTED_ROAD_NETWORK_AVAILABLE,
                "Must report NO_CONNECTED_ROAD_NETWORK_AVAILABLE");
    return true;
}

// Test 27 (Safety 3): WCC node outside the giant SCC (rejected in favor of SCC candidate)
bool Test27_WccNodeOutsideGiantSccRejected() {
    Graph g;
    // Strongly connected core: Nodes 1, 2, 3 in directed cycle
    uint32_t n1 = g.AddNode(1001, 26.300, 73.000);
    uint32_t n2 = g.AddNode(1002, 26.301, 73.000);
    uint32_t n3 = g.AddNode(1003, 26.302, 73.000);
    g.AddEdge(n1, n2, 111.0, 1, 1, 1, 1, false, {});
    g.AddEdge(n2, n3, 111.0, 2, 1, 1, 1, false, {});
    g.AddEdge(n3, n1, 111.0, 3, 1, 1, 1, false, {});

    // Node 4 is weakly connected via one-way bridge: n3 -> n4, but cannot return from n4
    // Hence Node 4 is in WCC #0, but NOT in Giant SCC #0!
    uint32_t n4 = g.AddNode(1004, 26.3025, 73.000);
    g.AddEdge(n3, n4, 55.0, 4, 1, 1, 1, false, {});

    SpatialGrid grid;
    grid.Build(g, 100.0);

    ASSERT_TRUE(grid.HasGiantSCC(), "Must have Giant SCC");
    ASSERT_TRUE(grid.GetGiantSccSize() == 3, "Giant SCC size must be 3");
    ASSERT_TRUE(grid.IsNodeInGiantSCC(n1), "Node 1 must be in Giant SCC");
    ASSERT_TRUE(grid.IsNodeInGiantSCC(n3), "Node 3 must be in Giant SCC");
    ASSERT_TRUE(!grid.IsNodeInGiantSCC(n4), "Node 4 (one-way trap) must NOT be in Giant SCC");

    // Query close to Node 4 (e.g. 26.3024, ~10m from Node 4, ~45m from Node 3)
    SnapResult res = grid.FindNearestNode(26.3024, 73.000, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(res.found, "Snap should succeed to an SCC candidate");
    ASSERT_TRUE(res.snapped_osm_id == 1003, "Must snap to SCC Node 1003, skipping dead-end Node 1004");
    ASSERT_TRUE(res.snapped_is_in_scc == true, "Snapped node must be in SCC");
    ASSERT_TRUE(res.snapped_scc_id == 0, "Snapped node SCC ID must be 0");
    return true;
}

// Test 28 (Safety 4): Directed source-node reachability failure (in_degree == 0 node)
bool Test28_DirectedSourceNodeReachabilityFailure() {
    Graph g;
    // Core SCC
    uint32_t n1 = g.AddNode(1001, 26.300, 73.000);
    uint32_t n2 = g.AddNode(1002, 26.301, 73.000);
    g.AddEdge(n1, n2, 111.0, 1, 1, 1, 1, false, {});
    g.AddEdge(n2, n1, 111.0, 2, 1, 1, 1, false, {});

    // Source node S (in_degree == 0): S -> n1 only. Depots at n1/n2 cannot reach S!
    uint32_t nS = g.AddNode(9999, 26.2995, 73.000);
    g.AddEdge(nS, n1, 55.0, 3, 1, 1, 1, false, {});

    SpatialGrid grid;
    grid.Build(g, 100.0);

    ASSERT_TRUE(!grid.IsNodeInGiantSCC(nS), "Source node S must not be in Giant SCC");

    // Query close to source node S
    SnapResult res = grid.FindNearestNode(26.2994, 73.000, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(res.found, "Snap should find reachable SCC node");
    ASSERT_TRUE(res.snapped_osm_id == 1001, "Must snap to reachable SCC Node 1001 rather than unreachable source node S");
    return true;
}

// Test 29 (Safety 5): Directed sink-node hospital reachability failure (out_degree == 0 node)
bool Test29_DirectedSinkNodeHospitalReachabilityFailure() {
    Graph g;
    // Core SCC (Hospital located at n1)
    uint32_t n1 = g.AddNode(1001, 26.300, 73.000);
    uint32_t n2 = g.AddNode(1002, 26.301, 73.000);
    g.AddEdge(n1, n2, 111.0, 1, 1, 1, 1, false, {});
    g.AddEdge(n2, n1, 111.0, 2, 1, 1, 1, false, {});

    // Sink node T (out_degree == 0): n2 -> T only. An incident at T cannot reach hospital at n1!
    uint32_t nT = g.AddNode(8888, 26.3015, 73.000);
    g.AddEdge(n2, nT, 55.0, 3, 1, 1, 1, false, {});

    SpatialGrid grid;
    grid.Build(g, 100.0);

    ASSERT_TRUE(!grid.IsNodeInGiantSCC(nT), "Sink node T must not be in Giant SCC");

    // Query close to sink node T
    SnapResult res = grid.FindNearestNode(26.3016, 73.000, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(res.found, "Snap should find reachable SCC node");
    ASSERT_TRUE(res.snapped_osm_id == 1002, "Must snap to SCC Node 1002 so path to hospital at 1001 exists");
    return true;
}

// Test 30 (Safety 6): Valid incident location within giant SCC succeeds
bool Test30_ValidIncidentLocationWithinGiantSccSucceeds() {
    Graph g = CreateSyntheticGraph();
    // Add cycle to synthetic graph so it's strongly connected
    g.AddEdge(0, 1, 100.0, 1, 1, 1, 1, false, {});
    g.AddEdge(1, 2, 100.0, 2, 1, 1, 1, false, {});
    g.AddEdge(2, 3, 100.0, 3, 1, 1, 1, false, {});
    g.AddEdge(3, 4, 100.0, 4, 1, 1, 1, false, {});
    g.AddEdge(4, 0, 100.0, 5, 1, 1, 1, false, {});

    SpatialGrid grid;
    grid.Build(g, 100.0);

    SnapResult res = grid.FindNearestNode(26.2901, 73.0149, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(res.found, "Valid location must snap successfully");
    ASSERT_TRUE(res.status == SnapStatus::SUCCESS, "Status must be SUCCESS");
    ASSERT_TRUE(res.snapped_is_in_scc == true, "Must be in SCC");
    ASSERT_TRUE(res.snapped_scc_id == 0, "SCC ID must be 0");
    return true;
}

// Test 31 (Safety 7): Multiple candidates candidate selection
bool Test31_MultipleCandidatesSelection() {
    Graph g;
    // Core SCC (Nodes 1, 2, 3)
    uint32_t n1 = g.AddNode(1001, 26.300, 73.000);
    uint32_t n2 = g.AddNode(1002, 26.301, 73.000);
    uint32_t n3 = g.AddNode(1003, 26.302, 73.000);
    g.AddEdge(n1, n2, 111.0, 1, 1, 1, 1, false, {});
    g.AddEdge(n2, n3, 111.0, 2, 1, 1, 1, false, {});
    g.AddEdge(n3, n1, 111.0, 3, 1, 1, 1, false, {});

    // Dead end node: n3 -> n4 only
    uint32_t n4 = g.AddNode(1004, 26.3022, 73.000);
    g.AddEdge(n3, n4, 22.0, 4, 1, 1, 1, false, {});

    SpatialGrid grid;
    grid.Build(g, 50.0);

    // Query 5m from Node 1004, 25m from Node 1003
    auto candidates = grid.FindNearestCandidates(26.30225, 73.000, SnapPolicy::ALLOW_ALL_NODES, 200.0, 5);
    ASSERT_TRUE(!candidates.empty(), "Should return candidates");
    ASSERT_TRUE(candidates[0].snapped_osm_id == 1004, "Closest candidate is 1004");
    ASSERT_TRUE(candidates[0].snapped_is_in_scc == false, "Closest candidate is not in SCC");
    ASSERT_TRUE(candidates.size() >= 2, "Must return at least 2 candidates");
    ASSERT_TRUE(candidates[1].snapped_osm_id == 1003, "Second closest is 1003");
    ASSERT_TRUE(candidates[1].snapped_is_in_scc == true, "Second candidate is in SCC");

    // FindNearestNode automatically prunes to the best SCC candidate
    SnapResult best = grid.FindNearestNode(26.30225, 73.000, SnapPolicy::ALLOW_ALL_NODES, 200.0);
    ASSERT_TRUE(best.found, "Snap should succeed");
    ASSERT_TRUE(best.snapped_osm_id == 1003, "FindNearestNode must select SCC candidate 1003");
    return true;
}

// Test 32 (Safety 8): No valid candidate within maximum distance returns SNAP_DISTANCE_EXCEEDED
bool Test32_NoCandidateWithinMaxDistance() {
    Graph g = CreateSyntheticGraph();
    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Query in deep desert: lat 27.0, lon 74.0 (>100 km away)
    SnapResult res = grid.FindNearestNode(27.0, 74.0, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
    ASSERT_TRUE(!res.found, "Snap must fail when out of distance");
    ASSERT_TRUE(res.status == SnapStatus::SNAP_DISTANCE_EXCEEDED, "Status must be SNAP_DISTANCE_EXCEEDED");
    return true;
}

// Test 33 (Safety 9): Existing boundary and deterministic tie-breaking behavior
bool Test33_BoundaryAndTieBreakingBehavior() {
    Graph g;
    // Two equidistant nodes in Giant SCC
    uint32_t a = g.AddNode(2000, 26.001, 73.0);
    uint32_t b = g.AddNode(1000, 25.999, 73.0);
    g.AddEdge(a, b, 222.0, 1, 1, 1, 1, false, {});
    g.AddEdge(b, a, 222.0, 2, 1, 1, 1, false, {});

    SpatialGrid grid;
    grid.Build(g, 100.0);

    SnapResult res = grid.FindNearestNode(26.0, 73.0, SnapPolicy::ALLOW_ALL_NODES, 500.0);
    ASSERT_TRUE(res.found, "Snap should succeed");
    ASSERT_TRUE(res.snapped_osm_id == 1000, "Deterministic tie-breaking selects smaller OSM ID 1000");

    BoundaryValidator validator;
    validator.LoadFromFile("data/jodhpur_boundary.geojson");
    SnapResult bound_res = grid.SnapCoordinate(26.0, 73.0, SnapPolicy::STRICT_INTERIOR_ONLY, &validator, 500.0);
    ASSERT_TRUE(!bound_res.found, "Coordinate outside boundary must fail");
    ASSERT_TRUE(bound_res.status == SnapStatus::OUTSIDE_SERVICE_AREA, "Status must be OUTSIDE_SERVICE_AREA");
    return true;
}

// Test 34 (Safety 10): Brute-force and optimized snapping consistency
bool Test34_BruteForceAndOptimizedConsistency() {
    Graph g;
    // Strongly connected core
    uint32_t n1 = g.AddNode(101, 26.290, 73.010);
    uint32_t n2 = g.AddNode(102, 26.295, 73.010);
    uint32_t n3 = g.AddNode(103, 26.290, 73.015);
    g.AddEdge(n1, n2, 500.0, 1, 1, 1, 1, false, {});
    g.AddEdge(n2, n3, 500.0, 2, 1, 1, 1, false, {});
    g.AddEdge(n3, n1, 500.0, 3, 1, 1, 1, false, {});

    // Disconnected / dead-end nodes
    uint32_t n4 = g.AddNode(201, 26.280, 73.010); // Isolated
    uint32_t n5 = g.AddNode(202, 26.281, 73.010);
    g.AddEdge(n4, n5, 100.0, 4, 1, 1, 1, false, {});

    SpatialGrid grid;
    grid.Build(g, 100.0);

    // Test a series of diverse probe coordinates
    std::vector<std::pair<double, double>> probes = {
        {26.291, 73.011}, // Close to core
        {26.294, 73.012}, // Near n2 and n3
        {26.2805, 73.010}, // Near isolated component (both should reject)
        {26.350, 73.050}  // Far away
    };

    for (const auto& pt : probes) {
        SnapResult grid_res = grid.FindNearestNode(pt.first, pt.second, SnapPolicy::ALLOW_ALL_NODES, 1000.0);
        SnapResult bf_res = grid.BruteForceFindNearestNode(pt.first, pt.second, SnapPolicy::ALLOW_ALL_NODES, 1000.0);

        ASSERT_TRUE(grid_res.found == bf_res.found, "Grid and Brute-Force found status must match");
        ASSERT_TRUE(grid_res.status == bf_res.status, "Grid and Brute-Force status must match");
        if (grid_res.found) {
            ASSERT_TRUE(grid_res.snapped_osm_id == bf_res.snapped_osm_id, "Grid and Brute-Force snapped OSM ID must match");
            ASSERT_TRUE(grid_res.snapped_internal_index == bf_res.snapped_internal_index, "Internal indices must match");
            ASSERT_TRUE(std::abs(grid_res.snap_distance_meters - bf_res.snap_distance_meters) < 1e-6, "Distances must match");
        }
    }
    return true;
}

int main() {
    std::cout << "========================================================\n"
              << "RUNNING TEST SUITE: SpatialGrid (Directed-Reachability Safe)\n"
              << "========================================================\n";

    int passed = 0;
    int failed = 0;

    auto run_test = [&](const char* name, bool (*func)()) {
        std::cout << "[RUN ] " << name << " ... ";
        if (func()) {
            std::cout << "PASSED\n";
            ++passed;
        } else {
            std::cout << "FAILED\n";
            ++failed;
        }
    };

    run_test("Test 1: Basic nearest-node search", Test1_BasicNearestNodeSearch);
    run_test("Test 2: Query at exact graph node", Test2_QueryAtExactNode);
    run_test("Test 3: Deterministic tie-breaking on exact equality", Test3_DeterministicOSMTieBreakingOnExactEquality);
    run_test("Test 4A: Strict closer candidate with larger OSM ID", Test4A_StrictCloserCandidateWithLargerOSMID);
    run_test("Test 4B: Sub-nanometer distance strict ordering", Test4B_SubNanometerDifferenceStrictOrdering);
    run_test("Test 4C: Unvisited cell candidate pruning consistency", Test4C_UnvisitedCellCandidateConsistency);
    run_test("Test 5: Nearest node in adjacent cell", Test5_NearestInAdjacentCell);
    run_test("Test 6: Nearest node across empty cells", Test6_NearestSeveralCellsAway);
    run_test("Test 7: Nearest node across cell boundary", Test7_NearestAcrossCellBoundary);
    run_test("Test 8: Empty grid handling", Test8_EmptyGrid);
    run_test("Test 9: Single-node grid", Test9_SingleNodeGrid);
    run_test("Test 10 & 11: Invalid coordinate ranges", Test10_11_InvalidCoordinates);
    run_test("Test 12 & 13: NaN and Infinity handling", Test12_13_NanAndInfinity);
    run_test("Test 14 & 15: Max snap distance enforcement", Test14_15_MaxSnapDistanceEnforcement);
    run_test("Test 16: Snap with BoundaryValidator", Test16_SnapWithBoundaryValidation);
    run_test("Test 17: Query near grid limits", Test17_QueryNearGridLimits);
    run_test("Test 18: Canonical Jodhpur verification & benchmarks", Test18_CanonicalJodhpurVerificationAndBenchmarks);
    run_test("Test 19: Conservative Lower Bound (Review Counterexample)", Test19_ConservativeLowerBound_Counterexample);
    run_test("Test 20: Conservative Lower Bound (Directional & Edge Cases)", Test20_ConservativeLowerBound_DirectionalAndEdgeCases);
    run_test("Test 21: Conservative Lower Bound (Randomized Stress Test)", Test21_ConservativeLowerBound_RandomizedStressTest);
    run_test("Test 22: Boundary-Node Snapping Policy Verification", Test22_BoundaryNodeSnappingPolicies_ReproducibleCase);
    run_test("Test 23: Component-Aware Snapping for Disconnected Subgraphs (Synthetic)", Test23_ComponentAwareSnapping_SyntheticDisconnectedGraph);
    run_test("Test 24: Canonical Jodhpur Incident #17950910249861 Snapping Regression", Test24_CanonicalJodhpur_Incident17950910249861_SnappingRegression);
    run_test("Test 25: Safety 1 - No GCC/SCC candidate within maximum radius", Test25_NoSccCandidateWithinMaxRadius);
    run_test("Test 26: Safety 2 - Isolated-component fallback rejection", Test26_IsolatedComponentFallbackRejection);
    run_test("Test 27: Safety 3 - WCC node outside giant SCC rejected", Test27_WccNodeOutsideGiantSccRejected);
    run_test("Test 28: Safety 4 - Directed source-node reachability failure", Test28_DirectedSourceNodeReachabilityFailure);
    run_test("Test 29: Safety 5 - Directed sink-node hospital reachability failure", Test29_DirectedSinkNodeHospitalReachabilityFailure);
    run_test("Test 30: Safety 6 - Valid incident location within giant SCC", Test30_ValidIncidentLocationWithinGiantSccSucceeds);
    run_test("Test 31: Safety 7 - Multiple candidates candidate selection", Test31_MultipleCandidatesSelection);
    run_test("Test 32: Safety 8 - No candidate within max distance", Test32_NoCandidateWithinMaxDistance);
    run_test("Test 33: Safety 9 - Boundary and deterministic tie-breaking", Test33_BoundaryAndTieBreakingBehavior);
    run_test("Test 34: Safety 10 - Brute-force and optimized snapping consistency", Test34_BruteForceAndOptimizedConsistency);

    std::cout << "\n========================================================\n"
              << "SPATIALGRID TEST SUMMARY: " << passed << " PASSED, " << failed << " FAILED\n"
              << "========================================================\n";

    return (failed == 0) ? 0 : 1;
}

