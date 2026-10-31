/**
 * Deterministic 32/64-bit hash utilities. No Math.random anywhere in generation.
 */

export function hashUint32(a, b = 0, c = 0, d = 0) {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d);
  h = Math.imul(h ^ (c | 0), 0x165667b1);
  h = Math.imul(h ^ (d | 0), 0x85ebca6b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashToUnit(a, b = 0, c = 0, d = 0) {
  return hashUint32(a, b, c, d) / 4294967296;
}

export function hashToSigned(a, b = 0, c = 0, d = 0) {
  return hashToUnit(a, b, c, d) * 2 - 1;
}

/** Mix seed string/number into a 32-bit seed. */
export function seedFrom(input) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return (input >>> 0) || 1;
  }
  const s = String(input ?? 'xianxia');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/** FNV-1a style digest of typed array / string for determinism checks. */
export function digestBytes(bytes) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

export function digestFloat32(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  return digestBytes(u8);
}

export function digestJSON(obj) {
  const s = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(s);
  return digestBytes(bytes);
}
