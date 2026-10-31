/**
 * Engine-independent world generation entry.
 * Generates Earth-sized (~6371 km) xianxia planet skeleton + on-demand chunks.
 */
import { seedFrom, digestFloat32, digestJSON } from './hash.js';
import { EARTH_RADIUS_KM, lonLatToXyz, xyzToLonLat } from './math.js';
import { sampleElevation, SEA_LEVEL } from '../geo/terrain.js';
import { classifyBiome, BIOME_NAMES, moistureAt, temperatureAt, BIOME_COLORS } from '../geo/climate.js';
import { computeFlow, extractRiverSegments } from '../geo/rivers.js';
import { sampleCaveSite } from '../geo/caves.js';
import { makeOverrideSampler, loadOverrides } from '../geo/overrides.js';
import { placeSettlements, connectSettlements, placeSects } from '../settlement/settlements.js';
import { ChunkCache, nodeKey, nodeUvBounds } from './quadtree.js';
import { faceUvToSphere } from './cubesphere.js';

export const DEFAULT_CONFIG = {
  radiusKm: EARTH_RADIUS_KM,
  skeletonWidth: 256,
  skeletonHeight: 128,
  chunkResolution: 33, // verts per chunk side (power-of-2 + 1 for skirts)
  skeletonLevel: 3,
  maxLodLevel: 7,
  cacheSize: 192,
  riverThresholdFactor: 0.0008,
  maxSettlements: 64,
  maxSects: 36,
};

/**
 * Build global low-res equirectangular skeleton (always in memory).
 */
export function generateSkeleton(seedInput, overridesJson = null, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const seed = seedFrom(seedInput);
  const overrides = makeOverrideSampler(loadOverrides(overridesJson));
  const w = cfg.skeletonWidth;
  const h = cfg.skeletonHeight;
  const elevation = new Float32Array(w * h);
  const biome = new Uint8Array(w * h);
  const caves = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * 360 - 180;
      const lat = 90 - ((y + 0.5) / h) * 180;
      const p = lonLatToXyz(lon, lat);
      let elev = sampleElevation(seed, p);
      if (overrides) elev = overrides.elevationAt(p, elev);
      const i = y * w + x;
      elevation[i] = elev;
      biome[i] = classifyBiome(seed, p, elev);
      if ((x % 2 === 0) && (y % 2 === 0) && elev > SEA_LEVEL) {
        const cave = sampleCaveSite(seed, p, elev);
        if (cave) caves.push(cave);
      }
    }
  }

  const { flowDir, accum, lakes } = computeFlow(elevation, w, h, SEA_LEVEL);
  const thresh = Math.max(12, (w * h) * cfg.riverThresholdFactor);
  const riverPaths = extractRiverSegments(elevation, flowDir, accum, w, h, thresh, SEA_LEVEL);

  const { settlements, habitability } = placeSettlements(
    seed, elevation, w, h, accum,
    { maxSettlements: cfg.maxSettlements }
  );
  const roads = connectSettlements(elevation, w, h, settlements);
  const sects = placeSects(seed, elevation, w, h, settlements, { maxSects: cfg.maxSects });

  const meta = {
    seed,
    seedInput: String(seedInput),
    radiusKm: cfg.radiusKm,
    width: w,
    height: h,
    seaLevel: SEA_LEVEL,
    elevDigest: digestFloat32(elevation),
    biomeDigest: digestFloat32(biome),
    settlementCount: settlements.length,
    roadCount: roads.length,
    sectCount: sects.length,
    riverCount: riverPaths.length,
    lakeCount: lakes.length,
    caveCount: caves.length,
    generatedAt: new Date().toISOString(),
  };

  return {
    meta,
    config: cfg,
    elevation,
    biome,
    accum,
    lakes,
    rivers: riverPaths,
    settlements,
    roads,
    sects,
    caves: caves.slice(0, 200),
    habitability,
    overridesJson,
  };
}

/**
 * Generate a heightfield chunk for one quadtree node.
 * Includes 1-cell skirt overlap for seamless neighbors.
 */
export function generateChunk(seedInput, face, level, x, y, overridesJson = null, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const seed = seedFrom(seedInput);
  const overrides = makeOverrideSampler(loadOverrides(overridesJson));
  const res = cfg.chunkResolution;
  const b = nodeUvBounds(level, x, y);
  const elev = new Float32Array(res * res);
  const biome = new Uint8Array(res * res);
  // Expand UV slightly for skirt morphing
  const pad = (b.u1 - b.u0) / (res - 1);

  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const u = b.u0 + (i / (res - 1)) * (b.u1 - b.u0);
      const v = b.v0 + (j / (res - 1)) * (b.v1 - b.v0);
      const p = faceUvToSphere(face, u, v);
      let e = sampleElevation(seed, p);
      if (overrides) e = overrides.elevationAt(p, e);
      const idx = j * res + i;
      elev[idx] = e;
      biome[idx] = classifyBiome(seed, p, e);
    }
  }

  return {
    key: nodeKey(face, level, x, y),
    face,
    level,
    x,
    y,
    res,
    uv: b,
    pad,
    elevation: elev,
    biome,
    elevDigest: digestFloat32(elev),
  };
}

/**
 * World session: skeleton + LRU chunk cache.
 */
export class WorldSession {
  constructor(seedInput, overridesJson = null, config = {}) {
    this.seedInput = seedInput;
    this.overridesJson = overridesJson;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.skeleton = generateSkeleton(seedInput, overridesJson, this.config);
    this.cache = new ChunkCache(this.config.cacheSize);
  }

  getChunk(face, level, x, y) {
    const key = nodeKey(face, level, x, y);
    let c = this.cache.get(key);
    if (c) return c;
    c = generateChunk(this.seedInput, face, level, x, y, this.overridesJson, this.config);
    this.cache.set(key, c);
    return c;
  }

  /** Serializable lightweight summary for JSON export (no huge typed arrays as JSON). */
  exportSummary() {
    const s = this.skeleton;
    return {
      meta: s.meta,
      settlements: s.settlements.map(({ lon, lat, elev, population, type, nameKey, hab }) => ({
        lon, lat, elev, population, type, nameKey, hab,
      })),
      sects: s.sects.map(({ lon, lat, elev, spirit, rank, nameKey, id }) => ({
        lon, lat, elev, spirit, rank, nameKey, id,
      })),
      rivers: s.rivers.map((path) =>
        path.map(({ x, y, accum }) => ({ x, y, accum }))
      ),
      roads: s.roads.map(({ from, to, path }) => ({
        from,
        to,
        path: path.map(({ x, y }) => ({ x, y })),
      })),
      caves: s.caves,
      lakes: s.lakes.slice(0, 100),
    };
  }
}

/**
 * Render equirectangular RGBA preview from skeleton (for 2D map / digest).
 */
export function skeletonToRGBA(skeleton, layers = {}) {
  const {
    showElevation = true,
    showBiome = true,
    showRivers = true,
    showSettlements = true,
    showRoads = true,
    showSects = true,
  } = layers;
  const w = skeleton.meta.width;
  const h = skeleton.meta.height;
  const rgba = new Uint8ClampedArray(w * h * 4);

  let minE = Infinity;
  let maxE = -Infinity;
  for (let i = 0; i < skeleton.elevation.length; i++) {
    const e = skeleton.elevation[i];
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
  }

  for (let i = 0; i < w * h; i++) {
    const e = skeleton.elevation[i];
    let r, g, b;
    if (showBiome) {
      const c = BIOME_COLORS[skeleton.biome[i]] || [128, 128, 128];
      r = c[0]; g = c[1]; b = c[2];
    } else if (showElevation) {
      const t = (e - minE) / (maxE - minE + 1e-6);
      if (e < 0) {
        r = 10; g = 40 + t * 80; b = 90 + t * 100;
      } else {
        r = 40 + t * 200; g = 90 + t * 140; b = 40;
      }
    } else {
      r = g = b = 40;
    }
    // subtle elevation shading on biome
    if (showBiome && showElevation && e >= 0) {
      const shade = 0.75 + 0.25 * ((e - 0) / (maxE + 1));
      r = Math.min(255, r * shade);
      g = Math.min(255, g * shade);
      b = Math.min(255, b * shade);
    }
    const o = i * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  }

  const setPixel = (x, y, cr, cg, cb) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    rgba[o] = cr; rgba[o + 1] = cg; rgba[o + 2] = cb;
  };

  if (showRivers) {
    for (const path of skeleton.rivers) {
      for (const pt of path) setPixel(pt.x, pt.y, 60, 140, 220);
    }
  }
  if (showRoads) {
    for (const road of skeleton.roads) {
      for (const pt of road.path) setPixel(pt.x, pt.y, 180, 140, 80);
    }
  }
  if (showSettlements) {
    for (const s of skeleton.settlements) {
      const rad = s.type === 'city' ? 2 : 1;
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++)
          setPixel(s.x + dx, s.y + dy, 255, 220, 80);
    }
  }
  if (showSects) {
    for (const s of skeleton.sects) {
      setPixel(s.x, s.y, 220, 80, 255);
      setPixel(s.x + 1, s.y, 220, 80, 255);
      setPixel(s.x, s.y + 1, 220, 80, 255);
    }
  }

  return { width: w, height: h, rgba };
}

export function digestWorld(skeleton) {
  return digestJSON({
    elev: skeleton.meta.elevDigest,
    biome: skeleton.meta.biomeDigest,
    settlements: skeleton.settlements.map((s) => [s.x, s.y, s.population]),
    sects: skeleton.sects.map((s) => [s.x, s.y, s.id]),
    rivers: skeleton.rivers.length,
    roads: skeleton.roads.map((r) => [r.from, r.to, r.path.length]),
  });
}

export { seedFrom, EARTH_RADIUS_KM };
