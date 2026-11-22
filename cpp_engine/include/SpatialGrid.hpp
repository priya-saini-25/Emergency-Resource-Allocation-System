#pragma once

#include "GraphTypes.hpp"
#include "Graph.hpp"
#include "BoundaryValidator.hpp"
#include <vector>
#include <string>
#include <limits>
#include <cstdint>

namespace EmergencyRouting {

/**
 * Status code for coordinate snapping operations.
 */
enum class SnapStatus {
    SUCCESS,
    OUTSIDE_SERVICE_AREA,
    SNAP_DISTANCE_EXCEEDED,
    INVALID_COORDINATES,
    NO_NODES_AVAILABLE,
    NO_CONNECTED_ROAD_NETWORK_AVAILABLE
};

inline std::string SnapStatusToString(SnapStatus status) {
    switch (status) {
        case SnapStatus::SUCCESS: return "SUCCESS";
        case SnapStatus::OUTSIDE_SERVICE_AREA: return "OUTSIDE_SERVICE_AREA";
        case SnapStatus::SNAP_DISTANCE_EXCEEDED: return "SNAP_DISTANCE_EXCEEDED";
        case SnapStatus::INVALID_COORDINATES: return "INVALID_COORDINATES";
        case SnapStatus::NO_NODES_AVAILABLE: return "NO_NODES_AVAILABLE";
        case SnapStatus::NO_CONNECTED_ROAD_NETWORK_AVAILABLE: return "NO_CONNECTED_ROAD_NETWORK_AVAILABLE";
        default: return "UNKNOWN";
    }
}

/**
 * Snapping policy governing whether exterior boundary endpoints may be selected.
 */
enum class SnapPolicy {
    ALLOW_ALL_NODES,       // Permit selection of any graph node, including boundary endpoints
    STRICT_INTERIOR_ONLY   // Exclude exterior boundary endpoints (is_boundary_node == true)
};

inline std::string SnapPolicyToString(SnapPolicy policy) {
    switch (policy) {
        case SnapPolicy::ALLOW_ALL_NODES: return "ALLOW_ALL_NODES";
        case SnapPolicy::STRICT_INTERIOR_ONLY: return "STRICT_INTERIOR_ONLY";
        default: return "UNKNOWN";
    }
}

/**
 * Result structure returned by coordinate snapping.
 */
struct SnapResult {
    bool found{false};
    SnapStatus status{SnapStatus::NO_NODES_AVAILABLE};
    std::string error_message;

    double query_latitude{0.0};
    double query_longitude{0.0};

    int64_t snapped_osm_id{0};
    uint32_t snapped_internal_index{0xFFFFFFFF};
    double snapped_latitude{0.0};
    double snapped_longitude{0.0};

    double snap_distance_meters{std::numeric_limits<double>::infinity()};
    bool snapped_is_boundary_node{false};
    bool snapped_is_in_gcc{false};
    bool snapped_is_in_scc{false};
    uint32_t snapped_component_id{0};
    uint32_t snapped_scc_id{0};

    size_t candidate_nodes_examined{0};
    size_t grid_cells_examined{0};
    double execution_time_ms{0.0};
};

/**
 * 2D spatial acceleration grid for exact nearest-road-node lookup.
 *
 * Guaranteed exactness:
 * Uses a provably conservative Haversine cell lower-bound metric with best-first
 * branch-and-bound expansion. The lower bound accounts for latitude interval cosine variation
 * and floating-point safeguards, guaranteeing that cell_lower_bound <= Haversine(query, P)
 * for every point P inside the cell.
 *
 * Strict nearest-node ordering:
 * - A strictly closer candidate (d < best_dist) always replaces the incumbent.
 * - On exact computed floating-point equality (d == best_dist), deterministic tie-breaking
 *   selects the candidate with the smaller 64-bit OSM ID.
 * - Equality is based on computed double-precision IEEE 754 distances.
 */
class SpatialGrid {
public:
    static constexpr double DEFAULT_CELL_SIZE_METERS = 250.0;
    static constexpr double DEFAULT_MAX_SNAP_DISTANCE_METERS = 1000.0;

    SpatialGrid() = default;

    /**
     * Build spatial index over the existing nodes of the road network graph.
     * Does not modify or duplicate the underlying graph data.
     *
     * @param graph The road network graph storing nodes.
     * @param cell_size_meters Target cell dimension in meters.
     */
    void Build(const Graph& graph, double cell_size_meters = DEFAULT_CELL_SIZE_METERS);

    /**
     * Clear and reset the spatial grid.
     */
    void Clear();

    bool IsBuilt() const noexcept { return is_built_; }
    size_t NodeCount() const noexcept { return nodes_count_; }
    size_t CellCount() const noexcept { return cells_.size(); }
    size_t NonEmptyCellCount() const noexcept;
    size_t RowCount() const noexcept { return n_rows_; }
    size_t ColCount() const noexcept { return n_cols_; }
    double GetCellSizeMeters() const noexcept { return cell_size_meters_; }
    size_t MemoryFootprintBytes() const noexcept;

    /**
     * Check if a node belongs to the principal connected component (GCC).
     */
    bool IsNodeInPrincipalComponent(uint32_t internal_idx) const noexcept;

    /**
     * Check if a node belongs to the Giant Strongly Connected Component (SCC #0).
     */
    bool IsNodeInGiantSCC(uint32_t internal_idx) const noexcept;

    /**
     * Get the weakly connected component ID for a node (0 = principal connected component).
     */
    uint32_t GetNodeComponentId(uint32_t internal_idx) const;

    /**
     * Get the strongly connected component ID for a node (0 = giant SCC).
     */
    uint32_t GetNodeSccId(uint32_t internal_idx) const;

    size_t GetPrincipalComponentSize() const noexcept { return gcc_size_; }
    size_t GetGiantSccSize() const noexcept { return scc_size_; }
    bool HasPrincipalComponent() const noexcept { return has_gcc_; }
    bool HasGiantSCC() const noexcept { return has_scc_; }

    /**
     * Multi-candidate spatial search gathering up to max_candidates reachable road nodes.
     */
    std::vector<SnapResult> FindNearestCandidates(
        double query_lat,
        double query_lon,
        SnapPolicy policy,
        double max_distance_meters = DEFAULT_MAX_SNAP_DISTANCE_METERS,
        size_t max_candidates = 5) const;

    /**
     * Compute a provably conservative Haversine lower bound from a query point to a cell bounding box.
     * Guaranteed to never exceed the true Haversine distance to any point inside the cell.
     *
     * @param qlat Query latitude in degrees.
     * @param qlon Query longitude in degrees.
     * @param min_lat Cell minimum latitude in degrees.
     * @param max_lat Cell maximum latitude in degrees.
     * @param min_lon Cell minimum longitude in degrees.
     * @param max_lon Cell maximum longitude in degrees.
     * @return Conservative lower bound in meters.
     */
    static double CellLowerBound(double qlat, double qlon,
                                 double min_lat, double max_lat,
                                 double min_lon, double max_lon);

    /**
     * Core exact nearest-node search on the spatial grid with explicit snapping policy.
     * Upstream callers must explicitly select SnapPolicy (ALLOW_ALL_NODES or STRICT_INTERIOR_ONLY).
     *
     * @param query_lat Query latitude in WGS84 degrees.
     * @param query_lon Query longitude in WGS84 degrees.
     * @param policy Explicit snapping policy (ALLOW_ALL_NODES or STRICT_INTERIOR_ONLY).
     * @param max_distance_meters Maximum permissible snapping distance in meters.
     * @return SnapResult containing snapped node index, OSM ID, distance, boundary status, and stats.
     */
    SnapResult FindNearestNode(double query_lat,
                               double query_lon,
                               SnapPolicy policy,
                               double max_distance_meters = DEFAULT_MAX_SNAP_DISTANCE_METERS) const;

    /**
     * Multi-stage coordinate snapping with explicit policy and optional boundary validation.
     * Upstream callers must explicitly select SnapPolicy (ALLOW_ALL_NODES or STRICT_INTERIOR_ONLY).
     *
     * Pipeline:
     * 1. Validate coordinate ranges and finiteness.
     * 2. (Optional) Check point-in-polygon against Jodhpur Urban Service Area.
     * 3. Execute exact nearest-node search respecting SnapPolicy.
     * 4. Enforce maximum snap distance.
     */
    SnapResult SnapCoordinate(double query_lat,
                              double query_lon,
                              SnapPolicy policy,
                              const BoundaryValidator* validator = nullptr,
                              double max_distance_meters = DEFAULT_MAX_SNAP_DISTANCE_METERS) const;

    /**
     * Independent brute-force linear scan over all graph nodes with explicit policy.
     * Provided for exactness verification and benchmarking.
     */
    SnapResult BruteForceFindNearestNode(double query_lat,
                                        double query_lon,
                                        SnapPolicy policy,
                                        double max_distance_meters = DEFAULT_MAX_SNAP_DISTANCE_METERS) const;

private:
    const Graph* graph_{nullptr};
    std::vector<std::vector<uint32_t>> cells_; // Dense internal node indices per cell

    std::vector<uint32_t> node_component_id_; // Maps node index -> component ID (0 = GCC)
    std::vector<uint32_t> node_scc_id_;       // Maps node index -> SCC ID (0 = Giant SCC)
    std::vector<bool> is_in_gcc_;             // Fast lookup for principal WCC membership
    std::vector<bool> is_in_scc_;             // Fast lookup for Giant SCC membership
    bool has_gcc_{false};
    bool has_scc_{false};
    size_t gcc_size_{0};
    size_t scc_size_{0};

    double min_lat_{0.0};
    double max_lat_{0.0};
    double min_lon_{0.0};
    double max_lon_{0.0};

    double dlat_{0.0}; // Cell height in degrees
    double dlon_{0.0}; // Cell width in degrees

    size_t n_rows_{0};
    size_t n_cols_{0};
    size_t nodes_count_{0};
    double cell_size_meters_{DEFAULT_CELL_SIZE_METERS};
    bool is_built_{false};
};

} // namespace EmergencyRouting

