/* KH Golf: reading a launch monitor's screen, live. On a Mac, the iPad (or phone) running the
   Rapsodo app is mirrored to it (QuickTime over the cable, or AirPlay), and the page shares that
   window. It reads the numbers in the boxes he marked (carry, total, side and so on) each time
   they change and settle, and the game plays every new shot.
   The parts with no DOM (reading the text, the checks, spotting a new shot, cleaning up the
   picture for the OCR) work in node too, for the tests. The capture and the OCR run only in a
   browser. The OCR is Tesseract (Apache 2.0), served from vendor/tesseract and loaded only when
   the reader starts. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GolfLive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var YDS_PER_M = 1.0936133, FT_PER_M = 3.2808399, MPH_PER_KMH = 0.6213712, MPH_PER_MS = 2.2369363;

  // What it can read, in the order they're offered. Carry is the one it needs. The total adds
  // the roll, the side where it finished, and the rest the shape of the flight.
  // units: what the screen might show, the usual one first. lo/hi: what's possible, in the
  // game's units (yds, ft for the side and the height, mph, degrees); outside them it's a
  // misread. dir: a number that comes with a left or right.
  var FIELDS = [
    { id: 'carry', name: 'Carry', units: ['yds', 'm'], lo: 1, hi: 400, need: true },
    { id: 'total', name: 'Total', units: ['yds', 'm'], lo: 1, hi: 450 },
    { id: 'side', name: 'Side', units: ['yds', 'ft', 'm'], lo: 0, hi: 700, dir: true },
    { id: 'speed', name: 'Ball speed', units: ['mph', 'km/h', 'm/s'], lo: 5, hi: 230 },
    { id: 'launch', name: 'Launch angle', units: ['°'], lo: 0, hi: 70 },
    { id: 'start', name: 'Launch direction', units: ['°'], lo: 0, hi: 40, dir: true },
    { id: 'apex', name: 'Height', units: ['ft', 'yds', 'm'], lo: 1, hi: 300 },
    { id: 'descent', name: 'Descent angle', units: ['°'], lo: 1, hi: 90 }
  ];
  var FIELD = {};
  FIELDS.forEach(function (f) { FIELD[f.id] = f; });
  // Each unit in the game's: yards for distances, feet for the side and the height, mph.
  var FACTOR = {
    carry: { yds: 1, m: YDS_PER_M }, total: { yds: 1, m: YDS_PER_M },
    side: { yds: 3, ft: 1, m: FT_PER_M },
    speed: { mph: 1, 'km/h': MPH_PER_KMH, 'm/s': MPH_PER_MS },
    apex: { ft: 1, yds: 3, m: FT_PER_M }
  };
  // What the OCR may read: digits, the decimal point (or comma), a minus, and L or R.
  var WHITELIST = '0123456789.,-LR';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function unitOf(id, unit) { var f = FIELD[id]; return f && f.units.indexOf(unit) >= 0 ? unit : f ? f.units[0] : ''; }
  function factor(id, unit) { var k = FACTOR[id]; return k ? k[unitOf(id, unit)] || 1 : 1; }

  // ----- What a box says -----
  // The text the OCR read in one box, as a number: "152.3", "12.4 R", "R 12.4", "L8", "-3.1"
  // and "152,3" all read. A box with no number in it ("--") gives null.
  // dec: how many decimals it showed; digits: how many digits in all; dir: 'L', 'R', '' (none
  // shown) or '?' (both, so it can't tell).
  function parseText(text) {
    var t = String(text == null ? '' : text).toUpperCase()
      .replace(/[−‒–—]/g, '-')
      .replace(/[^0-9.,\-+LR]+/g, ' ').replace(/\s+/g, ' ').trim();
    // a wide 1 read as its own word ("1 52.3") belongs to the number after it
    t = t.replace(/(^|[^\d.,])1 (?=\d)/g, function (m0, pre) { return pre + '1'; }).replace(/([.,]) (?=\d)/g, '$1');
    var m = /([-+]?) ?(\d+)(?:([.,])(\d+))?/.exec(t);
    if (!m) return null;
    var whole = m[2], frac = m[4] || '';
    // "6,543": a comma before three digits is a thousands separator, not a decimal point
    if (m[3] === ',' && frac.length === 3) { whole += frac; frac = ''; }
    var v = parseFloat(whole + (frac ? '.' + frac : ''));
    if (!isFinite(v)) return null;
    var letters = t.replace(/[^LR]/g, ''), dir = '';
    if (letters) dir = /^L+$/.test(letters) ? 'L' : /^R+$/.test(letters) ? 'R' : '?';
    return { v: v, minus: m[1] === '-', plus: m[1] === '+', dir: dir, dec: frac.length, digits: (whole + frac).length, raw: t };
  }

  // What a box usually shows, from its last few readings: how many decimals (Rapsodo shows
  // one), and whether a side number comes with its L or R (or a minus).
  function habit(list) {
    list = (list || []).filter(Boolean);
    var count = {}, signed = 0, bare = 0;
    list.forEach(function (p) {
      count[p.dec] = (count[p.dec] || 0) + 1;
      if (p.v >= 0.5) { if (p.dir || p.minus || p.plus) signed++; else bare++; }
    });
    var dec = 0, n = 0;
    Object.keys(count).forEach(function (d) { if (count[d] > n) { n = count[d]; dec = +d; } });
    // the number's height in the box, once two readings agree on it
    var hs = list.map(function (p) { return p.band; }).filter(isNum).sort(function (a, b) { return a - b; });
    var band = hs.length >= 2 ? hs[hs.length >> 1] : 0;
    return { dec: dec, sure: list.length >= 3 && n / list.length >= 0.8, signed: signed > bare && signed >= 2, band: band };
  }

  // One field's value in the game's units, or null if it can't be right. h: the box's habit,
  // to put back a decimal point the OCR missed or misplaced ("1523" or "15.23" for 152.3).
  function fieldValue(id, p, unit, h) {
    var f = FIELD[id];
    if (!f || !p || p.dir === '?') return null;
    var k = factor(id, unit), v = p.v;
    if (h && h.sure && p.dec !== h.dec && p.digits > h.dec) v = parseFloat(String(Math.round(v * Math.pow(10, p.dec)))) / Math.pow(10, h.dec);
    // ten times too long to be right, with no decimal point read: it lost one
    else if (!p.dec && p.digits >= 2 && v * k > f.hi && v * k / 10 >= f.lo) v /= 10;
    v *= k;
    if (v > f.hi) return null;
    if (f.dir) {
      // a side number that usually has its L or R, read without one, can't be trusted
      if (h && h.signed && v >= 0.5 && !p.dir && !p.minus && !p.plus) return null;
      return p.dir === 'L' || (!p.dir && p.minus) ? -v : v;
    }
    if (p.minus || v < f.lo) return null;
    return v;
  }

  // Every box's value, checked as one shot. Carry is a must. Anything that can't go with it (a
  // total shorter than the carry, a ball speed that couldn't carry that far) is left out, and
  // named in `left`.
  function checkReading(r) {
    r = r || {};
    if (!(isNum(r.carry) && r.carry >= FIELD.carry.lo)) return null;
    var c = r.carry, out = { carry: c }, left = [];
    function keep(id, okay) { if (!isNum(r[id])) return; if (okay) out[id] = r[id]; else left.push(id); }
    keep('total', r.total >= c - 1 && r.total <= c * 1.5 + 40);
    if (out.total != null) out.total = Math.max(out.total, c);
    keep('side', Math.abs(r.side) <= Math.max(60, c * 1.8));
    keep('speed', c <= r.speed * 2.3 && r.speed <= c * 8 + 40);
    keep('launch', true);
    keep('start', true);
    keep('apex', r.apex <= c * 2.4 + 20);
    keep('descent', true);
    out.left = left;
    return out;
  }

  // The same shot still on the screen: the carry, total and side all match.
  function sameReading(a, b) {
    if (!a || !b) return false;
    return ['carry', 'total', 'side'].every(function (k) {
      var x = a[k], y = b[k];
      return (x == null && y == null) || (isNum(x) && isNum(y) && Math.abs(x - y) < 0.05);
    });
  }

  // The curve (ft) that, with the ball starting on its launch direction, finishes it at the
  // side number: the flight's own sum (js/flight.js) solved the other way round. Without a
  // total, the roll is about 6% of the carry.
  function curveFrom(carry, total, sideFt, startDeg) {
    var C = carry, R = isNum(total) ? Math.max(0, total - C) : C * 0.06, st = Math.tan(startDeg * Math.PI / 180);
    return clamp(3 * (sideFt / 3 - st * (C + 0.6 * R)) / (1 + 1.2 * R / C), -150, 150);
  }

  // The reading as a shot for the game, in the data files' keys (offline_ft: negative is left).
  function toShot(r, club) {
    var s = {
      club: club, carry_yds: r1(r.carry), total_yds: isNum(r.total) ? r1(r.total) : null,
      ball_speed_mph: isNum(r.speed) ? r1(r.speed) : null, launch_deg: isNum(r.launch) ? r1(r.launch) : null,
      apex_ft: isNum(r.apex) ? r1(r.apex) : null, landing_deg: isNum(r.descent) ? r1(r.descent) : null,
      hang_time_s: null, offline_ft: isNum(r.side) ? r1(r.side) : 0, curve_ft: null
    };
    if (isNum(r.start) && isNum(r.side)) s.curve_ft = r1(curveFrom(r.carry, r.total, r.side, r.start));
    return s;
  }

  // The reading in a few words: "152.3 carry · 160.1 total · 4.2 yds right".
  function readingText(r, units) {
    if (!r) return '';
    units = units || {};
    var out = [r1(r.carry) + ' carry'];
    if (isNum(r.total)) out.push(r1(r.total) + ' total');
    if (isNum(r.side)) {
      var u = unitOf('side', units.side), v = Math.abs(r.side) / factor('side', u);
      out.push(r1(v) === 0 ? 'straight' : r1(v) + ' ' + u + ' ' + (r.side < 0 ? 'left' : 'right'));
    }
    if (isNum(r.speed)) out.push(r1(r.speed / factor('speed', units.speed)) + ' ' + unitOf('speed', units.speed));
    return out.join(' · ');
  }

  // ----- Spotting a new shot -----
  // A box changed: enough of its little grey copy is different. A digit changing flips a lot
  // of pixels; the faint noise of a mirrored screen doesn't.
  function changed(a, b) {
    var n = Math.min(a.length, b.length), big = 0, sum = 0;
    if (!n || a.length !== b.length) return true;
    for (var i = 0; i < n; i++) { var d = Math.abs(a[i] - b[i]); sum += d; if (d > 40) big++; }
    return big / n > 0.02 || sum / n > 6;
  }
  // Feeds on each sample of the boxes (a little grey copy of each) and says when the screen
  // has changed and then held still for `settle` ms: the moment to read it. The numbers often
  // flicker or a replay plays over them while the launch monitor works the shot out.
  function detector(opts) {
    var settle = (opts && opts.settle) || 700, prev = null, at = 0, pending = false;
    return {
      feed: function (sigs, now) {
        var moved = !!prev && (prev.length !== sigs.length || sigs.some(function (s, i) { return changed(prev[i], s); }));
        prev = sigs;
        if (moved) { pending = true; at = now; return false; }
        if (pending && now - at >= settle) { pending = false; return true; }
        return false;
      },
      reset: function () { prev = null; pending = false; },
      waiting: function () { return pending; }
    };
  }

  // ----- Cleaning up a box for the OCR -----
  // Grey levels from RGBA pixels.
  function grey(rgba) {
    var n = rgba.length >> 2, g = new Uint8ClampedArray(n);
    for (var i = 0; i < n; i++) g[i] = rgba[4 * i] * 0.299 + rgba[4 * i + 1] * 0.587 + rgba[4 * i + 2] * 0.114;
    return g;
  }
  // Otsu's threshold: the grey level that best splits the box in two (the digits and the
  // background).
  function otsu(g) {
    var hist = new Array(256).fill(0), n = g.length, i;
    for (i = 0; i < n; i++) hist[g[i]]++;
    var sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = 0, t = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = n - wB;
      if (!wF) break;
      sB += i * hist[i];
      var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }
  // The box as dark digits on white, the way the OCR reads best: the background (what most of
  // the box's edge is) goes white and the digits black, so a dark screen is flipped. The grey
  // edges of the digits stay grey. A box with nothing in it comes back blank.
  function cleanup(g, w, h) {
    var t = otsu(g), out = new Uint8ClampedArray(g.length), i;
    var light = 0, edge = 0;
    for (var x = 0; x < w; x++) { light += (g[x] > t) + (g[(h - 1) * w + x] > t); edge += 2; }
    for (var y = 1; y < h - 1; y++) { light += (g[y * w] > t) + (g[y * w + w - 1] > t); edge += 2; }
    var hiS = 0, hiN = 0, loS = 0, loN = 0;
    for (i = 0; i < g.length; i++) { if (g[i] > t) { hiS += g[i]; hiN++; } else { loS += g[i]; loN++; } }
    var hi = hiN ? hiS / hiN : 255, lo = loN ? loS / loN : 0, bg = light * 2 >= edge ? hi : lo, fg = light * 2 >= edge ? lo : hi;
    if (!hiN || !loN || Math.abs(bg - fg) < 30) { out.fill(255); return { px: out, blank: true }; }
    for (i = 0; i < g.length; i++) out[i] = clamp(255 * (((g[i] - fg) / (bg - fg)) - 0.15) / 0.7, 0, 255);
    return { px: out, blank: false };
  }
  // The line of the biggest text in the box (the number, not a label above or below it):
  // { x0, y0, x1, y1 }, with the shapes on it. glyphs: the full-height ones (each digit, and an
  // L or R), left to right; dots: where a decimal point sits. Anything small sitting high on
  // the line (a ° sign) is whited out.
  function textBand(px, w, h, want) {
    var ink = function (i) { return px[i] < 128; }, rows = [], x, y;
    for (y = 0; y < h; y++) { var c = 0; for (x = 0; x < w; x++) c += ink(y * w + x); rows.push(c); }
    var bands = [], start = -1, gap = 0;
    for (y = 0; y <= h; y++) {
      if (y < h && rows[y] > 0) { if (start < 0) start = y; gap = 0; continue; }
      if (start < 0) continue;
      if (y < h && ++gap <= 1) continue;
      bands.push({ y0: start, y1: y - gap - (y === h ? 1 : 0) });
      start = -1; gap = 0;
    }
    if (!bands.length) return null;
    // the number's line: the tallest, or the one nearest the height it had before (a label
    // or a unit is never mistaken for it when the number isn't there)
    var b = null;
    if (want > 0) {
      var aim = want * h;
      bands.forEach(function (q) { var d = Math.abs(q.y1 - q.y0 + 1 - aim); if (d <= 0.35 * aim && (!b || d < Math.abs(b.y1 - b.y0 + 1 - aim))) b = q; });
      if (!b) return null;
    } else b = bands.reduce(function (p, q) { return q.y1 - q.y0 > p.y1 - p.y0 ? q : p; });
    var bh = b.y1 - b.y0 + 1, seen = new Uint8Array(w * h), stack = [], shapes = [];
    for (y = b.y0; y <= b.y1; y++) for (x = 0; x < w; x++) {
      var i0 = y * w + x;
      if (seen[i0] || !ink(i0)) continue;
      var sh = { pts: [], top: y, bot: y, x0: x, x1: x };
      seen[i0] = 1; stack.push(i0);
      while (stack.length) {
        var i = stack.pop(), ix = i % w, iy = (i - ix) / w;
        sh.pts.push(i);
        if (iy < sh.top) sh.top = iy;
        if (iy > sh.bot) sh.bot = iy;
        if (ix < sh.x0) sh.x0 = ix;
        if (ix > sh.x1) sh.x1 = ix;
        if (ix > 0) visit(i - 1);
        if (ix < w - 1) visit(i + 1);
        if (iy > b.y0) visit(i - w);
        if (iy < b.y1) visit(i + w);
      }
      shapes.push(sh);
    }
    function visit(j) { if (!seen[j] && ink(j)) { seen[j] = 1; stack.push(j); } }
    var glyphs = [], dots = [], other = [];
    shapes.forEach(function (q) {
      var qh = q.bot - q.top + 1, qw = q.x1 - q.x0 + 1;
      if (qh < 0.5 * bh && q.top <= b.y0 + 0.15 * bh && q.bot < b.y0 + 0.6 * bh) { q.pts.forEach(function (j) { px[j] = 255; }); return; }
      if (qh >= 0.55 * bh) glyphs.push({ x0: q.x0, x1: q.x1, h: qh });
      else if (qh <= 0.3 * bh && qw <= 0.35 * bh && q.bot >= b.y0 + 0.65 * bh) dots.push((q.x0 + q.x1) / 2);
      else other.push(q);
    });
    // a glyph broken in two (a thin stroke lost in a small copy) is still one glyph
    glyphs.sort(function (p, q) { return p.x0 - q.x0; });
    var merged = [];
    glyphs.forEach(function (g) {
      var m = merged[merged.length - 1];
      if (m && Math.min(m.x1, g.x1) - Math.max(m.x0, g.x0) >= 0.5 * Math.min(m.x1 - m.x0, g.x1 - g.x0)) { m.x0 = Math.min(m.x0, g.x0); m.x1 = Math.max(m.x1, g.x1); m.h = Math.max(m.h, g.h); }
      else merged.push({ x0: g.x0, x1: g.x1, h: g.h });
    });
    // No character on it (a row of dashes, a line): nothing to read.
    if (!merged.some(function (g) { return g.h >= 0.8 * (g.x1 - g.x0 + 1); }) || bh < 0.12 * h) return null;
    dots = dots.filter(function (d) { return !merged.some(function (g) { return d >= g.x0 && d <= g.x1; }); }).sort(function (p, q) { return p - q; });
    // A smaller L or R at one end of the line, told apart by its shape: an R has its bowl at the
    // top right, an L nothing there. It counts only when it's the one small shape on that side.
    var mark = null, gx0 = merged[0].x0, gx1 = merged[merged.length - 1].x1;
    [true, false].forEach(function (left) {
      var side = other.filter(function (q) { return left ? q.x1 < gx0 : q.x0 > gx1; });
      if (side.length !== 1 || mark) return;
      var q = side[0], qh = q.bot - q.top + 1, qw = q.x1 - q.x0 + 1;
      if (qh < 0.3 * bh || qw < 0.3 * qh || qw > 1.05 * qh) return;
      var xs = q.x0 + 0.55 * qw, ys = q.top + 0.42 * qh, n = 0;
      q.pts.forEach(function (j) { var jx = j % w, jy = (j - jx) / w; if (jx >= xs && jy <= ys) n++; });
      var f = n / Math.max(1, (q.x1 - xs + 1) * (ys - q.top + 1));
      var kind = f < 0.06 ? 'L' : f > 0.18 ? 'R' : '';
      if (kind) mark = { kind: kind, left: left, x0: q.x0, x1: q.x1 };
    });
    var x0 = w, x1 = -1;
    for (y = b.y0; y <= b.y1; y++) for (x = 0; x < w; x++) if (ink(y * w + x)) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (x1 < 0) return null;
    return { x0: x0, y0: b.y0, x1: x1, y1: b.y1, glyphs: merged, dots: dots, mark: mark };
  }
  // The OCR's text checked against the shapes on the line. It's ok when its digits and letters
  // match the glyphs one for one. The slips Tesseract makes on a screen are put right first: a
  // decimal point missed ("42R" for 4.2 R), and on a side number a smaller L or R missed. With
  // opts.ones (only once no try has matched), a narrow 1 it dropped goes back too.
  function fitText(text, band, opts) {
    opts = opts || {};
    text = String(text || '').toUpperCase();
    if (!band || !band.glyphs) return { text: text, ok: false };
    var bh = band.y1 - band.y0 + 1, mk = opts.dir ? band.mark : null;
    var all = band.glyphs.map(function (g) { return { x0: g.x0, x1: g.x1, narrow: g.x1 - g.x0 + 1 < 0.45 * bh }; });
    if (mk) all = mk.left ? [mk].concat(all) : all.concat([mk]);
    var idx = function () { var o = []; for (var i = 0; i < text.length; i++) if (/[0-9LR]/.test(text[i])) o.push(i); return o; };
    var at = idx();
    if (!at.length) return { text: text, ok: false };
    if (mk && !/[LR]/.test(text)) {
      // read as a digit, or not at all
      if (at.length === all.length) { var j = mk.left ? at[0] : at[at.length - 1]; text = text.slice(0, j) + mk.kind + text.slice(j + 1); }
      else if (at.length === all.length - 1) text = mk.left ? mk.kind + ' ' + text : text.replace(/[^0-9]*$/, '') + ' ' + mk.kind;
      at = idx();
    }
    if (opts.ones && at.length === all.length - 1 && at.length >= 2) {
      for (var k = 0; k < all.length; k++) {
        if (!all[k].narrow || text[at[k]] === '1') continue;
        // right after the glyph before it, and past a decimal point when the dot is before it
        var pos = k ? at[k - 1] + 1 : at[0];
        if (k && band.dots.length && band.dots[0] < all[k].x0) while (/[.,]/.test(text[pos] || '')) pos++;
        text = text.slice(0, pos) + '1' + text.slice(pos);
        break;
      }
      at = idx();
    }
    if (at.length !== all.length) return { text: text, ok: false };
    if (!band.dots.length || /\d[.,]\d/.test(text)) return { text: text, ok: true };
    var dx = band.dots[0], n = all.filter(function (q) { return q.x1 < dx; }).length;
    if (n <= 0 || n >= at.length || !/\d/.test(text[at[n - 1]]) || !/\d/.test(text[at[n]])) return { text: text, ok: true };
    return { text: text.slice(0, at[n - 1] + 1) + '.' + text.slice(at[n - 1] + 1), ok: true, dot: true };
  }

  // A box on the screen, as fractions of the shared window (so it fits a bigger or smaller copy
  // of the same window), from two corners in pixels.
  function boxFrom(a, b, w, h) {
    var x0 = clamp(Math.min(a.x, b.x) / w, 0, 1), x1 = clamp(Math.max(a.x, b.x) / w, 0, 1);
    var y0 = clamp(Math.min(a.y, b.y) / h, 0, 1), y1 = clamp(Math.max(a.y, b.y) / h, 0, 1), r = function (v) { return Math.round(v * 1e5) / 1e5; };
    return { x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) };
  }
  function okBox(b) { return !!b && [b.x, b.y, b.w, b.h].every(isNum) && b.x >= 0 && b.y >= 0 && b.w > 0.004 && b.h > 0.004 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001; }

  // ----- In the browser: the shared window and the OCR -----
  var DOM = typeof document !== 'undefined' && typeof window !== 'undefined';
  function canShare() { return DOM && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia); }
  // Tesseract's core needs WebAssembly with SIMD (Safari 16.4 and later, and every recent Chrome
  // and Firefox). Lockdown Mode turns WebAssembly off.
  function simd() {
    try { return typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; }
  }
  var BASE = 'vendor/tesseract/';
  var ocrP = null;
  // The OCR, started once: Tesseract's English model, reading one line at a time and only the
  // characters a number can have. Everything comes from this site: the worker, the core and
  // the model.
  function ocr() {
    if (ocrP) return ocrP;
    ocrP = new Promise(function (ok, fail) {
      if (!simd()) { fail(new Error('This browser can’t run the reader (it needs Safari 16.4 or later, or Chrome)')); return; }
      var base = new URL(BASE, document.baseURI).href;
      var make = function () {
        if (!window.Tesseract) { fail(new Error('The reader didn’t load')); return; }
        window.Tesseract.createWorker('eng', 1, {
          workerPath: base + 'worker.min.js', corePath: base + 'tesseract-core-simd-lstm.js', langPath: base.replace(/\/$/, ''),
          workerBlobURL: false, cacheMethod: 'none', gzip: true
        }).then(function (w) {
          return w.setParameters({ tessedit_char_whitelist: WHITELIST, tessedit_pageseg_mode: '7', user_defined_dpi: '300' }).then(function () { ok(w); });
        }).catch(function (e) { fail(e instanceof Error ? e : new Error(String(e))); });
      };
      if (window.Tesseract) { make(); return; }
      var s = document.createElement('script');
      s.src = base + 'tesseract.min.js';
      s.onload = make;
      s.onerror = function () { fail(new Error('The reader didn’t load')); };
      document.head.appendChild(s);
    });
    ocrP.catch(function () { ocrP = null; });
    return ocrP;
  }

  var SIG_W = 32, SIG_H = 12, PAD = 14;
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  // The part of a frame a box covers, in the frame's pixels.
  function rectOf(box, W, H) {
    var x = Math.floor(box.x * W), y = Math.floor(box.y * H);
    return { x: x, y: y, w: Math.max(1, Math.min(W - x, Math.ceil(box.w * W))), h: Math.max(1, Math.min(H - y, Math.ceil(box.h * H))) };
  }
  // A box from a frame, cleaned up: the box about 120 px tall, dark digits on white, and the
  // line with the number found on it. Null if the box is empty.
  function prepBox(frame, box, want) {
    var r = rectOf(box, frame.width, frame.height);
    var s = Math.min(clamp(120 / r.h, 0.5, 6), 1600 / r.w);
    var c = canvas(r.w * s, r.h * s), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(frame, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    var id = x.getImageData(0, 0, c.width, c.height), cl = cleanup(grey(id.data), c.width, c.height);
    if (cl.blank) return null;
    var band = textBand(cl.px, c.width, c.height, want);
    if (!band) return null;
    return { px: cl.px, w: c.width, h: c.height, band: band };
  }
  // The number's line for the OCR, `lineH` px tall with white round it. `hard` makes it pure
  // black and white, for another try.
  function lineImage(pb, hard, lineH) {
    var b = pb.band, bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1, k = lineH / bh;
    var c = canvas(bw, bh), x = c.getContext('2d'), id = x.createImageData(bw, bh);
    for (var yy = 0; yy < bh; yy++) for (var xx = 0; xx < bw; xx++) {
      var v = pb.px[(b.y0 + yy) * pb.w + b.x0 + xx], o = 4 * (yy * bw + xx);
      if (hard) v = v < 150 ? 0 : 255;
      id.data[o] = id.data[o + 1] = id.data[o + 2] = v;
      id.data[o + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    var out = canvas(bw * k + 2 * PAD, lineH + 2 * PAD), ox = out.getContext('2d');
    ox.fillStyle = '#fff';
    ox.fillRect(0, 0, out.width, out.height);
    ox.imageSmoothingEnabled = true;
    ox.imageSmoothingQuality = 'high';
    ox.drawImage(c, 0, 0, bw, bh, PAD, PAD, bw * k, lineH);
    return out;
  }
  // The ways it tries a box, in turn, until one reads true: soft edges, then pure black and
  // white, then bigger.
  var TRIES = [[false, 44], [true, 44], [false, 64], [true, 30]];

  // Reads one box of a frame with the OCR worker: its text, what that says, and its value in
  // the game's units (null if it doesn't make sense). It tries another way while the text
  // doesn't match the shapes on the screen (a digit dropped or added) or doesn't make sense,
  // and keeps the first try that does. When none does: the first that does once a dropped 1 is
  // put back, or else a value two tries agree on (marked unsure). h: the box's habit.
  function readField(w, frame, box, id, unit, h) {
    var pb = prepBox(frame, box, h && h.band), dir = !!(FIELD[id] && FIELD[id].dir), tries = [], i = 0;
    var none = { id: id, text: '', p: null, v: null, ok: false };
    if (!pb) return Promise.resolve(none);
    var bandH = (pb.band.y1 - pb.band.y0 + 1) / pb.h;
    function make(raw, fit, n) {
      var p = parseText(fit.text), v = fieldValue(id, p, unit, h);
      if (p) p.band = bandH;
      return { id: id, text: fit.text, raw: raw, p: p, v: v, ok: fit.ok, tries: n };
    }
    function finish() {
      for (var k = 0; k < tries.length; k++) {
        var o = make(tries[k].raw, fitText(tries[k].raw, pb.band, { dir: dir, ones: true }), k + 1);
        if (o.v != null && o.ok) return Object.assign(o, { fixed: true });
      }
      var good = tries.filter(function (o) { return o.v != null; }), best = null;
      good.forEach(function (o) { o.n = good.filter(function (q) { return Math.abs(q.v - o.v) < 1e-9; }).length; if (!best || o.n > best.n) best = o; });
      return best && best.n >= 2 ? Object.assign(best, { unsure: true }) : Object.assign(tries[0] || none, { v: null });
    }
    var next = function () {
      if (i >= TRIES.length) return finish();
      var t = TRIES[i++];
      return w.recognize(lineImage(pb, t[0], t[1])).then(function (res) {
        var raw = (res && res.data && res.data.text || '').trim(), o = make(raw, fitText(raw, pb.band, { dir: dir }), i);
        tries.push(o);
        return o.v != null && o.ok ? o : next();
      });
    };
    return next();
  }

  // The reader. Give it the shared screen (a MediaStream) and it keeps a video of it, takes a
  // small sample of every marked box four times a second, and when they change and settle,
  // reads each box. A reading that isn't the shot already on the screen goes to onShot.
  // opts: onShot(reading), onRead(reading, info), onEnd(), onError(err).
  function reader(opts) {
    opts = opts || {};
    var video = document.createElement('video'), stream = null, timer = 0, boxes = {}, units = {}, hist = {};
    var det = detector({ settle: opts.settle || 700 }), last = null, busy = false, again = false, base = true, paused = false, held = false, frame = null;
    var sig = canvas(SIG_W, SIG_H), sx = sig.getContext('2d', { willReadFrequently: true });
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    // kept in the page (Safari only plays a video that is), but out of sight
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
    function ready() { return stream && video.videoWidth > 0 && video.readyState >= 2; }
    function ids() { return FIELDS.map(function (f) { return f.id; }).filter(function (id) { return okBox(boxes[id]); }); }
    // the whole frame, copied, so every box is read from the same moment
    function grab() {
      if (!ready()) return null;
      if (!frame || frame.width !== video.videoWidth || frame.height !== video.videoHeight) frame = canvas(video.videoWidth, video.videoHeight);
      frame.getContext('2d').drawImage(video, 0, 0);
      return frame;
    }
    function sample() {
      return ids().map(function (id) {
        var r = rectOf(boxes[id], video.videoWidth, video.videoHeight);
        sx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, SIG_W, SIG_H);
        return grey(sx.getImageData(0, 0, SIG_W, SIG_H).data);
      });
    }
    function readBox(id, fr, box, unit) {
      return ocr().then(function (w) { return readField(w, fr, box, id, unit, habit(hist[id])); });
    }
    function readAll() {
      if (busy) { again = true; return; }
      var fr = grab();
      if (!fr) return;
      var list = ids(), bx = boxes, ux = units;
      if (!list.length) return;
      busy = true;
      var first = base, got = {}, seen = {};
      base = false;
      list.reduce(function (p, id) {
        return p.then(function () { return readBox(id, fr, bx[id], ux[id]); }).then(function (o) { got[id] = o.v; seen[id] = o; });
      }, Promise.resolve()).then(function () {
        // the boxes were marked again while it read: this reading is of the old ones
        if (bx !== boxes) return;
        var rd = checkReading(got);
        if (rd) list.forEach(function (id) { if (seen[id].p && rd[id] != null) hist[id] = (hist[id] || []).concat([seen[id].p]).slice(-8); });
        var info = { first: first, same: !!rd && sameReading(rd, last), texts: seen, paused: paused };
        if (rd && (first || paused || !info.same)) last = rd;
        if (opts.onRead) opts.onRead(rd, info);
        if (rd && !first && !info.same && !paused && opts.onShot) opts.onShot(rd);
      }).catch(function (e) { if (opts.onError) opts.onError(e); }).then(function () {
        busy = false;
        if (again) { again = false; readAll(); }
      });
    }
    function tick() {
      if (!ready() || !ids().length || held) return;
      if (base) { det.reset(); det.feed(sample(), Date.now()); readAll(); return; }
      if (det.feed(sample(), Date.now())) readAll();
    }
    return {
      // start with the stream the person shared
      start: function (s) {
        stream = s;
        if (!video.isConnected) document.body.appendChild(video);
        video.srcObject = s;
        var tr = s.getVideoTracks()[0];
        if (tr) tr.addEventListener('ended', function () { if (stream === s && opts.onEnd) opts.onEnd(); });
        if (!timer) timer = setInterval(tick, 250);
        var p = video.play();
        return p && p.then ? p.then(function () { return true; }) : Promise.resolve(true);
      },
      stop: function () {
        if (timer) clearInterval(timer);
        timer = 0;
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
        video.srcObject = null;
        if (video.isConnected) video.remove();
      },
      live: function () { return !!stream && stream.getVideoTracks().some(function (t) { return t.readyState === 'live'; }); },
      ready: ready,
      size: function () { return ready() ? { w: video.videoWidth, h: video.videoHeight } : null; },
      // the boxes ({ carry: {x, y, w, h}, ... } as fractions) and their units
      setBoxes: function (b, u) { boxes = b || {}; units = u || {}; hist = {}; last = null; base = true; det.reset(); },
      // the next reading only sets what's on the screen now: it isn't played
      rebase: function () { base = true; det.reset(); },
      pause: function (on) { paused = !!on; },
      // no reading while the boxes are being marked
      hold: function (on) { held = !!on; if (!on) det.reset(); },
      paused: function () { return paused; },
      // a copy of the screen right now, for marking the boxes
      still: function () { var fr = grab(); if (!fr) return null; var c = canvas(fr.width, fr.height); c.getContext('2d').drawImage(fr, 0, 0); return c; },
      // reads one box from a still, for showing what it reads while marking
      readStill: function (id, still, box, unit) { return readBox(id, still, box, unit); },
      // draws the screen small, with the boxes on it, so he can see it's reading
      thumb: function (c) {
        if (!ready() || !c) return;
        var x = c.getContext('2d'), W = c.width, H = c.height, s = Math.min(W / video.videoWidth, H / video.videoHeight);
        var w = video.videoWidth * s, h = video.videoHeight * s, ox = (W - w) / 2, oy = (H - h) / 2;
        x.fillStyle = '#000';
        x.fillRect(0, 0, W, H);
        x.drawImage(video, ox, oy, w, h);
        x.strokeStyle = '#9be3b9';
        x.lineWidth = 1.5;
        ids().forEach(function (id) { var b = boxes[id]; x.strokeRect(ox + b.x * w, oy + b.y * h, b.w * w, b.h * h); });
      }
    };
  }

  return {
    FIELDS: FIELDS, FIELD: FIELD, WHITELIST: WHITELIST, BASE: BASE,
    parseText: parseText, habit: habit, fieldValue: fieldValue, checkReading: checkReading, sameReading: sameReading,
    curveFrom: curveFrom, toShot: toShot, readingText: readingText, factor: factor, unitOf: unitOf,
    changed: changed, detector: detector, grey: grey, otsu: otsu, cleanup: cleanup, textBand: textBand, boxFrom: boxFrom, okBox: okBox,
    fitText: fitText, canShare: canShare, simd: simd, ocr: ocr, prepBox: prepBox, lineImage: lineImage, readField: readField, TRIES: TRIES, reader: reader
  };
});
