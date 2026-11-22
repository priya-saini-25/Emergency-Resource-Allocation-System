#pragma once

#include "GraphTypes.hpp"
#include <string>
#include <vector>
#include <utility>

namespace EmergencyRouting {

/**
 * Validates whether geographic coordinates lie within the approved
 * Jodhpur Urban Service Area (OSM Way 31725312).
 *
 * NOTE: The service area boundary is an academic proxy for urban emergency simulation,
 * derived from the OpenStreetMap Urban Settlement Footprint, NOT an official
 * administrative municipal boundary.
 */
class BoundaryValidator {
public:
    BoundaryValidator() = default;

    /**
     * Load boundary polygon from GeoJSON file.
     * Throws std::runtime_error if file cannot be opened or parsed.
     */
    void LoadFromFile(const std::string& filepath);

    /**
     * Load boundary polygon from GeoJSON string content.
     * Throws std::runtime_error if string cannot be parsed.
     */
    void LoadFromString(const std::string& json_content);

    /**
     * Test whether a point (lat, lon) is inside the polygon.
     * Uses ray-casting algorithm with initial bounding-box acceleration.
     * Returns false if coordinates are non-finite, out of range, or outside polygon.
     */
    bool IsInside(double latitude, double longitude) const noexcept;

    /**
     * Test whether a point is on the polygon boundary within a specified tolerance in meters.
     */
    bool IsOnBoundary(double latitude, double longitude, double tolerance_meters = 1.0) const noexcept;

    bool IsLoaded() const noexcept { return is_loaded_; }
    size_t VertexCount() const noexcept { return ring_.size(); }
    int64_t GetOsmWayId() const noexcept { return osm_way_id_; }
    const std::string& GetName() const noexcept { return name_; }

    // Returns {{min_lat, min_lon}, {max_lat, max_lon}}
    std::pair<GeoPoint, GeoPoint> GetBoundingBox() const noexcept {
        return {GeoPoint{min_lat_, min_lon_}, GeoPoint{max_lat_, max_lon_}};
    }

    const std::vector<GeoPoint>& GetRing() const noexcept { return ring_; }

private:
    void ParseGeoJson(const void* parsed_json_ptr);

    std::vector<GeoPoint> ring_; // Coordinates in internal order: {latitude, longitude}
    double min_lat_{90.0};
    double max_lat_{-90.0};
    double min_lon_{180.0};
    double max_lon_{-180.0};
    int64_t osm_way_id_{0};
    std::string name_;
    bool is_loaded_{false};
};

} // namespace EmergencyRouting

