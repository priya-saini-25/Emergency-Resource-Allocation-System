"""
Generate ASCII visualization of the authentic Jodhpur Road Network.
Projects major road corridors and key emergency facilities.
"""

import json
import os

GRAPH_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "jodhpur_graph.json")
BOUNDARY_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "jodhpur_boundary.geojson")

def render_road_ascii_map():
    with open(BOUNDARY_PATH, "r", encoding="utf-8") as f:
        bdata = json.load(f)
    ring = bdata["features"][0]["geometry"]["coordinates"][0]

    min_lon = min(p[0] for p in ring)
    max_lon = max(p[0] for p in ring)
    min_lat = min(p[1] for p in ring)
    max_lat = max(p[1] for p in ring)

    width = 66
    height = 26

    grid = [[" " for _ in range(width)] for _ in range(height)]

    # Draw boundary polygon
    for i in range(len(ring) - 1):
        p1, p2 = ring[i], ring[i + 1]
        x1 = int((p1[0] - min_lon) / (max_lon - min_lon) * (width - 1))
        y1 = int((max_lat - p1[1]) / (max_lat - min_lat) * (height - 1))
        x2 = int((p2[0] - min_lon) / (max_lon - min_lon) * (width - 1))
        y2 = int((max_lat - p2[1]) / (max_lat - min_lat) * (height - 1))

        steps = max(abs(x2 - x1), abs(y2 - y1), 1)
        for s in range(steps + 1):
            x = int(x1 + (x2 - x1) * s / steps)
            y = int(y1 + (y2 - y1) * s / steps)
            if 0 <= x < width and 0 <= y < height:
                grid[y][x] = "."

    print("[INFO] Reading graph edges for arterial road visualization...")
    with open(GRAPH_PATH, "r", encoding="utf-8") as f:
        graph = json.load(f)

    edges = graph.get("edges", [])
    arterial_classes = {"trunk", "primary", "secondary", "tertiary"}

    for e in edges:
        hw = e.get("road_type")
        if hw in arterial_classes:
            geom = e.get("geometry", [])
            if len(geom) >= 2:
                p1, p2 = geom[0], geom[1]
                x1 = int((p1[0] - min_lon) / (max_lon - min_lon) * (width - 1))
                y1 = int((max_lat - p1[1]) / (max_lat - min_lat) * (height - 1))
                x2 = int((p2[0] - min_lon) / (max_lon - min_lon) * (width - 1))
                y2 = int((max_lat - p2[1]) / (max_lat - min_lat) * (height - 1))

                steps = max(abs(x2 - x1), abs(y2 - y1), 1)
                for s in range(steps + 1):
                    x = int(x1 + (x2 - x1) * s / steps)
                    y = int(y1 + (y2 - y1) * s / steps)
                    if 0 <= x < width and 0 <= y < height:
                        if grid[y][x] in [" ", "."]:
                            grid[y][x] = "=" if hw in {"trunk", "primary"} else "-"

    # Key Facilities
    landmarks = [
        {"name": "AIIMS", "symbol": "[A]", "coord": [73.006790, 26.239941]},
        {"name": "MDM", "symbol": "[M]", "coord": [73.009141, 26.266022]},
        {"name": "MGH", "symbol": "[G]", "coord": [73.018564, 26.283129]},
        {"name": "Basni", "symbol": "[B]", "coord": [73.010839, 26.223028]},
        {"name": "Sojati", "symbol": "[S]", "coord": [73.023983, 26.288600]},
        {"name": "Paota", "symbol": "[P]", "coord": [73.042500, 26.301200]}
    ]

    for lm in landmarks:
        c = lm["coord"]
        if min_lon <= c[0] <= max_lon and min_lat <= c[1] <= max_lat:
            x = int((c[0] - min_lon) / (max_lon - min_lon) * (width - 1))
            y = int((max_lat - c[1]) / (max_lat - min_lat) * (height - 1))
            for i, ch in enumerate(lm["symbol"]):
                if 0 <= x + i < width and 0 <= y < height:
                    grid[y][x + i] = ch

    border = "+" + "-" * width + "+"
    print("\n" + border)
    for r in grid:
        print("|" + "".join(r) + "|")
    print(border)
    print("Legend: [A]=AIIMS Jodhpur, [M]=MDM Hospital, [G]=Mahatma Gandhi Hospital, [B]=Basni, [S]=Sojati Gate, [P]=Paota Circle")
    print("        [=]=Primary/Trunk Arterials, [-]=Secondary/Tertiary Roads, [.]=Boundary")

if __name__ == "__main__":
    render_road_ascii_map()

