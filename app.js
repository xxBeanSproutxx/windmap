const CACHE_KEY = 'windmap:nws:hourly:v1';
const CACHE_TTL_MS = 60 * 60 * 1000;

let lakeConfig = null;
let cells = [];
let windValues = null;
let projectedOutline = [];
let projTreePolys = [];
let projElevPolys = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const resp = await fetch('lakes/blue-lake.json');
    lakeConfig = await resp.json();
  } catch (e) {
    document.getElementById('map-card').innerHTML = '<p style="color:#999">Could not load lake data.</p>';
    return;
  }

  const clon = lakeConfig.center[1], clat = lakeConfig.center[0];
  projectedOutline = lakeConfig.outline.map(p => project(p[0], p[1], clon, clat));
  projTreePolys = (lakeConfig.tree_polygons || []).map(poly =>
    poly.polygon.map(pt => project(pt[0], pt[1], clon, clat))
  );
  projElevPolys = (lakeConfig.elevation_polygons || []).map(poly =>
    poly.polygon.map(pt => project(pt[0], pt[1], clon, clat))
  );

  renderMap();
  buildCellGrid();
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
  const { boat_launches } = lakeConfig;
  const clon = lakeConfig.center[1], clat = lakeConfig.center[0];

  const projectedLaunches = boat_launches.map(l => {
    const p = project(l.lon, l.lat, clon, clat);
    return { ...l, x: p.x, y: p.y };
  });

  const xs = projectedOutline.map(p => p.x);
  const ys = projectedOutline.map(p => p.y);
  const M = 40;
  const minX = Math.min(...xs) - M;
  const minY = Math.min(...ys) - M;
  const maxX = Math.max(...xs) + M;
  const maxY = Math.max(...ys) + M;

  const svg = document.getElementById('map');
  svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);

  const cellsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  cellsG.setAttribute('id', 'cells');
  svg.appendChild(cellsG);

  const d = projectedOutline.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z';
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

// ── Wind model ────────────────────────────────────────────────

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function findNearestPointOnPolygon(px, py, poly) {
  let minD2 = Infinity, nearX = poly[0].x, nearY = poly[0].y;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].x, ay = poly[j].y, bx = poly[i].x, by = poly[i].y;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (l2 < 1e-8) continue;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const nx = ax + t * dx, ny = ay + t * dy;
    const d2 = (px - nx) * (px - nx) + (py - ny) * (py - ny);
    if (d2 < minD2) { minD2 = d2; nearX = nx; nearY = ny; }
  }
  return { x: nearX, y: nearY };
}

function windDirToUnit(cardinal) {
  if (!cardinal || typeof cardinal !== 'string') return { x: 0, y: 0 };
  const deg = CARDINAL_DEG[cardinal.toUpperCase()];
  if (deg === undefined) return { x: 0, y: 0 };
  // Wind "from NW" blows TOWARD SE. In our coord system: +x = east, +y = south (since y
  // is the negation of lat offset to match SVG's +y-down convention). So SE = (+, +).
  // Standard sin/cos gives north-positive; we flip y to get south-positive.
  const to = (deg + 180) % 360, r = to * Math.PI / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

function computeFetchFactor(cx, cy, wux, wuy, outline) {
  const near = findNearestPointOnPolygon(cx, cy, outline);
  const dx = cx - near.x, dy = cy - near.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return 0.2;
  return Math.max(0.2, wux * (dx / len) + wuy * (dy / len));
}

function computeTerrainAttenuation(cx, cy, wux, wuy, treePolys, elevPolys) {
  const dx = -wux, dy = -wuy;
  for (let s = 1; s <= 60; s++) {
    const px = cx + dx * 5 * s, py = cy + dy * 5 * s;
    for (const poly of elevPolys) { if (pointInPolygon(px, py, poly)) return 0.10; }
    for (const poly of treePolys) { if (pointInPolygon(px, py, poly)) return 0.25; }
  }
  return 1.0;
}

function windColor(mph) {
  if (mph < 6) return 'var(--slack)';
  if (mph < 8) return 'var(--marginal)';
  if (mph < 15) return 'var(--choppy)';
  return 'var(--noggo)';
}

function buildCellGrid() {
  const xs = projectedOutline.map(p => p.x), ys = projectedOutline.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cols = 100, rows = 250, cellW = (maxX - minX) / cols, cellH = (maxY - minY) / rows;
  cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = minX + (c + 0.5) * cellW, cy = minY + (r + 0.5) * cellH;
      if (pointInPolygon(cx, cy, projectedOutline)) {
        cells.push({ x: cx - cellW / 2, y: cy - cellH / 2, w: cellW, h: cellH });
      }
    }
  }
  windValues = new Float32Array(cells.length);
}

function renderCellColors() {
  const svg = document.getElementById('map');
  let cellsG = document.getElementById('cells');
  if (!cellsG) {
    cellsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    cellsG.setAttribute('id', 'cells');
    svg.insertBefore(cellsG, svg.firstChild);
  }
  const path = svg.querySelector('path');
  if (path) path.setAttribute('fill', 'none');
  while (cellsG.firstChild) cellsG.removeChild(cellsG.firstChild);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', c.x);
    r.setAttribute('y', c.y);
    r.setAttribute('width', c.w);
    r.setAttribute('height', c.h);
    r.setAttribute('fill', windColor(windValues[i]));
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = windValues[i].toFixed(1) + ' mph';
    r.appendChild(t);
    frag.appendChild(r);
  }
  cellsG.appendChild(frag);
}

function recomputeCells(period) {
  if (!period || !windValues || cells.length === 0) return;
  const speed = parseWindSpeed(period.windSpeed);
  if (speed === null || speed === 0) {
    for (let i = 0; i < cells.length; i++) windValues[i] = 0;
    renderCellColors();
    return;
  }
  const w = windDirToUnit(period.windDirection);
  for (let i = 0; i < cells.length; i++) {
    const cx = cells[i].x + cells[i].w / 2, cy = cells[i].y + cells[i].h / 2;
    windValues[i] = speed * computeFetchFactor(cx, cy, w.x, w.y, projectedOutline)
      * computeTerrainAttenuation(cx, cy, w.x, w.y, projTreePolys, projElevPolys);
  }
  renderCellColors();
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
    if (period) { renderConditions(period, cached.timestamp); recomputeCells(period); }
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
    if (period) { renderConditions(period, Date.now()); recomputeCells(period); }
  } catch (e) {
    console.error('NWS fetch failed:', e);
    if (cached) {
      const period = findCurrentPeriod(cached.data.properties.periods);
      if (period) { renderConditions(period, cached.timestamp); recomputeCells(period); }
      showStalePill();
      return;
    }
  }
}
