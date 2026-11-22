#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <string_view>

namespace EmergencyRouting {

/**
 * Geographic coordinate pair in WGS84 (EPSG:4326).
 */
struct GeoPoint {
    double latitude{0.0};
    double longitude{0.0};

    bool operator==(const GeoPoint& other) const noexcept {
        return latitude == other.latitude && longitude == other.longitude;
    }
};

/**
 * In-memory vertex record storing authentic 64-bit OSM ID and geographic coordinates.
 */
struct NodeRecord {
    int64_t osm_id{0};             // Authentic 64-bit OpenStreetMap Node ID
    double latitude{0.0};          // Geographic latitude (EPSG:4326)
    double longitude{0.0};         // Geographic longitude (EPSG:4326)
    bool is_boundary{false};       // Intersection with urban boundary
};

/**
 * Directed edge representation storing double-precision weight, classification, access, and geometry references.
 */
struct EdgeRecord {
    uint32_t target_idx{0};        // Target node internal dense index [0, V-1]
    double distance_meters{0.0};   // Segment weight in meters (double precision)
    int64_t osm_way_id{0};         // Original OSM Way identifier
    uint16_t road_type_id{0};      // Index into road type table
    uint16_t name_id{0};           // Index into string pool of road names
    uint16_t access_id{0};         // Index into access table ("yes", "permissive", etc.)
    bool oneway{true};             // Original directionality flag
    uint32_t geometry_offset{0};   // Offset into shared polyline coordinate buffer
    uint16_t geometry_count{0};    // Number of intermediate geometry coordinate pairs
};

/**
 * Road classification utilities and nominal speed profiles (km/h) for travel time estimation.
 */
inline const std::vector<std::string>& GetStandardRoadTypes() {
    static const std::vector<std::string> types = {
        "living_street",   // 0
        "primary",         // 1
        "primary_link",    // 2
        "residential",     // 3
        "secondary",       // 4
        "secondary_link",  // 5
        "service",         // 6
        "tertiary",        // 7
        "tertiary_link",   // 8
        "trunk",           // 9
        "trunk_link",      // 10
        "unclassified",    // 11
        "unknown"          // 12
    };
    return types;
}

inline uint16_t RoadTypeToId(std::string_view type_str) {
    const auto& types = GetStandardRoadTypes();
    for (size_t i = 0; i < types.size() - 1; ++i) {
        if (types[i] == type_str) {
            return static_cast<uint16_t>(i);
        }
    }
    return static_cast<uint16_t>(types.size() - 1); // "unknown"
}

inline const std::string& IdToRoadType(uint16_t type_id) {
    const auto& types = GetStandardRoadTypes();
    if (type_id < types.size()) {
        return types[type_id];
    }
    return types.back(); // "unknown"
}

/**
 * Access classification utilities.
 */
inline const std::vector<std::string>& GetStandardAccessTypes() {
    static const std::vector<std::string> access = {
        "yes",          // 0
        "permissive",   // 1
        "destination",  // 2
        "unknown"       // 3
    };
    return access;
}

inline uint16_t AccessTypeToId(std::string_view access_str) {
    const auto& access = GetStandardAccessTypes();
    for (size_t i = 0; i < access.size() - 1; ++i) {
        if (access[i] == access_str) {
            return static_cast<uint16_t>(i);
        }
    }
    return static_cast<uint16_t>(access.size() - 1); // "unknown"
}

inline const std::string& IdToAccessType(uint16_t access_id) {
    const auto& access = GetStandardAccessTypes();
    if (access_id < access.size()) {
        return access[access_id];
    }
    return access.back();
}

/**
 * Nominal speed profile in km/h for urban simulation in Jodhpur.
 * Note: These are static simulation parameters, not live traffic feeds.
 */
inline double GetNominalSpeedKmh(uint16_t type_id) {
    switch (type_id) {
        case 9:  return 50.0; // trunk
        case 10: return 40.0; // trunk_link
        case 1:  return 40.0; // primary
        case 2:  return 30.0; // primary_link
        case 4:  return 35.0; // secondary
        case 5:  return 25.0; // secondary_link
        case 7:  return 30.0; // tertiary
        case 8:  return 20.0; // tertiary_link
        case 3:  return 25.0; // residential
        case 11: return 25.0; // unclassified
        case 0:  return 15.0; // living_street
        case 6:  return 15.0; // service
        default: return 25.0; // unknown/default
    }
}

} // namespace EmergencyRouting
