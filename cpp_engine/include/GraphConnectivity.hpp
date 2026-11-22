#pragma once

#include "Graph.hpp"
#include <vector>
#include <map>
#include <string>

namespace EmergencyRouting {

/**
 * Summary metrics for Weakly Connected Components (WCC).
 */
struct WccResult {
    size_t total_components{0};
    size_t largest_component_size{0};
    double largest_component_percentage{0.0};
    std::vector<size_t> component_sizes; // sorted descending
    std::vector<uint32_t> node_component_id; // maps node index -> component ID
};

/**
 * Summary metrics for Strongly Connected Components (SCC).
 */
struct SccResult {
    size_t total_components{0};
    size_t largest_component_size{0};
    double largest_component_percentage{0.0};
    std::vector<size_t> component_sizes; // sorted descending
    std::vector<uint32_t> node_component_id; // maps node index -> component ID
};

/**
 * Facility connectivity and pair-wise reachability audit.
 */
struct FacilityReachabilityResult {
    struct FacilityNode {
        std::string name;
        int64_t osm_id;
        uint32_t internal_idx;
        uint32_t wcc_id;
        uint32_t scc_id;
        bool in_largest_wcc{false};
        bool in_largest_scc{false};
    };

    struct PairReachability {
        std::string from_name;
        int64_t from_osm_id;
        std::string to_name;
        int64_t to_osm_id;
        bool reachable{false};
        size_t bfs_hop_count{0};
    };

    std::vector<FacilityNode> facilities;
    std::vector<PairReachability> pairs; // 30 directed pairs
    size_t total_pairs{0};
    size_t reachable_pairs{0};
    bool all_pairs_reachable{false};
};

/**
 * Graph connectivity analysis utility providing WCC, Tarjan's SCC,
 * and directed BFS facility reachability.
 */
class GraphConnectivity {
public:
    /**
     * Compute Weakly Connected Components (undirected projection).
     */
    static WccResult ComputeWCC(const Graph& graph);

    /**
     * Compute Strongly Connected Components using Tarjan's algorithm.
     */
    static SccResult ComputeSCC(const Graph& graph);

    /**
     * Check directed reachability among the 6 canonical emergency facilities.
     */
    static FacilityReachabilityResult CheckFacilityReachability(const Graph& graph,
                                                               const WccResult& wcc,
                                                               const SccResult& scc);
};

} // namespace EmergencyRouting

