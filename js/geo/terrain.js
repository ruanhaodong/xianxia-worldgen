/**
 * Procedural terrain field on the unit sphere.
 * Pipeline order: continents → elevation/plates → detail → xianxia peaks/gorges.
 * Returns height in meters above sea level (negative = ocean depth).
 */
import { fbm3, ridged3, warpedFbm3 } from '../core/noise.js';
import { clamp, smoothstep } from '../core/math.js';

export const SEA_LEVEL = 0;

/**
 * Sample continental mask in [-1,1] (positive = land bias).
 */
export function sampleContinent(seed, p) {
  // Large-scale warped continents
  const c = warpedFbm3(seed + 1000, p.x * 1.2, p.y * 1.2, p.z * 1.2, 5);
  // Slight plate-like anisotropy
  const plate = fbm3(seed + 1100, p.x * 0.6, p.y * 0.6, p.z * 0.6, 3);
  return clamp(c * 0.85 + plate * 0.25, -1, 1);
}

/**
 * Base elevation in meters. Deterministic.
 */
export function sampleElevation(seed, p) {
  const cont = sampleContinent(seed, p);
  const landMask = smoothstep(-0.05, 0.15, cont);

  // Ocean bathymetry
  const ocean = -800 - Math.abs(fbm3(seed + 2000, p.x * 2, p.y * 2, p.z * 2, 4)) * 4200;

  // Continental shelf / plains
  const plains = fbm3(seed + 2100, p.x * 2.2, p.y * 2.2, p.z * 2.2, 3) * 280 + 120;

  // Plate-like mountain ranges (ridged)
  const ridges = ridged3(seed + 2200, p.x * 2.5, p.y * 2.5, p.z * 2.5, 6);
  const mountains = Math.max(0, ridges) * 4800 * smoothstep(0.02, 0.3, cont);

  // Xianxia steep peaks — globally scattered sharp spikes
  const peakMask = ridged3(seed + 2300, p.x * 8, p.y * 8, p.z * 8, 4);
  const peaks = Math.max(0, peakMask - 0.5) * 6200 * landMask;

  // Deep gorges — negative ridges in land
  const gorgeN = ridged3(seed + 2400, p.x * 6 + 10, p.y * 6, p.z * 6, 4);
  const gorges = -Math.max(0, gorgeN - 0.5) * 1800 * landMask;

  // Special rock strata undulation
  const strata = fbm3(seed + 2500, p.x * 12, p.y * 12, p.z * 12, 3) * 120 * landMask;

  const landH = plains + mountains + peaks + gorges + strata;
  const h = landMask * landH + (1 - landMask) * ocean;

  // Soften near coast
  const coastal = smoothstep(-0.08, 0.12, cont);
  return coastal * Math.max(h, -50) + (1 - coastal) * ocean;
}

/**
 * Sample full surface point attributes.
 */
export function sampleSurface(seed, p, overrides = null) {
  let elev = sampleElevation(seed, p);
  // Apply override layer if provided (nearest sample / field callback)
  if (overrides && typeof overrides.elevationAt === 'function') {
    const o = overrides.elevationAt(p);
    if (o != null) elev = o;
  }
  return {
    elevation: elev,
    isLand: elev >= SEA_LEVEL,
  };
}
