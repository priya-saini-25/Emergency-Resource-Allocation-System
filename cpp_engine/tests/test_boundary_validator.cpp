#include "BoundaryValidator.hpp"
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

// Helper to create a simple square polygon GeoJSON string: [10, 10] to [20, 20]
// Note: GeoJSON order is [longitude, latitude]
std::string CreateSquarePolygonGeoJson() {
    return R"({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"osm_id": 99999, "name": "TestSquare"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [10.0, 10.0],
                    [20.0, 10.0],
                    [20.0, 20.0],
                    [10.0, 20.0],
                    [10.0, 10.0]
                ]]
            }
        }]
    })";
}

// Test 1: Point clearly inside polygon
bool Test1_PointClearlyInside() {
    BoundaryValidator val;
    val.LoadFromString(CreateSquarePolygonGeoJson());
    ASSERT_TRUE(val.IsLoaded(), "Validator should be loaded");

    // Center point: lat=15.0, lon=15.0
    ASSERT_TRUE(val.IsInside(15.0, 15.0), "Center (15, 15) must be inside");
    ASSERT_TRUE(val.IsInside(12.0, 18.0), "(12, 18) must be inside");
    return true;
}

// Test 2: Point clearly outside polygon
bool Test2_PointClearlyOutside() {
    BoundaryValidator val;
    val.LoadFromString(CreateSquarePolygonGeoJson());

    ASSERT_TRUE(!val.IsInside(5.0, 15.0), "Point south (5, 15) must be outside");
    ASSERT_TRUE(!val.IsInside(25.0, 15.0), "Point north (25, 15) must be outside");
    ASSERT_TRUE(!val.IsInside(15.0, 5.0), "Point west (15, 5) must be outside");
    ASSERT_TRUE(!val.IsInside(15.0, 25.0), "Point east (15, 25) must be outside");
    return true;
}

// Test 3: Point on polygon boundary
bool Test3_PointOnBoundary() {
    BoundaryValidator val;
    val.LoadFromString(CreateSquarePolygonGeoJson());

    // Point exactly on bottom edge: lat=10.0, lon=15.0
    ASSERT_TRUE(val.IsOnBoundary(10.0, 15.0, 1.0), "Exact edge point must be recognized on boundary");
    ASSERT_TRUE(val.IsOnBoundary(20.0, 15.0, 1.0), "Exact top edge point must be recognized on boundary");
    ASSERT_TRUE(val.IsOnBoundary(15.0, 10.0, 1.0), "Exact left edge point must be recognized on boundary");
    ASSERT_TRUE(val.IsOnBoundary(15.0, 20.0, 1.0), "Exact right edge point must be recognized on boundary");
    return true;
}

// Test 4: Point near polygon boundary
bool Test4_PointNearBoundary() {
    BoundaryValidator val;
    val.LoadFromString(CreateSquarePolygonGeoJson());

    // Point 0.5 meters outside bottom edge (approx 0.000005 deg)
    ASSERT_TRUE(val.IsOnBoundary(9.999995, 15.0, 2.0), "Point 0.5m outside recognized within 2m tolerance");
    ASSERT_TRUE(!val.IsOnBoundary(9.9, 15.0, 2.0), "Point far away not recognized on boundary");
    return true;
}

// Test 5: Invalid coordinate ranges
bool Test5_InvalidCoordinateRanges() {
    BoundaryValidator val;
    val.LoadFromString(CreateSquarePolygonGeoJson());

    ASSERT_TRUE(!val.IsInside(95.0, 15.0), "Lat > 90 must return false");
    ASSERT_TRUE(!val.IsInside(-95.0, 15.0), "Lat < -90 must return false");
    ASSERT_TRUE(!val.IsInside(15.0, 185.0), "Lon > 180 must return false");
    ASSERT_TRUE(!val.IsInside(15.0, -185.0), "Lon < -180 must return false");
    return true;
}

// Test 6: NaN and Infinity handling
bool Test6_NanAndInfinity() {
    BoundaryValidator val;
    val.LoadFromString(CreateSquarePolygonGeoJson());

    ASSERT_TRUE(!val.IsInside(std::numeric_limits<double>::quiet_NaN(), 15.0), "NaN lat must return false");
    ASSERT_TRUE(!val.IsInside(15.0, std::numeric_limits<double>::quiet_NaN()), "NaN lon must return false");
    ASSERT_TRUE(!val.IsInside(std::numeric_limits<double>::infinity(), 15.0), "Inf lat must return false");
    ASSERT_TRUE(!val.IsInside(15.0, std::numeric_limits<double>::infinity()), "Inf lon must return false");
    return true;
}

// Test 7: Invalid or empty polygon structure
bool Test7_InvalidPolygon() {
    BoundaryValidator val;
    // Missing coordinates
    ASSERT_THROW(val.LoadFromString(R"({"type": "Polygon"})"), std::runtime_error, "Missing coordinates");
    // Non-polygon type
    ASSERT_THROW(val.LoadFromString(R"({"type": "Point", "coordinates": [10.0, 10.0]})"), std::runtime_error, "Non-polygon");
    // Less than 4 points
    ASSERT_THROW(val.LoadFromString(R"({"type": "Polygon", "coordinates": [[[10, 10], [20, 20], [10, 10]]]})"),
                 std::runtime_error, "Less than 4 positions");
    return true;
}

// Test 8: Incorrect ring closure rejection
bool Test8_IncorrectRingClosure() {
    BoundaryValidator val;
    // Ring first position (10, 10) != last position (15, 15)
    std::string unclosed_json = R"({
        "type": "Polygon",
        "coordinates": [[
            [10.0, 10.0],
            [20.0, 10.0],
            [20.0, 20.0],
            [15.0, 15.0]
        ]]
    })";
    ASSERT_THROW(val.LoadFromString(unclosed_json), std::runtime_error, "Unclosed ring");
    return true;
}

// Test 9: Correct GeoJSON longitude/latitude interpretation
bool Test9_GeoJsonLonLatInterpretation() {
    // Asymmetric polygon: Lon [10, 30], Lat [50, 60]
    // GeoJSON: [[lon, lat], ...]
    std::string asymm_json = R"({
        "type": "Polygon",
        "coordinates": [[
            [10.0, 50.0],
            [30.0, 50.0],
            [30.0, 60.0],
            [10.0, 60.0],
            [10.0, 50.0]
        ]]
    })";
    BoundaryValidator val;
    val.LoadFromString(asymm_json);

    auto [bbox_min, bbox_max] = val.GetBoundingBox();
    ASSERT_TRUE(std::abs(bbox_min.latitude - 50.0) < 1e-6, "BBox min_lat should be 50.0");
    ASSERT_TRUE(std::abs(bbox_max.latitude - 60.0) < 1e-6, "BBox max_lat should be 60.0");
    ASSERT_TRUE(std::abs(bbox_min.longitude - 10.0) < 1e-6, "BBox min_lon should be 10.0");
    ASSERT_TRUE(std::abs(bbox_max.longitude - 30.0) < 1e-6, "BBox max_lon should be 30.0");

    // Query (lat=55.0, lon=20.0) -> inside
    ASSERT_TRUE(val.IsInside(55.0, 20.0), "Inside asymmetric box");
    // Swapped coordinates query (lat=20.0, lon=55.0) -> outside
    ASSERT_TRUE(!val.IsInside(20.0, 55.0), "Swapped coordinates must be rejected");
    return true;
}

// Test 10: Bounding-box false positive rejected by actual polygon test
bool Test10_BboxFalsePositiveRejected() {
    // Triangle with vertices: (10, 10), (20, 10), (10, 20), (10, 10)
    // Bounding box is Lon [10, 20], Lat [10, 20].
    // The top-right corner (Lat 19.0, Lon 19.0) is inside bbox, but outside the triangle!
    std::string triangle_json = R"({
        "type": "Polygon",
        "coordinates": [[
            [10.0, 10.0],
            [20.0, 10.0],
            [10.0, 20.0],
            [10.0, 10.0]
        ]]
    })";
    BoundaryValidator val;
    val.LoadFromString(triangle_json);

    // Inside triangle
    ASSERT_TRUE(val.IsInside(12.0, 12.0), "Point (12, 12) inside triangle");

    // Inside bbox but outside triangle: Lat 18.0, Lon 18.0
    ASSERT_TRUE(!val.IsInside(18.0, 18.0), "Point (18, 18) inside bbox but outside triangle MUST be rejected");
    return true;
}

// Test 11: Canonical Jodhpur Urban Service Area boundary verification
bool Test11_CanonicalJodhpurBoundary() {
    BoundaryValidator val;
    val.LoadFromFile("data/jodhpur_boundary.geojson");
    ASSERT_TRUE(val.IsLoaded(), "Canonical boundary must load");
    ASSERT_TRUE(val.GetOsmWayId() == 31725312, "OSM Way ID must be 31725312");
    ASSERT_TRUE(val.VertexCount() == 46, "Vertex count must be 46");

    auto [bbox_min, bbox_max] = val.GetBoundingBox();
    ASSERT_TRUE(bbox_min.latitude >= 26.20 && bbox_max.latitude <= 26.36, "Latitude bounds match");
    ASSERT_TRUE(bbox_min.longitude >= 72.94 && bbox_max.longitude <= 73.10, "Longitude bounds match");

    // Known facilities inside Jodhpur
    ASSERT_TRUE(val.IsInside(26.257643, 73.007812), "AIIMS Jodhpur must be inside");
    ASSERT_TRUE(val.IsInside(26.291200, 73.023400), "Sojati Gate must be inside");
    ASSERT_TRUE(val.IsInside(26.297800, 73.018500), "Mehrangarh Fort must be inside");

    // Outside service area points
    ASSERT_TRUE(!val.IsInside(26.15, 73.00), "Far south must be outside");
    ASSERT_TRUE(!val.IsInside(26.45, 73.05), "Far north must be outside");
    ASSERT_TRUE(!val.IsInside(26.28, 73.25), "Far east must be outside");
    ASSERT_TRUE(!val.IsInside(26.28, 72.80), "Far west must be outside");

    // Bounding box corner test (inside bbox, outside actual polygon ring)
    ASSERT_TRUE(!val.IsInside(bbox_max.latitude - 0.001, bbox_min.longitude + 0.001),
                "North-west bbox corner must be rejected by polygon test");

    return true;
}

int main() {
    std::cout << "========================================================\n"
              << "RUNNING TEST SUITE: BoundaryValidator (Phase 3.6)\n"
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

    run_test("Test 1: Point clearly inside polygon", Test1_PointClearlyInside);
    run_test("Test 2: Point clearly outside polygon", Test2_PointClearlyOutside);
    run_test("Test 3: Point on polygon boundary", Test3_PointOnBoundary);
    run_test("Test 4: Point near polygon boundary", Test4_PointNearBoundary);
    run_test("Test 5: Invalid coordinate ranges", Test5_InvalidCoordinateRanges);
    run_test("Test 6: NaN and Infinity handling", Test6_NanAndInfinity);
    run_test("Test 7: Invalid or empty polygon structure", Test7_InvalidPolygon);
    run_test("Test 8: Incorrect ring closure rejection", Test8_IncorrectRingClosure);
    run_test("Test 9: GeoJSON lon/lat interpretation", Test9_GeoJsonLonLatInterpretation);
    run_test("Test 10: Bbox false positive rejected by polygon test", Test10_BboxFalsePositiveRejected);
    run_test("Test 11: Canonical Jodhpur boundary verification", Test11_CanonicalJodhpurBoundary);

    std::cout << "========================================================\n"
              << "BOUNDARY VALIDATOR SUMMARY: " << passed << " PASSED, " << failed << " FAILED\n"
              << "========================================================\n";

    return (failed == 0) ? 0 : 1;
}

