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
      const speedKmh = speedMap[utcIso];
      const dirDeg = dirMap[utcIso];

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

    // Apply station observation to the time slot closest to now
    // (not blindly to forecast[0], which getCurrentWind() may skip)
    if (stationSpeedKmh != null && stationSpeedKmh > 0) {
      const now = new Date();
      let closestIdx = 0;
      let closestDiff = Infinity;
      for (let i = 0; i < forecast.length; i++) {
        const d = Math.abs(new Date(forecast[i].timestamp + ':00') - now);
        if (d < closestDiff) { closestDiff = d; closestIdx = i; }
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

// Find the forecast entry closest to current time
function getCurrentWind(forecast) {
  const now = new Date();
  let best = forecast[0];
  let bestDiff = Infinity;
  for (const f of forecast) {
    const d = Math.abs(new Date(f.timestamp + ':00') - now);
    if (d < bestDiff) { bestDiff = d; best = f; }
  }
  return best;
}
