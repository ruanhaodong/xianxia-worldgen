#!/usr/bin/env node
/**
 * Headless Node CLI — generates world data independent of rendering.
 * Usage:
 *   node src/cli/generate.mjs --seed 42 --out data/world
 *   node src/cli/generate.mjs --seed "仙侠九州" --overrides data/overrides.json
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { WorldSession, skeletonToRGBA, digestWorld, generateChunk } from '../core/worldgen.js';
import { EXAMPLE_OVERRIDES } from '../geo/overrides.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = { seed: '42', out: 'data/world', width: 256, height: 128, overrides: null, writePng: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') args.seed = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--width') args.width = Number(argv[++i]);
    else if (a === '--height') args.height = Number(argv[++i]);
    else if (a === '--overrides') args.overrides = argv[++i];
    else if (a === '--no-png') args.writePng = false;
    else if (a === '--help') args.help = true;
  }
  return args;
}

function writePgm(path, width, height, rgba) {
  // Simple binary-ish: write raw PPM
  const header = `P6\n${width} ${height}\n255\n`;
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    rgb[j] = rgba[i * 4];
    rgb[j + 1] = rgba[i * 4 + 1];
    rgb[j + 2] = rgba[i * 4 + 2];
  }
  writeFileSync(path, Buffer.concat([Buffer.from(header), rgb]));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`xianxia-worldgen CLI
  --seed <string|number>   world seed (default 42)
  --out <dir>              output directory (default data/world)
  --width --height         skeleton resolution
  --overrides <json>       manual override layer
  --no-png                 skip PPM preview
`);
    return;
  }

  let overrides = null;
  if (args.overrides) {
    const p = resolve(root, args.overrides);
    overrides = JSON.parse(readFileSync(p, 'utf8'));
  }

  const outDir = resolve(root, args.out);
  mkdirSync(outDir, { recursive: true });

  console.log(`[cli] generating world seed=${args.seed} …`);
  const t0 = Date.now();
  const session = new WorldSession(args.seed, overrides, {
    skeletonWidth: args.width,
    skeletonHeight: args.height,
  });
  const sk = session.skeleton;
  const digest = digestWorld(sk);
  const ms = Date.now() - t0;
  console.log(`[cli] done in ${ms}ms`);
  console.log(`[cli] digest=${digest}`);
  console.log(`[cli] settlements=${sk.settlements.length} roads=${sk.roads.length} sects=${sk.sects.length} rivers=${sk.rivers.length} caves=${sk.caves.length}`);

  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(sk.meta, null, 2));
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(session.exportSummary(), null, 2));
  writeFileSync(join(outDir, 'elevation.f32'), Buffer.from(sk.elevation.buffer));
  writeFileSync(join(outDir, 'biome.u8'), Buffer.from(sk.biome.buffer));
  writeFileSync(join(outDir, 'digest.txt'), digest + '\n');

  // Sample a few chunks to prove on-demand gen
  const chunks = [];
  for (let face = 0; face < 6; face++) {
    const c = session.getChunk(face, 2, 0, 0);
    chunks.push({ key: c.key, elevDigest: c.elevDigest, res: c.res });
  }
  writeFileSync(join(outDir, 'sample-chunks.json'), JSON.stringify(chunks, null, 2));

  // Example overrides file for reference
  if (!existsSync(join(root, 'data/overrides.example.json'))) {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data/overrides.example.json'), JSON.stringify(EXAMPLE_OVERRIDES, null, 2));
  }

  if (args.writePng) {
    const { width, height, rgba } = skeletonToRGBA(sk);
    writePgm(join(outDir, 'preview.ppm'), width, height, rgba);
    console.log(`[cli] wrote ${join(outDir, 'preview.ppm')}`);
  }

  // Also copy summary into public/data for the viewer
  const pub = join(root, 'public/data');
  mkdirSync(pub, { recursive: true });
  writeFileSync(join(pub, 'summary.json'), JSON.stringify(session.exportSummary()));
  writeFileSync(join(pub, 'meta.json'), JSON.stringify(sk.meta, null, 2));
  const { width, height, rgba } = skeletonToRGBA(sk);
  writeFileSync(join(pub, 'map.rgba'), Buffer.from(rgba.buffer));
  writeFileSync(join(pub, 'map.json'), JSON.stringify({ width, height }));
  writeFileSync(join(pub, 'elevation.f32'), Buffer.from(sk.elevation.buffer));
  writeFileSync(join(pub, 'biome.u8'), Buffer.from(sk.biome.buffer));

  console.log(`[cli] output → ${outDir}`);
  console.log(`[cli] viewer data → ${pub}`);
}

main();
