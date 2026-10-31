/**
 * Seed settlements at habitability maxima; roads via least-cost path;
 * sects (宗门) by mountains + spiritual resources.
 */
import { habitability, resourceScore } from './habitability.js';
import { sampleElevation } from '../geo/terrain.js';
import { lonLatToXyz, xyzToLonLat, clamp } from '../core/math.js';
import { hashToUnit } from '../core/hash.js';
import { classifyBiome, BIOME } from '../geo/climate.js';

/**
 * Scan equirectangular habitability grid; pick local maxima as settlement seeds.
 */
export function placeSettlements(seed, elevGrid, width, height, riverAccum, opts = {}) {
  const {
    maxSettlements = 80,
    minHab = 0.35,
    minSpacingCells = 6,
  } = opts;

  const hab = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const elev = elevGrid[i];
      const lon = (x / width) * 360 - 180;
      const lat = 90 - (y / height) * 180;
      const p = lonLatToXyz(lon, lat);
      const riverProx = riverAccum
        ? clamp(Math.log1p(riverAccum[i]) / 8, 0, 1)
        : 0;
      hab[i] = habitability(seed, p, elev, riverProx);
    }
  }

  // Collect local maxima
  const candidates = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const h = hab[i];
      if (h < minHab) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (hab[(y + dy) * width + (x + dx)] > h) isMax = false;
        }
      }
      if (isMax) {
        const lon = (x / width) * 360 - 180;
        const lat = 90 - (y / height) * 180;
        candidates.push({ x, y, i, hab: h, lon, lat, elev: elevGrid[i] });
      }
    }
  }
  candidates.sort((a, b) => b.hab - a.hab);

  const placed = [];
  for (const c of candidates) {
    if (placed.length >= maxSettlements) break;
    let ok = true;
    for (const p of placed) {
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      if (dx * dx + dy * dy < minSpacingCells * minSpacingCells) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const pop = Math.floor(500 + c.hab * c.hab * 80000);
    placed.push({
      ...c,
      nameKey: `settlement_${placed.length}`,
      population: pop,
      type: pop > 40000 ? 'city' : pop > 12000 ? 'town' : 'village',
    });
  }
  return { settlements: placed, habitability: hab };
}

/**
 * Least-cost path on grid. Cost from slope + biome hostility.
 */
export function leastCostPath(elevGrid, width, height, start, end, seaLevel = 0) {
  const n = width * height;
  const dist = new Float32Array(n);
  dist.fill(Infinity);
  const prev = new Int32Array(n);
  prev.fill(-1);
  const si = start.y * width + start.x;
  const ei = end.y * width + end.x;
  dist[si] = 0;

  // Binary-heap free: bucket / simple linear scan for small grids
  const open = new Set([si]);
  const dx = [1, -1, 0, 0, 1, 1, -1, -1];
  const dy = [0, 0, 1, -1, 1, -1, 1, -1];
  const diag = Math.SQRT2;

  while (open.size) {
    let best = -1;
    let bestD = Infinity;
    for (const i of open) {
      if (dist[i] < bestD) {
        bestD = dist[i];
        best = i;
      }
    }
    if (best < 0) break;
    open.delete(best);
    if (best === ei) break;
    const x = best % width;
    const y = (best / width) | 0;
    const e0 = elevGrid[best];
    for (let d = 0; d < 8; d++) {
      const nx = x + dx[d];
      const ny = y + dy[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      const e1 = elevGrid[ni];
      if (e1 < seaLevel) continue; // no ocean roads
      const slope = Math.abs(e1 - e0);
      const step = (d < 4 ? 1 : diag);
      const cost = step * (1 + slope / 400) * (e1 > 2800 ? 2.5 : 1);
      const nd = dist[best] + cost;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = best;
        open.add(ni);
      }
    }
  }

  if (prev[ei] < 0 && si !== ei) return null;
  const path = [];
  let cur = ei;
  while (cur >= 0) {
    path.push({ x: cur % width, y: (cur / width) | 0 });
    if (cur === si) break;
    cur = prev[cur];
  }
  path.reverse();
  return path;
}

export function connectSettlements(elevGrid, width, height, settlements, maxEdges = 120) {
  // Connect each to a few nearest neighbors via LCP
  const roads = [];
  const used = new Set();
  for (let i = 0; i < settlements.length; i++) {
    const a = settlements[i];
    const dists = [];
    for (let j = 0; j < settlements.length; j++) {
      if (i === j) continue;
      const b = settlements[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      dists.push({ j, d: dx * dx + dy * dy });
    }
    dists.sort((u, v) => u.d - v.d);
    const k = a.type === 'city' ? 3 : 2;
    for (let t = 0; t < Math.min(k, dists.length); t++) {
      const j = dists[t].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (used.has(key)) continue;
      used.add(key);
      const path = leastCostPath(elevGrid, width, height, a, settlements[j]);
      if (path && path.length > 1) {
        roads.push({ from: i, to: j, path });
        if (roads.length >= maxEdges) return roads;
      }
    }
  }
  return roads;
}

/**
 * Place sects on high spiritual mountains near resources, away from dense cities.
 */
export function placeSects(seed, elevGrid, width, height, settlements, opts = {}) {
  const { maxSects = 40, minElev = 900 } = opts;
  const candidates = [];
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const i = y * width + x;
      const elev = elevGrid[i];
      if (elev < minElev) continue;
      const lon = (x / width) * 360 - 180;
      const lat = 90 - (y / height) * 180;
      const p = lonLatToXyz(lon, lat);
      const biome = classifyBiome(seed, p, elev);
      const mountainish = biome === BIOME.MOUNTAIN || biome === BIOME.XIANXIA_PEAK
        || biome === BIOME.MIST_FOREST || elev > 1600;
      if (!mountainish) continue;
      const spirit = resourceScore(seed, p, elev);
      if (spirit < 0.28) continue;
      candidates.push({ x, y, lon, lat, elev, spirit, biome });
    }
  }
  candidates.sort((a, b) => b.spirit - a.spirit);
  const sects = [];
  for (const c of candidates) {
    if (sects.length >= maxSects) break;
    // Keep distance from settlements and other sects
    let ok = true;
    for (const s of settlements) {
      const dx = c.x - s.x;
      const dy = c.y - s.y;
      if (dx * dx + dy * dy < 25) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const s of sects) {
      const dx = c.x - s.x;
      const dy = c.y - s.y;
      if (dx * dx + dy * dy < 36) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const rank = c.spirit > 0.85 ? '大派' : c.spirit > 0.65 ? '名门' : '小宗';
    sects.push({
      ...c,
      nameKey: `sect_${sects.length}`,
      rank,
      id: Math.floor(hashToUnit(seed, c.x, c.y, 99) * 1e9),
    });
  }
  return sects;
}
