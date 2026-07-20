"""Tests for the Blue Lake wave-fetch compute engine.

Run with: python3 -m pytest tests/ -v
Or:        python3 -m unittest tests/test_compute_engine.py
"""

import sys
import os

# Ensure we can import from engine/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))

from compute_engine import (
    wave_height_simplified,
    compute_shield_factor,
    point_in_polygon,
    NLCD_COEFFICIENTS,
)


# ── wave_height_simplified tests ────────────────────────────────────────────

def test_wave_height_calm():
    """Zero wind = zero waves."""
    assert wave_height_simplified(0.0, 1.0) == 0.0


def test_wave_height_below_threshold():
    """Wind below 0.5 m/s = zero waves."""
    assert wave_height_simplified(0.4, 1.0) == 0.0


def test_wave_height_known_value():
    """5 m/s wind over 500m fetch — verify against hand calculation.
    H = 0.017 * 5.0 * sqrt(500) = 0.017 * 5 * 22.36 ≈ 1.90m
    """
    h = wave_height_simplified(5.0, 0.5)  # 500m = 0.5km
    assert abs(h - 1.90) < 0.01


# ── NLCD_COEFFICIENTS tests ─────────────────────────────────────────────────

def test_open_water_no_reduction():
    """Open water (class 11) has no wind reduction."""
    assert NLCD_COEFFICIENTS[11] == 0.00


def test_forest_stronger_than_grass():
    """Deciduous forest (41) should have higher reduction than grassland (71)."""
    assert NLCD_COEFFICIENTS[41] > NLCD_COEFFICIENTS[71]


# ── compute_shield_factor tests ─────────────────────────────────────────────

def test_shield_at_shore_with_forest():
    """At distance=0 with forest (nlcd_reduction=0.75), shield ≈ 0.25.
    shore_shield = 1.0 - 0.75 = 0.25, at distance 0 → 0.25 + 0.75*(0/100) = 0.25
    """
    sf = compute_shield_factor(0.0, 0.0, 180.0, nlcd_reduction=0.75)
    assert abs(sf - 0.25) < 0.01


def test_shield_at_100m_no_shielding():
    """At distance=100m, shield factor = 1.0 regardless of cover."""
    sf = compute_shield_factor(100.0, 0.0, 180.0, nlcd_reduction=0.75)
    assert sf == 1.0


def test_no_shielding_offshore_wind():
    """Wind blowing offshore = no shielding.
    wind_dir=0° (FROM north → TO south/180°), water_normal=0° → diff=180° → offshore
    """
    sf = compute_shield_factor(10.0, 0.0, 0.0, nlcd_reduction=0.75)
    assert sf == 1.0


# ── point_in_polygon tests ──────────────────────────────────────────────────

def test_point_inside_square():
    """Point (5,5) is inside a 0→10 square."""
    square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    assert point_in_polygon(5, 5, square) is True


def test_point_outside_square():
    """Point (15,15) is outside a 0→10 square."""
    square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    assert point_in_polygon(15, 15, square) is False
