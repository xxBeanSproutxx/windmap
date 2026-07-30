#!/usr/bin/env python3
"""Convert KML lake shoreline polygons to GeoJSON FeatureCollection files.

Usage: python3 engine/kml_to_geojson.py
Output: data/lakes/<lake_id>/outline.geojson (one per lake)
"""

import json, os, sys, xml.etree.ElementTree as ET

KML_NS = 'http://www.opengis.net/kml/2.2'


def parse_kml_coordinates(kml_path):
    """Extract lake basin polygon coordinates from a KML file.

    The KML structure is:
      Folder (MNDNR LakeFinder)
        Folder (Minnesota Lake Basins)
          Placemark (styleUrl="#lakeStyle")
            MultiGeometry
              LineString (the lake shoreline)

    Returns list of (lon, lat) tuples.
    """
    tree = ET.parse(kml_path)
    root = tree.getroot()

    # Find all Placemark elements
    for placemark in root.iter(f'{{{KML_NS}}}Placemark'):
        style_url = placemark.find(f'{{{KML_NS}}}styleUrl')
        if style_url is not None and style_url.text == '#lakeStyle':
            # This is the lake basin Placemark — extract coordinates
            for coords_elem in placemark.iter(f'{{{KML_NS}}}coordinates'):
                coords_text = coords_elem.text
                if coords_text:
                    points = []
                    for coord in coords_text.strip().split():
                        parts = coord.split(',')
                        if len(parts) >= 2:
                            lon, lat = float(parts[0]), float(parts[1])
                            points.append((lon, lat))
                    if points:
                        return points

    raise ValueError(f"No lake basin coordinates found in {kml_path}")


def coords_to_geojson(points):
    """Convert list of (lon, lat) to a GeoJSON FeatureCollection with a Polygon."""
    # GeoJSON uses [lon, lat] (same as KML), and Polygon ring must be closed
    ring = [[lon, lat] for lon, lat in points]
    # Ensure the ring is closed
    if ring[0] != ring[-1]:
        ring.append(ring[0][:])

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [ring]
                },
                "properties": {}
            }
        ]
    }


def main():
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(project_root, 'data')
    lakes_dir = os.path.join(data_dir, 'lakes')
    kml_dir = os.path.join(data_dir, 'kml')

    # Load manifest
    manifest_path = os.path.join(lakes_dir, 'manifest.json')
    with open(manifest_path) as f:
        manifest = json.load(f)

    print(f"Converting KML to GeoJSON for {len(manifest)} lakes...\n")

    for lake in manifest:
        lake_id = lake['id']
        kml_path = os.path.join(kml_dir, f'{lake_id}.kml')
        out_dir = os.path.join(lakes_dir, lake_id)
        out_path = os.path.join(out_dir, 'outline.geojson')

        # Ensure output directory exists
        os.makedirs(out_dir, exist_ok=True)

        if not os.path.exists(kml_path):
            print(f"  SKIP {lake_id}: no KML found at {kml_path}")
            continue

        try:
            points = parse_kml_coordinates(kml_path)
            geojson = coords_to_geojson(points)
            with open(out_path, 'w') as f:
                json.dump(geojson, f, separators=(',', ':'))
            size = os.path.getsize(out_path)
            print(f"  {lake['name']} ({lake_id}): {len(points)} points → {out_path} ({size} bytes)")
        except Exception as e:
            print(f"  FAIL {lake_id}: {e}")

    print(f"\nDone. GeoJSON files in data/lakes/<id>/outline.geojson")


if __name__ == '__main__':
    main()
