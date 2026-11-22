#pragma once

#include "GraphTypes.hpp"
#include "Graph.hpp"
#include "Dijkstra.hpp"
#include <vector>
#include <string>
#include <cmath>

namespace EmergencyRouting {

/**
 * Result structure for route geometry reconstruction.
 */
struct RouteGeometryResult {
    bool success{false};
    std::string error_message;
    std::vector<GeoPoint> coordinates; // Continuous ordered sequence [latitude, longitude]
    double total_haversine_distance_meters{0.0};
    size_t segments_processed{0};
    size_t duplicate_junctions_removed{0};
    size_t reversed_segments_count{0};
    double reconstruction_time_ms{0.0};
};

/**
 * Route geometry reconstruction engine.
 * Assembles continuous polyline geometries from Dijkstra-selected directed edges,
 * verifies coordinate orientation, eliminates redundant junction duplicates,
 * and detects disconnected geometry gaps.
 */
class RouteGeometry {
public:
    // Geographic tolerance in degrees (~1.11m lat, ~0.99m lon at 26.3°N)
    static constexpr double TOLERANCE_DEGREES = 1e-5;

    // Geographic tolerance in meters for junction continuity and endpoint alignment
    static constexpr double TOLERANCE_METERS = 2.0;

    /**
     * Reconstruct continuous route geometry from a completed RouteResult.
     * Uses the exact directed edges selected by Dijkstra.
     *
     * @param graph The road network graph storing nodes and geometry pool.
     * @param route The completed RouteResult containing ordered PathSegments.
     * @return RouteGeometryResult with status, coordinates, and metrics.
     */
    static RouteGeometryResult Reconstruct(const Graph& graph, const RouteResult& route);

    /**
     * Validates that a reconstructed coordinate sequence is complete, valid,
     * continuous, and matches the route endpoints.
     *
     * @param graph The road network graph.
     * @param route The completed RouteResult.
     * @param coords The reconstructed coordinate sequence.
     * @param out_error Output string describing failure reason if validation fails.
     * @return true if valid, false otherwise.
     */
    static bool Validate(const Graph& graph,
                         const RouteResult& route,
                         const std::vector<GeoPoint>& coords,
                         std::string& out_error);

    /**
     * Calculate great-circle Haversine distance between two coordinates in meters.
     * Uses the IUGG standard mean Earth radius R = 6,371,008.8 meters.
     */
    static double HaversineDistanceMeters(double lat1, double lon1, double lat2, double lon2);
    static double HaversineDistanceMeters(const GeoPoint& p1, const GeoPoint& p2);

    /**
     * Calculate total cumulative Haversine distance along a polyline in meters.
     */
    static double CalculateHaversineDistance(const std::vector<GeoPoint>& coords);
};

} // namespace EmergencyRouting

