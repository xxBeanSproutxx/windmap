#!/usr/bin/env python3
"""
Batch builder for all lake static data.

Finds all .kml files in data/kml/, runs the compute engine in --static mode
for each, then generates a manifest.json with per-lake metadata.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

# ── Lake name mapping ─────────────────────────────────────────────────────
LAKE_NAMES = {
    "blue_lake": "Blue Lake",
    "spectacle": "Spectacle Lake",
    "71004000": "Sandy Lake",
    "71006900": "Ann Lake",
}

PROJECT_ROOT = Path(__file__).resolve().parent.parent
KML_DIR = PROJECT_ROOT / "data" / "kml"
LAKES_DIR = PROJECT_ROOT / "data" / "lakes"
ENGINE_SCRIPT = PROJECT_ROOT / "engine" / "compute_engine.py"


def get_lake_name(lake_id):
    """Resolve display name for a lake ID."""
    return LAKE_NAMES.get(lake_id, lake_id.replace("_", " ").title())


def compute_centroid(polygon):
    """Compute centroid (lon, lat) from polygon vertices, rounded to 4 decimal places."""
    cx = sum(p[0] for p in polygon) / len(polygon)
    cy = sum(p[1] for p in polygon) / len(polygon)
    return round(cx, 4), round(cy, 4)


def run_engine(lake_id, name, kml_path, output_path):
    """Run the compute engine for a single lake in --static mode."""
    cmd = [
        sys.executable,
        str(ENGINE_SCRIPT),
        "--static",
        "--kml", str(kml_path),
        "--name", name,
        "--lake-id", lake_id,
        "--output", str(output_path),
    ]
    print(f"\n{'='*60}")
    print(f"  Building: {name} ({lake_id})")
    print(f"  KML: {kml_path}")
    print(f"  Output: {output_path}")
    print(f"{'='*60}")
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT), capture_output=False)
    if result.returncode != 0:
        print(f"  ERROR: Engine failed with exit code {result.returncode}", file=sys.stderr)
        return False
    return True


def read_centroid_from_static(static_path):
    """Read the lake_static.json and compute centroid from polygon."""
    with open(static_path, "r") as f:
        data = json.load(f)
    polygon = data["lake"]["polygon"]
    return compute_centroid(polygon)


def main():
    # Discover KML files
    kml_files = sorted(KML_DIR.glob("*.kml"))
    if not kml_files:
        print(f"No .kml files found in {KML_DIR}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(kml_files)} KML file(s) in {KML_DIR}")
    for kf in kml_files:
        print(f"  - {kf.name}")

    # Ensure lakes output directory exists
    LAKES_DIR.mkdir(parents=True, exist_ok=True)

    # Build each lake
    manifest = []
    success_count = 0

    for kml_path in kml_files:
        lake_id = kml_path.stem  # filename without .kml
        name = get_lake_name(lake_id)
        output_path = LAKES_DIR / lake_id / "lake_static.json"

        ok = run_engine(lake_id, name, kml_path, output_path)
        if not ok:
            print(f"  Skipping {lake_id} — engine failed", file=sys.stderr)
            continue

        # Read back the generated static data to compute centroid
        try:
            center_lon, center_lat = read_centroid_from_static(output_path)
        except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
            print(f"  WARNING: Could not read centroid from {output_path}: {e}")
            center_lon, center_lat = None, None

        manifest.append({
            "id": lake_id,
            "name": name,
            "center_lat": center_lat,
            "center_lon": center_lon,
        })
        success_count += 1
        print(f"  ✓ {name}: centroid ({center_lat}, {center_lon})")

    # Write manifest
    manifest_path = LAKES_DIR / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n{'='*60}")
    print(f"Manifest written to {manifest_path}")
    print(f"{success_count}/{len(kml_files)} lakes built successfully")


if __name__ == "__main__":
    main()
