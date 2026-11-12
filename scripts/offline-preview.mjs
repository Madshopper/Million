// Skærmbilleder af den offline-kørende side (MADSHOPPER_OFFLINE=1), og en
// kontrol af at intet forlader maskinen: hver request til en anden vært end
// localhost blokeres og tælles, og scriptet fejler hvis der var nogen.
//
//   node scripts/offline-preview.mjs [base-url] [ud-mappe] [sti ...]
//   fx  node scripts/offline-preview.mjs http://127.0.0.1:5001 /tmp/shots / /Mejeri /search?q=pizza
//
// Normalt startes det via scripts/offline.sh --shots. Se docs/offline.md.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

// playwright fra projektet, ellers den globalt installerede (fx i en sky-VM).
async function loadChromium() {
  try { return (await import('playwright')).chromium; } catch {}
  const root = execSync('npm root -g').toString().trim();
  return createRequire(path.join(root, 'noop.js'))('playwright').chromium;
}
const chromium = await loadChromium();

const base = (process.argv[2] || 'http://127.0.0.1:5001').replace(/\/$/, '');
const outDir = process.argv[3] || 'offline-shots';
const paths = process.argv.slice(4);
const pages = paths.length ? paths : [
  '/', '/Mejeri', '/ugens_tilbud', '/search/results?q=m%C3%A6lk', '/tilbud/netto', '/opskrifter',
];
const local = new URL(base).host;

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const blocked = new Set();
const errors = [];

for (const [label, viewport, mobile] of [
  ['desktop', { width: 1280, height: 900 }, false],
  ['mobil', { width: 390, height: 844 }, true],
]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'da-DK' });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.host === local || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    blocked.add(`${u.protocol}//${u.host}${u.pathname}`);
    return route.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  for (const p of pages) {
    const res = await page.goto(base + p, { waitUntil: 'networkidle' }).catch((e) => ({ status: () => `fejl ${e.message}` }));
    const name = `${label}_${p.replace(/[^a-z0-9æøå]+/gi, '_').replace(/^_|_$/g, '') || 'forside'}.png`;
    await page.screenshot({ path: path.join(outDir, name), fullPage: false });
    console.log(`${res.status()}  ${p}  -> ${path.join(outDir, name)}`);
  }
  await ctx.close();
}
await browser.close();

if (errors.length) console.log(`\nJS-fejl på siden:\n  ${errors.join('\n  ')}`);
if (blocked.size) {
  console.error(`\nFEJL: siden forsøgte at kalde ud af maskinen (${blocked.size}):\n  ${[...blocked].join('\n  ')}`);
  process.exit(1);
}
console.log('\nOK: ingen requests ud af maskinen.');
