/**
 * Per-face quadtree for LOD. Nodes identified by (face, level, x, y).
 * Global skeleton = maxLevel low; local detail generated on demand + LRU cache.
 */
import { faceUvToSphere, faceExtentRadians } from './cubesphere.js';
import { EARTH_RADIUS_KM, distKm, vnorm } from './math.js';

export function nodeKey(face, level, x, y) {
  return `${face}:${level}:${x}:${y}`;
}

export function parseNodeKey(key) {
  const [f, l, x, y] = key.split(':').map(Number);
  return { face: f, level: l, x, y };
}

/** UV bounds of a node on its face. */
export function nodeUvBounds(level, x, y) {
  const n = 1 << level;
  return {
    u0: x / n,
    v0: y / n,
    u1: (x + 1) / n,
    v1: (y + 1) / n,
  };
}

export function nodeCenterSphere(face, level, x, y) {
  const b = nodeUvBounds(level, x, y);
  return faceUvToSphere(face, (b.u0 + b.u1) * 0.5, (b.v0 + b.v1) * 0.5);
}

export function nodeChildren(face, level, x, y) {
  const nl = level + 1;
  const cx = x * 2;
  const cy = y * 2;
  return [
    { face, level: nl, x: cx, y: cy },
    { face, level: nl, x: cx + 1, y: cy },
    { face, level: nl, x: cx, y: cy + 1 },
    { face, level: nl, x: cx + 1, y: cy + 1 },
  ];
}

/**
 * LRU cache for generated chunks.
 */
export class ChunkCache {
  constructor(maxEntries = 256) {
    this.max = maxEntries;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    // refresh LRU
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  has(key) {
    return this.map.has(key);
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }
}

/**
 * Select visible nodes for a camera position on the unit sphere.
 * Returns list of { face, level, x, y }.
 */
export function selectLodNodes(cameraDir, opts = {}) {
  const {
    skeletonLevel = 4,
    maxLevel = 8,
    splitFactor = 2.2,
    radiusKm = EARTH_RADIUS_KM,
  } = opts;
  const cam = vnorm(cameraDir);
  const result = [];

  function visit(face, level, x, y) {
    const center = nodeCenterSphere(face, level, x, y);
    const b = nodeUvBounds(level, x, y);
    const extent = faceExtentRadians(b.u1 - b.u0);
    const ang = Math.acos(Math.min(1, Math.max(-1,
      cam.x * center.x + cam.y * center.y + cam.z * center.z
    )));
    // distance along sphere surface (km)
    const dKm = ang * radiusKm;
    // characteristic size of node in km
    const sizeKm = extent * radiusKm;
    const shouldSplit =
      level < maxLevel &&
      (level < skeletonLevel || dKm < sizeKm * splitFactor);

    if (shouldSplit && level >= 0) {
      if (level + 1 <= maxLevel && (level < skeletonLevel || dKm < sizeKm * splitFactor)) {
        if (level < skeletonLevel || dKm < sizeKm * splitFactor) {
          const kids = nodeChildren(face, level, x, y);
          // only split if we want more detail
          let split = level < skeletonLevel;
          if (!split) {
            split = dKm < sizeKm * splitFactor && level < maxLevel;
          }
          if (split && level < maxLevel) {
            for (const k of kids) visit(k.face, k.level, k.x, k.y);
            return;
          }
        }
      }
    }

    // leaf
    if (level >= skeletonLevel || !shouldSplit) {
      result.push({ face, level, x, y });
      return;
    }
    // still below skeleton — force children
    for (const k of nodeChildren(face, level, x, y)) {
      visit(k.face, k.level, k.x, k.y);
    }
  }

  // Start from root of each face
  for (let face = 0; face < 6; face++) {
    visit(face, 0, 0, 0);
  }
  return result;
}

/**
 * Cleaner LOD selection: always cover full sphere; refine near camera.
 */
export function selectLodNodesV2(cameraDir, opts = {}) {
  const {
    minLevel = 3,
    maxLevel = 7,
    splitFactor = 2.5,
    radiusKm = EARTH_RADIUS_KM,
  } = opts;
  const cam = vnorm(cameraDir);
  const result = [];

  function visit(face, level, x, y) {
    const center = nodeCenterSphere(face, level, x, y);
    const b = nodeUvBounds(level, x, y);
    const sizeKm = faceExtentRadians(b.u1 - b.u0) * radiusKm;
    const ang = Math.acos(Math.min(1, Math.max(-1,
      cam.x * center.x + cam.y * center.y + cam.z * center.z
    )));
    const dKm = Math.max(1, ang * radiusKm);

    const wantSplit = level < maxLevel && (level < minLevel || dKm < sizeKm * splitFactor);
    if (wantSplit) {
      for (const k of nodeChildren(face, level, x, y)) {
        visit(k.face, k.level, k.x, k.y);
      }
    } else {
      result.push({ face, level, x, y });
    }
  }

  for (let face = 0; face < 6; face++) visit(face, 0, 0, 0);
  return result;
}
