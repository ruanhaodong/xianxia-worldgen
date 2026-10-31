/** Vector / spherical helpers. Earth radius default 6371 km. */

export const EARTH_RADIUS_KM = 6371;

export function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function vadd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vsub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vscale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function vdot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vcross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vlen(a) {
  return Math.hypot(a.x, a.y, a.z);
}

export function vnorm(a) {
  const L = vlen(a) || 1;
  return { x: a.x / L, y: a.y / L, z: a.z / L };
}

export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Unit sphere direction -> lon/lat degrees (equirectangular). */
export function xyzToLonLat(n) {
  const lon = (Math.atan2(n.z, n.x) * 180) / Math.PI;
  const lat = (Math.asin(clamp(n.y, -1, 1)) * 180) / Math.PI;
  return { lon, lat };
}

export function lonLatToXyz(lon, lat) {
  const lo = (lon * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  const c = Math.cos(la);
  return { x: c * Math.cos(lo), y: Math.sin(la), z: c * Math.sin(lo) };
}

/** Great-circle approximate distance on unit sphere * radiusKm. */
export function distKm(a, b, radiusKm = EARTH_RADIUS_KM) {
  const d = clamp(vdot(vnorm(a), vnorm(b)), -1, 1);
  return Math.acos(d) * radiusKm;
}
