"""
Generate ASCII map preview of Jodhpur Urban Boundary and key facilities.
"""

import json
import os

BOUNDARY_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "jodhpur_boundary.geojson")

def render_ascii_map():
    with open(BOUNDARY_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    ring = data["features"][0]["geometry"]["coordinates"][0]

    min_lon = min(p[0] for p in ring)
    max_lon = max(p[0] for p in ring)
    min_lat = min(p[1] for p in ring)
    max_lat = max(p[1] for p in ring)

    width = 60
    height = 24

    grid = [[" " for _ in range(width)] for _ in range(height)]

    # Draw boundary polygon edges
    for i in range(len(ring) - 1):
        p1 = ring[i]
        p2 = ring[i + 1]
        x1 = int((p1[0] - min_lon) / (max_lon - min_lon) * (width - 1))
        y1 = int((max_lat - p1[1]) / (max_lat - min_lat) * (height - 1))
        x2 = int((p2[0] - min_lon) / (max_lon - min_lon) * (width - 1))
        y2 = int((max_lat - p2[1]) / (max_lat - min_lat) * (height - 1))

        # Bresenham-like line interpolation
        steps = max(abs(x2 - x1), abs(y2 - y1), 1)
        for s in range(steps + 1):
            x = int(x1 + (x2 - x1) * s / steps)
            y = int(y1 + (y2 - y1) * s / steps)
            if 0 <= x < width and 0 <= y < height:
                if grid[y][x] == " ":
                    grid[y][x] = "#"

    # Plot landmark facilities
    landmarks = [
        {"name": "AIIMS", "symbol": "A", "coord": [73.006790, 26.239941]},
        {"name": "MDM", "symbol": "M", "coord": [73.009141, 26.266022]},
        {"name": "MGH", "symbol": "G", "coord": [73.018564, 26.283129]},
        {"name": "Basni", "symbol": "B", "coord": [73.010839, 26.223028]},
        {"name": "Sojati", "symbol": "S", "coord": [73.023983, 26.288600]},
        {"name": "Paota", "symbol": "P", "coord": [73.042500, 26.301200]}
    ]

    for lm in landmarks:
        c = lm["coord"]
        if min_lon <= c[0] <= max_lon and min_lat <= c[1] <= max_lat:
            x = int((c[0] - min_lon) / (max_lon - min_lon) * (width - 1))
            y = int((max_lat - c[1]) / (max_lat - min_lat) * (height - 1))
            if 0 <= x < width and 0 <= y < height:
                grid[y][x] = lm["symbol"]

    border_line = "+" + "-" * width + "+"
    lines = [border_line]
    for row in grid:
        lines.append("|" + "".join(row) + "|")
    lines.append(border_line)

    print("\n".join(lines))
    print("Legend: [A]=AIIMS Jodhpur, [M]=MDM Hospital, [G]=Mahatma Gandhi Hospital, [B]=Basni, [S]=Sojati Gate, [P]=Paota Circle, [#]=Boundary Perimeter")

if __name__ == "__main__":
    render_ascii_map()

