#include "GeoJSONExporter.hpp"
#include <iostream>
#include <vector>
#include <cmath>
#include <cassert>
#include <string>

using namespace EmergencyRouting;

#define ASSERT_TRUE(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "[FAIL] Line " << __LINE__ << ": " << msg << std::endl; \
            return false; \
        } \
    } while (0)

#define ASSERT_THROW(expr, exc_type, msg) \
    do { \
        bool threw = false; \
        try { expr; } \
        catch (const exc_type&) { threw = true; } \
        catch (...) {} \
        if (!threw) { \
            std::cerr << "[FAIL] Line " << __LINE__ << ": Expected exception " #exc_type " for: " << msg << std::endl; \
            return false; \
        } \
    } while (0)

// Helper to create a dummy successful route
RouteResult CreateMockRoute(int64_t src_osm, int64_t dst_osm, double dist, size_t edges) {
    RouteResult res;
    res.found = true;
    res.source_osm_id = src_osm;
    res.destination_osm_id = dst_osm;
    res.source_internal_idx = 0;
    res.destination_internal_idx = static_cast<uint32_t>(edges);
    res.total_distance_meters = dist;
    res.path_segments.resize(edges);
    res.algorithm_execution_time_ms = 4.5;
    res.path_reconstruction_time_ms = 0.05;
    return res;
}

// Test 1: Valid Feature structure
bool Test1_ValidFeatureStructure() {
    auto route = CreateMockRoute(8520698362, 5321319416, 6198.77, 3);
    std::vector<GeoPoint> coords = {
        {26.291234, 73.012345},
        {26.292345, 73.013456},
        {26.293456, 73.014567},
        {26.294567, 73.015678}
    };

    nlohmann::json feat = GeoJSONExporter::ExportFeature(route, coords, "route_aiims_mdm", 0.12);
    ASSERT_TRUE(feat.contains("type") && feat["type"] == "Feature", "type must be Feature");
    ASSERT_TRUE(feat.contains("properties") && feat["properties"].is_object(), "properties must be object");
    ASSERT_TRUE(feat.contains("geometry") && feat["geometry"].is_object(), "geometry must be object");
    return true;
}

// Test 2: Correct LineString geometry
bool Test2_LineStringGeometry() {
    auto route = CreateMockRoute(8520698362, 5321319416, 6198.77, 2);
    std::vector<GeoPoint> coords = {
        {26.291, 73.012},
        {26.292, 73.013},
        {26.293, 73.014}
    };

    nlohmann::json feat = GeoJSONExporter::ExportFeature(route, coords);
    ASSERT_TRUE(feat["geometry"]["type"] == "LineString", "geometry.type must be LineString");
    ASSERT_TRUE(feat["geometry"]["coordinates"].is_array(), "coordinates must be an array");
    ASSERT_TRUE(feat["geometry"]["coordinates"].size() == 3, "coordinates size must match input");
    return true;
}

// Test 3: STRICT GEOJSON RULE: [longitude, latitude] coordinate ordering
bool Test3_CoordinateOrderLonLat() {
    auto route = CreateMockRoute(1001, 1002, 500.0, 1);
    const double expected_lat = 26.291234;
    const double expected_lon = 73.012345;
    std::vector<GeoPoint> coords = {
        {expected_lat, expected_lon},
        {26.295000, 73.015000}
    };

    nlohmann::json feat = GeoJSONExporter::ExportFeature(route, coords);
    const auto& first_pt = feat["geometry"]["coordinates"][0];
    ASSERT_TRUE(first_pt.is_array() && first_pt.size() == 2, "Coordinate pair must be array of 2");

    // GeoJSON position: [0] = longitude, [1] = latitude
    ASSERT_TRUE(std::abs(first_pt[0].get<double>() - expected_lon) < 1e-7,
                "first_pt[0] must be LONGITUDE (expected ~73.012, got " + std::to_string(first_pt[0].get<double>()) + ")");
    ASSERT_TRUE(std::abs(first_pt[1].get<double>() - expected_lat) < 1e-7,
                "first_pt[1] must be LATITUDE (expected ~26.291, got " + std::to_string(first_pt[1].get<double>()) + ")");
    return true;
}

// Test 4: Correct route metadata in properties
bool Test4_MetadataProperties() {
    auto route = CreateMockRoute(8520698362, 5321319416, 6198.77, 42);
    std::vector<GeoPoint> coords = {
        {26.291, 73.012},
        {26.295, 73.015}
    };

    nlohmann::json feat = GeoJSONExporter::ExportFeature(route, coords, "route_custom_001", 0.25);
    const auto& props = feat["properties"];

    ASSERT_TRUE(props["route_id"] == "route_custom_001", "route_id mismatch");
    ASSERT_TRUE(props["source_osm_id"] == 8520698362, "source_osm_id mismatch");
    ASSERT_TRUE(props["destination_osm_id"] == 5321319416, "destination_osm_id mismatch");
    ASSERT_TRUE(std::abs(props["distance_meters"].get<double>() - 6198.77) < 1e-4, "distance_meters mismatch");
    ASSERT_TRUE(props["coordinate_count"] == 2, "coordinate_count mismatch");
    ASSERT_TRUE(props["edge_count"] == 42, "edge_count mismatch");
    ASSERT_TRUE(props["geometry_type"] == "road_network_route", "geometry_type mismatch");
    ASSERT_TRUE(props["algorithm_execution_time_ms"] == 4.5, "algo time mismatch");
    ASSERT_TRUE(props["path_reconstruction_time_ms"] == 0.05, "path recon time mismatch");
    ASSERT_TRUE(props["geometry_reconstruction_time_ms"] == 0.25, "geom recon time mismatch");
    return true;
}

// Test 5: Numeric coordinate serialization (no NaN, no null, all numbers)
bool Test5_NumericCoordinates() {
    auto route = CreateMockRoute(1, 2, 100.0, 1);
    std::vector<GeoPoint> coords = {
        {26.0, 73.0},
        {26.1, 73.1}
    };

    std::string json_str = GeoJSONExporter::ExportFeatureString(route, coords);
    ASSERT_TRUE(json_str.find("null") == std::string::npos, "JSON output must not contain null");
    ASSERT_TRUE(json_str.find("NaN") == std::string::npos, "JSON output must not contain NaN");
    ASSERT_TRUE(json_str.find("Infinity") == std::string::npos, "JSON output must not contain Infinity");

    nlohmann::json parsed = nlohmann::json::parse(json_str);
    for (const auto& pt : parsed["geometry"]["coordinates"]) {
        ASSERT_TRUE(pt[0].is_number(), "Longitude must be numeric");
        ASSERT_TRUE(pt[1].is_number(), "Latitude must be numeric");
    }
    return true;
}

// Test 6: Invalid coordinate rejection (throw on NaN or out of bounds)
bool Test6_InvalidCoordinateRejection() {
    auto route = CreateMockRoute(1, 2, 100.0, 1);

    ASSERT_THROW(GeoJSONExporter::ExportFeature(route, {{std::numeric_limits<double>::quiet_NaN(), 73.0}, {26.0, 73.0}}),
                 std::invalid_argument, "NaN coordinate");

    ASSERT_THROW(GeoJSONExporter::ExportFeature(route, {{95.0, 73.0}, {26.0, 73.0}}),
                 std::invalid_argument, "Latitude > 90");

    ASSERT_THROW(GeoJSONExporter::ExportFeature(route, {{26.0, 185.0}, {26.0, 73.0}}),
                 std::invalid_argument, "Longitude > 180");
    return true;
}

// Test 7: Empty or unfound route rejection
bool Test7_EmptyRouteRejection() {
    RouteResult unfound;
    unfound.found = false;
    std::vector<GeoPoint> valid_coords = {{26.0, 73.0}, {26.1, 73.1}};

    ASSERT_THROW(GeoJSONExporter::ExportFeature(unfound, valid_coords),
                 std::invalid_argument, "Unfound route");

    auto found_route = CreateMockRoute(1, 2, 100.0, 1);
    std::vector<GeoPoint> empty_coords;
    ASSERT_THROW(GeoJSONExporter::ExportFeature(found_route, empty_coords),
                 std::invalid_argument, "Empty coordinates list");
    return true;
}

// Test 8 & 9: Parse exported JSON back into nlohmann::json and verify coordinate values
bool Test8_ParseAndVerifyRoundTrip() {
    auto route = CreateMockRoute(8520698362, 5321319416, 6198.77, 3);
    std::vector<GeoPoint> original_coords = {
        {26.291234, 73.012345},
        {26.292345, 73.013456},
        {26.293456, 73.014567}
    };

    std::string json_str = GeoJSONExporter::ExportFeatureString(route, original_coords, 2);
    nlohmann::json parsed = nlohmann::json::parse(json_str);

    ASSERT_TRUE(parsed["type"] == "Feature", "Parsed type match");
    const auto& coords_json = parsed["geometry"]["coordinates"];
    ASSERT_TRUE(coords_json.size() == original_coords.size(), "Parsed coords count match");

    for (size_t i = 0; i < original_coords.size(); ++i) {
        double lon = coords_json[i][0].get<double>();
        double lat = coords_json[i][1].get<double>();
        ASSERT_TRUE(std::abs(lon - original_coords[i].longitude) < 1e-9, "Lon round-trip match");
        ASSERT_TRUE(std::abs(lat - original_coords[i].latitude) < 1e-9, "Lat round-trip match");
    }
    return true;
}

// Test 10: FeatureCollection export
bool Test10_FeatureCollection() {
    auto route1 = CreateMockRoute(101, 102, 100.0, 1);
    auto route2 = CreateMockRoute(102, 103, 200.0, 2);

    auto feat1 = GeoJSONExporter::ExportFeature(route1, {{26.0, 73.0}, {26.1, 73.1}}, "r1");
    auto feat2 = GeoJSONExporter::ExportFeature(route2, {{26.1, 73.1}, {26.2, 73.2}}, "r2");

    nlohmann::json fc = GeoJSONExporter::ExportFeatureCollection({feat1, feat2});
    ASSERT_TRUE(fc["type"] == "FeatureCollection", "type must be FeatureCollection");
    ASSERT_TRUE(fc["features"].is_array() && fc["features"].size() == 2, "features array size must be 2");

    std::string fc_str = GeoJSONExporter::ExportFeatureCollectionString({feat1, feat2});
    nlohmann::json parsed_fc = nlohmann::json::parse(fc_str);
    ASSERT_TRUE(parsed_fc["features"].size() == 2, "parsed fc size match");
    return true;
}

// Test 11: Single-node route handling (source == destination)
bool Test11_SingleNodeRoute() {
    RouteResult single_node_route;
    single_node_route.found = true;
    single_node_route.source_osm_id = 8520698362;
    single_node_route.destination_osm_id = 8520698362;
    single_node_route.source_internal_idx = 42;
    single_node_route.destination_internal_idx = 42;
    single_node_route.total_distance_meters = 0.0;

    std::vector<GeoPoint> single_pt = {{26.291234, 73.012345}};
    nlohmann::json feat = GeoJSONExporter::ExportFeature(single_node_route, single_pt);

    ASSERT_TRUE(feat["geometry"]["type"] == "LineString", "LineString maintained");
    // Duplicate point ensures RFC 7946 valid LineString length >= 2
    ASSERT_TRUE(feat["geometry"]["coordinates"].size() == 2, "Duplicate point for RFC 7946 compliance");
    ASSERT_TRUE(feat["properties"]["zero_length_route"] == true, "zero_length_route property set");
    return true;
}

int main() {
    std::cout << "========================================================\n"
              << "RUNNING TEST SUITE: GeoJSONExporter (Phase 3.5)\n"
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

    run_test("Test 1: Valid Feature structure", Test1_ValidFeatureStructure);
    run_test("Test 2: Correct LineString geometry", Test2_LineStringGeometry);
    run_test("Test 3: Coordinate ordering [longitude, latitude]", Test3_CoordinateOrderLonLat);
    run_test("Test 4: Metadata properties serialization", Test4_MetadataProperties);
    run_test("Test 5: Numeric coordinate serialization", Test5_NumericCoordinates);
    run_test("Test 6: Invalid coordinate rejection", Test6_InvalidCoordinateRejection);
    run_test("Test 7: Empty or unfound route rejection", Test7_EmptyRouteRejection);
    run_test("Test 8 & 9: Parse and verify round trip", Test8_ParseAndVerifyRoundTrip);
    run_test("Test 10: FeatureCollection export", Test10_FeatureCollection);
    run_test("Test 11: Single-node route handling", Test11_SingleNodeRoute);

    std::cout << "========================================================\n"
              << "GEOJSON TEST SUMMARY: " << passed << " PASSED, " << failed << " FAILED\n"
              << "========================================================\n";

    return (failed == 0) ? 0 : 1;
}

