#include "Graph.hpp"
#include "DataLoader.hpp"
#include "Dijkstra.hpp"
#include "RouteGeometry.hpp"
#include "GeoJSONExporter.hpp"
#include "PolylineEncoder.hpp"
#include <iostream>
#include <vector>
#include <cmath>
#include <cassert>
#include <string>
#include <chrono>
#include <algorithm>
#include <iomanip>
#include <numeric>

using namespace EmergencyRouting;

#define ASSERT_TRUE(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "[FAIL] Line " << __LINE__ << ": " << msg << std::endl; \
            return false; \
        } \
    } while (0)

// Helper to construct a synthetic graph for targeted unit tests
Graph CreateSyntheticGraph() {
    Graph g;
    // Node 0: (26.290, 73.010)
    g.AddNode(100, 26.290, 73.010);
    // Node 1: (26.295, 73.015)
    g.AddNode(101, 26.295, 73.015);
    // Node 2: (26.300, 73.020)
    g.AddNode(102, 26.300, 73.020);
    // Node 3: (26.305, 73.025)
    g.AddNode(103, 26.305, 73.025);

    // Edge 0 -> 1 with 2 coordinates
    g.AddEdge(0, 1, 750.0, 10001, 1, 0, 0, false,
              {{26.290, 73.010}, {26.295, 73.015}});

    // Edge 1 -> 2 with 3 coordinates (intermediate coordinate)
    g.AddEdge(1, 2, 800.0, 10002, 1, 0, 0, false,
              {{26.295, 73.015}, {26.297, 73.017}, {26.300, 73.020}});

    // Edge 2 -> 3 with 2 coordinates
    g.AddEdge(2, 3, 750.0, 10003, 1, 0, 0, false,
              {{26.300, 73.020}, {26.305, 73.025}});

    return g;
}

// Test 1: Single-edge geometry reconstruction
bool Test1_SingleEdgeReconstruction() {
    Graph g = CreateSyntheticGraph();
    DijkstraRouter router(g);

    RouteResult route = router.ShortestPath(0, 1);
    ASSERT_TRUE(route.found, "Route 0->1 must be found");
    ASSERT_TRUE(route.path_segments.size() == 1, "Must have 1 segment");

    RouteGeometryResult geom = RouteGeometry::Reconstruct(g, route);
    ASSERT_TRUE(geom.success, "Reconstruction must succeed: " + geom.error_message);
    ASSERT_TRUE(geom.coordinates.size() == 2, "Coordinate count must be 2");
    ASSERT_TRUE(geom.segments_processed == 1, "Segments processed must be 1");
    ASSERT_TRUE(geom.duplicate_junctions_removed == 0, "No duplicate junctions for single edge");

    std::string err;
    ASSERT_TRUE(RouteGeometry::Validate(g, route, geom.coordinates, err), "Validation failed: " + err);
    return true;
}

// Test 2: Multi-edge route reconstruction
bool Test2_MultiEdgeReconstruction() {
    Graph g = CreateSyntheticGraph();
    DijkstraRouter router(g);

    RouteResult route = router.ShortestPath(0, 3);
    ASSERT_TRUE(route.found, "Route 0->3 must be found");
    ASSERT_TRUE(route.path_segments.size() == 3, "Must have 3 segments");

    RouteGeometryResult geom = RouteGeometry::Reconstruct(g, route);
    ASSERT_TRUE(geom.success, "Reconstruction must succeed: " + geom.error_message);
    ASSERT_TRUE(geom.segments_processed == 3, "Segments processed must be 3");

    std::string err;
    ASSERT_TRUE(RouteGeometry::Validate(g, route, geom.coordinates, err), "Validation failed: " + err);
    return true;
}

// Test 3: Correct source-to-destination coordinate ordering
bool Test3_CoordinateOrdering() {
    Graph g = CreateSyntheticGraph();
    DijkstraRouter router(g);

    RouteResult route = router.ShortestPath(0, 3);
    RouteGeometryResult geom = RouteGeometry::Reconstruct(g, route);
    ASSERT_TRUE(geom.success, "Reconstruction must succeed");

    // First coordinate must match node 0 (source)
    const auto& node0 = g.GetNode(0);
    ASSERT_TRUE(std::abs(geom.coordinates.front().latitude - node0.latitude) < 1e-6, "Start lat match");
    ASSERT_TRUE(std::abs(geom.coordinates.front().longitude - node0.longitude) < 1e-6, "Start lon match");

    // Last coordinate must match node 3 (destination)
    const auto& node3 = g.GetNode(3);
    ASSERT_TRUE(std::abs(geom.coordinates.back().latitude - node3.latitude) < 1e-6, "End lat match");
    ASSERT_TRUE(std::abs(geom.coordinates.back().longitude - node3.longitude) < 1e-6, "End lon match");
    return true;
}

// Test 4: Correct handling of reverse directed edges
bool Test4_ReverseDirectedEdgeHandling() {
    Graph g;
    g.AddNode(10, 26.10, 73.10);
    g.AddNode(11, 26.20, 73.20);

    // Intentionally store geometry reversed relative to traversal (to->from)
    g.AddEdge(0, 1, 1000.0, 99, 1, 0, 0, false,
              {{26.20, 73.20}, {26.10, 73.10}});

    DijkstraRouter router(g);
    RouteResult route = router.ShortestPath(0, 1);
    ASSERT_TRUE(route.found, "Route must be found");

    RouteGeometryResult geom = RouteGeometry::Reconstruct(g, route);
    ASSERT_TRUE(geom.success, "Reconstruction must succeed");
    ASSERT_TRUE(geom.reversed_segments_count == 1, "Must detect and reverse incorrectly oriented segment");
    ASSERT_TRUE(std::abs(geom.coordinates.front().latitude - 26.10) < 1e-6, "Reversed geom starts at source");
    ASSERT_TRUE(std::abs(geom.coordinates.back().latitude - 26.20) < 1e-6, "Reversed geom ends at dest");
    return true;
}

// Test 5: Shared junction coordinate deduplication
bool Test5_JunctionDeduplication() {
    Graph g = CreateSyntheticGraph();
    // Edge 0->1 has 2 points; Edge 1->2 has 3 points; Edge 2->3 has 2 points.
    // Total raw coordinates = 2 + 3 + 2 = 7 points.
    // Shared junctions at node 1 and node 2 (2 deduplications).
    // Expected continuous points = 7 - 2 = 5 points!

    DijkstraRouter router(g);
    RouteResult route = router.ShortestPath(0, 3);
    RouteGeometryResult geom = RouteGeometry::Reconstruct(g, route);

    ASSERT_TRUE(geom.success, "Reconstruction must succeed");
    ASSERT_TRUE(geom.duplicate_junctions_removed == 2,
                "Expected 2 duplicate junctions removed, got " + std::to_string(geom.duplicate_junctions_removed));
    ASSERT_TRUE(geom.coordinates.size() == 5,
                "Expected 5 continuous coordinates, got " + std::to_string(geom.coordinates.size()));
    return true;
}

// Test 6: Intermediate coordinate preservation
bool Test6_IntermediateCoordinatePreservation() {
    Graph g = CreateSyntheticGraph();
    DijkstraRouter router(g);
    RouteResult route = router.ShortestPath(1, 2);
    // Edge 1->2 has intermediate coordinate (26.297, 73.017)
    RouteGeometryResult geom = RouteGeometry::Reconstruct(g, route);

    ASSERT_TRUE(geom.success, "Reconstruction must succeed");
    ASSERT_TRUE(geom.coordinates.size() == 3, "Must have 3 coordinates (start, intermediate, end)");
    ASSERT_TRUE(std::abs(geom.coordinates[1].latitude - 26.297) < 1e-6, "Intermediate lat preserved");
    ASSERT_TRUE(std::abs(geom.coordinates[1].longitude - 73.017) < 1e-6, "Intermediate lon preserved");
    return true;
}

// Test 7 & 8: Invalid geometry offset and count
bool Test7_8_InvalidGeometryOffsetAndCount() {
    Graph g = CreateSyntheticGraph();
    DijkstraRouter router(g);
    RouteResult route = router.ShortestPath(0, 1);

    // Corrupt geometry offset
    RouteResult corrupted_offset = route;
    corrupted_offset.path_segments[0].geometry_offset = 999999;
    RouteGeometryResult res1 = RouteGeometry::Reconstruct(g, corrupted_offset);
    ASSERT_TRUE(!res1.success, "Reconstruction must fail on out-of-bounds offset");

    // Corrupt geometry count = 0
    RouteResult corrupted_count = route;
    corrupted_count.path_segments[0].geometry_count = 0;
    RouteGeometryResult res2 = RouteGeometry::Reconstruct(g, corrupted_count);
    ASSERT_TRUE(!res2.success, "Reconstruction must fail on zero geometry count");
    return true;
}

// Test 9 & 10: Non-finite and out-of-range coordinates
bool Test9_10_NonFiniteAndOutOfRange() {
    // Note: DataLoader and Graph reject invalid coordinates on ingest.
    // Here we verify RouteGeometry defensive verification on corrupted RouteResult segments.
    Graph g;
    g.AddNode(1, 26.0, 73.0);
    g.AddNode(2, 26.1, 73.1);
    g.AddEdge(0, 1, 100.0, 1, 1, 0, 0, false, {{26.0, 73.0}, {26.1, 73.1}});

    RouteResult route;
    route.found = true;
    route.source_internal_idx = 0;
    route.destination_internal_idx = 1;
    route.source_osm_id = 1;
    route.destination_osm_id = 2;
    route.total_distance_meters = 100.0;
    route.path_segments.push_back(PathSegment{0, 1, 1, 2, 1, 100.0, 1, 0, 0, false, 0, 2});

    RouteGeometryResult res = RouteGeometry::Reconstruct(g, route);
    ASSERT_TRUE(res.success, "Clean reconstruction");

    // Validation checks for non-finite coordinates
    std::string err;
    std::vector<GeoPoint> bad_coords = {{26.0, 73.0}, {std::numeric_limits<double>::quiet_NaN(), 73.1}};
    ASSERT_TRUE(!RouteGeometry::Validate(g, route, bad_coords, err), "Validation must reject NaN");

    std::vector<GeoPoint> oob_coords = {{26.0, 73.0}, {95.0, 73.1}};
    ASSERT_TRUE(!RouteGeometry::Validate(g, route, oob_coords, err), "Validation must reject Lat > 90");
    return true;
}

// Test 11: Disconnected geometry detection
bool Test11_DisconnectedGeometryDetection() {
    Graph g;
    g.AddNode(1, 26.0, 73.0);
    g.AddNode(2, 26.1, 73.1);
    g.AddNode(3, 26.2, 73.2);

    // Edge 0->1 ends at (26.1, 73.1)
    g.AddEdge(0, 1, 100.0, 1, 1, 0, 0, false, {{26.0, 73.0}, {26.1, 73.1}});
    // Edge 1->2 has artificial geometry gap: starts at (26.15, 73.15) instead of node 1!
    // But since Graph::AddEdge takes geometry, let's pass a disconnected start
    // Note: our orientation checker will fail if endpoints don't match node 1,
    // so this detects invalid / disconnected geometry!
    g.AddEdge(1, 2, 100.0, 2, 1, 0, 0, false, {{26.15, 73.15}, {26.2, 73.2}});

    DijkstraRouter router(g);
    RouteResult route = router.ShortestPath(0, 2);
    ASSERT_TRUE(route.found, "Route found");

    RouteGeometryResult res = RouteGeometry::Reconstruct(g, route);
    ASSERT_TRUE(!res.success, "Reconstruction must detect disconnected endpoint/junction gap");
    ASSERT_TRUE(res.error_message.find("endpoints do not align") != std::string::npos ||
                res.error_message.find("Disconnected") != std::string::npos,
                "Error message should mention gap or endpoint misalignment");
    return true;
}

// Test 12: Source and destination endpoint verification
bool Test12_SourceDestEndpointVerification() {
    Graph g = CreateSyntheticGraph();
    DijkstraRouter router(g);
    RouteResult route = router.ShortestPath(0, 2);
    RouteGeometryResult geom = RouteGeometry::Reconstruct(g, route);
    ASSERT_TRUE(geom.success, "Reconstruction must succeed");

    std::string err;
    // Mutate start coordinate
    auto corrupted = geom.coordinates;
    corrupted.front() = GeoPoint{26.50, 73.50};
    ASSERT_TRUE(!RouteGeometry::Validate(g, route, corrupted, err), "Validation must reject mismatched start");

    // Mutate end coordinate
    corrupted = geom.coordinates;
    corrupted.back() = GeoPoint{26.50, 73.50};
    ASSERT_TRUE(!RouteGeometry::Validate(g, route, corrupted, err), "Validation must reject mismatched end");
    return true;
}

// Test 13: Geometry distance calculation
bool Test13_DistanceCalculation() {
    // Known points:
    // (26.0, 73.0) to (26.0, 73.01) -> roughly 998 meters at this latitude
    std::vector<GeoPoint> pts = {
        {26.0, 73.0},
        {26.0, 73.01}
    };
    double dist = RouteGeometry::CalculateHaversineDistance(pts);
    ASSERT_TRUE(dist > 990.0 && dist < 1010.0, "Haversine distance calculation is accurate");
    return true;
}

// Test 14: Empty route handling
bool Test14_EmptyRouteHandling() {
    Graph g = CreateSyntheticGraph();
    RouteResult unfound;
    unfound.found = false;

    RouteGeometryResult res = RouteGeometry::Reconstruct(g, unfound);
    ASSERT_TRUE(!res.success, "Reconstruct must fail for unfound route");

    std::string err;
    ASSERT_TRUE(!RouteGeometry::Validate(g, unfound, {}, err), "Validate must fail for unfound route");
    return true;
}

// Test 15: Single-node route handling (source == destination)
bool Test15_SingleNodeRoute() {
    Graph g = CreateSyntheticGraph();
    DijkstraRouter router(g);
    RouteResult route = router.ShortestPath(1, 1);
    ASSERT_TRUE(route.found, "Source == destination route found");
    ASSERT_TRUE(route.total_distance_meters == 0.0, "Zero distance");

    RouteGeometryResult geom = RouteGeometry::Reconstruct(g, route);
    ASSERT_TRUE(geom.success, "Reconstruction must succeed for single-node route");
    ASSERT_TRUE(geom.coordinates.size() == 1, "Must have exactly 1 coordinate");
    ASSERT_TRUE(geom.total_haversine_distance_meters == 0.0, "Haversine distance must be 0");

    std::string err;
    ASSERT_TRUE(RouteGeometry::Validate(g, route, geom.coordinates, err), "Validation must pass for single-node route");
    return true;
}

// Structure to collect benchmark timings
struct BenchmarkRecord {
    std::string pair_name;
    int64_t source_osm;
    int64_t dest_osm;
    double graph_distance_m{0.0};
    double haversine_distance_m{0.0};
    double distance_diff_m{0.0};
    size_t edge_count{0};
    size_t coord_count{0};
    size_t geojson_bytes{0};
    size_t polyline_chars{0};
    double dijkstra_ms{0.0};
    double path_recon_ms{0.0};
    double geom_recon_ms{0.0};
    double geojson_export_ms{0.0};
    double polyline_encode_ms{0.0};
    double polyline_decode_ms{0.0};
};

double ComputePercentile(std::vector<double>& v, double p) {
    if (v.empty()) return 0.0;
    std::sort(v.begin(), v.end());
    size_t idx = static_cast<size_t>(std::ceil(p * v.size())) - 1;
    if (idx >= v.size()) idx = v.size() - 1;
    return v[idx];
}

// Canonical Jodhpur 30-route verification and performance benchmarks
bool Test16_CanonicalJodhpur30FacilityRoutes() {
    std::cout << "\n========================================================\n"
              << "TEST 16: CANONICAL JODHPUR 30 FACILITY PAIR VERIFICATION\n"
              << "========================================================\n";

    Graph graph;
    const std::string graph_path = "data/jodhpur_graph.json";
    DataLoader::LoadFromJsonFile(graph_path, graph);

    struct Facility {
        std::string name;
        int64_t osm_id;
    };

    const std::vector<Facility> facilities = {
        {"AIIMS Jodhpur", 8520698362},
        {"MDM Hospital", 5321319416},
        {"MGH Hospital", 8499684813},
        {"Basni Fire Stn", 2694302020},
        {"Sojati Gate", 2688566058},
        {"Paota Circle", 3773158752}
    };

    DijkstraRouter router(graph);
    std::vector<BenchmarkRecord> records;
    records.reserve(30);

    size_t routes_tested = 0;
    size_t routes_verified = 0;
    double max_distance_discrepancy = 0.0;
    double sum_distance_discrepancy = 0.0;

    std::cout << std::left
              << std::setw(28) << "Facility Pair"
              << std::setw(10) << "Edges"
              << std::setw(10) << "Coords"
              << std::setw(14) << "Graph Dist(m)"
              << std::setw(14) << "Geom Dist(m)"
              << std::setw(12) << "Diff (m)"
              << std::setw(12) << "Geom(ms)"
              << std::setw(12) << "GeoJSON(ms)"
              << std::setw(12) << "PolyEnc(ms)"
              << "\n"
              << std::string(114, '-') << "\n";

    for (size_t i = 0; i < facilities.size(); ++i) {
        for (size_t j = 0; j < facilities.size(); ++j) {
            if (i == j) continue; // Skip identical endpoints (30 directed pairs)

            const auto& src = facilities[i];
            const auto& dst = facilities[j];
            const std::string pair_label = src.name + " -> " + dst.name;

            ++routes_tested;

            // 1. Dijkstra routing
            auto t0 = std::chrono::steady_clock::now();
            RouteResult route = router.ShortestPathOsm(src.osm_id, dst.osm_id);
            auto t1 = std::chrono::steady_clock::now();
            double dijkstra_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

            ASSERT_TRUE(route.found, "Route must be found for " + pair_label);
            ASSERT_TRUE(route.path_segments.size() > 0, "Path segments must not be empty for " + pair_label);

            // 2. Geometry reconstruction
            auto t2 = std::chrono::steady_clock::now();
            RouteGeometryResult geom = RouteGeometry::Reconstruct(graph, route);
            auto t3 = std::chrono::steady_clock::now();
            double geom_ms = std::chrono::duration<double, std::milli>(t3 - t2).count();

            ASSERT_TRUE(geom.success, "Geometry reconstruction failed for " + pair_label + ": " + geom.error_message);
            ASSERT_TRUE(geom.segments_processed == route.path_segments.size(), "All segments must be processed");
            // In a continuous path of E edges, deduplication removes exactly E-1 shared junctions
            ASSERT_TRUE(geom.duplicate_junctions_removed == route.path_segments.size() - 1,
                        "Deduplication count (" + std::to_string(geom.duplicate_junctions_removed) +
                        ") must equal E-1 (" + std::to_string(route.path_segments.size() - 1) + ")");

            // 3. Validation
            std::string val_err;
            ASSERT_TRUE(RouteGeometry::Validate(graph, route, geom.coordinates, val_err),
                        "Validation failed for " + pair_label + ": " + val_err);

            // 4. Distance comparison
            double diff = std::abs(route.total_distance_meters - geom.total_haversine_distance_meters);
            max_distance_discrepancy = std::max(max_distance_discrepancy, diff);
            sum_distance_discrepancy += diff;

            // 5. GeoJSON Export
            auto t4 = std::chrono::steady_clock::now();
            std::string geojson_str = GeoJSONExporter::ExportFeatureString(route, geom.coordinates, -1, pair_label, geom_ms);
            auto t5 = std::chrono::steady_clock::now();
            double geojson_ms = std::chrono::duration<double, std::milli>(t5 - t4).count();

            // Validate parsed GeoJSON
            nlohmann::json parsed_feat = nlohmann::json::parse(geojson_str);
            ASSERT_TRUE(parsed_feat["type"] == "Feature", "Parsed GeoJSON type must be Feature");
            ASSERT_TRUE(parsed_feat["geometry"]["type"] == "LineString", "GeoJSON geometry must be LineString");
            ASSERT_TRUE(parsed_feat["geometry"]["coordinates"].size() == geom.coordinates.size(),
                        "GeoJSON coordinate count match");
            // Check coordinate ordering [longitude, latitude]
            double exported_first_lon = parsed_feat["geometry"]["coordinates"][0][0].get<double>();
            double exported_first_lat = parsed_feat["geometry"]["coordinates"][0][1].get<double>();
            ASSERT_TRUE(std::abs(exported_first_lon - geom.coordinates.front().longitude) < 1e-7, "GeoJSON lon check");
            ASSERT_TRUE(std::abs(exported_first_lat - geom.coordinates.front().latitude) < 1e-7, "GeoJSON lat check");

            // 6. Polyline Encoding & Decoding
            auto t6 = std::chrono::steady_clock::now();
            std::string polyline_str = PolylineEncoder::Encode(geom.coordinates);
            auto t7 = std::chrono::steady_clock::now();
            double poly_enc_ms = std::chrono::duration<double, std::milli>(t7 - t6).count();

            auto t8 = std::chrono::steady_clock::now();
            std::vector<GeoPoint> decoded_coords = PolylineEncoder::Decode(polyline_str);
            auto t9 = std::chrono::steady_clock::now();
            double poly_dec_ms = std::chrono::duration<double, std::milli>(t9 - t8).count();

            ASSERT_TRUE(decoded_coords.size() == geom.coordinates.size(), "Decoded coords count match");
            for (size_t k = 0; k < geom.coordinates.size(); ++k) {
                ASSERT_TRUE(std::abs(decoded_coords[k].latitude - geom.coordinates[k].latitude) < 1e-5, "Poly lat match");
                ASSERT_TRUE(std::abs(decoded_coords[k].longitude - geom.coordinates[k].longitude) < 1e-5, "Poly lon match");
            }

            BenchmarkRecord rec;
            rec.pair_name = pair_label;
            rec.source_osm = src.osm_id;
            rec.dest_osm = dst.osm_id;
            rec.graph_distance_m = route.total_distance_meters;
            rec.haversine_distance_m = geom.total_haversine_distance_meters;
            rec.distance_diff_m = diff;
            rec.edge_count = route.path_segments.size();
            rec.coord_count = geom.coordinates.size();
            rec.geojson_bytes = geojson_str.size();
            rec.polyline_chars = polyline_str.size();
            rec.dijkstra_ms = dijkstra_ms;
            rec.path_recon_ms = route.path_reconstruction_time_ms;
            rec.geom_recon_ms = geom_ms;
            rec.geojson_export_ms = geojson_ms;
            rec.polyline_encode_ms = poly_enc_ms;
            rec.polyline_decode_ms = poly_dec_ms;
            records.push_back(rec);

            std::cout << std::left
                      << std::setw(28) << pair_label
                      << std::setw(10) << rec.edge_count
                      << std::setw(10) << rec.coord_count
                      << std::setw(14) << std::fixed << std::setprecision(2) << rec.graph_distance_m
                      << std::setw(14) << std::fixed << std::setprecision(2) << rec.haversine_distance_m
                      << std::setw(12) << std::fixed << std::setprecision(4) << rec.distance_diff_m
                      << std::setw(12) << std::fixed << std::setprecision(3) << rec.geom_recon_ms
                      << std::setw(12) << std::fixed << std::setprecision(3) << rec.geojson_export_ms
                      << std::setw(12) << std::fixed << std::setprecision(3) << rec.polyline_encode_ms
                      << "\n";

            ++routes_verified;
        }
    }

    std::cout << std::string(114, '-') << "\n";
    std::cout << "All " << routes_verified << " / " << routes_tested << " canonical facility routes VERIFIED.\n"
              << "Max distance discrepancy (Graph vs Geometry Haversine): " << max_distance_discrepancy << " m\n"
              << "Average distance discrepancy: " << (sum_distance_discrepancy / routes_verified) << " m\n";

    // Compute distribution statistics for all measured stages
    std::vector<double> v_dijkstra, v_path_recon, v_geom_recon, v_geojson, v_poly_enc, v_poly_dec;
    for (const auto& r : records) {
        v_dijkstra.push_back(r.dijkstra_ms);
        v_path_recon.push_back(r.path_recon_ms);
        v_geom_recon.push_back(r.geom_recon_ms);
        v_geojson.push_back(r.geojson_export_ms);
        v_poly_enc.push_back(r.polyline_encode_ms);
        v_poly_dec.push_back(r.polyline_decode_ms);
    }

    auto print_stats = [](const std::string& name, std::vector<double>& v) {
        double min_v = *std::min_element(v.begin(), v.end());
        double max_v = *std::max_element(v.begin(), v.end());
        double sum_v = std::accumulate(v.begin(), v.end(), 0.0);
        double avg_v = sum_v / v.size();
        double p50_v = ComputePercentile(v, 0.50);
        double p95_v = ComputePercentile(v, 0.95);

        std::cout << "  " << std::left << std::setw(30) << name
                  << " Min: " << std::fixed << std::setprecision(3) << std::setw(7) << min_v << " ms |"
                  << " Avg: " << std::fixed << std::setprecision(3) << std::setw(7) << avg_v << " ms |"
                  << " p50: " << std::fixed << std::setprecision(3) << std::setw(7) << p50_v << " ms |"
                  << " p95: " << std::fixed << std::setprecision(3) << std::setw(7) << p95_v << " ms |"
                  << " Max: " << std::fixed << std::setprecision(3) << std::setw(7) << max_v << " ms\n";
    };

    std::cout << "\n========================================================\n"
              << "PHASE 3.5 BENCHMARK REPORT (30 CANONICAL FACILITY PAIRS)\n"
              << "========================================================\n";
    print_stats("1. Dijkstra Algorithm:", v_dijkstra);
    print_stats("2. Path Reconstruction:", v_path_recon);
    print_stats("3. Geometry Reconstruction:", v_geom_recon);
    print_stats("4. GeoJSON Serialization:", v_geojson);
    print_stats("5. Polyline Encoding:", v_poly_enc);
    print_stats("6. Polyline Decoding:", v_poly_dec);

    // Also verify single-node route on canonical graph (e.g., AIIMS to AIIMS)
    RouteResult self_route = router.ShortestPathOsm(facilities[0].osm_id, facilities[0].osm_id);
    ASSERT_TRUE(self_route.found, "Self route AIIMS->AIIMS found");
    ASSERT_TRUE(self_route.total_distance_meters == 0.0, "Self route distance is 0");
    RouteGeometryResult self_geom = RouteGeometry::Reconstruct(graph, self_route);
    ASSERT_TRUE(self_geom.success, "Self route geometry reconstructed");
    ASSERT_TRUE(self_geom.coordinates.size() == 1, "Self route has 1 coordinate");
    std::string self_geojson = GeoJSONExporter::ExportFeatureString(self_route, self_geom.coordinates);
    nlohmann::json self_feat = nlohmann::json::parse(self_geojson);
    ASSERT_TRUE(self_feat["properties"]["zero_length_route"] == true, "Self route GeoJSON marked zero_length");

    std::cout << "Source-to-Source (AIIMS -> AIIMS) Verified Successfully.\n";

    return true;
}

int main() {
    std::cout << "========================================================\n"
              << "RUNNING TEST SUITE: RouteGeometry & Integration (Phase 3.5)\n"
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

    run_test("Test 1: Single-edge geometry reconstruction", Test1_SingleEdgeReconstruction);
    run_test("Test 2: Multi-edge route reconstruction", Test2_MultiEdgeReconstruction);
    run_test("Test 3: Coordinate ordering", Test3_CoordinateOrdering);
    run_test("Test 4: Reverse directed edge handling", Test4_ReverseDirectedEdgeHandling);
    run_test("Test 5: Shared junction coordinate deduplication", Test5_JunctionDeduplication);
    run_test("Test 6: Intermediate coordinate preservation", Test6_IntermediateCoordinatePreservation);
    run_test("Test 7 & 8: Invalid geometry offset and count", Test7_8_InvalidGeometryOffsetAndCount);
    run_test("Test 9 & 10: Non-finite and out-of-range coordinates", Test9_10_NonFiniteAndOutOfRange);
    run_test("Test 11: Disconnected geometry detection", Test11_DisconnectedGeometryDetection);
    run_test("Test 12: Source/dest endpoint verification", Test12_SourceDestEndpointVerification);
    run_test("Test 13: Geometry distance calculation", Test13_DistanceCalculation);
    run_test("Test 14: Empty route handling", Test14_EmptyRouteHandling);
    run_test("Test 15: Single-node route handling", Test15_SingleNodeRoute);
    run_test("Test 16: Canonical Jodhpur 30 facility routes & benchmarks", Test16_CanonicalJodhpur30FacilityRoutes);

    std::cout << "\n========================================================\n"
              << "ROUTE GEOMETRY TEST SUMMARY: " << passed << " PASSED, " << failed << " FAILED\n"
              << "========================================================\n";

    return (failed == 0) ? 0 : 1;
}

