/**
 * Deterministic multi-octave value / ridged / domain-warped noise.
 * Same (seed, x, y, z) always yields the same float in [-1, 1] or [0, 1].
 */
import { hashToSigned, hashToUnit, seedFrom } from './hash.js';

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 3D value noise, continuous. */
export function valueNoise3(seed, x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);
  const s = seed | 0;

  const n000 = hashToSigned(s, xi, yi, zi);
  const n100 = hashToSigned(s, xi + 1, yi, zi);
  const n010 = hashToSigned(s, xi, yi + 1, zi);
  const n110 = hashToSigned(s, xi + 1, yi + 1, zi);
  const n001 = hashToSigned(s, xi, yi, zi + 1);
  const n101 = hashToSigned(s, xi + 1, yi, zi + 1);
  const n011 = hashToSigned(s, xi, yi + 1, zi + 1);
  const n111 = hashToSigned(s, xi + 1, yi + 1, zi + 1);

  const x00 = lerp(n000, n100, u);
  const x10 = lerp(n010, n110, u);
  const x01 = lerp(n001, n101, u);
  const x11 = lerp(n011, n111, u);
  const y0 = lerp(x00, x10, v);
  const y1 = lerp(x01, x11, v);
  return lerp(y0, y1, w);
}

export function fbm3(seed, x, y, z, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(seed + i * 1013, x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

/** Ridged multifractal — sharp mountain ridges. */
export function ridged3(seed, x, y, z, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = valueNoise3(seed + i * 1733, x * freq, y * freq, z * freq);
    n = 1 - Math.abs(n);
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum * 2 - 1;
}

/** Domain-warped fbm for continents / warped terrain. */
export function warpedFbm3(seed, x, y, z, octaves = 5) {
  const wx = fbm3(seed + 11, x * 0.7, y * 0.7, z * 0.7, 3) * 0.35;
  const wy = fbm3(seed + 29, x * 0.7 + 40, y * 0.7, z * 0.7, 3) * 0.35;
  const wz = fbm3(seed + 47, x * 0.7, y * 0.7 + 40, z * 0.7, 3) * 0.35;
  return fbm3(seed, x + wx, y + wy, z + wz, octaves);
}

export { seedFrom, hashToUnit, hashToSigned };
