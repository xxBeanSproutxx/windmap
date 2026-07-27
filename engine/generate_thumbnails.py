#!/usr/bin/env python3
"""Generate small lake outline thumbnails from KML shoreline polygons.

Usage: python3 engine/generate_thumbnails.py
Output: data/lakes/<id>/thumb.png (300x200 PNG, retina-ready)
"""

import json, os, sys, xml.etree.ElementTree as ET

# Configure matplotlib before importing to avoid display issues
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
from matplotlib.path import Path
import numpy as np

KML_NS = 'http://www.opengis.net/kml/2.2'
THUMB_W, THUMB_H = 200, 300  # portrait — taller than wide for card sidebar
DPI = 72  # screen resolution — CSS will scale down

def parse_kml_coordinates(kml_path):
    """Extract polygon coordinates from a KML file. Returns list of (lon, lat)."""
    tree = ET.parse(kml_path)
    root = tree.getroot()
    
    # Find all coordinate strings
    coords_text = None
    for elem in root.iter(f'{{{KML_NS}}}coordinates'):
        coords_text = elem.text
        break
    
    if not coords_text:
        # Try without namespace
        for elem in root.iter('coordinates'):
            coords_text = elem.text
            break
    
    if not coords_text:
        raise ValueError(f"No coordinates found in {kml_path}")
    
    points = []
    for coord in coords_text.strip().split():
        parts = coord.split(',')
        if len(parts) >= 2:
            lon, lat = float(parts[0]), float(parts[1])
            points.append((lon, lat))
    
    return points


def render_thumbnail(points, out_path, lake_name=''):
    """Render a single lake outline as a thumbnail PNG."""
    # Convert to numpy array for bounds/transform
    pts = np.array(points)
    min_lon, min_lat = pts[:, 0].min(), pts[:, 1].min()
    max_lon, max_lat = pts[:, 0].max(), pts[:, 1].max()
    
    lon_range = max_lon - min_lon or 0.001
    lat_range = max_lat - min_lat or 0.001
    
    # Scale to fit with padding
    pad = 0.12
    fig, ax = plt.subplots(figsize=(THUMB_W/DPI, THUMB_H/DPI), dpi=DPI)
    
    # Light background matching card theme
    BG = '#e8edf2'
    LAKE_FILL = '#5b9bd5'
    LAKE_STROKE = '#3a7cc3'
    
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    
    # Scale coordinates to fill the canvas
    scaled_pts = []
    for lon, lat in points:
        x = (lon - min_lon) / lon_range
        y = (lat - min_lat) / lat_range
        # Add padding
        x = pad + x * (1 - 2*pad)
        y = pad + y * (1 - 2*pad)
        scaled_pts.append((x, y))
    
    path = Path(scaled_pts)
    patch = Polygon(scaled_pts, closed=True, 
                    facecolor=LAKE_FILL, edgecolor=LAKE_STROKE,
                    linewidth=1.8, alpha=0.9, zorder=2)
    ax.add_patch(patch)
    
    # Subtle glow effect — larger, more transparent outline
    glow = Polygon(scaled_pts, closed=True,
                   facecolor='none', edgecolor=LAKE_FILL,
                   linewidth=4, alpha=0.25, zorder=1)
    ax.add_patch(glow)
    
    # Clean axes
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_aspect('equal')
    ax.axis('off')
    
    plt.tight_layout(pad=0)
    fig.savefig(out_path, dpi=DPI, facecolor=BG, 
                edgecolor='none', bbox_inches='tight', pad_inches=0)
    plt.close(fig)
    
    # Verify file was created
    size = os.path.getsize(out_path)
    print(f"  {out_path} ({size} bytes)")
    return True

def main():
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(project_root, 'data')
    lakes_dir = os.path.join(data_dir, 'lakes')
    kml_dir = os.path.join(data_dir, 'kml')
    
    # Load manifest to get lake ID to name mapping
    manifest_path = os.path.join(lakes_dir, 'manifest.json')
    with open(manifest_path) as f:
        manifest = json.load(f)
    
    name_map = {lake['id']: lake['name'] for lake in manifest}
    
    print(f"Generating thumbnails for {len(manifest)} lakes...\n")
    
    for lake in manifest:
        lake_id = lake['id']
        kml_path = os.path.join(kml_dir, f'{lake_id}.kml')
        out_path = os.path.join(lakes_dir, lake_id, 'thumb.png')
        
        if not os.path.exists(kml_path):
            print(f"  SKIP {lake_id}: no KML found at {kml_path}")
            continue
        
        try:
            points = parse_kml_coordinates(kml_path)
            print(f"  {lake['name']} ({lake_id}): {len(points)} points", end='')
            render_thumbnail(points, out_path, lake['name'])
        except Exception as e:
            print(f"\n  FAIL {lake_id}: {e}")
    
    print(f"\nDone. Thumbnails in data/lakes/<id>/thumb.png")

if __name__ == '__main__':
    main()
