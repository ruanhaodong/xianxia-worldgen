/**
 * Cube-sphere: 6 faces (+X,-X,+Y,-Y,+Z,-Z), UV in [0,1]^2 per face.
 * Face local coords map to unit sphere.
 */
import { vnorm } from './math.js';

export const FACE_POS_X = 0;
export const FACE_NEG_X = 1;
export const FACE_POS_Y = 2;
export const FACE_NEG_Y = 3;
export const FACE_POS_Z = 4;
export const FACE_NEG_Z = 5;
export const FACE_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

/** Map face + UV [0,1] to cube position in [-1,1]^3, then normalize to sphere. */
export function faceUvToCube(face, u, v) {
  // remap [0,1] -> [-1,1]
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  switch (face) {
    case FACE_POS_X: return { x: 1, y, z: -x };
    case FACE_NEG_X: return { x: -1, y, z: x };
    case FACE_POS_Y: return { x: x, y: 1, z: -y };
    case FACE_NEG_Y: return { x: x, y: -1, z: y };
    case FACE_POS_Z: return { x: x, y, z: 1 };
    case FACE_NEG_Z: return { x: -x, y, z: -1 };
    default: throw new Error('bad face ' + face);
  }
}

export function faceUvToSphere(face, u, v) {
  return vnorm(faceUvToCube(face, u, v));
}

/**
 * Project unit sphere direction to face + UV.
 * Returns { face, u, v } with u,v in [0,1].
 */
export function sphereToFaceUv(n) {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  let face, u, v;
  if (ax >= ay && ax >= az) {
    if (n.x > 0) {
      face = FACE_POS_X;
      u = (-n.z / ax + 1) * 0.5;
      v = (n.y / ax + 1) * 0.5;
    } else {
      face = FACE_NEG_X;
      u = (n.z / ax + 1) * 0.5;
      v = (n.y / ax + 1) * 0.5;
    }
  } else if (ay >= ax && ay >= az) {
    if (n.y > 0) {
      face = FACE_POS_Y;
      u = (n.x / ay + 1) * 0.5;
      v = (-n.z / ay + 1) * 0.5;
    } else {
      face = FACE_NEG_Y;
      u = (n.x / ay + 1) * 0.5;
      v = (n.z / ay + 1) * 0.5;
    }
  } else {
    if (n.z > 0) {
      face = FACE_POS_Z;
      u = (n.x / az + 1) * 0.5;
      v = (n.y / az + 1) * 0.5;
    } else {
      face = FACE_NEG_Z;
      u = (-n.x / az + 1) * 0.5;
      v = (n.y / az + 1) * 0.5;
    }
  }
  return {
    face,
    u: Math.min(1, Math.max(0, u)),
    v: Math.min(1, Math.max(0, v)),
  };
}

/**
 * Neighbor face crossing at an edge.
 * Returns { face, u, v } for a point just outside [0,1] on current face.
 * Simplified edge-adjacency map for skirt/seamless sampling.
 */
export function wrapFaceUv(face, u, v) {
  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { face, u, v };
  // Convert to sphere then back — robust across edges/corners
  const cube = faceUvToCube(face, Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)));
  // Extrapolate slightly outside by adjusting cube coords
  let cx, cy, cz;
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  switch (face) {
    case FACE_POS_X: cx = 1; cy = y; cz = -x; break;
    case FACE_NEG_X: cx = -1; cy = y; cz = x; break;
    case FACE_POS_Y: cx = x; cy = 1; cz = -y; break;
    case FACE_NEG_Y: cx = x; cy = -1; cz = y; break;
    case FACE_POS_Z: cx = x; cy = y; cz = 1; break;
    case FACE_NEG_Z: cx = -x; cy = y; cz = -1; break;
  }
  // If u/v out of range, the dominant axis may change — project via normalize
  const n = vnorm({ x: cx, y: cy, z: cz });
  return sphereToFaceUv(n);
}

/** Angular size of a face UV extent at equator approx (radians). */
export function faceExtentRadians(uvSize) {
  // cube face spans ~90 deg; uvSize fraction of face
  return (Math.PI / 2) * uvSize;
}
