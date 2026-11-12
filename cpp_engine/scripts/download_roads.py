"""
Download authentic OpenStreetMap road network data within the Jodhpur Urban Service Area bounding box.
Queries the Overpass API with retry logic and fallback endpoints.
Saves raw OSM road ways and referenced nodes to cpp_engine/data/raw_osm_roads.json.
"""

import urllib.request
import urllib.parse
import json
import os
import sys
import time
from datetime import datetime, timezone

BOUNDARY_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "jodhpur_boundary.geojson")
RAW_ROADS_OUTPUT = os.path.join(os.path.dirname(__file__), "..", "data", "raw_osm_roads.json")

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
]

def load_boundary_bbox():
    if not os.path.exists(BOUNDARY_PATH):
        print(f"[ERROR] Boundary file not found at {BOUNDARY_PATH}", file=sys.stderr)
        sys.exit(1)
    with open(BOUNDARY_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    coords = data["features"][0]["geometry"]["coordinates"][0]
    lons = [pt[0] for pt in coords]
    lats = [pt[1] for pt in coords]
    # Overpass bbox format: (min_lat, min_lon, max_lat, max_lon)
    return min(lats), min(lons), max(lats), max(lons)

def download_roads():
    min_lat, min_lon, max_lat, max_lon = load_boundary_bbox()
    print(f"[INFO] Bounding box for extraction: Lat [{min_lat:.6f}, {max_lat:.6f}], Lon [{min_lon:.6f}, {max_lon:.6f}]")

    highway_regex = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"
    
    overpass_query = f"""
    [out:json][timeout:180];
    (
      way["highway"~"{highway_regex}"]({min_lat:.6f},{min_lon:.6f},{max_lat:.6f},{max_lon:.6f});
    );
    out body;
    >;
    out skel qt;
    """

    encoded_data = urllib.parse.urlencode({"data": overpass_query}).encode("utf-8")
    headers = {
        "User-Agent": "EmergencyResourceAllocationSystem/1.0 (academic-simulation-jodhpur; contact: university-project)",
        "Accept": "application/json"
    }

    payload = None
    successful_endpoint = None

    for endpoint in OVERPASS_ENDPOINTS:
        print(f"[INFO] Attempting download from Overpass endpoint: {endpoint} ...")
        for attempt in range(1, 4):
            try:
                req = urllib.request.Request(endpoint, data=encoded_data, headers=headers)
                start_t = time.time()
                with urllib.request.urlopen(req, timeout=120) as resp:
                    raw_data = resp.read().decode("utf-8")
                    payload = json.loads(raw_data)
                    elapsed = time.time() - start_t
                    print(f"[SUCCESS] Download completed in {elapsed:.2f}s from {endpoint}")
                    successful_endpoint = endpoint
                    break
            except Exception as e:
                print(f"[WARN] Attempt {attempt} failed on {endpoint}: {e}")
                if attempt < 3:
                    time.sleep(3)
        if payload is not None:
            break

    if payload is None:
        print("[ERROR] All Overpass API endpoints failed. Please check network connectivity.", file=sys.stderr)
        sys.exit(1)

    elements = payload.get("elements", [])
    ways = [el for el in elements if el["type"] == "way"]
    nodes = [el for el in elements if el["type"] == "node"]

    print(f"[INFO] Downloaded: {len(ways)} road ways, {len(nodes)} referenced nodes.")

    extraction_metadata = {
        "source": "OpenStreetMap via Overpass API",
        "endpoint_used": successful_endpoint,
        "retrieval_timestamp": datetime.now(timezone.utc).isoformat(),
        "license": "Open Data Commons Open Database License (ODbL) 1.0",
        "attribution": "© OpenStreetMap contributors",
        "bounding_box": {
            "min_latitude": min_lat,
            "min_longitude": min_lon,
            "max_latitude": max_lat,
            "max_longitude": max_lon
        },
        "highway_filter_regex": highway_regex,
        "raw_counts": {
            "ways_count": len(ways),
            "nodes_count": len(nodes)
        }
    }

    full_output = {
        "metadata": extraction_metadata,
        "elements": elements
    }

    os.makedirs(os.path.dirname(RAW_ROADS_OUTPUT), exist_ok=True)
    with open(RAW_ROADS_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(full_output, f)

    print(f"[SUCCESS] Raw OSM road network data saved to {RAW_ROADS_OUTPUT}")
    return RAW_ROADS_OUTPUT

if __name__ == "__main__":
    download_roads()
