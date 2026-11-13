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
  // Sideways: the ball starts on the line that, with the curve added, lands it at the
  // offline number. The bend grows with the square of the distance.
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

    var curve = num(shot.curve_ft), off = num(shot.offline_ft);
    if (curve == null) { curve = 0; est.push('curve'); }
    if (off == null) { off = curve; est.push('offline'); }
    var cY = curve / 3, oY = off / 3, start = (oY - cY) / C;
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

    var T = num(shot.total_yds), R;
    if (T == null) { R = C * (wedge ? 0.03 : kind === 'iron' ? 0.06 : 0.09); est.push('total'); }
    else R = T - C;
    var head = clamp(start + 2 * cY / C, -0.6, 0.6); // which way it's heading as it lands
    var land = { x: oY, y: 0, z: C };
    var rest = { x: oY + R * head * 0.6, y: 0, z: C + R };
    var aR = Math.abs(R);
    var rollT = aR < 0.3 ? 0.3 : clamp(2 * aR / Math.max(0.45 * speed(H), 1.5), 0.4, 4);
    var hop = aR < 0.3 ? 0.04 : clamp(0.15 + 0.035 * aR, 0.1, 1.6);

    function at(t) {
      if (!(t > 0)) return { x: 0, y: 0, z: 0, phase: 'tee' };
      if (t < H) { var s = along(t); return { x: lateral(s), y: height(s), z: s, phase: 'flight' }; }
      var u = (t - H) / rollT;
      if (u >= 1) return { x: rest.x, y: 0, z: rest.z, phase: 'rest' };
      var d = 1 - (1 - u) * (1 - u), y = 0, z = C + R * d;
      if (u < 0.36) { var a = u / 0.36; y = hop * 4 * a * (1 - a); }
      else if (u < 0.58) { var b = (u - 0.36) / 0.22; y = hop * 1.2 * b * (1 - b); }
      if (R < 0 && u < 0.36) z += 0.5 * Math.sin(Math.PI * u / 0.36); // hops on before it spins back
      return { x: land.x + (rest.x - land.x) * d, y: y, z: z, phase: 'roll' };
    }

    var samples = [], N = 96;
    for (var i = 0; i < N; i++) { var ti = H * i / N, p = at(ti); samples.push({ t: ti, x: p.x, y: p.y, z: p.z }); }
    samples.push({ t: H, x: land.x, y: 0, z: C });

    return {
      club: club, carry: C, total: C + R, apex: A, launch: L, landing: D, hang: H, roll: R, rollT: rollT,
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
  // The points a camera has to fit for one shot: tee, apex, the widest part of the
  // flight, landing spot and resting spot.
  function keyPoints(tr) {
    var s = tr.samples;
    return [{ x: 0, y: 0, z: 0 }, tr.apexPoint, s[Math.round(s.length / 2)], s[Math.round(s.length * 0.8)], tr.land, tr.rest];
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
  // Behind the tee and a little to the right, turned toward the target, like a TV camera
  // on a tee shot. From straight behind, a ball rising and a ball flying away both move
  // up the screen, so the arc would hide; from the side it sweeps across and the arc
  // shows. Framed so every point fits: the tee near the bottom, the highest apex near
  // the top, the farthest ball in view.
  function fitBehind(points, w, h) {
    var far = 30;
    points.forEach(function (p) { if (p.z > far) far = p.z; });
    var side = 3 + 0.07 * far, camH = 2 + 0.035 * far, back = 8 + 0.08 * far, cam = null;
    for (var it = 0; it < 40; it++) {
      var yaw = Math.atan2(-side, 0.55 * far + back);
      var probe = camera(side, camH, -back, 0, 40 * DEG, w, h, yaw), lo = Infinity, hi = -Infinity;
      for (var i = 0; i < points.length; i++) {
        var v = toCam(probe, points[i].x, points[i].y, points[i].z);
        var a = Math.atan2(v.Y, v.Z);
        if (a < lo) lo = a;
        if (a > hi) hi = a;
      }
      var want = (hi - lo) / 0.76;
      cam = camera(side, camH, -back, (hi + lo) / 2, clamp(want, 24 * DEG, 54 * DEG), w, h, yaw);
      if (want <= 54 * DEG && points.every(function (p) { return inside(cam, p, 0.05); })) return cam;
      back *= 1.1;
      side *= 1.04;
      camH *= 1.03;
    }
    return cam;
  }
  // High above, tilted down steeply, centred on the points (where the ball finished and
  // the pin), so the result reads like a hole map.
  function fitOverhead(points, w, h) {
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
  // Part of the way from camera a to camera b, easing in and out.
  function lerpCam(a, b, t) {
    var e = clamp(t, 0, 1);
    e = e * e * (3 - 2 * e);
    function m(p, q) { return p + (q - p) * e; }
    return camera(m(a.x, b.x), m(a.y, b.y), m(a.z, b.z), m(a.pitch, b.pitch), m(a.vfov, b.vfov), a.w, a.h, m(a.yaw || 0, b.yaw || 0));
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
    var v = clipNear(pts.map(function (p) { return toCam(cam, p[0], 0, p[1]); }));
    if (v.length < 3) return false;
    ctx.beginPath();
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

    fillGround(ctx, cam, rectPts(-5, -4, 5, 3), COL.tee);
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
    drawMarkers(ctx, cam, c);

    // Trees and the flag, farthest first so nearer ones overlap them.
    var things = c.trees.map(function (t) { return { t: t, q: project(cam, t.x, 0, t.z) }; })
      .filter(function (o) { return o.q && o.q.x > -60 && o.q.x < w + 60; });
    var flag = project(cam, 0, 0, c.pin);
    if (flag) things.push({ flag: true, q: flag });
    things.sort(function (a, b) { return b.q.z - a.q.z; });
    things.forEach(function (o) { if (o.flag) drawFlag(ctx, cam, c); else drawTree(ctx, cam, o.t, o.q); });
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
  // White posts beside the fairway every 50 yds, numbered when there's room.
  function drawMarkers(ctx, cam, c) {
    var used = [];
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    c.markers.forEach(function (d) {
      var b = project(cam, -c.half - 2.5, 0, d);
      if (!b || b.x < 30 || b.x > cam.w || b.y < 20 || b.y > cam.h) return;
      var len = Math.max(8, 1.2 * b.s);
      ctx.fillStyle = COL.post;
      ctx.fillRect(b.x - 1.5, b.y - len, 3, len);
      var ty = b.y - 1;
      if (used.some(function (u) { return Math.abs(u.y - ty) < 18 && Math.abs(u.x - b.x) < 48; })) return;
      used.push({ x: b.x, y: ty });
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeText(String(d), b.x - 5, ty);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(d), b.x - 5, ty);
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
      if (lq && Math.abs(tr.roll) >= 3) pill(ctx, cam, lq.x, Math.max(lq.y, rest.y) + 52, 'Landed at ' + Math.round(tr.carry), boxes);
      return;
    }
  }
  // The readout in the top corner: how far out and how high the ball is while it flies,
  // then the carry and total once it stops.
  function hudText(tr, t) {
    if (!(t > 0)) return '';
    var p = tr.at(t);
    if (p.phase === 'flight') return Math.round(p.z) + ' yds · ' + Math.round(p.y * 3) + ' ft high';
    if (p.phase === 'roll') return Math.round(tr.carry) + ' carry · rolling';
    return Math.round(tr.carry) + ' carry · ' + Math.round(tr.total) + ' total';
  }
  function drawHud(ctx, cam, text) {
    if (!text) return;
    ctx.font = FONT;
    var pw = Math.ceil(ctx.measureText(text).width) + 20;
    pill(ctx, cam, 10 + pw / 2, 10 + 28 + 10, text);
  }
  // One frame. o: { cam, course, bg (the course already drawn for this camera, or null),
  // past: [trajectories], cur: trajectory, t: seconds into it, hud: true for the corner
  // readout, result: 'overhead' to show the distance to the pin }
  function drawFrame(ctx, o) {
    var cam = o.cam;
    if (o.bg) ctx.drawImage(o.bg, 0, 0, cam.w, cam.h);
    else drawCourse(ctx, cam, o.course);
    (o.past || []).forEach(function (tr) { drawShot(ctx, cam, tr, tr.duration, true); });
    if (o.cur) {
      drawShot(ctx, cam, o.cur, o.t || 0, false);
      if (o.result === 'overhead') drawResult(ctx, cam, o.cur, o.course, 'overhead');
      if (o.hud) drawHud(ctx, cam, hudText(o.cur, o.t || 0));
    }
  }

  return {
    trajectory: trajectory, keyPoints: keyPoints, solveK: solveK,
    camera: camera, project: project, horizonY: horizonY, fitBehind: fitBehind, fitOverhead: fitOverhead, lerpCam: lerpCam,
    course: course, rng: rng, FAIRWAY_HALF: FAIRWAY_HALF,
    drawCourse: drawCourse, drawShot: drawShot, drawFrame: drawFrame, COL: COL
  };
});
