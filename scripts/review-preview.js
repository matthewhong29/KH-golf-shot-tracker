#!/usr/bin/env node
// Screenshots each frame of a swing review as the page draws it, to check the markup lands in the
// right place before committing. Needs Playwright (preinstalled in Claude's cloud sessions).
// Usage: node scripts/review-preview.js <player id> <review id> [out dir]
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const [player, reviewId, outDir = path.join(require('os').tmpdir(), 'review-preview')] = process.argv.slice(2);
if (!player || !reviewId) { console.log('Usage: node scripts/review-preview.js <player id> <review id> [out dir]'); process.exit(1); }
const ROOT = path.join(__dirname, '..');
const PORT = 8900 + Math.floor(Math.random() * 90);

(async () => {
  const { chromium } = require('playwright');
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/?player=${encodeURIComponent(player)}`);
    await page.waitForTimeout(1200);
    await page.addStyleTag({ content: 'nav.tabs{display:none!important}' });
    await page.evaluate(() => document.querySelector('[data-tab="tips"]').click());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('[data-action="practice-view"][data-view="swing"]').click());
    await page.waitForTimeout(400);
    const sel = `.rv-viewer[data-review="${reviewId}"]`;
    if (!(await page.$(sel))) throw new Error(`review "${reviewId}" isn't on ${player}'s Swing page (is it in the data file, with frames?)`);
    const n = await page.$$eval(`${sel} .rv-thumb`, (t) => t.length);
    for (let i = 0; i < n; i++) {
      await page.evaluate(([s, k]) => document.querySelector(`${s} .rv-thumb[data-i="${k}"]`).click(), [sel, i]);
      await page.waitForTimeout(250);
      const file = path.join(outDir, `${reviewId}-${i + 1}.png`);
      await (await page.$(`${sel}`)).screenshot({ path: file });
      console.log('wrote', file);
    }
    if (errors.length) console.log('page errors:', errors.join(' / '));
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
