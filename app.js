const CACHE_KEY = 'windmap:nws:hourly:v1';
const CACHE_TTL_MS = 60 * 60 * 1000;

let lakeConfig = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const resp = await fetch('lakes/blue-lake.json');
    lakeConfig = await resp.json();
  } catch (e) {
    document.getElementById('map-card').innerHTML = '<p style="color:#999">Could not load lake data.</p>';
    return;
  }

  renderMap();
  await loadNWS();
}

function project(lon, lat, centerLon, centerLat) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
  return {
    x: (lon - centerLon) * mPerDegLon,
    y: -(lat - centerLat) * mPerDegLat
  };
}

function renderMap() {
  const { center, outline, boat_launches } = lakeConfig;

  const projected = outline.map(p => project(p[0], p[1], center[1], center[0]));
  const projectedLaunches = boat_launches.map(l => {
    const p = project(l.lon, l.lat, center[1], center[0]);
    return { ...l, x: p.x, y: p.y };
  });

  const xs = projected.map(p => p.x);
  const ys = projected.map(p => p.y);
  const M = 40;
  const minX = Math.min(...xs) - M;
  const minY = Math.min(...ys) - M;
  const maxX = Math.max(...xs) + M;
  const maxY = Math.max(...ys) + M;

  const svg = document.getElementById('map');
  svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);

  const d = projected.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#e8f1f8');
  path.setAttribute('stroke', '#93b6cf');
  path.setAttribute('stroke-width', '1.5');
  svg.appendChild(path);

  projectedLaunches.forEach(l => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', l.x.toFixed(2));
    c.setAttribute('cy', l.y.toFixed(2));
    c.setAttribute('r', '4');
    c.setAttribute('fill', '#1e6091');
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = l.name;
    c.appendChild(t);
    svg.appendChild(c);
  });
}

// ── NWS helpers ──────────────────────────────────────────────

function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* localStorage full or unavailable */ }
}

function isFresh(cached) {
  return Date.now() - cached.timestamp < CACHE_TTL_MS;
}

function parseWindSpeed(speed) {
  if (!speed || typeof speed !== 'string') return null;
  const s = speed.toLowerCase().trim();
  if (s === 'calm') return 0;
  const nums = s.match(/\d+/g);
  if (!nums) return null;
  if (nums.length === 1) return parseInt(nums[0], 10);
  return (parseInt(nums[0], 10) + parseInt(nums[1], 10)) / 2;
}

const CARDINAL_DEG = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5,
  SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5
};

function findCurrentPeriod(periods) {
  const now = Date.now();
  for (const p of periods) {
    const start = new Date(p.startTime).getTime();
    const end = new Date(p.endTime).getTime();
    if (now >= start && now < end) return p;
  }
  return periods[0];
}

function fmtTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function renderConditions(period, cacheTimestamp) {
  const windSpeed = parseWindSpeed(period.windSpeed);
  const dir = period.windDirection || '';
  const temp = period.temperature;
  const now = new Date();

  const speedText = windSpeed !== null ? `${Math.round(windSpeed)} mph` : '--';
  const tempText = temp != null ? `${temp}°F` : '--';

  document.getElementById('conditions').textContent = `${speedText} ${dir} • ${tempText} • ${fmtTime(now)}`;

  if (cacheTimestamp) {
    document.getElementById('updated').textContent = `Updated ${fmtTime(new Date(cacheTimestamp))}`;
  }

  const deg = CARDINAL_DEG[dir];
  if (deg !== undefined) {
    document.getElementById('wind-arrow').style.transform = `rotate(${deg + 180}deg)`;
  }
}

function showStalePill() {
  const pill = document.createElement('span');
  pill.className = 'stale-pill';
  pill.textContent = 'stale';
  document.getElementById('conditions').appendChild(pill);
}

// ── NWS fetch ───────────────────────────────────────────────

async function loadNWS() {
  const center = lakeConfig.center;
  const cached = getCache();

  if (cached && isFresh(cached)) {
    const period = findCurrentPeriod(cached.data.properties.periods);
    if (period) renderConditions(period, cached.timestamp);
    return;
  }

  document.getElementById('conditions').textContent = 'Loading wind data...';

  try {
    const ptsResp = await fetch(
      `https://api.weather.gov/points/${center[0]},${center[1]}`,
      { headers: { 'User-Agent': 'windmap/1.0 (bluelake-zimmerman)' } }
    );
    if (!ptsResp.ok) throw new Error(`NWS points fetch: ${ptsResp.status}`);
    const ptsData = await ptsResp.json();
    const hourlyUrl = ptsData.properties.forecastHourly;

    const hrResp = await fetch(hourlyUrl, {
      headers: { 'User-Agent': 'windmap/1.0 (bluelake-zimmerman)' }
    });
    if (!hrResp.ok) throw new Error(`NWS hourly fetch: ${hrResp.status}`);
    const hrData = await hrResp.json();

    setCache(hrData);

    const period = findCurrentPeriod(hrData.properties.periods);
    if (period) renderConditions(period, Date.now());
  } catch (e) {
    console.error('NWS fetch failed:', e);
    if (cached) {
      const period = findCurrentPeriod(cached.data.properties.periods);
      if (period) renderConditions(period, cached.timestamp);
      showStalePill();
      return;
    }
  }
}
