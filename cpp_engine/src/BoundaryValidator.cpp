#include "BoundaryValidator.hpp"
#include "RouteGeometry.hpp"
#include "json.hpp"
#include <fstream>
#include <cmath>
#include <stdexcept>
#include <algorithm>

using json = nlohmann::json;

namespace EmergencyRouting {

void BoundaryValidator::LoadFromFile(const std::string& filepath) {
    std::ifstream file(filepath, std::ios::in | std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("BoundaryValidator Error: Cannot open file: " + filepath);
    }

    json root;
    try {
        file >> root;
    } catch (const json::parse_error& e) {
        throw std::runtime_error("BoundaryValidator Error: JSON parse error in " + filepath + ": " + e.what());
    }

    ParseGeoJson(&root);
}

void BoundaryValidator::LoadFromString(const std::string& json_content) {
    json root;
    try {
        root = json::parse(json_content);
    } catch (const json::parse_error& e) {
        throw std::runtime_error("BoundaryValidator Error: JSON parse error: " + std::string(e.what()));
    }

    ParseGeoJson(&root);
}

void BoundaryValidator::ParseGeoJson(const void* parsed_json_ptr) {
    if (!parsed_json_ptr) {
        throw std::runtime_error("BoundaryValidator Error: Null JSON pointer provided");
    }

    const json& root = *static_cast<const json*>(parsed_json_ptr);

    // Locate geometry: can be FeatureCollection, Feature, or Geometry
    json geom;
    json props;

    if (root.contains("type") && root["type"] == "FeatureCollection") {
        if (!root.contains("features") || !root["features"].is_array() || root["features"].empty()) {
            throw std::runtime_error("BoundaryValidator Error: FeatureCollection has no features");
        }
        const auto& feat = root["features"][0];
        if (!feat.contains("geometry")) {
            throw std::runtime_error("BoundaryValidator Error: Feature has no geometry");
        }
        geom = feat["geometry"];
        if (feat.contains("properties") && feat["properties"].is_object()) {
            props = feat["properties"];
        }
    } else if (root.contains("type") && root["type"] == "Feature") {
        if (!root.contains("geometry")) {
            throw std::runtime_error("BoundaryValidator Error: Feature has no geometry");
        }
        geom = root["geometry"];
        if (root.contains("properties") && root["properties"].is_object()) {
            props = root["properties"];
        }
    } else if (root.contains("type") && root["type"] == "Polygon") {
        geom = root;
    } else {
        throw std::runtime_error("BoundaryValidator Error: Unrecognized GeoJSON structure for boundary");
    }

    if (!geom.contains("type") || geom["type"] != "Polygon") {
        throw std::runtime_error("BoundaryValidator Error: Geometry type must be Polygon, found: " +
                                 geom.value("type", "unknown"));
    }

    if (!geom.contains("coordinates") || !geom["coordinates"].is_array() || geom["coordinates"].empty()) {
        throw std::runtime_error("BoundaryValidator Error: Polygon has empty or invalid coordinates");
    }

    const auto& outer_ring = geom["coordinates"][0];
    if (!outer_ring.is_array() || outer_ring.size() < 4) {
        throw std::runtime_error("BoundaryValidator Error: Linear ring must contain at least 4 positions, found: " +
                                 std::to_string(outer_ring.size()));
    }

    // Check closure: first position must equal last position
    const auto& first_pt = outer_ring.front();
    const auto& last_pt = outer_ring.back();
    if (first_pt.size() < 2 || last_pt.size() < 2 ||
        std::abs(first_pt[0].get<double>() - last_pt[0].get<double>()) > 1e-9 ||
        std::abs(first_pt[1].get<double>() - last_pt[1].get<double>()) > 1e-9) {
        throw std::runtime_error("BoundaryValidator Error: Linear ring is not closed (first != last)");
    }

    ring_.clear();
    ring_.reserve(outer_ring.size());
    min_lat_ = 90.0;
    max_lat_ = -90.0;
    min_lon_ = 180.0;
    max_lon_ = -180.0;

    for (size_t i = 0; i < outer_ring.size(); ++i) {
        const auto& pt = outer_ring[i];
        if (!pt.is_array() || pt.size() < 2 || !pt[0].is_number() || !pt[1].is_number()) {
            throw std::runtime_error("BoundaryValidator Error: Invalid position at index " + std::to_string(i));
        }

        // STRICT GEOJSON RULE: [longitude, latitude]
        const double lon = pt[0].get<double>();
        const double lat = pt[1].get<double>();

        if (!std::isfinite(lat) || !std::isfinite(lon)) {
            throw std::runtime_error("BoundaryValidator Error: Non-finite coordinate at index " + std::to_string(i));
        }
        if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) {
            throw std::runtime_error("BoundaryValidator Error: Coordinate out of bounds [-90, 90] / [-180, 180] at index " +
                                     std::to_string(i));
        }

        ring_.push_back(GeoPoint{lat, lon});
        min_lat_ = std::min(min_lat_, lat);
        max_lat_ = std::max(max_lat_, lat);
        min_lon_ = std::min(min_lon_, lon);
        max_lon_ = std::max(max_lon_, lon);
    }

    if (props.is_object()) {
        osm_way_id_ = props.value("osm_id", int64_t{0});
        name_ = props.value("name", "");
    }

    is_loaded_ = true;
}

bool BoundaryValidator::IsInside(double latitude, double longitude) const noexcept {
    if (!is_loaded_) {
        return false;
    }

    if (!std::isfinite(latitude) || !std::isfinite(longitude) ||
        latitude < -90.0 || latitude > 90.0 || longitude < -180.0 || longitude > 180.0) {
        return false;
    }

    // Preliminary bounding box acceleration: reject points clearly outside
    if (latitude < min_lat_ || latitude > max_lat_ ||
        longitude < min_lon_ || longitude > max_lon_) {
        return false;
    }

    // Standard Ray-Casting algorithm on closed linear ring
    const size_t n = ring_.size();
    bool inside = false;

    for (size_t i = 0, j = n - 1; i < n; j = i++) {
        const double yi = ring_[i].latitude;
        const double xi = ring_[i].longitude;
        const double yj = ring_[j].latitude;
        const double xj = ring_[j].longitude;

        if ((yi > latitude) != (yj > latitude)) {
            const double xinters = (latitude - yi) * (xj - xi) / (yj - yi) + xi;
            if (longitude <= xinters) {
                inside = !inside;
            }
        }
    }

    return inside;
}

bool BoundaryValidator::IsOnBoundary(double latitude, double longitude, double tolerance_meters) const noexcept {
    if (!is_loaded_ || ring_.empty()) {
        return false;
    }

    if (!std::isfinite(latitude) || !std::isfinite(longitude)) {
        return false;
    }

    // Check distance to each segment of the ring
    const size_t n = ring_.size();
    for (size_t i = 0; i < n - 1; ++i) {
        const auto& p1 = ring_[i];
        const auto& p2 = ring_[i + 1];

        // Projected point on segment (p1 -> p2)
        const double d_lat = p2.latitude - p1.latitude;
        const double d_lon = p2.longitude - p1.longitude;
        const double len_sq = d_lat * d_lat + d_lon * d_lon;

        double t = 0.0;
        if (len_sq > 1e-15) {
            t = ((latitude - p1.latitude) * d_lat + (longitude - p1.longitude) * d_lon) / len_sq;
            t = std::max(0.0, std::min(1.0, t));
        }

        const double proj_lat = p1.latitude + t * d_lat;
        const double proj_lon = p1.longitude + t * d_lon;

        const double d_m = RouteGeometry::HaversineDistanceMeters(latitude, longitude, proj_lat, proj_lon);
        if (d_m <= tolerance_meters) {
            return true;
        }
    }

    return false;
}

} // namespace EmergencyRouting

