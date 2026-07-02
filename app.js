const CACHE_KEY = 'windmap:nws:hourly:v1';
const CACHE_TTL_MS = 60 * 60 * 1000;

let lakeConfig = null;
let cells = [];
let windValues = null;
let projectedOutline = [];
let projTreePolys = [];
let projElevPolys = [];
let allPeriods = null;
let currentPeriodIndex = 0;
let periodMeanWinds = null;
let bestWindow = null;
let lastFetchTimestamp = null;

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
  setupSlider();
  setupRefresh();
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

function renderTrees(svg) {
  // Render tree polygons as semi-transparent green shapes (per SPEC §3.1).
  // Drawn between cells (bottom) and outline (top) so cells show through the
  // tree fill and the outline stroke stays crisp on top.
  if (!projTreePolys || projTreePolys.length === 0) return;
  const treesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  treesG.setAttribute('id', 'trees');
  for (const poly of projTreePolys) {
    const d = poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'rgba(98, 130, 89, 0.35)');
    path.setAttribute('stroke', 'rgba(60, 90, 50, 0.6)');
    path.setAttribute('stroke-width', '1');
    treesG.appendChild(path);
  }
  svg.appendChild(treesG);
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

  renderTrees(svg);

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
  const to = (deg + 180) % 360, r = to * Math.PI / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
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
        const near = findNearestPointOnPolygon(cx, cy, projectedOutline);
        const dx = cx - near.x, dy = cy - near.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        cells.push({
          x: cx - cellW / 2, y: cy - cellH / 2, w: cellW, h: cellH,
          cx, cy,
          _nx: len < 0.001 ? 0 : dx / len,
          _ny: len < 0.001 ? 0 : dy / len,
          _len: len
        });
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

function getCellEffectiveWind(cx, cy, wux, wuy, speed, cell) {
  const ff = cell._len < 0.001 ? 0.2 : Math.max(0.2, wux * cell._nx + wuy * cell._ny);
  const ta = computeTerrainAttenuation(cx, cy, wux, wuy, projTreePolys, projElevPolys);
  return speed * ff * ta;
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
    const c = cells[i];
    windValues[i] = getCellEffectiveWind(c.cx, c.cy, w.x, w.y, speed, c);
  }
  renderCellColors();
}

function computeMeanEffectiveWind(period) {
  const speed = parseWindSpeed(period.windSpeed);
  if (speed === null || speed === 0) return 0;
  const w = windDirToUnit(period.windDirection);
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    total += getCellEffectiveWind(c.cx, c.cy, w.x, w.y, speed, c);
  }
  return total / cells.length;
}

// ── NWS helpers ──────────────────────────────────────────────

function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCache(data, ts) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: ts !== undefined ? ts : Date.now() }));
  } catch { /* localStorage full or unavailable */ }
}

function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
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

function findCurrentPeriodIdx(periods) {
  const now = Date.now();
  for (let i = 0; i < periods.length; i++) {
    const start = new Date(periods[i].startTime).getTime();
    const end = new Date(periods[i].endTime).getTime();
    if (now >= start && now < end) return i;
  }
  return 0;
}

function fmtTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtShortTime(date) {
  const h = date.toLocaleTimeString('en-US', { hour: 'numeric' });
  const d = date.toLocaleDateString('en-US', { weekday: 'short' });
  return `${h} ${d}`;
}

function fmtRelative(ms) {
  // "just now", "3m ago", "2h ago", "5h ago"
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function updateUpdatedLine(timestamp, isStale) {
  // Footer line: source + freshness, so the user knows what they're looking at.
  const elapsed = Date.now() - timestamp;
  const rel = fmtRelative(elapsed);
  const stale = isStale ? ' · stale' : '';
  document.getElementById('updated').textContent = `NWS · ${rel}${stale}`;
}

function updateConditionsForPeriod(period) {
  const windSpeed = parseWindSpeed(period.windSpeed);
  const dir = period.windDirection || '';
  const temp = period.temperature;
  const speedText = windSpeed !== null ? `${Math.round(windSpeed)} mph` : '--';
  const tempText = temp != null ? `${temp}°F` : '--';
  document.getElementById('conditions').textContent = `${speedText} ${dir} • ${tempText}`;

  const deg = CARDINAL_DEG[dir];
  if (deg !== undefined) {
    document.getElementById('wind-arrow').style.transform = `rotate(${deg + 180}deg)`;
  }
}

function showStalePill() {
  document.getElementById('stale-pill').style.display = '';
}

// ── Best window ─────────────────────────────────────────────

function precomputePeriodMeans(periods) {
  const count = Math.min(periods.length, 48);
  const means = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (parseWindSpeed(periods[i].windSpeed) === null) {
      means[i] = 1e10;
    } else {
      means[i] = computeMeanEffectiveWind(periods[i]);
    }
  }
  return means;
}

function findBestWindow(periods, means) {
  const count = means.length;
  let bestStart = 0, bestEnd = 0, bestMean = Infinity;
  for (const size of [3, 2]) {
    for (let i = 0; i <= count - size; i++) {
      let sum = 0;
      for (let j = 0; j < size; j++) sum += means[i + j];
      const mean = sum / size;
      if (mean < bestMean) {
        bestMean = mean;
        bestStart = i;
        bestEnd = i + size - 1;
      }
    }
  }
  return { startIdx: bestStart, endIdx: bestEnd, mean: bestMean };
}

function renderBestWindow() {
  const chip = document.getElementById('best-window');
  if (!bestWindow || !allPeriods) {
    chip.style.display = 'none';
    return;
  }
  chip.style.display = '';
  chip.classList.remove('dim');

  const startPeriod = allPeriods[bestWindow.startIdx];
  const endPeriod = allPeriods[bestWindow.endIdx];
  const startTime = new Date(startPeriod.startTime);
  const endTime = new Date(endPeriod.endTime);

  const hoursAway = (startTime.getTime() - Date.now()) / (1000 * 60 * 60);
  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (hoursAway > 6) {
    chip.textContent = `Best in ${Math.round(hoursAway)}h: ${fmt(startTime)}–${fmt(endTime)}`;
    chip.classList.add('dim');
  } else {
    chip.textContent = `Best: ${fmt(startTime)}–${fmt(endTime)}`;
  }
}

// ── Time slider ─────────────────────────────────────────────

function setupSlider() {
  const slider = document.getElementById('time-slider');
  slider.addEventListener('input', onTimeSliderChange);
  document.getElementById('best-window').addEventListener('click', () => {
    if (bestWindow) {
      slider.value = bestWindow.startIdx;
      onTimeSliderChange();
    }
  });
}

function onTimeSliderChange() {
  const idx = parseInt(document.getElementById('time-slider').value, 10);
  const period = allPeriods[idx];
  if (!period) return;
  currentPeriodIndex = idx;
  clearMapError();
  recomputeCells(period);
  updateConditionsForPeriod(period);
  document.getElementById('time-display').textContent = fmtShortTime(new Date(period.startTime));
}

function initSlider(periods, currentIdx) {
  allPeriods = periods;
  const slider = document.getElementById('time-slider');
  const count = Math.min(periods.length, 48);
  slider.max = count - 1;
  slider.value = Math.min(currentIdx, count - 1);
  document.getElementById('slider-section').style.display = '';
  document.getElementById('stale-pill').style.display = 'none';

  console.time('best-window-scan');
  periodMeanWinds = precomputePeriodMeans(periods);
  bestWindow = findBestWindow(periods, periodMeanWinds);
  console.timeEnd('best-window-scan');
  renderBestWindow();
  onTimeSliderChange();
}

// ── Refresh ─────────────────────────────────────────────────

function setupRefresh() {
  document.getElementById('refresh').addEventListener('click', onRefresh);
}

async function onRefresh() {
  const cached = getCache();
  const btn = document.getElementById('refresh');
  const failMsg = document.getElementById('refresh-fail');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner">↻</span>';

  clearCache();

  try {
    const center = lakeConfig.center;
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
    lastFetchTimestamp = Date.now();
    initSlider(hrData.properties.periods, findCurrentPeriodIdx(hrData.properties.periods));
    updateUpdatedLine(lastFetchTimestamp, false);
    clearMapError();
  } catch (e) {
    console.error('Refresh failed:', e);
    if (cached) setCache(cached.data, cached.timestamp);
    failMsg.textContent = 'Refresh failed';
    failMsg.style.opacity = 1;
    setTimeout(() => { failMsg.style.opacity = 0; }, 3000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '↻ Refresh';
  }
}

// ── Error handling ──────────────────────────────────────────

function showMapError(html) {
  const div = document.getElementById('map-error');
  div.innerHTML = html;
  div.style.display = '';
}

function clearMapError() {
  document.getElementById('map-error').style.display = 'none';
}

// ── NWS fetch ───────────────────────────────────────────────

async function loadNWS() {
  const center = lakeConfig.center;
  const cached = getCache();

  if (cached && isFresh(cached)) {
    lastFetchTimestamp = cached.timestamp;
    const periods = cached.data.properties.periods;
    const idx = findCurrentPeriodIdx(periods);
    initSlider(periods, idx);
    updateUpdatedLine(lastFetchTimestamp, false);
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
    lastFetchTimestamp = Date.now();

    const periods = hrData.properties.periods;
    const idx = findCurrentPeriodIdx(periods);
    initSlider(periods, idx);
    updateUpdatedLine(lastFetchTimestamp, false);
  } catch (e) {
    console.error('NWS fetch failed:', e);
    if (cached) {
      const periods = cached.data.properties.periods;
      const idx = findCurrentPeriodIdx(periods);
      initSlider(periods, idx);
      updateUpdatedLine(cached.timestamp, true);
      showStalePill();
      return;
    }
    document.getElementById('conditions').textContent = '';
    if (location.protocol === 'file:') {
      showMapError('Serve this folder over http: <code>python3 -m http.server 8000</code>');
    } else {
      showMapError('Couldn\'t reach the National Weather Service. Try refreshing, or check your connection.');
    }
  }
}
