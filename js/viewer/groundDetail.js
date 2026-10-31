/**
 * Ground-level detail: chunked InstancedMesh trees/grass/rocks/buildings/roads.
 * Deterministic from seed + biome/settlement/road data. LRU eviction for mobile.
 */
import * as THREE from '../vendor/three.module.js';
import { hashToUnit, seedFrom } from '../core/hash.js';
import { lonLatToXyz, xyzToLonLat, vnorm } from '../core/math.js';
import { sampleElevation } from '../geo/terrain.js';
import { classifyBiome, BIOME } from '../geo/climate.js';
import {
  makeConiferGeo, makeBroadleafGeo, makeBambooGeo, makeRockGeo, makeGrassGeo,
  makeHouseGeo, makeTownHallGeo, makePagodaGeo, makeInstanceMaterial,
} from './geometries.js';

export const GROUND_ALT_M = 2500; // spawn detail below this altitude
const CHUNK_M = 128; // local tangent chunk size in meters
const VIEW_CHUNKS = 3; // radius in chunks (mobile-friendly)

function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (window.innerWidth < 900 && 'ontouchstart' in window);
}

export function mobileCaps() {
  const m = isMobile();
  return {
    mobile: m,
    pixelRatio: m ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2),
    viewChunks: m ? 2 : 3,
    maxTrees: m ? 80 : 180,
    maxGrass: m ? 120 : 400,
    maxRocks: m ? 30 : 80,
    maxBuildings: m ? 24 : 48,
    drawDistance: m ? 350 : 700,
    maxDetailChunks: m ? 25 : 49,
  };
}

/** Build orthonormal basis from radial up. */
export function tangentBasis(up) {
  const u = vnorm(up);
  let ref = Math.abs(u.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const east = vnorm({
    x: ref.y * u.z - ref.z * u.y,
    y: ref.z * u.x - ref.x * u.z,
    z: ref.x * u.y - ref.y * u.x,
  });
  const north = vnorm({
    x: u.y * east.z - u.z * east.y,
    y: u.z * east.x - u.x * east.z,
    z: u.x * east.y - u.y * east.x,
  });
  return { up: u, east, north };
}

export function worldPosFromLocal(originDir, east, north, up, lx, ly, lz, R, elevExag) {
  // lx east, lz north, ly up (height above exaggerated surface at origin)
  const ox = originDir.x * (R + ly);
  const oy = originDir.y * (R + ly);
  const oz = originDir.z * (R + ly);
  // For small lx/lz, approximate tangent offset; then re-project to sphere with local elev
  return {
    x: ox + east.x * lx + north.x * lz,
    y: oy + east.y * lx + north.y * lz,
    z: oz + east.z * lx + north.z * lz,
  };
}

/** Surface world position for a unit direction. */
export function surfaceWorld(dir, elev, R, exaggerate) {
  const h = Math.max(-11000, elev) * exaggerate;
  const rad = R + h;
  return { x: dir.x * rad, y: dir.y * rad, z: dir.z * rad, rad, elev };
}

function treeTypeForBiome(biome) {
  if (biome === BIOME.TAIGA || biome === BIOME.TUNDRA || biome === BIOME.SNOW) return 'conifer';
  if (biome === BIOME.MIST_FOREST || biome === BIOME.RAINFOREST) return 'bamboo';
  if (biome === BIOME.FOREST || biome === BIOME.XIANXIA_PEAK) return 'broadleaf';
  if (biome === BIOME.GRASSLAND || biome === BIOME.BEACH) return 'broadleaf';
  return null;
}

function treeDensity(biome) {
  switch (biome) {
    case BIOME.FOREST: return 0.55;
    case BIOME.RAINFOREST: return 0.75;
    case BIOME.MIST_FOREST: return 0.65;
    case BIOME.TAIGA: return 0.5;
    case BIOME.GRASSLAND: return 0.12;
    case BIOME.XIANXIA_PEAK: return 0.2;
    case BIOME.BEACH: return 0.05;
    case BIOME.DESERT: return 0.02;
    default: return 0;
  }
}

export class GroundDetailSystem {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'groundDetail';
    scene.add(this.group);
    this.caps = mobileCaps();
    this.chunks = new Map(); // key -> { meshes, npcs }
    this.geos = {
      conifer: makeConiferGeo(),
      broadleaf: makeBroadleafGeo(),
      bamboo: makeBambooGeo(),
      rock: makeRockGeo(),
      grass: makeGrassGeo(),
      house: makeHouseGeo(),
      hall: makeTownHallGeo(),
      pagoda: makePagodaGeo(),
    };
    this.mat = makeInstanceMaterial();
    this.enabled = false;
    this.seed = 1;
    this.session = null;
    this.R = opts.R;
    this.getExaggerate = opts.getExaggerate || (() => 4);
    this.npcList = []; // active NPC controllers from all chunks
    this.roadLines = new Map();
  }

  setSession(session) {
    this.session = session;
    this.seed = seedFrom(session.seedInput);
    this.clearAll();
  }

  clearAll() {
    for (const [, ch] of this.chunks) this.disposeChunk(ch);
    this.chunks.clear();
    this.npcList = [];
    for (const [, line] of this.roadLines) {
      this.group.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    this.roadLines.clear();
  }

  disposeChunk(ch) {
    for (const m of ch.meshes) {
      this.group.remove(m);
      // InstancedMesh shares geos; only dispose if unique — geos are shared, don't dispose
      m.dispose?.();
    }
    for (const n of ch.npcs) {
      this.group.remove(n.mesh);
    }
  }

  chunkKey(ci, cj) {
    return `${ci}:${cj}`;
  }

  /** Quantize camera lon/lat into local meter grid origin. */
  localOrigin(dir) {
    const { lon, lat } = xyzToLonLat(dir);
    // meter offsets via local ENU around a fixed origin for this view
    return { lon, lat, dir: vnorm(dir) };
  }

  update(cameraPos, altitudeM) {
    if (!this.session) return;
    const near = altitudeM < GROUND_ALT_M;
    if (!near) {
      if (this.enabled) {
        this.clearAll();
        this.enabled = false;
        this.group.visible = false;
      }
      return;
    }
    this.enabled = true;
    this.group.visible = true;

    const dir = vnorm({ x: cameraPos.x, y: cameraPos.y, z: cameraPos.z });
    const { lon, lat } = xyzToLonLat(dir);
    const basis = tangentBasis(dir);
    const exaggerate = this.getExaggerate();
    const caps = this.caps;
    const half = caps.viewChunks;

    // Grid in local meters: snap camera to CHUNK_M
    // Use lon/lat approx meters: 1 deg lat ~ 111320 m
    const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
    const mPerLat = 110540;
    const ox = lon * mPerLon;
    const oy = lat * mPerLat;
    const ci0 = Math.floor(ox / CHUNK_M);
    const cj0 = Math.floor(oy / CHUNK_M);

    const needed = new Set();
    for (let dj = -half; dj <= half; dj++) {
      for (let di = -half; di <= half; di++) {
        const ci = ci0 + di;
        const cj = cj0 + dj;
        const key = this.chunkKey(ci, cj);
        needed.add(key);
        if (!this.chunks.has(key)) {
          const ch = this.buildChunk(ci, cj, mPerLon, mPerLat, exaggerate, caps);
          this.chunks.set(key, ch);
        }
      }
    }

    // Evict
    for (const [key, ch] of this.chunks) {
      if (!needed.has(key)) {
        this.disposeChunk(ch);
        this.chunks.delete(key);
      }
    }

    // Refresh NPC list
    this.npcList = [];
    for (const [, ch] of this.chunks) {
      for (const n of ch.npcs) this.npcList.push(n);
    }

    // Roads near camera (skeleton grid)
    this.updateRoads(lon, lat, exaggerate, caps);
  }

  buildChunk(ci, cj, mPerLon, mPerLat, exaggerate, caps) {
    const meshes = [];
    const npcs = [];
    const seed = this.seed;
    const R = this.R;

    // Collect instance transforms per type
    const buckets = {
      conifer: [], broadleaf: [], bamboo: [], rock: [], grass: [],
      house: [], hall: [], pagoda: [],
    };

    const samples = 48; // grid samples inside chunk
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        // Only evaluate a subset for trees based on hash
        const cell = sy * samples + sx;
        const u = hashToUnit(seed, ci, cj, cell);
        const lon = (ci * CHUNK_M + (sx + 0.5) * (CHUNK_M / samples)) / mPerLon;
        const lat = (cj * CHUNK_M + (sy + 0.5) * (CHUNK_M / samples)) / mPerLat;
        if (lat > 85 || lat < -85) continue;
        const p = lonLatToXyz(lon, lat);
        const elev = sampleElevation(seed, p);
        if (elev < 2) continue;
        const biome = classifyBiome(seed, p, elev);
        const surf = surfaceWorld(p, elev, R, exaggerate);

        // Trees
        const dens = treeDensity(biome);
        const tType = treeTypeForBiome(biome);
        if (tType && dens > 0 && u < dens * 0.35 && buckets[tType].length < caps.maxTrees) {
          const scale = 0.8 + hashToUnit(seed, cell, 7) * 1.4;
          // scale trees with exaggerate so they remain visible
          const s = scale * Math.max(1.2, exaggerate * 0.35);
          buckets[tType].push({ pos: surf, scale: s, rot: hashToUnit(seed, cell, 3) * Math.PI * 2, up: p });
        }

        // Grass on grassland / forest edge
        if ((biome === BIOME.GRASSLAND || biome === BIOME.FOREST || biome === BIOME.BEACH) &&
            hashToUnit(seed, cell, 11) < 0.4 && buckets.grass.length < caps.maxGrass) {
          const s = (0.6 + hashToUnit(seed, cell, 12) * 1.2) * Math.max(1, exaggerate * 0.25);
          buckets.grass.push({ pos: surf, scale: s, rot: hashToUnit(seed, cell, 13) * Math.PI * 2, up: p });
        }

        // Rocks
        if (elev > 400 && hashToUnit(seed, cell, 17) < 0.08 && buckets.rock.length < caps.maxRocks) {
          const s = (0.5 + hashToUnit(seed, cell, 18) * 2) * Math.max(1, exaggerate * 0.3);
          buckets.rock.push({ pos: surf, scale: s, rot: hashToUnit(seed, cell, 19) * Math.PI * 2, up: p });
        }
      }
    }

    // Settlements & sects within this chunk's lon/lat AABB
    const lon0 = (ci * CHUNK_M) / mPerLon;
    const lon1 = ((ci + 1) * CHUNK_M) / mPerLon;
    const lat0 = (cj * CHUNK_M) / mPerLat;
    const lat1 = ((cj + 1) * CHUNK_M) / mPerLat;
    const sk = this.session.skeleton;

    for (const s of sk.settlements) {
      if (s.lon < lon0 || s.lon >= lon1 || s.lat < lat0 || s.lat >= lat1) continue;
      this.layoutSettlement(s, buckets, exaggerate, caps, seed);
    }
    for (const s of sk.sects) {
      if (s.lon < lon0 || s.lon >= lon1 || s.lat < lat0 || s.lat >= lat1) continue;
      const p = lonLatToXyz(s.lon, s.lat);
      const elev = s.elev ?? sampleElevation(seed, p);
      const surf = surfaceWorld(p, elev, R, exaggerate);
      const sc = Math.max(2, exaggerate * 0.6);
      buckets.pagoda.push({ pos: surf, scale: sc, rot: hashToUnit(seed, s.x, s.y, 5) * Math.PI * 2, up: p });
    }

    // Build InstancedMeshes
    for (const [type, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const geo = this.geos[type];
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, this.mat, list.length);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      const dummy = new THREE.Object3D();
      const up = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const yAxis = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        up.set(it.up.x, it.up.y, it.up.z).normalize();
        quat.setFromUnitVectors(yAxis, up);
        dummy.position.set(it.pos.x, it.pos.y, it.pos.z);
        dummy.quaternion.copy(quat);
        dummy.rotateY(it.rot);
        dummy.scale.setScalar(it.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      meshes.push(mesh);
    }

    // Cap total chunks
    if (this.chunks.size >= caps.maxDetailChunks) {
      // caller will evict
    }

    return { meshes, npcs, ci, cj };
  }

  layoutSettlement(s, buckets, exaggerate, caps, seed) {
    const R = this.R;
    const p0 = lonLatToXyz(s.lon, s.lat);
    const basis = tangentBasis(p0);
    const elev0 = s.elev ?? sampleElevation(seed, p0);
    const count = s.type === 'city' ? 14 : s.type === 'town' ? 9 : 5;
    const spacing = 18;

    // Town hall at center for towns/cities
    if (s.type !== 'village' && buckets.hall.length < caps.maxBuildings) {
      const surf = surfaceWorld(p0, elev0, R, exaggerate);
      buckets.hall.push({
        pos: surf,
        scale: Math.max(1.5, exaggerate * 0.45),
        rot: 0,
        up: p0,
      });
    }

    for (let i = 0; i < count && buckets.house.length < caps.maxBuildings; i++) {
      const ang = (i / count) * Math.PI * 2 + hashToUnit(seed, s.x, i, 2);
      const rad = spacing * (0.6 + (i % 3) * 0.5);
      // Offset in tangent meters → approximate new direction
      const mPerDegLat = 110540;
      const mPerDegLon = 111320 * Math.cos((s.lat * Math.PI) / 180);
      const dLon = (Math.cos(ang) * rad) / mPerDegLon;
      const dLat = (Math.sin(ang) * rad) / mPerDegLat;
      const lon = s.lon + dLon;
      const lat = s.lat + dLat;
      const p = lonLatToXyz(lon, lat);
      const elev = sampleElevation(seed, p);
      if (elev < 0) continue;
      const surf = surfaceWorld(p, elev, R, exaggerate);
      buckets.house.push({
        pos: surf,
        scale: Math.max(1.2, exaggerate * 0.4),
        rot: ang + Math.PI / 2,
        up: p,
      });
    }
  }

  updateRoads(camLon, camLat, exaggerate, caps) {
    const sk = this.session.skeleton;
    const w = sk.meta.width;
    const h = sk.meta.height;
    const R = this.R;
    const seed = this.seed;
    const key = 'roads';
    // Rebuild road overlay occasionally — cheap line segments near camera
    if (this.roadLines.has(key)) {
      const old = this.roadLines.get(key);
      this.group.remove(old);
      old.geometry.dispose();
      old.material.dispose();
      this.roadLines.delete(key);
    }
    const positions = [];
    const maxSeg = caps.mobile ? 400 : 1200;
    let segs = 0;
    for (const road of sk.roads) {
      for (let i = 0; i < road.path.length - 1; i++) {
        const a = road.path[i];
        const b = road.path[i + 1];
        const lonA = (a.x / w) * 360 - 180;
        const latA = 90 - (a.y / h) * 180;
        const lonB = (b.x / w) * 360 - 180;
        const latB = 90 - (b.y / h) * 180;
        // Cull far from camera (~2 deg)
        if (Math.abs(lonA - camLon) > 3 && Math.abs(lonB - camLon) > 3) continue;
        if (Math.abs(latA - camLat) > 3 && Math.abs(latB - camLat) > 3) continue;
        const pa = lonLatToXyz(lonA, latA);
        const pb = lonLatToXyz(lonB, latB);
        const ea = sampleElevation(seed, pa);
        const eb = sampleElevation(seed, pb);
        const sa = surfaceWorld(pa, ea, R, exaggerate);
        const sb = surfaceWorld(pb, eb, R, exaggerate);
        // Lift slightly above terrain
        const lift = 2 * exaggerate;
        positions.push(
          sa.x + pa.x * lift, sa.y + pa.y * lift, sa.z + pa.z * lift,
          sb.x + pb.x * lift, sb.y + pb.y * lift, sb.z + pb.z * lift
        );
        if (++segs >= maxSeg) break;
      }
      if (segs >= maxSeg) break;
    }
    if (positions.length < 6) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xc4a574, linewidth: 2 });
    const line = new THREE.LineSegments(geo, mat);
    this.group.add(line);
    this.roadLines.set(key, line);
  }

  /** Find nearest settlement to a lon/lat. */
  nearestSettlement(lon, lat) {
    const sk = this.session?.skeleton;
    if (!sk?.settlements?.length) return null;
    let best = null;
    let bestD = Infinity;
    for (const s of sk.settlements) {
      const d = (s.lon - lon) ** 2 + (s.lat - lat) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }
}
