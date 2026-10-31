/**
 * Third-person player mode with WASD + mouse look + touch joystick.
 */
import * as THREE from '../vendor/three.module.js';
import { lonLatToXyz, xyzToLonLat, vnorm } from '../core/math.js';
import { sampleElevation } from '../geo/terrain.js';
import { seedFrom } from '../core/hash.js';
import { makeHumanoid, applyWalkPose } from './geometries.js';
import { surfaceWorld, tangentBasis } from './groundDetail.js';

export class PlayerController {
  constructor(scene, camera, canvas, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.R = opts.R;
    this.getExaggerate = opts.getExaggerate || (() => 4);
    this.session = null;
    this.seed = 1;
    this.active = false;
    this.mesh = null;
    this.lon = 0;
    this.lat = 0;
    this.yaw = 0; // radians, around radial up
    this.pitch = 0.25;
    this.velY = 0; // jump along up
    this.onGround = true;
    this.phase = 0;
    this.keys = { w: false, a: false, s: false, d: false, shift: false, space: false };
    this.lookDragging = false;
    this.lastLook = null;
    this.joy = { x: 0, y: 0, active: false };
    this.walkSpeed = 6; // m/s
    this.runSpeed = 14;
    this.camDist = 12;
    this._bound = false;
  }

  setSession(session) {
    this.session = session;
    this.seed = seedFrom(session.seedInput);
  }

  enter(lon, lat) {
    if (!this.session) return;
    this.active = true;
    this.lon = lon;
    this.lat = lat;
    this.yaw = 0;
    this.pitch = 0.35;
    this.velY = 0;
    if (!this.mesh) {
      this.mesh = makeHumanoid({ shirt: 0x2d6cdf, pants: 0x1a1a28, skin: 0xf0d0b0 });
      this.scene.add(this.mesh);
    }
    this.mesh.visible = true;
    const exaggerate = this.getExaggerate();
    this.mesh.scale.setScalar(Math.max(1.5, exaggerate * 0.5));
    this.snapToSurface();
    this.bindInput();
    this.showTouchUI(true);
  }

  exit() {
    this.active = false;
    if (this.mesh) this.mesh.visible = false;
    this.showTouchUI(false);
    this.joy = { x: 0, y: 0, active: false };
  }

  snapToSurface() {
    const p = lonLatToXyz(this.lon, this.lat);
    const elev = sampleElevation(this.seed, p);
    const exaggerate = this.getExaggerate();
    const R = this.R;
    // player feet slightly above surface
    const lift = 0.9 * Math.max(1, exaggerate * 0.4);
    const surf = surfaceWorld(p, elev, R, exaggerate);
    this.mesh.position.set(
      surf.x + p.x * lift,
      surf.y + p.y * lift,
      surf.z + p.z * lift
    );
    this._up = p;
  }

  bindInput() {
    if (this._bound) return;
    this._bound = true;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  _onKeyDown = (e) => {
    if (!this.active) return;
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') this.keys.w = true;
    if (k === 'a' || e.key === 'ArrowLeft') this.keys.a = true;
    if (k === 's' || e.key === 'ArrowDown') this.keys.s = true;
    if (k === 'd' || e.key === 'ArrowRight') this.keys.d = true;
    if (e.key === 'Shift') this.keys.shift = true;
    if (e.key === ' ') { this.keys.space = true; e.preventDefault(); }
  };

  _onKeyUp = (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') this.keys.w = false;
    if (k === 'a' || e.key === 'ArrowLeft') this.keys.a = false;
    if (k === 's' || e.key === 'ArrowDown') this.keys.s = false;
    if (k === 'd' || e.key === 'ArrowRight') this.keys.d = false;
    if (e.key === 'Shift') this.keys.shift = false;
    if (e.key === ' ') this.keys.space = false;
  };

  _onPointerDown = (e) => {
    if (!this.active) return;
    // Right half of screen = look; left handled by joystick DOM
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > rect.width * 0.4) {
      this.lookDragging = true;
      this.lastLook = { x: e.clientX, y: e.clientY };
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
  };

  _onPointerMove = (e) => {
    if (!this.active || !this.lookDragging || !this.lastLook) return;
    const dx = e.clientX - this.lastLook.x;
    const dy = e.clientY - this.lastLook.y;
    this.lastLook = { x: e.clientX, y: e.clientY };
    this.yaw -= dx * 0.005;
    this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch + dy * 0.004));
  };

  _onPointerUp = () => {
    this.lookDragging = false;
    this.lastLook = null;
  };

  showTouchUI(show) {
    const el = document.getElementById('touch-controls');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  setJoystick(x, y) {
    this.joy.x = x;
    this.joy.y = y;
    this.joy.active = Math.hypot(x, y) > 0.05;
  }

  tick(dt) {
    if (!this.active || !this.mesh) return;
    const exaggerate = this.getExaggerate();
    const mPerDegLat = 110540;
    const mPerDegLon = 111320 * Math.cos((this.lat * Math.PI) / 180) || 1;

    let mx = 0;
    let mz = 0; // forward
    if (this.keys.w) mz += 1;
    if (this.keys.s) mz -= 1;
    if (this.keys.a) mx -= 1;
    if (this.keys.d) mx += 1;
    if (this.joy.active) {
      mx += this.joy.x;
      mz += -this.joy.y; // joystick up = forward
    }
    const moving = Math.hypot(mx, mz) > 0.01;
    const speed = (this.keys.shift ? this.runSpeed : this.walkSpeed) * Math.max(1, exaggerate * 0.35);

    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      // yaw: 0 = north-ish in lon/lat offset
      const forwardLon = Math.sin(this.yaw);
      const forwardLat = Math.cos(this.yaw);
      const rightLon = Math.cos(this.yaw);
      const rightLat = -Math.sin(this.yaw);
      const dLon = (forwardLon * mz + rightLon * mx) * (speed * dt) / mPerDegLon;
      const dLat = (forwardLat * mz + rightLat * mx) * (speed * dt) / mPerDegLat;
      this.lon += dLon;
      this.lat = Math.max(-85, Math.min(85, this.lat + dLat));
      this.phase += dt * 8 * (this.keys.shift ? 1.6 : 1);
      applyWalkPose(this.mesh, this.phase, this.keys.shift ? 1.5 : 1);
    } else {
      applyWalkPose(this.mesh, 0, 0);
    }

    // Jump
    const p = lonLatToXyz(this.lon, this.lat);
    const elev = sampleElevation(this.seed, p);
    const R = this.R;
    const liftBase = 0.9 * Math.max(1, exaggerate * 0.4);
    if (this.keys.space && this.onGround) {
      this.velY = 8 * Math.max(1, exaggerate * 0.3);
      this.onGround = false;
    }
    this.velY -= 20 * dt * Math.max(1, exaggerate * 0.3);
    let lift = liftBase + Math.max(0, this._air || 0);
    this._air = (this._air || 0) + this.velY * dt;
    if (this._air <= 0) {
      this._air = 0;
      this.velY = 0;
      this.onGround = true;
    }
    lift = liftBase + this._air;

    const surf = surfaceWorld(p, elev, R, exaggerate);
    this.mesh.position.set(
      surf.x + p.x * lift,
      surf.y + p.y * lift,
      surf.z + p.z * lift
    );
    this._up = p;

    // Orient character
    const basis = tangentBasis(p);
    const face = new THREE.Vector3(
      basis.east.x * Math.sin(this.yaw) + basis.north.x * Math.cos(this.yaw),
      basis.east.y * Math.sin(this.yaw) + basis.north.y * Math.cos(this.yaw),
      basis.east.z * Math.sin(this.yaw) + basis.north.z * Math.cos(this.yaw)
    );
    const up = new THREE.Vector3(p.x, p.y, p.z).normalize();
    this.mesh.up.copy(up);
    const lookTarget = this.mesh.position.clone().add(face);
    this.mesh.lookAt(lookTarget);
    this.mesh.rotateY(Math.PI);

    // Third-person camera
    const back = face.clone().multiplyScalar(-1);
    const camOffset = back.multiplyScalar(this.camDist * Math.max(1, exaggerate * 0.4))
      .add(up.clone().multiplyScalar(this.camDist * 0.45 * Math.max(1, exaggerate * 0.3) + this.pitch * 8));
    // pitch adjusts by rotating offset in the plane of back×up
    const right = new THREE.Vector3().crossVectors(face, up).normalize();
    // simple: elevate with pitch
    this.camera.position.copy(this.mesh.position).add(camOffset);
    this.camera.up.copy(up);
    this.camera.lookAt(this.mesh.position.clone().add(up.clone().multiplyScalar(2 * Math.max(1, exaggerate * 0.3))));
  }

  /** Drop at clicked globe point or nearest settlement. */
  static pickLonLatFromCamera(camera, session, ground) {
    // Use camera direction on sphere
    const dir = vnorm({
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    });
    let { lon, lat } = xyzToLonLat(dir);
    if (ground) {
      const near = ground.nearestSettlement(lon, lat);
      // Prefer settlement if within ~2 deg
      if (near) {
        const d = Math.hypot(near.lon - lon, near.lat - lat);
        if (d < 5) return { lon: near.lon, lat: near.lat, settlement: near };
      }
    }
    return { lon, lat, settlement: null };
  }
}

/** Wire DOM joystick + look pad. */
export function setupTouchControls(player) {
  const root = document.getElementById('touch-controls');
  if (!root) return;
  const stick = document.getElementById('joy-stick');
  const base = document.getElementById('joy-base');
  if (!base || !stick) return;

  let active = false;
  let origin = null;
  const maxR = 50;

  const setStick = (dx, dy) => {
    const len = Math.hypot(dx, dy) || 1;
    const c = Math.min(1, maxR / len);
    const x = dx * c;
    const y = dy * c;
    stick.style.transform = `translate(${x}px, ${y}px)`;
    player.setJoystick(x / maxR, y / maxR);
  };

  base.addEventListener('pointerdown', (e) => {
    active = true;
    origin = { x: e.clientX, y: e.clientY };
    try { base.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
    e.stopPropagation();
  });
  base.addEventListener('pointermove', (e) => {
    if (!active || !origin) return;
    setStick(e.clientX - origin.x, e.clientY - origin.y);
    e.preventDefault();
  });
  const end = () => {
    active = false;
    origin = null;
    stick.style.transform = 'translate(0,0)';
    player.setJoystick(0, 0);
  };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
}
