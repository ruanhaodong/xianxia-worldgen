/**
 * Procedural low-poly geometries (no external assets).
 */
import * as THREE from '../vendor/three.module.js';

function mergeGeos(geos) {
  // Simple merge into one BufferGeometry via Three.js mergeAttributes pattern
  const merged = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const colors = [];
  const tmpN = new THREE.Vector3();
  for (const g of geos) {
    g.computeVertexNormals();
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const col = g.attributes.color;
    const idx = g.index;
    const pushVert = (i) => {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      else normals.push(0, 1, 0);
      if (col) colors.push(col.getX(i), col.getY(i), col.getZ(i));
      else colors.push(1, 1, 1);
    };
    if (idx) {
      for (let i = 0; i < idx.count; i++) pushVert(idx.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) pushVert(i);
    }
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return merged;
}

function colorGeo(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = r; cols[i * 3 + 1] = g; cols[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

/** Conifer / pine */
export function makeConiferGeo() {
  const trunk = colorGeo(new THREE.CylinderGeometry(0.15, 0.25, 2.2, 5), 0.35, 0.22, 0.12);
  trunk.translate(0, 1.1, 0);
  const layers = [];
  for (let i = 0; i < 4; i++) {
    const h = 2.2 - i * 0.45;
    const r = 1.6 - i * 0.3;
    const cone = colorGeo(new THREE.ConeGeometry(r, 1.8, 6), 0.12 + i * 0.03, 0.35 + i * 0.04, 0.14);
    cone.translate(0, 2.2 + i * 0.9, 0);
    layers.push(cone);
  }
  return mergeGeos([trunk, ...layers]);
}

/** Broadleaf deciduous */
export function makeBroadleafGeo() {
  const trunk = colorGeo(new THREE.CylinderGeometry(0.2, 0.3, 2.5, 5), 0.4, 0.25, 0.14);
  trunk.translate(0, 1.25, 0);
  const canopy = colorGeo(new THREE.IcosahedronGeometry(1.8, 0), 0.2, 0.55, 0.18);
  canopy.translate(0, 3.4, 0);
  const canopy2 = colorGeo(new THREE.IcosahedronGeometry(1.3, 0), 0.25, 0.6, 0.22);
  canopy2.translate(0.5, 3.0, -0.3);
  return mergeGeos([trunk, canopy, canopy2]);
}

/** Bamboo / mist forest stalk cluster */
export function makeBambooGeo() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const r = 0.25 + (i % 2) * 0.15;
    const h = 4 + (i % 3) * 0.8;
    const stalk = colorGeo(new THREE.CylinderGeometry(0.06, 0.08, h, 4), 0.35, 0.55, 0.25);
    stalk.translate(Math.cos(ang) * r, h / 2, Math.sin(ang) * r);
    parts.push(stalk);
    const tip = colorGeo(new THREE.ConeGeometry(0.35, 0.8, 4), 0.25, 0.5, 0.2);
    tip.translate(Math.cos(ang) * r, h + 0.2, Math.sin(ang) * r);
    parts.push(tip);
  }
  return mergeGeos(parts);
}

/** Simple rock */
export function makeRockGeo() {
  const g = colorGeo(new THREE.DodecahedronGeometry(0.7, 0), 0.45, 0.42, 0.38);
  g.scale(1.2, 0.7, 1.0);
  return g;
}

/** Grass blade tuft */
export function makeGrassGeo() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const blade = colorGeo(new THREE.ConeGeometry(0.08, 0.7 + (i % 3) * 0.15, 3), 0.3, 0.65, 0.22);
    const a = (i / 5) * Math.PI * 2;
    blade.translate(Math.cos(a) * 0.12, 0.35, Math.sin(a) * 0.12);
    parts.push(blade);
  }
  return mergeGeos(parts);
}

/** Village house */
export function makeHouseGeo() {
  const body = colorGeo(new THREE.BoxGeometry(3.2, 2.2, 2.6), 0.72, 0.55, 0.38);
  body.translate(0, 1.1, 0);
  const roof = colorGeo(new THREE.ConeGeometry(2.6, 1.4, 4), 0.55, 0.22, 0.16);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 2.9, 0);
  const door = colorGeo(new THREE.BoxGeometry(0.7, 1.2, 0.15), 0.25, 0.15, 0.1);
  door.translate(0, 0.6, 1.35);
  return mergeGeos([body, roof, door]);
}

/** Larger town hall / inn */
export function makeTownHallGeo() {
  const body = colorGeo(new THREE.BoxGeometry(5, 3.2, 4), 0.65, 0.5, 0.35);
  body.translate(0, 1.6, 0);
  const roof = colorGeo(new THREE.BoxGeometry(5.6, 0.4, 4.6), 0.4, 0.18, 0.12);
  roof.translate(0, 3.4, 0);
  const tower = colorGeo(new THREE.CylinderGeometry(0.6, 0.7, 2.5, 6), 0.6, 0.45, 0.3);
  tower.translate(1.8, 4.0, 0);
  const tip = colorGeo(new THREE.ConeGeometry(0.9, 1.2, 6), 0.5, 0.2, 0.15);
  tip.translate(1.8, 5.6, 0);
  return mergeGeos([body, roof, tower, tip]);
}

/** Pagoda / sect temple */
export function makePagodaGeo() {
  const parts = [];
  const levels = 5;
  for (let i = 0; i < levels; i++) {
    const w = 4.5 - i * 0.55;
    const y = 1.2 + i * 2.0;
    const floor = colorGeo(new THREE.BoxGeometry(w, 1.4, w), 0.75, 0.7, 0.55);
    floor.translate(0, y, 0);
    parts.push(floor);
    const eave = colorGeo(new THREE.ConeGeometry(w * 0.75, 0.7, 4), 0.7, 0.2, 0.15);
    eave.rotateY(Math.PI / 4);
    eave.translate(0, y + 0.9, 0);
    parts.push(eave);
  }
  const spire = colorGeo(new THREE.ConeGeometry(0.4, 1.5, 6), 0.85, 0.7, 0.2);
  spire.translate(0, 1.2 + levels * 2.0 + 0.5, 0);
  parts.push(spire);
  return mergeGeos(parts);
}

/**
 * Low-poly humanoid: torso + head + 4 limbs as separate meshes in a Group.
 * Limb pivots allow procedural walk swing.
 */
export function makeHumanoid(colors = {}) {
  const skin = colors.skin || 0xe8c4a0;
  const shirt = colors.shirt || 0x4a6fa5;
  const pants = colors.pants || 0x3a3a4a;
  const group = new THREE.Group();

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.7, 0.28),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 })
  );
  torso.position.y = 1.15;
  group.add(torso);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.32, 0.32),
    new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 })
  );
  head.position.y = 1.7;
  group.add(head);

  const makeLimb = (w, h, d, color, pivotY) => {
    const pivot = new THREE.Group();
    pivot.position.y = pivotY;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
    );
    mesh.position.y = -h / 2;
    pivot.add(mesh);
    return pivot;
  };

  const armL = makeLimb(0.14, 0.55, 0.14, shirt, 1.4);
  armL.position.x = 0.35;
  const armR = makeLimb(0.14, 0.55, 0.14, shirt, 1.4);
  armR.position.x = -0.35;
  const legL = makeLimb(0.16, 0.7, 0.16, pants, 0.8);
  legL.position.x = 0.14;
  const legR = makeLimb(0.16, 0.7, 0.16, pants, 0.8);
  legR.position.x = -0.14;

  group.add(armL, armR, legL, legR);
  group.userData.limbs = { armL, armR, legL, legR };
  group.userData.height = 1.8;
  return group;
}

export function applyWalkPose(humanoid, phase, speed = 1) {
  const { armL, armR, legL, legR } = humanoid.userData.limbs || {};
  if (!legL) return;
  const a = Math.sin(phase) * 0.7 * Math.min(1.5, speed);
  legL.rotation.x = a;
  legR.rotation.x = -a;
  if (armL) armL.rotation.x = -a * 0.8;
  if (armR) armR.rotation.x = a * 0.8;
}

/** Shared materials for InstancedMesh */
export function makeInstanceMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true,
  });
}
