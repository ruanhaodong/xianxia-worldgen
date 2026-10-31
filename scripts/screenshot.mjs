#!/usr/bin/env node
/**
 * Headless screenshots: overview + ground detail + player walking.
 */
import { createServer } from 'http';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.setDefaultTimeout(120000);
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const s = document.getElementById('stats');
    return s && s.textContent.includes('摘要');
  }, { timeout: 90000 });
  await page.waitForFunction(() => {
    const b = document.getElementById('globe-badge');
    if (!b) return false;
    const m = b.textContent.match(/chunks\s+(\d+)/);
    return m && Number(m[1]) >= 40;
  }, { timeout: 90000 });
  await page.waitForTimeout(1200);

  await page.locator('#map2d-wrap').screenshot({ path: join(shotDir, 'map2d.png') });
  await page.locator('#globe-wrap').screenshot({ path: join(shotDir, 'globe.png') });
  await page.screenshot({ path: join(shotDir, 'full.png') });

  // Dive to ground near a settlement
  const dived = await page.evaluate(() => window.__xianxia?.diveToGround());
  if (!dived) throw new Error('diveToGround failed');
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const a = window.__xianxia?.getAltitude?.() ?? 1e12;
    const d = window.__xianxia?.getDetailChunks?.() ?? 0;
    return a < 5000 && d > 0;
  }, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.locator('#globe-wrap').screenshot({ path: join(shotDir, 'ground_detail.png') });
  await page.screenshot({ path: join(shotDir, 'ground_full.png') });

  // Enter player mode
  await page.evaluate(() => window.__xianxia?.enterPlayer());
  await page.waitForFunction(() => window.__xianxia?.isPlayer?.() === true, { timeout: 15000 });
  await page.waitForTimeout(1500);
  // Ensure detail still present in player mode
  await page.waitForFunction(() => (window.__xianxia?.getDetailChunks?.() ?? 0) > 0, { timeout: 30000 });
  // Simulate walking
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  await page.keyboard.down('d');
  await page.waitForTimeout(800);
  await page.keyboard.up('d');
  await page.waitForTimeout(400);
  await page.locator('#globe-wrap').screenshot({ path: join(shotDir, 'ground_player.png') });
  await page.screenshot({ path: join(shotDir, 'ground_player_full.png') });

  // Also alias ground*.png as required
  const { copyFileSync } = await import('fs');
  copyFileSync(join(shotDir, 'ground_detail.png'), join(shotDir, 'ground.png'));
  copyFileSync(join(shotDir, 'ground_player.png'), join(shotDir, 'ground_walk.png'));

  await browser.close();
  server.close();

  const errLog = join(shotDir, 'console-errors.txt');
  writeFileSync(errLog, consoleErrors.length ? consoleErrors.join('\n') : 'none\n');
  console.log('[screenshot] saved to', shotDir);
  console.log('[screenshot] console errors:', consoleErrors.length);
  if (consoleErrors.length) {
    console.error(consoleErrors.slice(0, 20).join('\n'));
    process.exitCode = 1;
  }
}

async function fallbackPpmCopy() {
  const ppm = join(root, 'data/world/preview.ppm');
  if (existsSync(ppm)) {
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
