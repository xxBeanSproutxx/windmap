// shared.js — Wind computation for Blue Lake Wave
// Loaded by index.html (dashboard) and lake.html (map view)
// Canonical source for fetch, shield, and impact math.
'use strict';

// ── Constants ──
var FETCH_CAP_KM = 5.0;               // shoreline fetch cap (km)
var GRID_FETCH_CAP_KM = 1.0;          // grid cell fetch cap (km)
var SHIELD_DISTANCE_M = 100;          // distance for full shielding (m)
var HIGH_IMPACT_THRESHOLD = 0.45;     // threshold for "high impact" classification
var NWS_UA = 'blue-lake-wave/1.0';    // NWS API User-Agent header
var TIMEOUT_MS = 15000;               // API fetch timeout (ms)

// ── Color helper ──
function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

// ── Grid impact color (5-anchor continuous gradient) ──
function gridImpactColor(score) {
  const anchors = [
    { score: 0.00, rgb: [0x10, 0xb9, 0x81] },  // green  — LOW
    { score: 0.35, rgb: [0xea, 0xb3, 0x08] },  // yellow — MODERATE
    { score: 0.45, rgb: [0xf9, 0x73, 0x16] },  // orange — ELEVATED
    { score: 0.60, rgb: [0xef, 0x44, 0x44] },  // red    — HIGH
    { score: 0.80, rgb: [0xdb, 0x27, 0x77] }   // magenta — VERY HIGH
  ];
  if (score <= anchors[0].score) {
    const c = anchors[0].rgb;
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  if (score >= anchors[anchors.length - 1].score) {
    const c = anchors[anchors.length - 1].rgb;
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    if (score >= anchors[i].score && score <= anchors[i + 1].score) {
      const t = (score - anchors[i].score) / (anchors[i + 1].score - anchors[i].score);
      const lerp = lerpColor(anchors[i].rgb, anchors[i + 1].rgb, t);
      return '#' + lerp.map(v => v.toString(16).padStart(2, '0')).join('');
    }
  }
  return '#10b981';
}

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

// ── NWS wind fetch — returns FULL forecast array ──
async function fetchLakeWind(lat, lon) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const pointsUrl = 'https://api.weather.gov/points/' + lat.toFixed(4) + ',' + lon.toFixed(4);
    const pointsResp = await fetch(pointsUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': NWS_UA }
    });
    if (!pointsResp.ok) throw new Error('NWS points HTTP ' + pointsResp.status);

    const pointsData = await pointsResp.json();
    const gridpointUrl = pointsData.properties.forecast.replace('/forecast', '');
    const stationsUrl = pointsData.properties.observationStations;

    const gridResp = await fetch(gridpointUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': NWS_UA }
    });
    if (!gridResp.ok) throw new Error('NWS gridpoint HTTP ' + gridResp.status);

    const raw = await gridResp.json();
    const props = raw.properties;
    if (!props || !props.windSpeed || !props.windDirection) {
      throw new Error('NWS gridpoint missing wind data');
    }

    const parseTime = (vt) => vt.split('/')[0];
    const speedMap = {};
    for (const entry of props.windSpeed.values) {
      speedMap[parseTime(entry.validTime)] = entry.value;
    }
    const dirMap = {};
    for (const entry of props.windDirection.values) {
      dirMap[parseTime(entry.validTime)] = entry.value;
    }

    const times = Object.keys(speedMap).filter(t => t in dirMap).sort();
    if (times.length === 0) throw new Error('No overlapping wind speed+direction entries');

    // Station obs override for current hour
    let stationSpeedKmh = null;
    let stationDirDeg = null;

    if (stationsUrl) {
      try {
        const stationResp = await fetch(stationsUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': NWS_UA }
        });
        if (stationResp.ok) {
          const stationList = await stationResp.json();
          const stations = stationList.observationStations || [];
          if (stations.length > 0) {
            const obsResp = await fetch(stations[0] + '/observations/latest', {
              signal: controller.signal,
              headers: { 'User-Agent': NWS_UA }
            });
            if (obsResp.ok) {
              const sd = await obsResp.json();
              const sp = sd.properties;
              if (sp && sp.windSpeed && sp.windDirection) {
                stationSpeedKmh = sp.windSpeed.value;
                stationDirDeg = sp.windDirection.value;
              }
            }
          }
        }
      } catch (e) {
        console.warn('Station obs failed, using gridpoint:', e.message);
      }
    }

    const KMH_TO_MS = 1.0 / 3.6;
    const KMH_TO_MPH = 0.6214;
    const forecast = [];

    for (let i = 0; i < times.length; i++) {
      const utcIso = times[i];
      let speedKmh = speedMap[utcIso];
      let dirDeg = dirMap[utcIso];

      if (i === 0 && stationSpeedKmh != null && stationSpeedKmh > 0) {
        speedKmh = stationSpeedKmh;
        dirDeg = stationDirDeg;
      }

      // Convert UTC to local CDT (UTC-5)
      const localDt = new Date(utcIso);
      localDt.setHours(localDt.getHours() - 5);
      const timeStr = localDt.toISOString().slice(0, 16);

      forecast.push({
        timestamp: timeStr,
        speed_ms: Math.round(speedKmh * KMH_TO_MS * 100) / 100,
        speed_mph: Math.round(speedKmh * KMH_TO_MPH * 10) / 10,
        direction_deg: dirDeg,
        gust_mph: null
      });
    }

    return forecast;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
