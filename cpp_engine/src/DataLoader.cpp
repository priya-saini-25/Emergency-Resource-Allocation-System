#include "DataLoader.hpp"
#include "json.hpp"
#include <fstream>
#include <sstream>
#include <iostream>
#include <cmath>
#include <chrono>
#include <stdexcept>

using json = nlohmann::json;

namespace EmergencyRouting {

LoadStatistics DataLoader::LoadFromJsonFile(const std::string& filepath, Graph& out_graph) {
    std::ifstream file(filepath, std::ios::in | std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("DataLoader Error: Cannot open file: " + filepath);
    }

    auto start_time = std::chrono::steady_clock::now();

    json root;
    try {
        file >> root;
    } catch (const json::parse_error& e) {
        throw std::runtime_error("DataLoader Error: JSON syntax parse error in " + filepath + ": " + e.what());
    }

    LoadStatistics stats = IngestParsedJson(&root, out_graph);

    auto end_time = std::chrono::steady_clock::now();
    stats.load_time_ms = std::chrono::duration<double, std::milli>(end_time - start_time).count();

    std::cerr << "[CPP_INFO] Ingestion complete from file: " << filepath << "\n"
              << "[CPP_INFO]   Nodes loaded: " << stats.nodes_loaded << "\n"
              << "[CPP_INFO]   Edges loaded: " << stats.edges_loaded << "\n"
              << "[CPP_INFO]   Road names interned: " << stats.unique_road_names << "\n"
              << "[CPP_INFO]   Wall-clock time: " << stats.load_time_ms << " ms" << std::endl;

    return stats;
}

LoadStatistics DataLoader::LoadFromJsonString(const std::string& json_content, Graph& out_graph) {
    auto start_time = std::chrono::steady_clock::now();

    json root;
    try {
        root = json::parse(json_content);
    } catch (const json::parse_error& e) {
        throw std::runtime_error("DataLoader Error: JSON syntax parse error in string buffer: " + std::string(e.what()));
    }

    LoadStatistics stats = IngestParsedJson(&root, out_graph);

    auto end_time = std::chrono::steady_clock::now();
    stats.load_time_ms = std::chrono::duration<double, std::milli>(end_time - start_time).count();

    return stats;
}

LoadStatistics DataLoader::IngestParsedJson(const void* parsed_json_ptr, Graph& out_graph) {
    if (!parsed_json_ptr) {
        throw std::runtime_error("DataLoader Error: Null JSON pointer provided");
    }

    const json& root = *static_cast<const json*>(parsed_json_ptr);

    if (!root.contains("nodes") || !root["nodes"].is_array()) {
        throw std::runtime_error("DataLoader Error: Malformed JSON: missing or non-array 'nodes' field");
    }
    if (!root.contains("edges") || !root["edges"].is_array()) {
        throw std::runtime_error("DataLoader Error: Malformed JSON: missing or non-array 'edges' field");
    }

    LoadStatistics stats;

    if (root.contains("metadata") && root["metadata"].is_object()) {
        stats.metadata_city = root["metadata"].value("city", "");
        stats.metadata_source = root["metadata"].value("source", "");
    }

    const auto& nodes_json = root["nodes"];
    const auto& edges_json = root["edges"];

    out_graph.Clear();
    out_graph.Reserve(nodes_json.size(), edges_json.size());

    // 1. Ingest Nodes
    for (size_t i = 0; i < nodes_json.size(); ++i) {
        const auto& node_item = nodes_json[i];
        if (!node_item.contains("id") || !node_item["id"].is_number_integer()) {
            throw std::runtime_error("DataLoader Error: Node at index " + std::to_string(i) + " is missing valid 'id'");
        }
        if (!node_item.contains("latitude") || !node_item["latitude"].is_number()) {
            throw std::runtime_error("DataLoader Error: Node at index " + std::to_string(i) + " is missing valid 'latitude'");
        }
        if (!node_item.contains("longitude") || !node_item["longitude"].is_number()) {
            throw std::runtime_error("DataLoader Error: Node at index " + std::to_string(i) + " is missing valid 'longitude'");
        }

        const int64_t osm_id = node_item["id"].get<int64_t>();
        const double lat = node_item["latitude"].get<double>();
        const double lon = node_item["longitude"].get<double>();
        const bool is_boundary = node_item.value("is_boundary_node", false);

        if (!std::isfinite(lat) || !std::isfinite(lon)) {
            throw std::runtime_error("DataLoader Error: Non-finite coordinate encountered for node ID " + std::to_string(osm_id));
        }

        if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) {
            throw std::runtime_error("DataLoader Error: Coordinate out of valid geographic range [-90, 90] / [-180, 180] for node ID " + std::to_string(osm_id) +
                                     " (lat=" + std::to_string(lat) + ", lon=" + std::to_string(lon) + ")");
        }

        // AddNode will throw std::invalid_argument if duplicate osm_id exists
        out_graph.AddNode(osm_id, lat, lon, is_boundary);
    }
    stats.nodes_loaded = out_graph.NodeCount();

    // 2. Ingest Directed Edges
    for (size_t i = 0; i < edges_json.size(); ++i) {
        const auto& edge_item = edges_json[i];

        if (!edge_item.contains("from") || !edge_item["from"].is_number_integer()) {
            throw std::runtime_error("DataLoader Error: Edge at index " + std::to_string(i) + " is missing valid 'from' node ID");
        }
        if (!edge_item.contains("to") || !edge_item["to"].is_number_integer()) {
            throw std::runtime_error("DataLoader Error: Edge at index " + std::to_string(i) + " is missing valid 'to' node ID");
        }
        if (!edge_item.contains("distance_meters") || !edge_item["distance_meters"].is_number()) {
            throw std::runtime_error("DataLoader Error: Edge at index " + std::to_string(i) + " is missing valid 'distance_meters'");
        }

        const int64_t from_osm = edge_item["from"].get<int64_t>();
        const int64_t to_osm = edge_item["to"].get<int64_t>();
        const double distance_meters = edge_item["distance_meters"].get<double>();

        // Rejection of non-finite, zero, or negative edge weights
        if (!std::isfinite(distance_meters) || distance_meters <= 0.0) {
            throw std::invalid_argument("DataLoader Error: Edge at index " + std::to_string(i) +
                                        " has invalid weight: " + std::to_string(distance_meters) +
                                        ". Weights must be finite and strictly positive (> 0.0).");
        }

        // Rejection of missing source or target references
        uint32_t from_idx{0};
        uint32_t to_idx{0};
        if (!out_graph.TryGetInternalIndex(from_osm, from_idx)) {
            throw std::runtime_error("DataLoader Error: Edge at index " + std::to_string(i) +
                                     " references non-existent source node ID: " + std::to_string(from_osm));
        }
        if (!out_graph.TryGetInternalIndex(to_osm, to_idx)) {
            throw std::runtime_error("DataLoader Error: Edge at index " + std::to_string(i) +
                                     " references non-existent destination node ID: " + std::to_string(to_osm));
        }

        const int64_t osm_way_id = edge_item.value("road_id", int64_t{0});
        const std::string road_type_str = edge_item.value("road_type", "unknown");
        const uint16_t road_type_id = RoadTypeToId(road_type_str);

        const std::string road_name = edge_item.value("name", "");
        const uint16_t name_id = out_graph.InternRoadName(road_name);

        const std::string access_str = edge_item.value("access", "yes");
        const uint16_t access_id = AccessTypeToId(access_str);

        const bool oneway = edge_item.value("oneway", true);

        // Parse optional intermediate geometry coordinates
        std::vector<GeoPoint> geometry;
        if (edge_item.contains("geometry") && edge_item["geometry"].is_array()) {
            const auto& geom_arr = edge_item["geometry"];
            geometry.reserve(geom_arr.size());
            for (const auto& pt : geom_arr) {
                if (pt.is_array() && pt.size() >= 2) {
                    const double pt_lon = pt[0].get<double>();
                    const double pt_lat = pt[1].get<double>();
                    if (!std::isfinite(pt_lat) || !std::isfinite(pt_lon) ||
                        pt_lat < -90.0 || pt_lat > 90.0 || pt_lon < -180.0 || pt_lon > 180.0) {
                        throw std::runtime_error("DataLoader Error: Geometry coordinate out of valid bounds [-90, 90] / [-180, 180] in edge index " +
                                                 std::to_string(i) + " (lat=" + std::to_string(pt_lat) + ", lon=" + std::to_string(pt_lon) + ")");
                    }
                    geometry.push_back(GeoPoint{pt_lat, pt_lon});
                }
            }
        }

        out_graph.AddEdge(from_idx, to_idx, distance_meters, osm_way_id, road_type_id, name_id, access_id, oneway, geometry);
    }

    stats.edges_loaded = out_graph.EdgeCount();
    stats.unique_road_names = out_graph.UniqueNameCount();

    return stats;
}

} // namespace EmergencyRouting

