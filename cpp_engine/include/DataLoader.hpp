#pragma once

#include "Graph.hpp"
#include <string>
#include <chrono>

namespace EmergencyRouting {

/**
 * Summary statistics recorded during dataset ingestion.
 */
struct LoadStatistics {
    size_t nodes_loaded{0};
    size_t edges_loaded{0};
    size_t unique_road_names{0};
    double load_time_ms{0.0};
    std::string metadata_city;
    std::string metadata_source;
};

/**
 * High-performance JSON Data Loader for Jodhpur road network graph.
 * Parses canonical OSM JSON datasets, validates topological integrity,
 * and populates the in-memory Graph structure.
 */
class DataLoader {
public:
    /**
     * Load the road network graph from a JSON file into the provided Graph instance.
     * Throws std::runtime_error on file I/O errors, parsing failures, or topological violations.
     * Throws std::invalid_argument on duplicate nodes or invalid edge weights.
     */
    static LoadStatistics LoadFromJsonFile(const std::string& filepath, Graph& out_graph);

    /**
     * Load the road network graph from a JSON string into the provided Graph instance.
     * Useful for synthetic testing and in-memory verification.
     */
    static LoadStatistics LoadFromJsonString(const std::string& json_content, Graph& out_graph);

private:
    // Internal helper parsing an nlohmann::json object
    static LoadStatistics IngestParsedJson(const void* parsed_json_ptr, Graph& out_graph);
};

} // namespace EmergencyRouting

