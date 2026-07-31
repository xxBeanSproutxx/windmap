// wind.js — NWS wind data fetch for Blue Lake Wave
'use strict';

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

    // NWS validTime format: "2026-07-31T15:00:00+00:00/PT3H"
    // The /PTnH part is a DURATION — the value holds for n hours. We must
    // expand each entry into every hour it covers, or we only match the
    // start-hours where speed and direction arrays coincide (36 of 178 slots)
    // and manufacture fake gaps (e.g. 9 PM -> 7 AM).
    const parseDurationHours = (vt) => {
      const durPart = vt.split('/')[1] || 'PT1H';
      const m = /PT(\d+(?:\.\d+)?)H/.exec(durPart);
      return m ? parseFloat(m[1]) : 1;
    };

    // Map from hour-start epoch (ms) -> value, expanded across durations
    const speedMap = {};
    for (const entry of props.windSpeed.values) {
      const startMs = Date.parse(entry.validTime.split('/')[0]);
      const durH = parseDurationHours(entry.validTime);
      for (let h = 0; h < Math.floor(durH); h++) {
        const hourStart = Math.floor((startMs + h * 3600000) / 3600000) * 3600000;
        speedMap[hourStart] = entry.value;
      }
    }
    const dirMap = {};
    for (const entry of props.windDirection.values) {
      const startMs = Date.parse(entry.validTime.split('/')[0]);
      const durH = parseDurationHours(entry.validTime);
      for (let h = 0; h < Math.floor(durH); h++) {
        const hourStart = Math.floor((startMs + h * 3600000) / 3600000) * 3600000;
        dirMap[hourStart] = entry.value;
      }
    }

    const hourKeys = Object.keys(speedMap)
      .filter(k => k in dirMap)
      .sort((a, b) => Number(a) - Number(b));
    if (hourKeys.length === 0) throw new Error('No overlapping wind speed+direction entries');

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

    for (let i = 0; i < hourKeys.length; i++) {
      const hourStartMs = Number(hourKeys[i]);
      const utcIso = new Date(hourStartMs).toISOString();
      const speedKmh = speedMap[hourStartMs];
      const dirDeg = dirMap[hourStartMs];

      forecast.push({
        timestamp_utc: utcIso,             // raw NWS UTC ISO (e.g. 2026-07-31T22:00:00+00:00)
        timestamp_ms: Date.parse(utcIso),  // epoch ms — single source of truth for comparisons
        speed_ms: Math.round(speedKmh * KMH_TO_MS * 100) / 100,
        speed_mph: Math.round(speedKmh * KMH_TO_MPH * 10) / 10,
        direction_deg: dirDeg,
        gust_mph: null
      });
    }

    // Bulletproof chronological order — never trust string sort with mixed formats
    forecast.sort((a, b) => a.timestamp_ms - b.timestamp_ms);

    // Apply station observation to the time slot closest to now
    // (not blindly to forecast[0], which getCurrentWind() may skip)
    if (stationSpeedKmh != null && stationSpeedKmh > 0) {
      const now = Date.now();
      let closestIdx = 0;
      let closestDiff = Infinity;
      for (let i = 0; i < forecast.length; i++) {
        const d = Math.abs(forecast[i].timestamp_ms - now);
        if (d <= closestDiff) { closestDiff = d; closestIdx = i; }
      }
      const entry = forecast[closestIdx];
      entry.speed_ms = Math.round(stationSpeedKmh * KMH_TO_MS * 100) / 100;
      entry.speed_mph = Math.round(stationSpeedKmh * KMH_TO_MPH * 10) / 10;
      entry.direction_deg = stationDirDeg;
    }

    return forecast;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Find the forecast entry closest to current time.
// Tie-break with <= so an exact tie picks the LATER (future) entry, not the past one.
function getCurrentWind(forecast) {
  const now = Date.now();
  let best = forecast[0];
  let bestDiff = Infinity;
  for (const f of forecast) {
    const d = Math.abs(f.timestamp_ms - now);
    if (d <= bestDiff) { bestDiff = d; best = f; }
  }
  return best;
}
