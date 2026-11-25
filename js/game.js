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
// Hole coordinates are yards, the same as GolfFlight's: x is east, z north and y up, all
// from the middle of the course, so every hole sits on the same ground.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./flight.js'), require('./core.js'));
  else root.GolfGame = factory(root.GolfFlight, root.GolfCore);
})(typeof self !== 'undefined' ? self : this, function (FL, C) {
  'use strict';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function seedOf(str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function headingTo(a, b) { return Math.atan2(b.x - a.x, b.z - a.z); }

  // ---------------------------------------------------------------------------
  // A hole on the real ground: the course's map (js/course-maps.js, from OpenStreetMap)
  // ---------------------------------------------------------------------------
  var STEP = 2;          // yds between points on the line of play
  var BEHIND = 70;       // the line of play runs on this far behind its start...
  var BEYOND = 110;      // ...and past the middle of the green
  var FRINGE = 2.2;      // the fringe around the green (yds)
  var CELL = 20;         // trees are filed in squares this many yds across, to find the ones near a spot fast
  var STAKES = { ob: 25, lake: 35 }; // yds between stakes along the boundary: white for out of bounds, red by the lake
  var BOX = { w: 8, d: 6 };          // a tee box drawn where a set of tees has no mapped one (yds)
  var STAND_IN = { w: 26, d: 30 };   // a green the map hasn't got (the 9th) is one this size

  function inPoly(poly, x, z) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function bboxOf(poly) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    poly.forEach(function (p) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
    return b;
  }
  function inBox(b, x, z) { return x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]; }
  function centroidOf(poly) {
    var a = 0, cx = 0, cz = 0;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length], c = p[0] * q[1] - q[0] * p[1];
      a += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c;
    }
    return Math.abs(a) < 1e-9 ? { x: poly[0][0], z: poly[0][1] } : { x: cx / (3 * a), z: cz / (3 * a) };
  }
  // The same shape, every point moved `by` yds further from its middle.
  function grow(poly, c, by) {
    return poly.map(function (p) {
      var dx = p[0] - c.x, dz = p[1] - c.z, d = Math.hypot(dx, dz) || 1;
      return [p[0] + dx / d * by, p[1] + dz / d * by];
    });
  }
  function ellipsePoly(c, rx, rz, rot, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = 2 * Math.PI * i / n, q = FL.offsetPoint(c.x, c.z, rot, rz * Math.sin(a), rx * Math.cos(a));
      out.push([q.x, q.z]);
    }
    return out;
  }
  function isLakeEdge(m, i) { return m.lakeFrom > m.lakeTo ? i >= m.lakeFrom || i < m.lakeTo : i >= m.lakeFrom && i < m.lakeTo; }

  // The course's ground, shared by all its holes and built once: the boundary and the lake,
  // every green, fairway, tee box, bunker, practice area, wood and cart path, the trees
  // (filed by square), and the stakes along the boundary.
  var GROUNDS = {};
  function groundOf(course) {
    if (GROUNDS[course.id]) return GROUNDS[course.id];
    var m = course.map, rnd = FL.rng(seedOf(course.id));
    function item(poly) { return { poly: poly, bb: bboxOf(poly) }; }
    var G = {
      boundary: m.boundary, bb: bboxOf(m.boundary), lake: m.lake,
      greens: m.greens.map(item), bunkers: m.bunkers.map(item), tees: m.tees.map(item), ranges: m.ranges.map(item), woods: m.woods.map(item),
      fairways: m.fairways.map(function (p, i) { var o = item(p); o.axis = m.fairwayAxis[i]; return o; }),
      paths: m.paths, grid: {}, obStakes: [], lakeStakes: [],
      trees: m.trees.map(function (t) { return { x: t[0], z: t[1], h: t[2], r: t[3], tone: t[4] }; })
    };
    G.trees.forEach(function (t) {
      for (var cx = Math.floor((t.x - t.r) / CELL); cx <= Math.floor((t.x + t.r) / CELL); cx++) {
        for (var cz = Math.floor((t.z - t.r) / CELL); cz <= Math.floor((t.z + t.r) / CELL); cz++) (G.grid[cx + ',' + cz] = G.grid[cx + ',' + cz] || []).push(t);
      }
    });
    var nb = m.boundary.length;
    for (var i = 0; i < nb; i++) {
      var a = m.boundary[i], b = m.boundary[(i + 1) % nb], lake = isLakeEdge(m, i), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (var d = 0; d < len; d += lake ? STAKES.lake : STAKES.ob) (lake ? G.lakeStakes : G.obStakes).push([a[0] + (b[0] - a[0]) * d / len, a[1] + (b[1] - a[1]) * d / len]);
    }
    G.clouds = [0, 1, 2, 3].map(function () { return { x: rnd(), y: 0.2 + rnd() * 0.55, w: 0.12 + rnd() * 0.12 }; });
    G.hills = [0, 1, 2].map(function () { return rnd() * 6.28; });
    return (GROUNDS[course.id] = G);
  }
  function treesNear(G, x, z) { return G.grid[Math.floor(x / CELL) + ',' + Math.floor(z / CELL)] || []; }

  // buildHole(course, n, teeId) → hole n from that set of tees, on the course's ground:
  //   n, par, tee, yds (the scorecard's), note, L (the line of play's length to the middle of
  //   the green), path (a point every STEP yds along it, with its heading), at(s), spot(g, side),
  //   start (where the ball is teed up), teeBox, green { x, z, rot, rx, rz, poly, fringePoly },
  //   markers (100, 150 and 200 yds from the middle of the green), and ground (the course's).
  // The line of play is the mapped one, from its back tee to the middle of the green; each
  // set of tees stands on its tee box, or on the line at its scorecard yardage.
  function buildHole(course, n, teeId) {
    var def = null;
    (course.holes || []).forEach(function (h) { if (h.n === n) def = h; });
    var hm = def && course.map && course.map.holes[String(n)];
    if (!hm) return null;
    var tees = course.tees.filter(function (t) { return isNum(def.yds[t.id]); });
    if (!tees.length) return null;
    var tee = tees.filter(function (t) { return t.id === teeId; })[0] || tees[tees.length - 1];
    var G = groundOf(course);
    var line = hm.line.map(function (p) { return { x: p[0], z: p[1] }; }), segs = [], acc = 0;
    for (var i = 0; i < line.length - 1; i++) {
      var a = line[i], b = line[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
      segs.push({ a: a, b: b, s: acc, len: len });
      acc += len;
    }
    var L = acc;
    function onLine(s) {
      var k = 0;
      while (k < segs.length - 1 && s > segs[k].s + segs[k].len) k++;
      var sg = segs[k], u = (s - sg.s) / sg.len;
      return { x: sg.a.x + (sg.b.x - sg.a.x) * u, z: sg.a.z + (sg.b.z - sg.a.z) * u };
    }
    // A point every STEP yds, its heading taken over 16 yds so it turns smoothly at a corner.
    var path = [];
    for (var s = -BEHIND; s <= L + BEYOND; s += STEP) {
      var p = onLine(s), p0 = onLine(s - 8), p1 = onLine(s + 8);
      path.push({ s: s, x: p.x, z: p.z, h: headingTo(p0, p1) });
    }
    function at(s) {
      var i = clamp(Math.floor((s + BEHIND) / STEP), 0, path.length - 2), a = path[i], b = path[i + 1];
      var u = (s - a.s) / STEP;
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, h: a.h + (b.h - a.h) * u };
    }
    function spot(g, side) { var q = at(L - g); return FL.offsetPoint(q.x, q.z, q.h, 0, side || 0); }

    var H = { course: course.id, n: def.n, par: def.par, tee: tee.id, yds: def.yds[tee.id], note: def.note || '', L: L,
      path: path, at: at, spot: spot, ground: G, markers: [], clouds: G.clouds, hills: G.hills };
    // The green: the mapped one at the end of the line (or, for the 9th, one that stands in).
    var end = line[line.length - 1], rot = headingTo(line[line.length - 2], end);
    var gpoly = hm.green != null ? course.map.greens[hm.green] : ellipsePoly(end, STAND_IN.w / 2, STAND_IN.d / 2, rot, 40);
    var gc = centroidOf(gpoly), rx = 0, rz = 0;
    gpoly.forEach(function (q) {
      var dx = q[0] - gc.x, dz = q[1] - gc.z;
      rx = Math.max(rx, Math.abs(dx * Math.cos(rot) - dz * Math.sin(rot)));
      rz = Math.max(rz, Math.abs(dx * Math.sin(rot) + dz * Math.cos(rot)));
    });
    H.green = { x: gc.x, z: gc.z, rot: rot, rx: rx, rz: rz, poly: gpoly, bb: bboxOf(grow(gpoly, gc, FRINGE)), fringePoly: grow(gpoly, gc, FRINGE), index: hm.green, standIn: hm.green == null };
    // Where this set of tees stands: on its tee box, or on the line at its yardage.
    var tm = hm.tees && hm.tees[tee.id], at0;
    if (tm && tm.box != null) {
      at0 = { x: tm.at[0], z: tm.at[1] };
      H.teeBox = course.map.tees[tm.box];
    } else {
      at0 = at(L - (tm ? tm.g : H.yds));
      var hd0 = at(L - (tm ? tm.g : H.yds)).h;
      H.teeBox = [[-BOX.w / 2, -BOX.d / 2], [BOX.w / 2, -BOX.d / 2], [BOX.w / 2, BOX.d / 2], [-BOX.w / 2, BOX.d / 2]].map(function (c) {
        var q = FL.offsetPoint(at0.x, at0.z, hd0, c[1], c[0]);
        return [q.x, q.z];
      });
      H.teeBoxDrawn = true;
    }
    H.start = { x: at0.x, z: at0.z, h: toHole(H, at0.x, at0.z).h };
    if (def.par > 3) [100, 150, 200].forEach(function (d) { if (d < H.yds - 30) { var q = spot(d, 0); H.markers.push({ d: d, x: q.x, z: q.z }); } });
    return H;
  }

  // Where a point is along the hole: s yds from the start of the line of play, g yds back
  // from the middle of the green, lat yds right (+) or left (−) of the line, and h, the
  // line's heading there.
  function toHole(H, x, z) {
    var best = null, p = H.path;
    for (var i = 0; i < p.length - 1; i++) {
      var a = p[i], b = p[i + 1], dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
      var u = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      var qx = a.x + dx * u, qz = a.z + dz * u, d = Math.hypot(x - qx, z - qz);
      if (!best || d < best.d) best = { d: d, s: a.s + STEP * u, lat: ((x - a.x) * dz - (z - a.z) * dx) / Math.sqrt(len2), h: a.h };
    }
    return { s: best.s, g: H.L - best.s, lat: best.lat, h: best.h };
  }

  // What the ball is lying on: 'green' (this hole's), 'fringe', 'fairway' (any fairway, tee
  // box, practice ground, or another hole's green, which plays as fairway), 'rough',
  // 'bunker', 'trees' (under a tree), 'water' (Lake Merced) or 'ob' (beyond the boundary).
  function lieAt(H, x, z) {
    var G = H.ground, i, o, lists = [G.greens, G.tees, G.fairways, G.ranges];
    if (inBox(H.green.bb, x, z) && inPoly(H.green.poly, x, z)) return 'green';
    for (i = 0; i < G.bunkers.length; i++) { o = G.bunkers[i]; if (inBox(o.bb, x, z) && inPoly(o.poly, x, z)) return 'bunker'; }
    if (!inBox(G.bb, x, z) || !inPoly(G.boundary, x, z)) return inPoly(G.lake, x, z) ? 'water' : 'ob';
    if (inBox(H.green.bb, x, z) && inPoly(H.green.fringePoly, x, z)) return 'fringe';
    if (H.teeBox && inPoly(H.teeBox, x, z)) return 'fairway';
    for (var k = 0; k < lists.length; k++) for (i = 0; i < lists[k].length; i++) { o = lists[k][i]; if (inBox(o.bb, x, z) && inPoly(o.poly, x, z)) return 'fairway'; }
    var near = treesNear(G, x, z);
    for (i = 0; i < near.length; i++) if (Math.hypot(x - near[i].x, z - near[i].z) < near[i].r) return 'trees';
    return 'rough';
  }
  var LIE_WORDS = { tee: 'Tee', green: 'Green', fringe: 'Fringe', fairway: 'Fairway', rough: 'Rough', bunker: 'Bunker', trees: 'Trees', water: 'Water', penalty: 'Penalty area', ob: 'Out of bounds' };

  // Today's pin: somewhere in the middle part of the green (a spot that's still on the green
  // when pushed out to 1/0.6 of its distance from the middle), the same all round for one seed.
  function pinFor(H, seed) {
    var r = FL.rng(seedOf(seed + ':' + H.course + ':' + H.n)), g = H.green, b = bboxOf(g.poly);
    for (var k = 0; k < 400; k++) {
      var x = b[0] + r() * (b[2] - b[0]), z = b[1] + r() * (b[3] - b[1]);
      if (inPoly(g.poly, g.x + (x - g.x) / 0.6, g.z + (z - g.z) / 0.6)) return { x: x, z: z };
    }
    return { x: g.x, z: g.z };
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
      var p = sm[i], near = treesNear(H.ground, p.x, p.z);
      for (var j = 0; j < near.length; j++) {
        var t = near[j], r = t.r * 0.85, dx = p.x - t.x, dz = p.z - t.z;
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
  // Where to aim with a club that goes `reach` yds: the pin if it's in range and nothing's
  // in the way. Otherwise the spot that leaves the least of the hole to play, counting rough
  // as 25 yds more, sand as 45 and the trees as 60, and never in the water or out of bounds
  // (the pin stays in the running): tried from straight
  // down the hole (toward the line of play as far ahead as he can reach) to 40° either side,
  // (80° from the rough or the trees, so he can chip out sideways), and from his full reach
  // down to 35% of it (a short way out of trouble). A carry over water with little to spare
  // counts against a spot too, and so does each tree in the way while the ball is low. On a dogleg that aims at the corner; on the 18th,
  // round the narrow end of the inlet of Lake Merced rather than a long carry over it.
  var AIM_COST = { fairway: 0, green: 0, fringe: 0, rough: 25, bunker: 45, trees: 60 };
  var TREE_COST = 60;
  // How many trees stand in the way of a shot from a to b (up to 2), the same way a flight
  // hits one (treeHit): its trunk, or its leaves above the bottom third. The ball's height
  // is taken as a curve peaking at about 16% of the club's reach (25 yds, 75 ft, for a
  // 150-yd club; at most 30), and much lower for a punch from under the trees. The first
  // and last 8% don't count (he's under the tree he's playing from, or it's where the ball
  // comes down).
  function treesInWay(H, a, b, reach, low) {
    var len = dist(a, b), top = Math.min(30, 0.16 * reach) * (low ? LIE.trees.low : 1), n = Math.max(8, Math.ceil(len / 6)), hit = [];
    for (var k = 1; k < n; k++) {
      var u = k / n;
      if (u < 0.08 || u > 0.92) continue;
      var x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u, y = top * 4 * u * (1 - u), near = treesNear(H.ground, x, z);
      for (var i = 0; i < near.length; i++) {
        var t = near[i];
        var d = Math.hypot(x - t.x, z - t.z);
        if (y < t.h && hit.indexOf(t) < 0 && (d < TRUNK + 0.5 || (d < t.r * 0.85 + 1 && y > LEAVES * t.h))) hit.push(t);
      }
      if (hit.length >= 2) return 2;
    }
    return hit.length;
  }
  function aimFor(H, ball, pin, reach) {
    var low = ball.lie === 'trees', dPin = dist(ball, pin), best = null, cost = Infinity;
    // What a spot costs: the hole it leaves to play (along the line of play, or to the pin
    // once that's further), its lie, how far off straight down the hole it is, a carry over
    // water or out of bounds with little to spare (his good carry, about 93% of his reach,
    // less the carry it needs: 3 yds for every yard under 45), and the trees in the way.
    function costOf(q, l, da, dq) {
      var wet = 0;
      for (var k = 1; k < 12; k++) {
        var w = lieAt(H, ball.x + (q.x - ball.x) * k / 12, ball.z + (q.z - ball.z) * k / 12);
        if (w === 'water' || w === 'ob') wet = k / 12;
      }
      var left = Math.max(toHole(H, q.x, q.z).g, dist(q, pin));
      return left + AIM_COST[l] + Math.abs(da) * 0.15 + (wet ? Math.max(0, 45 - (0.93 * reach - wet * dq)) * 3 : 0) + TREE_COST * treesInWay(H, ball, q, reach, low);
    }
    if (dPin <= reach + 5) {
      cost = costOf(pin, 'green', 0, dPin);
      best = { x: pin.x, z: pin.z, pin: true };
      if (cost < 45) return best; // a clear shot at the pin
    }
    var b = toHole(H, ball.x, ball.z), ahead = null;
    for (var s = Math.max(b.s + 10, 0); s <= H.L; s += STEP) {
      var p = H.at(s);
      if (dist(ball, p) <= reach) ahead = p; else if (ahead) break;
    }
    var h0 = headingTo(ball, dPin <= reach + 5 ? pin : ahead || pin), fan = ball.lie === 'rough' || ball.lie === 'trees' ? 80 : 40;
    var dMax = Math.min(reach, dPin + 10);
    for (var da = -fan; da <= fan; da += 5) {
      for (var f = 1; f >= 0.35 - 1e-9; f -= 0.05) {
        var q = FL.offsetPoint(ball.x, ball.z, h0 + da * Math.PI / 180, dMax * f, 0), l = lieAt(H, q.x, q.z);
        if (!(l in AIM_COST)) continue;
        var c = costOf(q, l, da, dMax * f);
        if (c < cost) { cost = c; best = { x: q.x, z: q.z, pin: false }; }
      }
    }
    return best || { x: pin.x, z: pin.z, pin: true };
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
    buildHole: buildHole, groundOf: groundOf, treesNear: treesNear, toHole: toHole, lieAt: lieAt, pinFor: pinFor, LIE_WORDS: LIE_WORDS, FRINGE: FRINGE, inPoly: inPoly, centroidOf: centroidOf,
    rankShots: rankShots, clubPools: clubPools, clubList: clubList, totalOf: totalOf,
    METER: METER, timingOf: timingOf, timingWord: timingWord, pickShot: pickShot, LIE: LIE, adjustShot: adjustShot,
    DECK: DECK, lieFactor: lieFactor, playShot: playShot, rollOut: rollOut, TRUNK: TRUNK, LEAVES: LEAVES, CUP: CUP, flightOpts: flightOpts,
    PUTT: PUTT, puttTarget: puttTarget, putt: putt, TAP_IN: TAP_IN,
    suggestClub: suggestClub, SURE: SURE, aimFor: aimFor, powerFor: powerFor, headingTo: headingTo, dist: dist,
    scoreName: scoreName, toParText: toParText, MAX_OVER: MAX_OVER, newRound: newRound, totals: totals, seedOf: seedOf
  };
});
