#!/usr/bin/env node
import { WorldSession, digestWorld, generateChunk } from '../core/worldgen.js';

const seed = process.argv[2] || 'determinism-test-42';

console.log(`[test] seed=${seed}`);
const a = new WorldSession(seed, null, { skeletonWidth: 128, skeletonHeight: 64, maxSettlements: 30, maxSects: 16 });
const b = new WorldSession(seed, null, { skeletonWidth: 128, skeletonHeight: 64, maxSettlements: 30, maxSects: 16 });

const da = digestWorld(a.skeleton);
const db = digestWorld(b.skeleton);
console.log(`[test] digestA=${da}`);
console.log(`[test] digestB=${db}`);

const ca = generateChunk(seed, 0, 3, 1, 2);
const cb = generateChunk(seed, 0, 3, 1, 2);
console.log(`[test] chunkA=${ca.elevDigest} chunkB=${cb.elevDigest}`);

let elevEq = true;
for (let i = 0; i < a.skeleton.elevation.length; i++) {
  if (a.skeleton.elevation[i] !== b.skeleton.elevation[i]) {
    elevEq = false;
    break;
  }
}

const ok = da === db && ca.elevDigest === cb.elevDigest && elevEq;
if (!ok) {
  console.error('[test] FAIL: non-deterministic output');
  process.exit(1);
}
console.log('[test] PASS: identical digests for same seed');
