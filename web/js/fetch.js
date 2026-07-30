// fetch.js — Directional fetch, shield, and impact computation for Blue Lake Wave
'use strict';

// ── Directional fetch ──
// Ray-cast from (lat,lon) in windDirDeg direction to polygon boundary,
// returning closest edge distance in km.
// windDirDeg = direction wind is coming FROM (meteorological convention).
// polygon = array of [lon, lat] pairs.
function computeDirectionalFetch(lat, lon, windDirDeg, polygon) {
  if (!polygon || polygon.length < 3) return FETCH_CAP_KM;

  const rad = windDirDeg * Math.PI / 180;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(lat * Math.PI / 180);

  const rdx = Math.sin(rad);
  const rdy = Math.cos(rad);

  let minDistKm = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const x1 = (polygon[i][0] - lon) * kmPerDegLon;
    const y1 = (polygon[i][1] - lat) * kmPerDegLat;
    const x2 = (polygon[j][0] - lon) * kmPerDegLon;
    const y2 = (polygon[j][1] - lat) * kmPerDegLat;

    const sx = x2 - x1;
    const sy = y2 - y1;

    const denom = rdx * sy - rdy * sx;
    if (Math.abs(denom) < 1e-12) continue;

    const t = (x1 * sy - y1 * sx) / denom;
    const u = (x1 * rdy - y1 * rdx) / denom;

    if (t > 0 && u >= 0 && u <= 1) {
      if (t < minDistKm) minDistKm = t;
    }
  }

  return minDistKm < Infinity ? minDistKm : FETCH_CAP_KM;
}

// ── Shield factor (mirrors Python compute_shield_factor) ──
function computeShieldFactor(distanceM, waterNormalDeg, windDirDeg, nlcdReduction) {
  if (distanceM == null || distanceM >= SHIELD_DISTANCE_M) return 1.0;

  const windToDeg = (windDirDeg + 180) % 360;
  let diff = Math.abs(windToDeg - waterNormalDeg);
  if (diff > 180) diff = 360 - diff;

  if (diff < 90) {
    const shoreShield = 1.0 - (nlcdReduction != null ? nlcdReduction : 0.5);
    return shoreShield + (1.0 - shoreShield) * (distanceM / SHIELD_DISTANCE_M);
  }
  return 1.0;
}

// ── Per-cell impact score (mirrors Python compute_grid) ──
function cellImpact(cell, windSpeedMs, windDirDeg, polygon) {
  const shieldFactor = computeShieldFactor(
    cell.shore_distance_m, cell.shore_normal_deg, windDirDeg,
    cell.nlcd_reduction != null ? cell.nlcd_reduction : 0.5
  );
  const effectiveWind = windSpeedMs * shieldFactor;
  const windFactor = effectiveWind / 7.82;
  const fetchKm = computeDirectionalFetch(cell.lat, cell.lon, windDirDeg, polygon);
  return Math.min(fetchKm / GRID_FETCH_CAP_KM, 1.0) * windFactor;
}

// ── Aggregate impact from grid cells ──
function computeAggregateImpact(gridCells, windSpeedMs, windDirDeg, polygon) {
  if (!gridCells || gridCells.length === 0) return { highPct: 0, avgImpact: 0, coverPct: 0 };

  let highCount = 0;
  let totalImpact = 0;

  for (const cell of gridCells) {
    const impact = cellImpact(cell, windSpeedMs, windDirDeg, polygon);
    totalImpact += impact;
    if (impact >= HIGH_IMPACT_THRESHOLD) highCount++;
  }

  return {
    highPct: highCount / gridCells.length,
    avgImpact: totalImpact / gridCells.length,
    coverPct: highCount / gridCells.length
  };
}
