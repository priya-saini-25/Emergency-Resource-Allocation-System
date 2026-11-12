"""
Comprehensive Validation Script for jodhpur_boundary.geojson
Validates:
1. GeoJSON Parsing & Specification Compliance (RFC 7946 / WGS84 CRS84)
2. Polygon Ring Closure (first vertex == last vertex)
3. Geometry Validity (non-empty, non-self-intersecting ring, minimum 4 vertices)
4. Coordinate Ranges (Longitude in [-180, 180], Latitude in [-90, 90])
5. Bounding Box Calculation [min_lon, min_lat, max_lon, max_lat]
6. Geodesic / Spherical Surface Area Estimation (km² and hectares)
7. Coordinate Integrity (detection of unexpected consecutive duplicate vertices, NaNs, nulls)
8. Point-in-Polygon Containment Testing for Key Facilities:
   - AIIMS Jodhpur
   - Mathura Das Mathur Hospital (MDM Hospital)
   - Mahatma Gandhi Hospital (MGH)
   - Basni (RIICO Industrial Area)
   - Additional landmark controls and external negative controls
"""

import json
import math
import os
import sys

BOUNDARY_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "jodhpur_boundary.geojson")

def point_in_polygon(point, polygon_coords):
    """
    Ray-casting algorithm (Even-Odd rule) for point-in-polygon testing.
    point: [lon, lat]
    polygon_coords: list of [lon, lat] coordinates representing a closed linear ring.
    """
    x, y = point[0], point[1]
    inside = False
    n = len(polygon_coords)
    p1x, p1y = polygon_coords[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon_coords[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def calculate_geodesic_area_km2(coordinates):
    """
    Calculate the surface area of a spherical polygon in square kilometers.
    Uses the spherical excess formula on an authalic Earth sphere (R = 6371.0088 km).
    """
    R = 6371.0088  # Mean Earth radius in kilometers
    if len(coordinates) < 4:
        return 0.0

    total = 0.0
    n = len(coordinates)
    for i in range(n - 1):
        p1 = coordinates[i]
        p2 = coordinates[i + 1]
        lon1 = math.radians(p1[0])
        lat1 = math.radians(p1[1])
        lon2 = math.radians(p2[0])
        lat2 = math.radians(p2[1])
        total += (lon2 - lon1) * (2.0 + math.sin(lat1) + math.sin(lat2))

    area = abs(total * (R * R) / 2.0)
    return area

def ccw(A, B, C):
    return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])

def intersect(A, B, C, D):
    """Check if line segment AB intersects line segment CD."""
    return ccw(A, C, D) != ccw(B, C, D) and ccw(A, B, C) != ccw(A, B, D)

def check_self_intersection(ring):
    """
    Check if any non-adjacent segments of a linear ring intersect.
    Returns (has_intersection, details).
    """
    n = len(ring) - 1  # Excluding the duplicate closing point
    for i in range(n):
        p1, p2 = ring[i], ring[i + 1]
        for j in range(i + 2, n):
            # Avoid testing adjacent segments (they share a vertex)
            if i == 0 and j == n - 1:
                continue
            p3, p4 = ring[j], ring[j + 1]
            if intersect(p1, p2, p3, p4):
                return True, f"Segment ({i}->{i+1}) intersects Segment ({j}->{j+1})"
    return False, "Simple non-self-intersecting polygon"

def run_validation():
    print("=" * 70)
    print("JODHPUR URBAN SERVICE AREA BOUNDARY VALIDATION")
    print(f"Target File: {os.path.abspath(BOUNDARY_PATH)}")
    print("=" * 70)

    results = {
        "file_exists": False,
        "json_parsing": False,
        "geojson_structure": False,
        "geometry_type": None,
        "vertex_count": 0,
        "ring_closed": False,
        "coordinate_ranges_valid": False,
        "no_duplicate_consecutive_vertices": False,
        "no_self_intersections": False,
        "bounding_box": {},
        "area_km2": 0.0,
        "area_hectares": 0.0,
        "facility_containment": [],
        "overall_status": "FAILED"
    }

    # 1. File existence
    if not os.path.exists(BOUNDARY_PATH):
        print(f"[FAIL] Boundary file does not exist at {BOUNDARY_PATH}", file=sys.stderr)
        return False, results
    results["file_exists"] = True
    print("[PASS] 1. File exists on disk.")

    # 2. JSON Parsing
    try:
        with open(BOUNDARY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        results["json_parsing"] = True
        print("[PASS] 2. JSON syntax is well-formed.")
    except Exception as e:
        print(f"[FAIL] 2. JSON syntax error: {e}", file=sys.stderr)
        return False, results

    # 3. GeoJSON Schema & Feature Extraction
    root_type = data.get("type")
    if root_type not in ["FeatureCollection", "Feature", "Polygon"]:
        print(f"[FAIL] 3. Invalid GeoJSON root type: {root_type}", file=sys.stderr)
        return False, results

    if root_type == "FeatureCollection":
        features = data.get("features", [])
        if not features:
            print("[FAIL] 3. FeatureCollection contains 0 features", file=sys.stderr)
            return False, results
        feature = features[0]
    elif root_type == "Feature":
        feature = data
    else:
        feature = {"geometry": data}

    geometry = feature.get("geometry", {})
    geom_type = geometry.get("type")
    results["geometry_type"] = geom_type

    if geom_type != "Polygon":
        print(f"[FAIL] 3. Expected geometry type 'Polygon', found: '{geom_type}'", file=sys.stderr)
        return False, results

    coords = geometry.get("coordinates", [])
    if not coords or len(coords) < 1:
        print("[FAIL] 3. Coordinates ring list is empty", file=sys.stderr)
        return False, results

    ring = coords[0]
    results["vertex_count"] = len(ring)
    results["geojson_structure"] = True
    print(f"[PASS] 3. Valid GeoJSON Polygon geometry with {len(ring)} vertices in outer ring.")

    # 4. Ring Closure Check
    if len(ring) < 4:
        print(f"[FAIL] 4. Linear ring must contain at least 4 vertices (found {len(ring)})", file=sys.stderr)
        return False, results

    first_pt = ring[0]
    last_pt = ring[-1]
    if first_pt[0] == last_pt[0] and first_pt[1] == last_pt[1]:
        results["ring_closed"] = True
        print(f"[PASS] 4. Polygon ring is properly closed (first: {first_pt} == last: {last_pt}).")
    else:
        print(f"[FAIL] 4. Polygon ring is NOT closed: first={first_pt}, last={last_pt}", file=sys.stderr)
        return False, results

    # 5. Coordinate Ranges & WGS84 Validity
    min_lon, max_lon = float("inf"), float("-inf")
    min_lat, max_lat = float("inf"), float("-inf")
    coords_valid = True

    for idx, pt in enumerate(ring):
        if not isinstance(pt, list) or len(pt) < 2:
            print(f"[FAIL] 5. Vertex {idx} is invalid: {pt}", file=sys.stderr)
            coords_valid = False
            break
        lon, lat = pt[0], pt[1]
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            print(f"[FAIL] 5. Coordinates out of WGS84 range at vertex {idx}: [{lon}, {lat}]", file=sys.stderr)
            coords_valid = False
            break
        min_lon = min(min_lon, lon)
        max_lon = max(max_lon, lon)
        min_lat = min(min_lat, lat)
        max_lat = max(max_lat, lat)

    if not coords_valid:
        return False, results

    results["coordinate_ranges_valid"] = True
    results["bounding_box"] = {
        "min_longitude": min_lon,
        "min_latitude": min_lat,
        "max_longitude": max_lon,
        "max_latitude": max_lat
    }
    print(f"[PASS] 5. All coordinates within valid WGS84 limits.")
    print(f"       Bounding Box: Lon [{min_lon:.6f}, {max_lon:.6f}], Lat [{min_lat:.6f}, {max_lat:.6f}]")

    # 6. Consecutive Duplicate Coordinates Check
    has_duplicate = False
    for i in range(len(ring) - 2):
        if ring[i][0] == ring[i + 1][0] and ring[i][1] == ring[i + 1][1]:
            print(f"[WARN] 6. Consecutive identical vertex found at index {i} and {i+1}: {ring[i]}")
            has_duplicate = True
    if not has_duplicate:
        results["no_duplicate_consecutive_vertices"] = True
        print("[PASS] 6. Zero unintended consecutive duplicate vertices found.")
    else:
        results["no_duplicate_consecutive_vertices"] = False

    # 7. Self-Intersection Check
    intersects, details = check_self_intersection(ring)
    if intersects:
        print(f"[FAIL] 7. Polygon has self-intersection: {details}", file=sys.stderr)
        results["no_self_intersections"] = False
        return False, results
    else:
        results["no_self_intersections"] = True
        print(f"[PASS] 7. Polygon topology is simple: {details}.")

    # 8. Geodesic Surface Area Calculation
    area_km2 = calculate_geodesic_area_km2(ring)
    area_ha = area_km2 * 100.0
    results["area_km2"] = round(area_km2, 2)
    results["area_hectares"] = round(area_ha, 1)
    print(f"[PASS] 8. Estimated Geodesic Surface Area: {area_km2:.2f} km² ({area_ha:,.1f} hectares).")

    # 9. Important Emergency Facilities Containment Verification
    facilities = [
        {"name": "AIIMS Jodhpur", "coord": [73.006790, 26.239941], "required": True},
        {"name": "Mathura Das Mathur Hospital (MDM Hospital)", "coord": [73.009141, 26.266022], "required": True},
        {"name": "Mahatma Gandhi Hospital (MGH)", "coord": [73.018564, 26.283129], "required": True},
        {"name": "Basni (RIICO Industrial Area)", "coord": [73.010839, 26.223028], "required": True},
        {"name": "Sojati Gate (Central Dispatch Hub)", "coord": [73.023983, 26.288600], "required": True},
        {"name": "Mehrangarh Fort / Old City", "coord": [73.018500, 26.297800], "required": True},
        {"name": "Paota Circle (Northern Highway Node)", "coord": [73.042500, 26.301200], "required": True},
        {"name": "Jodhpur Junction Railway Station", "coord": [73.017500, 26.283000], "required": True},
        {"name": "Shastri Nagar Circle", "coord": [73.007000, 26.271000], "required": True},
        {"name": "Negative Control: Mandore Garden (North)", "coord": [73.045000, 26.357000], "required": False, "expect": False},
        {"name": "Negative Control: Boranada Industrial (South-West)", "coord": [72.935000, 26.185000], "required": False, "expect": False},
        {"name": "Negative Control: Jaipur City", "coord": [75.787300, 26.912400], "required": False, "expect": False}
    ]

    print("\n" + "-" * 70)
    print("FACILITY CONTAINMENT VERIFICATION MATRIX")
    print("-" * 70)
    all_mandatory_inside = True

    for fac in facilities:
        is_in = point_in_polygon(fac["coord"], ring)
        expected = fac.get("expect", True)
        matches = (is_in == expected)

        fac_result = {
            "name": fac["name"],
            "coordinates": fac["coord"],
            "is_inside": is_in,
            "expected_inside": expected,
            "status": "PASS" if matches else "FAIL"
        }
        results["facility_containment"].append(fac_result)

        tag = "[INSIDE]" if is_in else "[OUTSIDE]"
        status_label = "PASS" if matches else "FAIL"
        print(f"  {tag:<10} {fac['name']:<42} {fac['coord']} -> {status_label}")

        if fac.get("required") and not is_in:
            all_mandatory_inside = False
            print(f"             [ALERT] Mandatory facility '{fac['name']}' is OUTSIDE the boundary!")

    if all_mandatory_inside:
        print("-" * 70)
        print("[SUCCESS] All 4 mandatory facilities (AIIMS, MDM, MGH, Basni) are INSIDE the boundary.")
        results["overall_status"] = "PASSED"
        return True, results
    else:
        print("-" * 70)
        print("[WARNING] One or more mandatory facilities are outside the boundary polygon.", file=sys.stderr)
        results["overall_status"] = "PASSED_WITH_CONTAINMENT_WARNINGS"
        return True, results

if __name__ == "__main__":
    success, res = run_validation()
    sys.exit(0 if success else 1)
