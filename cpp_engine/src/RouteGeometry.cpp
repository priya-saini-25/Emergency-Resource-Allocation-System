#include "RouteGeometry.hpp"
#include <algorithm>
#include <cmath>
#include <chrono>
#include <iostream>

namespace EmergencyRouting {

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr double TO_RAD = PI / 180.0;
constexpr double EARTH_RADIUS_METERS = 6371008.8; // IUGG standard

} // anonymous namespace

double RouteGeometry::HaversineDistanceMeters(double lat1, double lon1, double lat2, double lon2) {
    if (!std::isfinite(lat1) || !std::isfinite(lon1) || !std::isfinite(lat2) || !std::isfinite(lon2)) {
        return std::numeric_limits<double>::quiet_NaN();
    }

    const double dlat = (lat2 - lat1) * TO_RAD;
    const double dlon = (lon2 - lon1) * TO_RAD;
    const double rlat1 = lat1 * TO_RAD;
    const double rlat2 = lat2 * TO_RAD;

    const double sin_dlat_2 = std::sin(dlat * 0.5);
    const double sin_dlon_2 = std::sin(dlon * 0.5);

    const double a = sin_dlat_2 * sin_dlat_2 +
                     std::cos(rlat1) * std::cos(rlat2) * sin_dlon_2 * sin_dlon_2;

    const double clamped_a = (a > 1.0) ? 1.0 : ((a < 0.0) ? 0.0 : a);
    const double c = 2.0 * std::atan2(std::sqrt(clamped_a), std::sqrt(1.0 - clamped_a));
    return EARTH_RADIUS_METERS * c;
}

double RouteGeometry::HaversineDistanceMeters(const GeoPoint& p1, const GeoPoint& p2) {
    return HaversineDistanceMeters(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
}

double RouteGeometry::CalculateHaversineDistance(const std::vector<GeoPoint>& coords) {
    if (coords.size() < 2) {
        return 0.0;
    }
    double total_distance = 0.0;
    for (size_t i = 0; i < coords.size() - 1; ++i) {
        total_distance += HaversineDistanceMeters(coords[i], coords[i + 1]);
    }
    return total_distance;
}

RouteGeometryResult RouteGeometry::Reconstruct(const Graph& graph, const RouteResult& route) {
    auto t_start = std::chrono::steady_clock::now();

    RouteGeometryResult result;
    result.success = false;

    if (!route.found) {
        result.error_message = "Cannot reconstruct geometry for unfound route";
        auto t_end = std::chrono::steady_clock::now();
        result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return result;
    }

    const size_t total_nodes = graph.NodeCount();

    // Source equals destination (zero-distance single node route)
    if (route.source_internal_idx == route.destination_internal_idx) {
        if (route.source_internal_idx >= total_nodes) {
            result.error_message = "Source node index " + std::to_string(route.source_internal_idx) + " out of range";
            auto t_end = std::chrono::steady_clock::now();
            result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
            return result;
        }

        const auto& node = graph.GetNode(route.source_internal_idx);
        result.coordinates.push_back(GeoPoint{node.latitude, node.longitude});
        result.total_haversine_distance_meters = 0.0;
        result.segments_processed = 0;
        result.duplicate_junctions_removed = 0;
        result.reversed_segments_count = 0;
        result.success = true;

        auto t_end = std::chrono::steady_clock::now();
        result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return result;
    }

    if (route.path_segments.empty()) {
        result.error_message = "Route between distinct nodes has no path segments";
        auto t_end = std::chrono::steady_clock::now();
        result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return result;
    }

    const auto& pool = graph.GetGeometryPool();
    const size_t pool_size = pool.size();

    // Pre-reserve coordinate capacity (at least 2 points per segment)
    result.coordinates.reserve(route.path_segments.size() * 2 + 1);

    for (size_t i = 0; i < route.path_segments.size(); ++i) {
        const auto& seg = route.path_segments[i];

        if (seg.from_idx >= total_nodes || seg.to_idx >= total_nodes) {
            result.error_message = "Segment " + std::to_string(i) + " contains out-of-range node index (from=" +
                                  std::to_string(seg.from_idx) + ", to=" + std::to_string(seg.to_idx) + ")";
            auto t_end = std::chrono::steady_clock::now();
            result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
            return result;
        }

        const auto& from_node = graph.GetNode(seg.from_idx);
        const auto& to_node = graph.GetNode(seg.to_idx);

        if (seg.geometry_count == 0) {
            result.error_message = "Segment " + std::to_string(i) + " (OSM " + std::to_string(seg.from_osm_id) +
                                  " -> " + std::to_string(seg.to_osm_id) + ") has zero geometry count (missing geometry)";
            auto t_end = std::chrono::steady_clock::now();
            result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
            return result;
        }

        if (static_cast<size_t>(seg.geometry_offset) + seg.geometry_count > pool_size) {
            result.error_message = "Segment " + std::to_string(i) + " geometry offset (" +
                                  std::to_string(seg.geometry_offset) + ") + count (" +
                                  std::to_string(seg.geometry_count) + ") exceeds geometry pool size (" +
                                  std::to_string(pool_size) + ")";
            auto t_end = std::chrono::steady_clock::now();
            result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
            return result;
        }

        // Retrieve authentic coordinate sequence from pool
        std::vector<GeoPoint> seg_geom;
        seg_geom.reserve(seg.geometry_count);
        for (uint16_t k = 0; k < seg.geometry_count; ++k) {
            const auto& pt = pool[seg.geometry_offset + k];
            if (!std::isfinite(pt.latitude) || !std::isfinite(pt.longitude)) {
                result.error_message = "Segment " + std::to_string(i) + " contains non-finite coordinate at index " +
                                      std::to_string(k);
                auto t_end = std::chrono::steady_clock::now();
                result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
                return result;
            }
            if (pt.latitude < -90.0 || pt.latitude > 90.0 || pt.longitude < -180.0 || pt.longitude > 180.0) {
                result.error_message = "Segment " + std::to_string(i) + " contains out-of-range coordinate at index " +
                                      std::to_string(k);
                auto t_end = std::chrono::steady_clock::now();
                result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
                return result;
            }
            seg_geom.push_back(pt);
        }

        // Orientation verification relative to segment from/to nodes
        const GeoPoint& first_pt = seg_geom.front();
        const GeoPoint& last_pt = seg_geom.back();
        const GeoPoint from_pt{from_node.latitude, from_node.longitude};
        const GeoPoint to_pt{to_node.latitude, to_node.longitude};

        const double d_fwd_start = HaversineDistanceMeters(first_pt, from_pt);
        const double d_fwd_end = HaversineDistanceMeters(last_pt, to_pt);
        const bool forward_match = (d_fwd_start <= TOLERANCE_METERS && d_fwd_end <= TOLERANCE_METERS);

        const double d_rev_start = HaversineDistanceMeters(first_pt, to_pt);
        const double d_rev_end = HaversineDistanceMeters(last_pt, from_pt);
        const bool reverse_match = (d_rev_start <= TOLERANCE_METERS && d_rev_end <= TOLERANCE_METERS);

        if (forward_match) {
            // Already in forward traversal order
        } else if (reverse_match) {
            // Reversing geometry to match traversal order
            std::reverse(seg_geom.begin(), seg_geom.end());
            ++result.reversed_segments_count;
        } else {
            result.error_message = "Segment " + std::to_string(i) + " (OSM " + std::to_string(seg.from_osm_id) +
                                  " -> " + std::to_string(seg.to_osm_id) +
                                  ") geometry endpoints do not align with edge nodes within tolerance (" +
                                  std::to_string(TOLERANCE_METERS) + " m). Forward gaps: (" +
                                  std::to_string(d_fwd_start) + " m, " + std::to_string(d_fwd_end) +
                                  " m); Reverse gaps: (" + std::to_string(d_rev_start) + " m, " +
                                  std::to_string(d_rev_end) + " m)";
            auto t_end = std::chrono::steady_clock::now();
            result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
            return result;
        }

        // Continuous assembly and junction deduplication
        if (result.coordinates.empty()) {
            result.coordinates = std::move(seg_geom);
        } else {
            const GeoPoint& prev_end = result.coordinates.back();
            const GeoPoint& curr_start = seg_geom.front();
            const double junction_gap = HaversineDistanceMeters(prev_end, curr_start);

            if (junction_gap <= TOLERANCE_METERS) {
                // Shared junction: deduplicate by omitting the first coordinate
                ++result.duplicate_junctions_removed;
                result.coordinates.insert(result.coordinates.end(), seg_geom.begin() + 1, seg_geom.end());
            } else {
                result.error_message = "Disconnected geometry gap detected between segment " +
                                      std::to_string(i - 1) + " and segment " + std::to_string(i) +
                                      " at junction node " + std::to_string(seg.from_osm_id) +
                                      " (gap=" + std::to_string(junction_gap) + " m > tolerance " +
                                      std::to_string(TOLERANCE_METERS) + " m)";
                auto t_end = std::chrono::steady_clock::now();
                result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
                return result;
            }
        }

        ++result.segments_processed;
    }

    // Post-assembly validation
    if (result.coordinates.size() < 2) {
        result.error_message = "Reconstructed route coordinate count (" +
                              std::to_string(result.coordinates.size()) + ") is less than 2 for distinct endpoints";
        auto t_end = std::chrono::steady_clock::now();
        result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return result;
    }

    const auto& src_node = graph.GetNode(route.source_internal_idx);
    const auto& dst_node = graph.GetNode(route.destination_internal_idx);
    const double d_start = HaversineDistanceMeters(result.coordinates.front(), GeoPoint{src_node.latitude, src_node.longitude});
    const double d_end = HaversineDistanceMeters(result.coordinates.back(), GeoPoint{dst_node.latitude, dst_node.longitude});

    if (d_start > TOLERANCE_METERS) {
        result.error_message = "Reconstructed route start does not match source node (gap=" +
                              std::to_string(d_start) + " m > tolerance " + std::to_string(TOLERANCE_METERS) + " m)";
        auto t_end = std::chrono::steady_clock::now();
        result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return result;
    }

    if (d_end > TOLERANCE_METERS) {
        result.error_message = "Reconstructed route end does not match destination node (gap=" +
                              std::to_string(d_end) + " m > tolerance " + std::to_string(TOLERANCE_METERS) + " m)";
        auto t_end = std::chrono::steady_clock::now();
        result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return result;
    }

    result.total_haversine_distance_meters = CalculateHaversineDistance(result.coordinates);
    result.success = true;

    auto t_end = std::chrono::steady_clock::now();
    result.reconstruction_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();

    return result;
}

bool RouteGeometry::Validate(const Graph& graph,
                             const RouteResult& route,
                             const std::vector<GeoPoint>& coords,
                             std::string& out_error) {
    if (!route.found) {
        out_error = "Route was not marked as found";
        return false;
    }

    const size_t total_nodes = graph.NodeCount();
    if (route.source_internal_idx >= total_nodes || route.destination_internal_idx >= total_nodes) {
        out_error = "Route endpoints out of graph node range";
        return false;
    }

    if (route.source_internal_idx == route.destination_internal_idx) {
        if (coords.empty()) {
            out_error = "Coordinates empty for single-node route";
            return false;
        }
        const auto& node = graph.GetNode(route.source_internal_idx);
        double d = HaversineDistanceMeters(coords.front(), GeoPoint{node.latitude, node.longitude});
        if (d > TOLERANCE_METERS) {
            out_error = "Single-node route coordinate does not align with node (gap=" + std::to_string(d) + " m)";
            return false;
        }
        return true;
    }

    if (coords.size() < 2) {
        out_error = "Route between distinct nodes must have at least 2 coordinates";
        return false;
    }

    for (size_t i = 0; i < coords.size(); ++i) {
        const auto& pt = coords[i];
        if (!std::isfinite(pt.latitude) || !std::isfinite(pt.longitude)) {
            out_error = "Non-finite coordinate at index " + std::to_string(i);
            return false;
        }
        if (pt.latitude < -90.0 || pt.latitude > 90.0 || pt.longitude < -180.0 || pt.longitude > 180.0) {
            out_error = "Coordinate out of valid range [-90, 90] / [-180, 180] at index " + std::to_string(i);
            return false;
        }
    }

    const auto& src_node = graph.GetNode(route.source_internal_idx);
    const auto& dst_node = graph.GetNode(route.destination_internal_idx);

    double d_start = HaversineDistanceMeters(coords.front(), GeoPoint{src_node.latitude, src_node.longitude});
    if (d_start > TOLERANCE_METERS) {
        out_error = "First coordinate does not match source node (distance=" + std::to_string(d_start) + " m)";
        return false;
    }

    double d_end = HaversineDistanceMeters(coords.back(), GeoPoint{dst_node.latitude, dst_node.longitude});
    if (d_end > TOLERANCE_METERS) {
        out_error = "Last coordinate does not match destination node (distance=" + std::to_string(d_end) + " m)";
        return false;
    }

    // Check for accidental duplicate consecutive coordinates
    for (size_t i = 0; i < coords.size() - 1; ++i) {
        if (coords[i].latitude == coords[i + 1].latitude &&
            coords[i].longitude == coords[i + 1].longitude) {
            out_error = "Accidental duplicate consecutive coordinate at index " + std::to_string(i);
            return false;
        }
    }

    return true;
}

} // namespace EmergencyRouting

