#pragma once

#include "GraphTypes.hpp"
#include "Dijkstra.hpp"
#include "json.hpp"
#include <string>
#include <vector>

namespace EmergencyRouting {

/**
 * GeoJSON Feature exporter conforming to RFC 7946.
 * Serializes reconstructed routes into standard GeoJSON LineString Features.
 *
 * CRITICAL RULE:
 * Coordinates are ALWAYS serialized in [longitude, latitude] order.
 */
class GeoJSONExporter {
public:
    /**
     * Export a reconstructed route to a GeoJSON Feature object.
     *
     * @param route The completed RouteResult.
     * @param coords The continuous reconstructed coordinate sequence [lat, lon].
     * @param route_id Optional identifier for the route feature.
     * @param geom_time_ms Optional geometry reconstruction time in milliseconds.
     * @return nlohmann::json representing the GeoJSON Feature.
     * @throws std::invalid_argument if route is not found, coordinates are empty,
     *         or coordinates contain non-finite / out-of-range values.
     */
    static nlohmann::json ExportFeature(const RouteResult& route,
                                        const std::vector<GeoPoint>& coords,
                                        const std::string& route_id = "",
                                        double geom_time_ms = 0.0);

    /**
     * Export a reconstructed route directly to a serialized GeoJSON string.
     *
     * @param route The completed RouteResult.
     * @param coords The continuous reconstructed coordinate sequence [lat, lon].
     * @param indent Indentation level (-1 for compact minified JSON).
     * @param route_id Optional identifier for the route feature.
     * @param geom_time_ms Optional geometry reconstruction time in milliseconds.
     * @return Serialized JSON string.
     */
    static std::string ExportFeatureString(const RouteResult& route,
                                           const std::vector<GeoPoint>& coords,
                                           int indent = -1,
                                           const std::string& route_id = "",
                                           double geom_time_ms = 0.0);

    /**
     * Wrap multiple GeoJSON Features into a GeoJSON FeatureCollection.
     */
    static nlohmann::json ExportFeatureCollection(const std::vector<nlohmann::json>& features);

    /**
     * Export a GeoJSON FeatureCollection to a serialized JSON string.
     */
    static std::string ExportFeatureCollectionString(const std::vector<nlohmann::json>& features,
                                                     int indent = -1);
};

} // namespace EmergencyRouting

