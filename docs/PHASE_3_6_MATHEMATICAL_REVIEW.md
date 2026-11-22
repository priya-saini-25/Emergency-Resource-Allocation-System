# Phase 3.6 Targeted Technical & Mathematical Verification

**Date:** 2026-11-17  
**Review Type:** Targeted Technical Verification (Read-Only Audit)  
**Target Subsystems:** `SpatialGrid.cpp`, `SpatialGrid.hpp`, `BoundaryValidator.cpp`, `BoundaryValidator.hpp`  
**Toolchain:** MSYS2 UCRT64 GCC 16.2.0 (C++17)  
**Canonical Datasets:** `cpp_engine/data/jodhpur_graph.json`, `cpp_engine/data/jodhpur_boundary.geojson` (Way 31725312)

---

## Executive Summary & Classification Matrix

In accordance with user instructions, an independent, read-only mathematical and architectural audit was performed on Phase 3.6. No source files, test files, or datasets were modified during this investigation.

| Review Dimension | Subsystem / Function | Status | Code Change Required? | Summary of Finding |
| :--- | :--- | :---: | :---: | :--- |
| **1. Haversine Lower Bound** | `SpatialGrid.cpp` (`CellLowerBound`) | **WARNING** | **YES** | Independent lat/lon clamping is **not strictly conservative** on a sphere due to great-circle curvature ($D(Q, C) > D(Q, P)$ by up to $0.75\text{ mm}$ at $10\text{ km}$, $0.74\text{ m}$ at $100\text{ km}$). A provably conservative closed-form lower bound is derived. |
| **2. Tie-Breaking & Pruning** | `SpatialGrid.cpp` (`FindNearestNode` & `BruteForce`) | **WARNING** | **YES** | The `1e-9 m` threshold treats non-equidistant nodes as a tie, rejecting strictly closer nodes if their OSM ID is larger. Furthermore, branch-and-bound pruning at `lb > best_dist` causes `SpatialGrid` and `BruteForce` to diverge on near-tie unvisited cells. Strict IEEE 754 ordering resolves all issues. |
| **3. Boundary-Node Snapping** | `SpatialGrid.cpp` (`SnapCoordinate`) | **WARNING** | **YES** | An interior query can snap to an exterior boundary node (e.g. Query `(26.33606, 73.06761)` snaps to exterior node `8478025616` at $4.99\text{ m}$). An explicit transparency and policy mechanism is formulated to maintain connectivity without silent boundary escape. |

---

## 1. Haversine Cell Lower-Bound Proof & Counterexample

### 1.1 Analytical Derivation & The Non-Conservative Problem

In `SpatialGrid.cpp`, the cell lower-bound metric is implemented as:
```cpp
inline double CellLowerBound(double qlat, double qlon,
                            double min_lat, double max_lat,
                            double min_lon, double max_lon) {
    const double clat = (qlat < min_lat) ? min_lat : ((qlat > max_lat) ? max_lat : qlat);
    const double clon = (qlon < min_lon) ? min_lon : ((qlon > max_lon) ? max_lon : qlon);
    return RouteGeometry::HaversineDistanceMeters(qlat, qlon, clat, clon);
}
```

Let query point $Q = (\phi_q, \lambda_q)$ in radians, and cell rectangle $\mathcal{C} = [\phi_{\min}, \phi_{\max}] \times [\lambda_{\min}, \lambda_{\max}]$.  
The Haversine distance $D(Q, P) = 2R \arcsin(\sqrt{h(\phi, \lambda)})$ is governed by the haversine function:
$$h(\phi, \lambda) = \sin^2\left(\frac{\phi - \phi_q}{2}\right) + \cos(\phi_q) \cos(\phi) \sin^2\left(\frac{\lambda - \lambda_q}{2}\right)$$

When $\phi_q \in [\phi_{\min}, \phi_{\max}]$ and $\lambda_q < \lambda_{\min}$, the independent clamping yields $C = (\phi_q, \lambda_{\min})$.  
At $C$, the haversine value is:
$$h(\phi_q, \lambda_{\min}) = \cos^2(\phi_q) \sin^2\left(\frac{\lambda_{\min} - \lambda_q}{2}\right)$$

Now consider points on the west boundary of the cell $P(\phi) = (\phi, \lambda_{\min})$ for $\phi \in [\phi_{\min}, \phi_{\max}]$.  
Let $f(\phi) = h(\phi, \lambda_{\min})$. We take the first derivative of $f$ with respect to $\phi$ at $\phi = \phi_q$:
$$f'(\phi) = \frac{1}{2}\sin(\phi - \phi_q) - \cos(\phi_q)\sin(\phi)\sin^2\left(\frac{\lambda_{\min} - \lambda_q}{2}\right)$$
Evaluating at $\phi = \phi_q$:
$$\sin(\phi_q - \phi_q) = 0 \implies f'(\phi_q) = -\cos(\phi_q)\sin(\phi_q)\sin^2\left(\frac{\lambda_{\min} - \lambda_q}{2}\right) = -\frac{1}{2}\sin(2\phi_q)\sin^2\left(\frac{\lambda_{\min} - \lambda_q}{2}\right)$$

For Jodhpur, $\phi_q \approx +26.28^\circ\text{ N} > 0$, so $\sin(2\phi_q) = \sin(52.56^\circ) \approx 0.794 > 0$.  
Since $\lambda_q \ne \lambda_{\min}$, $\sin^2\left(\frac{\lambda_{\min} - \lambda_q}{2}\right) > 0$.  
Therefore:
$$f'(\phi_q) < 0$$

Because the directional derivative into the cell ($\phi > \phi_q$) is **strictly negative**, increasing latitude northwards into the cell **strictly decreases** the Haversine distance. Geometrically, on a sphere, parallels of latitude are not geodesics; the great-circle arc from $Q$ to points at longitude $\lambda_{\min}$ bends toward the pole.  
Consequently, $C = (\phi_q, \lambda_{\min})$ is a **local maximum**, not the minimum!

---

### 1.2 Concrete Numerical Counterexample

An exact numerical counterexample within the Jodhpur geographic bounds:
- **Query Coordinate $Q$:** `(26.2500000° N, 73.0000000° E)`
- **Cell Bounding Box:** Latitude `[26.2500000°, 26.2550000°]`, Longitude `[73.0200000°, 73.0250000°]` (~$2\text{ km}$ east of $Q$)
- **Clamped Coordinate $C$:** `(26.2500000° N, 73.0200000° E)`
- **Calculated `CellLowerBound(Q, Cell)`:** `1994.553972104 meters`
- **Candidate Node $P$ inside the cell:** `(26.2500010° N, 73.0200000° E)`
- **True Haversine Distance $D(Q, P)$:** `1994.553966620 meters`
- **Deficit ($D(Q, P) - \text{CellLowerBound}$):** **$-0.000005484\text{ meters}$ ($-5.48\ \mu\text{m}$)**

Because $\text{CellLowerBound} > D(Q, P)$, the lower bound is **not conservative**.

#### Deficit Scaling Across Distance

| Query Offset to Cell | $\Delta\phi_{\text{opt}}$ to Minimum | Deficit ($D_{\text{true}} - D_{\text{clamped}}$) | Consequence on Pruning |
| :--- | :--- | :--- | :--- |
| **$250\text{ m}$** | $0.002\text{ m}$ ($0.000''$) | $-0.00000001\text{ m}$ ($-10\text{ nm}$) | Exceeds $1\text{ nm}$ tie tolerance |
| **$1,000\text{ m}$** | $0.039\text{ m}$ ($0.001''$) | $-0.00000075\text{ m}$ ($-0.75\ \mu\text{m}$) | Significant vs tie tolerance |
| **$2,000\text{ m}$** | $0.155\text{ m}$ ($0.005''$) | $-0.00000601\text{ m}$ ($-6.01\ \mu\text{m}$) | Exceeds single-precision float |
| **$10,000\text{ m}$** | $3.875\text{ m}$ ($0.125''$) | $-0.00075092\text{ m}$ ($-0.75\text{ mm}$) | Sub-millimeter error |
| **$100,000\text{ m}$** | $770.45\text{ m}$ ($24.9''$) | **$-0.74430884\text{ m}$ ($-74.4\text{ cm}$)** | **Gross pruning failure (> 74 cm)** |

---

### 1.3 Rigorous Conservative Lower-Bound Formulation

To guarantee that $h_{\text{LB}} \le h(\phi, \lambda)$ for all $(\phi, \lambda) \in [\phi_{\min}, \phi_{\max}] \times [\lambda_{\min}, \lambda_{\max}]$, we bound each term of the Haversine function independently:

$$h(\phi, \lambda) = \underbrace{\sin^2\left(\frac{\phi - \phi_q}{2}\right)}_{\text{Term 1}} + \underbrace{\cos(\phi_q) \cos(\phi) \sin^2\left(\frac{\lambda - \lambda_q}{2}\right)}_{\text{Term 2}}$$

1. **Term 1:** With $\phi_c = \text{clamp}(\phi_q, \phi_{\min}, \phi_{\max})$, for all $\phi \in [\phi_{\min}, \phi_{\max}]$:
   $$\sin^2\left(\frac{\phi - \phi_q}{2}\right) \ge \sin^2\left(\frac{\phi_c - \phi_q}{2}\right)$$
2. **Term 2:** With $\lambda_c = \text{clamp}(\lambda_q, \lambda_{\min}, \lambda_{\max})$, for all $|\lambda - \lambda_q| < \pi$:
   $$\sin^2\left(\frac{\lambda - \lambda_q}{2}\right) \ge \sin^2\left(\frac{\lambda_c - \lambda_q}{2}\right) \ge 0$$
3. **Cosine Variation:** For all $\phi \in [\phi_{\min}, \phi_{\max}] \subset [-90^\circ, 90^\circ]$, $\cos(\phi) \ge 0$. Since $\cos$ is monotonically decreasing with $|\phi|$:
   $$\cos(\phi) \ge \cos_{\min}(\mathcal{C}) = \min(\cos(\phi_{\min}), \cos(\phi_{\max}))$$
   Since $\cos(\phi_q) \ge 0$, by the non-negativity of all factors:
   $$\cos(\phi_q) \cos(\phi) \sin^2\left(\frac{\lambda - \lambda_q}{2}\right) \ge \cos(\phi_q) \cos_{\min}(\mathcal{C}) \sin^2\left(\frac{\lambda_c - \lambda_q}{2}\right)$$

Summing both inequalities yields the **strictly conservative closed-form lower bound**:
$$h_{\text{LB}} = \sin^2\left(\frac{\phi_c - \phi_q}{2}\right) + \cos(\phi_q) \cos_{\min}(\mathcal{C}) \sin^2\left(\frac{\lambda_c - \lambda_q}{2}\right)$$
$$D_{\text{conservative}} = 2R \arcsin\left(\sqrt{\max(0.0, \min(1.0, h_{\text{LB}}))}\right)$$

**Mathematical Invariant:** $D_{\text{conservative}} \le D(Q, P)$ holds unconditionally for every point $P$ inside the cell. Across 500,000 Monte Carlo trials, the minimum difference $D(Q, P) - D_{\text{conservative}} \ge 0$ with zero violations.

---

## 2. Nearest-Node Tie-Breaking & Priority Queue Pruning

### 2.1 The `1e-9 m` Implementation

In `SpatialGrid.cpp` (lines 193–204 and 322–333):
```cpp
if (d < best_dist - 1e-9) {
    best_dist = d;
    best_idx = node_idx;
    best_osm_id = node.osm_id;
} else if (std::abs(d - best_dist) <= 1e-9) {
    if (best_idx == 0xFFFFFFFF || node.osm_id < best_osm_id) {
        best_dist = d;
        best_idx = node_idx;
        best_osm_id = node.osm_id;
    }
}
```

### 2.2 Analysis of the Four Synthetic Cases

#### Case 1: Two distinct nodes with nearly equal distances ($|\Delta d| = 5 \times 10^{-10}\text{ m} < 10^{-9}\text{ m}$)
- Node A: `osm_id = 100`, $d_A = 100.0000000005\text{ m}$ (farther)
- Node B: `osm_id = 200`, $d_B = 100.0000000000\text{ m}$ (strictly closer)
- **Observed Behavior:** Whether Node A or Node B is evaluated first, Node A (`osm_id = 100`) is selected. Node B is rejected despite being mathematically closer by $0.5\text{ nm}$.
- **Result:** The algorithm does not select the strictly nearest node; it treats $|d_1 - d_2| \le 10^{-9}$ as equivalent.

#### Case 2: Two exactly equidistant nodes with different OSM IDs ($d_A = d_B = 100.0\text{ m}$)
- Node A: `osm_id = 100`
- Node B: `osm_id = 200`
- **Observed Behavior:** Node A (`osm_id = 100`) is deterministically selected in all iteration orders.

#### Case 3: A slightly closer node with a larger OSM ID
- Identical to Case 1. The closer node is rejected solely because its distance advantage is $< 10^{-9}\text{ m}$ and its OSM ID is larger.

#### Case 4: Candidate in an unvisited cell within tolerance (SpatialGrid vs BruteForce Divergence)
- Visited cell candidate: Node B (`osm_id = 200`, $d = 100.0\text{ m}$). Current `best_dist = 100.0\text{ m}`.
- Unvisited cell: Lower bound $lb = 100.0000000001\text{ m}$.
- Inside unvisited cell: Node A (`osm_id = 100`, $d_A = 100.0000000002\text{ m}$).
- **SpatialGrid Behavior:** At line 181, `lb > best_dist` is evaluated:
  $$100.0000000001 > 100.0 \implies \text{TRUE}$$
  `SpatialGrid::FindNearestNode` **breaks early** and never opens the cell. Node B (`osm_id = 200`) is returned.
- **BruteForce Behavior:** `BruteForceFindNearestNode` examines Node A, detects $|d_A - \text{best\_dist}| = 2 \times 10^{-10} \le 10^{-9}$, notes $100 < 200$, and selects Node A (`osm_id = 100`).
- **Discrepancy:** `SpatialGrid` returns OSM 200, whereas `BruteForce` returns OSM 100. **The acceleration structure diverges from brute-force scan!**

### 2.3 Root Cause & Recommended Approach

The root cause is that **branch-and-bound pruning at $lb > \text{best\_dist}$ assumes a strict monotonic order**. When an artificial tolerance $\epsilon = 10^{-9}\text{ m}$ is introduced, an unvisited candidate with $d \in (\text{best\_dist}, \text{best\_dist} + \epsilon]$ can beat the incumbent if its OSM ID is smaller, invalidating the pruning condition.

#### Recommended Solution: Strict IEEE 754 Ordering
Replace the epsilon window with strict IEEE 754 comparison:
```cpp
if (d < best_dist) {
    best_dist = d;
    best_idx = node_idx;
    best_osm_id = node.osm_id;
} else if (d == best_dist) {
    if (best_idx == 0xFFFFFFFF || node.osm_id < best_osm_id) {
        best_dist = d;
        best_idx = node_idx;
        best_osm_id = node.osm_id;
    }
}
```
**Benefits:**
1. **Guarantees strictly nearest node:** A farther node never beats a closer node.
2. **Mathematical harmony with pruning:** When $lb > \text{best\_dist}$, no unvisited node can have $d < \text{best\_dist}$ or $d == \text{best\_dist}$. Pruning is 100% sound.
3. **Identical results:** `SpatialGrid` and `BruteForce` are mathematically guaranteed to return the exact same node on every input.
4. **No arbitrary constants:** Eliminates non-transitive epsilon equivalence relations.

---

## 3. Boundary-Node Snapping Behavior & Policy

### 3.1 Investigation Findings

The Jodhpur road network contains 59,334 nodes:
- **Interior nodes (`is_boundary_node: false`):** 58,813 (98.12%) — strictly inside Way 31725312.
- **Exterior boundary nodes (`is_boundary_node: true`):** 521 (0.88%) — retained during Phase 2 spatial clipping as endpoints of boundary-crossing roads (mean distance $26.54\text{ m}$ exterior).

In `SpatialGrid::SnapCoordinate()`:
1. Stage 2 checks whether the **query coordinate** is inside the polygon using `BoundaryValidator::IsInside(query_lat, query_lon)`.
2. Stage 3 calls `SpatialGrid::FindNearestNode()`, which searches over **all 59,334 nodes** in the grid, including the 521 exterior boundary nodes.

### 3.2 Concrete Reproducible Example

An interior query coordinate that snaps to an exterior boundary node:

- **Query Coordinate:** Latitude `26.3360636429° N`, Longitude `73.0676052582° E`
- **Query Classification:** **STRICTLY INSIDE** polygon (Way 31725312) via `BoundaryValidator::IsInside`
- **Returned Snapped OSM Node ID:** `8478025616`
- **Snapped Node Coordinate:** Latitude `26.3360937° N`, Longitude `73.0676425° E`
- **Snapped Node Classification:** **OUTSIDE** polygon (`is_boundary_node: true`)
- **Snap Distance:** `4.994 meters`
- **Road Segment Context:** Node `8478025616` connects via a 28.8-meter two-way residential road edge to interior node `1616854065` (`is_boundary_node: false`).

```
  [POLYGON INTERIOR]                     | [POLYGON EXTERIOR]
                                         |
  Query (26.33606, 73.06761)             |
        *                                |
         \ 4.99 m snap                   |
          \                              |
           +-----------------------------+-----> Snapped Node 8478025616
                                         |       (is_boundary_node: true)
                                         |
                                         | Boundary Ring (Way 31725312)
```

### 3.3 Connectivity vs Service Area Policy

- **Why exterior nodes must NOT be deleted:**
  The 521 boundary nodes preserve road network topology. If deleted or severed, vehicles would be unable to travel on perimeter ring roads or turn around on dead-end access roads near the municipal boundary.
- **Why silent snapping to exterior nodes is a concern:**
  An emergency service dispatcher could receive an incident reported inside city limits, but dispatch guidance would indicate a terminal node outside municipal boundary lines.

### 3.4 Explicit Policy Recommendation

Implement **Transparent Boundary Snapping with Configurable Confinement**:
1. **Extend `SnapResult`:**
   Add `bool snapped_is_boundary_node = false;` to `SnapResult`. This provides upstream APIs (Node.js backend, React UI) full transparency without breaking existing fields.
2. **Support Snapping Policy Parameter:**
   Add `SnapPolicy` option to `SnapCoordinate`:
   - `SnapPolicy::ALLOW_ALL_NODES` (default): Snaps to true nearest road element (e.g. 5m away on perimeter road), avoiding artificial detours.
   - `SnapPolicy::STRICT_INTERIOR_ONLY`: Restricts snapping candidates to nodes where `is_boundary_node == false`. If an incident is on the perimeter, it snaps to the nearest interior road node.

---

## 4. Assessment Summary & Action Plan

| Item | Topic | Current Code Behavior | Potential Consequence | Code Change Required? | Proposed Action |
| :---: | :--- | :--- | :--- | :---: | :--- |
| **1** | Cell Lower Bound | Clamps lat/lon independently. | Pruning may discard true nearest node in distant or large-span queries. | **YES** | Update `CellLowerBound` with the provably conservative $\cos_{\min}(\mathcal{C})$ formulation. |
| **2** | Tie-Breaking & Pruning | Uses $10^{-9}\text{ m}$ threshold with `lb > best_dist` break. | Closer nodes rejected if OSM ID is larger; `SpatialGrid` and `BruteForce` can diverge. | **YES** | Replace with strict `d < best_dist` and exact tie-breaking `d == best_dist`. |
| **3** | Boundary Snapping | Interior queries can snap to exterior boundary nodes without notification. | Dispatch destination coordinate lies outside municipal polygon. | **YES** | Add `snapped_is_boundary_node` to `SnapResult` and support `SnapPolicy`. |

---

## Verification Statement

- **Source Code Status:** Unmodified (READ-ONLY review preserved).
- **Datasets Status:** Unmodified (All 4 SHA-256 hashes preserved).
- **Next Step:** Awaiting explicit user approval before applying any source-code corrections.

