#include "Dijkstra.hpp"
#include <queue>
#include <algorithm>
#include <stdexcept>
#include <cmath>
#include <iostream>
#include <unordered_map>

namespace EmergencyRouting {

DijkstraRouter::DijkstraRouter(const Graph& graph) : graph_(graph) {}

RouteResult DijkstraRouter::ShortestPath(uint32_t source_idx, uint32_t dest_idx) const {
    const size_t n = graph_.NodeCount();
    if (source_idx >= n || dest_idx >= n) {
        throw std::out_of_range("Node index out of range for Dijkstra search: source=" +
                                std::to_string(source_idx) + ", dest=" + std::to_string(dest_idx) +
                                ", total_nodes=" + std::to_string(n));
    }

    RouteResult res;
    res.source_internal_idx = source_idx;
    res.destination_internal_idx = dest_idx;
    res.source_osm_id = graph_.GetOsmId(source_idx);
    res.destination_osm_id = graph_.GetOsmId(dest_idx);

    auto t_start = std::chrono::steady_clock::now();

    // Source equals destination
    if (source_idx == dest_idx) {
        auto t_end = std::chrono::steady_clock::now();
        res.found = true;
        res.total_distance_meters = 0.0;
        res.path_internal_indices = {source_idx};
        res.path_osm_ids = {res.source_osm_id};
        res.visited_nodes = 1;
        res.relaxed_edges = 0;
        res.algorithm_execution_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        res.path_reconstruction_time_ms = 0.0;
        return res;
    }

    const double INF = std::numeric_limits<double>::infinity();
    std::vector<double> dist(n, INF);
    std::vector<Predecessor> predecessors(n);

    // Min-Priority Queue storing (distance, node_index)
    using PQElement = std::pair<double, uint32_t>;
    std::priority_queue<PQElement, std::vector<PQElement>, std::greater<PQElement>> pq;

    dist[source_idx] = 0.0;
    pq.push({0.0, source_idx});

    size_t visited_nodes = 0;
    size_t relaxed_edges = 0;
    bool reached = false;

    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();

        // Stale entry check
        if (d > dist[u]) {
            continue;
        }

        ++visited_nodes;

        // Early stopping when destination is popped from priority queue
        if (u == dest_idx) {
            reached = true;
            break;
        }

        const auto& edges = graph_.GetOutgoingEdges(u);
        relaxed_edges += edges.size();

        for (size_t i = 0; i < edges.size(); ++i) {
            const auto& edge = edges[i];
            const uint32_t v = edge.target_idx;
            if (v >= n) continue;

            const double candidate_dist = d + edge.distance_meters;
            if (!std::isfinite(candidate_dist)) {
                continue; // Guard against numerical overflow
            }

            if (candidate_dist < dist[v]) {
                dist[v] = candidate_dist;
                predecessors[v] = Predecessor{u, static_cast<uint32_t>(i)};
                pq.push({candidate_dist, v});
            }
        }
    }

    auto t_end = std::chrono::steady_clock::now();
    double algo_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();

    if (!reached || std::isinf(dist[dest_idx])) {
        res.found = false;
        res.total_distance_meters = INF;
        res.visited_nodes = visited_nodes;
        res.relaxed_edges = relaxed_edges;
        res.algorithm_execution_time_ms = algo_time_ms;
        res.path_reconstruction_time_ms = 0.0;
        return res;
    }

    return ReconstructPath(source_idx, dest_idx, dist[dest_idx], predecessors,
                           visited_nodes, relaxed_edges, algo_time_ms);
}

RouteResult DijkstraRouter::ShortestPathOsm(int64_t source_osm_id, int64_t dest_osm_id) const {
    uint32_t s_idx{0};
    uint32_t d_idx{0};

    if (!graph_.TryGetInternalIndex(source_osm_id, s_idx)) {
        throw std::out_of_range("Source OSM Node ID not found in graph: " + std::to_string(source_osm_id));
    }
    if (!graph_.TryGetInternalIndex(dest_osm_id, d_idx)) {
        throw std::out_of_range("Destination OSM Node ID not found in graph: " + std::to_string(dest_osm_id));
    }

    return ShortestPath(s_idx, d_idx);
}

SingleSourceResult DijkstraRouter::ShortestPathToAll(uint32_t source_idx) const {
    const size_t n = graph_.NodeCount();
    if (source_idx >= n) {
        throw std::out_of_range("Source node index out of range for Single-Source Dijkstra: source=" +
                                std::to_string(source_idx) + ", total_nodes=" + std::to_string(n));
    }

    SingleSourceResult ss;
    ss.source_internal_idx = source_idx;
    ss.source_osm_id = graph_.GetOsmId(source_idx);

    auto t_start = std::chrono::steady_clock::now();

    const double INF = std::numeric_limits<double>::infinity();
    ss.distances.assign(n, INF);
    ss.predecessors.resize(n);

    using PQElement = std::pair<double, uint32_t>;
    std::priority_queue<PQElement, std::vector<PQElement>, std::greater<PQElement>> pq;

    ss.distances[source_idx] = 0.0;
    pq.push({0.0, source_idx});

    size_t visited_nodes = 0;
    size_t relaxed_edges = 0;

    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();

        if (d > ss.distances[u]) {
            continue;
        }

        ++visited_nodes;

        const auto& edges = graph_.GetOutgoingEdges(u);
        relaxed_edges += edges.size();

        for (size_t i = 0; i < edges.size(); ++i) {
            const auto& edge = edges[i];
            const uint32_t v = edge.target_idx;
            if (v >= n) continue;

            const double candidate_dist = d + edge.distance_meters;
            if (!std::isfinite(candidate_dist)) {
                continue;
            }

            if (candidate_dist < ss.distances[v]) {
                ss.distances[v] = candidate_dist;
                ss.predecessors[v] = Predecessor{u, static_cast<uint32_t>(i)};
                pq.push({candidate_dist, v});
            }
        }
    }

    auto t_end = std::chrono::steady_clock::now();
    ss.algorithm_execution_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
    ss.visited_nodes = visited_nodes;
    ss.relaxed_edges = relaxed_edges;

    return ss;
}

SingleSourceResult DijkstraRouter::ShortestPathToAllOsm(int64_t source_osm_id) const {
    uint32_t s_idx{0};
    if (!graph_.TryGetInternalIndex(source_osm_id, s_idx)) {
        throw std::out_of_range("Source OSM Node ID not found in graph: " + std::to_string(source_osm_id));
    }
    return ShortestPathToAll(s_idx);
}

RouteResult DijkstraRouter::ReconstructRouteFromSingleSource(const SingleSourceResult& ss_res, uint32_t dest_idx) const {
    const size_t n = graph_.NodeCount();
    if (dest_idx >= n) {
        throw std::out_of_range("Destination index out of range: " + std::to_string(dest_idx));
    }

    RouteResult res;
    res.source_internal_idx = ss_res.source_internal_idx;
    res.destination_internal_idx = dest_idx;
    res.source_osm_id = ss_res.source_osm_id;
    res.destination_osm_id = graph_.GetOsmId(dest_idx);

    if (ss_res.source_internal_idx == dest_idx) {
        res.found = true;
        res.total_distance_meters = 0.0;
        res.path_internal_indices = {dest_idx};
        res.path_osm_ids = {res.source_osm_id};
        res.visited_nodes = 1;
        res.relaxed_edges = 0;
        res.algorithm_execution_time_ms = ss_res.algorithm_execution_time_ms;
        res.path_reconstruction_time_ms = 0.0;
        return res;
    }

    if (!ss_res.IsReachable(dest_idx)) {
        res.found = false;
        res.total_distance_meters = std::numeric_limits<double>::infinity();
        res.visited_nodes = ss_res.visited_nodes;
        res.relaxed_edges = ss_res.relaxed_edges;
        res.algorithm_execution_time_ms = ss_res.algorithm_execution_time_ms;
        res.path_reconstruction_time_ms = 0.0;
        return res;
    }

    return ReconstructPath(ss_res.source_internal_idx, dest_idx, ss_res.distances[dest_idx],
                           ss_res.predecessors, ss_res.visited_nodes, ss_res.relaxed_edges,
                           ss_res.algorithm_execution_time_ms);
}

RouteResult DijkstraRouter::ReconstructRouteFromSingleSourceOsm(const SingleSourceResult& ss_res, int64_t dest_osm_id) const {
    uint32_t d_idx{0};
    if (!graph_.TryGetInternalIndex(dest_osm_id, d_idx)) {
        throw std::out_of_range("Destination OSM Node ID not found in graph: " + std::to_string(dest_osm_id));
    }
    return ReconstructRouteFromSingleSource(ss_res, d_idx);
}

RouteResult DijkstraRouter::ReconstructPath(uint32_t source_idx,
                                            uint32_t dest_idx,
                                            double distance_meters,
                                            const std::vector<Predecessor>& predecessors,
                                            size_t visited_nodes,
                                            size_t relaxed_edges,
                                            double algo_time_ms) const {
    RouteResult res;
    res.source_internal_idx = source_idx;
    res.destination_internal_idx = dest_idx;
    res.source_osm_id = graph_.GetOsmId(source_idx);
    res.destination_osm_id = graph_.GetOsmId(dest_idx);
    res.total_distance_meters = distance_meters;
    res.visited_nodes = visited_nodes;
    res.relaxed_edges = relaxed_edges;
    res.algorithm_execution_time_ms = algo_time_ms;

    auto t_recon_start = std::chrono::steady_clock::now();

    const size_t n = graph_.NodeCount();
    std::vector<uint32_t> rev_nodes;
    std::vector<PathSegment> rev_segments;

    // Defensive bound: predecessor chain length cannot exceed graph vertex count.
    // This prevents infinite loops on any corrupted or adversarial predecessor array.
    const size_t max_steps = n;
    size_t steps = 0;

    bool chain_ok = true;
    uint32_t curr = dest_idx;

    while (curr != source_idx) {
        // Guard 1: index must be within [0, n-1]
        if (curr >= n) {
            std::cerr << "[CPP_WARN] ReconstructPath: out-of-range node index " << curr
                      << " encountered during backtracking. Marking route failed.\n";
            chain_ok = false;
            break;
        }

        // Guard 2: step budget (loop / cycle prevention)
        if (steps >= max_steps) {
            std::cerr << "[CPP_WARN] ReconstructPath: predecessor chain exceeded " << max_steps
                      << " steps without reaching source " << source_idx
                      << ". Possible cycle or corruption. Marking route failed.\n";
            chain_ok = false;
            break;
        }
        ++steps;

        // Guard 3: predecessor from_idx must be valid
        const auto& pred = predecessors[curr];
        if (pred.from_idx == 0xFFFFFFFF || pred.from_idx >= n) {
            std::cerr << "[CPP_WARN] ReconstructPath: invalid predecessor from_idx 0x"
                      << std::hex << pred.from_idx << std::dec
                      << " at node " << curr << ". Marking route failed.\n";
            chain_ok = false;
            break;
        }

        // Guard 4: predecessor edge_idx must be within adjacency list
        const auto& out_edges = graph_.GetOutgoingEdges(pred.from_idx);
        if (pred.edge_idx >= out_edges.size()) {
            std::cerr << "[CPP_WARN] ReconstructPath: edge_idx " << pred.edge_idx
                      << " out of bounds (adj size=" << out_edges.size()
                      << ") for node " << pred.from_idx << ". Marking route failed.\n";
            chain_ok = false;
            break;
        }

        const auto& edge = out_edges[pred.edge_idx];

        PathSegment seg;
        seg.from_idx = pred.from_idx;
        seg.to_idx = curr;
        seg.from_osm_id = graph_.GetOsmId(pred.from_idx);
        seg.to_osm_id = graph_.GetOsmId(curr);
        seg.osm_way_id = edge.osm_way_id;
        seg.distance_meters = edge.distance_meters;
        seg.road_type_id = edge.road_type_id;
        seg.name_id = edge.name_id;
        seg.access_id = edge.access_id;
        seg.oneway = edge.oneway;
        seg.geometry_offset = edge.geometry_offset;
        seg.geometry_count = edge.geometry_count;

        rev_segments.push_back(seg);
        rev_nodes.push_back(curr);
        curr = pred.from_idx;
    }

    // Guard 5: verify that the backtrack actually reached source_idx
    if (chain_ok && curr != source_idx) {
        std::cerr << "[CPP_WARN] ReconstructPath: backtrack terminated at node " << curr
                  << " instead of source " << source_idx << ". Marking route failed.\n";
        chain_ok = false;
    }

    if (!chain_ok) {
        // Failure path: return a clearly documented failure state.
        // Never emit a partial or disconnected route as successful.
        RouteResult failed;
        failed.found = false;
        failed.source_internal_idx = source_idx;
        failed.destination_internal_idx = dest_idx;
        failed.source_osm_id = res.source_osm_id;
        failed.destination_osm_id = res.destination_osm_id;
        failed.total_distance_meters = std::numeric_limits<double>::infinity();
        failed.visited_nodes = visited_nodes;
        failed.relaxed_edges = relaxed_edges;
        failed.algorithm_execution_time_ms = algo_time_ms;
        auto t_recon_end = std::chrono::steady_clock::now();
        failed.path_reconstruction_time_ms =
            std::chrono::duration<double, std::milli>(t_recon_end - t_recon_start).count();
        return failed;
    }

    rev_nodes.push_back(source_idx);

    // Reverse to forward trajectory order: [source, ..., destination]
    std::reverse(rev_nodes.begin(), rev_nodes.end());
    std::reverse(rev_segments.begin(), rev_segments.end());

    res.found = true;
    res.path_internal_indices = std::move(rev_nodes);
    res.path_segments = std::move(rev_segments);

    res.path_osm_ids.reserve(res.path_internal_indices.size());
    for (uint32_t idx : res.path_internal_indices) {
        res.path_osm_ids.push_back(graph_.GetOsmId(idx));
    }

    auto t_recon_end = std::chrono::steady_clock::now();
    res.path_reconstruction_time_ms =
        std::chrono::duration<double, std::milli>(t_recon_end - t_recon_start).count();

    return res;
}

MultiTargetResult DijkstraRouter::ShortestPathMultiTarget(
    uint32_t source_idx,
    const std::vector<uint32_t>& dest_indices,
    bool reconstruct_paths) const {

    const size_t n = graph_.NodeCount();
    if (source_idx >= n) {
        throw std::out_of_range("Source node index out of range for Multi-Target Dijkstra: source=" +
                                std::to_string(source_idx) + ", total_nodes=" + std::to_string(n));
    }

    auto t_total_start = std::chrono::steady_clock::now();

    MultiTargetResult res;
    res.source_internal_idx = source_idx;
    res.source_osm_id = graph_.GetOsmId(source_idx);
    const size_t num_dest = dest_indices.size();
    res.targets.resize(num_dest);

    // Initialize all targets
    const double INF = std::numeric_limits<double>::infinity();
    for (size_t i = 0; i < num_dest; ++i) {
        res.targets[i].destination_internal_idx = dest_indices[i];
        if (dest_indices[i] < n) {
            res.targets[i].destination_osm_id = graph_.GetOsmId(dest_indices[i]);
        } else {
            res.targets[i].destination_osm_id = 0;
        }
        res.targets[i].found = false;
        res.targets[i].total_distance_meters = INF;
    }

    // Handle vacuous case: empty destination list
    if (num_dest == 0) {
        res.unique_targets_requested = 0;
        res.unique_targets_settled = 0;
        res.all_targets_found = true; // Vacuous success
        res.visited_nodes = 0;
        res.relaxed_edges = 0;
        res.algorithm_execution_time_ms = 0.0;
        res.total_execution_time_ms = 0.0;
        return res;
    }

    // Deduplicate valid target indices and map to output slot positions
    // Status in target_status:
    // 0 = Not a target
    // 1 = Target registered (unsettled)
    // 2 = Target settled
    std::vector<uint8_t> target_status(n, 0);
    std::vector<uint32_t> unique_valid_targets;
    std::unordered_map<uint32_t, std::vector<size_t>> target_slots;

    for (size_t i = 0; i < num_dest; ++i) {
        uint32_t d_idx = dest_indices[i];
        if (d_idx >= n) {
            // Out of range index: remains found=false, dist=INF
            continue;
        }
        if (target_status[d_idx] == 0) {
            target_status[d_idx] = 1;
            unique_valid_targets.push_back(d_idx);
        }
        target_slots[d_idx].push_back(i);
    }

    res.unique_targets_requested = unique_valid_targets.size();
    size_t targets_remaining = unique_valid_targets.size();

    // If all requested targets were invalid indices
    if (targets_remaining == 0) {
        res.unique_targets_settled = 0;
        res.all_targets_found = false;
        res.visited_nodes = 0;
        res.relaxed_edges = 0;
        res.algorithm_execution_time_ms = 0.0;
        auto t_total_end = std::chrono::steady_clock::now();
        res.total_execution_time_ms =
            std::chrono::duration<double, std::milli>(t_total_end - t_total_start).count();
        return res;
    }

    auto t_algo_start = std::chrono::steady_clock::now();

    std::vector<double> dist(n, INF);
    std::vector<Predecessor> predecessors(n);

    using PQElement = std::pair<double, uint32_t>;
    std::priority_queue<PQElement, std::vector<PQElement>, std::greater<PQElement>> pq;

    dist[source_idx] = 0.0;
    pq.push({0.0, source_idx});

    size_t visited_nodes = 0;
    size_t relaxed_edges = 0;

    while (!pq.empty() && targets_remaining > 0) {
        auto [d, u] = pq.top();
        pq.pop();

        // Stale entry check
        if (d > dist[u]) {
            continue;
        }

        ++visited_nodes;

        // Check if u is an unresolved target
        if (target_status[u] == 1) {
            target_status[u] = 2; // Settled
            ++res.unique_targets_settled;
            --targets_remaining;
            if (targets_remaining == 0) {
                // Early termination: all reachable requested targets have been settled
                break;
            }
        }

        const auto& edges = graph_.GetOutgoingEdges(u);
        relaxed_edges += edges.size();

        for (size_t i = 0; i < edges.size(); ++i) {
            const auto& edge = edges[i];
            const uint32_t v = edge.target_idx;
            if (v >= n) continue;

            const double candidate_dist = d + edge.distance_meters;
            if (!std::isfinite(candidate_dist)) {
                continue;
            }

            if (candidate_dist < dist[v]) {
                dist[v] = candidate_dist;
                predecessors[v] = Predecessor{u, static_cast<uint32_t>(i)};
                pq.push({candidate_dist, v});
            }
        }
    }

    auto t_algo_end = std::chrono::steady_clock::now();
    double algo_time_ms = std::chrono::duration<double, std::milli>(t_algo_end - t_algo_start).count();

    res.visited_nodes = visited_nodes;
    res.relaxed_edges = relaxed_edges;
    res.algorithm_execution_time_ms = algo_time_ms;

    // Path reconstruction and result assignment
    for (uint32_t u : unique_valid_targets) {
        if (target_status[u] == 2 && !std::isinf(dist[u])) {
            RouteResult path_res;
            double recon_time = 0.0;

            if (reconstruct_paths) {
                auto t_rec_start = std::chrono::steady_clock::now();
                path_res = ReconstructPath(source_idx, u, dist[u], predecessors,
                                           visited_nodes, relaxed_edges, algo_time_ms);
                auto t_rec_end = std::chrono::steady_clock::now();
                recon_time = std::chrono::duration<double, std::milli>(t_rec_end - t_rec_start).count();
            }

            const auto& slots = target_slots[u];
            for (size_t slot : slots) {
                res.targets[slot].destination_internal_idx = u;
                res.targets[slot].destination_osm_id = graph_.GetOsmId(u);
                res.targets[slot].found = true;
                res.targets[slot].total_distance_meters = dist[u];
                if (reconstruct_paths) {
                    res.targets[slot].path_osm_ids = path_res.path_osm_ids;
                    res.targets[slot].path_internal_indices = path_res.path_internal_indices;
                    res.targets[slot].path_segments = path_res.path_segments;
                    res.targets[slot].path_reconstruction_time_ms = recon_time;
                }
            }
        } else {
            // Target was not reached (disconnected component, one-way trap, etc.)
            const auto& slots = target_slots[u];
            for (size_t slot : slots) {
                res.targets[slot].destination_internal_idx = u;
                res.targets[slot].destination_osm_id = graph_.GetOsmId(u);
                res.targets[slot].found = false;
                res.targets[slot].total_distance_meters = INF;
                res.targets[slot].path_osm_ids.clear();
                res.targets[slot].path_internal_indices.clear();
                res.targets[slot].path_segments.clear();
                res.targets[slot].path_reconstruction_time_ms = 0.0;
            }
        }
    }

    // Evaluate all_targets_found
    res.all_targets_found = true;
    for (size_t i = 0; i < num_dest; ++i) {
        if (!res.targets[i].found) {
            res.all_targets_found = false;
            break;
        }
    }

    auto t_total_end = std::chrono::steady_clock::now();
    res.total_execution_time_ms =
        std::chrono::duration<double, std::milli>(t_total_end - t_total_start).count();

    return res;
}

MultiTargetResult DijkstraRouter::ShortestPathMultiTargetOsm(
    int64_t source_osm_id,
    const std::vector<int64_t>& dest_osm_ids,
    bool reconstruct_paths) const {

    uint32_t s_idx{0};
    if (!graph_.TryGetInternalIndex(source_osm_id, s_idx)) {
        throw std::out_of_range("Source OSM Node ID not found in graph: " + std::to_string(source_osm_id));
    }

    std::vector<uint32_t> dest_indices;
    dest_indices.reserve(dest_osm_ids.size());
    for (int64_t osm_id : dest_osm_ids) {
        uint32_t d_idx{0xFFFFFFFF};
        if (graph_.TryGetInternalIndex(osm_id, d_idx)) {
            dest_indices.push_back(d_idx);
        } else {
            dest_indices.push_back(0xFFFFFFFF);
        }
    }

    MultiTargetResult res = ShortestPathMultiTarget(s_idx, dest_indices, reconstruct_paths);
    res.source_osm_id = source_osm_id;
    for (size_t i = 0; i < dest_osm_ids.size(); ++i) {
        res.targets[i].destination_osm_id = dest_osm_ids[i];
    }
    return res;
}

} // namespace EmergencyRouting
