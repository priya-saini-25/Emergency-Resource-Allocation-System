#include "SpatialGrid.hpp"
#include "RouteGeometry.hpp"
#include "GraphConnectivity.hpp"
#include <cmath>
#include <queue>
#include <algorithm>
#include <chrono>
#include <stdexcept>
#include <limits>

namespace EmergencyRouting {

namespace {

constexpr double PI = 3.14159265358979323846;

} // anonymous namespace

double SpatialGrid::CellLowerBound(double qlat, double qlon,
                                   double min_lat, double max_lat,
                                   double min_lon, double max_lon) {
    if (!std::isfinite(qlat) || !std::isfinite(qlon) ||
        !std::isfinite(min_lat) || !std::isfinite(max_lat) ||
        !std::isfinite(min_lon) || !std::isfinite(max_lon)) {
        return std::numeric_limits<double>::infinity();
    }

    if (min_lat > max_lat || min_lon > max_lon) {
        return std::numeric_limits<double>::infinity();
    }

    constexpr double TO_RAD = PI / 180.0;
    constexpr double EARTH_RADIUS_METERS = 6371008.8; // IUGG standard matching RouteGeometry

    // 1. Minimum latitude separation to cell interval
    double dlat_deg = 0.0;
    if (qlat < min_lat) {
        dlat_deg = min_lat - qlat;
    } else if (qlat > max_lat) {
        dlat_deg = qlat - max_lat;
    }

    // 2. Minimum wrapped longitude separation to cell interval
    double dlon_deg = 0.0;
    if (qlon < min_lon || qlon > max_lon) {
        auto angular_dist = [](double lon1, double lon2) {
            double diff = std::fmod(std::abs(lon1 - lon2), 360.0);
            return (diff > 180.0) ? (360.0 - diff) : diff;
        };
        dlon_deg = std::min(angular_dist(qlon, min_lon), angular_dist(qlon, max_lon));
    }

    const double dphi = dlat_deg * TO_RAD;
    const double dlam = dlon_deg * TO_RAD;
    const double sin_dphi_2 = std::sin(dphi * 0.5);
    const double sin_dlam_2 = std::sin(dlam * 0.5);

    // 3. Minimum cosine over the cell's latitude interval [min_lat, max_lat]
    // Cosine decreases monotonically with |latitude| away from the equator.
    // For any interval [min_lat, max_lat] in [-90, 90], the minimum cosine
    // occurs at either min_lat or max_lat.
    const double rmin_lat = min_lat * TO_RAD;
    const double rmax_lat = max_lat * TO_RAD;
    const double cos_cell_min = std::max(0.0, std::min(std::cos(rmin_lat), std::cos(rmax_lat)));

    const double rlat_q = qlat * TO_RAD;
    const double cos_q = std::max(0.0, std::cos(rlat_q));

    // 4. Provably conservative Haversine lower bound:
    // For all P(phi, lam) in cell:
    // sin^2((phi - qlat)/2) >= sin^2(dphi/2)
    // cos(phi) >= cos_cell_min
    // sin^2((lam - qlon)/2) >= sin^2(dlam/2)
    const double h = sin_dphi_2 * sin_dphi_2 + cos_q * cos_cell_min * sin_dlam_2 * sin_dlam_2;
    const double clamped_h = (h > 1.0) ? 1.0 : ((h < 0.0) ? 0.0 : h);
    const double c = 2.0 * std::atan2(std::sqrt(clamped_h), std::sqrt(1.0 - clamped_h));
    const double raw_dist = EARTH_RADIUS_METERS * c;

    // 5. Defensive floating-point safeguard:
    // Subtract 1e-11 meters + 1e-14 * raw_dist to guarantee that numerical roundoff
    // in trigonometric library functions never produces an unsafe overestimate.
    return std::max(0.0, raw_dist * (1.0 - 1e-14) - 1e-11);
}

void SpatialGrid::Build(const Graph& graph, double cell_size_meters) {
    graph_ = &graph;
    cell_size_meters_ = (cell_size_meters > 0.0) ? cell_size_meters : DEFAULT_CELL_SIZE_METERS;
    Clear();

    const auto& nodes = graph_->GetAllNodes();
    nodes_count_ = nodes.size();

    if (nodes_count_ == 0) {
        is_built_ = true;
        return;
    }

    // 1. Calculate Weakly Connected Components (WCC) and identify Principal Connected Component (GCC)
    WccResult wcc = GraphConnectivity::ComputeWCC(*graph_);
    node_component_id_ = std::move(wcc.node_component_id);
    gcc_size_ = wcc.largest_component_size;
    has_gcc_ = (gcc_size_ > 1);

    is_in_gcc_.assign(nodes_count_, false);
    if (has_gcc_) {
        for (size_t i = 0; i < nodes_count_; ++i) {
            if (node_component_id_[i] == 0) {
                is_in_gcc_[i] = true;
            }
        }
    } else {
        std::fill(is_in_gcc_.begin(), is_in_gcc_.end(), true);
    }

    // 2. Calculate Strongly Connected Components (SCC) using Tarjan's algorithm
    SccResult scc = GraphConnectivity::ComputeSCC(*graph_);
    node_scc_id_ = std::move(scc.node_component_id);
    scc_size_ = scc.largest_component_size;
    has_scc_ = (scc_size_ > 1);

    is_in_scc_.assign(nodes_count_, false);
    if (has_scc_) {
        for (size_t i = 0; i < nodes_count_; ++i) {
            if (node_scc_id_[i] == 0) {
                is_in_scc_[i] = true;
            }
        }
    } else if (has_gcc_) {
        // Fall back to Giant WCC if no multi-node SCC exists (e.g. DAG)
        is_in_scc_ = is_in_gcc_;
    } else {
        // Synthetic graph with no edges: all nodes treated equally
        std::fill(is_in_scc_.begin(), is_in_scc_.end(), true);
    }

    min_lat_ = 90.0;
    max_lat_ = -90.0;
    min_lon_ = 180.0;
    max_lon_ = -180.0;

    for (const auto& n : nodes) {
        min_lat_ = std::min(min_lat_, n.latitude);
        max_lat_ = std::max(max_lat_, n.latitude);
        min_lon_ = std::min(min_lon_, n.longitude);
        max_lon_ = std::max(max_lon_, n.longitude);
    }

    // Determine geographic degree scale around the region's mean latitude
    const double mean_lat_rad = 0.5 * (min_lat_ + max_lat_) * (PI / 180.0);
    const double m_per_deg_lat = 111132.92 - 559.82 * std::cos(2.0 * mean_lat_rad);
    const double m_per_deg_lon = 111412.84 * std::cos(mean_lat_rad);

    dlat_ = cell_size_meters_ / m_per_deg_lat;
    dlon_ = cell_size_meters_ / m_per_deg_lon;

    n_rows_ = static_cast<size_t>(std::ceil((max_lat_ - min_lat_) / dlat_)) + 1;
    n_cols_ = static_cast<size_t>(std::ceil((max_lon_ - min_lon_) / dlon_)) + 1;

    cells_.assign(n_rows_ * n_cols_, std::vector<uint32_t>());

    // Index all nodes into grid cells
    for (size_t i = 0; i < nodes_count_; ++i) {
        const auto& n = nodes[i];
        int32_t r = static_cast<int32_t>(std::floor((n.latitude - min_lat_) / dlat_));
        int32_t c = static_cast<int32_t>(std::floor((n.longitude - min_lon_) / dlon_));
        r = std::max(0, std::min(static_cast<int32_t>(n_rows_ - 1), r));
        c = std::max(0, std::min(static_cast<int32_t>(n_cols_ - 1), c));

        cells_[static_cast<size_t>(r) * n_cols_ + static_cast<size_t>(c)].push_back(static_cast<uint32_t>(i));
    }

    is_built_ = true;
}

void SpatialGrid::Clear() {
    cells_.clear();
    node_component_id_.clear();
    node_scc_id_.clear();
    is_in_gcc_.clear();
    is_in_scc_.clear();
    has_gcc_ = false;
    has_scc_ = false;
    gcc_size_ = 0;
    scc_size_ = 0;
    n_rows_ = 0;
    n_cols_ = 0;
    nodes_count_ = 0;
    is_built_ = false;
}

size_t SpatialGrid::NonEmptyCellCount() const noexcept {
    size_t count = 0;
    for (const auto& c : cells_) {
        if (!c.empty()) {
            ++count;
        }
    }
    return count;
}

size_t SpatialGrid::MemoryFootprintBytes() const noexcept {
    size_t total = sizeof(SpatialGrid);
    total += cells_.capacity() * sizeof(std::vector<uint32_t>);
    for (const auto& c : cells_) {
        total += c.capacity() * sizeof(uint32_t);
    }
    total += node_component_id_.capacity() * sizeof(uint32_t);
    total += node_scc_id_.capacity() * sizeof(uint32_t);
    total += is_in_gcc_.capacity() * sizeof(bool);
    total += is_in_scc_.capacity() * sizeof(bool);
    return total;
}

bool SpatialGrid::IsNodeInPrincipalComponent(uint32_t internal_idx) const noexcept {
    if (!has_gcc_ || is_in_gcc_.empty()) {
        return true;
    }
    if (internal_idx < is_in_gcc_.size()) {
        return is_in_gcc_[internal_idx];
    }
    return false;
}

bool SpatialGrid::IsNodeInGiantSCC(uint32_t internal_idx) const noexcept {
    if (!has_scc_ || is_in_scc_.empty()) {
        return true;
    }
    if (internal_idx < is_in_scc_.size()) {
        return is_in_scc_[internal_idx];
    }
    return false;
}

uint32_t SpatialGrid::GetNodeComponentId(uint32_t internal_idx) const {
    if (internal_idx < node_component_id_.size()) {
        return node_component_id_[internal_idx];
    }
    return 0;
}

uint32_t SpatialGrid::GetNodeSccId(uint32_t internal_idx) const {
    if (internal_idx < node_scc_id_.size()) {
        return node_scc_id_[internal_idx];
    }
    return 0;
}

std::vector<SnapResult> SpatialGrid::FindNearestCandidates(
    double query_lat,
    double query_lon,
    SnapPolicy policy,
    double max_distance_meters,
    size_t max_candidates) const {

    std::vector<SnapResult> results;
    if (!std::isfinite(query_lat) || !std::isfinite(query_lon) ||
        query_lat < -90.0 || query_lat > 90.0 || query_lon < -180.0 || query_lon > 180.0 ||
        !is_built_ || nodes_count_ == 0 || !graph_ || max_candidates == 0) {
        return results;
    }

    int32_t rq = static_cast<int32_t>(std::floor((query_lat - min_lat_) / dlat_));
    int32_t cq = static_cast<int32_t>(std::floor((query_lon - min_lon_) / dlon_));
    rq = std::max(0, std::min(static_cast<int32_t>(n_rows_ - 1), rq));
    cq = std::max(0, std::min(static_cast<int32_t>(n_cols_ - 1), cq));

    struct PQItem {
        double dist;
        int32_t r;
        int32_t c;
        bool operator>(const PQItem& other) const noexcept {
            return dist > other.dist;
        }
    };

    std::priority_queue<PQItem, std::vector<PQItem>, std::greater<PQItem>> pq;
    std::vector<bool> visited(n_rows_ * n_cols_, false);

    auto get_cell_bounds = [this](int32_t r, int32_t c,
                                  double& c_min_lat, double& c_max_lat,
                                  double& c_min_lon, double& c_max_lon) {
        c_min_lat = min_lat_ + r * dlat_;
        c_max_lat = c_min_lat + dlat_;
        c_min_lon = min_lon_ + c * dlon_;
        c_max_lon = c_min_lon + dlon_;
    };

    double c_min_lat, c_max_lat, c_min_lon, c_max_lon;
    get_cell_bounds(rq, cq, c_min_lat, c_max_lat, c_min_lon, c_max_lon);
    double lb0 = CellLowerBound(query_lat, query_lon, c_min_lat, c_max_lat, c_min_lon, c_max_lon);

    pq.push({lb0, rq, cq});
    visited[static_cast<size_t>(rq) * n_cols_ + static_cast<size_t>(cq)] = true;

    const auto& nodes = graph_->GetAllNodes();
    std::vector<std::pair<double, uint32_t>> gathered;

    while (!pq.empty()) {
        auto [lb, r, c] = pq.top();
        pq.pop();

        if (lb > max_distance_meters) {
            break;
        }

        const auto& cell_nodes = cells_[static_cast<size_t>(r) * n_cols_ + static_cast<size_t>(c)];
        for (uint32_t node_idx : cell_nodes) {
            const auto& node = nodes[node_idx];
            if (policy == SnapPolicy::STRICT_INTERIOR_ONLY && node.is_boundary) {
                continue;
            }
            double d = RouteGeometry::HaversineDistanceMeters(query_lat, query_lon, node.latitude, node.longitude);
            if (d <= max_distance_meters) {
                gathered.push_back({d, node_idx});
            }
        }

        for (int32_t dr = -1; dr <= 1; ++dr) {
            for (int32_t dc = -1; dc <= 1; ++dc) {
                if (dr == 0 && dc == 0) continue;
                int32_t nr = r + dr;
                int32_t nc = c + dc;
                if (nr >= 0 && nr < static_cast<int32_t>(n_rows_) &&
                    nc >= 0 && nc < static_cast<int32_t>(n_cols_)) {
                    size_t n_idx = static_cast<size_t>(nr) * n_cols_ + static_cast<size_t>(nc);
                    if (!visited[n_idx]) {
                        visited[n_idx] = true;
                        double nb_min_lat, nb_max_lat, nb_min_lon, nb_max_lon;
                        get_cell_bounds(nr, nc, nb_min_lat, nb_max_lat, nb_min_lon, nb_max_lon);
                        double nlb = CellLowerBound(query_lat, query_lon, nb_min_lat, nb_max_lat, nb_min_lon, nb_max_lon);
                        if (nlb <= max_distance_meters) {
                            pq.push({nlb, nr, nc});
                        }
                    }
                }
            }
        }
    }

    std::sort(gathered.begin(), gathered.end(), [&nodes](const auto& a, const auto& b) {
        if (a.first != b.first) return a.first < b.first;
        return nodes[a.second].osm_id < nodes[b.second].osm_id;
    });

    size_t limit = std::min(max_candidates, gathered.size());
    results.reserve(limit);
    for (size_t i = 0; i < limit; ++i) {
        uint32_t idx = gathered[i].second;
        SnapResult sr;
        sr.found = true;
        sr.status = SnapStatus::SUCCESS;
        sr.query_latitude = query_lat;
        sr.query_longitude = query_lon;
        sr.snapped_internal_index = idx;
        sr.snapped_osm_id = nodes[idx].osm_id;
        sr.snapped_latitude = nodes[idx].latitude;
        sr.snapped_longitude = nodes[idx].longitude;
        sr.snap_distance_meters = gathered[i].first;
        sr.snapped_is_boundary_node = nodes[idx].is_boundary;
        sr.snapped_is_in_gcc = (has_gcc_ && !is_in_gcc_.empty()) ? is_in_gcc_[idx] : true;
        sr.snapped_is_in_scc = (has_scc_ && !is_in_scc_.empty()) ? is_in_scc_[idx] : true;
        sr.snapped_component_id = node_component_id_.empty() ? 0 : node_component_id_[idx];
        sr.snapped_scc_id = node_scc_id_.empty() ? 0 : node_scc_id_[idx];
        results.push_back(sr);
    }
    return results;
}

SnapResult SpatialGrid::FindNearestNode(double query_lat,
                                       double query_lon,
                                       SnapPolicy policy,
                                       double max_distance_meters) const {
    auto t_start = std::chrono::steady_clock::now();
    SnapResult res;
    res.query_latitude = query_lat;
    res.query_longitude = query_lon;

    if (!std::isfinite(query_lat) || !std::isfinite(query_lon) ||
        query_lat < -90.0 || query_lat > 90.0 || query_lon < -180.0 || query_lon > 180.0) {
        res.found = false;
        res.status = SnapStatus::INVALID_COORDINATES;
        res.error_message = "Invalid query coordinates: non-finite or out of range";
        auto t_end = std::chrono::steady_clock::now();
        res.execution_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return res;
    }

    if (!is_built_ || nodes_count_ == 0 || !graph_) {
        res.found = false;
        res.status = SnapStatus::NO_NODES_AVAILABLE;
        res.error_message = "SpatialGrid is empty or uninitialized";
        auto t_end = std::chrono::steady_clock::now();
        res.execution_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return res;
    }

    // Determine query row and col
    int32_t rq = static_cast<int32_t>(std::floor((query_lat - min_lat_) / dlat_));
    int32_t cq = static_cast<int32_t>(std::floor((query_lon - min_lon_) / dlon_));
    rq = std::max(0, std::min(static_cast<int32_t>(n_rows_ - 1), rq));
    cq = std::max(0, std::min(static_cast<int32_t>(n_cols_ - 1), cq));

    double best_reach_dist = max_distance_meters;
    uint32_t best_reach_idx = 0xFFFFFFFF;
    int64_t best_reach_osm_id = 0;

    double best_any_dist = max_distance_meters;
    uint32_t best_any_idx = 0xFFFFFFFF;
    int64_t best_any_osm_id = 0;

    struct PQItem {
        double dist;
        int32_t r;
        int32_t c;
        bool operator>(const PQItem& other) const noexcept {
            return dist > other.dist;
        }
    };

    std::priority_queue<PQItem, std::vector<PQItem>, std::greater<PQItem>> pq;
    std::vector<bool> visited(n_rows_ * n_cols_, false);

    auto get_cell_bounds = [this](int32_t r, int32_t c,
                                  double& c_min_lat, double& c_max_lat,
                                  double& c_min_lon, double& c_max_lon) {
        c_min_lat = min_lat_ + r * dlat_;
        c_max_lat = c_min_lat + dlat_;
        c_min_lon = min_lon_ + c * dlon_;
        c_max_lon = c_min_lon + dlon_;
    };

    double c_min_lat, c_max_lat, c_min_lon, c_max_lon;
    get_cell_bounds(rq, cq, c_min_lat, c_max_lat, c_min_lon, c_max_lon);
    double lb0 = CellLowerBound(query_lat, query_lon, c_min_lat, c_max_lat, c_min_lon, c_max_lon);

    pq.push({lb0, rq, cq});
    visited[static_cast<size_t>(rq) * n_cols_ + static_cast<size_t>(cq)] = true;

    size_t cells_examined = 0;
    size_t candidates_examined = 0;

    const auto& nodes = graph_->GetAllNodes();

    while (!pq.empty()) {
        auto [lb, r, c] = pq.top();
        pq.pop();

        // Exact search termination guarantee:
        // If a connected, reachable candidate has been found, best_reach_dist <= max_distance_meters.
        // No unvisited cell with lb > best_reach_dist can contain any node closer than best_reach_dist.
        // If no reachable candidate has been found yet, best_reach_dist == max_distance_meters.
        if (lb > best_reach_dist) {
            break;
        }

        ++cells_examined;
        const auto& cell_nodes = cells_[static_cast<size_t>(r) * n_cols_ + static_cast<size_t>(c)];

        for (uint32_t node_idx : cell_nodes) {
            ++candidates_examined;
            const auto& node = nodes[node_idx];

            // Filter boundary endpoints when STRICT_INTERIOR_ONLY is active
            if (policy == SnapPolicy::STRICT_INTERIOR_ONLY && node.is_boundary) {
                continue;
            }

            double d = RouteGeometry::HaversineDistanceMeters(query_lat, query_lon, node.latitude, node.longitude);

            // 1. Maintain closest candidate across ALL components (for diagnostic classification)
            if (d < best_any_dist) {
                best_any_dist = d;
                best_any_idx = node_idx;
                best_any_osm_id = node.osm_id;
            } else if (d == best_any_dist) {
                // Deterministic tie-breaking on exact IEEE 754 float equality: prefer smaller 64-bit OSM ID
                if (best_any_idx == 0xFFFFFFFF || node.osm_id < best_any_osm_id) {
                    best_any_dist = d;
                    best_any_idx = node_idx;
                    best_any_osm_id = node.osm_id;
                }
            }

            // 2. Maintain closest candidate in Strongly Connected Component (SCC #0)
            bool in_reach = is_in_scc_.empty() ? true : is_in_scc_[node_idx];
            if (in_reach) {
                if (d < best_reach_dist) {
                    best_reach_dist = d;
                    best_reach_idx = node_idx;
                    best_reach_osm_id = node.osm_id;
                } else if (d == best_reach_dist) {
                    if (best_reach_idx == 0xFFFFFFFF || node.osm_id < best_reach_osm_id) {
                        best_reach_dist = d;
                        best_reach_idx = node_idx;
                        best_reach_osm_id = node.osm_id;
                    }
                }
            }
        }

        // Expand 8-connected neighboring cells
        for (int32_t dr = -1; dr <= 1; ++dr) {
            for (int32_t dc = -1; dc <= 1; ++dc) {
                if (dr == 0 && dc == 0) continue;
                int32_t nr = r + dr;
                int32_t nc = c + dc;
                if (nr >= 0 && nr < static_cast<int32_t>(n_rows_) &&
                    nc >= 0 && nc < static_cast<int32_t>(n_cols_)) {
                    size_t n_idx = static_cast<size_t>(nr) * n_cols_ + static_cast<size_t>(nc);
                    if (!visited[n_idx]) {
                        visited[n_idx] = true;
                        double nb_min_lat, nb_max_lat, nb_min_lon, nb_max_lon;
                        get_cell_bounds(nr, nc, nb_min_lat, nb_max_lat, nb_min_lon, nb_max_lon);
                        double nlb = CellLowerBound(query_lat, query_lon, nb_min_lat, nb_max_lat, nb_min_lon, nb_max_lon);
                        if (nlb <= best_reach_dist) {
                            pq.push({nlb, nr, nc});
                        }
                    }
                }
            }
        }
    }

    auto t_end = std::chrono::steady_clock::now();
    res.execution_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
    res.candidate_nodes_examined = candidates_examined;
    res.grid_cells_examined = cells_examined;

    // Strict safety invariant: only select candidates from the reachable connected network.
    // NEVER fall back to arbitrary disconnected or dead-end components!
    if (best_reach_idx != 0xFFFFFFFF && best_reach_dist <= max_distance_meters) {
        res.found = true;
        res.status = SnapStatus::SUCCESS;
        res.snapped_internal_index = best_reach_idx;
        res.snapped_osm_id = best_reach_osm_id;
        res.snapped_latitude = nodes[best_reach_idx].latitude;
        res.snapped_longitude = nodes[best_reach_idx].longitude;
        res.snap_distance_meters = best_reach_dist;
        res.snapped_is_boundary_node = nodes[best_reach_idx].is_boundary;
        res.snapped_is_in_gcc = (has_gcc_ && !is_in_gcc_.empty()) ? is_in_gcc_[best_reach_idx] : true;
        res.snapped_is_in_scc = (has_scc_ && !is_in_scc_.empty()) ? is_in_scc_[best_reach_idx] : true;
        res.snapped_component_id = (node_component_id_.empty() ? 0 : node_component_id_[best_reach_idx]);
        res.snapped_scc_id = (node_scc_id_.empty() ? 0 : node_scc_id_[best_reach_idx]);
    } else {
        res.found = false;
        res.snapped_is_boundary_node = false;
        res.snapped_is_in_gcc = false;
        res.snapped_is_in_scc = false;
        res.snapped_component_id = (best_any_idx != 0xFFFFFFFF && !node_component_id_.empty()) ? node_component_id_[best_any_idx] : 0;
        res.snapped_scc_id = (best_any_idx != 0xFFFFFFFF && !node_scc_id_.empty()) ? node_scc_id_[best_any_idx] : 0;

        if (best_any_idx != 0xFFFFFFFF && best_any_dist <= max_distance_meters) {
            res.status = SnapStatus::NO_CONNECTED_ROAD_NETWORK_AVAILABLE;
            res.error_message = "No connected, reachable road network node found within maximum snapping distance of " +
                                std::to_string(max_distance_meters) + " meters (nearby road elements belong to disconnected or dead-end subgraphs)";
        } else {
            res.status = SnapStatus::SNAP_DISTANCE_EXCEEDED;
            res.error_message = "No eligible graph node found within maximum snapping distance of " +
                                std::to_string(max_distance_meters) + " meters";
        }
    }

    return res;
}

SnapResult SpatialGrid::SnapCoordinate(double query_lat,
                                      double query_lon,
                                      SnapPolicy policy,
                                      const BoundaryValidator* validator,
                                      double max_distance_meters) const {
    // Stage 1: Coordinate validity
    if (!std::isfinite(query_lat) || !std::isfinite(query_lon) ||
        query_lat < -90.0 || query_lat > 90.0 || query_lon < -180.0 || query_lon > 180.0) {
        SnapResult res;
        res.query_latitude = query_lat;
        res.query_longitude = query_lon;
        res.found = false;
        res.status = SnapStatus::INVALID_COORDINATES;
        res.error_message = "Invalid query coordinates: non-finite or out of range";
        return res;
    }

    // Stage 2: Approved Service Area Boundary Validation (if validator provided)
    if (validator && validator->IsLoaded()) {
        if (!validator->IsInside(query_lat, query_lon)) {
            SnapResult res;
            res.query_latitude = query_lat;
            res.query_longitude = query_lon;
            res.found = false;
            res.status = SnapStatus::OUTSIDE_SERVICE_AREA;
            res.error_message = "Query location lies outside the approved Jodhpur Urban Service Area (Way 31725312)";
            return res;
        }
    }

    // Stage 3: Exact nearest-node search on SpatialGrid with selected policy
    return FindNearestNode(query_lat, query_lon, policy, max_distance_meters);
}

SnapResult SpatialGrid::BruteForceFindNearestNode(double query_lat,
                                                 double query_lon,
                                                 SnapPolicy policy,
                                                 double max_distance_meters) const {
    auto t_start = std::chrono::steady_clock::now();
    SnapResult res;
    res.query_latitude = query_lat;
    res.query_longitude = query_lon;

    if (!std::isfinite(query_lat) || !std::isfinite(query_lon) ||
        query_lat < -90.0 || query_lat > 90.0 || query_lon < -180.0 || query_lon > 180.0) {
        res.found = false;
        res.status = SnapStatus::INVALID_COORDINATES;
        res.error_message = "Invalid query coordinates: non-finite or out of range";
        auto t_end = std::chrono::steady_clock::now();
        res.execution_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return res;
    }

    if (!graph_ || nodes_count_ == 0) {
        res.found = false;
        res.status = SnapStatus::NO_NODES_AVAILABLE;
        res.error_message = "No graph nodes available for brute-force search";
        auto t_end = std::chrono::steady_clock::now();
        res.execution_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        return res;
    }

    const auto& nodes = graph_->GetAllNodes();
    double best_reach_dist = max_distance_meters;
    uint32_t best_reach_idx = 0xFFFFFFFF;
    int64_t best_reach_osm_id = 0;

    double best_any_dist = max_distance_meters;
    uint32_t best_any_idx = 0xFFFFFFFF;
    int64_t best_any_osm_id = 0;

    for (size_t i = 0; i < nodes.size(); ++i) {
        const auto& n = nodes[i];
        if (policy == SnapPolicy::STRICT_INTERIOR_ONLY && n.is_boundary) {
            continue;
        }
        double d = RouteGeometry::HaversineDistanceMeters(query_lat, query_lon, n.latitude, n.longitude);

        // 1. Maintain closest candidate across ALL components (for diagnostic classification)
        if (d < best_any_dist) {
            best_any_dist = d;
            best_any_idx = static_cast<uint32_t>(i);
            best_any_osm_id = n.osm_id;
        } else if (d == best_any_dist) {
            if (best_any_idx == 0xFFFFFFFF || n.osm_id < best_any_osm_id) {
                best_any_dist = d;
                best_any_idx = static_cast<uint32_t>(i);
                best_any_osm_id = n.osm_id;
            }
        }

        // 2. Maintain closest candidate in Strongly Connected Component (SCC #0)
        bool in_reach = is_in_scc_.empty() ? true : is_in_scc_[i];
        if (in_reach) {
            if (d < best_reach_dist) {
                best_reach_dist = d;
                best_reach_idx = static_cast<uint32_t>(i);
                best_reach_osm_id = n.osm_id;
            } else if (d == best_reach_dist) {
                if (best_reach_idx == 0xFFFFFFFF || n.osm_id < best_reach_osm_id) {
                    best_reach_dist = d;
                    best_reach_idx = static_cast<uint32_t>(i);
                    best_reach_osm_id = n.osm_id;
                }
            }
        }
    }

    auto t_end = std::chrono::steady_clock::now();
    res.execution_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
    res.candidate_nodes_examined = nodes.size();
    res.grid_cells_examined = 0;

    // Strict safety invariant: only select candidates from the reachable connected network.
    // NEVER fall back to arbitrary disconnected or dead-end components!
    if (best_reach_idx != 0xFFFFFFFF && best_reach_dist <= max_distance_meters) {
        res.found = true;
        res.status = SnapStatus::SUCCESS;
        res.snapped_internal_index = best_reach_idx;
        res.snapped_osm_id = best_reach_osm_id;
        res.snapped_latitude = nodes[best_reach_idx].latitude;
        res.snapped_longitude = nodes[best_reach_idx].longitude;
        res.snap_distance_meters = best_reach_dist;
        res.snapped_is_boundary_node = nodes[best_reach_idx].is_boundary;
        res.snapped_is_in_gcc = (has_gcc_ && !is_in_gcc_.empty()) ? is_in_gcc_[best_reach_idx] : true;
        res.snapped_is_in_scc = (has_scc_ && !is_in_scc_.empty()) ? is_in_scc_[best_reach_idx] : true;
        res.snapped_component_id = (node_component_id_.empty() ? 0 : node_component_id_[best_reach_idx]);
        res.snapped_scc_id = (node_scc_id_.empty() ? 0 : node_scc_id_[best_reach_idx]);
    } else {
        res.found = false;
        res.snapped_is_boundary_node = false;
        res.snapped_is_in_gcc = false;
        res.snapped_is_in_scc = false;
        res.snapped_component_id = (best_any_idx != 0xFFFFFFFF && !node_component_id_.empty()) ? node_component_id_[best_any_idx] : 0;
        res.snapped_scc_id = (best_any_idx != 0xFFFFFFFF && !node_scc_id_.empty()) ? node_scc_id_[best_any_idx] : 0;

        if (best_any_idx != 0xFFFFFFFF && best_any_dist <= max_distance_meters) {
            res.status = SnapStatus::NO_CONNECTED_ROAD_NETWORK_AVAILABLE;
            res.error_message = "No connected, reachable road network node found within maximum snapping distance of " +
                                std::to_string(max_distance_meters) + " meters (nearby road elements belong to disconnected or dead-end subgraphs)";
        } else {
            res.status = SnapStatus::SNAP_DISTANCE_EXCEEDED;
            res.error_message = "No eligible graph node found within maximum snapping distance of " +
                                std::to_string(max_distance_meters) + " meters";
        }
    }

    return res;
}

} // namespace EmergencyRouting

