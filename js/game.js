// GolfGame: play a real course with your own shots (the Game tab). Needs js/flight.js
// (GolfFlight) and js/core.js (GolfCore); the node tests load it too.
//
// Every swing-meter shot is one of the player's real range shots with that club. The
// timing picks which: right on the line gives one of his best, a little off one of his
// ordinary ones (early ones that went left, late ones that went right), and way off one
// of his mis-hits. The power sets how far it goes: a 70% swing flies 70% as far. From
// the range, the shot he just hit is typed in instead, and a simulator could hand over
// its numbers the same way: playShot takes any shot with the usual keys.
//
// Hole coordinates are yards, the same as GolfFlight's: x across, z along, y up. The
// back tee sits at (0, 0) and the hole starts out heading up +z.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./flight.js'), require('./core.js'));
  else root.GolfGame = factory(root.GolfFlight, root.GolfCore);
})(typeof self !== 'undefined' ? self : this, function (FL, C) {
  'use strict';

  var DEG = Math.PI / 180;
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function seedOf(str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function headingTo(a, b) { return Math.atan2(b.x - a.x, b.z - a.z); }

  // ---------------------------------------------------------------------------
  // A hole's ground, built from the course data (js/courses.js)
  // ---------------------------------------------------------------------------
  var STEP = 2;          // yds between points on the line of play
  var BEHIND = 70;       // the line of play runs on this far behind the back tee...
  var BEYOND = 110;      // ...and past the middle of the green
  var TURN_R = 130;      // doglegs bend around a curve this tight (yds)
  var FRINGE = 2.2;      // the fringe around the green (yds)
  var TREE_DEPTH = 58;   // how deep a line of trees is (yds)
  var LAKE = 300;        // how far a lake reaches out from its shore (yds)
  var LAKE_END = 25;     // its shore curves away over this many yds at each end

  // A blob: an ellipse with a gently wavy edge, rx across and rz along `rot`.
  function blob(c, rx, rz, rot, rnd, wave) {
    var p1 = rnd() * 6.28, p2 = rnd() * 6.28, a1 = wave * (0.6 + 0.4 * rnd()), a2 = wave * 0.6 * rnd();
    var b = { x: c.x, z: c.z, rx: rx, rz: rz, rot: rot, p1: p1, p2: p2, a1: a1, a2: a2 };
    b.poly = blobPoly(b, 0);
    return b;
  }
  function lobe(b, a) { return 1 + b.a1 * Math.sin(2 * a + b.p1) + b.a2 * Math.sin(3 * a + b.p2); }
  function blobPoly(b, grow) {
    var out = [], n = 44;
    for (var i = 0; i < n; i++) {
      var a = 2 * Math.PI * i / n, r = lobe(b, a);
      var q = FL.offsetPoint(b.x, b.z, b.rot, (b.rz + grow) * r * Math.sin(a), (b.rx + grow) * r * Math.cos(a));
      out.push([q.x, q.z]);
    }
    return out;
  }
  function inBlob(b, x, z, grow) {
    var dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
    var u = (dx * c - dz * s) / (b.rx + grow), v = (dx * s + dz * c) / (b.rz + grow);
    return Math.hypot(u, v) <= lobe(b, Math.atan2(v, u));
  }
  function inPoly(poly, x, z) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  // A shore or boundary given as a number, or as [[g, edge], …] from the tee end toward the green.
  function edgeAt(edge, g) {
    if (isNum(edge)) return edge;
    if (!edge || !edge.length) return 0;
    if (g >= edge[0][0]) return edge[0][1];
    for (var i = 0; i < edge.length - 1; i++) {
      var a = edge[i], b = edge[i + 1];
      if (g <= a[0] && g >= b[0]) return a[1] + (b[1] - a[1]) * (a[0] - g) / ((a[0] - b[0]) || 1);
    }
    return edge[edge.length - 1][1];
  }
  function gSteps(from, to, step) {
    var out = [];
    for (var g = from; g > to; g -= step) out.push(g);
    out.push(to);
    return out;
  }

  // buildHole(course, n, teeId) → the hole's ground for that tee: the line of play, the
  // tees, fairway, green and fringe, bunkers, grassy hollows, water and penalty areas,
  // out of bounds (with its stakes), the trees and the ground under them, and the
  // 100/150/200 yd markers. The same every time for one course and hole.
  function buildHole(course, n, teeId) {
    var def = null;
    (course.holes || []).forEach(function (h) { if (h.n === n) def = h; });
    if (!def) return null;
    var tees = course.tees.filter(function (t) { return isNum(def.yds[t.id]); });
    if (!tees.length) return null;
    var L = Math.max.apply(null, tees.map(function (t) { return def.yds[t.id]; }));
    var tee = tees.filter(function (t) { return t.id === teeId; })[0] || tees[tees.length - 1];
    var rnd = FL.rng(seedOf(course.id + ':' + n));
    var turns = (def.turns || []).map(function (t) {
      var a = t.deg * DEG;
      return { s: L - t.g, a: a, len: Math.max(24, TURN_R * Math.abs(a)) };
    });
    function headingAt(s) {
      var hd = 0;
      turns.forEach(function (t) { hd += t.a * smooth((s - (t.s - t.len / 2)) / t.len); });
      return hd;
    }
    // The line of play: a point every STEP yds, from behind the back tee to past the green.
    var path = [], x = 0, z = -BEHIND;
    for (var s = -BEHIND; s <= L + BEYOND; s += STEP) {
      path.push({ s: s, x: x, z: z, h: headingAt(s) });
      var hm = headingAt(s + STEP / 2);
      x += Math.sin(hm) * STEP;
      z += Math.cos(hm) * STEP;
    }
    function at(s) {
      var i = clamp(Math.floor((s + BEHIND) / STEP), 0, path.length - 2), a = path[i], b = path[i + 1];
      var u = (s - a.s) / STEP;
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, h: a.h + (b.h - a.h) * u };
    }
    // g yds back from the middle of the green, `side` yds right of the line of play.
    function spot(g, side) { var p = at(L - g); return FL.offsetPoint(p.x, p.z, p.h, 0, side || 0); }
    function pt(g, side) { var q = spot(g, side); return [q.x, q.z]; }

    var H = {
      course: course.id, n: def.n, par: def.par, tee: tee.id, yds: def.yds[tee.id], note: def.note || '', L: L,
      path: path, at: at, spot: spot,
      bunkers: [], hollows: [], water: [], ob: [], treeZones: [], trees: [], tees: [], markers: [], stripes: []
    };
    var gd = def.green.d / 2, gw = def.green.w / 2;
    var g0 = at(L);
    H.green = blob({ x: g0.x, z: g0.z }, gw, gd, g0.h, rnd, 0.05);
    H.green.fringePoly = blobPoly(H.green, FRINGE);

    // Tee boxes: 9 yds across and 7 deep, one for each set of tees.
    tees.forEach(function (t) {
      var g = def.yds[t.id], p = at(L - g), poly = [];
      [[-4.5, -3.5], [4.5, -3.5], [4.5, 3.5], [-4.5, 3.5]].forEach(function (c) {
        var q = FL.offsetPoint(p.x, p.z, p.h, c[1], c[0]);
        poly.push([q.x, q.z]);
      });
      H.tees.push({ id: t.id, name: t.name, x: p.x, z: p.z, h: p.h, poly: poly, active: t.id === tee.id });
      if (t.id === tee.id) H.start = { x: p.x, z: p.z, h: p.h };
    });

    // The fairway: from about 95 yds in front of the forward tee to the green (a short
    // apron in front of the green on a par 3), with gently wavy edges, narrowing to the
    // green's width as it gets there.
    var forward = Math.min.apply(null, tees.map(function (t) { return def.yds[t.id]; }));
    var par3 = def.par === 3, half = par3 ? Math.max(6, gw - 3) : (def.fw || 16);
    var f1 = par3 ? gd + 22 : forward - 95, f2 = gd - 2, ph = rnd() * 6.28;
    function fwW(g) {
      var base = half + (par3 ? 0 : 2 * Math.sin(g / 37 + ph));
      var narrow = (gw - 1) + (base - (gw - 1)) * smooth((g - f2) / 40);
      return Math.max(1, narrow * (0.25 + 0.75 * Math.sqrt(clamp((f1 - g) / 12, 0, 1))));
    }
    H.fwHalf = fwW;
    function strip(ga, gb, wf) {
      var gs = gSteps(ga, gb, 3), poly = [];
      gs.forEach(function (g) { poly.push(pt(g, wf(g))); });
      gs.slice().reverse().forEach(function (g) { poly.push(pt(g, -wf(g))); });
      return poly;
    }
    H.fairway = strip(f1, f2, fwW);
    for (var sa = f1 - 10; sa - 14 > f2 + 8; sa -= 28) H.stripes.push(strip(sa, sa - 14, fwW));

    (def.bunkers || []).forEach(function (b) {
      var p = at(L - b.g), c = spot(b.g, b.x);
      H.bunkers.push(blob(c, b.w / 2, b.d / 2, p.h + (rnd() - 0.5) * 0.6, rnd, 0.13));
    });
    (def.hollows || []).forEach(function (b) {
      var p = at(L - b.g), c = spot(b.g, b.x);
      H.hollows.push(blob(c, b.w / 2, b.d / 2, p.h + (rnd() - 0.5) * 0.4, rnd, 0.1));
    });

    // Water and penalty areas: beyond a shore on one side. A lake reaches far out (its
    // far side is joined up well away from the hole); a penalty area is `width` deep.
    // Penalty areas get red stakes along their edge.
    (def.water || []).forEach(function (o) {
      var sd = o.side === 'right' ? 1 : -1, wav = rnd() * 6.28, lake = o.kind !== 'penalty';
      var gs = gSteps(o.from, o.to, 5), shore = gs.map(function (g) { return pt(g, sd * (edgeAt(o.edge, g) + (lake ? 2.5 * Math.sin(g / 19 + wav) : 0))); });
      var poly;
      if (lake) {
        // Its shore curves away at both ends (a quarter circle), then it reaches far out.
        var e0 = edgeAt(o.edge, o.from) + 2.5 * Math.sin(o.from / 19 + wav), e1 = edgeAt(o.edge, o.to) + 2.5 * Math.sin(o.to / 19 + wav), R = LAKE_END, k, t;
        var capA = [], capB = [];
        for (k = 6; k > 0; k--) { t = k / 6 * Math.PI / 2; capA.push(pt(o.from + R - R * Math.cos(t), sd * (e0 + R * Math.sin(t)))); }
        for (k = 1; k <= 6; k++) { t = k / 6 * Math.PI / 2; capB.push(pt(o.to - R + R * Math.cos(t), sd * (e1 + R * Math.sin(t)))); }
        // Out from each end, a wavy shore of its own.
        var outA = [], outB = [];
        for (k = 1; k <= 8; k++) {
          outB.push(pt(o.to - R + 7 * Math.sin(k * 1.3 + wav), sd * (e1 + R + LAKE * k / 8)));
          outA.unshift(pt(o.from + R + 7 * Math.sin(k * 1.1 + wav), sd * (e0 + R + LAKE * k / 8)));
        }
        poly = capA.concat(shore, capB, outB, outA);
      } else {
        var wd = o.width || 40;
        poly = shore.concat(gs.slice().reverse().map(function (g) { return pt(g, sd * (edgeAt(o.edge, g) + wd)); }));
      }
      H.water.push({ kind: lake ? 'water' : 'penalty', poly: poly, stakes: lake ? [] : shore.filter(function (p, i) { return i % 5 === 0; }) });
    });
    // Out of bounds: beyond a line on one side, or past the green.
    (def.ob || []).forEach(function (o) {
      var sd = o.side === 'right' ? 1 : -1, gs = gSteps(o.from, o.to, 5);
      var line = gs.map(function (g) { return pt(g, sd * edgeAt(o.edge, g)); });
      var poly = line.concat(gs.slice().reverse().map(function (g) { return pt(g, sd * (edgeAt(o.edge, g) + 80)); }));
      H.ob.push({ poly: poly, stakes: line.filter(function (p, i) { return i % 5 === 0; }) });
    });
    if (isNum(def.obLong)) {
      var gl = -def.obLong, line = [];
      for (var xs = -75; xs <= 75; xs += 25) line.push(pt(gl, xs));
      H.ob.push({ poly: [pt(gl, -75), pt(gl, 75), pt(gl - 80, 75), pt(gl - 80, -75)], stakes: line });
    }

    // Trees: a line down each side (where the course has one), more behind the green, and
    // any single trees the hole is known for. The ground under them is darker.
    var top = L + 40, inWater = function (q) { return H.water.some(function (o) { return inPoly(o.poly, q.x, q.z); }); };
    function tree(q, big) {
      if (inWater(q)) return;
      H.trees.push({ x: q.x, z: q.z, h: (big ? 16 : 12) + rnd() * (big ? 4 : 9), r: (big ? 6 : 3.6) + rnd() * 2.6, tone: Math.floor(rnd() * 3) });
    }
    [['left', -1], ['right', 1]].forEach(function (sd) {
      var d = def.trees ? def.trees[sd[0]] : null;
      if (!isNum(d)) return;
      H.treeZones.push(zone(d, sd[1]));
      for (var g = top; g > -36; g -= 9 + rnd() * 5) {
        tree(spot(g, sd[1] * (d + 2 + Math.pow(rnd(), 1.6) * (TREE_DEPTH - 8))));
        if (rnd() < 0.6) tree(spot(g - 4, sd[1] * (d + 8 + rnd() * (TREE_DEPTH - 14))));
      }
    });
    function zone(d, sd) {
      var gs = gSteps(top, -36, 5);
      return gs.map(function (g) { return pt(g, sd * d); }).concat(gs.slice().reverse().map(function (g) { return pt(g, sd * (d + TREE_DEPTH)); }));
    }
    var back = [pt(-38, -75), pt(-38, 75), pt(-92, 75), pt(-92, -75)];
    if (!H.water.some(function (o) { return o.kind === 'water' && back.some(function (p) { return inPoly(o.poly, p[0], p[1]); }); })) {
      H.treeZones.push(back);
      for (var gb = -41; gb > -90; gb -= 10 + rnd() * 4) for (var xb = -70; xb <= 70; xb += 10 + rnd() * 6) tree(spot(gb - rnd() * 4, xb));
    }
    (def.extraTrees || []).forEach(function (t) { tree(spot(t.g, t.x), true); });

    if (!par3) [100, 150, 200].forEach(function (d) { if (d < H.yds - 30) { var q = spot(d, 0); H.markers.push({ d: d, x: q.x, z: q.z }); } });
    H.clouds = [0, 1, 2, 3].map(function () { return { x: rnd(), y: 0.2 + rnd() * 0.55, w: 0.12 + rnd() * 0.12 }; });
    H.hills = [0, 1, 2].map(function () { return rnd() * 6.28; });
    return H;
  }

  // Where a point is along the hole: s yds from the back tee along the line of play, g
  // yds back from the middle of the green, and lat yds right (+) or left (−) of the line.
  function toHole(H, x, z) {
    var best = null, p = H.path;
    for (var i = 0; i < p.length - 1; i++) {
      var a = p[i], b = p[i + 1], dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
      var u = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      var qx = a.x + dx * u, qz = a.z + dz * u, d = Math.hypot(x - qx, z - qz);
      if (!best || d < best.d) best = { d: d, s: a.s + STEP * u, lat: ((x - a.x) * dz - (z - a.z) * dx) / Math.sqrt(len2) };
    }
    return { s: best.s, g: H.L - best.s, lat: best.lat };
  }

  // What the ball is lying on: 'green', 'fringe', 'fairway', 'rough', 'bunker', 'trees',
  // 'water', 'penalty' (a penalty area that isn't open water) or 'ob'. Tee boxes play as
  // fairway and grassy hollows as rough.
  function lieAt(H, x, z) {
    var i;
    if (inBlob(H.green, x, z, 0)) return 'green';
    for (i = 0; i < H.bunkers.length; i++) if (inBlob(H.bunkers[i], x, z, 0)) return 'bunker';
    for (i = 0; i < H.water.length; i++) if (inPoly(H.water[i].poly, x, z)) return H.water[i].kind;
    for (i = 0; i < H.ob.length; i++) if (inPoly(H.ob[i].poly, x, z)) return 'ob';
    if (inBlob(H.green, x, z, FRINGE)) return 'fringe';
    for (i = 0; i < H.hollows.length; i++) if (inBlob(H.hollows[i], x, z, 0)) return 'rough';
    for (i = 0; i < H.tees.length; i++) if (inPoly(H.tees[i].poly, x, z)) return 'fairway';
    if (H.fairway && inPoly(H.fairway, x, z)) return 'fairway';
    for (i = 0; i < H.treeZones.length; i++) if (inPoly(H.treeZones[i], x, z)) return 'trees';
    return 'rough';
  }
  var LIE_WORDS = { tee: 'Tee', green: 'Green', fringe: 'Fringe', fairway: 'Fairway', rough: 'Rough', bunker: 'Bunker', trees: 'Trees', water: 'Water', penalty: 'Penalty area', ob: 'Out of bounds' };

  // Today's pin: somewhere in the middle half of the green, the same all round for one seed.
  function pinFor(H, seed) {
    var r = FL.rng(seedOf(seed + ':' + H.course + ':' + H.n)), g = H.green;
    return FL.offsetPoint(g.x, g.z, g.rot, (r() - 0.5) * g.rz, (r() - 0.5) * g.rx);
  }

  // ---------------------------------------------------------------------------
  // The shots each club can hit: his own
  // ---------------------------------------------------------------------------
  function isWedge(club) { return /^(PW|GW|AW|SW|LW|\d{2}°)$/.test(String(club)); }
  // A shot's total; without one, the carry plus the roll GolfFlight would estimate.
  function totalOf(s) {
    if (isNum(s.total_yds)) return s.total_yds;
    var k = C.clubKind(s.club);
    return s.carry_yds * (1 + (isWedge(s.club) ? 0.03 : k === 'iron' ? 0.06 : 0.09));
  }
  // His solid shots with a club, best first, ranked the way the replay's Best 10 is: the
  // yards short of his pure-strike carry plus the yards off line, ties to the faster ball
  // speed. Solid shots launched well under the club's window (usually thin) come last.
  function rankShots(entry, club, equip) {
    if (!entry || !entry.solid) return [];
    var win = C.launchWindow(club, equip), floor = win ? win[0] - 4 : -Infinity;
    var ref = C.strikeReference(entry, club, equip);
    var aim = ref ? ref.carry : C.median(entry.solid.map(function (s) { return s.carry_yds; }));
    if (!isNum(aim)) return [];
    var normal = [], low = [];
    entry.solid.forEach(function (s) {
      if (!isNum(s.carry_yds) || s.carry_yds <= 0) return;
      var d = Math.max(0, aim - s.carry_yds) + (isNum(s.offline_ft) ? Math.abs(s.offline_ft) / 3 : 0);
      (isNum(s.launch_deg) && s.launch_deg < floor ? low : normal).push({ s: s, d: d });
    });
    function order(a, b) { return a.d - b.d || (b.s.ball_speed_mph || 0) - (a.s.ball_speed_mph || 0); }
    return normal.sort(order).concat(low.sort(order)).map(function (x) { return x.s; });
  }
  function sdOf(xs) {
    if (xs.length < 2) return 0;
    var m = xs.reduce(function (t, v) { return t + v; }, 0) / xs.length;
    return Math.sqrt(xs.reduce(function (t, v) { return t + (v - m) * (v - m); }, 0) / (xs.length - 1));
  }
  // clubPools(sessions, equip) → { club: pool } for every club with a solid shot:
  //   ranked: solid shots, best first; mis: mis-hits; misRate: the share of his shots with
  //   the club that were mis-hits; full: how far a good swing goes (the middle total of
  //   the best third), carry: the same for carry; spread: { off, offSd, lenSd } in yds, for
  //   the landing zone on the map (outliers are left out, as in the averages).
  function clubPools(sessions, equip) {
    var entries = C.clubData(sessions), out = {};
    Object.keys(entries).forEach(function (club) {
      var e = entries[club], ranked = rankShots(e, club, equip);
      if (!ranked.length) return;
      var top = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 3)));
      var offs = ranked.filter(function (s) { return isNum(s.offline_ft); }).map(function (s) { return s.offline_ft / 3; });
      var tots = ranked.map(totalOf);
      out[club] = {
        club: club, ranked: ranked,
        mis: e.mis.filter(function (s) { return isNum(s.carry_yds) && s.carry_yds > 0; }),
        misRate: e.shots.length ? e.mis.length / e.shots.length : 0,
        full: C.median(top.map(totalOf)), carry: C.median(top.map(function (s) { return s.carry_yds; })),
        spread: { off: offs.length ? offs.reduce(function (t, v) { return t + v; }, 0) / offs.length : 0, offSd: sdOf(offs), lenSd: sdOf(tots) }
      };
    });
    return out;
  }
  function clubList(pools) {
    return Object.keys(pools).map(function (c) { return pools[c]; }).sort(function (a, b) { return a.full - b.full || C.clubRank(a.club) - C.clubRank(b.club); });
  }

  // ---------------------------------------------------------------------------
  // The swing meter
  // ---------------------------------------------------------------------------
  // The marker runs from 0 to 1 (full power) on the backswing, then back down past 0
  // (the line). Where it is on the third tap sets the timing: e = −pos / win, so early
  // (still above the line) is negative and late is positive; ±1 is the edge of the window.
  var METER = {
    normal: { back: 1.15, down: 1.45, win: 0.12, end: -0.22 },
    easy: { back: 1.5, down: 1.05, win: 0.17, end: -0.3 }
  };
  function timingOf(pos, easy) { var m = easy ? METER.easy : METER.normal; return -pos / m.win; }
  // Timing in words. Early pulls it left and late pushes it right.
  function timingWord(e) {
    var q = Math.abs(e);
    if (q < 0.12) return 'Perfect timing';
    if (q < 0.4) return 'Good timing';
    if (q <= 1) return e < 0 ? 'A little early' : 'A little late';
    return e < 0 ? 'Way early' : 'Way late';
  }
  // Which of his shots a swing hits. On the line (|e| near 0) it's one of his best; the
  // further off, the further down his list (|e|^0.7 of the way, so the timing most taps
  // get, about a third of the window off, hits one from the middle: his usual shot),
  // leaning to the shots that went left when early and right when late. Off the line there's a chance of a mis-hit that grows
  // with how often he mis-hits the club; outside the window it's a mis-hit (his worst
  // solid shots, for a club he's never mis-hit).
  var RANK_CURVE = 0.7;
  function pickShot(pool, e, rnd) {
    var q = Math.abs(e), n = pool.ranked.length, side = q < 0.12 ? 0 : e < 0 ? -1 : 1, band, grade;
    var mis = q > 1 || (pool.mis.length && rnd() < pool.misRate * q * q);
    if (mis && pool.mis.length) {
      var m = pool.mis[Math.floor(rnd() * pool.mis.length)];
      return { shot: m, grade: 'mishit', rank: null, of: n };
    }
    if (mis) {
      band = pool.ranked.slice(Math.max(0, n - Math.max(1, Math.round(n * 0.15))));
      grade = 'mishit';
    } else {
      var i = Math.round(Math.pow(q, RANK_CURVE) * (n - 1)), k = Math.max(1, Math.round(n * 0.08));
      band = pool.ranked.slice(clamp(i - k, 0, n - 1), clamp(i + k, 0, n - 1) + 1);
      grade = q < 0.12 ? 'perfect' : q < 0.4 ? 'good' : 'off';
    }
    if (side) {
      var same = band.filter(function (s) { return isNum(s.offline_ft) && s.offline_ft * side > 0; });
      if (same.length) band = same;
    }
    var shot = band[Math.floor(rnd() * band.length)];
    return { shot: shot, grade: grade, rank: pool.ranked.indexOf(shot) + 1, of: n };
  }

  // How a lie changes a shot hit from it: distance, spray (sideways), and, for a punch
  // out from under the trees, a much lower flight.
  var LIE = {
    tee: { dist: 1, spray: 1 }, fairway: { dist: 1, spray: 1 }, fringe: { dist: 1, spray: 1 }, green: { dist: 1, spray: 1 },
    rough: { dist: 0.9, spray: 1.15 }, bunker: { dist: 0.8, spray: 1.25 },
    trees: { dist: 0.6, spray: 0.8, low: 0.4, roll: 1.6 }
  };
  // A shot's numbers after the power (0–1 of a full swing) and the lie: everything scales
  // with the distance, so a smaller swing flies the same shape, shorter. Ball speed and
  // hang time scale with its square root, as a ball's flight does. A driver hit off the
  // ground instead of a tee goes a little shorter and sprays more (DECK).
  var DECK = { dist: 0.92, spray: 1.25 };
  // How the lie changes a shot with this club: LIE, and DECK for a driver off the turf.
  function lieFactor(club, lie) {
    var f = LIE[lie] || LIE.fairway;
    if (club !== 'Driver' || lie === 'tee') return f;
    return { dist: f.dist * DECK.dist, spray: f.spray * DECK.spray, low: f.low, roll: f.roll };
  }
  function adjustShot(shot, power, lie) {
    var p = clamp(isNum(power) ? power : 1, 0.05, 1), f = lieFactor(shot.club, lie), k = p * f.dist;
    var C0 = shot.carry_yds, out = {};
    Object.keys(shot).forEach(function (key) { out[key] = shot[key]; });
    function sc(key, m) { out[key] = isNum(shot[key]) ? shot[key] * m : null; }
    out.carry_yds = C0 * k;
    out.total_yds = isNum(shot.total_yds) ? out.carry_yds + (shot.total_yds - C0) * k * (f.roll || 1) : null;
    sc('apex_ft', k * (f.low || 1));
    sc('curve_ft', k * f.spray);
    sc('offline_ft', k * f.spray);
    sc('ball_speed_mph', Math.sqrt(k));
    sc('hang_time_s', Math.sqrt(k) * (f.low ? Math.sqrt(f.low) : 1));
    sc('launch_deg', f.low || 1);
    sc('landing_deg', f.low || 1);
    return out;
  }

  // ---------------------------------------------------------------------------
  // A shot on the hole
  // ---------------------------------------------------------------------------
  var CUP = 0.06;  // the hole's radius (yds): 2¼ in
  var ROLL_COST = { fairway: 1, green: 1, fringe: 1.2, rough: 2.6, trees: 4 };
  var LAND_ROLL = { rough: 0.5, trees: 0.35, bunker: 0 };
  var STOPS = { water: 1, penalty: 1, ob: 1 };
  function flightOpts(club, equip) {
    var win = C.launchWindow(club, equip);
    return { kind: C.clubKind(club), club: club, launch: win ? (win[0] + win[1]) / 2 : null };
  }
  // How far a ball that lands at `land` and would roll R yds along `dir` really rolls:
  // less after landing in the rough or the trees, slowing more in them as it goes; it
  // stops in a bunker and goes into water or out of bounds.
  function rollOut(H, land, dir, R) {
    var lie = lieAt(H, land.x, land.z);
    if (STOPS[lie] || R <= 0.05) return { d: 0, lie: lie };
    var budget = R * (LAND_ROLL[lie] != null ? LAND_ROLL[lie] : 1), d = 0, step = 0.5;
    while (budget > 1e-6) {
      var nd = d + step, l = lieAt(H, land.x + dir.x * nd, land.z + dir.z * nd);
      if (STOPS[l]) return { d: nd, lie: l };
      if (l === 'bunker') return { d: nd + Math.min(0.8, budget), lie: 'bunker' };
      var use = step * (ROLL_COST[l] || 1);
      if (use >= budget) { d += step * budget / use; break; }
      budget -= use;
      d = nd;
    }
    return { d: d, lie: lieAt(H, land.x + dir.x * d, land.z + dir.z * d) };
  }
  // The same flight with only a share (f) of its roll: it lands in the same spot.
  function shortRoll(shot, tr, f) {
    var s = {}, C0 = tr.carry, lx = tr.local ? tr.local.land.x : tr.land.x, ox = tr.local ? tr.local.rest.x : tr.rest.x;
    Object.keys(shot).forEach(function (k) { s[k] = shot[k]; });
    s.total_yds = C0 + tr.roll * f;
    s.offline_ft = 3 * (lx + (ox - lx) * f);
    return s;
  }
  // The first tree the flight runs into: its trunk, or most of its leaves, which start
  // about a third of the way up (so a low punch can run under them). The first few yds
  // don't count (more from under the trees, where the ball starts beneath the branches).
  var TRUNK = 0.5, LEAVES = 0.35;
  function treeHit(H, placed, from) {
    var skip = from.lie === 'trees' ? 14 : 5, sm = placed.samples, lt = placed.local.samples;
    for (var i = 1; i < sm.length; i++) {
      if (lt[i].z < skip) continue;
      var p = sm[i];
      for (var j = 0; j < H.trees.length; j++) {
        var t = H.trees[j], r = t.r * 0.85, dx = p.x - t.x, dz = p.z - t.z;
        if (p.y >= t.h || Math.abs(dx) > r || Math.abs(dz) > r) continue;
        var d = Math.hypot(dx, dz);
        if (d < TRUNK || (d < r && p.y > LEAVES * t.h)) return { i: i, t: sm[i].t, tree: t, p: p };
      }
    }
    return null;
  }
  // A flight that hits a tree: it flies to the tree, then drops to the ground below.
  function cutAtTree(placed, hit, drop) {
    var p0 = placed.at(hit.t), fall = clamp(Math.sqrt(2 * Math.max(0.2, p0.y) / FL.G_YDS), 0.3, 1.4), tEnd = hit.t + fall;
    var out = {};
    Object.keys(placed).forEach(function (k) { out[k] = placed[k]; });
    function fallAt(t) {
      var u = clamp((t - hit.t) / fall, 0, 1);
      return { x: p0.x + (drop.x - p0.x) * u, y: p0.y * (1 - u * u), z: p0.z + (drop.z - p0.z) * u, phase: 'flight' };
    }
    out.samples = placed.samples.filter(function (s) { return s.t < hit.t; });
    for (var k = 0; k <= 8; k++) { var tt = hit.t + fall * k / 8, q = fallAt(tt); q.t = tt; out.samples.push(q); }
    out.hang = tEnd;
    out.rollT = 0.3;
    out.duration = tEnd + 0.3;
    out.land = { x: drop.x, y: 0, z: drop.z };
    out.rest = out.land;
    out.carry = Math.hypot(drop.x - placed.origin.x, drop.z - placed.origin.z);
    out.total = out.carry;
    out.roll = 0;
    var base = placed.along;
    out.along = function (t) { return base(Math.min(t, hit.t)); };
    out.at = function (t) {
      if (t < hit.t) return placed.at(t);
      if (t < tEnd) return fallAt(t);
      return { x: drop.x, y: 0, z: drop.z, phase: 'rest' };
    };
    return out;
  }
  // Where to drop after going into water or a penalty area: back along the ball's path to
  // where it went in, then 2 yds further back (no nearer the hole).
  function dropPoint(H, track) {
    for (var i = track.length - 1; i >= 0; i--) {
      var p = track[i], l = lieAt(H, p.x, p.z);
      if (!STOPS[l]) {
        var prev = track[Math.max(0, i - 1)], d = Math.hypot(p.x - prev.x, p.z - prev.z) || 1;
        var q = i > 0 ? { x: p.x + (prev.x - p.x) * Math.min(1, 2 / d), z: p.z + (prev.z - p.z) * Math.min(1, 2 / d) } : p;
        if (STOPS[lieAt(H, q.x, q.z)]) q = p;
        return { x: q.x, z: q.z };
      }
    }
    return { x: track[0].x, z: track[0].z };
  }
  // The ball's path along the ground, every couple of yds: under its flight, then its roll.
  function groundTrack(tr) {
    var out = tr.samples.filter(function (s, i) { return i % 3 === 0; }).map(function (s) { return { x: s.x, z: s.z }; });
    out.push({ x: tr.land.x, z: tr.land.z });
    var rd = Math.hypot(tr.rest.x - tr.land.x, tr.rest.z - tr.land.z), steps = Math.ceil(rd / 2);
    for (var i = 1; i <= steps; i++) out.push({ x: tr.land.x + (tr.rest.x - tr.land.x) * i / steps, z: tr.land.z + (tr.rest.z - tr.land.z) * i / steps });
    return out;
  }
  // playShot(H, from, aim, shot, opts) → what happened when `shot` (the usual shot keys,
  // already adjusted for power and lie) is hit from `from` ({ x, z, lie }) at `aim` ({ x, z }).
  // opts: { pin: { x, z }, equip, rnd }.
  //   { traj: the flight on the hole for drawing, heading, land, rest, lie (where it
  //     finished), result: 'ok' | 'holed' | 'tree' | 'water' | 'penalty' | 'ob',
  //     penalty: penalty strokes, next: { x, z, lie } (where the next shot is from),
  //     carry, total (yds, as flown), tree: the tree it hit, track: [[x, z], …] (its path, for the map) }
  function playShot(H, from, aim, shot, opts) {
    opts = opts || {};
    var heading = headingTo(from, aim), fo = flightOpts(shot.club, opts.equip);
    var tr = FL.trajectory(shot, fo);
    if (!tr) return null;
    var placed = FL.place(tr, from.x, from.z, heading), result = 'ok', holed = false, treeOf = null;
    var hit = treeHit(H, placed, from);
    if (hit) {
      var back = Math.hypot(hit.p.x - from.x, hit.p.z - from.z) || 1, r = opts.rnd ? opts.rnd() : 0.5;
      var pull = Math.min(back, 1.2 + 1.8 * r);
      var drop = { x: hit.p.x + (from.x - hit.p.x) * pull / back, z: hit.p.z + (from.z - hit.p.z) * pull / back };
      placed = cutAtTree(placed, hit, drop);
      result = 'tree';
      treeOf = hit.tree;
    } else {
      var land = placed.land, rx = placed.rest.x - land.x, rz = placed.rest.z - land.z, rd = Math.hypot(rx, rz);
      var ro = rd > 0.05 && tr.roll > 0 ? rollOut(H, land, { x: rx / rd, z: rz / rd }, rd) : { d: rd, lie: lieAt(H, land.x, land.z) };
      if (tr.roll <= 0 && STOPS[lieAt(H, land.x, land.z)]) ro = { d: 0, lie: lieAt(H, land.x, land.z) };
      var f = rd > 0.05 ? clamp(ro.d / rd, 0, 1) : 1;
      // Into the hole: rolling over it slowly enough, or landing right in it.
      if (opts.pin) {
        var pin = opts.pin, ux = rd > 0.05 ? rx / rd : 0, uz = rd > 0.05 ? rz / rd : 0, rolled = rd * f;
        var along = clamp((pin.x - land.x) * ux + (pin.z - land.z) * uz, 0, rolled);
        var near = Math.hypot(land.x + ux * along - pin.x, land.z + uz * along - pin.z);
        if (Math.hypot(land.x - pin.x, land.z - pin.z) <= CUP || (near <= CUP && rolled - along <= 3)) {
          holed = true;
          f = rd > 0.05 ? along / rd : 0;
        }
      }
      if (f < 0.999) {
        tr = FL.trajectory(shortRoll(shot, placed, f), fo);
        placed = FL.place(tr, from.x, from.z, heading);
      }
      if (holed) result = 'holed';
    }
    var rest = placed.rest, lie = holed ? 'holed' : lieAt(H, rest.x, rest.z);
    var track = groundTrack(placed), out = {
      traj: placed, heading: heading, land: { x: placed.land.x, z: placed.land.z }, rest: { x: rest.x, z: rest.z },
      lie: lie, result: result, penalty: 0, carry: placed.carry, total: placed.carry + (placed.roll || 0), tree: treeOf,
      track: track.filter(function (p, i) { return i % 2 === 0 || i === track.length - 1; }).map(function (p) { return [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]; })
    };
    if (lie === 'water' || lie === 'penalty') {
      var dp = dropPoint(H, track);
      Object.assign(out, { result: lie, penalty: 1, next: { x: dp.x, z: dp.z, lie: lieAt(H, dp.x, dp.z) } });
    } else if (lie === 'ob') {
      Object.assign(out, { result: 'ob', penalty: 1, next: { x: from.x, z: from.z, lie: from.lie } });
    } else if (!holed) {
      out.next = { x: rest.x, z: rest.z, lie: lie };
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Putting
  // ---------------------------------------------------------------------------
  function gauss(rnd) { var u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // The putting meter's target: where to stop the marker for a putt this long (ft).
  var PUTT = { normal: { sweep: 1.6, win: 0.06 }, easy: { sweep: 2.2, win: 0.09 } };
  function puttTarget(ft) { return clamp(0.12 + ft / 75, 0.14, 0.9); }
  // A putt of `ft` feet with timing error e (0 on the target, ±1 at the edge of its
  // window; long is positive). A good putt dies a foot or so past the hole; the further
  // off, the further long or short, and every putt wanders off line a little, more on
  // longer ones. It drops when it reaches the hole close enough to the middle, and a
  // fast one needs to be closer. From the fringe it's a little less predictable.
  //   → { holed, along, side } in feet: how far it went along the line and where it
  //     finished across it.
  function putt(ft, e, rnd, lie) {
    var rough = lie === 'fringe' ? 1.3 : 1;
    var along = ft + 1.2 + e * (0.22 * ft + 1) + gauss(rnd) * (0.03 * ft + 0.1) * rough;
    var miss = gauss(rnd) * (0.022 * ft + 0.05) * rough, past = along - ft;
    var cap = past < 0 ? 0 : 0.2 * clamp(1 - past / 5, 0.25, 1);
    if (past >= 0 && Math.abs(miss) <= cap) return { holed: true, along: ft, side: 0 };
    along = Math.max(0.3, along);
    return { holed: false, along: along, side: miss * along / Math.max(ft, 0.5) };
  }
  var TAP_IN = 1.5; // ft: knocked in without the meter

  // ---------------------------------------------------------------------------
  // Clubs, aim and the score
  // ---------------------------------------------------------------------------
  // The club for a shot of `d` yds from this lie: the shortest whose good swing gets there,
  // or the longest when none does. Clubs he mis-hits more than a third of the time, or has
  // fewer than 3 solid shots with, are suggested only when there's nothing else; the
  // driver only on the tee; and from sand or the trees, no woods.
  var SURE = { misRate: 0.34, solid: 3 };
  function suggestClub(pools, d, lie) {
    var list = clubList(pools), keep = function (f) { var k = list.filter(f); if (k.length) list = k; };
    if (lie !== 'tee') keep(function (p) { return p.club !== 'Driver'; });
    if (lie === 'bunker' || lie === 'trees') keep(function (p) { return !/^(Driver|\d+w)$/.test(p.club); });
    if (!list.length) return null;
    var sure = list.filter(function (p) { return p.misRate <= SURE.misRate && p.ranked.length >= SURE.solid; });
    if (!sure.length) sure = list;
    for (var i = 0; i < sure.length; i++) if (sure[i].full * lieFactor(sure[i].club, lie).dist >= d - 3) return sure[i].club;
    return sure[sure.length - 1].club;
  }
  // Where to aim with a club that goes `reach` yds: the pin if it's in range, else the
  // farthest point on the line of play he can reach, stepping back off sand, water and
  // trees, so a tee shot on a dogleg aims at the corner.
  function aimFor(H, ball, pin, reach) {
    if (dist(ball, pin) <= reach + 5) return { x: pin.x, z: pin.z, pin: true };
    var b = toHole(H, ball.x, ball.z), best = null;
    for (var s = Math.max(b.s + 10, 0); s <= H.L; s += STEP) {
      var p = H.at(s);
      if (dist(ball, p) <= reach) best = s; else if (best != null) break;
    }
    if (best == null) return { x: pin.x, z: pin.z, pin: true };
    for (var k = 0; k <= 20; k++) {
      var q = H.at(best - k * 3), l = lieAt(H, q.x, q.z);
      if (l === 'fairway' || l === 'green' || l === 'fringe') return { x: q.x, z: q.z, pin: false };
    }
    var q0 = H.at(best);
    return { x: q0.x, z: q0.z, pin: false };
  }
  // The share of a full swing to send this club `d` yds from this lie.
  function powerFor(pool, d, lie) { return clamp(d / (pool.full * lieFactor(pool.club, lie).dist), 0.1, 1); }

  function scoreName(score, par) {
    if (score === 1) return 'Hole in one';
    var d = score - par;
    return { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' }[d] || (d < 0 ? d + '' : '+' + d);
  }
  function toParText(d) { return d === 0 ? 'Even' : d > 0 ? '+' + d : String(d); }
  var MAX_OVER = 2; // the most a hole can cost is double par (a casual rule)
  // newRound(course, opts) → a round ready to start. opts: { tee, holes: [n…], mode
  // ('meter' | 'live'), easy, seed }.
  function newRound(course, opts) {
    var holes = (opts.holes && opts.holes.length ? opts.holes : course.holes.map(function (h) { return h.n; }));
    var seed = isNum(opts.seed) ? opts.seed : Math.floor(Math.random() * 1e9);
    return {
      v: 1, course: course.id, tee: opts.tee, mode: opts.mode || 'meter', easy: !!opts.easy, seed: seed, started: opts.date || null, idx: 0,
      cards: holes.map(function (n) {
        var h = course.holes.filter(function (x) { return x.n === n; })[0];
        return { n: n, par: h.par, yds: h.yds[opts.tee], shots: [], strokes: 0, penalties: 0, done: false, score: null, picked: false };
      })
    };
  }
  function totals(round) {
    var played = round.cards.filter(function (c) { return c.done; });
    var strokes = played.reduce(function (t, c) { return t + c.score; }, 0), par = played.reduce(function (t, c) { return t + c.par; }, 0);
    return { played: played.length, holes: round.cards.length, strokes: strokes, par: par, toPar: strokes - par, allPar: round.cards.reduce(function (t, c) { return t + c.par; }, 0) };
  }

  return {
    buildHole: buildHole, toHole: toHole, lieAt: lieAt, pinFor: pinFor, LIE_WORDS: LIE_WORDS, FRINGE: FRINGE, inPoly: inPoly, inBlob: inBlob, edgeAt: edgeAt,
    rankShots: rankShots, clubPools: clubPools, clubList: clubList, totalOf: totalOf,
    METER: METER, timingOf: timingOf, timingWord: timingWord, pickShot: pickShot, LIE: LIE, adjustShot: adjustShot,
    DECK: DECK, lieFactor: lieFactor, playShot: playShot, rollOut: rollOut, TRUNK: TRUNK, LEAVES: LEAVES, CUP: CUP, flightOpts: flightOpts,
    PUTT: PUTT, puttTarget: puttTarget, putt: putt, TAP_IN: TAP_IN,
    suggestClub: suggestClub, SURE: SURE, aimFor: aimFor, powerFor: powerFor, headingTo: headingTo, dist: dist,
    scoreName: scoreName, toParText: toParText, MAX_OVER: MAX_OVER, newRound: newRound, totals: totals, seedOf: seedOf
  };
});
