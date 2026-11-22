#pragma once

#include "GraphTypes.hpp"
#include <unordered_map>
#include <vector>
#include <string>
#include <stdexcept>

namespace EmergencyRouting {

/**
 * High-performance in-memory directed graph representing the Jodhpur road network.
 * Preserves authentic 64-bit OSM identifiers while providing O(1) dense indexing [0, V-1]
 * for cache-friendly adjacency vector traversal.
 */
class Graph {
public:
    Graph() = default;

    /**
     * Reserve memory allocations upfront based on declared metadata counts.
     */
    void Reserve(size_t node_count, size_t edge_count);

    /**
     * Reset and clear all graph structures.
     */
    void Clear();

    /**
     * Add a unique vertex to the graph. Returns the internal dense index [0, V-1].
     * Throws std::invalid_argument if osm_id already exists in the graph.
     */
    uint32_t AddNode(int64_t osm_id, double lat, double lon, bool is_boundary = false);

    /**
     * Deduplicate and intern a road name into the string pool, returning its 16-bit identifier.
     */
    uint16_t InternRoadName(const std::string& name);

    /**
     * Add a directed edge from from_idx to to_idx.
     * Throws std::invalid_argument if distance_meters <= 0.0 or not finite.
     * Throws std::out_of_range if from_idx or to_idx exceed current node bounds.
     */
    void AddEdge(uint32_t from_idx,
                 uint32_t to_idx,
                 double distance_meters,
                 int64_t osm_way_id,
                 uint16_t road_type_id,
                 uint16_t name_id,
                 uint16_t access_id,
                 bool oneway,
                 const std::vector<GeoPoint>& geometry);

    // Query Methods
    size_t NodeCount() const noexcept { return nodes_.size(); }
    size_t EdgeCount() const noexcept { return edge_count_; }
    size_t UniqueNameCount() const noexcept { return road_names_.size(); }
    size_t GeometryPoolSize() const noexcept { return geometry_pool_.size(); }

    bool HasNode(int64_t osm_id) const noexcept;
    uint32_t GetInternalIndex(int64_t osm_id) const;
    bool TryGetInternalIndex(int64_t osm_id, uint32_t& out_idx) const noexcept;
    int64_t GetOsmId(uint32_t internal_idx) const;

    const NodeRecord& GetNode(uint32_t internal_idx) const;
    const std::vector<NodeRecord>& GetAllNodes() const noexcept { return nodes_; }

    const std::vector<EdgeRecord>& GetOutgoingEdges(uint32_t internal_idx) const;
    const std::vector<std::vector<EdgeRecord>>& GetAdjacencyList() const noexcept { return adj_; }

    const std::string& GetRoadName(uint16_t name_id) const;
    const std::vector<std::string>& GetRoadNamesPool() const noexcept { return road_names_; }

    std::vector<GeoPoint> GetEdgeGeometry(const EdgeRecord& edge) const;
    const std::vector<GeoPoint>& GetGeometryPool() const noexcept { return geometry_pool_; }

private:
    std::vector<NodeRecord> nodes_;
    std::unordered_map<int64_t, uint32_t> osm_to_internal_;
    std::vector<std::vector<EdgeRecord>> adj_;
    std::vector<std::string> road_names_;
    std::unordered_map<std::string, uint16_t> name_to_id_;
    std::vector<GeoPoint> geometry_pool_;
    size_t edge_count_{0};
};

} // namespace EmergencyRouting
