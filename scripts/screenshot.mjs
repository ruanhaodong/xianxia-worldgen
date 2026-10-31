#!/usr/bin/env node
/**
 * Start static server, open viewer, take screenshots of 2D map + globe.
 */
import { createServer } from 'http';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const shotDir = join(root, 'screenshots');
mkdirSync(shotDir, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.f32': 'application/octet-stream',
  '.u8': 'application/octet-stream',
  '.rgba': 'application/octet-stream',
  '.ppm': 'image/x-portable-pixmap',
};

function serve() {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      let url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/') url = '/index.html';
      const path = join(pub, url);
      if (!path.startsWith(pub)) {
        res.writeHead(403); res.end(); return;
      }
      try {
        const data = readFileSync(path);
        res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    });
    server.listen(4173, '127.0.0.1', () => resolvePromise(server));
  });
}

async function withPlaywright(server) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(120000);
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  // wait for generation stats
  await page.waitForFunction(() => {
    const s = document.getElementById('stats');
    return s && s.textContent.includes('摘要');
  }, { timeout: 90000 });
  // Wait until globe has a full coarse shell
  await page.waitForFunction(() => {
    const b = document.getElementById('globe-badge');
    if (!b) return false;
    const m = b.textContent.match(/chunks\s+(\d+)/);
    return m && Number(m[1]) >= 90;
  }, { timeout: 90000 });
  await page.waitForTimeout(1500);

  await page.locator('#map2d-wrap').screenshot({ path: join(shotDir, 'map2d.png') });
  await page.locator('#globe-wrap').screenshot({ path: join(shotDir, 'globe.png') });
  await page.screenshot({ path: join(shotDir, 'full.png') });

  await browser.close();
  server.close();
  console.log('[screenshot] saved to', shotDir);
}

async function fallbackPpmCopy() {
  // If playwright fails, at least convert CLI ppm if present
  const ppm = join(root, 'data/world/preview.ppm');
  if (existsSync(ppm)) {
    // write a note
    writeFileSync(join(shotDir, 'NOTE.txt'), 'Playwright unavailable; see data/world/preview.ppm for 2D preview.\n');
  }
}

const server = await serve();
try {
  await withPlaywright(server);
} catch (e) {
  console.error('[screenshot] playwright failed:', e.message);
  await fallbackPpmCopy();
  server.close();
  process.exitCode = 1;
}
