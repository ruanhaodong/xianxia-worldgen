/**
 * Climate & biomes from latitude + elevation + moisture.
 */
import { fbm3 } from '../core/noise.js';
import { clamp, smoothstep, xyzToLonLat } from '../core/math.js';
import { SEA_LEVEL } from './terrain.js';

export const BIOME = {
  OCEAN: 0,
  DEEP_OCEAN: 1,
  BEACH: 2,
  DESERT: 3,
  GRASSLAND: 4,
  FOREST: 5,
  RAINFOREST: 6,
  TAIGA: 7,
  TUNDRA: 8,
  SNOW: 9,
  MOUNTAIN: 10,
  /** 云雾山林 */
  MIST_FOREST: 11,
  /** 仙侠险峰 */
  XIANXIA_PEAK: 12,
};

export const BIOME_NAMES = [
  'ocean', 'deep_ocean', 'beach', 'desert', 'grassland', 'forest',
  'rainforest', 'taiga', 'tundra', 'snow', 'mountain', 'mist_forest', 'xianxia_peak',
];

/** Approximate temperature °C from latitude & elevation. */
export function temperatureAt(p, elev) {
  const { lat } = xyzToLonLat(p);
  const latFactor = Math.cos((lat * Math.PI) / 180);
  let t = -25 + latFactor * 55;
  t -= Math.max(0, elev) / 160; // lapse rate ~6.25°C/km → /160 per m? 1000/6.25=160
  return t;
}

export function moistureAt(seed, p, elev) {
  let m = fbm3(seed + 3000, p.x * 2.2, p.y * 2.2, p.z * 2.2, 4);
  m = (m + 1) * 0.5;
  // wetter near equator-ish and coasts (elev near 0 land)
  const { lat } = xyzToLonLat(p);
  const trop = smoothstep(40, 10, Math.abs(lat));
  m = clamp(m * 0.7 + trop * 0.35, 0, 1);
  if (elev > 2500) m *= 0.7;
  return m;
}

export function classifyBiome(seed, p, elev) {
  if (elev < -800) return BIOME.DEEP_OCEAN;
  if (elev < SEA_LEVEL) return BIOME.OCEAN;
  if (elev < 8) return BIOME.BEACH;

  const t = temperatureAt(p, elev);
  const m = moistureAt(seed, p, elev);

  // Xianxia peaks
  if (elev > 2800 && m > 0.2) return BIOME.XIANXIA_PEAK;
  if (elev > 2400) return BIOME.MOUNTAIN;
  if (elev > 1600 && m > 0.4 && t > -5) return BIOME.MIST_FOREST;

  if (t < -8) return elev > 1500 ? BIOME.SNOW : BIOME.TUNDRA;
  if (t < 5) return m > 0.4 ? BIOME.TAIGA : BIOME.TUNDRA;
  if (m < 0.28) return BIOME.DESERT;
  if (m > 0.7 && t > 18) return BIOME.RAINFOREST;
  if (m > 0.45) return BIOME.FOREST;
  return BIOME.GRASSLAND;
}

export const BIOME_COLORS = [
  [0x1a, 0x4a, 0x6e], // ocean
  [0x0c, 0x28, 0x48], // deep
  [0xd2, 0xc4, 0x8c], // beach
  [0xe0, 0xc8, 0x78], // desert
  [0x7a, 0xb8, 0x4a], // grass
  [0x2e, 0x7a, 0x38], // forest
  [0x1a, 0x5c, 0x2a], // rain
  [0x3a, 0x6a, 0x4a], // taiga
  [0xb0, 0xc0, 0xb8], // tundra
  [0xf0, 0xf4, 0xf8], // snow
  [0x6a, 0x5a, 0x4a], // mountain
  [0x5a, 0x8a, 0x7a], // mist forest
  [0x8a, 0x7a, 0xa0], // xianxia peak
];
