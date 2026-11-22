#include "Graph.hpp"
#include "DataLoader.hpp"
#include "GraphIntegrity.hpp"
#include "GraphConnectivity.hpp"
#include "MemoryProfiler.hpp"
#include <iostream>
#include <iomanip>
#include <chrono>
#include <vector>

using namespace EmergencyRouting;

int main() {
    std::cout << "====================================================================\n"
              << "  PHASE 3.3 FULL CANONICAL GRAPH INTEGRITY & MEMORY AUDIT\n"
              << "====================================================================\n" << std::endl;

    // Stage 1: Process Baseline Memory
    ProcessMemorySnapshot baseline_mem = MemoryProfiler::Capture();
    std::cout << "[STAGE 1] Process Baseline Memory:\n"
              << "  Working Set (RSS): " << baseline_mem.WorkingSetMb() << " MB (" << baseline_mem.working_set_bytes << " bytes)\n"
              << "  Private Usage:     " << baseline_mem.PrivateMb() << " MB (" << baseline_mem.private_bytes << " bytes)\n"
              << "  Peak Working Set:  " << baseline_mem.PeakWorkingSetMb() << " MB\n" << std::endl;

    // Stage 2: Canonical Graph Ingestion
    std::cout << "[STAGE 2] Ingesting canonical dataset (data/jodhpur_graph.json)..." << std::endl;
    Graph graph;
    auto t_load_start = std::chrono::steady_clock::now();
    LoadStatistics stats = DataLoader::LoadFromJsonFile("data/jodhpur_graph.json", graph);
    auto t_load_end = std::chrono::steady_clock::now();
    double load_time_ms = std::chrono::duration<double, std::milli>(t_load_end - t_load_start).count();
    std::cout << "  Ingested in: " << load_time_ms << " ms (" << stats.nodes_loaded << " nodes, " << stats.edges_loaded << " edges)\n";

    // Stage 3 & 4: Post-Ingestion & Post-DOM Release Memory
    ProcessMemorySnapshot post_ingest_mem = MemoryProfiler::Capture();
    std::cout << "\n[STAGE 3 & 4] Post-Ingestion & Post-DOM Release Memory:\n"
              << "  Working Set (RSS): " << post_ingest_mem.WorkingSetMb() << " MB (" << post_ingest_mem.working_set_bytes << " bytes)\n"
              << "  Private Usage:     " << post_ingest_mem.PrivateMb() << " MB (" << post_ingest_mem.private_bytes << " bytes)\n"
              << "  Peak Working Set:  " << post_ingest_mem.PeakWorkingSetMb() << " MB\n"
              << "  Net Working Set Delta: " << (post_ingest_mem.WorkingSetMb() - baseline_mem.WorkingSetMb()) << " MB\n"
              << "  Net Private Delta:     " << (post_ingest_mem.PrivateMb() - baseline_mem.PrivateMb()) << " MB\n" << std::endl;

    // Stage 5: Structural Integrity Validation
    std::cout << "[STAGE 5] Executing Structural Integrity Validation..." << std::endl;
    auto t_val_start = std::chrono::steady_clock::now();
    ValidationResult val_res = GraphIntegrityValidator::Validate(graph, 59334, 129778);
    auto t_val_end = std::chrono::steady_clock::now();
    double val_time_ms = std::chrono::duration<double, std::milli>(t_val_end - t_val_start).count();

    ProcessMemorySnapshot post_val_mem = MemoryProfiler::Capture();

    std::cout << "  Total Invariant Checks: " << val_res.total_checks << "\n"
              << "  Passed Checks:          " << val_res.passed_checks << "\n"
              << "  Failed Checks:          " << val_res.failed_checks << "\n"
              << "  Validation Time:        " << val_time_ms << " ms\n"
              << "  Memory After Validation (Working Set): " << post_val_mem.WorkingSetMb() << " MB (Private: " << post_val_mem.PrivateMb() << " MB)\n"
              << "  Validation Verdict:     " << (val_res.IsValid() ? "PASSED (100% INVARIANTS SATISFIED)" : "FAILED") << "\n" << std::endl;

    if (!val_res.IsValid()) {
        std::cerr << "[ERROR] Structural validation errors encountered:\n";
        for (const auto& err : val_res.error_messages) {
            std::cerr << "  - " << err << "\n";
        }
        return 1;
    }

    // Stage 6: Graph Topological Metric Analysis
    IntegritySummary summary = GraphIntegrityValidator::AnalyzeMetrics(graph);
    std::cout << "[STAGE 6] Topological Summary & Degree Distribution:\n"
              << "  Bounding Box: Lat [" << std::fixed << std::setprecision(6)
              << summary.min_latitude << ", " << summary.max_latitude << "] N, Lon ["
              << summary.min_longitude << ", " << summary.max_longitude << "] E\n"
              << "  Boundary Nodes: " << summary.boundary_nodes_count << "\n"
              << "  In-Degree  (Min / Avg / Max): " << summary.min_in_degree << " / "
              << std::setprecision(2) << summary.avg_in_degree << " / " << summary.max_in_degree << "\n"
              << "  Out-Degree (Min / Avg / Max): " << summary.min_out_degree << " / "
              << std::setprecision(2) << summary.avg_out_degree << " / " << summary.max_out_degree << "\n"
              << "  Source Nodes (in=0, out>0): " << summary.source_nodes_count << "\n"
              << "  Sink Nodes   (in>0, out=0): " << summary.sink_nodes_count << "\n"
              << "  Isolated Nodes (in=0, out=0): " << summary.isolated_nodes_count << "\n"
              << "  Self-Loops: " << summary.self_loops_count << "\n"
              << "  Parallel Directed Edges: " << summary.multi_edges_count << "\n"
              << "  Oneway Directed Edges: " << summary.oneway_edges_count << "\n"
              << "  Total Intermediate Geometry Points: " << summary.total_geometry_points << "\n"
              << "  Total Road Distance Sum: " << (summary.total_distance_meters / 1000.0) << " km\n"
              << "  Min Edge Distance: " << summary.min_distance_meters << " m\n"
              << "  Max Edge Distance: " << summary.max_distance_meters << " m\n"
              << "  Avg Edge Distance: " << summary.avg_distance_meters << " m\n" << std::endl;

    // Stage 7: Connectivity Analysis (WCC & SCC)
    std::cout << "[STAGE 7] Executing Connectivity Analysis (WCC & SCC)..." << std::endl;

    // WCC
    auto t_wcc_start = std::chrono::steady_clock::now();
    WccResult wcc = GraphConnectivity::ComputeWCC(graph);
    auto t_wcc_end = std::chrono::steady_clock::now();
    double wcc_time_ms = std::chrono::duration<double, std::milli>(t_wcc_end - t_wcc_start).count();

    std::cout << "  Weakly Connected Components (WCC):\n"
              << "    Total Components:        " << wcc.total_components << " (Expected: 76)\n"
              << "    Largest WCC Nodes:       " << wcc.largest_component_size << " (Expected: 58877)\n"
              << "    Largest WCC Percentage:  " << std::setprecision(2) << wcc.largest_component_percentage << "% (Expected: 99.23%)\n"
              << "    Computation Time:        " << wcc_time_ms << " ms\n";

    // SCC
    auto t_scc_start = std::chrono::steady_clock::now();
    SccResult scc = GraphConnectivity::ComputeSCC(graph);
    auto t_scc_end = std::chrono::steady_clock::now();
    double scc_time_ms = std::chrono::duration<double, std::milli>(t_scc_end - t_scc_start).count();

    std::cout << "  Strongly Connected Components (SCC):\n"
              << "    Total Components:        " << scc.total_components << " (Expected: 206)\n"
              << "    Largest SCC Nodes:       " << scc.largest_component_size << " (Expected: 58658)\n"
              << "    Largest SCC Percentage:  " << std::setprecision(2) << scc.largest_component_percentage << "% (Expected: 98.86%)\n"
              << "    Computation Time:        " << scc_time_ms << " ms\n" << std::endl;

    // Stage 8: Emergency Facility Connectivity & 30-Pair Reachability
    std::cout << "[STAGE 8] Auditing Emergency Facility Connectivity & 30-Pair Directed Reachability..." << std::endl;
    auto t_reach_start = std::chrono::steady_clock::now();
    FacilityReachabilityResult reach = GraphConnectivity::CheckFacilityReachability(graph, wcc, scc);
    auto t_reach_end = std::chrono::steady_clock::now();
    double reach_time_ms = std::chrono::duration<double, std::milli>(t_reach_end - t_reach_start).count();

    ProcessMemorySnapshot post_conn_mem = MemoryProfiler::Capture();

    std::cout << "  Memory After Connectivity (Working Set): " << post_conn_mem.WorkingSetMb() << " MB (Private: " << post_conn_mem.PrivateMb() << " MB)\n"
              << "  Facility Component Membership:\n";
    for (const auto& fac : reach.facilities) {
        std::cout << "    - " << std::setw(28) << std::left << fac.name
                  << " (OSM: " << fac.osm_id << "): "
                  << "WCC #" << fac.wcc_id << " (" << (fac.in_largest_wcc ? "Giant WCC" : "Minor") << "), "
                  << "SCC #" << fac.scc_id << " (" << (fac.in_largest_scc ? "Giant SCC" : "Minor") << ")\n";
    }

    std::cout << "\n  30 Directed Pair Reachability Matrix:\n"
              << "    Total Directed Pairs Evaluated: " << reach.total_pairs << "\n"
              << "    Reachable Directed Pairs:       " << reach.reachable_pairs << " / " << reach.total_pairs << "\n"
              << "    All Pairs Reachable:            " << (reach.all_pairs_reachable ? "YES (100% REACHABLE)" : "NO") << "\n"
              << "    BFS Reachability Time:          " << reach_time_ms << " ms\n" << std::endl;

    // Stage 9: Performance Benchmarking (3 Iterations)
    std::cout << "[STAGE 9] Performance Benchmarking (3 Iterations):\n";
    const int iterations = 3;
    std::vector<double> val_times, wcc_times, scc_times, reach_times;

    for (int it = 1; it <= iterations; ++it) {
        // Val
        auto t0 = std::chrono::steady_clock::now();
        GraphIntegrityValidator::Validate(graph, 59334, 129778);
        auto t1 = std::chrono::steady_clock::now();
        val_times.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());

        // WCC
        t0 = std::chrono::steady_clock::now();
        GraphConnectivity::ComputeWCC(graph);
        t1 = std::chrono::steady_clock::now();
        wcc_times.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());

        // SCC
        t0 = std::chrono::steady_clock::now();
        GraphConnectivity::ComputeSCC(graph);
        t1 = std::chrono::steady_clock::now();
        scc_times.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());

        // Reachability
        t0 = std::chrono::steady_clock::now();
        GraphConnectivity::CheckFacilityReachability(graph, wcc, scc);
        t1 = std::chrono::steady_clock::now();
        reach_times.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());
    }

    auto print_bench = [](const std::string& name, const std::vector<double>& times) {
        double min_t = times[0];
        double max_t = times[0];
        double sum_t = 0.0;
        for (double t : times) {
            if (t < min_t) min_t = t;
            if (t > max_t) max_t = t;
            sum_t += t;
        }
        double avg_t = sum_t / static_cast<double>(times.size());
        std::cout << "  " << std::setw(28) << std::left << name << ": "
                  << "Min: " << std::setprecision(2) << std::fixed << std::setw(6) << min_t << " ms | "
                  << "Avg: " << std::setw(6) << avg_t << " ms | "
                  << "Max: " << std::setw(6) << max_t << " ms\n";
    };

    print_bench("Structural Validation", val_times);
    print_bench("WCC Analysis", wcc_times);
    print_bench("SCC Analysis (Tarjan)", scc_times);
    print_bench("Facility Reachability (BFS)", reach_times);

    // Final Acceptance Verification
    bool passed = (val_res.IsValid() &&
                   wcc.total_components == 76 &&
                   wcc.largest_component_size == 58877 &&
                   scc.total_components == 206 &&
                   scc.largest_component_size == 58658 &&
                   reach.all_pairs_reachable);

    std::cout << "\n====================================================================\n"
              << "  FINAL PHASE 3.3 CERTIFICATION VERDICT: "
              << (passed ? "ALL ACCEPTANCE CRITERIA MET (SUCCESS)" : "ACCEPTANCE FAILED") << "\n"
              << "====================================================================\n" << std::endl;

    return passed ? 0 : 1;
}

