/**
 * Viewer: 2D map + 3D cube-sphere LOD + ground detail + NPCs + player mode.
 */
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/controls/OrbitControls.js';
import {
  WorldSession,
  skeletonToRGBA,
  digestWorld,
  EARTH_RADIUS_KM,
} from '../core/worldgen.js';
import { selectLodNodesV2 } from '../core/quadtree.js';
import { faceUvToSphere } from '../core/cubesphere.js';
import { BIOME_COLORS } from '../geo/climate.js';
import { xyzToLonLat } from '../core/math.js';
import { GroundDetailSystem, GROUND_ALT_M, mobileCaps } from './groundDetail.js';
import { NpcSystem } from './npcs.js';
import { PlayerController, setupTouchControls } from './player.js';

const $ = (id) => document.getElementById(id);
const caps = mobileCaps();

let session = null;
let flyMode = false;
let playerMode = false;
let flySpeed = 200;
const MAX_FLY = 1000;

const layers = {
  showElevation: true,
  showBiome: true,
  showRivers: true,
  showSettlements: true,
  showRoads: true,
  showSects: true,
};

// Dynamic height exaggeration: strong from space, modest near ground
function currentExaggerate(alt) {
  if (alt < 3000) return 2.2;
  if (alt < 30000) return 2.2 + (25 - 2.2) * ((alt - 3000) / 27000);
  if (alt < 300000) return 25;
  return 25;
}
let lastExag = 25;
let forceRebuild = false;

// ---------- 2D map ----------
const mapCanvas = $('map2d');
const mapCtx = mapCanvas.getContext('2d');

function draw2D() {
  if (!session) return;
  const { width, height, rgba } = skeletonToRGBA(session.skeleton, layers);
  mapCanvas.width = width;
  mapCanvas.height = height;
  const wrap = $('map2d-wrap');
  const cssW = wrap.clientWidth;
  const cssH = wrap.clientHeight;
  mapCtx.setTransform(1, 0, 0, 1, 0, 0);
  const scale = Math.min(cssW / width, cssH / height);
  mapCanvas.style.width = width * scale + 'px';
  mapCanvas.style.height = height * scale + 'px';
  mapCtx.putImageData(imgData(rgba, width, height), 0, 0);
}

function imgData(rgba, w, h) {
  return new ImageData(rgba, w, h);
}

// ---------- 3D globe ----------
const globeCanvas = $('globe');
const renderer = new THREE.WebGLRenderer({
  canvas: globeCanvas,
  antialias: !caps.mobile,
  alpha: false,
  powerPreference: caps.mobile ? 'low-power' : 'high-performance',
});
renderer.setPixelRatio(caps.pixelRatio);
renderer.setClearColor(0x87b5e0, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x87b5e0, 0.000000015);

const camera = new THREE.PerspectiveCamera(55, 1, 1, EARTH_RADIUS_KM * 20 * 1000);
const R = EARTH_RADIUS_KM * 1000;
camera.position.set(0, 0, R * 3);
camera.near = 0.5;
camera.far = R * 20;

const controls = new OrbitControls(camera, globeCanvas);
controls.enableDamping = true;
controls.minDistance = R + 3;
controls.maxDistance = R * 8;
controls.target.set(0, 0, 0);
controls.zoomSpeed = caps.mobile ? 1.2 : 1.0;

// Lighting
const hemi = new THREE.HemisphereLight(0xb1d0ff, 0x3a2a18, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
sun.position.set(R * 2, R, R);
scene.add(sun);
const fill = new THREE.AmbientLight(0x8899bb, 0.35);
scene.add(fill);

// Sky dome (simple)
const skyGeo = new THREE.SphereGeometry(R * 12, 24, 16);
const skyMat = new THREE.MeshBasicMaterial({
  color: 0x6aa6d8,
  side: THREE.BackSide,
  depthWrite: false,
});
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);

// Mist volume near peaks — soft sphere particles parented later; use fog density tweak
let mistDensity = 0.000000015;

const globeGroup = new THREE.Group();
scene.add(globeGroup);

const chunkMeshes = new Map();
const keys = { w: false, a: false, s: false, d: false, shift: false, space: false, ctrl: false };

const getExag = () => currentExaggerate(Math.max(10, altitudeM()));

const ground = new GroundDetailSystem(scene, { R, getExaggerate: getExag });
const npcs = new NpcSystem(scene, {
  R,
  getExaggerate: getExag,
  maxNpcs: caps.mobile ? 12 : 24,
});
const player = new PlayerController(scene, camera, globeCanvas, {
  R,
  getExaggerate: getExag,
});

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

function buildChunkMesh(chunk, exaggerate) {
  const res = chunk.res;
  const positions = [];
  const colors = [];
  const indices = [];
  const b = chunk.uv;

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

  const skirtDepth = 800 * exaggerate;
  const edges = [];
  for (let i = 0; i < res; i++) edges.push([i, 0], [i, res - 1], [0, i], [res - 1, i]);
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
  void edgeMap;

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

function clearChunks() {
  for (const [, mesh] of chunkMeshes) {
    globeGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  chunkMeshes.clear();
}

function refreshLod() {
  if (!session) return;
  const dir = cameraDirOnSphere();
  const alt = Math.max(10, altitudeM());
  const exaggerate = currentExaggerate(alt);

  if (Math.abs(exaggerate - lastExag) / lastExag > 0.2 || forceRebuild) {
    clearChunks();
    lastExag = exaggerate;
    forceRebuild = false;
  }

  // Fog / sky for ground view
  if (alt < GROUND_ALT_M) {
    mistDensity = 0.00012;
    scene.fog.density = mistDensity;
    scene.fog.color.setHex(0xb8d4e8);
    renderer.setClearColor(0xb8d4e8, 1);
    skyMat.color.setHex(0xa8c8e8);
    // Near clip for ground
    camera.near = 0.5;
    camera.far = Math.max(5000, alt * 40 + caps.drawDistance * 20);
    camera.updateProjectionMatrix();
  } else if (alt < 80000) {
    scene.fog.density = 0.00000008;
    scene.fog.color.setHex(0x6a90b8);
    renderer.setClearColor(0x6a90b8, 1);
    camera.near = Math.max(1, alt * 0.01);
    camera.far = R * 8;
    camera.updateProjectionMatrix();
  } else {
    scene.fog.density = 0.000000015;
    scene.fog.color.setHex(0x050814);
    renderer.setClearColor(0x050814, 1);
    skyMat.color.setHex(0x050814);
    camera.near = Math.max(100, alt * 0.02);
    camera.far = R * 20;
    camera.updateProjectionMatrix();
  }

  let maxLevel = 4;
  let minLevel = 2;
  if (alt < R * 0.8) { maxLevel = 5; minLevel = 3; }
  if (alt < R * 0.25) { maxLevel = 6; }
  if (alt < 800000) { maxLevel = 7; }
  if (alt < 80000) { maxLevel = 8; }
  if (alt < 8000) { maxLevel = 9; }
  if (alt < 2000) { maxLevel = 10; }

  const nodes = selectLodNodesV2(dir, {
    minLevel,
    maxLevel: Math.min(maxLevel, (session.config.maxLodLevel ?? 7) + (alt < 5000 ? 2 : 0)),
    splitFactor: alt < 5000 ? 2.2 : 2.8,
    radiusKm: EARTH_RADIUS_KM,
  });

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

  let budget = chunkMeshes.size < 40 ? (caps.mobile ? 24 : 48) : (caps.mobile ? 8 : 16);
  for (const n of nodes) {
    const key = `${n.face}:${n.level}:${n.x}:${n.y}`;
    if (chunkMeshes.has(key)) continue;
    if (budget-- <= 0) break;
    const chunk = session.getChunk(n.face, n.level, n.x, n.y);
    const mesh = buildChunkMesh(chunk, exaggerate);
    chunkMeshes.set(key, mesh);
    globeGroup.add(mesh);
  }

  // Ground detail + NPCs
  ground.update(camera.position, alt);
  const { lon, lat } = xyzToLonLat(dir);
  npcs.update(lon, lat, alt, GROUND_ALT_M);

  const modeLabel = playerMode ? '地面角色' : flyMode ? `飞行 ${flySpeed} m/s` : '轨道';
  $('globe-badge').textContent =
    `3D LOD · 高度 ${(alt / 1000).toFixed(2)} km · chunks ${chunkMeshes.size} · 细节 ${ground.chunks.size} · ${modeLabel}`;
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
  setTimeout(() => {
    clearChunks();
    ground.clearAll();
    npcs.clear();
    if (playerMode) exitPlayerMode();

    session = new WorldSession(seed, null, {
      skeletonWidth: 256,
      skeletonHeight: 128,
      maxLodLevel: 8,
      chunkResolution: 17,
      cacheSize: caps.mobile ? 100 : 160,
      maxSettlements: 64,
      maxSects: 36,
    });
    ground.setSession(session);
    npcs.setSession(session);
    player.setSession(session);
    updateStats();
    draw2D();
    forceRebuild = true;
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
      clearChunks();
      refreshLod();
    });
  }
}

function setupFly() {
  $('btn-fly').addEventListener('click', () => {
    if (playerMode) exitPlayerMode();
    flyMode = !flyMode;
    controls.enabled = !flyMode;
    $('btn-fly').textContent = flyMode
      ? '退出飞行模式'
      : '切换飞行模式 (最高 1000 m/s)';
  });
  window.addEventListener('keydown', (e) => {
    if (playerMode) return;
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

function enterPlayerMode() {
  if (!session) return;
  if (flyMode) {
    flyMode = false;
    $('btn-fly').textContent = '切换飞行模式 (最高 1000 m/s)';
  }
  const pick = PlayerController.pickLonLatFromCamera(camera, session, ground);
  // Dive camera near surface first so exaggerate drops
  const p = {
    x: Math.cos((pick.lat * Math.PI) / 180) * Math.cos((pick.lon * Math.PI) / 180),
    y: Math.sin((pick.lat * Math.PI) / 180),
    z: Math.cos((pick.lat * Math.PI) / 180) * Math.sin((pick.lon * Math.PI) / 180),
  };
  // Place camera ~800m above for ground spawn
  const rad = R + 600;
  camera.position.set(p.x * rad, p.y * rad, p.z * rad);
  controls.target.set(0, 0, 0);
  camera.lookAt(0, 0, 0);
  forceRebuild = true;
  refreshLod();

  playerMode = true;
  controls.enabled = false;
  player.enter(pick.lon, pick.lat);
  $('btn-ground').textContent = '退出地面 / 返回轨道';
  $('btn-ground').classList.add('active');
  const hint = pick.settlement
    ? `已进入聚落附近（${pick.settlement.type}）`
    : '已进入地面（点击处 / 当前视角）';
  $('mode-hint').textContent = hint;
}

function exitPlayerMode() {
  playerMode = false;
  player.exit();
  controls.enabled = !flyMode;
  // Lift camera a bit for orbit
  const len = camera.position.length();
  const want = Math.max(len, R + 5000);
  camera.position.multiplyScalar(want / len);
  controls.target.set(0, 0, 0);
  $('btn-ground').textContent = '进入地面 / 成为角色';
  $('btn-ground').classList.remove('active');
  $('mode-hint').textContent = '';
  forceRebuild = true;
}

function setupPlayerUI() {
  $('btn-ground').addEventListener('click', () => {
    if (playerMode) exitPlayerMode();
    else enterPlayerMode();
  });
  setupTouchControls(player);
}

let lastT = performance.now();
let lodTick = 0;

function animate(t) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (playerMode) {
    player.tick(dt);
    npcs.tick(dt);
  } else if (flyMode) {
    const speed = keys.shift ? Math.min(MAX_FLY, flySpeed * 3) : flySpeed;
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
      const len = camera.position.length();
      const minR = R + 5;
      if (len < minR) camera.position.multiplyScalar(minR / len);
    }
  } else {
    controls.update();
  }

  if (!playerMode) npcs.tick(dt);

  if (++lodTick % (caps.mobile ? 30 : 20) === 0) refreshLod();
  // Keep ground streaming while in player mode more often
  if (playerMode && lodTick % 10 === 0) {
    const alt = Math.max(10, altitudeM());
    ground.update(camera.position, alt);
    const dir = cameraDirOnSphere();
    const { lon, lat } = xyzToLonLat(dir);
    npcs.update(lon, lat, alt, GROUND_ALT_M);
  }

  renderer.render(scene, camera);
}

$('btn-generate').addEventListener('click', generate);
bindLayers();
setupFly();
setupPlayerUI();
window.addEventListener('resize', resize);
resize();
generate();
requestAnimationFrame(animate);

// Expose for playwright tests
window.__xianxia = {
  getAltitude: () => altitudeM(),
  enterPlayer: () => enterPlayerMode(),
  exitPlayer: () => exitPlayerMode(),
  isPlayer: () => playerMode,
  diveToGround: () => {
    // Move camera above a known settlement (target stays at origin for float stability)
    if (!session?.skeleton?.settlements?.length) return false;
    const s = session.skeleton.settlements[0];
    const lat = s.lat * Math.PI / 180;
    const lon = s.lon * Math.PI / 180;
    const p = {
      x: Math.cos(lat) * Math.cos(lon),
      y: Math.sin(lat),
      z: Math.cos(lat) * Math.sin(lon),
    };
    const rad = R + 500;
    controls.enabled = false;
    camera.position.set(p.x * rad, p.y * rad, p.z * rad);
    controls.target.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    controls.enabled = !playerMode && !flyMode;
    forceRebuild = true;
    refreshLod();
    // Nudge controls spherical to match
    controls.update();
    return true;
  },
  getDetailChunks: () => ground.chunks.size,
  getNpcCount: () => npcs.npcs.length,
};
