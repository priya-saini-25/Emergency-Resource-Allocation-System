#include "Graph.hpp"
#include <cmath>
#include <stdexcept>

namespace EmergencyRouting {

void Graph::Reserve(size_t node_count, size_t edge_count) {
    nodes_.reserve(node_count);
    osm_to_internal_.reserve(node_count);
    adj_.reserve(node_count);
    // Average OSM segment has 2-4 intermediate geometry coordinates
    geometry_pool_.reserve(edge_count * 2);
}

void Graph::Clear() {
    nodes_.clear();
    osm_to_internal_.clear();
    adj_.clear();
    road_names_.clear();
    name_to_id_.clear();
    geometry_pool_.clear();
    edge_count_ = 0;
}

uint32_t Graph::AddNode(int64_t osm_id, double lat, double lon, bool is_boundary) {
    if (!std::isfinite(lat) || !std::isfinite(lon)) {
        throw std::invalid_argument("Invalid coordinates: latitude and longitude must be finite. Node ID: " + std::to_string(osm_id));
    }
    if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) {
        throw std::invalid_argument("Coordinate out of valid range [-90, 90] / [-180, 180]. Node ID: " + std::to_string(osm_id));
    }

    if (osm_to_internal_.find(osm_id) != osm_to_internal_.end()) {
        throw std::invalid_argument("Duplicate OSM Node ID: " + std::to_string(osm_id));
    }

    const uint32_t internal_idx = static_cast<uint32_t>(nodes_.size());
    nodes_.push_back(NodeRecord{osm_id, lat, lon, is_boundary});
    osm_to_internal_.emplace(osm_id, internal_idx);

    if (adj_.size() <= internal_idx) {
        adj_.resize(internal_idx + 1);
    }

    return internal_idx;
}

uint16_t Graph::InternRoadName(const std::string& name) {
    if (name.empty()) {
        return 0; // index 0 is reserved for unnamed roads
    }

    if (road_names_.empty()) {
        road_names_.push_back(""); // empty placeholder at index 0
        name_to_id_[""] = 0;
    }

    auto it = name_to_id_.find(name);
    if (it != name_to_id_.end()) {
        return it->second;
    }

    const uint16_t new_id = static_cast<uint16_t>(road_names_.size());
    road_names_.push_back(name);
    name_to_id_[name] = new_id;
    return new_id;
}

void Graph::AddEdge(uint32_t from_idx,
                    uint32_t to_idx,
                    double distance_meters,
                    int64_t osm_way_id,
                    uint16_t road_type_id,
                    uint16_t name_id,
                    uint16_t access_id,
                    bool oneway,
                    const std::vector<GeoPoint>& geometry) {
    if (!std::isfinite(distance_meters) || distance_meters <= 0.0) {
        throw std::invalid_argument("Invalid edge weight: distance_meters must be finite and strictly positive (> 0.0). Found: " +
                                    std::to_string(distance_meters));
    }

    if (from_idx >= nodes_.size() || to_idx >= nodes_.size()) {
        throw std::out_of_range("Node index out of range when adding edge: from_idx=" +
                                std::to_string(from_idx) + ", to_idx=" + std::to_string(to_idx) +
                                ", total_nodes=" + std::to_string(nodes_.size()));
    }

    const uint32_t geom_offset = static_cast<uint32_t>(geometry_pool_.size());
    const uint16_t geom_count = static_cast<uint16_t>(geometry.size());

    if (geom_count > 0) {
        geometry_pool_.insert(geometry_pool_.end(), geometry.begin(), geometry.end());
    }

    if (adj_.size() <= from_idx) {
        adj_.resize(from_idx + 1);
    }

    adj_[from_idx].push_back(EdgeRecord{
        to_idx,
        distance_meters,
        osm_way_id,
        road_type_id,
        name_id,
        access_id,
        oneway,
        geom_offset,
        geom_count
    });

    ++edge_count_;
}

bool Graph::HasNode(int64_t osm_id) const noexcept {
    return osm_to_internal_.find(osm_id) != osm_to_internal_.end();
}

uint32_t Graph::GetInternalIndex(int64_t osm_id) const {
    auto it = osm_to_internal_.find(osm_id);
    if (it == osm_to_internal_.end()) {
        throw std::out_of_range("OSM Node ID not found in graph: " + std::to_string(osm_id));
    }
    return it->second;
}

bool Graph::TryGetInternalIndex(int64_t osm_id, uint32_t& out_idx) const noexcept {
    auto it = osm_to_internal_.find(osm_id);
    if (it == osm_to_internal_.end()) {
        return false;
    }
    out_idx = it->second;
    return true;
}

int64_t Graph::GetOsmId(uint32_t internal_idx) const {
    if (internal_idx >= nodes_.size()) {
        throw std::out_of_range("Internal node index out of range: " + std::to_string(internal_idx));
    }
    return nodes_[internal_idx].osm_id;
}

const NodeRecord& Graph::GetNode(uint32_t internal_idx) const {
    if (internal_idx >= nodes_.size()) {
        throw std::out_of_range("Internal node index out of range: " + std::to_string(internal_idx));
    }
    return nodes_[internal_idx];
}

const std::vector<EdgeRecord>& Graph::GetOutgoingEdges(uint32_t internal_idx) const {
    if (internal_idx >= adj_.size()) {
        static const std::vector<EdgeRecord> empty_edges;
        return empty_edges;
    }
    return adj_[internal_idx];
}

const std::string& Graph::GetRoadName(uint16_t name_id) const {
    if (name_id >= road_names_.size()) {
        static const std::string unknown_name = "";
        return unknown_name;
    }
    return road_names_[name_id];
}

std::vector<GeoPoint> Graph::GetEdgeGeometry(const EdgeRecord& edge) const {
    std::vector<GeoPoint> geom;
    if (edge.geometry_count > 0 && edge.geometry_offset + edge.geometry_count <= geometry_pool_.size()) {
        geom.reserve(edge.geometry_count);
        for (uint16_t i = 0; i < edge.geometry_count; ++i) {
            geom.push_back(geometry_pool_[edge.geometry_offset + i]);
        }
    }
    return geom;
}

} // namespace EmergencyRouting

