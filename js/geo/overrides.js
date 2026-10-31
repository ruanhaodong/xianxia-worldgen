/**
 * Manual-edit override layer (JSON) applied on top of procedural data.
 * Format:
 * {
 *   "elevationPatches": [ { "lon", "lat", "radiusDeg", "deltaM" | "absoluteM" } ],
 *   "forceLand": [ { "lon", "lat", "radiusDeg" } ],
 *   "notes": "..."
 * }
 */
import { lonLatToXyz, xyzToLonLat, distKm, EARTH_RADIUS_KM } from '../core/math.js';

export function loadOverrides(json) {
  if (!json || typeof json !== 'object') return null;
  return json;
}

export function makeOverrideSampler(overrides) {
  if (!overrides) return null;
  const patches = overrides.elevationPatches || [];
  const forceLand = overrides.forceLand || [];

  return {
    elevationAt(p, baseElev) {
      let elev = baseElev;
      const { lon, lat } = xyzToLonLat(p);
      for (const fl of forceLand) {
        const d = Math.hypot(lon - fl.lon, lat - fl.lat);
        if (d < (fl.radiusDeg || 1) && elev < 0) elev = 5;
      }
      for (const patch of patches) {
        const d = Math.hypot(lon - patch.lon, lat - patch.lat);
        const r = patch.radiusDeg || 1;
        if (d >= r) continue;
        const w = 1 - d / r;
        const w2 = w * w * (3 - 2 * w);
        if (patch.absoluteM != null) {
          elev = elev * (1 - w2) + patch.absoluteM * w2;
        } else if (patch.deltaM != null) {
          elev += patch.deltaM * w2;
        }
      }
      return elev;
    },
  };
}

export const EXAMPLE_OVERRIDES = {
  notes: '示例人工覆盖层：抬升一座仙山、强制一块陆地',
  elevationPatches: [
    { lon: 105, lat: 32, radiusDeg: 3, deltaM: 2200 },
  ],
  forceLand: [
    { lon: 0, lat: 0, radiusDeg: 2 },
  ],
};
