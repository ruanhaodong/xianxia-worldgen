#!/usr/bin/env node
/**
 * Copy shared generation modules into public/js for browser ES modules.
 * Also vendor three.module.js if present in node_modules.
 */
import { cpSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public/js');

mkdirSync(join(dest, 'core'), { recursive: true });
mkdirSync(join(dest, 'geo'), { recursive: true });
mkdirSync(join(dest, 'settlement'), { recursive: true });
mkdirSync(join(dest, 'vendor'), { recursive: true });

const copies = [
  ['src/core/hash.js', 'core/hash.js'],
  ['src/core/noise.js', 'core/noise.js'],
  ['src/core/math.js', 'core/math.js'],
  ['src/core/cubesphere.js', 'core/cubesphere.js'],
  ['src/core/quadtree.js', 'core/quadtree.js'],
  ['src/core/worldgen.js', 'core/worldgen.js'],
  ['src/geo/terrain.js', 'geo/terrain.js'],
  ['src/geo/climate.js', 'geo/climate.js'],
  ['src/geo/rivers.js', 'geo/rivers.js'],
  ['src/geo/caves.js', 'geo/caves.js'],
  ['src/geo/overrides.js', 'geo/overrides.js'],
  ['src/settlement/habitability.js', 'settlement/habitability.js'],
  ['src/settlement/settlements.js', 'settlement/settlements.js'],
];

for (const [from, to] of copies) {
  cpSync(join(root, from), join(dest, to));
}

const threeSrc = join(root, 'node_modules/three/build/three.module.js');
if (existsSync(threeSrc)) {
  cpSync(threeSrc, join(dest, 'vendor/three.module.js'));
  // also copy examples/jsm controls if available
  const orb = join(root, 'node_modules/three/examples/jsm/controls/OrbitControls.js');
  if (existsSync(orb)) {
    mkdirSync(join(dest, 'vendor/controls'), { recursive: true });
    // Rewrite import path in OrbitControls to local three
    let text = readFileSync(orb, 'utf8');
    text = text.replace(/from ['"]three['"]/g, "from '../three.module.js'");
    writeFileSync(join(dest, 'vendor/controls/OrbitControls.js'), text);
  }
  console.log('[build] vendored three.module.js');
} else {
  console.warn('[build] three not installed yet — run npm install');
}

console.log('[build] viewer modules copied to public/js');
