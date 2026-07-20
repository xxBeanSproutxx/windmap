#!/usr/bin/env python3
"""
Wave-Fetch Compute Engine for Blue Lake Fishing App Spike.

Parses Blue Lake KML, fetches real wind data from Open-Meteo,
computes wave fetch and bank impact for shoreline segments AND
a grid-based surface heatmap across the lake interior.

Pure Python stdlib — no external dependencies.
"""

import xml.etree.ElementTree as ET
import json
import math
import urllib.request
import urllib.error
import sys
import argparse
import os
from datetime import datetime, timedelta
import time
# ── Configuration ──────────────────────────────────────────────────────────
KML_PATH = "data/blue_lake.kml"
OUTPUT_PATH = "data/lake_data.json"
LAKE_NAME = "Blue Lake"
LAKE_CENTER_LAT = 45.49
LAKE_CENTER_LON = -93.50
FETCH_CAP_KM = 5.0          # shoreline fetch cap
GRID_FETCH_CAP_KM = 1.0     # grid impact_score cap (tighter for dead-flat green = short fetch)
NEAR_SHORE_DEPTH_M = 2.0    # assumed depth for wave height calculation
G = 9.81                    # gravitational acceleration m/s²
SAMPLING_STEP = 10           # sample every Nth vertex for shoreline segments
GRID_SPACING_DEG = 0.0004   # ~35-45m spacing at this latitude
SHIELD_DISTANCE_M = 100      # max distance from shore (meters) where tree-line shielding applies

# NLCD 2021 land cover class → wind reduction coefficient
# Derived from aerodynamic roughness length (z₀) ratios
# reduction = 1.0 - ln(10/z₀_land) / ln(10/0.0002)
NLCD_COEFFICIENTS = {
    11: 0.00,  # Open Water
    12: 0.00,  # Perennial Ice/Snow
    21: 0.64,  # Developed, Open Space
    22: 0.72,  # Developed, Low Intensity
    23: 0.77,  # Developed, Medium Intensity
    24: 0.82,  # Developed, High Intensity
    31: 0.30,  # Barren Land
    41: 0.75,  # Deciduous Forest
    42: 0.79,  # Evergreen Forest
    43: 0.77,  # Mixed Forest
    52: 0.57,  # Shrub/Scrub
    71: 0.36,  # Grassland/Herbaceous
    81: 0.46,  # Pasture/Hay
    82: 0.51,  # Cultivated Crops
    90: 0.72,  # Woody Wetlands
    95: 0.46,  # Emergent Herbaceous Wetlands
}

NLCD_CLASS_NAMES = {
    11: "Open Water",
    12: "Perennial Ice/Snow",
    21: "Developed, Open Space",
    22: "Developed, Low Intensity",
    23: "Developed, Medium Intensity",
    24: "Developed, High Intensity",
    31: "Barren Land",
    41: "Deciduous Forest",
    42: "Evergreen Forest",
    43: "Mixed Forest",
    52: "Shrub/Scrub",
    71: "Grassland/Herbaceous",
    81: "Pasture/Hay",
    82: "Cultivated Crops",
    90: "Woody Wetlands",
    95: "Emergent Herbaceous Wetlands",
}

# ── 1. Parse KML ───────────────────────────────────────────────────────────

def parse_kml(path):
    """Extract shoreline polygon from KML LineString coordinates."""
    ns = {"kml": "http://www.opengis.net/kml/2.2"}
    tree = ET.parse(path)
    root = tree.getroot()

    coords_elem = root.findall(".//kml:LineString/kml:coordinates", ns)
    if not coords_elem:
        coords_elem = root.findall(".//LineString/coordinates")
    if not coords_elem:
        raise ValueError("No <LineString><coordinates> found in KML")

    text = coords_elem[0].text.strip()
    points = text.split()

    polygon = []
    for pt in points:
        parts = pt.split(",")
        lon = float(parts[0])
        lat = float(parts[1])
        polygon.append([lon, lat])

    # Close the polygon if not already closed (compare by value, not identity)
    first_pt = polygon[0]
    last_pt = polygon[-1]
    if abs(first_pt[0] - last_pt[0]) > 1e-9 or abs(first_pt[1] - last_pt[1]) > 1e-9:
        polygon.append(first_pt[:])

    return polygon


# ── 2. Fetch Wind Data ─────────────────────────────────────────────────────

def fetch_wind_data(lat, lon):
    """Fetch hourly wind forecast from Open-Meteo (no API key needed)."""
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m"
        f"&forecast_days=1"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "WaveFetchSpike/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = json.loads(resp.read().decode("utf-8"))

    hourly = raw["hourly"]
    times = hourly["time"]
    speeds = hourly["wind_speed_10m"]
    directions = hourly["wind_direction_10m"]
    gusts = hourly.get("wind_gusts_10m", speeds)

    # Open-Meteo returns wind_speed_10m and wind_gusts_10m in km/h,
    # but we store as m/s — divide by 3.6 to convert.
    KMH_TO_MS = 1.0 / 3.6

    result = []
    for t, s, d, g in zip(times, speeds, directions, gusts):
        # convert UTC to Minnesota local (CDT = UTC-5)
        local_dt = datetime.fromisoformat(t) - timedelta(hours=5)
        result.append({
            "time": local_dt.strftime("%Y-%m-%dT%H:%M"),
            "speed_ms": round(s * KMH_TO_MS, 2),
            "direction_deg": d,
            "gust_ms": round(g * KMH_TO_MS, 2) if g is not None else None,
        })
    return result


# ── 2b. NLCD Land Cover Sampling ────────────────────────────────────────

NLCD_WMS_URL = (
    "https://www.mrlc.gov/geoserver/mrlc_display/wms"
    "?service=WMS&version=1.1.1&request=GetFeatureInfo"
    "&layers=NLCD_2021_Land_Cover_L48"
    "&query_layers=NLCD_2021_Land_Cover_L48"
    "&width=1&height=1&x=0&y=0"
    "&srs=EPSG:4326&format=image/png"
    "&info_format=application/json"
)


def sample_nlcd(lat, lon, timeout=10):
    """Query NLCD 2021 land cover class at a point via MRLC WMS.

    Returns: (nlcd_class: int, class_name: str) or (None, None) on failure.
    """
    bbox = f"{lon-0.001},{lat-0.001},{lon+0.001},{lat+0.001}"
    url = f"{NLCD_WMS_URL}&bbox={bbox}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "WaveFetchSpike/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        value = result.get("features", [{}])[0].get("properties", {}).get("PALETTE_INDEX")
        if value is not None:
            return int(value), NLCD_CLASS_NAMES.get(int(value), "Unknown")
    except Exception as e:
        print(f"    NLCD query failed for ({lat:.4f}, {lon:.4f}): {e}")
    return None, None


# ── 3. Geometry Helpers ────────────────────────────────────────────────────

def latlon_to_km(dlat, dlon, lat):
    """Convert lat/lon differences to km. Approximate: 1° lat ≈ 111.32 km."""
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * math.cos(math.radians(lat))
    dx = dlon * km_per_deg_lon
    dy = dlat * km_per_deg_lat
    return math.sqrt(dx * dx + dy * dy)


def latlon_to_bearing_km(start, end):
    """Return (distance_km, bearing_deg) from start to end."""
    lat1, lon1 = math.radians(start[1]), math.radians(start[0])
    lat2, lon2 = math.radians(end[1]), math.radians(end[0])

    dlon = lon2 - lon1
    dlat = lat2 - lat1

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    distance_km = 6371.0 * c

    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    bearing = (math.degrees(math.atan2(y, x)) + 360) % 360

    return distance_km, bearing


def segment_intersection(p1, p2, p3, p4):
    """Check if segments (p1->p2) and (p3->p4) intersect. Returns (True/False, intersection_point_or_None)."""
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    x4, y4 = p4

    denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denom) < 1e-15:
        return False, None

    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
    u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom

    if 0 <= t <= 1 and 0 <= u <= 1:
        ix = x1 + t * (x2 - x1)
        iy = y1 + t * (y2 - y1)
        return True, (ix, iy)
    return False, None


def _lonlat_to_local_xy(lon, lat, lon0, lat0):
    """Project (lon, lat) to local Cartesian (x=east, y=north) in meters,
    centered at (lon0, lat0). Uses tangent-plane approximation (good for < 100km)."""
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * math.cos(math.radians(lat0))
    x = (lon - lon0) * km_per_deg_lon * 1000.0
    y = (lat - lat0) * km_per_deg_lat * 1000.0
    return x, y


def ray_polygon_intersection(origin, direction_deg, polygon, max_km=FETCH_CAP_KM):
    """
    Cast a ray from origin in the given direction (meteorological convention:
    0° = North, 90° = East). Return distance in km to closest polygon edge,
    capped at max_km.

    Projects polygon and ray into a local Cartesian plane (meters) centered
    on the origin to eliminate latitude-distortion errors in intersection math.
    """
    lon0, lat0 = origin[0], origin[1]

    # ── Project entire polygon into local Cartesian (meters) ──
    n = len(polygon)
    poly_xy = []
    for i in range(n):
        x, y = _lonlat_to_local_xy(polygon[i][0], polygon[i][1], lon0, lat0)
        poly_xy.append((x, y))

    # ── Build ray in Cartesian: from (0,0) in the given direction ──
    rad = math.radians(direction_deg)
    # Meteorological → Cartesian: 0°=North (+y), 90°=East (+x)
    ray_dx = math.sin(rad)
    ray_dy = math.cos(rad)
    max_m = max_km * 1000.0
    ray_start = (0.0, 0.0)
    ray_end = (ray_dx * max_m, ray_dy * max_m)

    # ── Find closest intersection ──
    closest_dist_m = max_m
    found_hit = False

    for i in range(n - 1):
        seg_start = poly_xy[i]
        seg_end = poly_xy[i + 1]

        # Skip zero-length or near-zero-length edges
        sdx = seg_end[0] - seg_start[0]
        sdy = seg_end[1] - seg_start[1]
        if abs(sdx) < 1e-9 and abs(sdy) < 1e-9:
            continue

        # Skip segments where the origin lies on either endpoint
        # (avoids self-intersection when origin is a polygon vertex)
        if (abs(seg_start[0]) < 1e-9 and abs(seg_start[1]) < 1e-9):
            continue
        if (abs(seg_end[0]) < 1e-9 and abs(seg_end[1]) < 1e-9):
            continue

        hits, hit_pt = segment_intersection(ray_start, ray_end, seg_start, seg_end)
        if hits:
            hx, hy = hit_pt
            dist_m = math.sqrt(hx * hx + hy * hy)
            # Require minimum distance to avoid self-hits (1 cm)
            if dist_m > 1e-2 and dist_m < closest_dist_m - 1e-6:
                closest_dist_m = dist_m
                found_hit = True

    if found_hit:
        return closest_dist_m / 1000.0
    return max_km


def point_in_polygon(pt_lon, pt_lat, polygon):
    """
    Standard ray-casting point-in-polygon test.
    Cast a ray to the right (+x/lon), count edge crossings.
    Returns True if point is inside the polygon.
    """
    x, y = pt_lon, pt_lat
    n = len(polygon)
    inside = False

    j = n - 1
    for i in range(n):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]

        # Check if edge crosses the horizontal ray at y
        if ((yi > y) != (yj > y)):
            x_intersect = xi + (y - yi) * (xj - xi) / (yj - yi)
            if x < x_intersect:
                inside = not inside
        j = i

    return inside


def shoreline_normal(seg_start, seg_end):
    """Compute outward-pointing normal of a shoreline segment."""
    dx = seg_end[0] - seg_start[0]  # lon
    dy = seg_end[1] - seg_start[1]  # lat
    length = math.sqrt(dx * dx + dy * dy)
    if length < 1e-12:
        return (0.0, 0.0)
    nx = -dy / length  # left normal
    ny = dx / length
    return (nx, ny)


def point_to_segment_distance_m(lon, lat, seg_start_lon, seg_start_lat, seg_end_lon, seg_end_lat):
    """
    Compute the shortest distance in meters from a point to a line segment.
    Uses an approximate local Cartesian projection at the given latitude.
    """
    km_per_deg_lon = 111.32 * math.cos(math.radians(lat))
    km_per_deg_lat = 111.32

    ax = seg_start_lon * km_per_deg_lon
    ay = seg_start_lat * km_per_deg_lat
    bx = seg_end_lon * km_per_deg_lon
    by = seg_end_lat * km_per_deg_lat
    px = lon * km_per_deg_lon
    py = lat * km_per_deg_lat

    dx = bx - ax
    dy = by - ay

    if abs(dx) < 1e-12 and abs(dy) < 1e-12:
        # Degenerate segment — just distance to point
        dist_km = math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
        return dist_km * 1000.0

    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))

    proj_x = ax + t * dx
    proj_y = ay + t * dy

    dist_km = math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)
    return dist_km * 1000.0


def nearest_shore_info(lon, lat, polygon):
    """
    Find the shortest distance (in meters) from a point to the shoreline
    polygon, and the direction (degrees) of the water-facing normal at
    that nearest segment.

    Returns (distance_m, water_normal_deg).
    water_normal_deg is the bearing pointing *from shore toward water*.
    If the point is far from shore (> FETCH_CAP_KM), returns (float('inf'), 0).
    """
    min_dist_m = float('inf')
    best_water_normal_deg = 0.0
    best_seg_start = None
    best_seg_end = None

    n = len(polygon)
    for i in range(n - 1):
        seg_start = polygon[i]
        seg_end = polygon[i + 1]

        dist_m = point_to_segment_distance_m(
            lon, lat, seg_start[0], seg_start[1], seg_end[0], seg_end[1]
        )

        if dist_m < min_dist_m:
            min_dist_m = dist_m
            best_seg_start = seg_start
            best_seg_end = seg_end

    if min_dist_m == float('inf') or best_seg_start is None:
        return float('inf'), 0.0

    # Compute lake centroid for determining water-facing normal direction
    centroid_lon = sum(p[0] for p in polygon) / len(polygon)
    centroid_lat = sum(p[1] for p in polygon) / len(polygon)

    # Segment midpoint
    mid_lon = (best_seg_start[0] + best_seg_end[0]) / 2.0
    mid_lat = (best_seg_start[1] + best_seg_end[1]) / 2.0

    # Get the perpendicular normal (left normal in lat/lon space)
    dx = best_seg_end[0] - best_seg_start[0]
    dy = best_seg_end[1] - best_seg_start[1]
    length = math.sqrt(dx * dx + dy * dy)
    if length < 1e-12:
        return min_dist_m, 0.0

    # Two candidate normals: (nx, ny) and (-nx, -ny)
    nx = -dy / length
    ny = dx / length

    # Vector from segment midpoint toward lake centroid
    to_center_lon = centroid_lon - mid_lon
    to_center_lat = centroid_lat - mid_lat

    # Dot product with normal: positive = normal faces lake center
    dot_normal = nx * to_center_lon + ny * to_center_lat
    if dot_normal < 0:
        nx, ny = -nx, -ny  # flip to face water

    # Convert the (lon, lat) unit vector to a bearing in degrees
    # Bearing: 0° = North, 90° = East
    # Vector (nx, ny) is in (lon, lat) space where nx ~ east, ny ~ north
    bearing = math.degrees(math.atan2(nx, ny))
    if bearing < 0:
        bearing += 360.0

    return min_dist_m, bearing


def wind_vector(direction_deg):
    """Convert wind direction to a unit vector pointing WHERE wind is GOING.
    Wind direction convention: 0° = from North, 90° = from East.
    Wind GOES toward: direction_deg + 180 (mod 360)."""
    goes_deg = (direction_deg + 180) % 360
    rad = math.radians(goes_deg)
    return (math.sin(rad), math.cos(rad))  # (lon, lat) — x is east ≈ lon


def wave_height_simplified(wind_speed_ms, fetch_km):
    """
    Simplified wave height estimation.
    H = 0.017 * wind_speed_ms * sqrt(fetch_m)
    """
    if wind_speed_ms < 0.5 or fetch_km <= 0:
        return 0.0
    fetch_m = fetch_km * 1000.0
    return 0.017 * wind_speed_ms * math.sqrt(fetch_m)


def compute_shield_factor(distance_m, water_normal_deg, wind_dir_deg, nlcd_reduction=0.80):
    """
    Compute wind speed reduction factor due to tree-line shielding.

    Now incorporates NLCD land cover data: the base shielding at the shore
    depends on what's growing on the shoreline (forest = strong, grass = weak).

    When wind blows from land toward water (onshore), trees and terrain
    near the shore shield the first SHIELD_DISTANCE_M meters of water.

    Args:
        distance_m: Distance from cell to nearest shoreline (meters)
        water_normal_deg: Bearing of water-facing shore normal
        wind_dir_deg: Wind direction in degrees (meteorological: FROM)
        nlcd_reduction: NLCD wind reduction coefficient (0.0=water, 0.80=dense forest)

    Returns:
        shield_factor: shore_shield (1.0 - nlcd_reduction) at shore,
                       ramping to 1.0 (no shielding) at SHIELD_DISTANCE_M
    """
    if distance_m >= SHIELD_DISTANCE_M:
        return 1.0

    # Wind TO direction: where wind is going
    wind_to_deg = (wind_dir_deg + 180.0) % 360.0

    # Dot product between wind-to and water-normal:
    # positive = wind blows from shore toward water (onshore)
    diff = abs(wind_to_deg - water_normal_deg)
    if diff > 180.0:
        diff = 360.0 - diff

    # If wind is blowing within 90° of the water-facing normal,
    # it's onshore and trees shield the water
    if diff < 90.0:
        shore_shield = 1.0 - nlcd_reduction
        return shore_shield + (1.0 - shore_shield) * (distance_m / SHIELD_DISTANCE_M)

    return 1.0


def wave_height_smb(wind_speed_ms, fetch_m, depth_m=NEAR_SHORE_DEPTH_M):
    """
    SMB method for wave height estimation.
    H = 0.283 * tanh(A) * tanh(B / tanh(A)) * (U²/g)
    where A = 0.530 * (g*d/U²)^0.75
          B = 0.0125 * (g*F/U²)^0.42
    """
    U = wind_speed_ms
    if U < 0.5:
        return 0.0

    g = G
    F = fetch_m
    d = depth_m

    gd_over_U2 = g * d / (U * U)
    gF_over_U2 = g * F / (U * U)

    A = 0.530 * (gd_over_U2) ** 0.75
    B = 0.0125 * (gF_over_U2) ** 0.42

    tanh_A = math.tanh(A)
    H = 0.283 * tanh_A * math.tanh(B / tanh_A) * (U * U / g)

    return H


# ── 4. Compute Shoreline Segments ──────────────────────────────────────────

def compute_shoreline(polygon, wind_hourly):
    """Compute fetch, wave height, and impact for each shoreline segment."""
    wind = wind_hourly[0]
    wind_speed = wind["speed_ms"]
    wind_dir = wind["direction_deg"]

    # Wind comes FROM wind_dir, so the fetch ray goes FROM wind_dir
    fetch_direction = wind_dir

    n_verts = len(polygon)
    segments = []

    for i in range(0, n_verts - 1, SAMPLING_STEP):
        j = i + 1
        if j >= n_verts:
            j = 0

        p1 = polygon[i]
        p2 = polygon[j]

        # Midpoint of the segment in [lon, lat]
        mid_lon = (p1[0] + p2[0]) / 2.0
        mid_lat = (p1[1] + p2[1]) / 2.0
        midpoint = [mid_lon, mid_lat]

        # Compute fetch distance by casting ray FROM midpoint in wind direction
        fetch_km = ray_polygon_intersection(
            midpoint, fetch_direction, polygon
        )

        # Wave height (simplified formula)
        wave_h = wave_height_simplified(wind_speed, fetch_km)

        # Shore normal (outward) and wind vector (where wind goes)
        normal = shoreline_normal(p1, p2)
        wind_vec = wind_vector(wind_dir)

        # Dot product: positive means wind blows toward the shore
        dot = normal[0] * wind_vec[0] + normal[1] * wind_vec[1]

        # Impact score: normalize fetch to [0,1], scale by dot product
        normalized_fetch = min(fetch_km / FETCH_CAP_KM, 1.0)
        impact_score = max(0.0, dot) * normalized_fetch
        impact_score = min(impact_score, 1.0)

        # Calm area: fetch < 200m OR wind shielded (dot < 0)
        is_calm = fetch_km < 0.2 or dot <= 0

        # Sample NLCD land cover at the shoreline midpoint
        nlcd_class, nlcd_name = sample_nlcd(midpoint[1], midpoint[0])
        nlcd_reduction = NLCD_COEFFICIENTS.get(nlcd_class, 0.50) if nlcd_class else 0.50
        time.sleep(0.1)  # rate-limit WMS queries

        segments.append({
            "segment": [p1, p2],
            "midpoint": midpoint,
            "fetch_km": round(fetch_km, 3),
            "wave_height_m": round(wave_h, 3),
            "impact_score": round(impact_score, 3),
            "is_calm": is_calm,
            "wind_speed_ms": wind_speed,
            "wind_direction_deg": wind_dir,
            "nlcd_class": nlcd_class,
            "nlcd_class_name": nlcd_name,
            "nlcd_reduction": round(nlcd_reduction, 3),
        })

    return segments


# ── 5. Compute Grid Heatmap ────────────────────────────────────────────────

def compute_grid(polygon, wind_dir, wind_speed_ms, shoreline):
    """
    Create a grid of sample points across the lake bounding box,
    filter to points inside the polygon, and compute fetch/wave/impact
    for each cell.

    Also applies NLCD land-cover-aware wind shielding: cells within
    SHIELD_DISTANCE_M of shore with onshore wind get reduced effective
    wind speed based on the land cover type at the nearest shoreline.
    """
    # Compute bounding box
    lons = [p[0] for p in polygon]
    lats = [p[1] for p in polygon]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)

    print(f"  Lake bounding box: lon [{min_lon:.6f}, {max_lon:.6f}], lat [{min_lat:.6f}, {max_lat:.6f}]")

    # Generate grid points
    grid_cells = []
    candidate_count = 0
    inside_count = 0
    shield_stats = {"count": 0, "factors": []}

    lat = min_lat
    while lat <= max_lat:
        lon = min_lon
        while lon <= max_lon:
            candidate_count += 1
            if point_in_polygon(lon, lat, polygon):
                inside_count += 1

                shore_dist_m, shore_normal_deg = nearest_shore_info(lon, lat, polygon)

                # Find nearest shoreline segment for NLCD land cover data
                nearest_seg = None
                nearest_seg_dist = float('inf')
                for seg in shoreline:
                    seg_mid = seg["midpoint"]
                    km_per_deg_lon = 111.32 * math.cos(math.radians(lat))
                    km_per_deg_lat = 111.32
                    dx = (seg_mid[0] - lon) * km_per_deg_lon * 1000.0
                    dy = (seg_mid[1] - lat) * km_per_deg_lat * 1000.0
                    d = math.sqrt(dx * dx + dy * dy)
                    if d < nearest_seg_dist:
                        nearest_seg_dist = d
                        nearest_seg = seg
                nlcd_red = nearest_seg.get("nlcd_reduction", 0.50) if nearest_seg else 0.50

                # Compute fetch in the wind-from direction
                fetch_km = ray_polygon_intersection(
                    [lon, lat], wind_dir, polygon, max_km=FETCH_CAP_KM
                )

                # ── Tree-line wind shielding ──
                shield_factor = compute_shield_factor(
                    shore_dist_m, shore_normal_deg, wind_dir,
                    nlcd_reduction=nlcd_red
                )
                effective_wind_speed = wind_speed_ms * shield_factor

                if shield_factor < 1.0:
                    shield_stats["count"] += 1
                    shield_stats["factors"].append(shield_factor)

                # Wave height via simplified formula (using effective wind)
                wave_h = wave_height_simplified(effective_wind_speed, fetch_km)

                # Impact score: fetch normalized by cap × wind speed factor
                wind_factor = effective_wind_speed / 7.82
                impact_score = min(fetch_km / GRID_FETCH_CAP_KM, 1.0) * wind_factor

                grid_cells.append({
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "fetch_km": round(fetch_km, 3),
                    "wave_height_m": round(wave_h, 3),
                    "impact_score": round(impact_score, 3),
                    "shore_distance_m": round(shore_dist_m, 1),
                    "shore_normal_deg": round(shore_normal_deg, 1),
                    "shield_factor": round(shield_factor, 3),
                    "nlcd_class": nearest_seg.get("nlcd_class") if nearest_seg else None,
                    "nlcd_class_name": nearest_seg.get("nlcd_class_name") if nearest_seg else None,
                    "nlcd_reduction": round(nlcd_red, 3),
                })
            lon += GRID_SPACING_DEG
        lat += GRID_SPACING_DEG

    print(f"  Grid: {candidate_count} candidates, {inside_count} inside lake, {len(grid_cells)} cells generated")

    # Print shielding stats
    if shield_stats["count"] > 0:
        factors = shield_stats["factors"]
        print(f"  Shielded cells: {shield_stats['count']}/{len(grid_cells)}")
        print(f"  Shield factor range: min={min(factors):.3f}, max={max(factors):.3f}, mean={sum(factors)/len(factors):.3f}")
    else:
        print(f"  Shielded cells: 0/{len(grid_cells)} (no onshore wind or all cells > {SHIELD_DISTANCE_M}m from shore)")

    return grid_cells


# ── 6. Main ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Blue Lake Wave-Fetch Compute Engine")
    parser.add_argument("--output", type=str, default=OUTPUT_PATH,
                        help=f"Output JSON path (default: {OUTPUT_PATH})")
    args = parser.parse_args()

    print("Parsing KML...")
    polygon = parse_kml(KML_PATH)
    print(f"  Extracted {len(polygon)} polygon vertices")

    print("Fetching wind data from Open-Meteo...")
    try:
        wind_hourly = fetch_wind_data(LAKE_CENTER_LAT, LAKE_CENTER_LON)
        print(f"  Got {len(wind_hourly)} hourly forecast points")
        print(f"  Current wind: {wind_hourly[0]['speed_ms']} m/s from {wind_hourly[0]['direction_deg']}°")
    except (urllib.error.URLError, OSError) as e:
        print(f"ERROR: Open-Meteo API failed: {e}", file=sys.stderr)
        sys.exit(1)

    # Use first wind entry for computation
    wind = wind_hourly[0]
    wind_dir = wind["direction_deg"]
    wind_speed_ms = wind["speed_ms"]

    print("Computing shoreline fetch and impact...")
    shoreline = compute_shoreline(polygon, wind_hourly)

    print("Computing grid heatmap...")
    grid_cells = compute_grid(polygon, wind_dir, wind_speed_ms, shoreline)

    # Build output
    output = {
        "lake": {
            "name": LAKE_NAME,
            "polygon": polygon,
        },
        "wind": {
            "source": "Open-Meteo",
            "hourly": wind_hourly,
        },
        "shoreline": shoreline,
        "grid": grid_cells,
    }

    output_path = args.output
    output_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(output_dir, exist_ok=True)

    print(f"Writing output to {output_path}...")
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Done. Output written to {output_path}")
    print(f"  Shoreline segments: {len(shoreline)}")
    print(f"  Grid cells: {len(grid_cells)}")

    # ── Fetch statistics ──
    print("\n📊 Fetch Statistics:")
    if grid_cells:
        fetches = [g["fetch_km"] for g in grid_cells]
        print(f"  Grid fetch: min={min(fetches):.3f} km, max={max(fetches):.3f} km, "
              f"mean={sum(fetches)/len(fetches):.3f} km")

    if shoreline:
        shore_fetches = [s["fetch_km"] for s in shoreline]
        capped = sum(1 for f in shore_fetches if f >= (FETCH_CAP_KM - 0.01))
        print(f"  Shoreline fetch: min={min(shore_fetches):.3f} km, max={max(shore_fetches):.3f} km, "
              f"mean={sum(shore_fetches)/len(shore_fetches):.3f} km, capped={capped}/{len(shoreline)}")

    # Quick validation
    calm_count = sum(1 for s in shoreline if s["is_calm"])
    impacted_count = sum(1 for s in shoreline if s["impact_score"] > 0.3)
    print(f"  Calm segments: {calm_count}/{len(shoreline)}")
    print(f"  Impacted segments (score > 0.3): {impacted_count}/{len(shoreline)}")
    if shoreline:
        print(f"  Max shoreline wave height: {max(s['wave_height_m'] for s in shoreline):.3f} m")
        print(f"  Max shoreline fetch: {max(s['fetch_km'] for s in shoreline):.3f} km")

    if grid_cells:
        high = sum(1 for g in grid_cells if g["impact_score"] > 0.6)
        med = sum(1 for g in grid_cells if 0.3 < g["impact_score"] <= 0.6)
        low = sum(1 for g in grid_cells if 0.1 < g["impact_score"] <= 0.3)
        calm = sum(1 for g in grid_cells if g["impact_score"] <= 0.1)
        print(f"  Grid heatmap: {high} high, {med} medium, {low} low, {calm} calm")
        print(f"  Max grid wave height: {max(g['wave_height_m'] for g in grid_cells):.3f} m")
        print(f"  Max grid fetch: {max(g['fetch_km'] for g in grid_cells):.3f} km")


if __name__ == "__main__":
    main()
