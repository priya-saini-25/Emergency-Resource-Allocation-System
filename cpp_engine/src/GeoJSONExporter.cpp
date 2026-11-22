#include "GeoJSONExporter.hpp"
#include <stdexcept>
#include <cmath>

namespace EmergencyRouting {

nlohmann::json GeoJSONExporter::ExportFeature(const RouteResult& route,
                                             const std::vector<GeoPoint>& coords,
                                             const std::string& route_id,
                                             double geom_time_ms) {
    if (!route.found) {
        throw std::invalid_argument("GeoJSONExporter Error: Cannot export route marked as not found");
    }

    if (coords.empty()) {
        throw std::invalid_argument("GeoJSONExporter Error: Cannot export empty coordinates list");
    }

    // Validate all coordinates are finite and within geographic bounds
    for (size_t i = 0; i < coords.size(); ++i) {
        const auto& pt = coords[i];
        if (!std::isfinite(pt.latitude) || !std::isfinite(pt.longitude)) {
            throw std::invalid_argument("GeoJSONExporter Error: Non-finite coordinate at index " + std::to_string(i));
        }
        if (pt.latitude < -90.0 || pt.latitude > 90.0 || pt.longitude < -180.0 || pt.longitude > 180.0) {
            throw std::invalid_argument("GeoJSONExporter Error: Coordinate out of bounds at index " + std::to_string(i) +
                                        " (lat=" + std::to_string(pt.latitude) + ", lon=" + std::to_string(pt.longitude) + ")");
        }
    }

    nlohmann::json coordinates_json = nlohmann::json::array();
    for (const auto& pt : coords) {
        // STRICT GEOJSON RULE: [longitude, latitude]
        coordinates_json.push_back({pt.longitude, pt.latitude});
    }

    // RFC 7946 Section 3.1.4: LineString requires two or more positions.
    // For single-node routes (source == destination), duplicate the position to maintain valid LineString syntax.
    bool is_zero_length = false;
    if (coords.size() == 1) {
        coordinates_json.push_back({coords[0].longitude, coords[0].latitude});
        is_zero_length = true;
    }

    std::string id = route_id;
    if (id.empty()) {
        id = "route_" + std::to_string(route.source_osm_id) + "_" + std::to_string(route.destination_osm_id);
    }

    nlohmann::json properties = {
        {"route_id", id},
        {"source_osm_id", route.source_osm_id},
        {"destination_osm_id", route.destination_osm_id},
        {"distance_meters", route.total_distance_meters},
        {"coordinate_count", coords.size()},
        {"edge_count", route.path_segments.size()},
        {"geometry_type", "road_network_route"},
        {"algorithm_execution_time_ms", route.algorithm_execution_time_ms},
        {"path_reconstruction_time_ms", route.path_reconstruction_time_ms},
        {"geometry_reconstruction_time_ms", geom_time_ms}
    };

    if (is_zero_length) {
        properties["zero_length_route"] = true;
    }

    nlohmann::json feature;
    feature["type"] = "Feature";
    feature["properties"] = std::move(properties);
    feature["geometry"] = {
        {"type", "LineString"},
        {"coordinates", std::move(coordinates_json)}
    };

    return feature;
}

std::string GeoJSONExporter::ExportFeatureString(const RouteResult& route,
                                                 const std::vector<GeoPoint>& coords,
                                                 int indent,
                                                 const std::string& route_id,
                                                 double geom_time_ms) {
    nlohmann::json feature = ExportFeature(route, coords, route_id, geom_time_ms);
    return feature.dump(indent);
}

nlohmann::json GeoJSONExporter::ExportFeatureCollection(const std::vector<nlohmann::json>& features) {
    nlohmann::json fc;
    fc["type"] = "FeatureCollection";
    fc["features"] = features;
    return fc;
}

std::string GeoJSONExporter::ExportFeatureCollectionString(const std::vector<nlohmann::json>& features,
                                                          int indent) {
    return ExportFeatureCollection(features).dump(indent);
}

} // namespace EmergencyRouting

