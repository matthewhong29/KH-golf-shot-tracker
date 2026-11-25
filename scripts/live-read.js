#!/usr/bin/env node
// Reads numbers off a screenshot of a launch monitor's screen the way the Game tab's screen
// reader does, to check it against a real screen (say, a Rapsodo screenshot Matthew sends).
// Boxes are in the image's pixels (python3 scripts/swing-frames.py grid IMAGE shows them),
// one per number: carry, total, side, speed, launch, start, apex or descent. Needs Playwright.
// Usage: node scripts/live-read.js IMAGE carry=X,Y,W,H [side=X,Y,W,H ...] [units=side:ft,apex:yds]
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const args = process.argv.slice(2), file = args[0];
const LV = require('../js/live.js');
const boxes = {}, units = {};
args.slice(1).forEach((a) => {
  const m = /^(\w+)=(\d+),(\d+),(\d+),(\d+)$/.exec(a), u = /^units=(.+)$/.exec(a);
  if (m && LV.FIELD[m[1]]) boxes[m[1]] = m.slice(2).map(Number);
  else if (u) u[1].split(',').forEach((p) => { const [k, v] = p.split(':'); units[k] = v; });
  else { console.log(`Not understood: ${a}`); process.exit(1); }
});
if (!file || !fs.existsSync(file) || !Object.keys(boxes).length) {
  console.log('Usage: node scripts/live-read.js IMAGE carry=X,Y,W,H [side=X,Y,W,H ...] [units=side:ft,apex:yds]');
  process.exit(1);
}
const ROOT = path.join(__dirname, '..');
const PORT = 8900 + Math.floor(Math.random() * 90);
const type = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';

(async () => {
  const { chromium } = require('playwright');
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/README.md`);
    await page.addScriptTag({ url: `http://localhost:${PORT}/js/live.js` });
    const out = await page.evaluate(async ({ src, boxes, units }) => {
      const img = new Image();
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = src; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const L = window.GolfLive, w = await L.ocr(), got = {}, rows = [];
      for (const id of Object.keys(boxes)) {
        const [x, y, bw, bh] = boxes[id], box = { x: x / c.width, y: y / c.height, w: bw / c.width, h: bh / c.height };
        const o = await L.readField(w, c, box, id, units[id] || L.FIELD[id].units[0], null);
        got[id] = o.v;
        rows.push({ id, raw: o.raw || '', text: o.text, v: o.v, ok: o.ok, unsure: !!o.unsure, fixed: !!o.fixed });
      }
      return { rows, reading: L.checkReading(got), size: [c.width, c.height] };
    }, { src: `data:${type};base64,${fs.readFileSync(file).toString('base64')}`, boxes, units });
    console.log(`${path.basename(file)}: ${out.size[0]}×${out.size[1]}`);
    out.rows.forEach((r) => console.log(`  ${r.id.padEnd(8)} read "${r.raw}"${r.text !== r.raw.toUpperCase() ? ` → "${r.text}"` : ''} = ${r.v == null ? 'can’t read it' : Math.round(r.v * 10) / 10 + (LV.FIELD[r.id].units[0] === '°' ? '°' : ' (game units)')}${r.unsure ? ' (unsure)' : ''}${r.fixed ? ' (a dropped 1 put back)' : ''}${r.ok ? '' : ' · didn’t match the shapes'}`));
    console.log(out.reading ? `  as a shot: ${LV.readingText(out.reading, units)}${out.reading.left.length ? ` (left out: ${out.reading.left.join(', ')})` : ''}` : '  no carry, so no shot');
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
