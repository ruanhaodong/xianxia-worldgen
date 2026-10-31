/**
 * Habitability from climate, elevation, water proximity, resources.
 * Settlements seed at local maxima — not random placement.
 */
import { clamp, smoothstep } from '../core/math.js';
import { temperatureAt, moistureAt, BIOME, classifyBiome } from '../geo/climate.js';
import { fbm3 } from '../core/noise.js';
import { SEA_LEVEL } from '../geo/terrain.js';

export function resourceScore(seed, p, elev) {
  // Spiritual / mineral resources — higher in mountains & mist forests
  const spirit = Math.max(0, fbm3(seed + 5000, p.x * 4, p.y * 4, p.z * 4, 4));
  const mineral = Math.max(0, fbm3(seed + 5100, p.x * 7, p.y * 7, p.z * 7, 3));
  const mountainBonus = smoothstep(800, 2800, elev);
  return spirit * 0.6 + mineral * 0.4 + mountainBonus * 0.3;
}

export function habitability(seed, p, elev, riverProx = 0) {
  if (elev < SEA_LEVEL + 2) return 0;
  if (elev > 4200) return 0;
  const t = temperatureAt(p, elev);
  const m = moistureAt(seed, p, elev);
  const biome = classifyBiome(seed, p, elev);

  let score = 0;
  // Mild temps preferred
  score += smoothstep(-10, 8, t) * smoothstep(38, 22, t);
  score *= 0.4 + 0.6 * m;
  // Flat-ish plains better for cities (not peaks)
  const reliefPenalty = elev > 1800 ? smoothstep(1800, 3500, elev) : 0;
  score *= 1 - reliefPenalty * 0.7;
  score += riverProx * 0.35;
  const res = resourceScore(seed, p, elev);
  score += res * 0.15;

  if (biome === BIOME.DESERT) score *= 0.35;
  if (biome === BIOME.XIANXIA_PEAK) score *= 0.2;
  if (biome === BIOME.MIST_FOREST) score *= 0.7;
  if (biome === BIOME.BEACH) score *= 1.1;
  if (biome === BIOME.GRASSLAND || biome === BIOME.FOREST) score *= 1.25;

  return clamp(score, 0, 1.5);
}
