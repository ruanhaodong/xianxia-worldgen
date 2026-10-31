/**
 * Deterministic NPC humanoids that wander along roads / in towns.
 */
import * as THREE from '../vendor/three.module.js';
import { hashToUnit, seedFrom } from '../core/hash.js';
import { lonLatToXyz, xyzToLonLat, vnorm } from '../core/math.js';
import { sampleElevation } from '../geo/terrain.js';
import { makeHumanoid, applyWalkPose } from './geometries.js';
import { surfaceWorld, tangentBasis } from './groundDetail.js';

const SHIRTS = [0x4a6fa5, 0xc45c3e, 0x3d8b6e, 0x8b6bb5, 0xc4a035, 0x5a5a5a];
const PANTS = [0x2a2a35, 0x3a4a3a, 0x4a3a2a, 0x2a3a4a];

export class NpcSystem {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'npcs';
    scene.add(this.group);
    this.npcs = [];
    this.session = null;
    this.seed = 1;
    this.R = opts.R;
    this.getExaggerate = opts.getExaggerate || (() => 4);
    this.maxNpcs = opts.maxNpcs || 24;
    this.enabled = false;
  }

  setSession(session) {
    this.session = session;
    this.seed = seedFrom(session.seedInput);
    this.clear();
  }

  clear() {
    for (const n of this.npcs) this.group.remove(n.mesh);
    this.npcs = [];
  }

  /**
   * Spawn NPCs near camera lon/lat from settlements + road waypoints.
   */
  update(camLon, camLat, altitudeM, groundAlt = 2500) {
    if (!this.session) return;
    if (altitudeM > groundAlt) {
      if (this.enabled) { this.clear(); this.enabled = false; }
      return;
    }
    this.enabled = true;

    // Respawn when camera moved far
    if (this.npcs.length && this._anchor) {
      const d = Math.hypot(camLon - this._anchor.lon, camLat - this._anchor.lat);
      if (d < 0.8) return; // still near
      this.clear();
    }
    this._anchor = { lon: camLon, lat: camLat };
    this.spawnNear(camLon, camLat);
  }

  spawnNear(camLon, camLat) {
    const sk = this.session.skeleton;
    const seed = this.seed;
    const R = this.R;
    const exaggerate = this.getExaggerate();
    const candidates = [];

    for (const s of sk.settlements) {
      if (Math.abs(s.lon - camLon) > 1.5 || Math.abs(s.lat - camLat) > 1.5) continue;
      const n = s.type === 'city' ? 6 : s.type === 'town' ? 4 : 2;
      for (let i = 0; i < n; i++) {
        candidates.push({
          lon: s.lon + (hashToUnit(seed, s.x, i, 40) - 0.5) * 0.08,
          lat: s.lat + (hashToUnit(seed, s.y, i, 41) - 0.5) * 0.08,
          kind: 'town',
          id: s.x * 1000 + i,
        });
      }
    }

    // Road walkers
    const w = sk.meta.width;
    const h = sk.meta.height;
    for (const road of sk.roads) {
      if (candidates.length > this.maxNpcs * 2) break;
      const mid = road.path[(road.path.length / 2) | 0];
      if (!mid) continue;
      const lon = (mid.x / w) * 360 - 180;
      const lat = 90 - (mid.y / h) * 180;
      if (Math.abs(lon - camLon) > 1.2 || Math.abs(lat - camLat) > 1.2) continue;
      candidates.push({
        lon, lat, kind: 'road',
        path: road.path.map((pt) => ({
          lon: (pt.x / w) * 360 - 180,
          lat: 90 - (pt.y / h) * 180,
        })),
        id: mid.x * 10000 + mid.y,
      });
    }

    candidates.sort((a, b) => {
      const da = (a.lon - camLon) ** 2 + (a.lat - camLat) ** 2;
      const db = (b.lon - camLon) ** 2 + (b.lat - camLat) ** 2;
      return da - db;
    });

    const take = candidates.slice(0, this.maxNpcs);
    for (const c of take) {
      const shirt = SHIRTS[(hashToUnit(seed, c.id, 1) * SHIRTS.length) | 0];
      const pants = PANTS[(hashToUnit(seed, c.id, 2) * PANTS.length) | 0];
      const mesh = makeHumanoid({ shirt, pants });
      const scale = Math.max(1.5, exaggerate * 0.5);
      mesh.scale.setScalar(scale);

      const p = lonLatToXyz(c.lon, c.lat);
      const elev = sampleElevation(seed, p);
      if (elev < 0) continue;
      const surf = surfaceWorld(p, elev, R, exaggerate);
      mesh.position.set(surf.x, surf.y, surf.z);
      this.orientOnSphere(mesh, p);

      const npc = {
        mesh,
        lon: c.lon,
        lat: c.lat,
        phase: hashToUnit(seed, c.id, 9) * Math.PI * 2,
        speed: 0.8 + hashToUnit(seed, c.id, 10) * 1.2, // m/s local
        path: c.path || null,
        pathIdx: 0,
        wanderAngle: hashToUnit(seed, c.id, 11) * Math.PI * 2,
        kind: c.kind,
        dir: p,
      };
      this.group.add(mesh);
      this.npcs.push(npc);
    }
  }

  orientOnSphere(mesh, up) {
    const u = new THREE.Vector3(up.x, up.y, up.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
    mesh.quaternion.copy(q);
  }

  tick(dt) {
    if (!this.enabled || !this.npcs.length) return;
    const seed = this.seed;
    const R = this.R;
    const exaggerate = this.getExaggerate();
    const mPerDegLat = 110540;
    for (const n of this.npcs) {
      n.phase += dt * 6 * n.speed;
      applyWalkPose(n.mesh, n.phase, n.speed);

      let dLon = 0;
      let dLat = 0;
      if (n.path && n.path.length > 1) {
        const target = n.path[n.pathIdx % n.path.length];
        const dl = target.lon - n.lon;
        const db = target.lat - n.lat;
        const dist = Math.hypot(dl, db) + 1e-9;
        if (dist < 0.01) {
          n.pathIdx = (n.pathIdx + 1) % n.path.length;
        } else {
          const step = (n.speed * dt) / mPerDegLat; // rough degrees
          dLon = (dl / dist) * step;
          dLat = (db / dist) * step;
        }
      } else {
        // wander
        n.wanderAngle += (hashToUnit(seed, (n.phase * 10) | 0, 3) - 0.5) * dt * 0.5;
        const step = (n.speed * dt) / mPerDegLat;
        dLon = Math.cos(n.wanderAngle) * step;
        dLat = Math.sin(n.wanderAngle) * step;
      }
      n.lon += dLon;
      n.lat += dLat;
      const p = lonLatToXyz(n.lon, n.lat);
      const elev = sampleElevation(seed, p);
      const surf = surfaceWorld(p, elev, R, exaggerate);
      n.mesh.position.set(surf.x, surf.y, surf.z);
      n.dir = p;
      this.orientOnSphere(n.mesh, p);

      // Face movement direction in tangent plane
      if (dLon !== 0 || dLat !== 0) {
        const basis = tangentBasis(p);
        const move = new THREE.Vector3(
          basis.east.x * dLon + basis.north.x * dLat,
          basis.east.y * dLon + basis.north.y * dLat,
          basis.east.z * dLon + basis.north.z * dLat
        ).normalize();
        if (move.lengthSq() > 0.01) {
          const look = new THREE.Vector3().copy(n.mesh.position).add(move);
          // keep up radial
          const up = new THREE.Vector3(p.x, p.y, p.z);
          n.mesh.up.copy(up);
          n.mesh.lookAt(look);
          // lookAt uses -Z forward; humanoid faces +Z-ish — rotate
          n.mesh.rotateY(Math.PI);
        }
      }
    }
  }
}
