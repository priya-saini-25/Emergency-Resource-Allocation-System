"""
Official Download Script for Jodhpur Urban Service Area Boundary
Source: OpenStreetMap Way 31725312 (place=city, Jodhpur, Rajasthan, India)
Endpoint: Official OpenStreetMap API v0.6 (https://api.openstreetmap.org)
"""

import urllib.request
import json
import os
import sys
from datetime import datetime, timezone

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "jodhpur_boundary.geojson")

def download_boundary():
    print("[INFO] Fetching original OSM Way 31725312 directly from official OpenStreetMap API v0.6...")
    url = "https://api.openstreetmap.org/api/0.6/way/31725312/full.json"
    headers = {"User-Agent": "EmergencyResourceAllocationSystem/1.0 (academic-simulation-jodhpur; contact: university-project)"}
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"[ERROR] Failed to fetch from official OSM API: {e}", file=sys.stderr)
        sys.exit(1)

    elements = data.get("elements", [])
    node_coords = {}
    way_element = None

    for el in elements:
        if el["type"] == "node":
            node_coords[el["id"]] = [float(el["lon"]), float(el["lat"])]
        elif el["type"] == "way" and el["id"] == 31725312:
            way_element = el

    if not way_element:
        print("[ERROR] Way 31725312 not found in response payload", file=sys.stderr)
        sys.exit(1)

    way_nodes = way_element.get("nodes", [])
    print(f"[INFO] Way contains {len(way_nodes)} node references.")

    # Reconstruct exact sequential coordinate list
    coordinates = []
    for nid in way_nodes:
        if nid in node_coords:
            coordinates.append(node_coords[nid])
        else:
            print(f"[ERROR] Node ID {nid} missing from node table", file=sys.stderr)
            sys.exit(1)

    # Check polygon ring closure
    is_closed = (coordinates[0] == coordinates[-1])
    if not is_closed:
        print("[INFO] Closing outer ring (appending first coordinate to end as per GeoJSON Polygon specification)")
        coordinates.append(coordinates[0])

    # Compute bounding box [min_lng, min_lat, max_lng, max_lat]
    lons = [pt[0] for pt in coordinates]
    lats = [pt[1] for pt in coordinates]
    bbox = [min(lons), min(lats), max(lons), max(lats)]

    retrieval_date = datetime.now(timezone.utc).isoformat()

    # Construct complete GeoJSON FeatureCollection
    geojson_data = {
        "type": "FeatureCollection",
        "name": "jodhpur_boundary",
        "crs": {
            "type": "name",
            "properties": {
                "name": "urn:ogc:def:crs:OGC:1.3:CRS84"
            }
        },
        "metadata": {
            "dataset_name": "Jodhpur Urban Service Area Boundary",
            "classification": "Jodhpur Urban Service Area (derived from OpenStreetMap Urban Settlement Footprint, Way 31725312; academic proxy for urban emergency simulation).",
            "official_status": "Academic urban settlement proxy (NOT an officially notified Jodhpur Municipal Corporation boundary)",
            "osm_id": 31725312,
            "osm_type": "way",
            "osm_tags": way_element.get("tags", {}),
            "source": "OpenStreetMap",
            "source_url": "https://www.openstreetmap.org/way/31725312",
            "api_endpoint": "https://api.openstreetmap.org/api/0.6/way/31725312/full.json",
            "retrieval_date": retrieval_date,
            "license": "Open Data Commons Open Database License (ODbL) 1.0",
            "attribution": "© OpenStreetMap contributors",
            "coordinate_reference_system": "WGS84 (EPSG:4326 / OGC:CRS84)",
            "bounding_box_wgs84": {
                "min_longitude": bbox[0],
                "min_latitude": bbox[1],
                "max_longitude": bbox[2],
                "max_latitude": bbox[3]
            },
            "total_vertices": len(coordinates)
        },
        "features": [
            {
                "type": "Feature",
                "id": "way/31725312",
                "properties": {
                    "osm_id": 31725312,
                    "osm_type": "way",
                    "name": "Jodhpur",
                    "name:en": "Jodhpur",
                    "name:hi": "जोधपुर",
                    "place": "city",
                    "population": way_element.get("tags", {}).get("population", "2330000"),
                    "wikidata": way_element.get("tags", {}).get("wikidata", "Q200019")
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [coordinates]
                }
            }
        ]
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson_data, f, indent=2, ensure_ascii=False)

    print(f"[SUCCESS] Successfully saved canonical boundary to {OUTPUT_PATH}")
    print(f"[INFO] Bounding Box: {bbox}")
    print(f"[INFO] Vertices count: {len(coordinates)}")

if __name__ == "__main__":
    download_boundary()
