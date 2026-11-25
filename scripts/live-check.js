#!/usr/bin/env node
// Checks the Game tab's screen reader end to end, with a pretend Rapsodo screen in place of the
// shared window: it marks the boxes, then changes the numbers the way a new shot does, and
// checks each shot plays on the hole with the numbers on the screen (and that the shot already
// showing, a paused reader and a shot hit mid-flight behave). Needs Playwright (preinstalled in
// Claude's cloud sessions). Writes screenshots of the card and the marking to the out dir.
// Usage: node scripts/live-check.js [out dir]
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const outDir = process.argv[2] || path.join(require('os').tmpdir(), 'live-check');
const ROOT = path.join(__dirname, '..');
const PORT = 8900 + Math.floor(Math.random() * 90);

// The pretend screen: dark tiles in three columns, each with a small grey name, a big white
// number and its unit, like the Rapsodo app. window.__screen.show({...}) puts up a new shot.
function fakeScreen() {
  const W = 1200, H = 620, c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.style.cssText = 'position:fixed;left:-3000px;top:0';
  const TILES = [['carry', 'CARRY', 'yds'], ['total', 'TOTAL', 'yds'], ['side', 'SIDE', 'yds'], ['speed', 'BALL SPEED', 'mph'], ['launch', 'LAUNCH ANGLE', ''], ['apex', 'HEIGHT', 'ft']];
  let vals = {};
  const boxes = {};
  function draw() {
    const x = c.getContext('2d');
    x.fillStyle = '#0f1216'; x.fillRect(0, 0, W, H);
    TILES.forEach(([id, name, unit], i) => {
      const tx = 30 + (i % 3) * 390, ty = 30 + Math.floor(i / 3) * 290, tw = 360, th = 260;
      x.fillStyle = '#1c2128'; x.fillRect(tx, ty, tw, th);
      x.fillStyle = '#8b949e'; x.font = '600 22px "Liberation Sans", Arial, sans-serif'; x.fillText(name, tx + 22, ty + 44);
      x.fillStyle = '#ffffff'; x.font = '700 66px "Liberation Sans", Arial, sans-serif'; x.fillText(vals[id] || '-', tx + 22, ty + 150);
      x.fillStyle = '#8b949e'; x.font = '500 24px "Liberation Sans", Arial, sans-serif'; x.fillText(unit, tx + 22, ty + 196);
      // the box round the number, as a person would draw it
      boxes[id] = { x: (tx + 12) / W, y: (ty + 88) / H, w: 300 / W, h: 80 / H };
    });
  }
  window.__screen = { show(v) { vals = Object.assign({}, v); draw(); }, boxes, size: { w: W, h: H } };
  window.__screen.show({ carry: '152.3', total: '160.1', side: '4.2 R', speed: '112.4', launch: '18.7°', apex: '82.5' });
  // keep it painting, so the stream keeps sending frames
  setInterval(draw, 100);
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(c));
  navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(10);
}

(async () => {
  const { chromium } = require('playwright');
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  let fails = 0;
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails++; };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(fakeScreen);
    await page.goto(`http://localhost:${PORT}/?player=dad`);
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('[data-tab="game"]').click());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('[data-action="gm-set"][data-k="mode"][data-v="live"]').click());
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('[data-action="gm-start"]').click());
    await page.waitForTimeout(600);
    check(!!(await page.$('#gmLv [data-action="lv-share"]')), 'From the range shows the share button on a computer');
    await page.evaluate(() => document.querySelector('[data-action="lv-share"]').click());
    await page.waitForSelector('#lvMark #lvCanvas', { timeout: 20000 });
    await page.waitForTimeout(300);
    check(true, 'the first share opens the marking, with a still of the screen');

    // mark four numbers: carry, total, side, ball speed
    const box = await page.evaluate(() => window.__screen.boxes);
    const marks = [['carry', '152.3 yds'], ['total', '160.1 yds'], ['side', '4.2 yds R'], ['speed', '112.4 mph']];
    for (const [id] of marks) {
      await page.evaluate((k) => document.querySelector(`[data-action="lv-pick"][data-id="${k}"]`).click(), id);
      const r = await (await page.$('#lvCanvas')).boundingBox(), b = box[id];
      await page.mouse.move(r.x + b.x * r.width, r.y + b.y * r.height);
      await page.mouse.down();
      await page.mouse.move(r.x + (b.x + b.w) * r.width, r.y + (b.y + b.h) * r.height, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(150);
    }
    await page.waitForFunction(() => !/reading…/.test(document.querySelector('#lvFields').textContent), null, { timeout: 15000 });
    const chips = await page.$$eval('#lvFields .lv-f', (els) => els.map((e) => e.textContent));
    for (const [id, want] of marks) {
      const name = { carry: 'Carry', total: 'Total', side: 'Side', speed: 'Ball speed' }[id];
      check(chips.some((t) => t === name + want), `marking reads the ${name.toLowerCase()}: ${chips.find((t) => t.startsWith(name))}`);
    }
    await page.screenshot({ path: path.join(outDir, 'live-mark.png') });
    await page.evaluate(() => document.querySelector('[data-action="lv-mark-done"]').click());
    await page.waitForTimeout(2500);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('golfTracker.v3.live')));
    check(saved && saved.boxes && saved.boxes.carry && saved.boxes.speed && saved.aspect > 1.9 && saved.aspect < 1.95, 'the boxes are saved on this computer');

    const strokes = () => page.evaluate(() => { const st = JSON.parse(localStorage.getItem('golfTracker.v3.dad.game')); const r = st && st.round; return r ? r.cards[r.idx].shots : []; });
    check((await strokes()).length === 0, 'the shot already on the screen doesn’t play');
    const card = await page.$eval('#gmLv', (e) => e.textContent);
    check(/Reading the screen/.test(card) && /Last: 152\.3 carry · 160\.1 total · 4\.2 yds right · 112\.4 mph/.test(card), 'the card says it’s reading, with the shot on the screen');

    // a new shot
    await page.evaluate(() => window.__screen.show({ carry: '158.4', total: '166.0', side: '6.1 L', speed: '115.2', launch: '17.9°', apex: '80.1' }));
    await page.waitForFunction(() => { const st = JSON.parse(localStorage.getItem('golfTracker.v3.dad.game')); return st && st.round && st.round.cards[st.round.idx].shots.length === 1; }, null, { timeout: 15000 });
    let sh = await strokes();
    check(sh.length === 1 && sh[0].kind === 'live', `a new shot on the screen plays (${sh.length} stroke)`);
    // a shot hit while the first is in the air plays once it lands
    await page.evaluate(() => window.__screen.show({ carry: '61.0', total: '64.2', side: '1.0 R', speed: '70.3', launch: '28.4°', apex: '40.0' }));
    await page.waitForTimeout(400);
    await page.waitForFunction(() => { const st = JSON.parse(localStorage.getItem('golfTracker.v3.dad.game')); return st && st.round && st.round.cards[st.round.idx].shots.length >= 2; }, null, { timeout: 25000 });
    sh = await strokes();
    check(sh.length === 2, 'a shot hit during the flight plays after it');
    const msg = await page.$eval('.gm-msg', (e) => e.textContent);
    check(/Off the screen/.test(msg), `the message says where it came from: “${msg.slice(0, 60)}…”`);
    // paused: nothing plays; resumed, the next one does
    await page.waitForFunction(() => !document.querySelector('.gm-skip') || document.querySelector('.gm-skip').hidden, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    const mid = (await strokes()).length;
    await page.evaluate(() => document.querySelector('[data-action="lv-pause"]').click());
    await page.evaluate(() => window.__screen.show({ carry: '30.5', total: '33.0', side: '0.0', speed: '45.0', launch: '35.0°', apex: '25.0' }));
    await page.waitForTimeout(2500);
    check((await strokes()).length === mid, 'paused, a new shot doesn’t play');
    await page.evaluate(() => document.querySelector('[data-action="lv-pause"]').click());
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, 'live-card.png') });
    // off the Game tab nothing plays, and coming back the shot on the screen counts as played
    await page.evaluate(() => document.querySelector('[data-tab="stats"]').click());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__screen.show({ carry: '41.2', total: '44.0', side: '2.0 R', speed: '52.0', launch: '33.0°', apex: '30.0' }));
    await page.waitForTimeout(2000);
    await page.evaluate(() => document.querySelector('[data-tab="game"]').click());
    await page.waitForTimeout(2500);
    check((await strokes()).length === mid, 'a shot hit off the Game tab doesn’t play, even after coming back');
    check(/Last: 41\.2 carry/.test(await page.$eval('#gmLv', (e) => e.textContent)), 'back on the Game tab, it has read what’s on the screen');
    // stopped and shared again, the saved boxes are used straight away
    await page.evaluate(() => document.querySelector('[data-action="lv-stop"]').click());
    await page.waitForTimeout(300);
    check(!!(await page.$('#gmLv [data-action="lv-share"]')), 'Stop goes back to the share button');
    await page.evaluate(() => document.querySelector('[data-action="lv-share"]').click());
    await page.waitForFunction(() => /Reading the screen/.test((document.querySelector('#gmLv') || {}).textContent || ''), null, { timeout: 15000 });
    check(!(await page.$('#lvMark')), 'sharing the same window again skips the marking');
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__screen.show({ carry: '45.6', total: '47.9', side: '1.5 L', speed: '55.1', launch: '31.0°', apex: '28.0' }));
    await page.waitForFunction((n) => { const st = JSON.parse(localStorage.getItem('golfTracker.v3.dad.game')); const r = st && st.round; return r && (r.cards[r.idx].shots.length > n || r.idx > 0); }, mid, { timeout: 15000 });
    check(true, 'and the next shot plays');
    // the screen on a phone-sized page: the card fits
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(over <= 0, `no sideways scroll at phone width (${over}px over)`);
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' / ') : ''}`);
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log(fails ? `\n${fails} failed` : `\nall passed · screenshots in ${outDir}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
