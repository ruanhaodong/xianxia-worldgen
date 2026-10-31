/**
 * Viewer: 2D equirectangular map + 3D cube-sphere LOD globe.
 * Generation runs in-browser using the same modules as the CLI.
 */
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/controls/OrbitControls.js';
import {
  WorldSession,
  skeletonToRGBA,
  digestWorld,
  EARTH_RADIUS_KM,
} from '../core/worldgen.js';
import { selectLodNodesV2, nodeUvBounds } from '../core/quadtree.js';
import { faceUvToSphere } from '../core/cubesphere.js';
import { BIOME_COLORS } from '../geo/climate.js';
import { vnorm } from '../core/math.js';

const $ = (id) => document.getElementById(id);

let session = null;
let flyMode = false;
let flySpeed = 200; // m/s, up to 1000
const MAX_FLY = 1000;

const layers = {
  showElevation: true,
  showBiome: true,
  showRivers: true,
  showSettlements: true,
  showRoads: true,
  showSects: true,
};

// ---------- 2D map ----------
const mapCanvas = $('map2d');
const mapCtx = mapCanvas.getContext('2d');

function draw2D() {
  if (!session) return;
  const { width, height, rgba } = skeletonToRGBA(session.skeleton, layers);
  mapCanvas.width = width;
  mapCanvas.height = height;
  const img = new ImageData(rgba, width, height);
  // draw scaled to container
  const wrap = $('map2d-wrap');
  const cssW = wrap.clientWidth;
  const cssH = wrap.clientHeight;
  mapCtx.setTransform(1, 0, 0, 1, 0, 0);
  // Fit
  const scale = Math.min(cssW / width, cssH / height);
  mapCanvas.style.width = width * scale + 'px';
  mapCanvas.style.height = height * scale + 'px';
  mapCtx.putImageData(img, 0, 0);
}

// ---------- 3D globe ----------
const globeCanvas = $('globe');
const renderer = new THREE.WebGLRenderer({ canvas: globeCanvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x050814, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050814, 0.00000002);

const camera = new THREE.PerspectiveCamera(55, 1, 1, EARTH_RADIUS_KM * 20 * 1000);
const R = EARTH_RADIUS_KM * 1000; // meters
camera.position.set(0, 0, R * 3);

const controls = new OrbitControls(camera, globeCanvas);
controls.enableDamping = true;
controls.minDistance = R * 1.001;
controls.maxDistance = R * 8;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0x8899bb, 0.55));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
sun.position.set(R * 2, R, R);
scene.add(sun);

const globeGroup = new THREE.Group();
scene.add(globeGroup);

const chunkMeshes = new Map();
const keys = { w: false, a: false, s: false, d: false, shift: false, space: false, ctrl: false };

function elevColor(e, biome) {
  if (layers.showBiome) {
    const c = BIOME_COLORS[biome] || [128, 128, 128];
    return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
  }
  if (e < 0) {
    const t = Math.min(1, -e / 5000);
    return new THREE.Color(0.05, 0.15 + t * 0.2, 0.35 + t * 0.3);
  }
  const t = Math.min(1, e / 5000);
  return new THREE.Color(0.2 + t * 0.6, 0.4 - t * 0.2, 0.15);
}

function buildChunkMesh(chunk) {
  const res = chunk.res;
  const positions = [];
  const colors = [];
  const indices = [];
  const b = chunk.uv;
  const heightScale = 1; // meters already; exaggerate slightly for visibility from space
  const exaggerate = 25;

  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const u = b.u0 + (i / (res - 1)) * (b.u1 - b.u0);
      const v = b.v0 + (j / (res - 1)) * (b.v1 - b.v0);
      const dir = faceUvToSphere(chunk.face, u, v);
      const e = chunk.elevation[j * res + i];
      const bio = chunk.biome[j * res + i];
      const h = (e > -11000 ? e : -11000) * exaggerate;
      const rad = R + h;
      positions.push(dir.x * rad, dir.y * rad, dir.z * rad);
      const col = elevColor(e, bio);
      colors.push(col.r, col.g, col.b);
    }
  }
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const a = j * res + i;
      const c = a + res;
      indices.push(a, a + 1, c);
      indices.push(a + 1, c + 1, c);
    }
  }

  // Skirt: drop outer ring vertices slightly along -normal to hide cracks
  // (already using shared UV edges via continuous sampling; add thin skirt geo)
  const skirtDepth = 800 * exaggerate;
  const baseVertCount = res * res;
  // four edges
  const edges = [];
  for (let i = 0; i < res; i++) edges.push([i, 0], [i, res - 1], [0, i], [res - 1, i]);
  const skirtIndexStart = positions.length / 3;
  const edgeMap = [];
  for (const [i, j] of edges) {
    const idx = j * res + i;
    const u = b.u0 + (i / (res - 1)) * (b.u1 - b.u0);
    const v = b.v0 + (j / (res - 1)) * (b.v1 - b.v0);
    const dir = faceUvToSphere(chunk.face, u, v);
    const e = chunk.elevation[idx];
    const h = (e > -11000 ? e : -11000) * exaggerate - skirtDepth;
    const rad = R + h;
    edgeMap.push(idx);
    positions.push(dir.x * rad, dir.y * rad, dir.z * rad);
    const col = elevColor(e, chunk.biome[idx]);
    colors.push(col.r * 0.5, col.g * 0.5, col.b * 0.5);
  }
  // connect skirt (approximate pairs)
  for (let k = 0; k < edgeMap.length; k++) {
    // skip connecting arbitrary — simple degenerate OK for prototype
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.92,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.key = chunk.key;
  return mesh;
}

function cameraDirOnSphere() {
  const p = camera.position;
  const len = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / len, y: p.y / len, z: p.z / len };
}

function altitudeM() {
  const p = camera.position;
  return Math.hypot(p.x, p.y, p.z) - R;
}

function refreshLod() {
  if (!session) return;
  const dir = cameraDirOnSphere();
  const alt = Math.max(100, altitudeM());
  // farther → coarser; keep global coverage at minLevel
  let maxLevel = 4;
  let minLevel = 2;
  if (alt < R * 0.8) { maxLevel = 5; minLevel = 3; }
  if (alt < R * 0.25) { maxLevel = 6; }
  if (alt < 800000) { maxLevel = 7; }
  if (alt < 80000) { maxLevel = 8; }

  const nodes = selectLodNodesV2(dir, {
    minLevel,
    maxLevel: Math.min(maxLevel, session.config.maxLodLevel ?? 7),
    splitFactor: 2.8,
    radiusKm: EARTH_RADIUS_KM,
  });

  // Prioritize near-camera nodes so the facing hemisphere fills first
  nodes.sort((a, b) => {
    const ca = faceUvToSphere(a.face, (a.x + 0.5) / (1 << a.level), (a.y + 0.5) / (1 << a.level));
    const cb = faceUvToSphere(b.face, (b.x + 0.5) / (1 << b.level), (b.y + 0.5) / (1 << b.level));
    const da = ca.x * dir.x + ca.y * dir.y + ca.z * dir.z;
    const db = cb.x * dir.x + cb.y * dir.y + cb.z * dir.z;
    return db - da;
  });

  const needed = new Set(nodes.map((n) => `${n.face}:${n.level}:${n.x}:${n.y}`));

  for (const [key, mesh] of chunkMeshes) {
    if (!needed.has(key)) {
      globeGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      chunkMeshes.delete(key);
    }
  }

  // Large budget so a full coarse shell appears quickly
  let budget = chunkMeshes.size < 40 ? 48 : 16;
  for (const n of nodes) {
    const key = `${n.face}:${n.level}:${n.x}:${n.y}`;
    if (chunkMeshes.has(key)) continue;
    if (budget-- <= 0) break;
    const chunk = session.getChunk(n.face, n.level, n.x, n.y);
    const mesh = buildChunkMesh(chunk);
    chunkMeshes.set(key, mesh);
    globeGroup.add(mesh);
  }

  $('globe-badge').textContent =
    `3D LOD · 高度 ${ (altitudeM()/1000).toFixed(1) } km · chunks ${chunkMeshes.size} · ${flyMode ? '飞行 ' + flySpeed + ' m/s' : '轨道'}`;
}

function resize() {
  const wrap = $('globe-wrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  draw2D();
}

function updateStats() {
  if (!session) return;
  const s = session.skeleton;
  const d = digestWorld(s);
  $('stats').innerHTML = `
    <div><strong>种子</strong> ${s.meta.seedInput} → ${s.meta.seed}</div>
    <div><strong>摘要</strong> ${d}</div>
    <div><strong>骨架</strong> ${s.meta.width}×${s.meta.height}</div>
    <div><strong>聚落</strong> ${s.settlements.length} · <strong>道路</strong> ${s.roads.length}</div>
    <div><strong>宗门</strong> ${s.sects.length} · <strong>河流</strong> ${s.rivers.length}</div>
    <div><strong>洞府</strong> ${s.caves.length} · <strong>湖泊汇点</strong> ${s.lakes.length}</div>
    <div><strong>半径</strong> ${s.meta.radiusKm} km</div>
  `;
}

function generate() {
  const seed = $('seed').value || '42';
  $('stats').textContent = '生成中…';
  // yield to UI
  setTimeout(() => {
    // clear meshes
    for (const [, mesh] of chunkMeshes) {
      globeGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    chunkMeshes.clear();

    session = new WorldSession(seed, null, {
      skeletonWidth: 256,
      skeletonHeight: 128,
      maxLodLevel: 7,
      chunkResolution: 17,
      cacheSize: 160,
      maxSettlements: 64,
      maxSects: 36,
    });
    updateStats();
    draw2D();
    refreshLod();
  }, 30);
}

function bindLayers() {
  const map = [
    ['ly-elev', 'showElevation'],
    ['ly-biome', 'showBiome'],
    ['ly-rivers', 'showRivers'],
    ['ly-settle', 'showSettlements'],
    ['ly-roads', 'showRoads'],
    ['ly-sects', 'showSects'],
  ];
  for (const [id, key] of map) {
    $(id).addEventListener('change', (e) => {
      layers[key] = e.target.checked;
      draw2D();
      // rebuild chunk colors
      for (const [, mesh] of chunkMeshes) {
        globeGroup.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      chunkMeshes.clear();
      refreshLod();
    });
  }
}

function setupFly() {
  $('btn-fly').addEventListener('click', () => {
    flyMode = !flyMode;
    controls.enabled = !flyMode;
    $('btn-fly').textContent = flyMode
      ? '退出飞行模式'
      : '切换飞行模式 (最高 1000 m/s)';
  });
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w') keys.w = true;
    if (k === 'a') keys.a = true;
    if (k === 's') keys.s = true;
    if (k === 'd') keys.d = true;
    if (e.key === 'Shift') keys.shift = true;
    if (e.key === ' ') { keys.space = true; e.preventDefault(); }
    if (e.key === 'Control') keys.ctrl = true;
    if (k === 'q') flySpeed = Math.max(10, flySpeed / 1.5);
    if (k === 'e') flySpeed = Math.min(MAX_FLY, flySpeed * 1.5);
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w') keys.w = false;
    if (k === 'a') keys.a = false;
    if (k === 's') keys.s = false;
    if (k === 'd') keys.d = false;
    if (e.key === 'Shift') keys.shift = false;
    if (e.key === ' ') keys.space = false;
    if (e.key === 'Control') keys.ctrl = false;
  });
}

let lastT = performance.now();
let lodTick = 0;

function animate(t) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (flyMode) {
    const speed = (keys.shift ? Math.min(MAX_FLY, flySpeed * 3) : flySpeed);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const up = camera.up.clone().normalize();
    const move = new THREE.Vector3();
    if (keys.w) move.add(forward);
    if (keys.s) move.sub(forward);
    if (keys.d) move.add(right);
    if (keys.a) move.sub(right);
    if (keys.space) move.add(up);
    if (keys.ctrl) move.sub(up);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      camera.position.add(move);
      // keep above surface
      const len = camera.position.length();
      const minR = R + 50;
      if (len < minR) camera.position.multiplyScalar(minR / len);
    }
  } else {
    controls.update();
  }

  if (++lodTick % 20 === 0) refreshLod();
  renderer.render(scene, camera);
}

$('btn-generate').addEventListener('click', generate);
bindLayers();
setupFly();
window.addEventListener('resize', resize);
resize();
generate();
requestAnimationFrame(animate);
