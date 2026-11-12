"""
Build the authentic Jodhpur road network graph from downloaded OSM raw data.
Filters by the approved Jodhpur Urban Service Area boundary polygon (jodhpur_boundary.geojson).
Applies highway class and access restrictions.
Generates:
1. cpp_engine/data/jodhpur_graph.json (For C++ Engine)
2. cpp_engine/data/jodhpur_roads.geojson (For GIS & React Leaflet visualization)
"""

import json
import math
import os
import sys
from datetime import datetime, timezone

RAW_DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "raw_osm_roads.json")
BOUNDARY_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "jodhpur_boundary.geojson")
GRAPH_OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "jodhpur_graph.json")
ROADS_GEOJSON_OUTPUT = os.path.join(os.path.dirname(__file__), "..", "data", "jodhpur_roads.geojson")

ALLOWED_HIGHWAY_TYPES = {
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "unclassified", "residential", "living_street", "service",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"
}

DISALLOWED_ACCESS_VALUES = {
    "private", "no", "emergency_no", "forestry", "agricultural", "delivery"
}

DISALLOWED_SERVICE_VALUES = {
    "parking_aisle", "driveway", "private"
}

def haversine_distance_meters(lon1, lat1, lon2, lat2):
    """Calculate great-circle distance between two geographic coordinates in meters."""
    R = 6371008.8  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def point_in_polygon(lon, lat, polygon_ring):
    """Ray-casting algorithm to test if point is inside a closed linear ring."""
    x, y = lon, lat
    inside = False
    n = len(polygon_ring)
    p1x, p1y = polygon_ring[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon_ring[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def load_boundary_polygon():
    with open(BOUNDARY_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    ring = data["features"][0]["geometry"]["coordinates"][0]
    return ring

def build_graph():
    print("[INFO] Loading boundary polygon...")
    polygon_ring = load_boundary_polygon()

    print(f"[INFO] Loading raw OSM road data from {RAW_DATA_PATH} ...")
    with open(RAW_DATA_PATH, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    elements = raw_data.get("elements", [])
    print(f"[INFO] Total raw elements: {len(elements)}")

    # 1. Build lookup table of all OSM nodes
    nodes_lookup = {}
    for el in elements:
        if el["type"] == "node":
            nodes_lookup[el["id"]] = (float(el["lon"]), float(el["lat"]))

    print(f"[INFO] Indexed {len(nodes_lookup)} OSM nodes.")

    # 2. Pre-cache point-in-polygon containment for nodes
    node_inside_cache = {}
    def is_node_inside(nid):
        if nid not in node_inside_cache:
            if nid in nodes_lookup:
                lon, lat = nodes_lookup[nid]
                node_inside_cache[nid] = point_in_polygon(lon, lat, polygon_ring)
            else:
                node_inside_cache[nid] = False
        return node_inside_cache[nid]

    # 3. Filter road ways and generate graph edges
    ways = [el for el in elements if el["type"] == "way"]
    print(f"[INFO] Evaluating {len(ways)} candidate road ways...")

    graph_nodes = {}
    graph_edges = []
    geojson_features = []

    seen_edges = set()  # To avoid duplicate (from, to, road_id)

    stats = {
        "total_ways_evaluated": len(ways),
        "ways_accepted": 0,
        "ways_rejected_class": 0,
        "ways_rejected_access": 0,
        "ways_rejected_outside": 0,
        "segments_accepted": 0,
        "segments_clipped_outside": 0,
        "directed_edges_created": 0,
        "oneway_segments": 0,
        "bidirectional_segments": 0,
        "highway_type_distribution": {}
    }

    for way in ways:
        tags = way.get("tags", {})
        highway = tags.get("highway")

        # Class filter
        if highway not in ALLOWED_HIGHWAY_TYPES:
            stats["ways_rejected_class"] += 1
            continue

        # Access filter
        access = tags.get("access", "yes")
        if access in DISALLOWED_ACCESS_VALUES:
            stats["ways_rejected_access"] += 1
            continue

        emergency_access = tags.get("emergency")
        if emergency_access == "no":
            stats["ways_rejected_access"] += 1
            continue

        service_type = tags.get("service")
        if highway == "service" and service_type in DISALLOWED_SERVICE_VALUES:
            stats["ways_rejected_access"] += 1
            continue

        way_nodes = way.get("nodes", [])
        if len(way_nodes) < 2:
            continue

        # Check if way has at least one node inside the boundary polygon
        has_node_inside = any(is_node_inside(nid) for nid in way_nodes)
        if not has_node_inside:
            stats["ways_rejected_outside"] += 1
            continue

        stats["ways_accepted"] += 1
        stats["highway_type_distribution"][highway] = stats["highway_type_distribution"].get(highway, 0) + 1

        way_id = way["id"]
        road_name = tags.get("name", tags.get("name:en", "Unnamed Road"))

        # Determine directionality
        oneway_tag = tags.get("oneway", "no")
        junction = tags.get("junction")
        is_oneway_forward = False
        is_oneway_reverse = False

        if oneway_tag in ["yes", "1", "true"] or junction == "roundabout":
            is_oneway_forward = True
        elif oneway_tag in ["-1", "reverse"]:
            is_oneway_reverse = True
        elif highway == "motorway" and oneway_tag != "no":
            is_oneway_forward = True

        # Process consecutive segments of the way
        for i in range(len(way_nodes) - 1):
            u_id = way_nodes[i]
            v_id = way_nodes[i + 1]

            if u_id not in nodes_lookup or v_id not in nodes_lookup:
                continue

            # Boundary clipping rule: retain segment if both nodes are inside polygon,
            # or if at least one is inside (boundary transition edge)
            u_in = is_node_inside(u_id)
            v_in = is_node_inside(v_id)

            if not (u_in or v_in):
                stats["segments_clipped_outside"] += 1
                continue

            u_lon, u_lat = nodes_lookup[u_id]
            v_lon, v_lat = nodes_lookup[v_id]

            dist_m = haversine_distance_meters(u_lon, u_lat, v_lon, v_lat)
            if dist_m <= 0.05:  # Skip zero-length artifacts
                continue

            dist_m_rounded = round(dist_m, 2)
            stats["segments_accepted"] += 1

            # Register nodes in graph
            if u_id not in graph_nodes:
                graph_nodes[u_id] = {
                    "id": u_id,
                    "latitude": u_lat,
                    "longitude": u_lon,
                    "is_boundary_node": not u_in
                }
            if v_id not in graph_nodes:
                graph_nodes[v_id] = {
                    "id": v_id,
                    "latitude": v_lat,
                    "longitude": v_lon,
                    "is_boundary_node": not v_in
                }

            segment_geom = [[u_lon, u_lat], [v_lon, v_lat]]

            # GeoJSON feature representation for GIS visualization
            geojson_features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": segment_geom
                },
                "properties": {
                    "road_id": way_id,
                    "name": road_name,
                    "highway": highway,
                    "from_node": u_id,
                    "to_node": v_id,
                    "distance_meters": dist_m_rounded,
                    "oneway": is_oneway_forward or is_oneway_reverse,
                    "access": access
                }
            })

            # Create directed edges according to oneway restrictions
            if is_oneway_forward:
                stats["oneway_segments"] += 1
                edge_key = (u_id, v_id, way_id)
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    graph_edges.append({
                        "from": u_id,
                        "to": v_id,
                        "road_id": way_id,
                        "name": road_name,
                        "road_type": highway,
                        "distance_meters": dist_m_rounded,
                        "oneway": True,
                        "access": access,
                        "geometry": segment_geom
                    })
                    stats["directed_edges_created"] += 1

            elif is_oneway_reverse:
                stats["oneway_segments"] += 1
                edge_key = (v_id, u_id, way_id)
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    graph_edges.append({
                        "from": v_id,
                        "to": u_id,
                        "road_id": way_id,
                        "name": road_name,
                        "road_type": highway,
                        "distance_meters": dist_m_rounded,
                        "oneway": True,
                        "access": access,
                        "geometry": [[v_lon, v_lat], [u_lon, u_lat]]
                    })
                    stats["directed_edges_created"] += 1

            else:
                # Bidirectional: create u -> v and v -> u
                stats["bidirectional_segments"] += 1
                fwd_key = (u_id, v_id, way_id)
                if fwd_key not in seen_edges:
                    seen_edges.add(fwd_key)
                    graph_edges.append({
                        "from": u_id,
                        "to": v_id,
                        "road_id": way_id,
                        "name": road_name,
                        "road_type": highway,
                        "distance_meters": dist_m_rounded,
                        "oneway": False,
                        "access": access,
                        "geometry": segment_geom
                    })
                    stats["directed_edges_created"] += 1

                rev_key = (v_id, u_id, way_id)
                if rev_key not in seen_edges:
                    seen_edges.add(rev_key)
                    graph_edges.append({
                        "from": v_id,
                        "to": u_id,
                        "road_id": way_id,
                        "name": road_name,
                        "road_type": highway,
                        "distance_meters": dist_m_rounded,
                        "oneway": False,
                        "access": access,
                        "geometry": [[v_lon, v_lat], [u_lon, u_lat]]
                    })
                    stats["directed_edges_created"] += 1

    print(f"[INFO] Graph construction complete:")
    print(f"       Nodes count: {len(graph_nodes)}")
    print(f"       Directed edges count: {len(graph_edges)}")
    print(f"       Accepted segments: {stats['segments_accepted']}")

    # Assemble Graph JSON
    graph_payload = {
        "metadata": {
            "city": "Jodhpur",
            "state": "Rajasthan",
            "country": "India",
            "source": "OpenStreetMap",
            "boundary_reference": "Jodhpur Urban Service Area (OSM Way 31725312)",
            "classification": "Jodhpur Urban Service Area (derived from OpenStreetMap Urban Settlement Footprint, Way 31725312; academic proxy for urban emergency simulation).",
            "license": "Open Data Commons Open Database License (ODbL) 1.0",
            "attribution": "© OpenStreetMap contributors",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "coordinate_reference_system": "WGS84 (EPSG:4326)",
            "weight_unit": "meters",
            "nodes_count": len(graph_nodes),
            "edges_count": len(graph_edges),
            "highway_distribution": stats["highway_type_distribution"],
            "extraction_stats": stats
        },
        "nodes": list(graph_nodes.values()),
        "edges": graph_edges
    }

    # Write jodhpur_graph.json
    print(f"[INFO] Writing {GRAPH_OUTPUT_PATH} ...")
    with open(GRAPH_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(graph_payload, f)
    print(f"[SUCCESS] Saved graph to {GRAPH_OUTPUT_PATH} ({os.path.getsize(GRAPH_OUTPUT_PATH):,} bytes)")

    # Write jodhpur_roads.geojson
    roads_geojson = {
        "type": "FeatureCollection",
        "name": "jodhpur_roads",
        "metadata": {
            "city": "Jodhpur",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "features_count": len(geojson_features)
        },
        "features": geojson_features
    }

    print(f"[INFO] Writing {ROADS_GEOJSON_OUTPUT} ...")
    with open(ROADS_GEOJSON_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(roads_geojson, f)
    print(f"[SUCCESS] Saved roads GeoJSON to {ROADS_GEOJSON_OUTPUT} ({os.path.getsize(ROADS_GEOJSON_OUTPUT):,} bytes)")

    return stats

if __name__ == "__main__":
    build_graph()

