#include "Graph.hpp"
#include "DataLoader.hpp"
#include "Dijkstra.hpp"
#include <iostream>
#include <cassert>
#include <cmath>
#include <limits>
#include <chrono>
#include <iomanip>
#include <algorithm>
#include <random>
#include <numeric>

using namespace EmergencyRouting;

#define TEST_ASSERT(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "[TEST_FAIL] " << __FUNCTION__ << ":" << __LINE__ << " - " << msg << std::endl; \
            return false; \
        } \
    } while (0)

#define EXPECT_THROW(stmt, ex_type, msg) \
    do { \
        bool caught = false; \
        try { \
            stmt; \
        } catch (const ex_type& e) { \
            caught = true; \
            std::cout << "  (Expected exception caught: " << e.what() << ")" << std::endl; \
        } catch (...) { \
            std::cerr << "[TEST_FAIL] Caught unexpected exception type for " << msg << std::endl; \
            return false; \
        } \
        if (!caught) { \
            std::cerr << "[TEST_FAIL] Expected exception not thrown for " << msg << std::endl; \
            return false; \
        } \
    } while (0)

// Helper to verify that a reconstructed path follows valid directed edges
// and its summed edge weights equal total_distance_meters within epsilon
bool VerifyPathIntegrity(const Graph& graph, const RouteResult& res, double epsilon = 1e-4) {
    if (!res.found) return false;
    if (res.source_internal_idx == res.destination_internal_idx) {
        return res.path_internal_indices.size() == 1 &&
               res.path_internal_indices[0] == res.source_internal_idx &&
               res.total_distance_meters == 0.0 &&
               res.path_segments.empty();
    }

    if (res.path_internal_indices.size() < 2) return false;
    if (res.path_internal_indices.front() != res.source_internal_idx) return false;
    if (res.path_internal_indices.back() != res.destination_internal_idx) return false;
    if (res.path_segments.size() != res.path_internal_indices.size() - 1) return false;

    double sum_weights = 0.0;
    for (size_t i = 0; i < res.path_segments.size(); ++i) {
        const auto& seg = res.path_segments[i];
        if (seg.from_idx != res.path_internal_indices[i]) return false;
        if (seg.to_idx != res.path_internal_indices[i + 1]) return false;

        // Verify edge actually exists in graph
        bool edge_exists = false;
        for (const auto& out_edge : graph.GetOutgoingEdges(seg.from_idx)) {
            if (out_edge.target_idx == seg.to_idx &&
                std::abs(out_edge.distance_meters - seg.distance_meters) < 1e-6) {
                edge_exists = true;
                break;
            }
        }
        if (!edge_exists) return false;
        sum_weights += seg.distance_meters;
    }

    return std::abs(sum_weights - res.total_distance_meters) < epsilon;
}

// ============================================================================
// OBJECTIVE E: SYNTHETIC GRAPH TESTS (14 SCENARIOS)
// ============================================================================

// 1. Basic shortest path (A -> B -> C)
bool Test1_BasicShortestPath() {
    std::cout << "Running Test1_BasicShortestPath..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    g.AddNode(30, 26.2, 73.2);
    g.AddEdge(0, 1, 100.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 150.0, 2, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 2);

    TEST_ASSERT(res.found, "Route must be found");
    TEST_ASSERT(std::abs(res.total_distance_meters - 250.0) < 1e-6, "Distance must be 250.0m");
    TEST_ASSERT(VerifyPathIntegrity(g, res), "Path integrity must pass");
    std::cout << "Test1_BasicShortestPath: PASSED\n" << std::endl;
    return true;
}

// 2. Multiple possible paths; select minimum total weight
bool Test2_MultiplePathsSelectMinWeight() {
    std::cout << "Running Test2_MultiplePathsSelectMinWeight..." << std::endl;
    // Path 1: 0 -> 1 -> 3 (weight 50 + 50 = 100)
    // Path 2: 0 -> 2 -> 3 (weight 30 + 40 = 70) [Optimal]
    Graph g;
    g.AddNode(1, 26.0, 73.0);
    g.AddNode(2, 26.1, 73.1);
    g.AddNode(3, 26.2, 73.2);
    g.AddNode(4, 26.3, 73.3);

    g.AddEdge(0, 1, 50.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 3, 50.0, 2, 0, 0, 0, true, {});
    g.AddEdge(0, 2, 30.0, 3, 0, 0, 0, true, {});
    g.AddEdge(2, 3, 40.0, 4, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 3);

    TEST_ASSERT(res.found, "Route must be found");
    TEST_ASSERT(std::abs(res.total_distance_meters - 70.0) < 1e-6, "Distance must be 70.0m");
    TEST_ASSERT(res.path_internal_indices.size() == 3, "Path must have 3 nodes");
    TEST_ASSERT(res.path_internal_indices[1] == 2, "Path must traverse via node index 2");
    TEST_ASSERT(VerifyPathIntegrity(g, res), "Path integrity must pass");
    std::cout << "Test2_MultiplePathsSelectMinWeight: PASSED\n" << std::endl;
    return true;
}

// 3. Direct route versus shorter multi-edge route
bool Test3_DirectVsShorterMultiEdge() {
    std::cout << "Running Test3_DirectVsShorterMultiEdge..." << std::endl;
    // Direct: 0 -> 2 (weight 500.0)
    // Multi-edge: 0 -> 1 -> 2 (weight 120.0 + 130.0 = 250.0)
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    g.AddNode(30, 26.2, 73.2);

    g.AddEdge(0, 2, 500.0, 1, 0, 0, 0, true, {});
    g.AddEdge(0, 1, 120.0, 2, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 130.0, 3, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 2);

    TEST_ASSERT(res.found, "Route must be found");
    TEST_ASSERT(std::abs(res.total_distance_meters - 250.0) < 1e-6, "Shortest distance must be 250.0m (not 500m)");
    TEST_ASSERT(res.path_internal_indices.size() == 3, "Multi-edge path must be selected");
    TEST_ASSERT(VerifyPathIntegrity(g, res), "Path integrity must pass");
    std::cout << "Test3_DirectVsShorterMultiEdge: PASSED\n" << std::endl;
    return true;
}

// 4. Directed one-way route
bool Test4_DirectedOneWayRoute() {
    std::cout << "Running Test4_DirectedOneWayRoute..." << std::endl;
    Graph g;
    g.AddNode(100, 26.0, 73.0);
    g.AddNode(200, 26.1, 73.1);
    g.AddEdge(0, 1, 80.0, 1, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 1);

    TEST_ASSERT(res.found, "Forward 0 -> 1 must be found");
    TEST_ASSERT(std::abs(res.total_distance_meters - 80.0) < 1e-6, "Distance must be 80.0m");
    TEST_ASSERT(VerifyPathIntegrity(g, res), "Path integrity must pass");
    std::cout << "Test4_DirectedOneWayRoute: PASSED\n" << std::endl;
    return true;
}

// 5. Reverse direction unreachable
bool Test5_ReverseDirectionUnreachable() {
    std::cout << "Running Test5_ReverseDirectionUnreachable..." << std::endl;
    Graph g;
    g.AddNode(100, 26.0, 73.0);
    g.AddNode(200, 26.1, 73.1);
    g.AddEdge(0, 1, 80.0, 1, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult rev = router.ShortestPath(1, 0);

    TEST_ASSERT(!rev.found, "Reverse route 1 -> 0 must be unreachable");
    TEST_ASSERT(std::isinf(rev.total_distance_meters), "Distance must be infinity");
    TEST_ASSERT(rev.path_internal_indices.empty(), "Path indices must be empty");
    TEST_ASSERT(rev.path_segments.empty(), "Path segments must be empty");
    std::cout << "Test5_ReverseDirectionUnreachable: PASSED\n" << std::endl;
    return true;
}

// 6. Disconnected destination
bool Test6_DisconnectedDestination() {
    std::cout << "Running Test6_DisconnectedDestination..." << std::endl;
    // Component 1: 0 -> 1; Component 2: 2 -> 3
    Graph g;
    g.AddNode(1, 26.0, 73.0);
    g.AddNode(2, 26.1, 73.1);
    g.AddNode(3, 26.2, 73.2);
    g.AddNode(4, 26.3, 73.3);

    g.AddEdge(0, 1, 50.0, 1, 0, 0, 0, true, {});
    g.AddEdge(2, 3, 50.0, 2, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 3);

    TEST_ASSERT(!res.found, "Route to disconnected component must be unreachable");
    TEST_ASSERT(std::isinf(res.total_distance_meters), "Distance must be infinity");
    TEST_ASSERT(res.path_internal_indices.empty(), "Path must be empty");
    std::cout << "Test6_DisconnectedDestination: PASSED\n" << std::endl;
    return true;
}

// 7. Source equals destination
bool Test7_SourceEqualsDestination() {
    std::cout << "Running Test7_SourceEqualsDestination..." << std::endl;
    Graph g;
    g.AddNode(500, 26.0, 73.0);

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 0);

    TEST_ASSERT(res.found, "Self route must be found");
    TEST_ASSERT(res.total_distance_meters == 0.0, "Distance must be 0.0");
    TEST_ASSERT(res.path_internal_indices.size() == 1, "Path must contain exactly 1 node");
    TEST_ASSERT(res.path_internal_indices[0] == 0, "Node must be source index");
    TEST_ASSERT(res.path_osm_ids[0] == 500, "OSM ID must be 500");
    TEST_ASSERT(res.path_segments.empty(), "Self route has 0 segments");
    std::cout << "Test7_SourceEqualsDestination: PASSED\n" << std::endl;
    return true;
}

// 8. Invalid source OSM ID
bool Test8_InvalidSourceOsmId() {
    std::cout << "Running Test8_InvalidSourceOsmId..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);

    DijkstraRouter router(g);
    EXPECT_THROW(router.ShortestPathOsm(999999, 20), std::out_of_range, "Invalid Source OSM ID");
    std::cout << "Test8_InvalidSourceOsmId: PASSED\n" << std::endl;
    return true;
}

// 9. Invalid destination OSM ID
bool Test9_InvalidDestinationOsmId() {
    std::cout << "Running Test9_InvalidDestinationOsmId..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);

    DijkstraRouter router(g);
    EXPECT_THROW(router.ShortestPathOsm(10, 999999), std::out_of_range, "Invalid Destination OSM ID");
    std::cout << "Test9_InvalidDestinationOsmId: PASSED\n" << std::endl;
    return true;
}

// 10. Equal-cost alternative paths with deterministic behavior
bool Test10_EqualCostAlternativePaths() {
    std::cout << "Running Test10_EqualCostAlternativePaths..." << std::endl;
    // Path 1: 0 -> 1 -> 3 (weight 40.0 + 40.0 = 80.0)
    // Path 2: 0 -> 2 -> 3 (weight 40.0 + 40.0 = 80.0)
    Graph g;
    g.AddNode(1, 26.0, 73.0);
    g.AddNode(2, 26.1, 73.1);
    g.AddNode(3, 26.2, 73.2);
    g.AddNode(4, 26.3, 73.3);

    g.AddEdge(0, 1, 40.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 3, 40.0, 2, 0, 0, 0, true, {});
    g.AddEdge(0, 2, 40.0, 3, 0, 0, 0, true, {});
    g.AddEdge(2, 3, 40.0, 4, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res1 = router.ShortestPath(0, 3);
    RouteResult res2 = router.ShortestPath(0, 3);

    TEST_ASSERT(res1.found, "Route must be found");
    TEST_ASSERT(std::abs(res1.total_distance_meters - 80.0) < 1e-6, "Distance must be 80.0m");
    TEST_ASSERT(res1.path_internal_indices == res2.path_internal_indices, "Equal-cost tie breaking must be deterministic");
    TEST_ASSERT(VerifyPathIntegrity(g, res1), "Path integrity must pass");
    std::cout << "Test10_EqualCostAlternativePaths: PASSED\n" << std::endl;
    return true;
}

// 11. Large edge weights
bool Test11_LargeEdgeWeights() {
    std::cout << "Running Test11_LargeEdgeWeights..." << std::endl;
    Graph g;
    g.AddNode(1, 26.0, 73.0);
    g.AddNode(2, 26.1, 73.1);
    g.AddNode(3, 26.2, 73.2);

    const double large_w1 = 1e9;
    const double large_w2 = 2e9;
    g.AddEdge(0, 1, large_w1, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, large_w2, 2, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 2);

    TEST_ASSERT(res.found, "Route with large weights must be found");
    TEST_ASSERT(std::abs(res.total_distance_meters - 3e9) < 1.0, "Summed large distance must be 3e9");
    TEST_ASSERT(VerifyPathIntegrity(g, res, 1.0), "Path integrity with large weights");
    std::cout << "Test11_LargeEdgeWeights: PASSED\n" << std::endl;
    return true;
}

// 12. Floating-point precision distance calculations
bool Test12_FloatingPointPrecisionDistances() {
    std::cout << "Running Test12_FloatingPointPrecisionDistances..." << std::endl;
    Graph g;
    g.AddNode(1, 26.0, 73.0);
    g.AddNode(2, 26.1, 73.1);
    g.AddNode(3, 26.2, 73.2);

    const double w1 = 37.412345;
    const double w2 = 62.587655;
    g.AddEdge(0, 1, w1, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, w2, 2, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 2);

    TEST_ASSERT(res.found, "Route must be found");
    TEST_ASSERT(std::abs(res.total_distance_meters - 100.0) < 1e-6, "Floating-point precision summation must be 100.0m");
    TEST_ASSERT(VerifyPathIntegrity(g, res), "Path integrity must pass");
    std::cout << "Test12_FloatingPointPrecisionDistances: PASSED\n" << std::endl;
    return true;
}

// 13. Path reconstruction correctness
bool Test13_PathReconstructionCorrectness() {
    std::cout << "Running Test13_PathReconstructionCorrectness..." << std::endl;
    // Chain: 0 -> 1 -> 2 -> 3 -> 4
    Graph g;
    for (int i = 0; i < 5; ++i) {
        g.AddNode(100 + i, 26.0 + i * 0.01, 73.0 + i * 0.01);
    }
    g.AddEdge(0, 1, 10.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 20.0, 2, 0, 0, 0, true, {});
    g.AddEdge(2, 3, 30.0, 3, 0, 0, 0, true, {});
    g.AddEdge(3, 4, 40.0, 4, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 4);

    TEST_ASSERT(res.found, "Chain path must be found");
    TEST_ASSERT(res.path_internal_indices.size() == 5, "Path must contain 5 vertices");
    for (size_t i = 0; i < 5; ++i) {
        TEST_ASSERT(res.path_internal_indices[i] == static_cast<uint32_t>(i), "Path sequence must be 0,1,2,3,4");
        TEST_ASSERT(res.path_osm_ids[i] == 100 + static_cast<int64_t>(i), "OSM ID sequence must match");
    }
    TEST_ASSERT(res.path_segments.size() == 4, "Must contain 4 segments");
    TEST_ASSERT(VerifyPathIntegrity(g, res), "Path integrity must pass");
    std::cout << "Test13_PathReconstructionCorrectness: PASSED\n" << std::endl;
    return true;
}

// 14. Single-source results against multiple destinations
bool Test14_SingleSourceVsSinglePair() {
    std::cout << "Running Test14_SingleSourceVsSinglePair..." << std::endl;
    // Complex diamond graph
    Graph g;
    g.AddNode(0, 26.0, 73.0);
    g.AddNode(1, 26.1, 73.1);
    g.AddNode(2, 26.2, 73.2);
    g.AddNode(3, 26.3, 73.3);
    g.AddNode(4, 26.4, 73.4);

    g.AddEdge(0, 1, 15.0, 1, 0, 0, 0, true, {});
    g.AddEdge(0, 2, 25.0, 2, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 5.0, 3, 0, 0, 0, true, {});
    g.AddEdge(1, 3, 30.0, 4, 0, 0, 0, true, {});
    g.AddEdge(2, 3, 10.0, 5, 0, 0, 0, true, {});
    g.AddEdge(3, 4, 5.0, 6, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // Compute SingleSource from 0 to all
    SingleSourceResult ss = router.ShortestPathToAll(0);
    TEST_ASSERT(ss.visited_nodes == 5, "All 5 nodes must be visited");

    // Compare each destination route from SingleSource with SinglePair
    for (uint32_t dest = 0; dest < 5; ++dest) {
        RouteResult single_pair = router.ShortestPath(0, dest);
        RouteResult from_ss = router.ReconstructRouteFromSingleSource(ss, dest);

        TEST_ASSERT(single_pair.found == from_ss.found, "Reachability must match");
        TEST_ASSERT(std::abs(single_pair.total_distance_meters - from_ss.total_distance_meters) < 1e-6,
                    "Distances must match between single-pair and single-source");
        TEST_ASSERT(single_pair.path_internal_indices == from_ss.path_internal_indices,
                    "Reconstructed paths must be identical");
        TEST_ASSERT(VerifyPathIntegrity(g, from_ss), "Single-source path integrity must pass");
    }

    std::cout << "Test14_SingleSourceVsSinglePair: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// CANONICAL JODHPUR ROAD GRAPH TESTS & PERFORMANCE BENCHMARK
// ============================================================================

bool TestCanonicalJodhpurGraphFacilityRoutes() {
    std::cout << "\n====================================================================\n"
              << "  CANONICAL JODHPUR GRAPH: 30 DIRECTED FACILITY PAIRS AUDIT\n"
              << "====================================================================\n" << std::endl;

    Graph graph;
    std::cout << "Loading canonical graph dataset..." << std::endl;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);

    DijkstraRouter router(graph);

    struct Facility {
        std::string name;
        int64_t osm_id;
    };

    static const std::vector<Facility> facilities = {
        {"AIIMS Jodhpur", 8520698362},
        {"MDM Hospital", 5321319416},
        {"Mathura Das Mathur Hospital", 8499684813},
        {"Basni", 2694302020},
        {"Sojati Gate", 2688566058},
        {"Paota Circle", 3773158752}
    };

    // Test Source equals Destination on canonical graph
    RouteResult self_res = router.ShortestPathOsm(facilities[0].osm_id, facilities[0].osm_id);
    TEST_ASSERT(self_res.found, "Canonical self-route must be found");
    TEST_ASSERT(self_res.total_distance_meters == 0.0, "Canonical self-route distance must be 0.0");
    TEST_ASSERT(self_res.path_osm_ids.size() == 1, "Canonical self-route path has 1 node");

    std::vector<double> latencies;
    latencies.reserve(30);
    std::vector<std::vector<double>> pair_distances(6, std::vector<double>(6, 0.0));
    size_t total_visited_nodes = 0;
    size_t total_relaxed_edges = 0;

    std::cout << "\nEvaluating 30 Directed Shortest Paths among 6 Facilities:\n";
    std::cout << "--------------------------------------------------------------------------------------------------\n";
    std::cout << std::setw(28) << std::left << "From Facility"
              << std::setw(28) << std::left << "To Facility"
              << std::setw(14) << std::right << "Distance (m)"
              << std::setw(10) << std::right << "Hops"
              << std::setw(12) << std::right << "Settled"
              << std::setw(12) << std::right << "Time (ms)" << "\n";
    std::cout << "--------------------------------------------------------------------------------------------------\n";

    size_t routes_verified = 0;

    for (size_t i = 0; i < facilities.size(); ++i) {
        // Also compute single-source for facility i to compare single-source vs single-pair
        SingleSourceResult ss_res = router.ShortestPathToAllOsm(facilities[i].osm_id);

        for (size_t j = 0; j < facilities.size(); ++j) {
            if (i == j) continue;

            RouteResult res = router.ShortestPathOsm(facilities[i].osm_id, facilities[j].osm_id);
            TEST_ASSERT(res.found, "Route must be found");
            TEST_ASSERT(res.total_distance_meters > 0.0, "Distance must be strictly positive");
            TEST_ASSERT(res.path_internal_indices.size() >= 2, "Path must contain at least 2 nodes");

            // Independent path verification:
            // 1. Path edges validity
            // 2. Summed edge weights == total_distance_meters
            // 3. First node == source, last node == destination
            TEST_ASSERT(VerifyPathIntegrity(graph, res), "Reconstructed path integrity must pass");

            // Compare with single-source all-destinations result
            RouteResult ss_route = router.ReconstructRouteFromSingleSourceOsm(ss_res, facilities[j].osm_id);
            TEST_ASSERT(ss_route.found, "Single-source route must be found");
            TEST_ASSERT(std::abs(res.total_distance_meters - ss_route.total_distance_meters) < 1e-4,
                        "Single-pair distance must match single-source distance");
            TEST_ASSERT(res.path_internal_indices == ss_route.path_internal_indices,
                        "Single-pair path must match single-source path");

            pair_distances[i][j] = res.total_distance_meters;
            latencies.push_back(res.algorithm_execution_time_ms);
            total_visited_nodes += res.visited_nodes;
            total_relaxed_edges += res.relaxed_edges;
            ++routes_verified;

            std::cout << std::setw(28) << std::left << facilities[i].name
                      << std::setw(28) << std::left << facilities[j].name
                      << std::setw(14) << std::right << std::fixed << std::setprecision(2) << res.total_distance_meters
                      << std::setw(10) << std::right << (res.path_internal_indices.size() - 1)
                      << std::setw(12) << std::right << res.visited_nodes
                      << std::setw(12) << std::right << std::setprecision(2) << res.algorithm_execution_time_ms << "\n";
        }
    }
    std::cout << "--------------------------------------------------------------------------------------------------\n";
    TEST_ASSERT(routes_verified == 30, "All 30 directed routes must be verified");

    // Triangle inequality verification on facility triplets: dist(A, C) <= dist(A, B) + dist(B, C)
    // 1. AIIMS(0) -> MDM(1) -> MGH(2)
    TEST_ASSERT(pair_distances[0][2] <= pair_distances[0][1] + pair_distances[1][2] + 1e-3,
                "Triangle inequality: AIIMS -> MGH <= AIIMS -> MDM -> MGH");
    // 2. Basni(3) -> Sojati(4) -> Paota(5)
    TEST_ASSERT(pair_distances[3][5] <= pair_distances[3][4] + pair_distances[4][5] + 1e-3,
                "Triangle inequality: Basni -> Paota <= Basni -> Sojati -> Paota");
    // 3. Sojati(4) -> AIIMS(0) -> MDM(1)
    TEST_ASSERT(pair_distances[4][1] <= pair_distances[4][0] + pair_distances[0][1] + 1e-3,
                "Triangle inequality: Sojati -> MDM <= Sojati -> AIIMS -> MDM");

    // Compute latency percentiles (min, avg, max, p50, p95)
    std::sort(latencies.begin(), latencies.end());
    double min_lat = latencies.front();
    double max_lat = latencies.back();
    double sum_lat = 0.0;
    for (double l : latencies) sum_lat += l;
    double avg_lat = sum_lat / latencies.size();
    double p50_lat = latencies[latencies.size() / 2];
    double p95_lat = latencies[static_cast<size_t>(latencies.size() * 0.95)];

    std::cout << "\nPerformance Benchmark over 30 Facility Pairs:\n"
              << "  Min Latency:  " << std::setprecision(2) << min_lat << " ms\n"
              << "  Avg Latency:  " << avg_lat << " ms\n"
              << "  p50 Latency:  " << p50_lat << " ms\n"
              << "  p95 Latency:  " << p95_lat << " ms\n"
              << "  Max Latency:  " << max_lat << " ms\n"
              << "  Total Visited Nodes: " << total_visited_nodes << " (Avg per query: " << (total_visited_nodes / 30) << ")\n"
              << "  Total Relaxed Edges: " << total_relaxed_edges << " (Avg per query: " << (total_relaxed_edges / 30) << ")\n";

    // Single-Source All-Destinations Benchmark (3 Iterations)
    std::cout << "\nBenchmarking Single-Source to All 59,334 Destinations (3 Iterations):\n";
    std::vector<double> ss_times;
    for (int iter = 1; iter <= 3; ++iter) {
        auto t0 = std::chrono::steady_clock::now();
        SingleSourceResult ss = router.ShortestPathToAllOsm(facilities[0].osm_id);
        auto t1 = std::chrono::steady_clock::now();
        double elapsed = std::chrono::duration<double, std::milli>(t1 - t0).count();
        ss_times.push_back(elapsed);
        std::cout << "  Iteration " << iter << ": " << elapsed << " ms ("
                  << ss.visited_nodes << " nodes visited, " << ss.relaxed_edges << " edges relaxed)\n";
    }
    double min_ss = *std::min_element(ss_times.begin(), ss_times.end());
    double max_ss = *std::max_element(ss_times.begin(), ss_times.end());
    double avg_ss = (ss_times[0] + ss_times[1] + ss_times[2]) / 3.0;
    std::cout << "  Single-Source All-Nodes: Min: " << min_ss << " ms | Avg: " << avg_ss << " ms | Max: " << max_ss << " ms\n";

    std::cout << "\nTestCanonicalJodhpurGraphFacilityRoutes: PASSED (All 30 facility routes & benchmarks certified)\n" << std::endl;
    return true;
}

// ============================================================================
// DEFENSIVE RECONSTRUCTION HARDENING TESTS (Phase 3.4 Final Corrections)
// ============================================================================

// 15. Malformed predecessor: broken from_idx (0xFFFFFFFF sentinel)
bool Test15_BrokenPredecessorFromIdx() {
    std::cout << "Running Test15_BrokenPredecessorFromIdx..." << std::endl;

    // Simple 2-node graph: 0 -> 1
    Graph g;
    g.AddNode(100, 26.0, 73.0);
    g.AddNode(200, 26.1, 73.1);
    g.AddEdge(0, 1, 50.0, 1, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // Build a corrupted predecessor array: pred[1] has invalid from_idx
    std::vector<Predecessor> bad_pred(2);
    bad_pred[0] = Predecessor{0xFFFFFFFF, 0xFFFFFFFF}; // source has no predecessor (correct)
    bad_pred[1] = Predecessor{0xFFFFFFFF, 0xFFFFFFFF}; // corrupted: should point to node 0

    RouteResult res = router.ReconstructPath(0, 1, 50.0, bad_pred, 2, 1, 0.0);

    // Expect failure: broken chain must not produce a successful partial route
    TEST_ASSERT(!res.found, "Broken from_idx must produce found=false");
    TEST_ASSERT(std::isinf(res.total_distance_meters), "Failed reconstruction must return infinite distance");
    TEST_ASSERT(res.path_internal_indices.empty(), "Failed reconstruction must have empty path");
    TEST_ASSERT(res.path_segments.empty(), "Failed reconstruction must have empty segments");
    TEST_ASSERT(res.path_osm_ids.empty(), "Failed reconstruction must have empty OSM id list");

    std::cout << "Test15_BrokenPredecessorFromIdx: PASSED\n" << std::endl;
    return true;
}

// 16. Malformed predecessor: edge_idx out of bounds
bool Test16_BrokenPredecessorEdgeIdx() {
    std::cout << "Running Test16_BrokenPredecessorEdgeIdx..." << std::endl;

    // 2-node graph: 0 -> 1 (1 outgoing edge from node 0)
    Graph g;
    g.AddNode(100, 26.0, 73.0);
    g.AddNode(200, 26.1, 73.1);
    g.AddEdge(0, 1, 50.0, 1, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // Corrupted predecessor: from_idx=0 is valid, but edge_idx=99 is out of bounds
    std::vector<Predecessor> bad_pred(2);
    bad_pred[1] = Predecessor{0, 99u}; // edge_idx 99 doesn't exist in adj_[0]

    RouteResult res = router.ReconstructPath(0, 1, 50.0, bad_pred, 2, 1, 0.0);

    TEST_ASSERT(!res.found, "Out-of-bounds edge_idx must produce found=false");
    TEST_ASSERT(std::isinf(res.total_distance_meters), "Failed reconstruction must return infinite distance");
    TEST_ASSERT(res.path_internal_indices.empty(), "Failed reconstruction must have empty path");
    TEST_ASSERT(res.path_segments.empty(), "Failed reconstruction must have empty segments");

    std::cout << "Test16_BrokenPredecessorEdgeIdx: PASSED\n" << std::endl;
    return true;
}

// 17. Legitimate path still reconstructs correctly after hardening
bool Test17_ValidPathUnaffectedByHardening() {
    std::cout << "Running Test17_ValidPathUnaffectedByHardening..." << std::endl;

    // Chain: 0 -> 1 -> 2 -> 3
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    g.AddNode(30, 26.2, 73.2);
    g.AddNode(40, 26.3, 73.3);
    g.AddEdge(0, 1, 100.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 200.0, 2, 0, 0, 0, true, {});
    g.AddEdge(2, 3, 300.0, 3, 0, 0, 0, true, {});

    DijkstraRouter router(g);
    RouteResult res = router.ShortestPath(0, 3);

    TEST_ASSERT(res.found, "Valid path must still be found after hardening");
    TEST_ASSERT(std::abs(res.total_distance_meters - 600.0) < 1e-6, "Distance must be 600.0m");
    TEST_ASSERT(res.path_internal_indices.size() == 4, "Path must have 4 nodes");
    TEST_ASSERT(res.path_internal_indices.front() == 0, "Path must start at node 0");
    TEST_ASSERT(res.path_internal_indices.back() == 3, "Path must end at node 3");
    TEST_ASSERT(res.path_segments.size() == 3, "Path must have 3 segments");
    TEST_ASSERT(VerifyPathIntegrity(g, res), "Path integrity must pass");

    std::cout << "Test17_ValidPathUnaffectedByHardening: PASSED\n" << std::endl;
    return true;
}

// ============================================================================
// PHASE 3.7 MULTI-TARGET DIJKSTRA TESTS (TESTS 18 - 30)
// ============================================================================

bool Test18_MultiTarget_EmptyTargetList() {
    std::cout << "Running Test18_MultiTarget_EmptyTargetList..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    g.AddEdge(0, 1, 100.0, 1, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // Empty target vector by internal index
    MultiTargetResult res = router.ShortestPathMultiTarget(0, {});
    TEST_ASSERT(res.targets.empty(), "Targets vector must be empty");
    TEST_ASSERT(res.unique_targets_requested == 0, "Unique requested must be 0");
    TEST_ASSERT(res.unique_targets_settled == 0, "Unique settled must be 0");
    TEST_ASSERT(res.all_targets_found == true, "Empty target list must have all_targets_found == true (vacuous success)");
    TEST_ASSERT(res.visited_nodes == 0, "Visited nodes must be 0");
    TEST_ASSERT(res.relaxed_edges == 0, "Relaxed edges must be 0");

    // Empty target vector by OSM ID
    MultiTargetResult res_osm = router.ShortestPathMultiTargetOsm(10, {});
    TEST_ASSERT(res_osm.targets.empty(), "Targets vector must be empty for OSM call");
    TEST_ASSERT(res_osm.all_targets_found == true, "Vacuous success must hold for OSM call");

    std::cout << "Test18_MultiTarget_EmptyTargetList: PASSED\n" << std::endl;
    return true;
}

bool Test19_MultiTarget_SingleTargetEquivalence() {
    std::cout << "Running Test19_MultiTarget_SingleTargetEquivalence..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    g.AddNode(30, 26.2, 73.2);
    g.AddNode(40, 26.3, 73.3);
    g.AddEdge(0, 1, 100.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 150.0, 2, 0, 0, 0, true, {});
    g.AddEdge(2, 3, 200.0, 3, 0, 0, 0, true, {});
    g.AddEdge(0, 2, 350.0, 4, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    RouteResult single_res = router.ShortestPath(0, 3);
    MultiTargetResult multi_res = router.ShortestPathMultiTarget(0, {3}, true);

    TEST_ASSERT(multi_res.targets.size() == 1, "Targets size must be 1");
    TEST_ASSERT(multi_res.targets[0].found == single_res.found, "Found flag must match");
    TEST_ASSERT(std::abs(multi_res.targets[0].total_distance_meters - single_res.total_distance_meters) < 1e-9,
                "Distance must match single-pair Dijkstra exactly");
    TEST_ASSERT(multi_res.targets[0].path_internal_indices == single_res.path_internal_indices,
                "Path internal indices must match");
    TEST_ASSERT(multi_res.targets[0].path_osm_ids == single_res.path_osm_ids,
                "Path OSM IDs must match");
    TEST_ASSERT(multi_res.targets[0].path_segments.size() == single_res.path_segments.size(),
                "Path segment count must match");
    TEST_ASSERT(multi_res.unique_targets_requested == 1, "Unique targets requested must be 1");
    TEST_ASSERT(multi_res.unique_targets_settled == 1, "Unique targets settled must be 1");
    TEST_ASSERT(multi_res.all_targets_found == true, "all_targets_found must be true");

    std::cout << "Test19_MultiTarget_SingleTargetEquivalence: PASSED\n" << std::endl;
    return true;
}

bool Test20_MultiTarget_CanonicalEmergencyFacilities() {
    std::cout << "Running Test20_MultiTarget_CanonicalEmergencyFacilities..." << std::endl;
    Graph graph;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);
    DijkstraRouter router(graph);

    int64_t aiims_osm = 8520698362;
    std::vector<int64_t> facility_targets = {
        5321319416, // MDM Hospital
        8499684813, // Mathura Das Mathur Hospital
        2694302020, // Basni
        2688566058, // Sojati Gate
        3773158752  // Paota Circle
    };

    MultiTargetResult multi_res = router.ShortestPathMultiTargetOsm(aiims_osm, facility_targets, true);

    TEST_ASSERT(multi_res.targets.size() == facility_targets.size(), "Target count must match");
    TEST_ASSERT(multi_res.unique_targets_requested == facility_targets.size(), "Unique requested count must match");
    TEST_ASSERT(multi_res.unique_targets_settled == facility_targets.size(), "Unique settled count must match");
    TEST_ASSERT(multi_res.all_targets_found == true, "All targets must be found");

    for (size_t i = 0; i < facility_targets.size(); ++i) {
        RouteResult single_res = router.ShortestPathOsm(aiims_osm, facility_targets[i]);
        TEST_ASSERT(single_res.found, "Single pair must find target");
        TEST_ASSERT(multi_res.targets[i].found, "Multi-target must find target");
        TEST_ASSERT(std::abs(multi_res.targets[i].total_distance_meters - single_res.total_distance_meters) < 1e-6,
                    "Multi-target distance must match single-pair within 1e-6m");
        TEST_ASSERT(multi_res.targets[i].destination_osm_id == facility_targets[i],
                    "Target destination OSM ID must match request");
        TEST_ASSERT(multi_res.targets[i].path_osm_ids == single_res.path_osm_ids,
                    "Reconstructed path OSM IDs must match single-pair exactly");
        TEST_ASSERT(multi_res.targets[i].path_segments.size() == single_res.path_segments.size(),
                    "Reconstructed path segment count must match");
    }

    std::cout << "Test20_MultiTarget_CanonicalEmergencyFacilities: PASSED\n" << std::endl;
    return true;
}

bool Test21_MultiTarget_EarlyTermination() {
    std::cout << "Running Test21_MultiTarget_EarlyTermination..." << std::endl;
    Graph graph;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);
    DijkstraRouter router(graph);

    uint32_t s_idx = 0;
    TEST_ASSERT(graph.TryGetInternalIndex(8520698362, s_idx), "AIIMS node must exist");

    // Pick 3 immediate neighbors (distance <= 500m)
    const auto& outgoing = graph.GetOutgoingEdges(s_idx);
    TEST_ASSERT(!outgoing.empty(), "Source must have outgoing edges");

    std::vector<uint32_t> nearby_targets;
    for (const auto& e : outgoing) {
        nearby_targets.push_back(e.target_idx);
        if (nearby_targets.size() >= 3) break;
    }
    // If fewer than 3 directly adjacent, expand by 1 hop
    if (nearby_targets.size() < 3) {
        for (uint32_t n1 : nearby_targets) {
            for (const auto& e : graph.GetOutgoingEdges(n1)) {
                if (e.target_idx != s_idx) {
                    nearby_targets.push_back(e.target_idx);
                    if (nearby_targets.size() >= 3) break;
                }
            }
            if (nearby_targets.size() >= 3) break;
        }
    }

    MultiTargetResult res_near = router.ShortestPathMultiTarget(s_idx, nearby_targets, false);
    TEST_ASSERT(res_near.all_targets_found, "All nearby targets must be found");

    // Compare with full single source
    SingleSourceResult ss_res = router.ShortestPathToAll(s_idx);

    std::cout << "  Nearby multi-target visited nodes: " << res_near.visited_nodes
              << " vs full SingleSource: " << ss_res.visited_nodes << std::endl;

    TEST_ASSERT(res_near.visited_nodes < 100, "Nearby search must terminate early with < 100 visited nodes");
    TEST_ASSERT(res_near.visited_nodes < ss_res.visited_nodes / 500,
                "Early termination must explore less than 0.2% of the graph");

    std::cout << "Test21_MultiTarget_EarlyTermination: PASSED\n" << std::endl;
    return true;
}

bool Test22_MultiTarget_DuplicateTargetsAndOrdering() {
    std::cout << "Running Test22_MultiTarget_DuplicateTargetsAndOrdering..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    g.AddNode(30, 26.2, 73.2);
    g.AddNode(40, 26.3, 73.3);
    g.AddEdge(0, 1, 100.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 200.0, 2, 0, 0, 0, true, {});
    g.AddEdge(2, 3, 300.0, 3, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // Target query with duplicates and non-trivial order: [3, 1, 3, 2, 1]
    std::vector<uint32_t> targets = {3, 1, 3, 2, 1};
    MultiTargetResult res = router.ShortestPathMultiTarget(0, targets, true);

    TEST_ASSERT(res.targets.size() == 5, "Result targets size must be 5");
    TEST_ASSERT(res.unique_targets_requested == 3, "Unique requested must be 3");
    TEST_ASSERT(res.unique_targets_settled == 3, "Unique settled must be 3");
    TEST_ASSERT(res.all_targets_found == true, "All targets must be found");

    // Check distances: 3->600, 1->100, 3->600, 2->300, 1->100
    TEST_ASSERT(std::abs(res.targets[0].total_distance_meters - 600.0) < 1e-6, "Target 0 dist 600m");
    TEST_ASSERT(std::abs(res.targets[1].total_distance_meters - 100.0) < 1e-6, "Target 1 dist 100m");
    TEST_ASSERT(std::abs(res.targets[2].total_distance_meters - 600.0) < 1e-6, "Target 2 dist 600m");
    TEST_ASSERT(std::abs(res.targets[3].total_distance_meters - 300.0) < 1e-6, "Target 3 dist 300m");
    TEST_ASSERT(std::abs(res.targets[4].total_distance_meters - 100.0) < 1e-6, "Target 4 dist 100m");

    // Check duplicate path identity
    TEST_ASSERT(res.targets[0].path_internal_indices == res.targets[2].path_internal_indices,
                "Duplicate slots 0 and 2 must have identical paths");
    TEST_ASSERT(res.targets[1].path_internal_indices == res.targets[4].path_internal_indices,
                "Duplicate slots 1 and 4 must have identical paths");

    std::cout << "Test22_MultiTarget_DuplicateTargetsAndOrdering: PASSED\n" << std::endl;
    return true;
}

bool Test23_MultiTarget_SourceAmongTargetsAndSelfLoop() {
    std::cout << "Running Test23_MultiTarget_SourceAmongTargetsAndSelfLoop..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    g.AddNode(30, 26.2, 73.2);
    g.AddEdge(0, 1, 150.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 250.0, 2, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // Scenario A: source is one of the targets [2, 0, 1]
    MultiTargetResult res_a = router.ShortestPathMultiTarget(0, {2, 0, 1}, true);
    TEST_ASSERT(res_a.all_targets_found, "All targets found in Scenario A");
    TEST_ASSERT(res_a.unique_targets_requested == 3, "3 unique requested");
    TEST_ASSERT(res_a.unique_targets_settled == 3, "3 unique settled");
    TEST_ASSERT(res_a.targets[1].found == true, "Source target found");
    TEST_ASSERT(res_a.targets[1].total_distance_meters == 0.0, "Source distance is 0.0");
    TEST_ASSERT(res_a.targets[1].path_internal_indices.size() == 1, "Source path has 1 node");
    TEST_ASSERT(res_a.targets[1].path_internal_indices[0] == 0, "Source path contains 0");

    // Scenario B: all targets equal source [0, 0, 0]
    MultiTargetResult res_b = router.ShortestPathMultiTarget(0, {0, 0, 0}, true);
    TEST_ASSERT(res_b.all_targets_found, "All targets found in Scenario B");
    TEST_ASSERT(res_b.unique_targets_requested == 1, "Unique requested is 1");
    TEST_ASSERT(res_b.unique_targets_settled == 1, "Unique settled is 1");
    TEST_ASSERT(res_b.visited_nodes == 1, "Visited nodes must be 1 for source-only query");
    TEST_ASSERT(res_b.relaxed_edges == 0, "Relaxed edges must be 0 for source-only early termination");
    for (int k = 0; k < 3; ++k) {
        TEST_ASSERT(res_b.targets[k].total_distance_meters == 0.0, "Self distance 0.0");
        TEST_ASSERT(res_b.targets[k].path_internal_indices.size() == 1, "Self path length 1");
    }

    std::cout << "Test23_MultiTarget_SourceAmongTargetsAndSelfLoop: PASSED\n" << std::endl;
    return true;
}

bool Test24_MultiTarget_UnreachableAndDisconnected() {
    std::cout << "Running Test24_MultiTarget_UnreachableAndDisconnected..." << std::endl;
    Graph g;
    // Component 1: 0 -> 1 -> 2
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    g.AddNode(30, 26.2, 73.2);
    g.AddEdge(0, 1, 100.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 100.0, 2, 0, 0, 0, true, {});

    // Component 2: 3 -> 4
    g.AddNode(40, 26.3, 73.3);
    g.AddNode(50, 26.4, 73.4);
    g.AddEdge(3, 4, 100.0, 3, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // Query targets: 1 (reachable), 3 (unreachable), 2 (reachable), 4 (unreachable)
    MultiTargetResult res = router.ShortestPathMultiTarget(0, {1, 3, 2, 4}, true);

    TEST_ASSERT(res.targets.size() == 4, "Result targets size 4");
    TEST_ASSERT(res.unique_targets_requested == 4, "4 unique requested");
    TEST_ASSERT(res.unique_targets_settled == 2, "Only 2 unique settled");
    TEST_ASSERT(res.all_targets_found == false, "all_targets_found must be false when some unreachable");

    // Target 1: reachable
    TEST_ASSERT(res.targets[0].found == true, "Target 1 found");
    TEST_ASSERT(std::abs(res.targets[0].total_distance_meters - 100.0) < 1e-6, "Target 1 dist 100m");
    // Target 3: unreachable
    TEST_ASSERT(res.targets[1].found == false, "Target 3 not found");
    TEST_ASSERT(std::isinf(res.targets[1].total_distance_meters), "Target 3 dist is inf");
    TEST_ASSERT(res.targets[1].path_internal_indices.empty(), "Target 3 path empty");
    // Target 2: reachable
    TEST_ASSERT(res.targets[2].found == true, "Target 2 found");
    TEST_ASSERT(std::abs(res.targets[2].total_distance_meters - 200.0) < 1e-6, "Target 2 dist 200m");
    // Target 4: unreachable
    TEST_ASSERT(res.targets[3].found == false, "Target 4 not found");
    TEST_ASSERT(std::isinf(res.targets[3].total_distance_meters), "Target 4 dist is inf");

    std::cout << "Test24_MultiTarget_UnreachableAndDisconnected: PASSED\n" << std::endl;
    return true;
}

bool Test25_MultiTarget_InvalidTargetOsmIdsAndSourceGuard() {
    std::cout << "Running Test25_MultiTarget_InvalidTargetOsmIdsAndSourceGuard..." << std::endl;
    Graph g;
    g.AddNode(100, 26.0, 73.0);
    g.AddNode(200, 26.1, 73.1);
    g.AddNode(300, 26.2, 73.2);
    g.AddEdge(0, 1, 50.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 70.0, 2, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // Guard: invalid source throws
    EXPECT_THROW(router.ShortestPathMultiTarget(99, {1, 2}), std::out_of_range, "out of range internal source");
    EXPECT_THROW(router.ShortestPathMultiTargetOsm(99999, {200}), std::out_of_range, "non-existent OSM source");

    // Targets containing invalid OSM IDs and duplicates of invalid IDs
    std::vector<int64_t> test_targets = {200, -9999, 300, -9999, 88888};
    MultiTargetResult res = router.ShortestPathMultiTargetOsm(100, test_targets, true);

    TEST_ASSERT(res.targets.size() == 5, "Size 5");
    TEST_ASSERT(res.all_targets_found == false, "all_targets_found false with invalid targets");
    TEST_ASSERT(res.unique_targets_requested == 2, "Only 2 valid unique targets requested");
    TEST_ASSERT(res.unique_targets_settled == 2, "Both valid targets settled");

    // Slot 0 (200): valid
    TEST_ASSERT(res.targets[0].found == true, "Target 200 found");
    TEST_ASSERT(res.targets[0].destination_osm_id == 200, "OSM ID preserved");
    TEST_ASSERT(std::abs(res.targets[0].total_distance_meters - 50.0) < 1e-6, "Dist 50m");

    // Slot 1 (-9999): invalid
    TEST_ASSERT(res.targets[1].found == false, "Target -9999 not found");
    TEST_ASSERT(res.targets[1].destination_osm_id == -9999, "Invalid OSM ID preserved");
    TEST_ASSERT(std::isinf(res.targets[1].total_distance_meters), "Dist is inf");

    // Slot 2 (300): valid
    TEST_ASSERT(res.targets[2].found == true, "Target 300 found");
    TEST_ASSERT(std::abs(res.targets[2].total_distance_meters - 120.0) < 1e-6, "Dist 120m");

    // Slot 3 (-9999): duplicate invalid
    TEST_ASSERT(res.targets[3].found == false, "Duplicate -9999 not found");
    TEST_ASSERT(res.targets[3].destination_osm_id == -9999, "Invalid OSM ID preserved");

    // Slot 4 (88888): invalid
    TEST_ASSERT(res.targets[4].found == false, "Target 88888 not found");
    TEST_ASSERT(res.targets[4].destination_osm_id == 88888, "Invalid OSM ID preserved");

    std::cout << "Test25_MultiTarget_InvalidTargetOsmIdsAndSourceGuard: PASSED\n" << std::endl;
    return true;
}

bool Test26_MultiTarget_PathReconstructionToggle() {
    std::cout << "Running Test26_MultiTarget_PathReconstructionToggle..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    g.AddNode(30, 26.2, 73.2);
    g.AddEdge(0, 1, 100.0, 1, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 200.0, 2, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // reconstruct_paths = false
    MultiTargetResult res_no_rec = router.ShortestPathMultiTarget(0, {1, 2}, false);
    TEST_ASSERT(res_no_rec.all_targets_found, "All targets found");
    TEST_ASSERT(res_no_rec.targets[0].found, "Target 1 found");
    TEST_ASSERT(std::abs(res_no_rec.targets[0].total_distance_meters - 100.0) < 1e-6, "Target 1 dist 100m");
    TEST_ASSERT(res_no_rec.targets[0].path_internal_indices.empty(), "Path internal indices must be empty");
    TEST_ASSERT(res_no_rec.targets[0].path_osm_ids.empty(), "Path OSM IDs must be empty");
    TEST_ASSERT(res_no_rec.targets[0].path_segments.empty(), "Path segments must be empty");
    TEST_ASSERT(res_no_rec.targets[0].path_reconstruction_time_ms == 0.0, "Recon time must be 0.0");

    // reconstruct_paths = true
    MultiTargetResult res_with_rec = router.ShortestPathMultiTarget(0, {1, 2}, true);
    TEST_ASSERT(res_with_rec.targets[0].found, "Target 1 found");
    TEST_ASSERT(std::abs(res_with_rec.targets[0].total_distance_meters - 100.0) < 1e-6, "Target 1 dist 100m");
    TEST_ASSERT(!res_with_rec.targets[0].path_internal_indices.empty(), "Path internal indices non-empty");
    TEST_ASSERT(!res_with_rec.targets[0].path_segments.empty(), "Path segments non-empty");

    std::cout << "Test26_MultiTarget_PathReconstructionToggle: PASSED\n" << std::endl;
    return true;
}

bool Test27_MultiTarget_PathTrajectoryIntegrity() {
    std::cout << "Running Test27_MultiTarget_PathTrajectoryIntegrity..." << std::endl;
    Graph graph;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);
    DijkstraRouter router(graph);

    int64_t aiims_osm = 8520698362;
    std::vector<int64_t> targets = {
        5321319416, 8499684813, 2694302020, 2688566058, 3773158752
    };

    MultiTargetResult res = router.ShortestPathMultiTargetOsm(aiims_osm, targets, true);
    TEST_ASSERT(res.all_targets_found, "All canonical targets must be found");

    for (size_t i = 0; i < res.targets.size(); ++i) {
        const auto& t = res.targets[i];
        RouteResult fake_res;
        fake_res.found = t.found;
        fake_res.source_internal_idx = res.source_internal_idx;
        fake_res.destination_internal_idx = t.destination_internal_idx;
        fake_res.source_osm_id = res.source_osm_id;
        fake_res.destination_osm_id = t.destination_osm_id;
        fake_res.total_distance_meters = t.total_distance_meters;
        fake_res.path_internal_indices = t.path_internal_indices;
        fake_res.path_osm_ids = t.path_osm_ids;
        fake_res.path_segments = t.path_segments;

        TEST_ASSERT(VerifyPathIntegrity(graph, fake_res), "Path integrity must pass for each multi-target route");
    }

    std::cout << "Test27_MultiTarget_PathTrajectoryIntegrity: PASSED\n" << std::endl;
    return true;
}

bool Test28_MultiTarget_ParallelEdgesAndEqualDistances() {
    std::cout << "Running Test28_MultiTarget_ParallelEdgesAndEqualDistances..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0); // 0
    g.AddNode(20, 26.1, 73.1); // 1
    g.AddNode(30, 26.2, 73.2); // 2
    g.AddNode(40, 26.3, 73.3); // 3

    // Parallel edges between 0 and 1: 150m and 100m
    g.AddEdge(0, 1, 150.0, 1, 0, 0, 0, true, {});
    g.AddEdge(0, 1, 100.0, 2, 0, 0, 0, true, {});

    // Edges from 1 to 2 and 3 with equal distances (each 50m)
    g.AddEdge(1, 2, 50.0, 3, 0, 0, 0, true, {});
    g.AddEdge(1, 3, 50.0, 4, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    // Multi-target to 1, 2, 3
    MultiTargetResult res = router.ShortestPathMultiTarget(0, {1, 2, 3}, true);
    TEST_ASSERT(res.all_targets_found, "All targets found");
    TEST_ASSERT(std::abs(res.targets[0].total_distance_meters - 100.0) < 1e-6, "Must pick shorter parallel edge (100m)");
    TEST_ASSERT(std::abs(res.targets[1].total_distance_meters - 150.0) < 1e-6, "Target 2 distance 150m");
    TEST_ASSERT(std::abs(res.targets[2].total_distance_meters - 150.0) < 1e-6, "Target 3 distance 150m");

    std::cout << "Test28_MultiTarget_ParallelEdgesAndEqualDistances: PASSED\n" << std::endl;
    return true;
}

bool Test29_MultiTarget_StaleQueueEntries() {
    std::cout << "Running Test29_MultiTarget_StaleQueueEntries..." << std::endl;
    Graph g;
    g.AddNode(10, 26.0, 73.0); // 0
    g.AddNode(20, 26.1, 73.1); // 1
    g.AddNode(30, 26.2, 73.2); // 2
    g.AddNode(40, 26.3, 73.3); // 3

    // Long direct edge 0 -> 2 (300m)
    g.AddEdge(0, 2, 300.0, 1, 0, 0, 0, true, {});
    // Short path 0 -> 1 -> 2 (50m + 50m = 100m)
    g.AddEdge(0, 1, 50.0, 2, 0, 0, 0, true, {});
    g.AddEdge(1, 2, 50.0, 3, 0, 0, 0, true, {});
    // Edge from 2 to 3
    g.AddEdge(2, 3, 40.0, 4, 0, 0, 0, true, {});

    DijkstraRouter router(g);

    MultiTargetResult res = router.ShortestPathMultiTarget(0, {2, 3}, true);
    TEST_ASSERT(res.all_targets_found, "All targets found");
    TEST_ASSERT(std::abs(res.targets[0].total_distance_meters - 100.0) < 1e-6, "Target 2 distance 100m");
    TEST_ASSERT(std::abs(res.targets[1].total_distance_meters - 140.0) < 1e-6, "Target 3 distance 140m");
    TEST_ASSERT(res.targets[0].path_internal_indices.size() == 3, "Path to 2 has 3 nodes [0, 1, 2]");

    std::cout << "Test29_MultiTarget_StaleQueueEntries: PASSED\n" << std::endl;
    return true;
}

bool Test30_MultiTarget_FiftyRandomTargets() {
    std::cout << "Running Test30_MultiTarget_FiftyRandomTargets..." << std::endl;
    Graph graph;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);
    DijkstraRouter router(graph);

    uint32_t s_idx = 0;
    TEST_ASSERT(graph.TryGetInternalIndex(8520698362, s_idx), "AIIMS node must exist");

    SingleSourceResult ss = router.ShortestPathToAll(s_idx);

    // Collect reachable nodes
    std::vector<uint32_t> reachable;
    for (uint32_t i = 0; i < graph.NodeCount(); ++i) {
        if (ss.IsReachable(i) && i != s_idx) {
            reachable.push_back(i);
        }
    }
    TEST_ASSERT(reachable.size() >= 50, "At least 50 reachable nodes required");

    // Select 50 deterministic targets using fixed stride
    std::vector<uint32_t> targets_50;
    targets_50.reserve(50);
    size_t stride = reachable.size() / 50;
    for (size_t k = 0; k < 50; ++k) {
        targets_50.push_back(reachable[k * stride]);
    }

    MultiTargetResult mt_res = router.ShortestPathMultiTarget(s_idx, targets_50, true);

    TEST_ASSERT(mt_res.targets.size() == 50, "50 targets returned");
    TEST_ASSERT(mt_res.unique_targets_requested == 50, "50 unique targets requested");
    TEST_ASSERT(mt_res.unique_targets_settled == 50, "50 unique targets settled");
    TEST_ASSERT(mt_res.all_targets_found, "All 50 targets found");

    for (size_t k = 0; k < 50; ++k) {
        uint32_t target_idx = targets_50[k];
        double expected_dist = ss.GetDistance(target_idx);
        double actual_dist = mt_res.targets[k].total_distance_meters;
        TEST_ASSERT(std::abs(actual_dist - expected_dist) < 1e-6,
                    "Multi-target distance must match SingleSource distance for target " + std::to_string(k));
        TEST_ASSERT(mt_res.targets[k].found, "Target must be marked found");
        TEST_ASSERT(!mt_res.targets[k].path_internal_indices.empty(), "Path must be reconstructed");
    }

    std::cout << "Test30_MultiTarget_FiftyRandomTargets: PASSED (all 50 distances match SingleSource)\n" << std::endl;
    return true;
}

bool RunMultiTargetBenchmarks() {
    std::cout << "\n====================================================================\n"
              << "  PHASE 3.7 MULTI-TARGET DIJKSTRA BENCHMARK SUITE (30 ITERATIONS)\n"
              << "====================================================================\n" << std::endl;

    Graph graph;
    std::cout << "Loading canonical graph dataset for benchmarking..." << std::endl;
    DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);
    DijkstraRouter router(graph);

    uint32_t s_idx = 0;
    TEST_ASSERT(graph.TryGetInternalIndex(8520698362, s_idx), "AIIMS node must exist");

    SingleSourceResult ss = router.ShortestPathToAll(s_idx);
    std::vector<uint32_t> reachable;
    for (uint32_t i = 0; i < graph.NodeCount(); ++i) {
        if (ss.IsReachable(i) && i != s_idx) {
            reachable.push_back(i);
        }
    }

    std::vector<size_t> k_scenarios = {2, 6, 15, 25, 50};

    std::cout << std::fixed << std::setprecision(3);
    std::cout << "| Scenario (K) | Method | Avg Latency (ms) | Median (ms) | p95 (ms) | Visited Nodes | Relaxed Edges | Speedup vs 1-to-1 | Speedup vs All |\n";
    std::cout << "|---|---|---|---|---|---|---|---|---|\n";

    const int WARMUP_ROUNDS = 5;
    const int MEASURE_ROUNDS = 30;

    for (size_t K : k_scenarios) {
        std::vector<uint32_t> targets;
        targets.reserve(K);
        size_t stride = reachable.size() / K;
        for (size_t i = 0; i < K; ++i) {
            targets.push_back(reachable[i * stride]);
        }

        // Method 1: Repeated 1-to-1 ShortestPath
        for (int w = 0; w < WARMUP_ROUNDS; ++w) {
            for (uint32_t t : targets) {
                volatile auto r = router.ShortestPath(s_idx, t);
                (void)r;
            }
        }
        std::vector<double> latencies_1to1;
        latencies_1to1.reserve(MEASURE_ROUNDS);
        size_t nodes_1to1 = 0;
        size_t edges_1to1 = 0;

        for (int m = 0; m < MEASURE_ROUNDS; ++m) {
            auto t1 = std::chrono::steady_clock::now();
            size_t n_acc = 0, e_acc = 0;
            for (uint32_t t : targets) {
                RouteResult r = router.ShortestPath(s_idx, t);
                n_acc += r.visited_nodes;
                e_acc += r.relaxed_edges;
            }
            auto t2 = std::chrono::steady_clock::now();
            latencies_1to1.push_back(std::chrono::duration<double, std::milli>(t2 - t1).count());
            if (m == 0) { nodes_1to1 = n_acc; edges_1to1 = e_acc; }
        }

        // Method 2: ShortestPathToAll
        for (int w = 0; w < WARMUP_ROUNDS; ++w) {
            volatile auto r = router.ShortestPathToAll(s_idx);
            (void)r;
        }
        std::vector<double> latencies_all;
        latencies_all.reserve(MEASURE_ROUNDS);
        size_t nodes_all = 0, edges_all = 0;

        for (int m = 0; m < MEASURE_ROUNDS; ++m) {
            auto t1 = std::chrono::steady_clock::now();
            SingleSourceResult r = router.ShortestPathToAll(s_idx);
            auto t2 = std::chrono::steady_clock::now();
            latencies_all.push_back(std::chrono::duration<double, std::milli>(t2 - t1).count());
            if (m == 0) { nodes_all = r.visited_nodes; edges_all = r.relaxed_edges; }
        }

        // Method 3: ShortestPathMultiTarget
        for (int w = 0; w < WARMUP_ROUNDS; ++w) {
            volatile auto r = router.ShortestPathMultiTarget(s_idx, targets, true);
            (void)r;
        }
        std::vector<double> latencies_mt;
        latencies_mt.reserve(MEASURE_ROUNDS);
        size_t nodes_mt = 0, edges_mt = 0;

        for (int m = 0; m < MEASURE_ROUNDS; ++m) {
            auto t1 = std::chrono::steady_clock::now();
            MultiTargetResult r = router.ShortestPathMultiTarget(s_idx, targets, true);
            auto t2 = std::chrono::steady_clock::now();
            latencies_mt.push_back(std::chrono::duration<double, std::milli>(t2 - t1).count());
            if (m == 0) { nodes_mt = r.visited_nodes; edges_mt = r.relaxed_edges; }
        }

        // Compute metrics
        auto compute_stats = [](std::vector<double>& v) {
            std::sort(v.begin(), v.end());
            double sum = std::accumulate(v.begin(), v.end(), 0.0);
            double avg = sum / v.size();
            double med = v[v.size() / 2];
            size_t p95_idx = static_cast<size_t>(v.size() * 0.95);
            if (p95_idx >= v.size()) p95_idx = v.size() - 1;
            double p95 = v[p95_idx];
            return std::make_tuple(avg, med, p95);
        };

        auto [avg_1to1, med_1to1, p95_1to1] = compute_stats(latencies_1to1);
        auto [avg_all, med_all, p95_all] = compute_stats(latencies_all);
        auto [avg_mt, med_mt, p95_mt] = compute_stats(latencies_mt);

        double speedup_vs_1to1 = avg_1to1 / avg_mt;
        double speedup_vs_all = avg_all / avg_mt;

        std::cout << "| K = " << std::setw(2) << K << " | Repeated 1-to-1 | "
                  << std::setw(16) << avg_1to1 << " | "
                  << std::setw(11) << med_1to1 << " | "
                  << std::setw(8) << p95_1to1 << " | "
                  << std::setw(13) << nodes_1to1 << " | "
                  << std::setw(13) << edges_1to1 << " | 1.000x | "
                  << std::setw(12) << (avg_all / avg_1to1) << "x |\n";

        std::cout << "| K = " << std::setw(2) << K << " | ShortestPathToAll | "
                  << std::setw(16) << avg_all << " | "
                  << std::setw(11) << med_all << " | "
                  << std::setw(8) << p95_all << " | "
                  << std::setw(13) << nodes_all << " | "
                  << std::setw(13) << edges_all << " | "
                  << std::setw(15) << (avg_1to1 / avg_all) << "x | 1.000x |\n";

        std::cout << "| K = " << std::setw(2) << K << " | **Multi-Target** | **"
                  << std::setw(14) << avg_mt << "** | **"
                  << std::setw(9) << med_mt << "** | **"
                  << std::setw(6) << p95_mt << "** | "
                  << std::setw(13) << nodes_mt << " | "
                  << std::setw(13) << edges_mt << " | **"
                  << std::setw(13) << speedup_vs_1to1 << "x** | **"
                  << std::setw(10) << speedup_vs_all << "x** |\n";
    }

    std::cout << "\nBenchmark complete.\n" << std::endl;
    return true;
}

int main() {
    std::cout << "====================================================\n"
              << "  PHASE 3.4 & 3.7 DIJKSTRA SHORTEST-PATH TEST SUITE\n"
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

    // Objective E Synthetic Tests
    run_test(Test1_BasicShortestPath, "Test1_BasicShortestPath");
    run_test(Test2_MultiplePathsSelectMinWeight, "Test2_MultiplePathsSelectMinWeight");
    run_test(Test3_DirectVsShorterMultiEdge, "Test3_DirectVsShorterMultiEdge");
    run_test(Test4_DirectedOneWayRoute, "Test4_DirectedOneWayRoute");
    run_test(Test5_ReverseDirectionUnreachable, "Test5_ReverseDirectionUnreachable");
    run_test(Test6_DisconnectedDestination, "Test6_DisconnectedDestination");
    run_test(Test7_SourceEqualsDestination, "Test7_SourceEqualsDestination");
    run_test(Test8_InvalidSourceOsmId, "Test8_InvalidSourceOsmId");
    run_test(Test9_InvalidDestinationOsmId, "Test9_InvalidDestinationOsmId");
    run_test(Test10_EqualCostAlternativePaths, "Test10_EqualCostAlternativePaths");
    run_test(Test11_LargeEdgeWeights, "Test11_LargeEdgeWeights");
    run_test(Test12_FloatingPointPrecisionDistances, "Test12_FloatingPointPrecisionDistances");
    run_test(Test13_PathReconstructionCorrectness, "Test13_PathReconstructionCorrectness");
    run_test(Test14_SingleSourceVsSinglePair, "Test14_SingleSourceVsSinglePair");

    // Canonical Jodhpur Facility Tests & Benchmark
    run_test(TestCanonicalJodhpurGraphFacilityRoutes, "TestCanonicalJodhpurGraphFacilityRoutes");

    // Phase 3.4 Final Corrections: Defensive Reconstruction Hardening Tests
    run_test(Test15_BrokenPredecessorFromIdx, "Test15_BrokenPredecessorFromIdx");
    run_test(Test16_BrokenPredecessorEdgeIdx, "Test16_BrokenPredecessorEdgeIdx");
    run_test(Test17_ValidPathUnaffectedByHardening, "Test17_ValidPathUnaffectedByHardening");

    // Phase 3.7 Multi-Target Dijkstra Tests
    run_test(Test18_MultiTarget_EmptyTargetList, "Test18_MultiTarget_EmptyTargetList");
    run_test(Test19_MultiTarget_SingleTargetEquivalence, "Test19_MultiTarget_SingleTargetEquivalence");
    run_test(Test20_MultiTarget_CanonicalEmergencyFacilities, "Test20_MultiTarget_CanonicalEmergencyFacilities");
    run_test(Test21_MultiTarget_EarlyTermination, "Test21_MultiTarget_EarlyTermination");
    run_test(Test22_MultiTarget_DuplicateTargetsAndOrdering, "Test22_MultiTarget_DuplicateTargetsAndOrdering");
    run_test(Test23_MultiTarget_SourceAmongTargetsAndSelfLoop, "Test23_MultiTarget_SourceAmongTargetsAndSelfLoop");
    run_test(Test24_MultiTarget_UnreachableAndDisconnected, "Test24_MultiTarget_UnreachableAndDisconnected");
    run_test(Test25_MultiTarget_InvalidTargetOsmIdsAndSourceGuard, "Test25_MultiTarget_InvalidTargetOsmIdsAndSourceGuard");
    run_test(Test26_MultiTarget_PathReconstructionToggle, "Test26_MultiTarget_PathReconstructionToggle");
    run_test(Test27_MultiTarget_PathTrajectoryIntegrity, "Test27_MultiTarget_PathTrajectoryIntegrity");
    run_test(Test28_MultiTarget_ParallelEdgesAndEqualDistances, "Test28_MultiTarget_ParallelEdgesAndEqualDistances");
    run_test(Test29_MultiTarget_StaleQueueEntries, "Test29_MultiTarget_StaleQueueEntries");
    run_test(Test30_MultiTarget_FiftyRandomTargets, "Test30_MultiTarget_FiftyRandomTargets");

    // Phase 3.7 Multi-Target Benchmarks
    run_test(RunMultiTargetBenchmarks, "RunMultiTargetBenchmarks");

    std::cout << "====================================================\n"
              << "  TEST RESULTS SUMMARY\n"
              << "  Passed: " << passed << " / " << (passed + failed) << "\n"
              << "  Failed: " << failed << "\n"
              << "====================================================" << std::endl;

    return (failed == 0) ? 0 : 1;
}
