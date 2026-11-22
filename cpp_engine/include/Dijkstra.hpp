#pragma once

#include "Graph.hpp"
#include <vector>
#include <limits>
#include <chrono>
#include <cstdint>
#include <string>
#include <cmath>

namespace EmergencyRouting {

/**
 * Predecessor trace stored during Dijkstra relaxation for exact trajectory reconstruction.
 */
struct Predecessor {
    uint32_t from_idx{0xFFFFFFFF}; // Source node internal index (0xFFFFFFFF = none)
    uint32_t edge_idx{0xFFFFFFFF}; // Outgoing edge index in adj_[from_idx] (0xFFFFFFFF = none)
};

/**
 * Segment reference along a reconstructed shortest path.
 * Preserves edge metadata and coordinate buffer offsets for Phase 3.5 geometry generation.
 */
struct PathSegment {
    uint32_t from_idx{0};
    uint32_t to_idx{0};
    int64_t from_osm_id{0};
    int64_t to_osm_id{0};
    int64_t osm_way_id{0};
    double distance_meters{0.0};
    uint16_t road_type_id{0};
    uint16_t name_id{0};
    uint16_t access_id{0};
    bool oneway{true};
    uint32_t geometry_offset{0};
    uint16_t geometry_count{0};
};

/**
 * Result structure for single-pair and reconstructed shortest paths.
 */
struct RouteResult {
    bool found{false};
    int64_t source_osm_id{0};
    int64_t destination_osm_id{0};
    uint32_t source_internal_idx{0xFFFFFFFF};
    uint32_t destination_internal_idx{0xFFFFFFFF};
    double total_distance_meters{std::numeric_limits<double>::infinity()};

    std::vector<int64_t> path_osm_ids;
    std::vector<uint32_t> path_internal_indices;
    std::vector<PathSegment> path_segments; // Edge metadata and geometry offsets

    size_t visited_nodes{0};
    size_t relaxed_edges{0};
    double algorithm_execution_time_ms{0.0};
    double path_reconstruction_time_ms{0.0};
};

/**
 * Result structure for a single-source all-destinations Dijkstra search.
 */
struct SingleSourceResult {
    int64_t source_osm_id{0};
    uint32_t source_internal_idx{0xFFFFFFFF};
    std::vector<double> distances;
    std::vector<Predecessor> predecessors;
    size_t visited_nodes{0};
    size_t relaxed_edges{0};
    double algorithm_execution_time_ms{0.0};

    bool IsReachable(uint32_t dest_idx) const noexcept {
        return dest_idx < distances.size() && !std::isinf(distances[dest_idx]);
    }

    double GetDistance(uint32_t dest_idx) const noexcept {
        if (dest_idx < distances.size()) {
            return distances[dest_idx];
        }
        return std::numeric_limits<double>::infinity();
    }
};

/**
 * Result structure for a single destination within a multi-target Dijkstra search.
 */
struct MultiTargetDestinationResult {
    int64_t destination_osm_id{0};
    uint32_t destination_internal_idx{0xFFFFFFFF};
    bool found{false};
    double total_distance_meters{std::numeric_limits<double>::infinity()};

    std::vector<int64_t> path_osm_ids;
    std::vector<uint32_t> path_internal_indices;
    std::vector<PathSegment> path_segments;
    double path_reconstruction_time_ms{0.0};
};

/**
 * Result structure for a 1-to-K multi-target Dijkstra search.
 */
struct MultiTargetResult {
    int64_t source_osm_id{0};
    uint32_t source_internal_idx{0xFFFFFFFF};
    std::vector<MultiTargetDestinationResult> targets;
    size_t unique_targets_requested{0};
    size_t unique_targets_settled{0};
    bool all_targets_found{false};

    size_t visited_nodes{0};
    size_t relaxed_edges{0};
    double algorithm_execution_time_ms{0.0};
    double total_execution_time_ms{0.0};
};

/**
 * High-performance priority-queue Dijkstra shortest-path routing engine.
 * Complexity: O((V + E) log V)
 */
class DijkstraRouter {
public:
    explicit DijkstraRouter(const Graph& graph);

    /**
     * Objective A: Point-to-Point (1-to-1) shortest path with early stopping.
     */
    RouteResult ShortestPath(uint32_t source_idx, uint32_t dest_idx) const;

    /**
     * Objective A convenience: Point-to-Point shortest path by OSM IDs.
     */
    RouteResult ShortestPathOsm(int64_t source_osm_id, int64_t dest_osm_id) const;

    /**
     * Objective D: Single-Source to All Destinations Dijkstra.
     */
    SingleSourceResult ShortestPathToAll(uint32_t source_idx) const;

    /**
     * Objective D convenience: Single-Source to All Destinations by OSM ID.
     */
    SingleSourceResult ShortestPathToAllOsm(int64_t source_osm_id) const;

    /**
     * Objective E: Multi-Target (1-to-K) shortest path with early stopping.
     */
    MultiTargetResult ShortestPathMultiTarget(uint32_t source_idx,
                                              const std::vector<uint32_t>& dest_indices,
                                              bool reconstruct_paths = true) const;

    /**
     * Objective E convenience: Multi-Target (1-to-K) shortest path by OSM IDs.
     */
    MultiTargetResult ShortestPathMultiTargetOsm(int64_t source_osm_id,
                                                 const std::vector<int64_t>& dest_osm_ids,
                                                 bool reconstruct_paths = true) const;

    /**
     * Objective D helper: Extract route to a specific destination from SingleSourceResult.
     */
    RouteResult ReconstructRouteFromSingleSource(const SingleSourceResult& ss_res, uint32_t dest_idx) const;

    /**
     * Objective D helper: Extract route by OSM ID from SingleSourceResult.
     */
    RouteResult ReconstructRouteFromSingleSourceOsm(const SingleSourceResult& ss_res, int64_t dest_osm_id) const;

    /**
     * Objective C helper: Reconstruct route from predecessor array.
     */
    RouteResult ReconstructPath(uint32_t source_idx,
                                uint32_t dest_idx,
                                double distance_meters,
                                const std::vector<Predecessor>& predecessors,
                                size_t visited_nodes,
                                size_t relaxed_edges,
                                double algo_time_ms) const;

private:
    const Graph& graph_;
};

} // namespace EmergencyRouting
