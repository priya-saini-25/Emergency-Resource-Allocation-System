#include "PolylineEncoder.hpp"
#include <iostream>
#include <vector>
#include <cmath>
#include <cassert>
#include <string>
#include <chrono>

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

// Test 1: Basic single-coordinate encoding
bool Test1_BasicEncoding() {
    std::vector<GeoPoint> pts = {{26.29123, 73.01234}};
    std::string encoded = PolylineEncoder::Encode(pts);
    ASSERT_TRUE(!encoded.empty(), "Encoded string should not be empty");

    std::vector<GeoPoint> decoded = PolylineEncoder::Decode(encoded);
    ASSERT_TRUE(decoded.size() == 1, "Decoded size must be 1");
    ASSERT_TRUE(std::abs(decoded[0].latitude - pts[0].latitude) < 1e-5, "Latitude match within 1e-5");
    ASSERT_TRUE(std::abs(decoded[0].longitude - pts[0].longitude) < 1e-5, "Longitude match within 1e-5");
    return true;
}

// Test 2: Positive latitude and longitude
bool Test2_PositiveCoordinates() {
    std::vector<GeoPoint> pts = {
        {26.29123, 73.01234},
        {26.29500, 73.01800}
    };
    std::string encoded = PolylineEncoder::Encode(pts);
    std::vector<GeoPoint> decoded = PolylineEncoder::Decode(encoded);
    ASSERT_TRUE(decoded.size() == 2, "Decoded size must be 2");
    for (size_t i = 0; i < pts.size(); ++i) {
        ASSERT_TRUE(std::abs(decoded[i].latitude - pts[i].latitude) < 1e-5, "Latitude match");
        ASSERT_TRUE(std::abs(decoded[i].longitude - pts[i].longitude) < 1e-5, "Longitude match");
    }
    return true;
}

// Test 3: Negative latitude and longitude
bool Test3_NegativeCoordinates() {
    std::vector<GeoPoint> pts = {
        {-33.86882, 151.20930},  // Sydney
        {-37.81363, 144.96306},  // Melbourne
        {-34.60372, -58.38159}   // Buenos Aires (both negative)
    };
    std::string encoded = PolylineEncoder::Encode(pts);
    std::vector<GeoPoint> decoded = PolylineEncoder::Decode(encoded);
    ASSERT_TRUE(decoded.size() == 3, "Decoded size must be 3");
    for (size_t i = 0; i < pts.size(); ++i) {
        ASSERT_TRUE(std::abs(decoded[i].latitude - pts[i].latitude) < 1e-5, "Latitude match");
        ASSERT_TRUE(std::abs(decoded[i].longitude - pts[i].longitude) < 1e-5, "Longitude match");
    }
    return true;
}

// Test 4: Coordinate delta encoding
bool Test4_DeltaEncoding() {
    // Points with varying positive and negative deltas
    std::vector<GeoPoint> pts = {
        {26.00000, 73.00000},
        {26.00100, 73.00200}, // +delta, +delta
        {26.00050, 73.00100}, // -delta, -delta
        {26.00200, 73.00050}  // +delta, -delta
    };
    std::string encoded = PolylineEncoder::Encode(pts);
    std::vector<GeoPoint> decoded = PolylineEncoder::Decode(encoded);
    ASSERT_TRUE(decoded.size() == 4, "Decoded size must be 4");
    for (size_t i = 0; i < pts.size(); ++i) {
        ASSERT_TRUE(std::abs(decoded[i].latitude - pts[i].latitude) < 1e-5, "Delta decode match");
        ASSERT_TRUE(std::abs(decoded[i].longitude - pts[i].longitude) < 1e-5, "Delta decode match");
    }
    return true;
}

// Test 5: Google official documentation test vector
// From: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
// Points: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
// Expected encoded string: "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
bool Test5_GoogleOfficialVector() {
    std::vector<GeoPoint> google_pts = {
        {38.5, -120.2},
        {40.7, -120.95},
        {43.252, -126.453}
    };
    const std::string expected_google_polyline = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

    std::string encoded = PolylineEncoder::Encode(google_pts);
    ASSERT_TRUE(encoded == expected_google_polyline,
                "Encoded string does not match Google official test vector. Got: " + encoded +
                ", Expected: " + expected_google_polyline);

    std::vector<GeoPoint> decoded = PolylineEncoder::Decode(expected_google_polyline);
    ASSERT_TRUE(decoded.size() == 3, "Decoded size must be 3");
    for (size_t i = 0; i < google_pts.size(); ++i) {
        ASSERT_TRUE(std::abs(decoded[i].latitude - google_pts[i].latitude) < 1e-5, "Google pt match");
        ASSERT_TRUE(std::abs(decoded[i].longitude - google_pts[i].longitude) < 1e-5, "Google pt match");
    }
    return true;
}

// Test 6: Precision-5 decoding accuracy
bool Test6_PrecisionAccuracy() {
    // Check points with high decimal precision to verify 1e-5 quantization behavior
    std::vector<GeoPoint> pts = {
        {26.291234567, 73.012345678},
        {26.291244567, 73.012355678}
    };
    std::string encoded = PolylineEncoder::Encode(pts);
    std::vector<GeoPoint> decoded = PolylineEncoder::Decode(encoded);
    ASSERT_TRUE(decoded.size() == 2, "Decoded size must be 2");

    // The maximum quantization error of precision 5 is 0.5 * 1e-5 = 5e-6
    for (size_t i = 0; i < pts.size(); ++i) {
        double dlat = std::abs(decoded[i].latitude - pts[i].latitude);
        double dlon = std::abs(decoded[i].longitude - pts[i].longitude);
        ASSERT_TRUE(dlat < 1e-5, "Quantization error exceeds 1e-5 for latitude");
        ASSERT_TRUE(dlon < 1e-5, "Quantization error exceeds 1e-5 for longitude");
    }
    return true;
}

// Test 7: Empty input handling
bool Test7_EmptyInput() {
    std::vector<GeoPoint> empty_pts;
    std::string encoded = PolylineEncoder::Encode(empty_pts);
    ASSERT_TRUE(encoded.empty(), "Encoding empty vector must return empty string");

    std::vector<GeoPoint> decoded = PolylineEncoder::Decode("");
    ASSERT_TRUE(decoded.empty(), "Decoding empty string must return empty vector");
    return true;
}

// Test 8: Invalid coordinate and malformed string handling
bool Test8_InvalidInputs() {
    // Non-finite
    ASSERT_THROW(PolylineEncoder::Encode({{std::numeric_limits<double>::quiet_NaN(), 73.0}}),
                 std::invalid_argument, "NaN latitude");
    ASSERT_THROW(PolylineEncoder::Encode({{26.0, std::numeric_limits<double>::infinity()}}),
                 std::invalid_argument, "Infinity longitude");

    // Out of bounds
    ASSERT_THROW(PolylineEncoder::Encode({{95.0, 73.0}}), std::invalid_argument, "Lat > 90");
    ASSERT_THROW(PolylineEncoder::Encode({{-95.0, 73.0}}), std::invalid_argument, "Lat < -90");
    ASSERT_THROW(PolylineEncoder::Encode({{26.0, 185.0}}), std::invalid_argument, "Lon > 180");
    ASSERT_THROW(PolylineEncoder::Encode({{26.0, -185.0}}), std::invalid_argument, "Lon < -180");

    // Malformed decode strings: invalid characters
    ASSERT_THROW(PolylineEncoder::Decode("!@#$%^"), std::invalid_argument, "Invalid character < 63");
    // Truncated string (missing second coordinate delta)
    ASSERT_THROW(PolylineEncoder::Decode("_p~iF"), std::invalid_argument, "Truncated polyline");

    return true;
}

// Test 9: Encode-decode round-trip across 1,000 synthetic trajectory coordinates
bool Test9_LargeRoundTrip() {
    std::vector<GeoPoint> pts;
    pts.reserve(1000);
    double lat = 26.25;
    double lon = 73.00;
    for (int i = 0; i < 1000; ++i) {
        pts.push_back(GeoPoint{lat, lon});
        lat += 0.0001 * std::sin(i * 0.1);
        lon += 0.0001 * std::cos(i * 0.1);
    }

    auto t0 = std::chrono::steady_clock::now();
    std::string encoded = PolylineEncoder::Encode(pts);
    auto t1 = std::chrono::steady_clock::now();
    std::vector<GeoPoint> decoded = PolylineEncoder::Decode(encoded);
    auto t2 = std::chrono::steady_clock::now();

    ASSERT_TRUE(decoded.size() == pts.size(), "Size match for 1,000 points");
    double max_err = 0.0;
    for (size_t i = 0; i < pts.size(); ++i) {
        double dlat = std::abs(decoded[i].latitude - pts[i].latitude);
        double dlon = std::abs(decoded[i].longitude - pts[i].longitude);
        max_err = std::max(max_err, std::max(dlat, dlon));
        ASSERT_TRUE(dlat < 1e-5 && dlon < 1e-5, "Round-trip precision match");
    }

    double encode_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    double decode_ms = std::chrono::duration<double, std::milli>(t2 - t1).count();

    std::cout << "  [INFO] 1,000 points encoded string length: " << encoded.size() << " bytes\n"
              << "  [INFO] Encode time: " << encode_ms << " ms (" << (pts.size() / (encode_ms * 1000.0)) << " Mpts/s)\n"
              << "  [INFO] Decode time: " << decode_ms << " ms (" << (pts.size() / (decode_ms * 1000.0)) << " Mpts/s)\n"
              << "  [INFO] Max quantization deviation: " << max_err << " deg\n";

    return true;
}

int main() {
    std::cout << "========================================================\n"
              << "RUNNING TEST SUITE: PolylineEncoder (Phase 3.5)\n"
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

    run_test("Test 1: Basic single-coordinate encoding", Test1_BasicEncoding);
    run_test("Test 2: Positive latitude and longitude", Test2_PositiveCoordinates);
    run_test("Test 3: Negative latitude and longitude", Test3_NegativeCoordinates);
    run_test("Test 4: Coordinate delta encoding", Test4_DeltaEncoding);
    run_test("Test 5: Google official documentation test vector", Test5_GoogleOfficialVector);
    run_test("Test 6: Precision-5 decoding accuracy", Test6_PrecisionAccuracy);
    run_test("Test 7: Empty input handling", Test7_EmptyInput);
    run_test("Test 8: Invalid coordinate and malformed string handling", Test8_InvalidInputs);
    run_test("Test 9: Encode-decode round-trip across 1,000 points", Test9_LargeRoundTrip);

    std::cout << "========================================================\n"
              << "POLYLINE TEST SUMMARY: " << passed << " PASSED, " << failed << " FAILED\n"
              << "========================================================\n";

    return (failed == 0) ? 0 : 1;
}

