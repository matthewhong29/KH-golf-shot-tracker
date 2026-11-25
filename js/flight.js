// GolfFlight: a shot's flight rebuilt from the range screen's numbers, and a small
// course to watch it on. No dependencies; the node tests load it too.
//
// World units are yards. x is left (−) or right (+) of the target line, y is up, and
// z is down the target line from the tee. A camera is turned left or right by `yaw`
// (positive turns right), then tilted down by `pitch` (negative looks down).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GolfFlight = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  var YPS_PER_MPH = 1760 / 3600;  // yards per second in one mph
  var G_YDS = 9.81 / 0.9144;      // gravity, yd/s²
  var NEAR = 0.5;                 // nearest distance a camera draws, yds

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isWedge(club) { return /^(PW|GW|AW|SW|LW|\d{2}°)$/.test(String(club)); }

  // ---------------------------------------------------------------------------
  // The flight
  // ---------------------------------------------------------------------------
  // trajectory(shot, opts) → null without a carry, else
  //   { carry, total, apex, launch, landing, hang, roll, rollT, duration, land, rest, apexPoint,
  //     estimated: [numbers worked out because the screen didn't give them],
  //     at(t) → { x, y, z, phase: 'tee' | 'flight' | 'roll' | 'rest' }, samples: [{ t, x, y, z }] }
  // opts: { kind: 'driver' | 'wood' | 'hybrid' | 'iron', club, launch: fallback launch angle }.
  //
  // Height: two smooth curves that meet at the apex. The first leaves the ground at the
  // launch angle and levels off at the apex height; the second falls from the apex and
  // meets the ground at the landing angle, at the carry. The apex sits a little past
  // halfway, more so when the ball comes down much steeper than it went up, as drag
  // makes it in a real flight.
  // Sideways: offline is where the ball finished (the data files' convention), so the
  // ball starts on the line that, with the curve in the air (growing with the square of
  // the distance) and then the roll, finishes it at the offline number.
  // Time: the ball leaves at its ball speed and slows the way drag slows it (speed
  // falling off exponentially), reaching the carry at the hang time. Without a hang
  // time, that's estimated from the apex height.
  // Roll: from the carry to the total, with a hop or two, slowing evenly to a stop.
  function trajectory(shot, opts) {
    opts = opts || {};
    shot = shot || {};
    var C = num(shot.carry_yds);
    if (C == null || C <= 0.5) return null;
    var club = String(shot.club || opts.club || '');
    var kind = opts.kind || 'iron', wedge = isWedge(club);
    var est = [];

    var L = num(shot.launch_deg);
    if (L == null) {
      L = num(opts.launch) != null ? opts.launch : wedge ? 30 : kind === 'iron' ? 20 : kind === 'hybrid' ? 16 : 13;
      est.push('launch');
    }
    L = clamp(L, 0.5, 70);
    var A = num(shot.apex_ft) != null ? shot.apex_ft / 3 : null;
    if (A == null) { A = 0.45 * C * Math.tan(L * DEG); est.push('apex'); }
    A = clamp(A, 0.12, C * 1.5);
    var D = num(shot.landing_deg);
    if (D == null) { D = Math.atan(2.2 * A / (0.4 * C)) / DEG; est.push('landing'); }
    D = clamp(D, 0.5, 80);

    // Where the apex sits, kept where both curves can rise and fall without passing it.
    var tL = Math.tan(L * DEG), tD = Math.tan(D * DEG);
    var sA = C * clamp(0.5 + 0.25 * (tD - tL) / (tD + tL), 0.5, 0.7);
    var lo = Math.max(0.3 * C, C - 3 * A / tD), hi = Math.min(0.8 * C, 3 * A / tL);
    if (lo <= hi) sA = clamp(sA, lo, hi);
    else { tL = Math.min(tL, 3 * A / sA); tD = Math.min(tD, 3 * A / (C - sA)); }
    function height(s) {
      if (s <= 0 || s >= C) return 0;
      if (s <= sA) { var u = s / sA; return A * u * u * (3 - 2 * u) + sA * tL * u * (1 - u) * (1 - u); }
      var v = (s - sA) / (C - sA);
      return A * (1 - v * v * (3 - 2 * v)) + tD * (C - sA) * v * v * (1 - v);
    }

    var T = num(shot.total_yds), R;
    if (T == null) { R = C * (wedge ? 0.03 : kind === 'iron' ? 0.06 : 0.09); est.push('total'); }
    else R = T - C;

    // The roll carries on 60% of the way the ball was heading as it landed (the slope of
    // the line below at the carry), so solving for the start line that finishes it at
    // the offline number: start·(C + 0.6R) + curve·(1 + 1.2R/C) = offline.
    var curve = num(shot.curve_ft), off = num(shot.offline_ft);
    if (curve == null) { curve = 0; est.push('curve'); }
    if (off == null) { off = curve; est.push('offline'); }
    var cY = curve / 3, oY = off / 3;
    // opts.start: the start line (yds sideways per yd ahead) when it's known, as when the
    // game moves where a ball stops (a roll down a slope) but not how it flew.
    var start = num(opts.start) != null ? opts.start : (oY - cY * (1 + 1.2 * R / C)) / (C + 0.6 * R);
    function lateral(s) { var r = s / C; return start * s + cY * r * r; }

    var V = num(shot.ball_speed_mph);
    var v0 = V != null && V > 1 ? V * YPS_PER_MPH * Math.cos(L * DEG) : null;
    var H = num(shot.hang_time_s);
    if (H == null || H < 0.3 || H > 15) {
      H = Math.max(0.6, 2.5 * Math.sqrt(2 * A / G_YDS));
      if (v0) H = Math.max(H, 1.12 * C / v0); // never faster than it left the club
      est.push('hang');
    }
    if (!v0) v0 = 1.6 * C / H;
    var k = solveK(C, H, v0), ek = k ? 1 - Math.exp(-k * H) : 1;
    function along(t) { return t >= H ? C : k ? C * (1 - Math.exp(-k * t)) / ek : C * t / H; }
    function speed(t) { return k ? C * k * Math.exp(-k * t) / ek : C / H; }

    var land = { x: lateral(C), y: 0, z: C };
    var rest = { x: oY, y: 0, z: C + R };
    var aR = Math.abs(R);
    var rollT = aR < 0.3 ? 0.3 : clamp(2 * aR / Math.max(0.45 * speed(H), 1.5), 0.4, 4);
    var hop = aR < 0.3 ? 0.04 : clamp(0.15 + 0.035 * aR, 0.1, 1.6);

    function at(t) {
      if (!(t > 0)) return { x: 0, y: 0, z: 0, phase: 'tee' };
      if (t < H) { var s = along(t); return { x: lateral(s), y: height(s), z: s, phase: 'flight' }; }
      var u = (t - H) / rollT;
      if (u >= 1 || t >= H + rollT) return { x: rest.x, y: 0, z: rest.z, phase: 'rest' };
      var d = 1 - (1 - u) * (1 - u), y = 0, z = C + R * d;
      if (u < 0.36) { var a = u / 0.36; y = hop * 4 * a * (1 - a); }
      else if (u < 0.58) { var b = (u - 0.36) / 0.22; y = hop * 1.2 * b * (1 - b); }
      if (R < 0 && u < 0.36) z += 0.5 * Math.sin(Math.PI * u / 0.36); // hops on before it spins back
      return { x: land.x + (rest.x - land.x) * d, y: y, z: z, phase: 'roll' };
    }

    var samples = [], N = 96;
    for (var i = 0; i < N; i++) { var ti = H * i / N, p = at(ti); samples.push({ t: ti, x: p.x, y: p.y, z: p.z }); }
    samples.push({ t: H, x: land.x, y: 0, z: C });
    var apexT = k ? -Math.log(1 - sA * ek / C) / k : H * sA / C;

    return {
      club: club, carry: C, total: C + R, apex: A, launch: L, landing: D, hang: H, roll: R, rollT: rollT, apexT: apexT, start: start, curveY: cY,
      duration: H + rollT, land: land, rest: rest, apexPoint: { x: lateral(sA), y: A, z: sA },
      estimated: est, at: at, height: height, lateral: lateral, along: along, samples: samples
    };
  }
  // Drag rate k so the ball leaves at v0 and covers the carry C in H seconds:
  // C·k / (1 − e^(−kH)) = v0. 0 when v0 is no faster than the average speed.
  function solveK(C, H, v0) {
    if (!(v0 > 1.0005 * C / H)) return 0;
    var lo = 1e-6, hi = 30;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (C * mid / (1 - Math.exp(-mid * H)) > v0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }
  // The points a camera has to fit for one shot: the tee, points all along the flight
  // (seen from the tee, the early climb sits higher in view than the apex, being much
  // closer), the apex, the landing spot and where it stopped.
  function keyPoints(tr) {
    var out = [{ x: 0, y: 0, z: 0 }, tr.apexPoint, tr.land, tr.rest];
    for (var i = 4; i < tr.samples.length; i += 6) out.push(tr.samples[i]);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Cameras
  // ---------------------------------------------------------------------------
  function camera(x, y, z, pitch, vfov, w, h, yaw) {
    yaw = yaw || 0;
    return { x: x, y: y, z: z, pitch: pitch, yaw: yaw, vfov: vfov, w: w, h: h, F: (h / 2) / Math.tan(vfov / 2),
      sp: Math.sin(pitch), cp: Math.cos(pitch), sy: Math.sin(yaw), cy: Math.cos(yaw) };
  }
  function toCam(cam, x, y, z) {
    var rx = x - cam.x, ry = y - cam.y, rz = z - cam.z;
    var X = rx * cam.cy - rz * cam.sy, Z1 = rx * cam.sy + rz * cam.cy;
    return { X: X, Y: ry * cam.cp - Z1 * cam.sp, Z: ry * cam.sp + Z1 * cam.cp };
  }
  function screenOf(cam, v) { return { x: cam.w / 2 + cam.F * v.X / v.Z, y: cam.h / 2 - cam.F * v.Y / v.Z, z: v.Z, s: cam.F / v.Z }; }
  // Screen position of a world point (x, y in CSS pixels), with its depth z and scale s
  // (pixels per yard there); null when it's behind the camera.
  function project(cam, x, y, z) { var v = toCam(cam, x, y, z); return v.Z < NEAR ? null : screenOf(cam, v); }
  function horizonY(cam) { return cam.h / 2 + cam.F * Math.tan(cam.pitch); }
  function inside(cam, p, m) {
    var q = project(cam, p.x, p.y, p.z);
    return !!q && q.x >= cam.w * m && q.x <= cam.w * (1 - m) && q.y >= cam.h * m && q.y <= cam.h * (1 - m);
  }
  // Tilt (and zoom) a camera at a fixed spot and heading so every point fits, from the
  // lowest near the bottom to the highest near the top; null if they can't all fit.
  function aim(x, y, z, yaw, points, w, h, minFov, maxFov, margin) {
    var probe = camera(x, y, z, 0, 40 * DEG, w, h, yaw), lo = Infinity, hi = -Infinity;
    for (var i = 0; i < points.length; i++) {
      var v = toCam(probe, points[i].x, points[i].y, points[i].z);
      if (v.Z < NEAR) return null;
      var a = Math.atan2(v.Y, v.Z);
      if (a < lo) lo = a;
      if (a > hi) hi = a;
    }
    var want = (hi - lo) / (1 - 2.4 * margin);
    if (want > maxFov) return null;
    var cam = camera(x, y, z, (hi + lo) / 2, Math.max(want, minFov), w, h, yaw);
    return points.every(function (p) { return inside(cam, p, margin); }) ? cam : null;
  }
  // From the tee box: standing at the back of it, 8 yds behind the ball, at eye height
  // (a little over 6 ft; tee boxes sit a touch above the fairway), looking down the
  // target line the way the golfer sees the hole. Steps back if the shot won't fit.
  function fitTee(points, w, h) {
    var back = 8, cam = null;
    for (var it = 0; it < 30 && !cam; it++) { cam = aim(-0.6, 2.4, -back, 0, points, w, h, 30 * DEG, 62 * DEG, 0.04); back *= 1.15; }
    return cam || camera(-0.6, 2.4, -back, -8 * DEG, 62 * DEG, w, h, 0);
  }
  // From the side: well off to the right of the hole and square to it, tee on the left,
  // so the whole arc shows against the sky: launch, peak height, the drop and the roll.
  function fitSide(points, w, h) {
    var z0 = Infinity, z1 = -Infinity, top = 0;
    points.forEach(function (p) { z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); top = Math.max(top, p.y); });
    var hf = Math.atan(Math.tan(17 * DEG) * w / h);
    var dist = Math.max(((z1 - z0) / 2 + 12) / Math.tan(hf), 40), camH = 3 + 0.35 * top, cam = null;
    for (var it = 0; it < 30 && !cam; it++) { cam = aim(dist, camH, (z0 + z1) / 2, -90 * DEG, points, w, h, 16 * DEG, 50 * DEG, 0.06); dist *= 1.1; }
    return cam || camera(dist, camH, (z0 + z1) / 2, -4 * DEG, 50 * DEG, w, h, -90 * DEG);
  }
  // Above the green, tilted down steeply and centred on the points (where the ball
  // finished and the green), so the result reads like a hole map.
  function fitGreen(points, w, h) {
    var x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    points.forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
    var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, pitch = -62 * DEG, vfov = 42 * DEG;
    var hf = Math.atan(Math.tan(vfov / 2) * w / h);
    var d = Math.max(((z1 - z0) / 2 + 8) / Math.tan(vfov / 2), ((x1 - x0) / 2 + 8) / Math.tan(hf), 24);
    var cam = null;
    for (var it = 0; it < 30; it++) {
      cam = camera(cx, d * Math.sin(-pitch), cz - d * Math.cos(pitch), pitch, vfov, w, h);
      if (points.every(function (p) { return inside(cam, p, 0.1); })) return cam;
      d *= 1.1;
    }
    return cam;
  }
  // ---------------------------------------------------------------------------
  // The course: laid out from the pin distance, the same every time for one seed
  // ---------------------------------------------------------------------------
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var FAIRWAY_HALF = 15; // a 30-yard fairway, the same as the dispersion charts
  // course(pin, far, seed): green and flag at `pin`, fairway up to the green, bunkers,
  // trees down both sides and behind the green, and yardage markers every 50 yds.
  function course(pin, far, seed) {
    var rnd = rng(seed || Math.round(pin * 37 + far));
    var half = FAIRWAY_HALF, green = { x: 0, z: pin, rx: 11, rz: 13 };
    var c = {
      pin: pin, far: far, seed: seed || 1, half: half, green: green,
      fairway: { z0: Math.min(10, pin - green.rz - 8), z1: pin - green.rz + 3 },
      bunkers: [{ x: -green.rx - 4.5, z: pin - 4, rx: 5.5, rz: 3.6 }, { x: green.rx + 3.5, z: pin + 6, rx: 4.6, rz: 3 }],
      trees: [], markers: []
    };
    if (pin > 140) c.bunkers.push({ x: half + 2, z: Math.round(pin * 0.62), rx: 7, rz: 3.6 });
    var end = Math.max(far, pin + green.rz) + 70;
    [-1, 1].forEach(function (side) {
      for (var z = -14; z < end; z += 8 + rnd() * 7) {
        var x = side * (half + 22 + rnd() * 16);
        c.trees.push({ x: x, z: z, h: 7 + rnd() * 6, r: 3 + rnd() * 2.2, tone: Math.floor(rnd() * 3) });
        if (rnd() < 0.55) c.trees.push({ x: x + side * (7 + rnd() * 9), z: z + rnd() * 5, h: 8 + rnd() * 6, r: 3.4 + rnd() * 2.4, tone: Math.floor(rnd() * 3) });
      }
    });
    for (var x = -96; x <= 96; x += 7 + rnd() * 6) {
      c.trees.push({ x: x, z: pin + green.rz + 34 + rnd() * 26, h: 9 + rnd() * 6, r: 3.8 + rnd() * 2.6, tone: Math.floor(rnd() * 3) });
    }
    c.clouds = [0, 1, 2, 3].map(function () { return { x: rnd(), y: 0.2 + rnd() * 0.55, w: 0.12 + rnd() * 0.12 }; });
    c.hills = [0, 1, 2].map(function () { return rnd() * 6.28; });
    for (var d = 50; d <= pin - 15; d += 50) c.markers.push(d);
    return c;
  }

  // ---------------------------------------------------------------------------
  // Drawing (canvas 2D, in CSS pixels)
  // ---------------------------------------------------------------------------
  var COL = {
    skyTop: '#76aee0', skyLow: '#d8ecf7', cloud: 'rgba(255,255,255,0.75)', hills: '#8eb197', treeline: '#4a7a55',
    rough: '#558d43', roughFar: '#86ad72', fairway: '#78b857', stripe: '#86c564', fringe: '#86c862', green: '#9bd873',
    tee: '#8acb66', sand: '#eedfb0', sandEdge: '#c9b078', trunk: '#6a4e37', leaves: ['#2e6a3a', '#3b7b45', '#285c33'],
    leafShade: 'rgba(0,0,0,0.16)', pole: '#f4f4f4', flag: '#e8463a', post: '#ffffff',
    tracer: '#ff5a1f', glow: 'rgba(255,90,31,0.3)', past: 'rgba(255,214,120,0.9)', ball: '#ffffff', ballEdge: 'rgba(0,0,0,0.45)',
    shadow: '0,0,0', ring: 'rgba(255,255,255,0.95)', roll: 'rgba(255,255,255,0.9)', pill: 'rgba(11,61,41,0.9)', pillText: '#ffffff'
  };
  var FONT = '600 15px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function ellipsePts(cx, cz, rx, rz, n) {
    var out = [];
    for (var i = 0; i < n; i++) { var a = 2 * Math.PI * i / n; out.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]); }
    return out;
  }
  function rectPts(x0, z0, x1, z1) { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }
  // A fairway: straight sides with rounded ends.
  function stadiumPts(half, z0, z1, cap) {
    var out = [], n = 8, i;
    for (i = 0; i <= n; i++) { var a = Math.PI * i / n; out.push([half * Math.cos(a), z0 + cap - cap * Math.sin(a)]); }
    for (i = 0; i <= n; i++) { var b = Math.PI + Math.PI * i / n; out.push([half * Math.cos(b), z1 - cap - cap * Math.sin(b)]); }
    return out;
  }
  function clipNear(v) {
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var a = v[i], b = v[(i + 1) % v.length], ain = a.Z >= NEAR, bin = b.Z >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        var t = (NEAR - a.Z) / (b.Z - a.Z);
        out.push({ X: a.X + (b.X - a.X) * t, Y: a.Y + (b.Y - a.Y) * t, Z: NEAR });
      }
    }
    return out;
  }
  // Trace a shape lying on the ground (points are [x, z]); false when it's all behind the camera.
  function groundPath(ctx, cam, pts) {
    ctx.beginPath();
    return addGround(ctx, cam, pts);
  }
  // The same, added to the path being built (so shapes that overlap fill once).
  function addGround(ctx, cam, pts) {
    var v = clipNear(pts.map(function (p) { return toCam(cam, p[0], 0, p[1]); }));
    if (v.length < 3) return false;
    for (var i = 0; i < v.length; i++) { var s = screenOf(cam, v[i]); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }
    ctx.closePath();
    return true;
  }
  function fillGround(ctx, cam, pts, color) { if (groundPath(ctx, cam, pts)) { ctx.fillStyle = color; ctx.fill(); } }
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // A label in a dark pill; returns its box so labels can avoid each other.
  function pill(ctx, cam, x, y, text, avoid) {
    ctx.font = FONT;
    var pw = Math.ceil(ctx.measureText(text).width) + 20, ph = 28;
    var px = clamp(x - pw / 2, 4, cam.w - pw - 4), py = clamp(y - ph - 10, 4, cam.h - ph - 4);
    var box = { x: px, y: py, w: pw, h: ph };
    if (avoid && avoid.some(function (b) { return b && px < b.x + b.w + 4 && b.x < px + pw + 4 && py < b.y + b.h + 4 && b.y < py + ph + 4; })) return null;
    roundRectPath(ctx, px, py, pw, ph, 14);
    ctx.fillStyle = COL.pill;
    ctx.fill();
    ctx.fillStyle = COL.pillText;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, px + pw / 2, py + ph / 2 + 1);
    return box;
  }

  function drawSky(ctx, cam, c, hy) {
    var g = ctx.createLinearGradient(0, 0, 0, Math.max(1, hy));
    g.addColorStop(0, COL.skyTop);
    g.addColorStop(1, COL.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cam.w, Math.min(cam.h, hy));
    ctx.fillStyle = COL.cloud;
    (c.clouds || []).forEach(function (k) {
      var cy = hy * k.y, cw = cam.w * k.w, cx = cam.w * k.x;
      if (cy < 8) return;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, cw * 0.22, 0, 0, 2 * Math.PI);
      ctx.ellipse(cx + cw * 0.35, cy - cw * 0.1, cw * 0.5, cw * 0.2, 0, 0, 2 * Math.PI);
      ctx.fill();
    });
    // Far hills, then a line of trees along the horizon.
    var ph = c.hills || [0, 2, 4];
    [[COL.hills, 11, 0.011], [COL.treeline, 5, 0.05]].forEach(function (layer, li) {
      ctx.fillStyle = layer[0];
      ctx.beginPath();
      ctx.moveTo(0, hy + 1);
      for (var x = 0; x <= cam.w + 4; x += 4) {
        var y = hy - layer[1] * (0.55 + 0.45 * Math.sin(x * layer[2] + ph[li])) - (li ? 2.5 * Math.abs(Math.sin(x * 0.21 + ph[2])) : 0);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(cam.w, hy + 1);
      ctx.closePath();
      ctx.fill();
    });
  }
  // Everything that doesn't move: sky, ground, fairway, green, bunkers, trees, flag.
  function drawCourse(ctx, cam, c) {
    var w = cam.w, h = cam.h, hy = horizonY(cam);
    var g0 = Math.max(0, hy);
    if (g0 < h) {
      var gr = ctx.createLinearGradient(0, g0, 0, h);
      gr.addColorStop(0, hy > 0 ? COL.roughFar : COL.rough);
      gr.addColorStop(Math.min(1, 0.35), COL.rough);
      ctx.fillStyle = gr;
      ctx.fillRect(0, g0, w, h - g0);
    }
    if (hy > 0) drawSky(ctx, cam, c, hy);

    fillGround(ctx, cam, rectPts(-6, -12, 6, 3), COL.tee);
    var fw = c.fairway, cap = Math.min(10, (fw.z1 - fw.z0) / 3);
    if (fw.z1 - fw.z0 > 6) {
      fillGround(ctx, cam, stadiumPts(c.half, fw.z0, fw.z1, cap), COL.fairway);
      for (var z = fw.z0 + cap; z + 8 <= fw.z1 - cap; z += 16) fillGround(ctx, cam, rectPts(-c.half, z, c.half, z + 8), COL.stripe);
    }
    var gn = c.green;
    fillGround(ctx, cam, ellipsePts(gn.x, gn.z, gn.rx + 2.4, gn.rz + 2.4, 36), COL.fringe);
    fillGround(ctx, cam, ellipsePts(gn.x, gn.z, gn.rx, gn.rz, 36), COL.green);
    c.bunkers.forEach(function (b) {
      if (!groundPath(ctx, cam, ellipsePts(b.x, b.z, b.rx, b.rz, 24))) return;
      ctx.fillStyle = COL.sand;
      ctx.fill();
      ctx.strokeStyle = COL.sandEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    var labels = drawMarkers(ctx, cam, c);

    // Trees and the flag, farthest first so nearer ones overlap them. A camera off to the
    // side of the hole leaves out the trees between it and the hole, which would hide it.
    var aside = Math.abs(cam.x) > c.half + 30;
    var things = c.trees.filter(function (t) { return !(aside && t.x * cam.x > 0); })
      .map(function (t) { return { t: t, q: project(cam, t.x, 0, t.z) }; })
      .filter(function (o) { return o.q && o.q.x > -60 && o.q.x < w + 60; });
    var flag = project(cam, 0, 0, c.pin);
    if (flag) things.push({ flag: true, q: flag });
    things.sort(function (a, b) { return b.q.z - a.q.z; });
    things.forEach(function (o) { if (o.flag) drawFlag(ctx, cam, c); else drawTree(ctx, cam, o.t, o.q); });
    if (cam.pitch > -40 * DEG) drawMarkerLabels(ctx, labels); // from above the green, the labels there say the distances
  }
  function drawTree(ctx, cam, t, base) {
    var top = project(cam, t.x, t.h, t.z);
    if (!top) return;
    var r = Math.max(1.5, t.r * base.s), cx = base.x + (top.x - base.x) * 0.66, cy = base.y + (top.y - base.y) * 0.66;
    ctx.strokeStyle = COL.trunk;
    ctx.lineWidth = Math.max(1, 0.5 * base.s);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.fillStyle = COL.leaves[t.tone % 3];
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = COL.leafShade;
    ctx.beginPath();
    ctx.arc(cx + r * 0.25, cy + r * 0.2, r * 0.75, 0, 2 * Math.PI);
    ctx.fill();
  }
  function drawFlag(ctx, cam, c) {
    var base = project(cam, 0, 0, c.pin);
    if (!base) return;
    // A real flagstick is 7 ft; far away it's drawn at least 22 px tall so it can be seen.
    var hgt = Math.max(2.4, 22 / base.s), top = project(cam, 0, hgt, c.pin);
    if (!top) return;
    var len = Math.max(6, base.y - top.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, Math.max(2, 0.3 * base.s), Math.max(1, 0.12 * base.s), 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = COL.pole;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.fillStyle = COL.flag;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x + len * 0.55, top.y + len * 0.16);
    ctx.lineTo(top.x, top.y + len * 0.32);
    ctx.closePath();
    ctx.fill();
  }
  // White posts beside the fairway every 50 yds. Returns where their numbers go; those
  // are drawn after the trees, so a tree never hides one.
  function drawMarkers(ctx, cam, c) {
    var labels = [];
    c.markers.forEach(function (d) {
      var b = project(cam, -c.half - 2.5, 0, d);
      if (!b || b.x < 30 || b.x > cam.w || b.y < 20 || b.y > cam.h) return;
      var len = Math.max(8, 1.2 * b.s);
      ctx.fillStyle = COL.post;
      ctx.fillRect(b.x - 1.5, b.y - len, 3, len);
      var ty = b.y - 1;
      if (!labels.some(function (u) { return Math.abs(u.y - ty) < 18 && Math.abs(u.x - b.x) < 48; })) labels.push({ x: b.x - 5, y: ty, text: String(d) });
    });
    return labels;
  }
  function drawMarkerLabels(ctx, labels) {
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    labels.forEach(function (l) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(l.text, l.x, l.y);
    });
  }
  function strokePath(ctx, pts, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) { if (i) ctx.lineTo(pts[i].x, pts[i].y); else ctx.moveTo(pts[i].x, pts[i].y); }
    ctx.stroke();
  }
  // One shot at time t: its tracer so far, the landing spot and roll, the ball and its
  // shadow. Earlier shots ('past') show only a thin tracer and where they stopped.
  function drawShot(ctx, cam, tr, t, past) {
    var H = tr.hang, end = Math.min(t, H), pts = [];
    for (var i = 0; i < tr.samples.length && tr.samples[i].t <= end; i++) pts.push(tr.samples[i]);
    if (t > 0 && t < H) pts.push(tr.at(t));
    var scr = pts.map(function (p) { return project(cam, p.x, p.y, p.z); }).filter(Boolean);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (scr.length > 1) {
      if (past) strokePath(ctx, scr, COL.past, 2);
      else { strokePath(ctx, scr, COL.glow, 8); strokePath(ctx, scr, COL.tracer, 3.2); }
    }
    if (t >= H) {
      var lq = project(cam, tr.land.x, 0, tr.land.z);
      if (lq && !past) {
        ctx.strokeStyle = COL.ring;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(lq.x, lq.y, Math.max(4.5, 1.2 * lq.s), Math.max(2.5, 1.2 * lq.s * Math.max(0.3, -cam.sp)), 0, 0, 2 * Math.PI);
        ctx.stroke();
      }
      var now = tr.at(t), rq = project(cam, now.x, 0, now.z);
      if (lq && rq && !past) {
        ctx.setLineDash([2, 5]);
        strokePath(ctx, [lq, rq], COL.roll, 2);
        ctx.setLineDash([]);
      }
    }
    if (past) {
      var pq = project(cam, tr.rest.x, 0, tr.rest.z);
      if (pq) { ctx.fillStyle = COL.past; ctx.beginPath(); ctx.arc(pq.x, pq.y, 2.6, 0, 2 * Math.PI); ctx.fill(); }
      return;
    }
    var p = tr.at(t), sh = project(cam, p.x, 0, p.z), b = project(cam, p.x, p.y, p.z);
    if (!b) return;
    var r = clamp(0.18 * b.s, 3, 6.5);
    if (sh) {
      ctx.fillStyle = 'rgba(' + COL.shadow + ',' + (0.32 * (1 - clamp(p.y / 30, 0, 0.75))).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(sh.x, sh.y, r * 1.15, r * Math.max(0.4, -cam.sp), 0, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = COL.ball;
    ctx.strokeStyle = COL.ballEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(b.x, b.y - (p.y < 0.05 ? r * 0.6 : 0), r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  function yds(v) { return Math.round(v) + (Math.round(v) === 1 ? ' yd' : ' yds'); }
  // Where it finished, seen from above: the distance to the pin and where it landed.
  function drawResult(ctx, cam, tr, c, view) {
    var rest = project(cam, tr.rest.x, 0, tr.rest.z);
    if (!rest) return;
    if (view === 'overhead') {
      var pin = project(cam, 0, 0, c.pin), d = Math.hypot(tr.rest.x, tr.rest.z - c.pin);
      var boxes = [], box = null;
      if (pin && d >= 1) {
        ctx.setLineDash([7, 6]);
        strokePath(ctx, [rest, pin], 'rgba(255,255,255,0.95)', 2);
        ctx.setLineDash([]);
        box = pill(ctx, cam, (rest.x + pin.x) / 2, Math.min(rest.y, pin.y) - 30, yds(d) + ' to the pin');
      } else if (pin) box = pill(ctx, cam, rest.x, rest.y - 30, 'Next to the pin');
      if (box) boxes.push(box);
      var lq = project(cam, tr.land.x, 0, tr.land.z);
      if (lq && Math.abs(tr.roll) >= 3) pill(ctx, cam, lq.x, Math.max(lq.y, rest.y) + 52, 'Landed at ' + yds(tr.carry), boxes);
      return;
    }
  }
  function toPin(tr, c) { return Math.hypot(tr.rest.x, tr.rest.z - c.pin); }
  // The readout in the top corner: how far out and how high the ball is while it flies,
  // then the carry and total once it stops (and, from the tee, how close to the pin).
  function hudLines(tr, t, c, view) {
    if (!(t > 0)) return [];
    var p = tr.at(t);
    if (p.phase === 'flight') return [Math.round(tr.along ? tr.along(t) : p.z) + ' yds · ' + Math.round(p.y * 3) + ' ft high'];
    if (p.phase === 'roll') return [Math.round(tr.carry) + ' carry · rolling'];
    var out = [Math.round(tr.carry) + ' carry · ' + Math.round(tr.total) + ' total'];
    if (view === 'tee') { var d = toPin(tr, c); out.push(d < 1 ? 'Next to the pin' : yds(d) + ' to the pin'); }
    return out;
  }
  function drawHud(ctx, cam, lines) {
    ctx.font = FONT;
    return lines.map(function (text, i) {
      var pw = Math.ceil(ctx.measureText(text).width) + 20;
      return pill(ctx, cam, 10 + pw / 2, 48 + i * 34, text);
    });
  }
  // From the side, the peak height is labelled once the ball has been over the top.
  // Above the apex, or just under it when the corner readout is in the way.
  function drawApex(ctx, cam, tr, t, avoid) {
    if (t < tr.apexT || tr.apex * 3 < 6) return;
    var q = project(cam, tr.apexPoint.x, tr.apexPoint.y, tr.apexPoint.z), text = Math.round(tr.apex * 3) + ' ft';
    if (q && !pill(ctx, cam, q.x, q.y - 4, text, avoid)) pill(ctx, cam, q.x, q.y + 46, text, avoid);
  }
  var VIEWS = ['tee', 'side', 'green'];
  // One frame. o: { cam, view: 'tee' | 'side' | 'green', course, bg (the course already
  // drawn for this camera, or null), past: [trajectories], cur: trajectory, t: seconds
  // into it, hud: false to leave out the corner readout }
  function drawFrame(ctx, o) {
    var cam = o.cam, t = o.t || 0, tr = o.cur;
    if (o.bg) ctx.drawImage(o.bg, 0, 0, cam.w, cam.h);
    else drawCourse(ctx, cam, o.course);
    (o.past || []).forEach(function (p) { drawShot(ctx, cam, p, p.duration, true); });
    if (!tr) return;
    drawShot(ctx, cam, tr, t, false);
    var done = t >= tr.duration, hud = [];
    if (o.view === 'green' && done) drawResult(ctx, cam, tr, o.course, 'overhead');
    else if (o.hud !== false) hud = drawHud(ctx, cam, hudLines(tr, t, o.course, o.view));
    if (o.view === 'side') drawApex(ctx, cam, tr, t, hud);
  }

  // ---------------------------------------------------------------------------
  // Real holes (the Game tab): any shape of hole, as js/game.js builds it
  // ---------------------------------------------------------------------------
  // A heading is the direction a shot or camera faces on the ground: 0 is +z, and it
  // turns right as it grows (the same as a camera's yaw). Sideways is to the right.
  function fwd(heading) { return { x: Math.sin(heading), z: Math.cos(heading) }; }
  // From a spot and heading to the ground: `along` yds ahead and `side` yds to the right.
  function offsetPoint(x, z, heading, along, side) {
    var sh = Math.sin(heading), ch = Math.cos(heading);
    return { x: x + along * sh + side * ch, z: z + along * ch - side * sh };
  }
  // A shot's flight moved onto a hole: it starts at (x, z) and flies along `heading`.
  // The same shape as trajectory()'s result, with every point in hole coordinates.
  function place(tr, x0, z0, heading) {
    function w(p) { var q = offsetPoint(x0, z0, heading, p.z, p.x); return { x: q.x, y: p.y, z: q.z }; }
    var out = {};
    for (var k in tr) if (Object.prototype.hasOwnProperty.call(tr, k)) out[k] = tr[k];
    out.samples = tr.samples.map(function (s) { var q = w(s); q.t = s.t; return q; });
    out.at = function (t) { var p = tr.at(t), q = w(p); q.phase = p.phase; return q; };
    out.land = w(tr.land);
    out.rest = w(tr.rest);
    out.apexPoint = w(tr.apexPoint);
    out.origin = { x: x0, y: 0, z: z0 };
    out.heading = heading;
    out.local = tr;
    return out;
  }
  // The spot on the ground under a point on the screen, or null above the horizon.
  function unproject(cam, sx, sy) {
    var X = (sx - cam.w / 2) / cam.F, Y = -(sy - cam.h / 2) / cam.F;
    var ry = Y * cam.cp + cam.sp, Z1 = -Y * cam.sp + cam.cp;
    var rx = X * cam.cy + Z1 * cam.sy, rz = -X * cam.sy + Z1 * cam.cy;
    if (!(ry < -1e-9)) return null;
    var t = -cam.y / ry;
    return { x: cam.x + rx * t, z: cam.z + rz * t };
  }
  // Straight down from above, turned so `heading` points up the screen, high enough that
  // every point fits inside the margin (a share of the width and height on each side).
  function fitTop(points, w, h, heading, margin) {
    var sh = Math.sin(heading), ch = Math.cos(heading), u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    points.forEach(function (p) {
      var u = p.x * ch - p.z * sh, v = p.x * sh + p.z * ch;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    });
    var m = margin == null ? 0.08 : margin, vf = 40 * DEG, t = Math.tan(vf / 2);
    var halfU = (u1 - u0) / 2 / (1 - 2 * m), halfV = (v1 - v0) / 2 / (1 - 2 * m);
    var hgt = Math.max(halfV / t, halfU / (t * w / h), 12);
    var c = offsetPoint(0, 0, heading, (v0 + v1) / 2, (u0 + u1) / 2);
    return camera(c.x, hgt, c.z, -90 * DEG, vf, w, h, heading);
  }
  // When the Game's camera cuts to the landing: after the apex, once the ball has come down
  // to half its peak height, and at least 0.6 s before it lands (at once for a low shot).
  function landCut(tr) {
    var top = tr.apexPoint ? tr.apexPoint.y : 0, t = tr.hang;
    for (var i = 0; i < tr.samples.length; i++) {
      var s = tr.samples[i];
      if (s.t > tr.apexT && s.y <= 0.5 * top) { t = s.t; break; }
    }
    return Math.max(tr.apexT, Math.min(t, tr.hang - 0.6));
  }
  // Framed on where the ball comes down: from behind and above the landing spot, looking
  // down the line of the shot at about 30°, so the end of the descent, the landing, the
  // bounce and the roll all show, with a little ground round them (and anything in `extra`,
  // such as the pin when it comes down near one). tr: a shot placed on a hole (place()).
  function fitLanding(tr, w, h, heading, extra) {
    var tc = landCut(tr), o = tr.land;
    var pts = tr.samples.filter(function (s) { return s.t >= tc && s.t <= tr.hang; }).map(function (s) { return { x: s.x, y: s.y, z: s.z }; });
    pts.push({ x: tr.land.x, y: 0, z: tr.land.z }, { x: tr.rest.x, y: 0, z: tr.rest.z });
    [[-9, -10], [9, -10], [-9, 6], [9, 6]].forEach(function (q) { var g = offsetPoint(o.x, o.z, heading, q[1], q[0]); pts.push({ x: g.x, y: 0, z: g.z }); });
    (extra || []).forEach(function (p) { pts.push({ x: p.x, y: p.y || 0, z: p.z }); });
    var sh = Math.sin(heading), ch = Math.cos(heading);
    var local = pts.map(function (p) { var dx = p.x - o.x, dz = p.z - o.z; return { x: dx * ch - dz * sh, y: p.y || 0, z: dx * sh + dz * ch }; });
    var x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    local.forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
    var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, pitch = -30 * DEG, vfov = 44 * DEG, d = Math.max(30, (z1 - z0) * 0.9), cam = null;
    for (var it = 0; it < 40; it++) {
      cam = camera(cx, d * Math.sin(-pitch), cz - d * Math.cos(pitch), pitch, vfov, w, h, 0);
      if (local.every(function (p) { return inside(cam, p, 0.08); })) break;
      d *= 1.1;
    }
    var q = offsetPoint(o.x, o.z, heading, cam.z, cam.x);
    return camera(q.x, cam.y, q.z, cam.pitch, cam.vfov, w, h, heading);
  }
  // From behind the ball at (x0, z0), facing `heading`, framed like the tee box view.
  function fitBehind(points, w, h, x0, z0, heading) {
    var sh = Math.sin(heading), ch = Math.cos(heading);
    var local = points.map(function (p) {
      var dx = p.x - x0, dz = p.z - z0;
      return { x: dx * ch - dz * sh, y: p.y || 0, z: dx * sh + dz * ch };
    });
    var c = fitTee(local, w, h), q = offsetPoint(x0, z0, heading, c.z, c.x);
    return camera(q.x, c.y, q.z, c.pitch, c.vfov, w, h, heading + c.yaw);
  }

  var HCOL = {
    water: '#4b97cf', waterEdge: '#d9ecf5', redStake: '#d6332a', ob: '#7f9a6c', whiteStake: '#ffffff', range: '#6c9f58',
    path: 'rgba(226,223,208,0.9)', cup: '#111a15', markers: { 100: '#d6332a', 150: '#ffffff', 200: '#2f6fd6' }
  };
  // A stake 1.1 yds tall, about as thick as a real one near by (at least 0.8 px). From high
  // above (the map) it's a dot; seen from low down, one too far off to stand 3 px tall isn't
  // drawn, so the boundary isn't a row of dots along the horizon.
  function post(ctx, cam, x, z, color, top) {
    var b = project(cam, x, 0, z), t = project(cam, x, top || 1.1, z);
    if (!b || !t || b.x < -10 || b.x > cam.w + 10 || b.y < -10 || b.y > cam.h + 10) return;
    if (Math.abs(b.y - t.y) < 3) {
      if (cam.pitch > -60 * DEG) return;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(b.x, b.y, 2.6, 0, 2 * Math.PI); ctx.fill();
      return;
    }
    var w = clamp(0.1 * b.s, 0.8, 2.5);
    if (w > 1.2) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = w + 2;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y - 0.01); ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y - 0.01); ctx.stroke();
  }
  // A flag on a pin at (x, z), at least 22 px tall so it can be seen from far away.
  function flagAt(ctx, cam, x, z) {
    var base = project(cam, x, 0, z);
    if (!base) return;
    var hgt = Math.max(2.4, 22 / base.s), top = project(cam, x, hgt, z);
    if (!top) return;
    var len = Math.max(6, Math.hypot(base.x - top.x, base.y - top.y));
    ctx.fillStyle = HCOL.cup;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, Math.max(2.5, 0.06 * base.s), Math.max(1.4, 0.06 * base.s * Math.max(0.3, -cam.sp)), 0, 0, 2 * Math.PI);
    ctx.fill();
    if (len < 8) return; // straight down from above: the cup is enough, the map draws its own flag
    ctx.strokeStyle = COL.pole;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
    ctx.fillStyle = COL.flag;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x + len * 0.55, top.y + len * 0.16);
    ctx.lineTo(top.x, top.y + len * 0.32);
    ctx.closePath();
    ctx.fill();
  }
  // Mowing stripes across a fairway, clipped to it (its outline must be the current path):
  // bands 14 yds deep every 28 yds, square to its spine (o.spine, from GolfGame: its hole's
  // line of play, corners rounded), so on a dogleg they turn with the hole.
  function stripes(ctx, cam, o) {
    var sp = o.spine;
    if (!sp || sp.pts.length < 2) return;
    ctx.save();
    ctx.clip();
    ctx.fillStyle = COL.stripe;
    for (var s = sp.s0 + 8; s < sp.s1; s += 28) {
      var l = [], r = [];
      [s, s + 7, s + 14].forEach(function (t) {
        var c = spineAt(sp, Math.min(t, sp.s1)), ch = Math.cos(c.h), sh = Math.sin(c.h);
        l.push([c.x - ch * sp.span, c.z + sh * sp.span]);
        r.unshift([c.x + ch * sp.span, c.z - sh * sp.span]);
      });
      if (groundPath(ctx, cam, l.concat(r))) ctx.fill();
    }
    ctx.restore();
  }
  // The point s yds along a spine, and its heading there.
  function spineAt(sp, s) {
    var p = sp.pts, i = 0;
    while (i < p.length - 2 && p[i + 1].s < s) i++;
    var a = p[i], b = p[i + 1], u = clamp((s - a.s) / ((b.s - a.s) || 1), 0, 1), dh = b.h - a.h;
    if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, h: a.h + dh * u };
  }
  // Cart paths: strips of pale ground 8 ft wide (H.ground.pathStrips, from GolfGame), filled
  // together so where two meet isn't paler.
  function cartPaths(ctx, cam, G) {
    var any = false;
    ctx.beginPath();
    (G.pathStrips || []).forEach(function (o) { if (addGround(ctx, cam, o.poly)) any = true; });
    if (!any) return;
    ctx.fillStyle = HCOL.path;
    ctx.fill();
  }
  // The lie of the land on the map from above (H.ground.elev, from GolfGame): each slope
  // shaded as if lit from the north-west, darker facing away and lighter facing the light,
  // made once per course as a small image, a pixel for each height in the grid, and kept
  // inside the course's boundary.
  function shadeOf(G) {
    if (G.shade !== undefined) return G.shade;
    var e = G.elev, cv = e && typeof document !== 'undefined' ? document.createElement('canvas') : null, c = cv && cv.getContext ? cv.getContext('2d') : null;
    if (!c) return (G.shade = null);
    cv.width = e.nx; cv.height = e.nz;
    var img = c.createImageData(e.nx, e.nz), d = img.data, LX = -0.5, LY = 0.7071, LZ = 0.5, EX = 2.4;
    for (var j = 0; j < e.nz; j++) {
      for (var i = 0; i < e.nx; i++) {
        var a = e.h[j * e.nx + Math.max(0, i - 1)], b = e.h[j * e.nx + Math.min(e.nx - 1, i + 1)];
        var u = e.h[Math.max(0, j - 1) * e.nx + i], v = e.h[Math.min(e.nz - 1, j + 1) * e.nx + i];
        var gx = EX * (b - a) / 3 / (2 * e.step), gz = EX * (v - u) / 3 / (2 * e.step), n = Math.sqrt(gx * gx + 1 + gz * gz);
        var lit = (-gx * LX + LY - gz * LZ) / n - LY, k = 4 * (j * e.nx + i);
        if (lit < 0) { d[k] = 0; d[k + 1] = 20; d[k + 2] = 0; d[k + 3] = Math.min(125, -lit * 800); }
        else { d[k] = 255; d[k + 1] = 255; d[k + 2] = 230; d[k + 3] = Math.min(75, lit * 600); }
      }
    }
    c.putImageData(img, 0, 0);
    // Only on the course: kept inside its boundary.
    if (G.boundary) {
      c.globalCompositeOperation = 'destination-in';
      c.beginPath();
      G.boundary.forEach(function (q, k) { var px = (q[0] - e.x0) / e.step + 0.5, pz = (q[1] - e.z0) / e.step + 0.5; if (k) c.lineTo(px, pz); else c.moveTo(px, pz); });
      c.closePath();
      c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    return (G.shade = cv);
  }
  function drawShade(ctx, cam, G) {
    var e = G.elev, sh = e && cam.pitch < -80 * DEG ? shadeOf(G) : null;
    if (!sh) return;
    var p0 = project(cam, e.x0, 0, e.z0), px = project(cam, e.x0 + e.step, 0, e.z0), pz = project(cam, e.x0, 0, e.z0 + e.step);
    if (!p0 || !px || !pz) return;
    // The heights are 6 yds apart, too coarse to show close up: it fades as the map zooms in
    // past 4 px a yard (a third as strong by 11).
    var k = Math.hypot(px.x - p0.x, px.y - p0.y) / e.step;
    ctx.save();
    ctx.globalAlpha = clamp((14 - k) / 10, 0.3, 1);
    ctx.transform(px.x - p0.x, px.y - p0.y, pz.x - p0.x, pz.y - p0.y, p0.x, p0.y);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sh, -0.5, -0.5);
    ctx.restore();
  }
  // Everything on a hole that doesn't move, on the course's ground (H.ground, from
  // GolfGame.buildHole): out of bounds and Lake Merced beyond the boundary; the rough,
  // practice ground, fairways (mowed in stripes), tee boxes, greens, bunkers and cart
  // paths; the yardage markers and the stakes along the boundary (white for out of
  // bounds, red by the lake); then the trees and the flag, farthest first. pin is { x, z }.
  // opts.near: leave out trees closer to the camera than this (yds), so a view from behind
  // the ball isn't blocked by the tree it's under.
  function drawHole(ctx, cam, H, pin, opts) {
    opts = opts || {};
    var G = H.ground, w = cam.w, h = cam.h, hy = horizonY(cam), g0 = Math.max(0, hy);
    if (g0 < h) { ctx.fillStyle = HCOL.ob; ctx.fillRect(0, g0, w, h - g0); }
    if (hy > 0) drawSky(ctx, cam, H, hy);
    if (groundPath(ctx, cam, G.lake)) {
      ctx.fillStyle = HCOL.water;
      ctx.fill();
      ctx.strokeStyle = HCOL.waterEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (groundPath(ctx, cam, G.boundary)) {
      var gr = ctx.createLinearGradient(0, g0, 0, h);
      gr.addColorStop(0, hy > 0 ? COL.roughFar : COL.rough);
      gr.addColorStop(0.35, COL.rough);
      ctx.fillStyle = gr;
      ctx.fill();
    }
    G.ranges.forEach(function (o) { fillGround(ctx, cam, o.poly, HCOL.range); });
    G.fairways.forEach(function (o) {
      if (!groundPath(ctx, cam, o.poly)) return;
      ctx.fillStyle = COL.fairway;
      ctx.fill();
      stripes(ctx, cam, o);
    });
    G.tees.forEach(function (o) { fillGround(ctx, cam, o.poly, COL.tee); });
    if (H.teeBoxDrawn) fillGround(ctx, cam, H.teeBox, COL.tee);
    drawShade(ctx, cam, G); // the slopes, on the map; under the greens, which putt level
    G.greens.forEach(function (o, i) { if (i !== H.green.index) fillGround(ctx, cam, o.poly, COL.green); });
    fillGround(ctx, cam, H.green.fringePoly, COL.fringe);
    fillGround(ctx, cam, H.green.poly, COL.green);
    G.bunkers.forEach(function (o) {
      if (!groundPath(ctx, cam, o.poly)) return;
      ctx.fillStyle = COL.sand;
      ctx.fill();
      ctx.strokeStyle = COL.sandEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    cartPaths(ctx, cam, G);
    // The yardage markers: discs a yard across (no bigger than 9 px, near by; one too far off
    // to be a pixel across isn't drawn), and on the map at least 3.5 px.
    var top = cam.pitch < -60 * DEG;
    H.markers.forEach(function (m) {
      var q = project(cam, m.x, 0, m.z);
      if (!q) return;
      var rx = top ? Math.max(3.5, 0.5 * q.s) : Math.min(9, 0.5 * q.s);
      if (rx < 1) return;
      ctx.fillStyle = HCOL.markers[m.d] || '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = Math.min(1.5, rx * 0.4);
      ctx.beginPath();
      ctx.ellipse(q.x, q.y, rx, Math.max(top ? 1.6 : 0.6, rx * Math.max(0.3, -cam.sp)), 0, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    });
    G.obStakes.forEach(function (s) { post(ctx, cam, s[0], s[1], HCOL.whiteStake); });
    G.lakeStakes.forEach(function (s) { post(ctx, cam, s[0], s[1], HCOL.redStake); });
    var near = opts.near || 0;
    var things = [];
    G.trees.forEach(function (t) {
      var q = project(cam, t.x, 0, t.z);
      if (q && q.z >= near && q.x > -100 && q.x < w + 100 && q.y > -100 && q.y < h + 400) things.push({ t: t, q: q });
    });
    if (pin) { var fq = project(cam, pin.x, 0, pin.z); if (fq) things.push({ flag: true, q: fq }); }
    things.sort(function (a, b) { return b.q.z - a.q.z; });
    things.forEach(function (o) { if (o.flag) flagAt(ctx, cam, pin.x, pin.z); else drawTree(ctx, cam, o.t, o.q); });
  }

  return {
    trajectory: trajectory, keyPoints: keyPoints, solveK: solveK,
    camera: camera, project: project, inside: inside, horizonY: horizonY, fitTee: fitTee, fitSide: fitSide, fitGreen: fitGreen, VIEWS: VIEWS,
    course: course, rng: rng, FAIRWAY_HALF: FAIRWAY_HALF,
    drawCourse: drawCourse, drawShot: drawShot, drawFrame: drawFrame, COL: COL,
    fwd: fwd, offsetPoint: offsetPoint, place: place, unproject: unproject, fitTop: fitTop, fitBehind: fitBehind, fitLanding: fitLanding, landCut: landCut,
    drawHole: drawHole, flagAt: flagAt, pill: pill, HCOL: HCOL, G_YDS: G_YDS
  };
});
