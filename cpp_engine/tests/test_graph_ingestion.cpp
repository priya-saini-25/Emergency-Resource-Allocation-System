#include "Graph.hpp"
#include "DataLoader.hpp"
#include "GraphIntegrity.hpp"
#include <iostream>
#include <cassert>
#include <cmath>
#include <limits>
#include <string>

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

// ============================================================================
// PHASE 3.2 TESTS (PRESERVED)
// ============================================================================

// 1. Synthetic Directed Graph Ingestion
bool TestSyntheticDirectedGraph() {
    std::cout << "Running TestSyntheticDirectedGraph..." << std::endl;

    std::string json_data = R"({
        "metadata": {
            "city": "Jodhpur_Test",
            "source": "Synthetic"
        },
        "nodes": [
            {"id": 101, "latitude": 26.2800, "longitude": 73.0200, "is_boundary_node": false},
            {"id": 102, "latitude": 26.2810, "longitude": 73.0210, "is_boundary_node": false},
            {"id": 103, "latitude": 26.2820, "longitude": 73.0220, "is_boundary_node": false},
            {"id": 104, "latitude": 26.2830, "longitude": 73.0230, "is_boundary_node": true}
        ],
        "edges": [
            {
                "from": 101, "to": 102, "road_id": 5001,
                "name": "Station Road", "road_type": "primary",
                "distance_meters": 150.5, "oneway": true, "access": "yes",
                "geometry": [[73.0200, 26.2800], [73.0210, 26.2810]]
            },
            {
                "from": 102, "to": 103, "road_id": 5002,
                "name": "High Street", "road_type": "secondary",
                "distance_meters": 220.0, "oneway": false, "access": "permissive",
                "geometry": [[73.0210, 26.2810], [73.0220, 26.2820]]
            },
            {
                "from": 103, "to": 102, "road_id": 5002,
                "name": "High Street", "road_type": "secondary",
                "distance_meters": 220.0, "oneway": false, "access": "permissive",
                "geometry": [[73.0220, 26.2820], [73.0210, 26.2810]]
            },
            {
                "from": 103, "to": 104, "road_id": 5003,
                "name": "Hospital Lane", "road_type": "service",
                "distance_meters": 85.25, "oneway": true, "access": "yes",
                "geometry": [[73.0220, 26.2820], [73.0230, 26.2830]]
            }
        ]
    })";

    Graph graph;
    LoadStatistics stats = DataLoader::LoadFromJsonString(json_data, graph);

    TEST_ASSERT(stats.nodes_loaded == 4, "Stats should report 4 nodes");
    TEST_ASSERT(stats.edges_loaded == 4, "Stats should report 4 edges");
    TEST_ASSERT(graph.NodeCount() == 4, "Graph NodeCount should be 4");
    TEST_ASSERT(graph.EdgeCount() == 4, "Graph EdgeCount should be 4");

    // Test OSM ID recovery
    TEST_ASSERT(graph.HasNode(101), "Graph must contain node 101");
    TEST_ASSERT(graph.HasNode(102), "Graph must contain node 102");
    TEST_ASSERT(graph.HasNode(103), "Graph must contain node 103");
    TEST_ASSERT(graph.HasNode(104), "Graph must contain node 104");
    TEST_ASSERT(!graph.HasNode(999), "Graph must not contain node 999");

    uint32_t idx101 = graph.GetInternalIndex(101);
    uint32_t idx102 = graph.GetInternalIndex(102);
    uint32_t idx103 = graph.GetInternalIndex(103);
    uint32_t idx104 = graph.GetInternalIndex(104);

    TEST_ASSERT(graph.GetOsmId(idx101) == 101, "OSM ID 101 recovery failed");
    TEST_ASSERT(graph.GetOsmId(idx102) == 102, "OSM ID 102 recovery failed");
    TEST_ASSERT(graph.GetOsmId(idx103) == 103, "OSM ID 103 recovery failed");
    TEST_ASSERT(graph.GetOsmId(idx104) == 104, "OSM ID 104 recovery failed");

    // Test Boundary flag
    TEST_ASSERT(!graph.GetNode(idx101).is_boundary, "Node 101 is not boundary");
    TEST_ASSERT(graph.GetNode(idx104).is_boundary, "Node 104 is boundary");

    // Test Edge directionality & Outgoing lists
    const auto& edges101 = graph.GetOutgoingEdges(idx101);
    TEST_ASSERT(edges101.size() == 1, "Node 101 should have exactly 1 outgoing edge");
    TEST_ASSERT(edges101[0].target_idx == idx102, "101 outgoing edge must target 102");
    TEST_ASSERT(std::abs(edges101[0].distance_meters - 150.5) < 1e-6, "Distance must be 150.5m");
    TEST_ASSERT(edges101[0].oneway == true, "101->102 is oneway");
    TEST_ASSERT(graph.GetRoadName(edges101[0].name_id) == "Station Road", "Name must be Station Road");

    const auto& edges102 = graph.GetOutgoingEdges(idx102);
    TEST_ASSERT(edges102.size() == 1, "Node 102 should have 1 outgoing edge to 103");
    TEST_ASSERT(edges102[0].target_idx == idx103, "102 outgoing edge must target 103");
    TEST_ASSERT(std::abs(edges102[0].distance_meters - 220.0) < 1e-6, "Distance must be 220.0m");

    const auto& edges103 = graph.GetOutgoingEdges(idx103);
    TEST_ASSERT(edges103.size() == 2, "Node 103 should have 2 outgoing edges (to 102 and 104)");

    const auto& edges104 = graph.GetOutgoingEdges(idx104);
    TEST_ASSERT(edges104.empty(), "Node 104 should have 0 outgoing edges");

    // Test geometry preservation
    auto geom101 = graph.GetEdgeGeometry(edges101[0]);
    TEST_ASSERT(geom101.size() == 2, "Geometry points should be 2");
    TEST_ASSERT(std::abs(geom101[0].latitude - 26.2800) < 1e-5, "Geom point 0 lat match");
    TEST_ASSERT(std::abs(geom101[0].longitude - 73.0200) < 1e-5, "Geom point 0 lon match");

    std::cout << "TestSyntheticDirectedGraph: PASSED\n" << std::endl;
    return true;
}

// 2. Duplicate Node Rejection
bool TestDuplicateNodeRejection() {
    std::cout << "Running TestDuplicateNodeRejection..." << std::endl;

    std::string json_data = R"({
        "nodes": [
            {"id": 201, "latitude": 26.28, "longitude": 73.02},
            {"id": 201, "latitude": 26.29, "longitude": 73.03}
        ],
        "edges": []
    })";

    Graph graph;
    EXPECT_THROW(DataLoader::LoadFromJsonString(json_data, graph), std::invalid_argument, "Duplicate Node ID");

    std::cout << "TestDuplicateNodeRejection: PASSED\n" << std::endl;
    return true;
}

// 3. Missing Source Node Rejection
bool TestMissingSourceNodeRejection() {
    std::cout << "Running TestMissingSourceNodeRejection..." << std::endl;

    std::string json_data = R"({
        "nodes": [
            {"id": 301, "latitude": 26.28, "longitude": 73.02}
        ],
        "edges": [
            {"from": 9999, "to": 301, "distance_meters": 100.0}
        ]
    })";

    Graph graph;
    EXPECT_THROW(DataLoader::LoadFromJsonString(json_data, graph), std::runtime_error, "Missing Source Node");

    std::cout << "TestMissingSourceNodeRejection: PASSED\n" << std::endl;
    return true;
}

// 4. Missing Destination Node Rejection
bool TestMissingDestinationNodeRejection() {
    std::cout << "Running TestMissingDestinationNodeRejection..." << std::endl;

    std::string json_data = R"({
        "nodes": [
            {"id": 401, "latitude": 26.28, "longitude": 73.02}
        ],
        "edges": [
            {"from": 401, "to": 9999, "distance_meters": 100.0}
        ]
    })";

    Graph graph;
    EXPECT_THROW(DataLoader::LoadFromJsonString(json_data, graph), std::runtime_error, "Missing Target Node");

    std::cout << "TestMissingDestinationNodeRejection: PASSED\n" << std::endl;
    return true;
}

// 5. Invalid Zero Weight Rejection
bool TestInvalidZeroWeightRejection() {
    std::cout << "Running TestInvalidZeroWeightRejection..." << std::endl;

    std::string json_data = R"({
        "nodes": [
            {"id": 501, "latitude": 26.28, "longitude": 73.02},
            {"id": 502, "latitude": 26.29, "longitude": 73.03}
        ],
        "edges": [
            {"from": 501, "to": 502, "distance_meters": 0.0}
        ]
    })";

    Graph graph;
    EXPECT_THROW(DataLoader::LoadFromJsonString(json_data, graph), std::invalid_argument, "Zero Edge Weight");

    std::cout << "TestInvalidZeroWeightRejection: PASSED\n" << std::endl;
    return true;
}

// 6. Invalid Negative Weight Rejection
bool TestInvalidNegativeWeightRejection() {
    std::cout << "Running TestInvalidNegativeWeightRejection..." << std::endl;

    std::string json_data = R"({
        "nodes": [
            {"id": 601, "latitude": 26.28, "longitude": 73.02},
            {"id": 602, "latitude": 26.29, "longitude": 73.03}
        ],
        "edges": [
            {"from": 601, "to": 602, "distance_meters": -50.25}
        ]
    })";

    Graph graph;
    EXPECT_THROW(DataLoader::LoadFromJsonString(json_data, graph), std::invalid_argument, "Negative Edge Weight");

    std::cout << "TestInvalidNegativeWeightRejection: PASSED\n" << std::endl;
    return true;
}

// 7. Missing File Handling
bool TestMissingFileHandling() {
    std::cout << "Running TestMissingFileHandling..." << std::endl;

    Graph graph;
    EXPECT_THROW(DataLoader::LoadFromJsonFile("non_existent_file_xyz123.json", graph), std::runtime_error, "Non-existent file");

    std::cout << "TestMissingFileHandling: PASSED\n" << std::endl;
    return true;
}

// 8. Malformed JSON Syntax Handling
bool TestMalformedJsonHandling() {
    std::cout << "Running TestMalformedJsonHandling..." << std::endl;

    std::string bad_json = "{ nodes: [ this is not valid json }";
    Graph graph;
    EXPECT_THROW(DataLoader::LoadFromJsonString(bad_json, graph), std::runtime_error, "Malformed JSON syntax");

    std::cout << "TestMalformedJsonHandling: PASSED\n" << std::endl;
    return true;
}

// 9. Full Authentic Jodhpur Road Network Ingestion
bool TestFullJodhpurGraphIngestion() {
    std::cout << "Running TestFullJodhpurGraphIngestion on canonical dataset..." << std::endl;

    const std::string canonical_path = "data/jodhpur_graph.json";
    Graph graph;

    LoadStatistics stats = DataLoader::LoadFromJsonFile(canonical_path, graph);

    std::cout << "Ingested nodes: " << stats.nodes_loaded << std::endl;
    std::cout << "Ingested edges: " << stats.edges_loaded << std::endl;
    std::cout << "Unique road names: " << stats.unique_road_names << std::endl;
    std::cout << "Load wall-clock time: " << stats.load_time_ms << " ms" << std::endl;

    // Strict acceptance criteria assertions
    TEST_ASSERT(stats.nodes_loaded == 59334, "Expected exactly 59,334 nodes loaded");
    TEST_ASSERT(stats.edges_loaded == 129778, "Expected exactly 129,778 directed edges loaded");
    TEST_ASSERT(graph.NodeCount() == 59334, "Graph NodeCount must be exactly 59,334");
    TEST_ASSERT(graph.EdgeCount() == 129778, "Graph EdgeCount must be exactly 129,778");
    TEST_ASSERT(graph.UniqueNameCount() == 118, "Expected 118 road name entries in pool (1 empty placeholder + 117 authentic OSM names)");

    // Verify the 6 canonical emergency facility nodes
    const int64_t aiims_node = 8520698362;
    const int64_t mdm_node   = 5321319416;
    const int64_t mgh_node   = 8499684813;
    const int64_t fire_node  = 2694302020;
    const int64_t sojati_node= 2688566058;
    const int64_t paota_node = 3773158752;

    TEST_ASSERT(graph.HasNode(aiims_node), "AIIMS node 8520698362 must be present");
    TEST_ASSERT(graph.HasNode(mdm_node), "MDM Hospital node 5321319416 must be present");
    TEST_ASSERT(graph.HasNode(mgh_node), "MGH Hospital node 8499684813 must be present");
    TEST_ASSERT(graph.HasNode(fire_node), "Basni Fire node 2694302020 must be present");
    TEST_ASSERT(graph.HasNode(sojati_node), "Sojati Gate node 2688566058 must be present");
    TEST_ASSERT(graph.HasNode(paota_node), "Paota Circle node 3773158752 must be present");

    // Verify two-tier indexing recovery for all 6 facilities
    TEST_ASSERT(graph.GetOsmId(graph.GetInternalIndex(aiims_node)) == aiims_node, "AIIMS ID recovery");
    TEST_ASSERT(graph.GetOsmId(graph.GetInternalIndex(mdm_node)) == mdm_node, "MDM ID recovery");
    TEST_ASSERT(graph.GetOsmId(graph.GetInternalIndex(mgh_node)) == mgh_node, "MGH ID recovery");
    TEST_ASSERT(graph.GetOsmId(graph.GetInternalIndex(fire_node)) == fire_node, "Fire station ID recovery");
    TEST_ASSERT(graph.GetOsmId(graph.GetInternalIndex(sojati_node)) == sojati_node, "Sojati ID recovery");
    TEST_ASSERT(graph.GetOsmId(graph.GetInternalIndex(paota_node)) == paota_node, "Paota ID recovery");

    // Verify all edges have strictly positive weights and valid target references
    size_t edge_traversal_count = 0;
    for (uint32_t u = 0; u < graph.NodeCount(); ++u) {
        const auto& edges = graph.GetOutgoingEdges(u);
        for (const auto& e : edges) {
            TEST_ASSERT(e.distance_meters > 0.0, "Edge distance must be strictly positive");
            TEST_ASSERT(std::isfinite(e.distance_meters), "Edge distance must be finite");
            TEST_ASSERT(e.target_idx < graph.NodeCount(), "Target index must be within range");
            ++edge_traversal_count;
        }
    }
    TEST_ASSERT(edge_traversal_count == 129778, "Traversed edge count must equal 129,778");

    std::cout << "TestFullJodhpurGraphIngestion: PASSED (All acceptance criteria met)\n" << std::endl;
    return true;
}

// ============================================================================
// PHASE 3.3 EXPANDED TESTS
// ============================================================================

// 10. Coordinate Validation: NaN and Infinite Latitude
bool TestCoordinateNanAndInfiniteLatitude() {
    std::cout << "Running TestCoordinateNanAndInfiniteLatitude..." << std::endl;

    // Test Graph::AddNode directly with NaN
    Graph g1;
    EXPECT_THROW(g1.AddNode(701, std::numeric_limits<double>::quiet_NaN(), 73.02),
                 std::invalid_argument, "NaN Latitude in AddNode");

    // Test Graph::AddNode directly with +Infinity
    Graph g2;
    EXPECT_THROW(g2.AddNode(702, std::numeric_limits<double>::infinity(), 73.02),
                 std::invalid_argument, "Positive Infinite Latitude in AddNode");

    // Test Graph::AddNode directly with -Infinity
    Graph g3;
    EXPECT_THROW(g3.AddNode(703, -std::numeric_limits<double>::infinity(), 73.02),
                 std::invalid_argument, "Negative Infinite Latitude in AddNode");

    std::cout << "TestCoordinateNanAndInfiniteLatitude: PASSED\n" << std::endl;
    return true;
}

// 11. Coordinate Validation: NaN and Infinite Longitude
bool TestCoordinateNanAndInfiniteLongitude() {
    std::cout << "Running TestCoordinateNanAndInfiniteLongitude..." << std::endl;

    Graph g1;
    EXPECT_THROW(g1.AddNode(704, 26.28, std::numeric_limits<double>::quiet_NaN()),
                 std::invalid_argument, "NaN Longitude in AddNode");

    Graph g2;
    EXPECT_THROW(g2.AddNode(705, 26.28, std::numeric_limits<double>::infinity()),
                 std::invalid_argument, "Positive Infinite Longitude in AddNode");

    Graph g3;
    EXPECT_THROW(g3.AddNode(706, 26.28, -std::numeric_limits<double>::infinity()),
                 std::invalid_argument, "Negative Infinite Longitude in AddNode");

    std::cout << "TestCoordinateNanAndInfiniteLongitude: PASSED\n" << std::endl;
    return true;
}

// 12. Coordinate Range Validation: Latitude Below -90 and Above +90
bool TestCoordinateLatitudeRange() {
    std::cout << "Running TestCoordinateLatitudeRange..." << std::endl;

    // Below -90 in JSON
    std::string json_low = R"({
        "nodes": [{"id": 801, "latitude": -90.5, "longitude": 73.02}],
        "edges": []
    })";
    Graph g1;
    EXPECT_THROW(DataLoader::LoadFromJsonString(json_low, g1), std::runtime_error, "Latitude < -90");

    // Above +90 in JSON
    std::string json_high = R"({
        "nodes": [{"id": 802, "latitude": 90.001, "longitude": 73.02}],
        "edges": []
    })";
    Graph g2;
    EXPECT_THROW(DataLoader::LoadFromJsonString(json_high, g2), std::runtime_error, "Latitude > 90");

    std::cout << "TestCoordinateLatitudeRange: PASSED\n" << std::endl;
    return true;
}

// 13. Coordinate Range Validation: Longitude Below -180 and Above +180
bool TestCoordinateLongitudeRange() {
    std::cout << "Running TestCoordinateLongitudeRange..." << std::endl;

    // Below -180 in JSON
    std::string json_low = R"({
        "nodes": [{"id": 901, "latitude": 26.28, "longitude": -180.1}],
        "edges": []
    })";
    Graph g1;
    EXPECT_THROW(DataLoader::LoadFromJsonString(json_low, g1), std::runtime_error, "Longitude < -180");

    // Above +180 in JSON
    std::string json_high = R"({
        "nodes": [{"id": 902, "latitude": 26.28, "longitude": 180.5}],
        "edges": []
    })";
    Graph g2;
    EXPECT_THROW(DataLoader::LoadFromJsonString(json_high, g2), std::runtime_error, "Longitude > 180");

    std::cout << "TestCoordinateLongitudeRange: PASSED\n" << std::endl;
    return true;
}

// 14. Edge Weight Validation: NaN, +Infinity, and -Infinity
bool TestEdgeWeightNanAndInfinity() {
    std::cout << "Running TestEdgeWeightNanAndInfinity..." << std::endl;

    Graph g;
    g.AddNode(1, 26.0, 73.0);
    g.AddNode(2, 26.1, 73.1);

    // Test NaN weight
    EXPECT_THROW(g.AddEdge(0, 1, std::numeric_limits<double>::quiet_NaN(), 10, 0, 0, 0, true, {}),
                 std::invalid_argument, "NaN edge weight");

    // Test +Infinity weight
    EXPECT_THROW(g.AddEdge(0, 1, std::numeric_limits<double>::infinity(), 10, 0, 0, 0, true, {}),
                 std::invalid_argument, "+Infinity edge weight");

    // Test -Infinity weight
    EXPECT_THROW(g.AddEdge(0, 1, -std::numeric_limits<double>::infinity(), 10, 0, 0, 0, true, {}),
                 std::invalid_argument, "-Infinity edge weight");

    std::cout << "TestEdgeWeightNanAndInfinity: PASSED\n" << std::endl;
    return true;
}

// 15. Graph Integrity: Invalid Target Index Rejection
bool TestInvalidTargetIndexRejection() {
    std::cout << "Running TestInvalidTargetIndexRejection..." << std::endl;

    Graph g;
    g.AddNode(1, 26.0, 73.0);

    // from_idx = 0 (valid), to_idx = 99 (invalid: node count is 1)
    EXPECT_THROW(g.AddEdge(0, 99, 100.0, 10, 0, 0, 0, true, {}),
                 std::out_of_range, "Target index >= NodeCount()");

    // from_idx = 99 (invalid)
    EXPECT_THROW(g.AddEdge(99, 0, 100.0, 10, 0, 0, 0, true, {}),
                 std::out_of_range, "Source index >= NodeCount()");

    std::cout << "TestInvalidTargetIndexRejection: PASSED\n" << std::endl;
    return true;
}

// 16. Graph Integrity Validator on Synthetic Graph
bool TestStructuralIntegrityValidator() {
    std::cout << "Running TestStructuralIntegrityValidator..." << std::endl;

    Graph g;
    g.AddNode(10, 26.0, 73.0);
    g.AddNode(20, 26.1, 73.1);
    std::vector<GeoPoint> geom = {GeoPoint{26.0, 73.0}, GeoPoint{26.1, 73.1}};
    g.AddEdge(0, 1, 50.0, 100, 0, 0, 0, true, geom);

    // Validation should succeed on valid graph
    ValidationResult res = GraphIntegrityValidator::Validate(g, 2, 1);
    TEST_ASSERT(res.IsValid(), "Valid graph should pass validation");
    TEST_ASSERT(res.failed_checks == 0, "No failed checks on valid graph");
    TEST_ASSERT(res.total_checks > 10, "Multiple checks must be recorded");

    // Test with mismatched expected nodes
    ValidationResult res_mismatch = GraphIntegrityValidator::Validate(g, 999, 1);
    TEST_ASSERT(!res_mismatch.IsValid(), "Mismatched node count must fail");
    TEST_ASSERT(res_mismatch.failed_checks >= 1, "At least 1 failed check on mismatch");

    std::cout << "TestStructuralIntegrityValidator: PASSED\n" << std::endl;
    return true;
}

int main() {
    std::cout << "====================================================\n"
              << "  PHASE 3.2 & 3.3 INGESTION & INTEGRITY TEST SUITE\n"
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

    // Phase 3.2 Core Tests (Preserved)
    run_test(TestSyntheticDirectedGraph, "TestSyntheticDirectedGraph");
    run_test(TestDuplicateNodeRejection, "TestDuplicateNodeRejection");
    run_test(TestMissingSourceNodeRejection, "TestMissingSourceNodeRejection");
    run_test(TestMissingDestinationNodeRejection, "TestMissingDestinationNodeRejection");
    run_test(TestInvalidZeroWeightRejection, "TestInvalidZeroWeightRejection");
    run_test(TestInvalidNegativeWeightRejection, "TestInvalidNegativeWeightRejection");
    run_test(TestMissingFileHandling, "TestMissingFileHandling");
    run_test(TestMalformedJsonHandling, "TestMalformedJsonHandling");
    run_test(TestFullJodhpurGraphIngestion, "TestFullJodhpurGraphIngestion");

    // Phase 3.3 Expanded Tests
    run_test(TestCoordinateNanAndInfiniteLatitude, "TestCoordinateNanAndInfiniteLatitude");
    run_test(TestCoordinateNanAndInfiniteLongitude, "TestCoordinateNanAndInfiniteLongitude");
    run_test(TestCoordinateLatitudeRange, "TestCoordinateLatitudeRange");
    run_test(TestCoordinateLongitudeRange, "TestCoordinateLongitudeRange");
    run_test(TestEdgeWeightNanAndInfinity, "TestEdgeWeightNanAndInfinity");
    run_test(TestInvalidTargetIndexRejection, "TestInvalidTargetIndexRejection");
    run_test(TestStructuralIntegrityValidator, "TestStructuralIntegrityValidator");

    std::cout << "====================================================\n"
              << "  TEST RESULTS SUMMARY\n"
              << "  Passed: " << passed << " / " << (passed + failed) << "\n"
              << "  Failed: " << failed << "\n"
              << "====================================================" << std::endl;

    return (failed == 0) ? 0 : 1;
}
