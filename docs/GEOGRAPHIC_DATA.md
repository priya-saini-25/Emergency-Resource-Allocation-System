# Jodhpur Geographic Boundary & Road Network Specification
## Emergency Resource Allocation & Response Management System

---

### 1. Adopted Spatial Framework & Classification

The emergency dispatch decision-support system operates on an authentic geospatial model extracted directly from OpenStreetMap:

> **Official Boundary & Graph Classification:**  
> **"Jodhpur Urban Service Area (derived from OpenStreetMap Urban Settlement Footprint, Way 31725312; academic proxy for urban emergency simulation)."**

#### Statutory Disclaimer & Academic Context
All spatial boundaries, road graph topologies, and navigation models represent an **academic urban settlement proxy**. They are **NOT** officially notified Jodhpur Municipal Corporation administrative boundaries, nor do they claim live connection to municipal dispatch centres (108, 101, 100). All routing weights represent static geographic distances calculated from OpenStreetMap vectors.

---

### 2. Road Network Data Acquisition Methodology

1. **Source & API Protocol**:
   - Road features were extracted via the OpenStreetMap **Overpass API** using bounding-box queries covering the Jodhpur metropolitan envelope:
     $$\text{Bounding Box: } \text{Lat } [26.205984, 26.353666], \text{ Lon } [72.948575, 73.088872]$$
   - Automated retry handling and endpoint fallbacks (`overpass-api.de`, `maps.mail.ru`, `overpass.kumi.systems`) ensure reproducible builds.
2. **Raw Extraction Scale**:
   - Total OSM Ways Evaluated: **20,349**
   - Total OSM Referenced Nodes Indexed: **97,494**
   - Total Raw Elements Ingested: **117,843**

---

### 3. Road Classification & Vehicle Accessibility Hierarchy

Road ways are filtered based on compatibility with emergency vehicles (ambulances, rescue trucks, fire tenders):

| Highway Classification | Included? | Functional Role in Emergency Routing | Total Graph Edges | Share (%) |
| :--- | :---: | :--- | :--- | :--- |
| `residential` | **Yes** | Neighborhood streets providing door-to-door emergency access | 97,519 | 75.1% |
| `service` | **Yes (Filtered)** | Hospital internal loops, station access lanes, commercial alleys | 14,337 | 11.0% |
| `tertiary` | **Yes** | Collector streets connecting residential sectors to main roads | 7,511 | 5.8% |
| `unclassified` | **Yes** | Minor interconnecting urban transit roads | 4,671 | 3.6% |
| `secondary` | **Yes** | Major sector arteries (e.g. Residency Road, Pal Road) | 2,747 | 2.1% |
| `primary` | **Yes** | High-capacity trunk arteries (e.g. Station Road, Mandore Road) | 1,288 | 1.0% |
| `trunk` | **Yes** | Regional highways traversing the urban perimeter (NH-62, Bypass) | 1,080 | 0.8% |
| `living_street` | **Yes** | Pedestrian-priority residential shared zones (drivable at low speed)| 372 | 0.3% |
| `*_link` ramps | **Yes** | Slip roads, highway ramps, junction connectors | 253 | 0.2% |
| `footway`, `pedestrian`, `steps`, `path`, `cycleway` | **NO** | Excluded: Inaccessible to emergency motor vehicles | — | — |
| `construction`, `abandoned`, `proposed` | **NO** | Excluded: Not traversable | — | — |
| `access=private`, `access=no`, `emergency=no` | **NO** | Excluded: Restricted access gates or private non-passable zones | — | — |

---

### 4. Graph Construction & Topological Rules

The extracted road network is transformed into a directed graph for future C++ Dijkstra routing according to rigorous GIS and graph theory rules:

1. **Node Preservation & Intersection Integrity**:
   - Every graph node corresponds to an authentic OpenStreetMap node ID with WGS84 coordinates.
   - Roads intersecting at a shared OSM junction node naturally share the same graph vertex.
   - Roads crossing at different vertical elevations (bridges, overpasses, underpasses) without an OSM junction node do **NOT** connect, preventing invalid planar jumps.
2. **Directionality & One-Way Handling**:
   - `oneway=yes`, `oneway=1`, `oneway=true`, or `junction=roundabout`: Form a single directed edge $u \rightarrow v$.
   - `oneway=-1` or `oneway=reverse`: Form a single directed edge $v \rightarrow u$.
   - Motorways: Modeled as forward one-way unless specifically tagged `oneway=no`.
   - Bidirectional Roads: Modeled as two separate directed edges: $(u \rightarrow v)$ and $(v \rightarrow u)$.
3. **Geodesic Distance Weighting**:
   - Edge weights represent true great-circle distances in meters calculated via the **Haversine formula** on an authalic Earth sphere ($R = 6,371,008.8\text{ m}$):
     $$d = 2 R \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos \phi_1 \cos \phi_2 \sin^2\left(\frac{\Delta \lambda}{2}\right)} \right)$$
   - Zero-distance artifacts ($d \le 0.05\text{ m}$) are discarded.
4. **Boundary Clipping Policy**:
   - The boundary polygon (`jodhpur_boundary.geojson`) clips the road network.
   - Segments with both nodes inside are 100% retained.
   - Segments with one node inside and one outside are retained as boundary transition links, tagged with `is_boundary_node: true`, preserving external highway gateways without truncating peripheral intersections.
   - Segments completely outside the urban boundary are discarded.

---

### 5. Dataset Validation Results

The graph was validated using [`cpp_engine/scripts/validate_graph.py`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/cpp_engine/scripts/validate_graph.py):

| Validation Check | Target Standard | Metric / Finding | Status |
| :--- | :--- | :--- | :--- |
| **Total Graph Nodes** | Indexed vertices | **59,334** | **PASSED** |
| **Total Directed Edges** | Traversable directed links | **129,778** | **PASSED** |
| **Total Road Distance** | Network length in kilometers | **4,192.11 km** | **PASSED** |
| **Referential Integrity** | Edges reference valid nodes | **100% valid** (0 missing source/target nodes) | **PASSED** |
| **Edge Distance Validity** | Positive numeric weights | **100% valid** (0 zero or negative distances) | **PASSED** |
| **Duplicate Edges** | Unique $(u, v, \text{way\_id})$ | **0 duplicate edges** | **PASSED** |
| **Edge Geometry** | 2-point polyline coordinates | **129,778 edges (100.0%)** | **PASSED** |
| **Connected Components** | Weakly connected components | **76 components** | **PASSED** |
| **Giant Component Size** | Largest connected network | **58,877 nodes (99.23%)** | **PASSED** |
| **Isolated Components** | Residual cul-de-sacs / gated roads | 75 minor clusters (avg 6 nodes each) | **Documented** |

---

### 6. Emergency Infrastructure Reachability Matrix

Every designated major emergency facility was snapped to its nearest authentic road graph node. Directed path reachability was tested across all 30 pairwise directed combinations via Breadth-First Search (BFS):

| Facility | Nearest Graph Node ID | Snapping Offset (m) | Verified Connected Role |
| :--- | :--- | :--- | :--- |
| **AIIMS Jodhpur** | `8520698362` | $19.7\text{ m}$ | Apex Trauma Center & Hospital |
| **MDM Hospital (Mathura Das Mathur)** | `5321319416` | $39.8\text{ m}$ | Government Emergency Center |
| **Mahatma Gandhi Hospital (MGH)** | `8499684813` | $42.8\text{ m}$ | City Center General Hospital |
| **Basni (RIICO Industrial Area)** | `2694302020` | $34.5\text{ m}$ | High-Risk Industrial Emergency Zone |
| **Sojati Gate** | `2688566058` | $7.3\text{ m}$ | Central Command & Dispatch Hub |
| **Paota Circle** | `3773158752` | $41.5\text{ m}$ | Northern Highway Dispatch Node |

#### Pairwise Directed Transit Distances (Sample Matrix):
- **AIIMS Jodhpur $\rightarrow$ MDM Hospital**: $5.23\text{ km}$ ($71\text{ hops}$)
- **AIIMS Jodhpur $\rightarrow$ Mahatma Gandhi Hospital**: $6.81\text{ km}$ ($143\text{ hops}$)
- **AIIMS Jodhpur $\rightarrow$ Basni RIICO**: $2.79\text{ km}$ ($70\text{ hops}$)
- **AIIMS Jodhpur $\rightarrow$ Paota Circle**: $10.86\text{ km}$ ($247\text{ hops}$)
- **MDM Hospital $\rightarrow$ AIIMS Jodhpur**: $5.25\text{ km}$ ($79\text{ hops}$)
- **MDM Hospital $\rightarrow$ Mahatma Gandhi Hospital**: $3.25\text{ km}$ ($77\text{ hops}$)
- **Mahatma Gandhi Hospital $\rightarrow$ Sojati Gate**: $1.24\text{ km}$ ($50\text{ hops}$)
- **Sojati Gate $\rightarrow$ Paota Circle**: $3.26\text{ km}$ ($74\text{ hops}$)
- **Paota Circle $\rightarrow$ AIIMS Jodhpur**: $12.10\text{ km}$ ($248\text{ hops}$)
- **Basni RIICO $\rightarrow$ AIIMS Jodhpur**: $2.77\text{ km}$ ($57\text{ hops}$)

> **Reachability Verification**: **100% of all 30 directed pairs are reachably connected.** All facilities belong to the Giant Component ($99.23\%$).

---

### 7. Known Extraction & Simulation Limitations

1. **Static Geographic Distances**: Edge weights represent real road lengths in meters; live GPS traffic jams, weather conditions, and dynamic congestion are not modeled.
2. **Turn Restrictions**: Micro-level turn restrictions (such as prohibited U-turns or specific time-based turn bans) are modeled as segment traversals; full OSM turn relation constraints are not micro-simulated.
3. **Emergency Vehicle Road Access**: Certain narrow residential alleys are retained under `residential` and `living_street` tags. In a real-world dispatch, large heavy fire engines might be restricted, whereas ambulances or motorcycle first responders can navigate them.
4. **Isolated Sub-graphs**: 75 minor isolated components ($0.77\%$ of nodes) exist, representing gated community dead-ends, detached parking loops, or unmapped private residential driveways. The core emergency transit grid operates entirely within the 58,877-node Giant Component.

---

### 8. Source Attribution & Licensing

- **Data Source**: [OpenStreetMap](https://www.openstreetmap.org)
- **Attribution**: © OpenStreetMap contributors
- **License**: [Open Data Commons Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/)
- Any public map presentation, React Leaflet view, or academic report derived from this dataset prominently displays the attribution string:  
  `Map data © OpenStreetMap contributors`
