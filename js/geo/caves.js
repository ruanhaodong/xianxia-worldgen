/**
 * Hidden cave abodes (洞府): mark sites; caves as local 3D data stubs.
 */
import { hashToUnit } from '../core/hash.js';
import { fbm3, ridged3 } from '../core/noise.js';
import { xyzToLonLat } from '../core/math.js';

/**
 * Decide if a land surface point hosts a cave entrance.
 * Deterministic from seed + position.
 */
export function caveChance(seed, p, elev) {
  if (elev < 200 || elev > 4500) return 0;
  const n = ridged3(seed + 4000, p.x * 15, p.y * 15, p.z * 15, 3);
  const m = fbm3(seed + 4100, p.x * 5, p.y * 5, p.z * 5, 2);
  return Math.max(0, n - 0.48) * (0.5 + 0.5 * m);
}

export function sampleCaveSite(seed, p, elev) {
  const c = caveChance(seed, p, elev);
  if (c < 0.035) return null;
  const { lon, lat } = xyzToLonLat(p);
  const id = Math.floor(hashToUnit(seed, Math.floor(lon * 100), Math.floor(lat * 100), 42) * 1e9);
  return {
    id,
    lon,
    lat,
    elev,
    spiritual: c,
    /** Local 3D stub — chambers along a tunnel axis */
    local3d: {
      type: 'cave_stub',
      chambers: Math.max(1, Math.floor(c * 8)),
      lengthM: 40 + c * 200,
      note: '局部三维洞府占位数据，供后续引擎展开',
    },
  };
}
