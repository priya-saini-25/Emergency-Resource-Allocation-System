#include "GraphConnectivity.hpp"
#include <algorithm>
#include <queue>
#include <unordered_map>
#include <iostream>

namespace EmergencyRouting {

namespace {

struct Dsu {
    std::vector<uint32_t> parent;
    std::vector<uint32_t> rank;

    explicit Dsu(size_t n) : parent(n), rank(n, 0) {
        for (size_t i = 0; i < n; ++i) {
            parent[i] = static_cast<uint32_t>(i);
        }
    }

    uint32_t Find(uint32_t x) {
        uint32_t root = x;
        while (root != parent[root]) {
            root = parent[root];
        }
        // Path compression
        uint32_t curr = x;
        while (curr != root) {
            uint32_t next = parent[curr];
            parent[curr] = root;
            curr = next;
        }
        return root;
    }

    void Union(uint32_t x, uint32_t y) {
        uint32_t rx = Find(x);
        uint32_t ry = Find(y);
        if (rx != ry) {
            if (rank[rx] < rank[ry]) {
                std::swap(rx, ry);
            }
            parent[ry] = rx;
            if (rank[rx] == rank[ry]) {
                ++rank[rx];
            }
        }
    }
};

} // namespace

WccResult GraphConnectivity::ComputeWCC(const Graph& graph) {
    const size_t n = graph.NodeCount();
    WccResult result;
    result.node_component_id.resize(n, 0);

    if (n == 0) {
        return result;
    }

    Dsu dsu(n);

    // Union along all directed edges (treated as undirected connections)
    for (uint32_t u = 0; u < n; ++u) {
        const auto& edges = graph.GetOutgoingEdges(u);
        for (const auto& e : edges) {
            if (e.target_idx < n) {
                dsu.Union(u, e.target_idx);
            }
        }
    }

    // Tally component sizes by root
    std::unordered_map<uint32_t, size_t> root_to_size;
    root_to_size.reserve(n / 2);
    for (uint32_t i = 0; i < n; ++i) {
        ++root_to_size[dsu.Find(i)];
    }

    // Sort components by size descending
    std::vector<std::pair<size_t, uint32_t>> sorted_components;
    sorted_components.reserve(root_to_size.size());
    for (const auto& kv : root_to_size) {
        sorted_components.push_back({kv.second, kv.first});
    }
    std::sort(sorted_components.begin(), sorted_components.end(),
              [](const auto& a, const auto& b) { return a.first > b.first; });

    // Map each root to a dense component ID (0 = largest)
    std::unordered_map<uint32_t, uint32_t> root_to_dense_id;
    result.component_sizes.reserve(sorted_components.size());
    for (size_t id = 0; id < sorted_components.size(); ++id) {
        root_to_dense_id[sorted_components[id].second] = static_cast<uint32_t>(id);
        result.component_sizes.push_back(sorted_components[id].first);
    }

    for (uint32_t i = 0; i < n; ++i) {
        result.node_component_id[i] = root_to_dense_id[dsu.Find(i)];
    }

    result.total_components = sorted_components.size();
    if (!sorted_components.empty()) {
        result.largest_component_size = sorted_components.front().first;
        result.largest_component_percentage = (static_cast<double>(result.largest_component_size) / static_cast<double>(n)) * 100.0;
    }

    return result;
}

SccResult GraphConnectivity::ComputeSCC(const Graph& graph) {
    const size_t n = graph.NodeCount();
    SccResult result;
    result.node_component_id.resize(n, 0);

    if (n == 0) {
        return result;
    }

    std::vector<int> dfn(n, -1);
    std::vector<int> low(n, -1);
    std::vector<bool> in_stack(n, false);
    std::vector<uint32_t> tarjan_stack;
    tarjan_stack.reserve(n);

    int timer = 0;
    std::vector<std::vector<uint32_t>> scc_components;

    struct Frame {
        uint32_t u;
        size_t edge_idx;
    };
    std::vector<Frame> call_stack;
    call_stack.reserve(n);

    for (uint32_t root = 0; root < n; ++root) {
        if (dfn[root] != -1) {
            continue;
        }

        dfn[root] = low[root] = ++timer;
        tarjan_stack.push_back(root);
        in_stack[root] = true;
        call_stack.push_back(Frame{root, 0});

        while (!call_stack.empty()) {
            uint32_t u = call_stack.back().u;
            size_t& e_idx = call_stack.back().edge_idx;
            const auto& edges = graph.GetOutgoingEdges(u);

            if (e_idx < edges.size()) {
                uint32_t v = edges[e_idx].target_idx;
                ++e_idx;

                if (v >= n) {
                    continue;
                }

                if (dfn[v] == -1) {
                    dfn[v] = low[v] = ++timer;
                    tarjan_stack.push_back(v);
                    in_stack[v] = true;
                    call_stack.push_back(Frame{v, 0});
                } else if (in_stack[v]) {
                    low[u] = std::min(low[u], dfn[v]);
                }
            } else {
                call_stack.pop_back();

                if (!call_stack.empty()) {
                    uint32_t parent_u = call_stack.back().u;
                    low[parent_u] = std::min(low[parent_u], low[u]);
                }

                if (low[u] == dfn[u]) {
                    std::vector<uint32_t> scc;
                    while (true) {
                        uint32_t v = tarjan_stack.back();
                        tarjan_stack.pop_back();
                        in_stack[v] = false;
                        scc.push_back(v);
                        if (v == u) break;
                    }
                    scc_components.push_back(std::move(scc));
                }
            }
        }
    }

    // Sort SCC components by size descending
    std::sort(scc_components.begin(), scc_components.end(),
              [](const auto& a, const auto& b) { return a.size() > b.size(); });

    result.total_components = scc_components.size();
    result.component_sizes.reserve(scc_components.size());

    for (size_t scc_id = 0; scc_id < scc_components.size(); ++scc_id) {
        result.component_sizes.push_back(scc_components[scc_id].size());
        for (uint32_t v : scc_components[scc_id]) {
            result.node_component_id[v] = static_cast<uint32_t>(scc_id);
        }
    }

    if (!scc_components.empty()) {
        result.largest_component_size = scc_components.front().size();
        result.largest_component_percentage = (static_cast<double>(result.largest_component_size) / static_cast<double>(n)) * 100.0;
    }

    return result;
}

FacilityReachabilityResult GraphConnectivity::CheckFacilityReachability(const Graph& graph,
                                                                       const WccResult& wcc,
                                                                       const SccResult& scc) {
    struct FacDef {
        std::string name;
        int64_t osm_id;
    };

    static const std::vector<FacDef> facility_defs = {
        {"AIIMS Jodhpur", 8520698362},
        {"MDM Hospital", 5321319416},
        {"Mathura Das Mathur Hospital", 8499684813},
        {"Basni", 2694302020},
        {"Sojati Gate", 2688566058},
        {"Paota", 3773158752}
    };

    FacilityReachabilityResult result;
    const size_t n = graph.NodeCount();

    // 1. Populate facility nodes & check WCC/SCC membership
    for (const auto& def : facility_defs) {
        FacilityReachabilityResult::FacilityNode fn;
        fn.name = def.name;
        fn.osm_id = def.osm_id;

        if (graph.TryGetInternalIndex(def.osm_id, fn.internal_idx)) {
            fn.wcc_id = (fn.internal_idx < wcc.node_component_id.size()) ? wcc.node_component_id[fn.internal_idx] : 999999;
            fn.scc_id = (fn.internal_idx < scc.node_component_id.size()) ? scc.node_component_id[fn.internal_idx] : 999999;
            fn.in_largest_wcc = (fn.wcc_id == 0);
            fn.in_largest_scc = (fn.scc_id == 0);
        } else {
            fn.internal_idx = 0xFFFFFFFF;
            fn.in_largest_wcc = false;
            fn.in_largest_scc = false;
        }
        result.facilities.push_back(fn);
    }

    // 2. Check directed BFS reachability for all 30 ordered pairs
    result.total_pairs = 30;
    result.reachable_pairs = 0;

    for (size_t i = 0; i < result.facilities.size(); ++i) {
        const auto& src = result.facilities[i];
        if (src.internal_idx >= n) continue;

        // Run standard directed BFS from src.internal_idx
        std::vector<bool> visited(n, false);
        std::vector<size_t> hops(n, 0);
        std::queue<uint32_t> q;

        visited[src.internal_idx] = true;
        q.push(src.internal_idx);

        while (!q.empty()) {
            uint32_t curr = q.front();
            q.pop();

            for (const auto& e : graph.GetOutgoingEdges(curr)) {
                if (e.target_idx < n && !visited[e.target_idx]) {
                    visited[e.target_idx] = true;
                    hops[e.target_idx] = hops[curr] + 1;
                    q.push(e.target_idx);
                }
            }
        }

        for (size_t j = 0; j < result.facilities.size(); ++j) {
            if (i == j) continue;
            const auto& dst = result.facilities[j];

            FacilityReachabilityResult::PairReachability pr;
            pr.from_name = src.name;
            pr.from_osm_id = src.osm_id;
            pr.to_name = dst.name;
            pr.to_osm_id = dst.osm_id;

            if (dst.internal_idx < n && visited[dst.internal_idx]) {
                pr.reachable = true;
                pr.bfs_hop_count = hops[dst.internal_idx];
                ++result.reachable_pairs;
            } else {
                pr.reachable = false;
                pr.bfs_hop_count = 0;
            }
            result.pairs.push_back(pr);
        }
    }

    result.all_pairs_reachable = (result.reachable_pairs == result.total_pairs);
    return result;
}

} // namespace EmergencyRouting

