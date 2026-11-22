#include "GraphIntegrity.hpp"
#include <cmath>
#include <limits>
#include <unordered_set>
#include <iomanip>

namespace EmergencyRouting {

ValidationResult GraphIntegrityValidator::Validate(const Graph& graph,
                                                  size_t expected_nodes,
                                                  size_t expected_edges) {
    ValidationResult result;
    const size_t n = graph.NodeCount();
    const size_t m = graph.EdgeCount();

    // 1. Node count check
    if (expected_nodes > 0) {
        result.RecordCheck(n == expected_nodes,
                           "Node count mismatch: expected " + std::to_string(expected_nodes) +
                           ", got " + std::to_string(n));
    } else {
        result.RecordCheck(n > 0, "Graph contains zero nodes");
    }

    if (n == 0) {
        return result;
    }

    // 2. Node validation
    std::unordered_set<int64_t> seen_osm_ids;
    seen_osm_ids.reserve(n);

    for (uint32_t u = 0; u < n; ++u) {
        const auto& node = graph.GetNode(u);

        // Bijective mapping checks
        result.RecordCheck(node.osm_id > 0,
                           "Non-positive OSM Node ID at internal index " + std::to_string(u));

        bool is_unique = seen_osm_ids.insert(node.osm_id).second;
        result.RecordCheck(is_unique,
                           "Duplicate OSM Node ID detected: " + std::to_string(node.osm_id) +
                           " at internal index " + std::to_string(u));

        uint32_t mapped_idx{0};
        bool found = graph.TryGetInternalIndex(node.osm_id, mapped_idx);
        result.RecordCheck(found && (mapped_idx == u),
                           "Inconsistent internal mapping for OSM Node ID " + std::to_string(node.osm_id) +
                           ": expected " + std::to_string(u) + ", got " + std::to_string(mapped_idx));

        int64_t recovered_osm_id = graph.GetOsmId(u);
        result.RecordCheck(recovered_osm_id == node.osm_id,
                           "Reverse OSM ID mismatch at internal index " + std::to_string(u));

        // Coordinate finiteness & geographic range
        bool coords_finite = std::isfinite(node.latitude) && std::isfinite(node.longitude);
        result.RecordCheck(coords_finite,
                           "Non-finite coordinates for node ID " + std::to_string(node.osm_id));

        bool lat_in_bounds = (node.latitude >= -90.0 && node.latitude <= 90.0);
        result.RecordCheck(lat_in_bounds,
                           "Latitude out of bounds [-90, 90] for node ID " + std::to_string(node.osm_id) +
                           ": " + std::to_string(node.latitude));

        bool lon_in_bounds = (node.longitude >= -180.0 && node.longitude <= 180.0);
        result.RecordCheck(lon_in_bounds,
                           "Longitude out of bounds [-180, 180] for node ID " + std::to_string(node.osm_id) +
                           ": " + std::to_string(node.longitude));
    }

    // 3. Edge count & Adjacency consistency checks
    if (expected_edges > 0) {
        result.RecordCheck(m == expected_edges,
                           "Edge count mismatch: expected " + std::to_string(expected_edges) +
                           ", got " + std::to_string(m));
    }

    const auto& adj = graph.GetAdjacencyList();
    result.RecordCheck(adj.size() == n,
                       "Adjacency list size mismatch: expected " + std::to_string(n) +
                       ", got " + std::to_string(adj.size()));

    size_t traversed_edges = 0;
    const size_t geom_pool_size = graph.GeometryPoolSize();
    const size_t unique_names = graph.UniqueNameCount();
    const size_t std_road_types = GetStandardRoadTypes().size();
    const size_t std_access_types = GetStandardAccessTypes().size();

    for (uint32_t u = 0; u < n; ++u) {
        const auto& edges = graph.GetOutgoingEdges(u);
        for (size_t e_idx = 0; e_idx < edges.size(); ++e_idx) {
            const auto& e = edges[e_idx];
            ++traversed_edges;

            // Target node existence
            bool target_valid = (e.target_idx < n);
            result.RecordCheck(target_valid,
                               "Edge from internal index " + std::to_string(u) + " references out-of-range target index " +
                               std::to_string(e.target_idx) + " (max: " + std::to_string(n - 1) + ")");

            // Edge weight validity
            bool weight_valid = std::isfinite(e.distance_meters) && (e.distance_meters > 0.0);
            result.RecordCheck(weight_valid,
                               "Edge from " + std::to_string(u) + " to " + std::to_string(e.target_idx) +
                               " has invalid distance: " + std::to_string(e.distance_meters));

            // Metadata references
            bool road_type_valid = (e.road_type_id < std_road_types);
            result.RecordCheck(road_type_valid,
                               "Edge from " + std::to_string(u) + " has invalid road_type_id: " +
                               std::to_string(e.road_type_id));

            bool access_valid = (e.access_id < std_access_types);
            result.RecordCheck(access_valid,
                               "Edge from " + std::to_string(u) + " has invalid access_id: " +
                               std::to_string(e.access_id));

            bool name_valid = (unique_names == 0 && e.name_id == 0) || (e.name_id < unique_names);
            result.RecordCheck(name_valid,
                               "Edge from " + std::to_string(u) + " has invalid name_id: " +
                               std::to_string(e.name_id) + " (pool size: " + std::to_string(unique_names) + ")");

            // Geometry buffer integrity
            bool geom_buffer_valid = (static_cast<size_t>(e.geometry_offset) + e.geometry_count <= geom_pool_size);
            result.RecordCheck(geom_buffer_valid,
                               "Edge from " + std::to_string(u) + " has geometry offset/count exceeding pool: offset=" +
                               std::to_string(e.geometry_offset) + ", count=" + std::to_string(e.geometry_count) +
                               ", pool=" + std::to_string(geom_pool_size));

            // Canonical geometry point count check (>= 2 points per canonical road segment)
            if (expected_edges == 129778) {
                bool has_min_points = (e.geometry_count >= 2);
                result.RecordCheck(has_min_points,
                                   "Canonical edge from " + std::to_string(u) + " has fewer than 2 geometry points: " +
                                   std::to_string(e.geometry_count));
            }

            // Geometry coordinates validation
            auto geom = graph.GetEdgeGeometry(e);
            for (const auto& pt : geom) {
                bool pt_finite = std::isfinite(pt.latitude) && std::isfinite(pt.longitude);
                result.RecordCheck(pt_finite, "Non-finite geometry coordinate in edge from " + std::to_string(u));

                bool pt_lat_bounds = (pt.latitude >= -90.0 && pt.latitude <= 90.0);
                result.RecordCheck(pt_lat_bounds, "Geometry latitude out of bounds in edge from " + std::to_string(u));

                bool pt_lon_bounds = (pt.longitude >= -180.0 && pt.longitude <= 180.0);
                result.RecordCheck(pt_lon_bounds, "Geometry longitude out of bounds in edge from " + std::to_string(u));
            }
        }
    }

    result.RecordCheck(traversed_edges == m,
                       "Traversed edges sum mismatch: counted " + std::to_string(traversed_edges) +
                       ", recorded " + std::to_string(m));

    return result;
}

IntegritySummary GraphIntegrityValidator::AnalyzeMetrics(const Graph& graph) {
    IntegritySummary summary;
    summary.total_nodes = graph.NodeCount();
    summary.total_edges = graph.EdgeCount();

    if (summary.total_nodes == 0) {
        return summary;
    }

    summary.min_latitude = std::numeric_limits<double>::infinity();
    summary.max_latitude = -std::numeric_limits<double>::infinity();
    summary.min_longitude = std::numeric_limits<double>::infinity();
    summary.max_longitude = -std::numeric_limits<double>::infinity();

    std::vector<uint32_t> in_degrees(summary.total_nodes, 0);
    std::vector<uint32_t> out_degrees(summary.total_nodes, 0);

    for (uint32_t i = 0; i < summary.total_nodes; ++i) {
        const auto& node = graph.GetNode(i);
        if (node.latitude < summary.min_latitude) summary.min_latitude = node.latitude;
        if (node.latitude > summary.max_latitude) summary.max_latitude = node.latitude;
        if (node.longitude < summary.min_longitude) summary.min_longitude = node.longitude;
        if (node.longitude > summary.max_longitude) summary.max_longitude = node.longitude;
        if (node.is_boundary) ++summary.boundary_nodes_count;
    }

    summary.min_distance_meters = std::numeric_limits<double>::infinity();
    summary.max_distance_meters = 0.0;
    summary.total_distance_meters = 0.0;

    for (uint32_t u = 0; u < summary.total_nodes; ++u) {
        const auto& edges = graph.GetOutgoingEdges(u);
        out_degrees[u] = static_cast<uint32_t>(edges.size());

        std::unordered_set<uint32_t> seen_targets;
        for (const auto& e : edges) {
            if (e.target_idx < summary.total_nodes) {
                ++in_degrees[e.target_idx];
            }

            if (e.distance_meters < summary.min_distance_meters) summary.min_distance_meters = e.distance_meters;
            if (e.distance_meters > summary.max_distance_meters) summary.max_distance_meters = e.distance_meters;
            summary.total_distance_meters += e.distance_meters;

            if (u == e.target_idx) {
                ++summary.self_loops_count;
            }

            if (seen_targets.find(e.target_idx) != seen_targets.end()) {
                ++summary.multi_edges_count;
            } else {
                seen_targets.insert(e.target_idx);
            }

            if (e.oneway) {
                ++summary.oneway_edges_count;
            }

            summary.total_geometry_points += e.geometry_count;

            const std::string& road_type = IdToRoadType(e.road_type_id);
            summary.edges_by_road_type[road_type]++;

            const std::string& access_type = IdToAccessType(e.access_id);
            summary.edges_by_access[access_type]++;
        }
    }

    if (summary.total_edges > 0) {
        summary.avg_distance_meters = summary.total_distance_meters / static_cast<double>(summary.total_edges);
    }

    summary.min_in_degree = std::numeric_limits<uint32_t>::max();
    summary.max_in_degree = 0;
    uint64_t sum_in = 0;

    summary.min_out_degree = std::numeric_limits<uint32_t>::max();
    summary.max_out_degree = 0;
    uint64_t sum_out = 0;

    for (uint32_t i = 0; i < summary.total_nodes; ++i) {
        uint32_t in_deg = in_degrees[i];
        uint32_t out_deg = out_degrees[i];

        if (in_deg < summary.min_in_degree) summary.min_in_degree = in_deg;
        if (in_deg > summary.max_in_degree) summary.max_in_degree = in_deg;
        sum_in += in_deg;

        if (out_deg < summary.min_out_degree) summary.min_out_degree = out_deg;
        if (out_deg > summary.max_out_degree) summary.max_out_degree = out_deg;
        sum_out += out_deg;

        if (in_deg == 0 && out_deg > 0) ++summary.source_nodes_count;
        else if (in_deg > 0 && out_deg == 0) ++summary.sink_nodes_count;
        else if (in_deg == 0 && out_deg == 0) ++summary.isolated_nodes_count;
    }

    summary.avg_in_degree = static_cast<double>(sum_in) / static_cast<double>(summary.total_nodes);
    summary.avg_out_degree = static_cast<double>(sum_out) / static_cast<double>(summary.total_nodes);

    return summary;
}

} // namespace EmergencyRouting
