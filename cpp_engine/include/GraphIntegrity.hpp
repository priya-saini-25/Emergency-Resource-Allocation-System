#pragma once

#include "Graph.hpp"
#include <vector>
#include <string>
#include <map>
#include <iostream>

namespace EmergencyRouting {

/**
 * Granular structural validation result detailing passed/failed checks and first failing entities.
 */
struct ValidationResult {
    size_t total_checks{0};
    size_t passed_checks{0};
    size_t failed_checks{0};
    std::vector<std::string> error_messages;

    bool IsValid() const noexcept {
        return failed_checks == 0;
    }

    void RecordCheck(bool condition, const std::string& error_desc) {
        ++total_checks;
        if (condition) {
            ++passed_checks;
        } else {
            ++failed_checks;
            if (error_messages.size() < 100) { // Limit error messages to first 100 to avoid unbounded allocations
                error_messages.push_back(error_desc);
            }
        }
    }
};

/**
 * Comprehensive topological and structural integrity report for the ingested road graph.
 */
struct IntegritySummary {
    size_t total_nodes{0};
    size_t total_edges{0};
    size_t boundary_nodes_count{0};

    // Bounding Box
    double min_latitude{0.0};
    double max_latitude{0.0};
    double min_longitude{0.0};
    double max_longitude{0.0};

    // Degree Distribution
    uint32_t min_in_degree{0};
    uint32_t max_in_degree{0};
    double avg_in_degree{0.0};
    uint32_t min_out_degree{0};
    uint32_t max_out_degree{0};
    double avg_out_degree{0.0};
    size_t source_nodes_count{0};   // in == 0, out > 0
    size_t sink_nodes_count{0};     // in > 0, out == 0
    size_t isolated_nodes_count{0}; // in == 0, out == 0

    // Edge Metrics
    double min_distance_meters{0.0};
    double max_distance_meters{0.0};
    double avg_distance_meters{0.0};
    double total_distance_meters{0.0};
    size_t self_loops_count{0};
    size_t multi_edges_count{0};
    size_t oneway_edges_count{0};
    size_t total_geometry_points{0};

    // Classifications
    std::map<std::string, size_t> edges_by_road_type;
    std::map<std::string, size_t> edges_by_access;
};

/**
 * Structural integrity validator and analyzer.
 * Strictly read-only; never mutates the graph.
 */
class GraphIntegrityValidator {
public:
    /**
     * Perform exhaustive structural and topological validation.
     * @param graph The graph instance to validate.
     * @param expected_nodes Expected node count (default: 59334 for canonical dataset, 0 to skip count check).
     * @param expected_edges Expected edge count (default: 129778 for canonical dataset, 0 to skip count check).
     */
    static ValidationResult Validate(const Graph& graph,
                                     size_t expected_nodes = 59334,
                                     size_t expected_edges = 129778);

    /**
     * Compute summary statistics and degree distributions.
     */
    static IntegritySummary AnalyzeMetrics(const Graph& graph);
};

} // namespace EmergencyRouting
