#!/usr/bin/env python3
"""Parse MN DNR KML for Blue Lake and write lakes/blue-lake.json."""
import json, os, xml.etree.ElementTree as ET

NS = {'kml': 'http://www.opengis.net/kml/2.2'}
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)

tree = ET.parse(os.path.join(ROOT, 'blue_lake.kml'))

# Parse outline — KML coordinates are "lon,lat,Z" space-separated
coords_text = tree.find('.//kml:LineString/kml:coordinates', NS).text.strip()
outline = []
for token in coords_text.split():
    parts = token.split(',')
    outline.append([float(parts[0]), float(parts[1])])  # [lon, lat], ignore Z (E4)

# Keep all 1228 points — closing duplicate matches first, SVG path handles it

# Centroid from outline [lat, lon] for the JSON
center_lat = sum(p[1] for p in outline) / len(outline)
center_lon = sum(p[0] for p in outline) / len(outline)

# Parse boat launches from Water Access Sites folder
launches = []
for pm in tree.findall('.//kml:Placemark[kml:Point]', NS):
    name_el = pm.find('kml:name', NS)
    coords_el = pm.find('kml:Point/kml:coordinates', NS)
    if name_el is not None and coords_el is not None:
        lon_str, lat_str = coords_el.text.strip().split(',')[:2]
        name = name_el.text
        # Shorten name for display
        short = name.replace('Blue Lake (', '').replace(') Public Water Access Site', ' Public Access')
        launches.append({"name": short, "lat": float(lat_str), "lon": float(lon_str)})

lake = {
    "id": "30010700",
    "name": "Blue Lake",
    "location": "Zimmerman, MN",
    "center": [round(center_lat, 6), round(center_lon, 6)],
    "outline": outline,
    "boat_launches": launches
}

out_path = os.path.join(ROOT, 'lakes', 'blue-lake.json')
with open(out_path, 'w') as f:
    json.dump(lake, f, indent=2)

print(f'Wrote {out_path}')
print(f'  outline points: {len(outline)}')
print(f'  center: [{center_lat:.6f}, {center_lon:.6f}]')
print(f'  launches: {len(launches)}')
for l in launches:
    print(f'    {l["name"]}: {l["lat"]}, {l["lon"]}')
