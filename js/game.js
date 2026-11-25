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
    G.elev = elevOf(course.elev);
    G.clouds = [0, 1, 2, 3].map(function () { return { x: rnd(), y: 0.2 + rnd() * 0.55, w: 0.12 + rnd() * 0.12 }; });
    G.hills = [0, 1, 2].map(function () { return rnd() * 6.28; });
    return (GROUNDS[course.id] = G);
  }
  function treesNear(G, x, z) { return G.grid[Math.floor(x / CELL) + ',' + Math.floor(z / CELL)] || []; }

  // ---------------------------------------------------------------------------
  // The height of the ground (js/course-elev.js, from the USGS 3D Elevation Program)
  // ---------------------------------------------------------------------------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // A course's heights, unpacked once: feet above sea level every `step` yds (see the
  // file for how a row is packed).
  function elevOf(E) {
    if (!E || !E.rows) return null;
    var h = new Float32Array(E.nx * E.nz);
    function two(r, k) { return B64.indexOf(r.charAt(k)) * 64 + B64.indexOf(r.charAt(k + 1)); }
    E.rows.forEach(function (r, j) {
      var q = two(r, 0), k = 2;
      h[j * E.nx] = E.base + q * E.q;
      for (var i = 1; i < E.nx; i++) {
        var c = B64.indexOf(r.charAt(k));
        if (c === 63) { q = two(r, k + 1); k += 3; } else { q += c - 31; k += 1; }
        h[j * E.nx + i] = E.base + q * E.q;
      }
    });
    return { x0: E.x0, z0: E.z0, step: E.step, nx: E.nx, nz: E.nz, h: h, lake: E.lake };
  }
  // The ground's height at a point, in feet above sea level (between the grid's heights;
  // level beyond its edge). 0 on a course without heights.
  function heightAt(G, x, z) {
    var e = G && G.elev;
    if (!e) return 0;
    var fx = clamp((x - e.x0) / e.step, 0, e.nx - 1.001), fz = clamp((z - e.z0) / e.step, 0, e.nz - 1.001);
    var i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * e.nx + i, h = e.h;
    return h[k] * (1 - u) * (1 - v) + h[k + 1] * u * (1 - v) + h[k + e.nx] * (1 - u) * v + h[k + e.nx + 1] * u * v;
  }
  // How the ground slopes at a point, facing `heading`: along (the rise in yds for each yd
  // ahead: + is uphill) and side (the rise for each yd to the right), each over 3 yds
  // either way.
  function slopeAt(G, x, z, heading) {
    if (!G || !G.elev) return { along: 0, side: 0 };
    var d = 3, f = FL.fwd(heading), rx = f.z, rz = -f.x;
    var ah = heightAt(G, x + f.x * d, z + f.z * d) - heightAt(G, x - f.x * d, z - f.z * d);
    var sh = heightAt(G, x + rx * d, z + rz * d) - heightAt(G, x - rx * d, z - rz * d);
    return { along: ah / 3 / (2 * d), side: sh / 3 / (2 * d) };
  }
  // How far a shot plays: d yds to a spot dh yds higher (+) or lower. The ball comes down
  // at its landing angle, so rising ground meets it sooner: it plays dh / tan(landing)
  // longer (about a yard for every 3 ft with an iron, more with a driver's flatter fall).
  function playsLike(d, dh, landing) { return d + clamp(dh / Math.tan(clamp(landing || 45, 20, 70) * Math.PI / 180), -0.4 * d, 0.4 * d); }
  // A club's usual landing angle, without one in his shots.
  function landingOf(club) { var k = C.clubKind(club); return isWedge(club) ? 50 : k === 'driver' ? 38 : k === 'wood' ? 42 : k === 'hybrid' ? 44 : 46; }

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
  //   ranked: solid shots, best first; pure: his pure-strike carry; mis: mis-hits; misRate: the share of his shots with
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
      var tots = ranked.map(totalOf), ref = C.strikeReference(e, club, equip);
      out[club] = {
        club: club, ranked: ranked, pure: ref ? ref.carry : C.median(ranked.map(function (s) { return s.carry_yds; })),
        pureSpeed: ref && ref.metrics.ball_speed_mph ? ref.metrics.ball_speed_mph.avg : null,
        curve: (function () { var v = ranked.map(function (s) { return s.curve_ft; }).filter(isNum); return v.length ? v.reduce(function (t, x) { return t + x; }, 0) / v.length / 3 : null; })(),
        mis: e.mis.filter(function (s) { return isNum(s.carry_yds) && s.carry_yds > 0; }),
        misRate: e.shots.length ? e.mis.length / e.shots.length : 0,
        full: C.median(top.map(totalOf)), carry: C.median(top.map(function (s) { return s.carry_yds; })),
        landing: C.median(top.map(function (s) { return s.landing_deg; }).filter(isNum)) || landingOf(club),
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
  //   back: s for the bar to fill; down: its speed coming back (a share of the bar a
  //   second, slower after a shorter backswing). However short the shot, the bar takes at
  //   least `lead` s to reach the power it wants (the white line) and the marker at least
  //   `ret` s to come back to the line, so a chip is as calm to time as a drive.
  var METER = {
    normal: { back: 1.4, down: 1.2, lead: 0.5, ret: 0.4, win: 0.12, end: -0.22 },
    easy: { back: 1.75, down: 0.95, lead: 0.6, ret: 0.5, win: 0.17, end: -0.3 }
  };
  function timingOf(pos, easy) { var m = easy ? METER.easy : METER.normal; return -pos / m.win; }
  // How long the bar takes to fill for a shot that wants `target` power.
  function meterBackTime(target, easy) { var m = easy ? METER.easy : METER.normal; return Math.max(m.back, m.lead / Math.max(0.05, isNum(target) ? target : 1)); }
  // How fast the marker comes back from `power` (shares of the bar a second).
  function meterDownSpeed(power, easy) { var m = easy ? METER.easy : METER.normal, p = Math.max(0.03, power); return Math.min(m.down * (0.45 + 0.55 * p), p / m.ret); }
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
    var p = clamp(isNum(power) ? power : 1, 0.01, 1), f = lieFactor(shot.club, lie), k = p * f.dist;
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
  // The real swing: drag back, swipe through
  // ---------------------------------------------------------------------------
  // A swipe on the swing pad is read the way a launch monitor reads a real swing. How
  // far down he drags is the backswing, and so the power. The time back over the time
  // down is his tempo: 3 : 1 for a full swing, 2 : 1 for a short one and a putt (Tour
  // Tempo's ratios). The direction he swipes up through the ball is the club's path,
  // and where he comes back through it is the strike: the middle, or off the toe or heel.
  //
  // The ball then flies by the ball-flight laws: it starts mostly where the face points
  // (about 75% for a 7 iron, 85% for a driver; the path sets the rest) and curves away
  // from the path, by the face-to-path angle: a lot with a driver, a little with a wedge.
  // The timing sets the face. A downswing that's quick for its backswing gets to the
  // ball early, with the face closed (left, for a right-hander); a slow one gets there
  // late, with it open (right). The path goes half as far the same way: over the top
  // when quick, stuck behind when slow. So bad timing pulls or pushes it, with a little
  // hook or fade, and the swipe's direction curves it.
  //
  // His own swing is where it starts from: each club's face and path as worked out from
  // his range shots (their start lines and curves), with his own scatter around them,
  // and the distance and height of one of his real shots with it, picked by how well
  // this swing was struck. A badly struck one is one of his real mis-hits: thin when
  // he rushed it, fat when it was slow.
  var RAD = Math.PI / 180;
  function gauss(rnd) { var u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // For each club: how much of the start direction the face sets (the path sets the
  // rest), and how far the ball curves for each degree of face to path, as a share of
  // its carry (TrackMan: about 4% for a driver, 2% for a 7 iron, 1% for a sand wedge).
  var LAW = {
    Driver: [0.85, 0.040], '2w': [0.85, 0.036], '3w': [0.84, 0.034], '4w': [0.84, 0.033], '5w': [0.83, 0.031], '7w': [0.82, 0.029], '9w': [0.81, 0.027],
    '2hy': [0.81, 0.029], '3hy': [0.8, 0.028], '4hy': [0.8, 0.027], '5hy': [0.8, 0.026], '6hy': [0.79, 0.025], '7hy': [0.78, 0.024],
    '2i': [0.79, 0.026], '3i': [0.78, 0.025], '4i': [0.77, 0.024], '5i': [0.77, 0.023], '6i': [0.76, 0.022], '7i': [0.75, 0.020], '8i': [0.74, 0.018], '9i': [0.72, 0.016],
    PW: [0.7, 0.014], GW: [0.69, 0.012], AW: [0.69, 0.012], SW: [0.68, 0.011], LW: [0.66, 0.010]
  };
  function clubLaw(club) {
    var l = LAW[club] || (isWedge(club) ? LAW.SW : C.clubKind(club) === 'wood' ? LAW['5w'] : C.clubKind(club) === 'hybrid' ? LAW['4hy'] : LAW['7i']);
    return { face: l[0], curve: l[1] };
  }
  // A shot's start line and curve as the club's face and path at impact, in degrees
  // right (+) or left (−) of the target line: start, f2p (face to path: + curves right),
  // face and path. It uses the same flight the replay draws, where the roll carries on
  // along the line it landed on, so the shot rebuilt from these finishes where it did.
  function facePathOf(s) {
    if (!s || !isNum(s.carry_yds) || s.carry_yds <= 1 || !isNum(s.offline_ft)) return null;
    var law = clubLaw(s.club), Cy = s.carry_yds, R = totalOf(s) - Cy, cY = isNum(s.curve_ft) ? s.curve_ft / 3 : 0;
    var st = (s.offline_ft / 3 - cY * (1 + 1.2 * R / Cy)) / Math.max(0.5 * Cy, Cy + 0.6 * R);
    var S = Math.atan(st) / RAD, D = cY / (law.curve * Cy);
    return { start: S, f2p: D, face: S + (1 - law.face) * D, path: S - law.face * D };
  }
  // His swing with a club (worked out once): its usual face and path (right +), the
  // scatter of his start lines and curves (sdStart, sdF2p, in degrees, and how much they
  // go together, rho), from his solid shots. A club with only a few shots leans toward
  // straight and an ordinary golfer's scatter (PRIOR, worth 3 shots), so one odd shot
  // doesn't make the club.
  var PRIOR = { n: 3, start: 2.5, f2p: 2 };
  function swingProfile(pool) {
    if (pool.profile) return pool.profile;
    var law = clubLaw(pool.club), rows = pool.ranked.map(facePathOf).filter(Boolean), n = rows.length, n0 = PRIOR.n;
    var mS = rows.reduce(function (t, r) { return t + r.start; }, 0) / (n + n0), mD = rows.reduce(function (t, r) { return t + r.f2p; }, 0) / (n + n0);
    var vS = n0 * PRIOR.start * PRIOR.start, vD = n0 * PRIOR.f2p * PRIOR.f2p, cv = 0;
    rows.forEach(function (r) { vS += (r.start - mS) * (r.start - mS); vD += (r.f2p - mD) * (r.f2p - mD); cv += (r.start - mS) * (r.f2p - mD); });
    var rho = clamp(cv / Math.sqrt(vS * vD) || 0, -0.8, 0.8), dof = Math.max(1, n - 1 + n0);
    pool.profile = { n: n, law: law, start: mS, f2p: mD, face: mS + (1 - law.face) * mD, path: mS - law.face * mD,
      sdStart: Math.sqrt(vS / dof), sdF2p: Math.sqrt(vD / dof), rho: rho };
    return pool.profile;
  }

  // Reading a swipe. A full backswing drags `full` pixels down from the ball; anything
  // less than 6% of that isn't a swing. The top is where it turned: a stop of 0.12 s or
  // more there is a pause, counted in neither the backswing nor the downswing (a shorter
  // one is shared between them). The path
  // is the line it came up on, from part way down (45% of the backswing, or 46 px)
  // to a little past the ball.
  var SWIPE = { still: 3, minDepth: 0.06, pause: 0.12, fitFrom: 0.45, fitMax: 46, fitAbove: 32, minDown: 0.03, maxDepth: 1.35, flick: 12 };
  // Tour Tempo: 3 : 1 for a full swing, 2 : 1 for a short one (and a putt).
  function tempoTarget(depth, putt) { return putt ? 2 : depth >= 0.75 ? 3 : depth <= 0.4 ? 2 : 2 + (depth - 0.4) / 0.35; }
  // The power of a backswing: its share of a full one, and past full a little more
  // (a quarter of the extra, at most 6%), at the cost of control.
  function powerOfDepth(depth) { return depth <= 1 ? Math.max(0, depth) : Math.min(1.06, 1 + 0.25 * (depth - 1)); }
  // When the finger got to the top and when it left it. It slows into the top and speeds
  // away from it, so (as for the takeaway) the square root of the distance from the top
  // runs straight in time near it: going forward along the last of the backswing finds
  // when it arrived, and back along the first of the downswing when it left.
  function topTimes(sm, iStart, iMax, iCross, still) {
    var yMax = sm[iMax].y, i, a1 = -1, a2 = -1, l1 = -1, l2 = -1;
    for (i = iMax - 1; i >= iStart; i--) { var r = yMax - sm[i].y; if (a1 < 0 && r > still) a1 = i; if (a1 >= 0 && r > 4 * still) { a2 = i; break; } }
    for (i = iMax + 1; i <= iCross; i++) { var d = yMax - sm[i].y; if (l1 < 0 && d > still) l1 = i; if (l1 >= 0 && d > 4 * still) { l2 = i; break; } }
    var iTop = iMax; // the last moment it was still at the top (a finger resting there)
    while (iTop + 1 < iCross && yMax - sm[iTop + 1].y <= 0.5) iTop++;
    var arrive = sm[iMax].t, leave = sm[iTop].t;
    if (a1 >= 0 && a2 >= 0 && a2 < a1) {
      var r1 = Math.sqrt(yMax - sm[a1].y), r2 = Math.sqrt(yMax - sm[a2].y);
      if (r2 > r1) arrive = clamp(sm[a1].t + (sm[a1].t - sm[a2].t) * r1 / (r2 - r1), sm[a1].t, sm[iMax].t);
    }
    if (l1 >= 0 && l2 >= 0 && l2 > l1) {
      var d1 = Math.sqrt(yMax - sm[l1].y), d2 = Math.sqrt(yMax - sm[l2].y);
      if (d2 > d1) leave = clamp(sm[l1].t - (sm[l2].t - sm[l1].t) * d1 / (d2 - d1), sm[iTop].t, sm[l1].t);
    } else if (l1 >= 0) leave = clamp((sm[iTop].t + sm[l1].t) / 2, sm[iTop].t, sm[l1].t);
    if (leave < arrive) arrive = leave = (arrive + leave) / 2;
    return { arrive: arrive, leave: leave, iTop: iTop };
  }
  // When the takeaway began. A finger speeds up from rest, so by the time it's 3 px from
  // the ball it has been moving a while: going back along the square root of its
  // distance, which runs straight in time while it speeds up evenly, finds the start.
  // th: the distance (px) to start from, smaller for a short stroke, where the speeding
  // up is over sooner.
  function startTime(sm, x0, y0, th) {
    var dist0 = function (p) { return Math.hypot(p.x - x0, p.y - y0); }, i1 = 1;
    while (i1 < sm.length - 1 && dist0(sm[i1]) <= th) i1++;
    var i2 = i1;
    while (i2 < sm.length - 1 && dist0(sm[i2]) < 4 * th) i2++;
    var d1 = dist0(sm[i1]), d2 = dist0(sm[i2]), t1 = sm[i1].t;
    if (i2 === i1 || d2 <= d1) return sm[i1 - 1].t;
    var ts = t1 - (sm[i2].t - t1) * Math.sqrt(d1) / (Math.sqrt(d2) - Math.sqrt(d1));
    return clamp(ts, Math.max(sm[0].t, t1 - 0.25), t1);
  }
  // The direction of a run of points, in degrees right of straight up (the pad's y is down).
  function lineAngle(pts) {
    var n = pts.length, mx = 0, my = 0, sxy = 0, syy = 0;
    pts.forEach(function (p) { mx += p.x / n; my += p.y / n; });
    pts.forEach(function (p) { sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) * (p.y - my); });
    if (syy < 1) { var a = pts[0], b = pts[n - 1]; return Math.atan2(b.x - a.x, a.y - b.y) / RAD; }
    return -Math.atan(sxy / syy) / RAD;
  }
  // readSwing(samples, opts) → what a swipe on the pad did. samples: [{ t (s), x, y }] in
  // the pad's pixels (y down), from the touch on the ball to the follow-through. opts:
  // { full: pixels for a full backswing, ball: the ball's width in pixels, putt }.
  //   Not a swing: { ok: false, why: 'still' (it never moved), 'noBack' (no backswing)
  //   or 'noThrough' (it never came back up through the ball), depth }.
  //   A swing: { ok: true, depth (1 = full), power, back, down, pause (s), ratio (back ÷
  //   down), target (3 or 2), tempo (ln of ratio ÷ target: + quick from the top, − slow),
  //   angle (° right of straight up the target line), strike (balls right (+) or left of
  //   where it started, as it came back through), top { x, y }, cross { x, y } }.
  function readSwing(samples, opts) {
    var sm = samples || [], n = sm.length, full = opts.full, i;
    if (n < 3) return { ok: false, why: 'still', depth: 0 };
    var x0 = sm[0].x, y0 = sm[0].y, iStart = -1;
    for (i = 1; i < n; i++) if (Math.hypot(sm[i].x - x0, sm[i].y - y0) > SWIPE.still) { iStart = i - 1; break; }
    if (iStart < 0) return { ok: false, why: 'still', depth: 0 };
    var iMax = iStart, iCross = -1;
    for (i = iStart + 1; i < n; i++) {
      if (sm[i].y > sm[iMax].y) iMax = i;
      else if (sm[i].y <= y0 && (sm[iMax].y - y0) / full >= SWIPE.minDepth) { iCross = i; break; }
    }
    var yMax = sm[iMax].y, depth = Math.min(SWIPE.maxDepth, (yMax - y0) / full);
    if (depth < SWIPE.minDepth) return { ok: false, why: 'noBack', depth: Math.max(0, depth) };
    // A quick flick can leave the glass just short of the ball: if it was on its way up
    // fast and had only a little further to go (12 px, 15% of the backswing, or a frame
    // or two at its speed: 30 ms), it's carried on to the ball at the speed it was going.
    if (iCross < 0 && n - 1 > iMax) {
      var last = sm[n - 1], prev = sm[n - 2], vy = (prev.y - last.y) / Math.max(1e-3, last.t - prev.t), left = last.y - y0;
      if (vy > 0 && left <= Math.max(SWIPE.flick, 0.15 * (yMax - y0), 0.03 * vy) && left / vy <= 0.06) {
        sm = sm.concat([{ t: last.t + left / vy, x: last.x + (last.x - prev.x) * (left / vy) / Math.max(1e-3, last.t - prev.t), y: y0 }]);
        n = sm.length;
        iCross = n - 1;
      }
    }
    if (iCross < 0) return { ok: false, why: 'noThrough', depth: depth };
    var th = clamp(0.04 * (yMax - y0), 1.5, SWIPE.still), t0 = startTime(sm, x0, y0, th);
    var tt = topTimes(sm, iStart, iMax, iCross, th), iLeave = tt.iTop, tReach, tLeave, pause = tt.leave - tt.arrive;
    if (pause >= SWIPE.pause) { tReach = tt.arrive; tLeave = tt.leave; } else { tReach = tLeave = (tt.arrive + tt.leave) / 2; pause = 0; }
    var a = sm[iCross - 1], b = sm[iCross], u = a.y === b.y ? 1 : (a.y - y0) / (a.y - b.y);
    var tCross = a.t + (b.t - a.t) * u, xCross = a.x + (b.x - a.x) * u;
    var back = Math.max(0.01, tReach - t0), down = Math.max(SWIPE.minDown, tCross - tLeave);
    var yFrom = y0 + Math.min(SWIPE.fitFrom * (yMax - y0), SWIPE.fitMax), pts = [];
    for (i = iLeave; i < n; i++) {
      if (sm[i].y < y0 - SWIPE.fitAbove) break;
      if (sm[i].y <= yFrom) pts.push(sm[i]);
    }
    var target = tempoTarget(depth, opts.putt), ratio = back / down;
    return {
      ok: true, depth: depth, power: powerOfDepth(depth), back: back, down: down, pause: pause, ratio: ratio, target: target,
      tempo: Math.log(ratio / target), angle: lineAngle(pts.length >= 2 ? pts : [a, b]), strike: (xCross - x0) / (opts.ball || 30),
      top: { x: sm[iMax].x, y: yMax }, cross: { x: xCross, y: y0 }
    };
  }

  // ---------------------------------------------------------------------------
  // The phone as the club: a motion swing
  // ---------------------------------------------------------------------------
  // He holds the phone like a grip, upright in both hands with the screen facing the
  // target like the clubface, and swings it. The gyroscope says how fast the phone turns
  // about each of its own axes, and adding that up says how it turned. The swing turns it
  // about an axis square to the swing plane, back and then down: how far back is the
  // backswing (a full one is about 240° from the ball, the club past vertical; a full
  // putting stroke about 30°), and coming back to where it started is impact. The tempo is
  // the time back over the time down, as on the pad. The phone's roll about its own long
  // axis (the shaft) turns the screen, and where the screen points at impact, against the
  // target line, is the clubface: rolled open on the way back and not rolled back, it's
  // open. With the screen facing the target, the swing's own axis says which way is up the
  // shaft, so which way is open, for either hand; gravity at address (when the phone gives
  // it) says which way is level. Where the bottom of the "shaft" was heading at impact is
  // the path: a downswing on a flatter plane than the backswing comes from the inside,
  // in-to-out; a steeper one from outside, out-to-in. Wii golf games read a swing much the
  // same way: the backswing sets the power and the controller's twist at impact hooks or
  // slices it.
  //   full / puttFull: ° of turn for a full swing / stroke. still, start: °/s below which
  //   it's at rest and above which a swing has started (a putt starts slower: startPutt).
  //   take: the share of a full turn that sets the swing's axis. face / path: how much of
  //   the phone's face and path angles the club gets, past faceDead / pathDead (how still a
  //   phone in two hands can be held, and what the sampling can trust); puttFace,
  //   puttDead the same for a putt. flip: ° the face would have to roll shut on the way
  //   back before it's taken that the screen faced away from the target. limit: °/s a
  //   phone's gyroscope tops out at.
  var MOTION = { steps: 8, fine: 32, limit: 1990, stillPutt: 8, full: 240, puttFull: 30, still: 25, start: 45, startPutt: 15, take: 0.12, face: 0.3, faceDead: 4, path: 0.3, pathDead: 3, maxFace: 10, maxPath: 8, puttFace: 0.25, puttDead: 2, flip: 25 };
  function qmul(a, b) {
    return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  }
  function qturn(w, dt) {  // the turn at w (rad/s) for dt s
    var m = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]), a = m * dt / 2;
    if (m < 1e-9) return [1, 0, 0, 0];
    var k = Math.sin(a) / m;
    return [Math.cos(a), w[0] * k, w[1] * k, w[2] * k];
  }
  function qrot(q, v) {  // v turned by q
    var t = qmul(qmul(q, [0, v[0], v[1], v[2]]), [q[0], -q[1], -q[2], -q[3]]);
    return [t[1], t[2], t[3]];
  }
  function qnorm(q) { var m = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1; return [q[0] / m, q[1] / m, q[2] / m, q[3] / m]; }
  function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vcross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function vunit(a) { var m = Math.sqrt(vdot(a, a)) || 1; return [a[0] / m, a[1] / m, a[2] / m]; }
  function vmix(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
  // readMotion(samples, opts) → a swing, as readSwing gives one, from the phone's
  // gyroscope. samples: [{ t (s), w: [x, y, z], g: [x, y, z] }]: w in °/s about the
  // phone's own axes (x across the screen, y up it, z out of it: the rotationRate's beta,
  // gamma and alpha), g the accelerationIncludingGravity (m/s², if it gives one; either
  // sign, as phones differ), from address (held still) to the follow-through. opts:
  // { putt, hand ('L' for a left-hander), full (° for a full backswing) }.
  //   Not a swing: { ok: false, why: 'still', 'noBack' or 'noThrough', depth, theta (° it's
  //   turned back now, for drawing it as it goes) }.
  //   A swing: readSwing's { ok, depth, power, back, down, pause, ratio, target, tempo,
  //   angle: 0, strike: 0 }, and motion: true, face (° the phone was turned open at
  //   impact, his hand's way: + open), path (° its swing at impact, + in-to-out), roll (°
  //   it rolled open on the way back), turn (° back), peak (°/s: its fastest turn), long
  //   ('y' when held upright, 'x' sideways), tImpact (s).
  function readMotion(samples, opts) {
    opts = opts || {};
    var sm = samples || [], n = sm.length, putt = !!opts.putt, h = opts.hand === 'L' ? -1 : 1;
    var full = opts.full || (putt ? MOTION.puttFull : MOTION.full), go = putt ? MOTION.startPutt : MOTION.start, i;
    var rate = function (k) { var w = sm[k].w; return Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]); };
    if (n < 4) return { ok: false, why: 'still', depth: 0, theta: 0 };
    // A gyroscope reads to about 2000°/s: a swing that pins it for three samples in a row
    // turned faster than the phone could follow, and can't be read.
    var pinned = 0;
    for (i = 0; i < n && pinned < 3; i++) pinned = Math.max(Math.abs(sm[i].w[0]), Math.abs(sm[i].w[1]), Math.abs(sm[i].w[2])) >= MOTION.limit ? pinned + 1 : 0;
    if (pinned >= 3) return { ok: false, why: 'tooFast', depth: 0, theta: 0 };
    var iGo = -1;
    for (i = 0; i < n; i++) if (rate(i) > go) { iGo = i; break; }
    if (iGo < 0) return { ok: false, why: 'still', depth: 0, theta: 0 };
    // From address (the last still moment before it moved): the attitude (q, address frame), the turn
    // rate in that frame (W, rad/s), and its roll about each of its own two long axes.
    var calm = putt ? MOTION.stillPutt : MOTION.still, ia = Math.max(0, iGo - 1);
    while (ia > 0 && rate(ia) > calm) ia--;
    var q = [1, 0, 0, 0], Q = [q], W = [], T = [sm[ia].t], rollX = [0], rollY = [0], aX = 0, aY = 0;
    var wr = function (k) { k = clamp(k, 0, n - 1); return [sm[k].w[0] * RAD, sm[k].w[1] * RAD, sm[k].w[2] * RAD]; };
    // The rate between samples k − 1 and k, u of the way: a smooth curve through the samples
    // either side (Catmull-Rom), as a swing's turn speeds up and slows down smoothly.
    var wAt = function (k, u) {
      var a = wr(k - 2), b = wr(k - 1), c = wr(k), d = wr(k + 1), u2 = u * u, u3 = u2 * u, out = [0, 0, 0];
      for (var j = 0; j < 3; j++) out[j] = 0.5 * (2 * b[j] + (c[j] - a[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * u2 + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * u3);
      return out;
    };
    W.push(wr(ia));
    // Between samples the rate follows that curve, in eight steps: a fast swing turns the
    // phone 25° from one sample to the next, rolling it as it goes, and turns about a
    // moving axis don't add up in one step.
    for (i = ia + 1; i < n; i++) {
      var dt = clamp(sm[i].t - sm[i - 1].t, 0, 0.1), w1 = wr(i), rx = 0, ry = 0;
      for (var st = 0; st < MOTION.steps; st++) {
        var ws = wAt(i, (st + 0.5) / MOTION.steps), ds = dt / MOTION.steps;
        q = qmul(q, qturn(ws, ds));
        rx += ws[0] * ds; ry += ws[1] * ds;
      }
      q = qnorm(q);
      Q.push(q); W.push(qrot(q, w1)); T.push(sm[i].t);
      rollX.push(rollX[rollX.length - 1] + rx); rollY.push(rollY[rollY.length - 1] + ry);
      aX += Math.abs(rx); aY += Math.abs(ry);
    }
    var m = Q.length;
    // The shaft is the phone's long axis as he holds it: the one it rolls about least.
    var lng = aY <= aX ? 1 : 0, sb = lng === 1 ? [0, 1, 0] : [1, 0, 0], roll = lng === 1 ? rollY : rollX;
    // Where the shaft points at each sample (the roll about it doesn't move it), in the
    // address frame; the swing's axis from the takeaway: the turn that carried the shaft
    // from where it was at address to where it was a little way back. Its swing alone (the
    // turn less the roll about the shaft) gives how fast it was swinging.
    var Sh = [], S = [], axis = null, s0b = qrot(Q[0], sb), far = 0;
    for (i = 0; i < m; i++) {
      var wb = wr(ia + i), along = vdot(wb, sb);
      Sh.push(qrot(Q[i], sb));
      S.push(qrot(Q[i], [wb[0] - along * sb[0], wb[1] - along * sb[1], wb[2] - along * sb[2]]));
      if (i && !axis) {
        far = Math.acos(clamp(vdot(s0b, Sh[i]), -1, 1)) / RAD;
        if (far >= MOTION.take * full) axis = vunit(vcross(s0b, Sh[i]));
      }
    }
    if (!axis) return { ok: false, why: far / full < SWIPE.minDepth ? 'noBack' : 'still', depth: far / full, theta: far };
    // The swing's angle: the shaft's turn about that axis from address, unwound past a half
    // turn (a full backswing goes two thirds of the way round).
    var e1 = vunit([s0b[0] - vdot(s0b, axis) * axis[0], s0b[1] - vdot(s0b, axis) * axis[1], s0b[2] - vdot(s0b, axis) * axis[2]]), e2 = vcross(axis, e1), th = [0];
    for (i = 1; i < m; i++) {
      var a2 = Math.atan2(vdot(Sh[i], e2), vdot(Sh[i], e1)) / RAD, prevA = th[i - 1];
      while (a2 - prevA > 180) a2 -= 360;
      while (a2 - prevA < -180) a2 += 360;
      th.push(a2);
    }
    var iMax = 0, iCross = -1;
    for (i = 1; i < m; i++) {
      if (th[i] > th[iMax]) iMax = i;
      else if (th[i] <= 0 && th[iMax] / full >= SWIPE.minDepth) { iCross = i; break; }
    }
    var tmax = th[iMax], depth = Math.min(SWIPE.maxDepth, tmax / full);
    if (depth < SWIPE.minDepth) return { ok: false, why: 'noBack', depth: Math.max(0, depth), theta: th[m - 1] };
    if (iCross < 0) return { ok: false, why: 'noThrough', depth: depth, theta: th[m - 1] };
    // When it started: the turn grows with the square of the time from rest, so its square
    // root runs straight in time; followed back from 2% and 7% of the way, to none.
    var at = function (frac) { for (var k = 1; k <= iMax; k++) if (th[k] >= frac * tmax) { var u = (frac * tmax - th[k - 1]) / Math.max(1e-9, th[k] - th[k - 1]); return T[k - 1] + (T[k] - T[k - 1]) * u; } return T[iMax]; };
    var t1 = at(0.02), t2 = at(0.07), t0 = clamp(t1 - (t2 - t1) * Math.sqrt(0.02) / (Math.sqrt(0.07) - Math.sqrt(0.02)), Math.max(T[0] - 0.05, t1 - 0.25), t1);
    // The top: when it got within a hair of its furthest, and when it left; a stop there of
    // 0.12 s or more is a pause and counts in neither half.
    var band = Math.max(0.5, 0.008 * tmax), iA = iMax, iL = iMax;
    while (iA > 0 && th[iA - 1] >= tmax - band) iA--;
    while (iL + 1 < iCross && th[iL + 1] >= tmax - band) iL++;
    // Without a pause, the turn: where its rate crosses nought, between the samples either side.
    var rateAt = function (k) { return vdot(S[k], axis); }, tTurn = T[iMax];
    for (var k2 = Math.max(0, iMax - 1); k2 <= iMax && k2 + 1 < m; k2++) {
      var r0 = rateAt(k2), r1 = rateAt(k2 + 1);
      if (r0 >= 0 && r1 < 0) { tTurn = T[k2] + (T[k2 + 1] - T[k2]) * r0 / (r0 - r1); break; }
    }
    var pause = T[iL] - T[iA], tReach, tLeave;
    if (pause >= SWIPE.pause) { tReach = T[iA]; tLeave = T[iL]; } else { tReach = tLeave = tTurn; pause = 0; }
    // Impact: the turn carried on from the sample before it in fine steps (the phone turns
    // 25° between samples there, rolling as it goes) to the moment the shaft is back where
    // it was at address; the attitude then.
    var u0 = 1, qI = Q[iCross], w0c = wr(ia + iCross - 1), w1c = wr(ia + iCross), dtc = T[iCross] - T[iCross - 1], qP = Q[iCross - 1], aP = th[iCross - 1];
    for (var kc = 1; kc <= MOTION.fine; kc++) {
      var qk = qnorm(qmul(qP, qturn(wAt(ia + iCross, (kc - 0.5) / MOTION.fine), dtc / MOTION.fine))), shk = qrot(qk, sb);
      var ak = Math.atan2(vdot(shk, e2), vdot(shk, e1)) / RAD;
      while (ak - aP > 180) ak -= 360;
      while (ak - aP < -180) ak += 360;
      if (ak <= 0) {
        var fc = aP / Math.max(1e-9, aP - ak);
        u0 = (kc - 1 + fc) / MOTION.fine;
        qI = qnorm([qP[0] + (qk[0] - qP[0]) * fc, qP[1] + (qk[1] - qP[1]) * fc, qP[2] + (qk[2] - qP[2]) * fc, qP[3] + (qk[3] - qP[3]) * fc]);
        break;
      }
      qP = qk; aP = ak;
    }
    var tImp = T[iCross - 1] + dtc * u0;
    var back = Math.max(0.01, tReach - t0), down = Math.max(SWIPE.minDown, tImp - tLeave), target = tempoTarget(depth, putt), ratio = back / down;
    // Which way is up the shaft: the target is out of the screen (ẑ), and the swing's axis
    // crossed with it points up the shaft, toward the hands. Open, rolling about it, is
    // clockwise looking down the shaft for a right-hander, and a golfer rolls it open on
    // the way back.
    var up = vunit(vcross([0, 0, 1], axis)), sg = vdot(up, sb) >= 0 ? 1 : -1;
    var openBack = -h * sg * roll[iMax] / RAD, tz = 1;
    // Rolled well shut on the way back, the screen must have faced him, not the target.
    if (openBack < -MOTION.flip) { sg = -sg; openBack = -openBack; up = [-up[0], -up[1], -up[2]]; tz = -1; }
    // Level: gravity at address, whichever sign the phone gives it (the shaft points more
    // up than down), square to the target line; without it, up the shaft will do.
    var tgt = [0, 0, tz], lvl = up, gs = [0, 0, 0], ng = 0;
    for (i = 0; i <= ia; i++) if (sm[i].g) { gs = [gs[0] + sm[i].g[0], gs[1] + sm[i].g[1], gs[2] + sm[i].g[2]]; ng++; }
    if (ng && vdot(gs, gs) > 1) {
      var gu = vunit(gs);
      if (vdot(gu, up) < 0) gu = [-gu[0], -gu[1], -gu[2]];
      var gl = [gu[0] - vdot(gu, tgt) * tgt[0], gu[1] - vdot(gu, tgt) * tgt[1], gu[2] - vdot(gu, tgt) * tgt[2]];
      if (vdot(gl, gl) > 0.25) lvl = vunit(gl);
    }
    var away = vcross(tgt, lvl);
    away = [h * away[0], h * away[1], h * away[2]];
    // The face: where the screen pointed at impact, level, against the target line.
    var F = qrot(qI, tgt), face = Math.atan2(vdot(F, away), Math.max(1e-6, vdot(F, tgt))) / RAD;
    // The path: where the club head (down the shaft from the hands) was going at impact.
    var wI = qrot(qI, wAt(ia + iCross, u0)), shaft = qrot(qI, [sg * sb[0], sg * sb[1], sg * sb[2]]), v = vcross(wI, [-shaft[0], -shaft[1], -shaft[2]]);
    var path = Math.atan2(vdot(v, away), Math.max(1e-6, vdot(v, tgt))) / RAD, peak = 0;
    for (i = iMax; i <= iCross; i++) peak = Math.max(peak, Math.sqrt(vdot(W[i], W[i])) / RAD);
    return {
      ok: true, motion: true, depth: depth, power: powerOfDepth(depth), back: back, down: down, pause: pause, ratio: ratio, target: target,
      tempo: Math.log(ratio / target), angle: 0, strike: 0, face: face, path: path, roll: openBack, turn: tmax, peak: peak,
      long: lng === 1 ? 'y' : 'x', tImpact: tImp, theta: th[m - 1]
    };
  }
  // How far back a backswing of `depth` is, in words he can feel with the phone in his
  // hands (the turn from the ball: a quarter of the way round is the club level).
  function motionCue(depth, putt) {
    if (putt) return depth < 0.35 ? 'a short stroke' : depth < 0.7 ? 'a medium stroke' : 'a long stroke';
    return depth < 0.3 ? 'a small swing, hands to the knee' : depth < 0.45 ? 'hands to the hip, the phone level' : depth < 0.65 ? 'hands to the chest'
      : depth < 0.88 ? 'hands to the shoulder, the phone pointing up' : 'a full backswing';
  }

  // How much each part of a swing counts. face/path: degrees the face and path move
  // for a tempo error of 1 (the ratio e times its target: about 2.7 times, so 4 : 1
  // instead of 3 : 1 is 0.29, shutting the face 3.2°). swipe: degrees of path for each
  // degree the swipe leans, past `dead` (a phone's slack). rest: the share of his own
  // scatter left with a perfect swing. Strike: tempoWin is the tempo error, strikeWin
  // the balls off the middle (past strikeMid), overWin the backswing past full, and
  // snatch the backswing time, that each spoil the strike on their own.
  var SWING = {
    normal: { face: 11, path: 5.5, swipe: 0.35, dead: 3, rest: 0.5, tempoWin: 0.4, strikeMid: 0.35, strikeWin: 1.5, overWin: 0.16, snatch: 0.26 },
    easy: { face: 7, path: 3.5, swipe: 0.22, dead: 5, rest: 0.45, tempoWin: 0.55, strikeMid: 0.5, strikeWin: 2.2, overWin: 0.24, snatch: 0.2 }
  };
  // Off the middle of the face: the face twists open off the toe and shut off the heel
  // (TWIST degrees a ball off), and a wood's gear effect curves it the other way: a
  // draw off the toe, a fade off the heel (GEAR degrees of face to path a ball off).
  var TWIST = 1.2, GEAR = { driver: 1.8, wood: 1.6, hybrid: 1, iron: 0.3 };
  function deadband(v, d) { return v > d ? v - d : v < -d ? v + d : 0; }
  // How well a swing was struck: q is 0 out of the middle with a perfect tempo and 1 at
  // the edge of a solid strike, adding up what spoiled it (parts).
  function strikeOf(sw, cfg) {
    var parts = {
      tempo: Math.abs(sw.tempo) / cfg.tempoWin,
      contact: Math.max(0, Math.abs(sw.strike) - cfg.strikeMid) / cfg.strikeWin,
      over: Math.max(0, sw.depth - 1.02) / cfg.overWin,
      snatch: sw.back < cfg.snatch ? (cfg.snatch - sw.back) / (cfg.snatch / 2) : 0
    };
    return { q: Math.sqrt(parts.tempo * parts.tempo + parts.contact * parts.contact + parts.over * parts.over + parts.snatch * parts.snatch), parts: parts };
  }
  // What spoiled a strike most ('tempo', 'contact', 'over' or 'snatch'), and which way a
  // bad strike goes wrong: thin when he rushed it or snatched it, fat when it was slow, a
  // shank off the heel, weak off the toe, and either from an overswing.
  function misCause(st) { var p = st.parts; return Object.keys(p).sort(function (a, b) { return p[b] - p[a]; })[0]; }
  function misKind(sw, st, h, rnd) {
    var big = misCause(st);
    if (big === 'tempo') return sw.tempo > 0 ? 'thin' : 'fat';
    if (big === 'snatch') return 'thin';
    if (big === 'contact') return sw.strike * h > 0 ? 'shank' : 'toe';
    return rnd() < 0.5 ? 'thin' : 'fat';
  }
  // His mis-hits of one kind: thin ones launched low, fat ones high and short.
  function misOfKind(pool, kind) {
    var win = C.launchWindow(pool.club), lo = win ? win[0] - 6 : 10;
    return pool.mis.filter(function (s) { var thin = isNum(s.launch_deg) && s.launch_deg < lo; return kind === 'thin' ? thin : !thin; });
  }
  // A mis-hit he's never hit with this club, made from one of his solid shots: thin
  // runs low along the ground, fat flops out short, a shank shoots off to the side.
  var MADE = {
    thin: { carry: 0.55, roll: 0.75, speed: 0.85, launch: 0.35, apex: 0.2, landing: 0.4, hang: 0.5 },
    fat: { carry: 0.5, roll: 0.1, speed: 0.6, launch: 1.05, apex: 0.45, landing: 0.85, hang: 0.7 },
    shank: { carry: 0.42, roll: 0.3, speed: 0.6, launch: 0.75, apex: 0.35, landing: 0.7, hang: 0.6 },
    toe: { carry: 0.72, roll: 0.25, speed: 0.8, launch: 0.85, apex: 0.6, landing: 0.85, hang: 0.8 }
  };
  function madeMis(s, kind) {
    var m = MADE[kind], out = {};
    Object.keys(s).forEach(function (k) { out[k] = s[k]; });
    out.carry_yds = s.carry_yds * m.carry;
    out.total_yds = out.carry_yds * (1 + m.roll);
    [['ball_speed_mph', m.speed], ['launch_deg', m.launch], ['apex_ft', m.apex], ['landing_deg', m.landing], ['hang_time_s', m.hang]].forEach(function (x) {
      out[x[0]] = isNum(s[x[0]]) ? s[x[0]] * x[1] : null;
    });
    out.made = kind;
    return out;
  }
  // How much of the curve a mis-hit keeps (a low or weak ball curves less).
  var MIS_CURVE = { thin: 0.3, fat: 0.5, shank: 0.2, toe: 0.6 };
  var MIS_SHANK = 26; // degrees a shank starts off to the heel side

  // A sloped lie: slope is { along, side } as slopeAt gives it, facing the shot. With the
  // ball above his feet the face points left of where he's aimed, for a right-hander (a
  // lofted face tilted toward the target points where the slope tips it: the more loft,
  // the more), and his swing flattens, drawing it; below his feet, the other way. Uphill
  // it launches higher, flies a little shorter and stops sooner; downhill it comes out
  // lower and runs on, and both, like a steep sidehill lie, make a clean strike harder.
  //   → null on level ground, or { above, up (degrees: + ball above his feet, + uphill),
  //     face, path (degrees, his hand's way: + open, + in-to-out), launch (degrees more),
  //     carry and roll (shares of them), q (how much harder the strike is) }.
  var LOFT = { Driver: 10.5, '2w': 13, '3w': 15, '4w': 16.5, '5w': 18, '7w': 21, '9w': 24, '2hy': 17, '3hy': 19, '4hy': 22, '5hy': 25, '6hy': 28, '7hy': 31,
    '2i': 18, '3i': 20, '4i': 22, '5i': 25, '6i': 28, '7i': 32, '8i': 36, '9i': 40, PW: 45, GW: 50, AW: 50, SW: 56, LW: 60 };
  function loftOf(club, equip) { var l = C.clubLoft(club, equip); return isNum(l) ? l : LOFT[club] || (isWedge(club) ? 56 : 30); }
  function lieSlope(slope, club, hand, equip) {
    if (!slope) return null;
    var h = hand === 'L' ? -1 : 1, above = Math.atan(h * slope.side) / RAD, up = Math.atan(slope.along) / RAD;
    if (Math.abs(above) < 1 && Math.abs(up) < 1) return null;
    var loft = loftOf(club, equip);
    return {
      above: above, up: up,
      face: -Math.atan(Math.tan(loft * RAD) * Math.sin(above * RAD)) / RAD, path: 0,
      launch: 0.8 * up, carry: up > 0 ? 1 - 0.012 * up : 1 + 0.004 * -up, roll: clamp(1 - 0.04 * up, 0.5, 1.8),
      q: 0.03 * Math.max(0, Math.abs(up) - 3) + 0.02 * Math.max(0, Math.abs(above) - 4)
    };
  }
  // A shot from a sloped lie (for the swing meter and the range: the real swing works the
  // slope in itself): its start line and curve turned by the face and path, as the laws
  // have it, and its height, carry and roll changed.
  function slopeShot(shot, ls, hand) {
    if (!ls) return shot;
    var h = hand === 'L' ? -1 : 1, law = clubLaw(shot.club), fp = facePathOf(shot), out = {};
    Object.keys(shot).forEach(function (k) { out[k] = shot[k]; });
    var C0 = shot.carry_yds, R0 = (isNum(shot.total_yds) ? shot.total_yds : totalOf(shot)) - C0, Cy = C0 * ls.carry, R = R0 > 0 ? R0 * ls.roll * ls.carry : R0;
    out.carry_yds = Cy;
    out.total_yds = Cy + R;
    if (isNum(shot.launch_deg)) out.launch_deg = Math.max(1, shot.launch_deg + ls.launch);
    if (isNum(shot.apex_ft)) out.apex_ft = shot.apex_ft * (1 + 0.02 * ls.up) * ls.carry;
    if (fp) {
      var face = fp.face + h * ls.face, path = fp.path + h * ls.path, start = law.face * face + (1 - law.face) * path, cY = law.curve * Cy * (face - path);
      out.curve_ft = 3 * cY;
      out.offline_ft = 3 * (Math.tan(start * RAD) * (Cy + 0.6 * R) + cY * (1 + 1.2 * R / Cy));
    }
    return out;
  }
  function slopeWords(ls) {
    if (!ls) return '';
    var w = [];
    if (Math.abs(ls.up) >= 3) w.push(ls.up > 0 ? 'uphill lie' : 'downhill lie');
    if (Math.abs(ls.above) >= 3) w.push(ls.above > 0 ? 'ball above your feet' : 'ball below your feet');
    return w.join(', ');
  }

  // ---------------------------------------------------------------------------
  // The shot he means to hit
  // ---------------------------------------------------------------------------
  // A golfer picks the shot as well as the club. Each shot here is a change to his
  // normal setup, the way a real one is played, and what that does to the flight:
  //   shape: the curve it's set up for, as a share of the carry (+ a fade, − a draw, for
  //     his hand), starting the other side of the line by as much, so it finishes on it.
  //     The face and path that make it come from the ball-flight laws for the club, so a
  //     driver needs less of a change than a wedge to curve as far; his own pattern and his
  //     swing go on top of it.
  //   launch, landing (degrees more), apex, carry and roll (shares of his normal shot's),
  //     curve (a share of the curve: a low ball curves less), spin (rolls back this share
  //     of the carry, on the green), q (how much harder it is to strike: less is easier;
  //     the sand gives a splash some margin), run (a chip: it rolls by a ratio of its carry
  //     that depends only on the club's loft, chipRun, not on his full shots' roll).
  //   strokeYds: a shot played with a stroke of its own, like a putt: his biggest one (a
  //     full stroke on the pad or the meter) goes this far with any club. A chip's biggest
  //     is about waist high and runs about 50 yds, so a 20-yd chip is a stroke he can
  //     control, not a twitch.
  //   A draw or a fade he's committed to also takes most of the miss the other way out of
  //   play (swingShot): his face-to-path scatter against the shape is halved, as a golfer
  //   who plays a fade seldom hooks it.
  var SHOTS = {
    normal: { name: 'Normal', say: 'Your usual shot with this club.' },
    draw: { name: 'Draw', shape: -0.06, roll: 1.15, launch: -0.5, say: 'A push-draw: it starts right of the target and curves back to it. Aim the face where it should start and swing out to the right of that.' },
    fade: { name: 'Fade', shape: 0.06, roll: 0.85, launch: 0.5, carry: 0.98, say: 'A pull-fade: it starts left of the target and curves back to it. Aim the face where it should start and swing across to the left of that.' },
    high: { name: 'High', launch: 4, landing: 6, apex: 1.25, carry: 0.96, roll: 0.6, q: 0.1, say: 'Ball forward, a full finish: up over trouble and down soft.' },
    low: { name: 'Low', launch: -5, landing: -10, apex: 0.55, carry: 0.9, roll: 1.9, curve: 0.7, q: 0.05, say: 'Ball back, hands ahead, a short finish: under branches and running on.' },
    spinner: { name: 'Spinner', launch: 1.5, landing: 4, apex: 1.1, carry: 0.97, spin: 0.04, q: 0.15, say: 'A crisp, full wedge that lands and stops: struck pure from a clean lie it checks up, and off a fast swing it spins back.' },
    pitch: { name: 'Pitch', say: 'Your usual short shot: in the air most of the way, a little roll.' },
    punch: { name: 'Punch', say: 'Ball back, hands ahead, a short finish: low under the branches, and it runs. The trees take about 40% off.' },
    chip: { name: 'Chip', launch: -8, landing: -14, apex: 0.35, carry: 0.55, run: true, curve: 0.5, q: -0.15, strokeYds: 50, say: 'A bump-and-run: low, landing just on the green and rolling like a putt. A full stroke is your biggest chip, about waist high.' },
    flop: { name: 'Flop', launch: 18, landing: 20, apex: 2.4, carry: 0.45, roll: 0.2, curve: 0.4, q: 0.35, say: 'Face open, a long swing for a short shot: very high, landing soft over trouble. Risky: skulled, it flies the green; chunked, it goes nowhere.' },
    splash: { name: 'Splash', launch: 10, landing: 10, apex: 1.6, carry: 0.5, roll: 0.4, curve: 0.4, q: -0.05, say: 'Open the face and hit the sand an inch or two behind the ball; let it splash out. The sand takes half the power.' }
  };
  function isShortIron(club) { return isWedge(club) || /^[89]i$/.test(club); }
  // A shot type's stroke: how big a swing its longest stroke is with this club (pool),
  // as a share of a full one (1: a full swing).
  function strokeScale(type, pool) {
    var t = SHOTS[type];
    if (!t || !t.strokeYds || !pool) return 1;
    return clamp(t.strokeYds / (pool.full * shotReach(type, pool.carry, pool.full - pool.carry, pool.club)), 0.05, 1);
  }
  // Whether a shot type has a stroke of its own (a chip).
  function ownStroke(type) { return !!(SHOTS[type] && SHOTS[type].strokeYds); }
  // The shots that change nothing about his normal one: under the trees every shot is a
  // punch already (LIE.trees), and a pitch is his normal short shot.
  function plainShot(type) { return !SHOTS[type] || type === 'normal' || type === 'pitch' || type === 'punch'; }
  // A shot's words for his hand: a left-hander's draw starts left and curves right.
  function shotSay(type, hand) {
    var t = SHOTS[type];
    if (!t) return '';
    return hand === 'L' ? t.say.replace(/\b(left|right)\b/g, function (w) { return w === 'left' ? 'right' : 'left'; }) : t.say;
  }
  // The shots that make sense from here: ctx { lie, d (yds to the pin), toGreen (yds to the
  // green's edge), club }. Around the green: a pitch, a chip or a flop; from a bunker near
  // the green (within 30 yds: a full splash with a sand wedge goes about half its normal
  // carry), a splash; under the trees, a punch, hooked or cut round them if need be;
  // full shots: normal, draw, fade, high, low, and a spinner off a clean lie.
  function shotTypes(ctx) {
    var lie = ctx.lie, near = ctx.d <= 45 || ctx.toGreen <= 30;
    if (lie === 'green') return [];
    if (lie === 'bunker') return ctx.d <= 30 ? ['splash', 'normal'] : ['normal', 'low'];
    if (lie === 'trees') return ['punch', 'draw', 'fade'];
    if (near) return ['pitch', 'chip', 'flop'];
    var out = ['normal', 'draw', 'fade', 'high', 'low'];
    if (ctx.d <= 140 && lie !== 'rough') out.push('spinner');
    return out;
  }
  // A wedge spins back only off a fast strike: tour players' wedges leave at 85–100 mph and
  // back up on a soft green, while at the 65–80 mph of a slower swing a pure one checks up.
  // So the spinner is suggested only to a golfer whose pure strike with the club is that fast.
  var SPIN = { back: 85 };
  // Whether a club can play a shot type: a flop or a splash needs a wedge, a spinner a
  // wedge or a short iron, and a chip anything but a wood.
  function shotFits(type, club) {
    if (type === 'flop' || type === 'splash') return isWedge(club);
    if (type === 'spinner') return isShortIron(club);
    if (type === 'chip') return !/^(Driver|\d+w)$/.test(String(club));
    return true;
  }
  // How far a chip rolls for each yard it carries, by the club's loft: the chipping ratios
  // golfers are taught, in their gentler form for a medium-speed green (carry to roll about
  // 1 : 1 with a sand wedge, 1 : 2 with a pitching wedge, 1 : 3 with an 8 iron and 1 : 4 with
  // a 6 iron). A chip is a short stroke on a low ball, so it rolls the same way every time,
  // whatever his full swings with the club do.
  function chipRun(club) { return clamp(1 + (56 - (LOFT[club] || 45)) / 9.3, 0.6, 4.2); }
  // A chip's carry as a share of its total (pool: his shots with the club).
  function chipShare(pool) { return 1 / (1 + chipRun(pool.club)); }
  // The angle a shot type comes down at with a club (his normal one's, changed by the type).
  function typeLanding(pool, type) { var t = SHOTS[type]; return clamp((pool ? pool.landing : 46) + (t && t.landing || 0), 2, 80); }
  // The club to chip with from d yds, toGreen of them to the green's edge, the green rise
  // yds above the ball: as a golfer picks it, the least lofted of his irons and wedges that
  // still lands it on the green (by a yard and a half, more on a longer chip) and lets it
  // roll the rest. Uphill a chip comes down sooner, and its roll on the green is the same,
  // so it lands shorter. null when none lands it on (pitch it instead).
  function chipClub(pools, d, toGreen, rise) {
    var list = Object.keys(pools).filter(function (c) { return /^(\d+i|PW|GW|AW|SW|LW)$/.test(c) && (LOFT[c] || 0) >= 28; })
      .sort(function (a, b) { return LOFT[a] - LOFT[b]; });
    var need = toGreen + Math.max(1.5, 0.08 * d), up = isNum(rise) ? rise : 0;
    for (var i = 0; i < list.length; i++) {
      var p = pools[list[i]], share = chipShare(p), land = share * d - (1 - share) * up / Math.tan(typeLanding(p, 'chip') * RAD);
      if (land >= need) return list[i];
    }
    return null;
  }
  // The club a shot type wants, given his clubs (pools) and the one picked: a flop or a
  // splash wants his most lofted wedge, a spinner a wedge or a short iron, a chip the club
  // that lands it just on the green (chipClub; ctx: { d, toGreen }), or one that runs.
  function clubForShot(type, pools, club, ctx) {
    var has = function (c) { return !!pools[c]; };
    if (type === 'chip' && ctx && isNum(ctx.d) && isNum(ctx.toGreen)) { var cc = chipClub(pools, ctx.d, ctx.toGreen, ctx.rise); if (cc) return cc; }
    if (shotFits(type, club) && type !== 'chip') return club;
    if (type === 'flop' || type === 'splash') { var w = ['LW', 'SW', 'GW', 'AW', 'PW'].filter(has); return w.length ? w[0] : club; }
    if (type === 'spinner') return isShortIron(club) ? club : (['GW', 'AW', 'PW', 'SW', '9i'].filter(has)[0] || club);
    if (type === 'chip') return shotFits(type, club) && !/^(SW|LW|GW|AW)$/.test(club) ? club : ['8i', '9i', '7i', 'PW', '6i'].filter(has)[0] || club;
    return club;
  }
  // The face and path (degrees, his hand's way) that set a shot up to curve `shape` of its
  // carry, starting the other side of the line by as much.
  function shapeSetup(shape, club) {
    if (!shape) return { face: 0, path: 0 };
    var law = clubLaw(club), D = shape / law.curve, S = -Math.atan(shape) / RAD;
    return { face: S + (1 - law.face) * D, path: S - law.face * D };
  }
  // How far a full swing goes with a shot type, as a share of his normal one's total
  // (carry C0 and roll R0 of his good shot with the club). A chip runs farther the less
  // loft the club has.
  function shotReach(type, C0, R0, club) {
    var t = SHOTS[type] || SHOTS.normal, c = C0 * (t.carry || 1), r = t.run ? c * chipRun(club) : Math.max(0, R0) * (t.roll != null ? t.roll : 1);
    return (c + r) / Math.max(1, C0 + Math.max(0, R0));
  }
  // A shot's flight changed for a shot type. lie: where it's hit from (no spin from the
  // rough: it comes out "hot" and runs); q: how well it was struck (a spinner needs a pure
  // strike to bite). → the shot, with .spun when it spins back.
  function typeFlight(out, type, lie, q) {
    var t = SHOTS[type];
    if (plainShot(type)) return out;
    var C0 = out.carry_yds, R0 = (isNum(out.total_yds) ? out.total_yds : totalOf(out)) - C0, Cy = C0 * (t.carry || 1), R;
    if (type === 'spinner') {
      var slow = isNum(out.ball_speed_mph) && out.ball_speed_mph < SPIN.back;
      if (lie === 'rough') R = Math.max(0, R0) * 1.6 + 0.04 * C0;          // a flier: no spin, it runs
      else if (q < 0.45 && !slow) { R = -t.spin * Cy; out.spun = true; }   // it bites and spins back
      else if (q < 0.45) { R = Math.max(0, R0) * 0.3; out.checked = true; } // pure, but too slow to back up: it checks
      else R = Math.max(0, R0) * 0.8;                                      // not crisp enough: it checks, then rolls
    } else R = t.run ? Cy * chipRun(out.club) : Math.max(0, R0) * (t.roll != null ? t.roll : 1);
    out.carry_yds = Cy;
    out.total_yds = Cy + R;
    if (isNum(out.launch_deg)) out.launch_deg = clamp(out.launch_deg + (t.launch || 0), 1, 70);
    if (isNum(out.landing_deg)) out.landing_deg = clamp(out.landing_deg + (t.landing || 0), 2, 80);
    if (isNum(out.apex_ft)) out.apex_ft = out.apex_ft * (t.apex || 1) * Cy / C0;
    if (isNum(out.hang_time_s)) out.hang_time_s = out.hang_time_s * Math.sqrt((t.apex || 1) * Cy / C0);
    return out;
  }
  // A shot type for the swing meter and the range (the real swing builds it in): the
  // setup's face and path turned into the start line and curve, then the flight.
  function typeShot(shot, type, hand, lie, q) {
    var t = SHOTS[type];
    if (plainShot(type)) return shot;
    var out = {}, h = hand === 'L' ? -1 : 1, law = clubLaw(shot.club), fp = facePathOf(shot), su = shapeSetup(t.shape, shot.club);
    Object.keys(shot).forEach(function (k) { out[k] = shot[k]; });
    typeFlight(out, type, lie, isNum(q) ? q : 0.3);
    if (fp) {
      var Cy = out.carry_yds, R = out.total_yds - Cy, face = fp.face + h * su.face, path = fp.path + h * su.path;
      var start = law.face * face + (1 - law.face) * path, cY = law.curve * Cy * (face - path) * (t.curve || 1);
      out.curve_ft = 3 * cY;
      out.offline_ft = 3 * (Math.tan(start * RAD) * (Cy + 0.6 * R) + cY * (1 + 1.2 * R / Cy));
    }
    return out;
  }
  // The trouble either side of a shot's landing area, from a to b (where he's aiming): the
  // ground from 6 to 45 yds off the line, from three quarters of the way to a little past
  // it, the nearer the more it counts. pen: water and out of bounds; all: those, the trees
  // and the sand (a bunker counts a sixth as much as water). left and right are as he faces b.
  //   → { left: { pen, all, what }, right: { pen, all, what } }  (what: the worst there)
  var TROUBLE = { water: 3, ob: 3, trees: 1, bunker: 0.5 };
  function troubleBeside(H, a, b) {
    var D = dist(a, b), hd = headingTo(a, b), out = { left: { pen: 0, all: 0, what: '' }, right: { pen: 0, all: 0, what: '' } };
    for (var f = 0.75; f <= 1.1001; f += 0.05) for (var side = -1; side <= 1; side += 2) for (var lat = 6; lat <= 45; lat += 3) {
      var q = FL.offsetPoint(a.x, a.z, hd, D * f, side * lat), l = lieAt(H, q.x, q.z), w = TROUBLE[l];
      if (!w) continue;
      var o = side < 0 ? out.left : out.right, ww = w / (1 + lat / 12);
      o.all += ww;
      if (l === 'water' || l === 'ob') o.pen += ww;
      if (!o.what || TROUBLE[o.what] < w) o.what = l;
    }
    ['left', 'right'].forEach(function (k) { out[k].pen = Math.round(out[k].pen * 10) / 10; out[k].all = Math.round(out[k].all * 10) / 10; });
    return out;
  }
  // The side that's clearly worse (−1 left, 1 right): water or out of bounds on one side
  // only (pen), or else much more of everything (at least 2.5, and 2.5 times the other
  // side's: most holes have trees down both sides).
  function worseSide(beside) {
    if (!beside) return null;
    var L = beside.left, R = beside.right;
    if (Math.max(L.pen, R.pen) >= 1.5 && Math.min(L.pen, R.pen) * 2 < Math.max(L.pen, R.pen)) {
      var ps = L.pen > R.pen ? -1 : 1;
      return { side: ps, pen: true, what: ps < 0 ? L.what : R.what };
    }
    if (Math.max(L.all, R.all) >= 2.5 && Math.min(L.all, R.all) * 2.5 < Math.max(L.all, R.all)) {
      var s = L.all > R.all ? -1 : 1;
      return { side: s, pen: false, what: s < 0 ? L.what : R.what };
    }
    return null;
  }
  var TROUBLE_WORDS = { water: 'water on the ', ob: 'out of bounds down the ', trees: 'trees down the ', bunker: 'bunkers on the ' };
  // The shot to play from here, and why, for a golfer thinking his way round: ctx { lie,
  // d, toGreen, hand, club, reach (how far this club goes from here), types, bend (which way
  // the hole turns over this shot and a little past it: −1 left, 1 right, 0 straight, only
  // when the pin is out of reach), beside (from
  // troubleBeside), treesLow / treesHigh (trees in the way of a normal flight, not of a low
  // or a high one), overSand (a bunker on the line in the last 40 yds before the pin),
  // room (yds of green between its near edge and the pin), chipClub (chipClub's, null when
  // no club lands a chip on the green), spinSpeed (the club's pure-strike ball speed, for a
  // spinner), ownCurve (yds his normal shot with the club curves, + right) }.  → { type, why }
  //   In order: a splash, a punch from the trees, under or over trees in the way; round the
  //   green, a flop, chip or pitch; then away from water or out of bounds, high over a
  //   bunker to a tucked pin, a spinner to a tight one, round the corner, and away from
  //   trees or sand. Not a draw or a fade with a wedge: that's a shot for distance.
  function suggestShot(ctx) {
    var types = ctx.types || shotTypes(ctx), has = function (t) { return types.indexOf(t) >= 0; }, h = ctx.hand === 'L' ? -1 : 1;
    if (!types.length) return null;
    // which shape curves the ball dir (−1 left, 1 right): a draw curves left for a right-hander
    var shapeTo = function (dir) { return dir === -h ? 'draw' : 'fade'; }, canShape = has('draw') && has('fade') && !isWedge(ctx.club);
    var atPin = !isNum(ctx.reach) || ctx.d <= ctx.reach + 10;
    if (has('splash')) return { type: 'splash', why: 'a bunker shot near the green: splash it out' };
    if (has('punch')) return { type: 'punch', why: 'under the branches: keep it low and back in play' };
    if (ctx.treesLow && has('low')) return { type: 'low', why: 'trees in the way: keep it under them' };
    if (ctx.treesHigh && has('high')) return { type: 'high', why: 'a tree in the way: go up over it' };
    if (has('chip')) {
      if (ctx.overSand && ctx.room < 5) return { type: 'flop', why: 'a bunker in the way and hardly any green to land on: go over it, high and soft' };
      if (!ctx.overSand && ctx.room >= 6 && ctx.toGreen <= 12 && ctx.chipClub !== null) return { type: 'chip', why: 'green to roll it on: the safest shot' };
      return { type: 'pitch', why: ctx.overSand ? 'carry the bunker, then a little roll' : 'carry it most of the way' };
    }
    var ws = canShape ? worseSide(ctx.beside) : null, side = ws ? (ws.side < 0 ? 'left' : 'right') : '';
    // Play your usual shape: when his normal shot with the club already curves away from the
    // trouble (3 yds or more on average), that's the shot, not a bigger one.
    var own = isNum(ctx.ownCurve) && Math.abs(ctx.ownCurve) >= 3 ? (ctx.ownCurve < 0 ? -1 : 1) : 0;
    var usual = ws && own === -ws.side && has('normal') ? { type: 'normal', why: TROUBLE_WORDS[ws.what] + side + ': your usual ' + shapeTo(own) + ' curves away from ' + (ws.pen ? 'it' : 'them') } : null;
    if (ws && ws.pen) return usual || { type: shapeTo(-ws.side), why: TROUBLE_WORDS[ws.what] + side + ': curve it away from it' };
    if (atPin && ctx.overSand && ctx.room < 12 && has('high')) return { type: 'high', why: 'a bunker short of the pin: up high, down soft' };
    if (has('spinner') && ctx.room < 8 && ctx.d <= 120 && isNum(ctx.spinSpeed) && ctx.spinSpeed >= SPIN.back) return { type: 'spinner', why: 'a tight pin: land it past and spin it back' };
    if (canShape && ctx.bend) return { type: shapeTo(ctx.bend), why: 'the hole bends ' + (ctx.bend < 0 ? 'left' : 'right') + ': shape it round the corner' };
    if (ws) return usual || { type: shapeTo(-ws.side), why: TROUBLE_WORDS[ws.what] + side + ': curve it away from them' };
    return { type: types[0], why: '' };
  }
  // Did the planned shot come off? rep: the swing's report (the real swing), or the
  // finished shot's numbers: { type, curve (yds, + right), carry, apex, normalApex, spun,
  // mis, lie, hand }. → { ok, text }.
  function shotVerdict(o) {
    var t = SHOTS[o.type], h = o.hand === 'L' ? -1 : 1;
    if (plainShot(o.type)) return null;
    var cv = h * o.curve / Math.max(1, o.carry);
    if (o.mis) {
      if (o.type === 'flop' && o.mis === 'thin') return { ok: false, text: 'Skulled the flop: it shot across the green.' };
      if (o.type === 'flop' && o.mis === 'fat') return { ok: false, text: 'Chunked the flop: it barely moved.' };
      return { ok: false, text: 'A mis-hit, so the ' + t.name.toLowerCase() + ' never had a chance.' };
    }
    if (o.type === 'draw') return cv < -0.02 ? { ok: true, text: 'It drew, as planned.' } : { ok: false, text: 'It didn’t draw: the face was ' + (cv > 0.02 ? 'open' : 'square') + ' to the path.' };
    if (o.type === 'fade') return cv > 0.02 ? { ok: true, text: 'It faded, as planned.' } : { ok: false, text: 'It didn’t fade: the face was ' + (cv < -0.02 ? 'shut' : 'square') + ' to the path.' };
    if (o.type === 'spinner') return o.spun ? { ok: true, text: 'It bit and spun back.' } : o.checked ? { ok: true, text: 'It bit and checked up. A faster swing spins it back.' }
      : { ok: false, text: o.lie === 'rough' ? 'From the rough you can’t spin it: it came out hot and ran.' : 'Not struck crisply enough to spin: it released.' };
    if (o.type === 'high') return { ok: true, text: 'Up high and down soft.' };
    if (o.type === 'low') return { ok: true, text: 'Low and running.' };
    if (o.type === 'chip') return { ok: true, text: 'Low and rolling, like a putt.' };
    if (o.type === 'flop') return { ok: true, text: 'High and soft: a good flop.' };
    if (o.type === 'splash') return { ok: true, text: 'Out of the sand.' };
    return null;
  }

  // The shape of a shot in a golfer's words, for his hand: where it started (a pull
  // starts to the left for a right-hander, a push to the right) and how it curved (a
  // draw curves left for a right-hander and a big one is a hook; a fade curves right
  // and a big one is a slice). start: ° right of the line; curve: yds right; h: 1 for a
  // right-hander, −1 for a left-hander.
  function shapeOf(start, curve, carry, h) {
    var s = h * start, c = h * curve, side = carry * Math.tan(Math.abs(start) * RAD);
    var st = Math.abs(s) >= 1.5 && side >= 2.5 ? (s < 0 ? 'Pull' : 'Push') : '';
    var r = Math.abs(c) / Math.max(carry, 1);
    var cv = r < 0.025 || Math.abs(c) < 2 ? '' : c < 0 ? (r > 0.07 ? 'hook' : 'draw') : (r > 0.07 ? 'slice' : 'fade');
    if (!st && !cv) return 'Straight';
    if (!cv) return st;
    return st ? st + '-' + cv : cv.charAt(0).toUpperCase() + cv.slice(1);
  }

  // swingShot(pool, sw, opts) → the shot a swing on the pad hits, ready for playShot,
  // with a report of the swing. sw: from readSwing. opts: { lie, rnd, easy, hand ('L'
  // for a left-hander), still (a practice swing: what it does on average, with none of
  // his scatter or luck and no mis-hit, though rep.pMis says how likely one was) }.
  //   { shot, rep: { club, depth, power, ratio, target, tempo, back, down, pause, angle,
  //     strike (balls off the middle: + heel, − toe), q (the strike: 0 pure, 1 the edge
  //     of solid), mis (null, or 'thin', 'fat', 'shank', 'toe'), real (the real shot it
  //     was built on), face, path, f2p (his hand's way: + open, in-to-out, open to the
  //     path), start (° right), curve (yds right), carry, side (yds right where it
  //     landed), shape, pMis (the chance this swing mis-hits), own (his club's usual
  //     face and path) } }
  function swingShot(pool, sw, opts) {
    if (!pool || !sw || !sw.ok) return null;
    opts = opts || {};
    var cfg = opts.easy ? SWING.easy : SWING.normal, rnd = opts.rnd || Math.random, lie = opts.lie || 'fairway', h = opts.hand === 'L' ? -1 : 1;
    var club = pool.club, prof = swingProfile(pool), law = prof.law, kind = C.clubKind(club);
    var ls = lieSlope(opts.slope, club, opts.hand, opts.equip), type = SHOTS[opts.type] ? opts.type : 'normal', ty = SHOTS[type], su = shapeSetup(ty.shape, club);
    var still = !!opts.still, tempo = clamp(sw.tempo, -1, 1), st = strikeOf(sw, cfg), q = Math.max(0, st.q + (ls ? ls.q : 0) + (ty.q || 0) + (still ? 0 : Math.abs(gauss(rnd)) * 0.1));
    // The strike: a mis-hit, or one of his solid shots, the better the swing the better struck.
    var pMis = pool.misRate * Math.min(1, q) * Math.min(1, q) + clamp((q - 1) * 0.6, 0, 0.8), mis = null, real, base;
    if (!still && rnd() < pMis) {
      mis = misKind(sw, st, h, rnd);
      var mine = mis === 'thin' || mis === 'fat' ? misOfKind(pool, mis) : [];
      if (mine.length) real = base = mine[Math.floor(rnd() * mine.length)];
      else { real = null; base = madeMis(pool.ranked[Math.floor(rnd() * pool.ranked.length)], mis); }
    } else {
      var byStrike = pool.byStrike || (pool.byStrike = pool.ranked.slice().sort(function (a, b) {
        return Math.max(0, pool.pure - a.carry_yds) - Math.max(0, pool.pure - b.carry_yds) || (b.ball_speed_mph || 0) - (a.ball_speed_mph || 0);
      }));
      var n = byStrike.length, at = Math.round(Math.pow(Math.min(1, q), RANK_CURVE) * (n - 1)), k = Math.max(1, Math.round(n * 0.08));
      var band = byStrike.slice(clamp(at - k, 0, n - 1), clamp(at + k, 0, n - 1) + 1);
      real = base = band[still ? Math.floor(band.length / 2) : Math.floor(rnd() * band.length)];
      // A chip is a short, simple stroke: a less than pure one costs it far less distance.
      if (ty.run && isNum(pool.pure) && base.carry_yds < pool.pure) base = Object.assign({}, base, { carry_yds: pool.pure - (pool.pure - base.carry_yds) * 0.4 });
    }
    var power = sw.power * strokeScale(type, pool), out = typeFlight(adjustShot(base, power, lie), type, lie, q), lf = lieFactor(club, lie);
    // A skulled flop shoots off low across the green; a chunked one goes nowhere.
    if (mis && type === 'flop') {
      if (mis === 'thin') { out.carry_yds *= 2.6; out.total_yds = out.carry_yds * 1.6; if (isNum(out.launch_deg)) out.launch_deg = 9; if (isNum(out.apex_ft)) out.apex_ft *= 0.25; if (isNum(out.landing_deg)) out.landing_deg = 14; }
      else { out.carry_yds *= 0.5; out.total_yds = out.carry_yds * 1.1; }
    }
    // The face and the path: his own, his scatter (wider from a bad lie or an overswing), the timing and the swipe.
    var over = Math.max(0, sw.depth - 1), wild = (1 + 2.5 * over) * lf.spray * cfg.rest;
    var zS = still ? 0 : gauss(rnd), zD = still ? 0 : prof.rho * zS + Math.sqrt(1 - prof.rho * prof.rho) * gauss(rnd);
    var nS = zS * prof.sdStart * wild, nD = zD * prof.sdF2p * wild, plan = su.face - su.path;
    if (plan && nD * h * plan < 0) nD *= 0.5;   // committed to a shape, he seldom curves it the other way
    var u = clamp(h * sw.strike, -3, 3), uOff = deadband(u, cfg.strikeMid);
    var dFace = -cfg.face * tempo, dPath = -cfg.path * tempo, dSwipe = cfg.swipe * deadband(sw.angle, cfg.dead);
    // Swung with the phone: the face and the path are what it measured (a share of them,
    // past what holding a phone can't keep still), not what the tempo and a swipe suggest.
    if (sw.motion && isNum(sw.face)) {
      dFace = clamp(MOTION.face * deadband(sw.face, MOTION.faceDead), -MOTION.maxFace, MOTION.maxFace);
      dPath = isNum(sw.path) ? clamp(MOTION.path * deadband(sw.path, MOTION.pathDead), -MOTION.maxPath, MOTION.maxPath) : dPath;
      dSwipe = 0;
    }
    var face = prof.face + nS + (1 - law.face) * nD + h * (dFace - TWIST * uOff + (ls ? ls.face : 0) + su.face);
    var path = prof.path + nS - law.face * nD + h * (dPath + (ls ? ls.path : 0) + su.path) + dSwipe;
    var f2p = face - path, spin = f2p + h * GEAR[kind] * uOff;
    var start = law.face * face + (1 - law.face) * path;
    if (mis === 'shank') start = h * MIS_SHANK + 0.3 * start;
    // A big curve costs a little carry; an open face (to the path) flies higher and stops
    // quicker, a shut one lower, running on; off the middle it goes shorter.
    var open = clamp(h * spin, -6, 6), C0 = out.carry_yds, R0 = (isNum(out.total_yds) ? out.total_yds : totalOf(out)) - C0;
    var Cy = C0 * (1 - 0.004 * Math.max(0, Math.abs(spin) - 2)) * (mis ? 1 : Math.max(0.75, 1 - 0.06 * uOff * uOff)) * (ls ? ls.carry : 1);
    var R = R0 * (Cy / C0) * (R0 > 0 ? (ty.run ? 1 : clamp(1 - 0.06 * open, 0.5, 1.6)) * (ls ? ls.roll : 1) : 1);
    if (out.spun) R = R0 * (Cy / C0);   // a spinner's spin-back isn't changed by the face
    out.carry_yds = Cy;
    out.total_yds = Cy + R;
    if (isNum(out.launch_deg)) out.launch_deg = Math.max(1, out.launch_deg + 0.35 * open + (ls ? ls.launch : 0));
    if (isNum(out.apex_ft)) out.apex_ft = out.apex_ft * (1 + 0.03 * open) * Cy / C0;
    if (isNum(out.landing_deg)) out.landing_deg = clamp(out.landing_deg + 0.4 * open, 1, 80);
    var cY = law.curve * Cy * spin * (mis ? MIS_CURVE[mis] : 1) * (ty.curve || 1), sl = Math.tan(start * RAD);
    out.curve_ft = 3 * cY;
    out.offline_ft = 3 * (sl * (Cy + 0.6 * R) + cY * (1 + 1.2 * R / Cy));
    return {
      shot: out,
      rep: {
        club: club, depth: sw.depth, power: power, ratio: sw.ratio, target: sw.target, tempo: sw.tempo, back: sw.back, down: sw.down, pause: sw.pause,
        angle: sw.angle, strike: u, q: q, mis: mis, misCause: mis ? misCause(st) : null, real: real, hand: h,
        dFace: dFace, dPath: dPath, dSwipe: h * dSwipe,
        face: h * face, path: h * path, f2p: h * spin, start: start, curve: cY, carry: Cy, side: sl * Cy + cY,
        shape: shapeOf(start, cY, Cy, h), pMis: pMis, own: { face: h * prof.face, path: h * prof.path, n: prof.n }, slope: ls,
        type: type, spun: !!out.spun, checked: !!out.checked, apex: out.apex_ft, lie: lie, plan: { face: su.face, path: su.path },
        motion: !!sw.motion, phoneFace: sw.motion ? sw.face : null, phonePath: sw.motion ? sw.path : null
      }
    };
  }

  // Where a perfect swing with this club finishes (tempo on the goal, a straight swipe,
  // out of the middle): his usual shape, so the aim can allow for it, as a golfer who
  // fades it aims a little left. → { side (yds right of where it's aimed, at rest),
  // shape }. opts: { hand, easy, equip }.
  function shapeAllowance(pool, power, lie, opts) {
    opts = opts || {};
    var depth = clamp(isNum(power) ? power : 1, 0.05, 1), target = tempoTarget(depth), back = 0.8;
    var sw = { ok: true, depth: depth, power: depth, back: back, down: back / target, pause: 0, ratio: target, target: target, tempo: 0, angle: 0, strike: 0 };
    var out = swingShot(pool, sw, { lie: lie, still: true, hand: opts.hand, easy: opts.easy, slope: opts.slope, equip: opts.equip, type: opts.type });
    var tr = out && FL.trajectory(out.shot, flightOpts(pool.club, opts.equip));
    return { side: tr ? tr.rest.x : 0, shape: out ? out.rep.shape : 'Straight' };
  }

  // Putting on the pad: the drag back sets the length (PUTT_SWING.full ft for a full
  // backswing, growing faster than the drag, so short putts still get a usable stroke)
  // and the tempo the pace (2 : 1; a quick, jabbed stroke runs on, a slow one dies). The
  // face sets the line: a quick stroke shuts it (a pull), a slow one leaves it open (a
  // push), the swipe's lean turns it, and off the toe or heel it twists and goes short.
  // However well it's struck, no green is perfect: each putt also wanders off its line
  // by up to a few inches every 10 ft (read: the spread, in ft for each foot of putt).
  var PUTT_SWING = {
    normal: { full: 60, exp: 1.5, pace: 0.45, face: 2, swipe: 0.15, dead: 2, line: 0.25, len: 0.05, read: 0.02 },
    easy: { full: 60, exp: 1.5, pace: 0.3, face: 1.3, swipe: 0.1, dead: 3.5, line: 0.25, len: 0.045, read: 0.018 }
  };
  function puttLength(depth, easy) { var c = easy ? PUTT_SWING.easy : PUTT_SWING.normal; return c.full * Math.pow(Math.max(0, depth), c.exp); }
  // The backswing for a putt this long (ft): one that dies a foot past the hole.
  function puttDepth(ft, easy) { var c = easy ? PUTT_SWING.easy : PUTT_SWING.normal; return Math.pow((ft + 1.2) / c.full, 1 / c.exp); }
  // puttSwing(ft, sw, rnd, lie, opts) → { holed, along, side } as putt() gives (ft), and rep
  // (opts: { easy, hand, still: a practice stroke, with no luck }):
  // { len (ft it would roll), start (° right), ratio, target, tempo, strike, past (ft past the hole, − short) }.
  function puttSwing(ft, sw, rnd, lie, opts) {
    if (!sw || !sw.ok) return null;
    opts = opts || {};
    var c = opts.easy ? PUTT_SWING.easy : PUTT_SWING.normal, h = opts.hand === 'L' ? -1 : 1, rough = lie === 'fringe' ? 1.3 : 1;
    var tempo = clamp(sw.tempo, -1, 1), u = clamp(h * sw.strike, -3, 3), uOff = deadband(u, 0.35);
    var luck = opts.still ? function () { return 0; } : function () { return gauss(rnd); };
    var len = puttLength(Math.min(sw.depth, 1.2), opts.easy) * Math.exp(c.pace * tempo) * Math.max(0.7, 1 - 0.05 * uOff * uOff) * (1 + luck() * c.len * rough);
    var faceStart = sw.motion && isNum(sw.face) ? MOTION.puttFace * deadband(sw.face, MOTION.puttDead) : -c.face * tempo;
    var start = h * (faceStart - TWIST * 0.5 * uOff) + c.swipe * deadband(sw.angle, c.dead) + luck() * c.line * rough;
    len = Math.max(0.3, len);
    var wander = luck() * c.read * ft * rough, lat = ft * Math.tan(start * RAD) + wander, past = len - ft, cap = past < 0 ? 0 : 0.2 * clamp(1 - past / 5, 0.25, 1);
    var rep = { len: len, start: start, ratio: sw.ratio, target: sw.target, tempo: sw.tempo, back: sw.back, down: sw.down, angle: sw.angle, strike: u, past: past, hand: h, motion: !!sw.motion, phoneFace: sw.motion ? sw.face : null };
    if (past >= 0 && Math.abs(lat) <= cap) return { holed: true, along: ft, side: 0, rep: rep };
    return { holed: false, along: len, side: lat * len / Math.max(ft, 0.5), rep: rep };
  }

  // What to work on after a swing, in words: the one thing that cost the most, with
  // the numbers, and what the club usually does for him when the swing was good.
  // A tempo, kept on one line: "3.4 : 1"; a goal is a whole number when it is one ("3 : 1").
  function ratioText(r) { return (Math.round(r * 10) / 10).toFixed(1) + '\u00a0:\u00a01'; }
  function goalText(g) { return (Math.abs(g - Math.round(g)) < 0.05 ? String(Math.round(g)) : (Math.round(g * 10) / 10).toFixed(1)) + '\u00a0:\u00a01'; }
  function secs(t) { return t.toFixed(2) + ' s'; }
  function degText(d) { return (Math.round(Math.abs(d) * 10) / 10).toFixed(1) + '°'; }
  function faceWord(f) { return Math.abs(f) < 0.5 ? 'square' : degText(f) + (f > 0 ? ' open' : ' closed'); }
  function pathWord(p) { return Math.abs(p) < 0.5 ? 'straight down the line' : degText(p) + (p > 0 ? ' in-to-out' : ' out-to-in'); }
  function tempoWord(rep) {
    var e = rep.tempo, q = Math.abs(e);
    if (q < 0.07) return 'Perfect tempo';
    if (q < 0.15) return e > 0 ? 'Tempo a touch quick' : 'Tempo a touch slow';
    return e > 0 ? (q < 0.3 ? 'Quick from the top' : 'Rushed from the top') : (q < 0.3 ? 'Slow from the top' : 'Very slow from the top');
  }
  // What went wrong, for a right-hander (side) or a left-hander, in the order it cost him:
  // the strike, the tempo (with what it did to the face), the swipe (said the way the ball
  // really curved: an in-to-out swipe draws it only if the face is shut to the path),
  // coming back through off the middle, and swinging past full.
  function swingTips(rep, putt) {
    var tips = [], ideal = rep.back / rep.target, side = rep.hand > 0 ? ['left', 'right'] : ['right', 'left'], stop = rep.motion ? 'Stop at a full backswing.' : 'Stop at the Full line.';
    var swipe = deadband(rep.angle, 3), dir = swipe > 0 ? 'up to the right' : 'up to the left', cause = rep.misCause;
    var through = (rep.strike * rep.hand > 0 ? 'right' : 'left') + ' of the ball';
    if (rep.mis === 'thin') tips.push(cause === 'over' ? 'Thin: past full, the strike suffers. ' + stop : cause === 'snatch' ? 'Thin: a snatched takeaway. Start the club back smoothly.' : 'Thin: rushing from the top pulls you up out of it.');
    if (rep.mis === 'fat') tips.push(cause === 'over' ? 'Fat: past full, the strike suffers. ' + stop : 'Fat: slow through the ball, so the club bottomed out behind it. Keep the speed up through impact.');
    if (rep.mis === 'shank') tips.push('Shank: you came back through ' + through + ', onto the hosel. Swipe back up through the ball.');
    if (rep.mis === 'toe') tips.push('Off the toe: you came back through ' + through + '. Swipe back up through it.');
    if (Math.abs(rep.tempo) >= 0.12) {
      var r = ratioText(rep.ratio), want = goalText(rep.target), quick = rep.tempo > 0;
      var face = putt || rep.motion || !isNum(rep.dFace) ? '' : quick ? ' Early, so the face shut ' + degText(rep.dFace) + ' and it started further ' + side[0] + '.'
        : ' Late, so the face stayed ' + degText(rep.dFace) + ' open and it started further ' + side[1] + '.';
      if (quick) tips.push((rep.back > 1.1 ? 'Tempo ' + r + ': a slow backswing (' + secs(rep.back) + '), then a lunge. Take it back a little quicker and smoother, for ' + want + '.'
        : 'Tempo ' + r + ': quick from the top. Back in ' + secs(rep.back) + ' wants about ' + secs(ideal) + ' down, for ' + want + '.') + face);
      else tips.push((rep.back < 0.45 ? 'Tempo ' + r + ': a quick backswing (' + secs(rep.back) + '). Take it back slower, then swish through, for ' + want + '.'
        : 'Tempo ' + r + ': slow from the top. Back in ' + secs(rep.back) + ' wants about ' + secs(ideal) + ' down, for ' + want + '.') + face);
    }
    if (Math.abs(swipe) >= 4 && putt) tips.push('You swiped ' + dir + ', so the putt started ' + (swipe > 0 ? 'right' : 'left') + '. Swipe straight up the line.');
    else if (Math.abs(swipe) >= 4) {
      var inOut = rep.hand * swipe > 0, cv = rep.hand * rep.curve, big = Math.abs(rep.curve) / Math.max(rep.carry, 1) > 0.07;
      var drew = cv < -1.5, faded = cv > 1.5, path = inOut ? 'in-to-out' : 'out-to-in';
      // With a draw or a fade planned, the setup curves it: the swipe should still go straight.
      var then = rep.type === 'draw' || rep.type === 'fade' ? ' The ' + rep.type + ' is in the setup: swipe straight up the line.' : ' For a straight one, swipe straight up the line.';
      if (inOut ? drew : faded) tips.push('You swiped ' + dir + ': ' + path + ', so it ' + (inOut ? (big ? 'hooked' : 'drew') : (big ? 'sliced' : 'faded')) + ' (curved ' + (inOut ? side[0] : side[1]) + ').' + then);
      else tips.push('You swiped ' + dir + ' (' + path + ', which ' + (inOut ? 'draws' : 'fades') + ' it), but the face was ' + (inOut ? (faded ? 'open' : 'square') : (drew ? 'shut' : 'square')) + ' to the path, so it ' + (inOut ? (faded ? 'still faded' : 'flew straight') : (drew ? 'still drew' : 'flew straight')) + '.');
    }
    if (!rep.mis && Math.abs(rep.strike) > 0.6) tips.push('Off the ' + (rep.strike > 0 ? 'heel' : 'toe') + ': you came back through ' + through + '. Swipe back up through it.');
    // Swung with the phone: where the screen faced at impact, and the way it was swinging.
    if (rep.motion && isNum(rep.phoneFace) && Math.abs(rep.phoneFace) >= (putt ? MOTION.puttDead : MOTION.faceDead) + 2) {
      var pf = degText(rep.phoneFace);
      tips.push(rep.phoneFace > 0 ? 'The screen came back ' + pf + ' open: roll it back to square, as it was at address, as you come through.'
        : 'The screen came back ' + pf + ' shut: you rolled it past square. Let it come back just to where it started.');
    }
    if (rep.motion && !putt && isNum(rep.phonePath) && Math.abs(rep.phonePath) >= MOTION.pathDead + 3) {
      tips.push(rep.phonePath > 0 ? 'It came from the inside, ' + degText(rep.phonePath) + ' in-to-out: a flatter downswing than your backswing.'
        : 'It came over the top, ' + degText(rep.phonePath) + ' out-to-in: start down on the same plane you went back on.');
    }
    if (!putt && !rep.mis && rep.depth > 1.04) tips.push('Past full: a longer backswing adds little and costs control. ' + stop);
    var ls = rep.slope;
    if (!putt && ls && Math.abs(ls.above) >= 3) tips.push('Ball ' + (ls.above > 0 ? 'above' : 'below') + ' your feet: the face pointed ' + degText(ls.face) + ' ' + (ls.above > 0 ? side[0] : side[1]) + ' of your aim. Aim a little ' + (ls.above > 0 ? side[1] : side[0]) + ' to allow for it.');
    if (!putt && ls && Math.abs(ls.up) >= 3) tips.push(ls.up > 0 ? 'Uphill lie: it launches higher and flies shorter. Take a little more club.' : 'Downhill lie: it comes out lower and runs. Take a little less club, and swing smoothly to catch it clean.');
    return tips;
  }
  // What his club usually does, from his range shots, when it's worth knowing: a face
  // or path well off square, or a curve (said for his hand).
  function ownShapeText(rep, name) {
    var o = rep.own;
    if (!o || o.n < 4 || (Math.abs(o.face) < 1.5 && Math.abs(o.face - o.path) < 1.5)) return '';
    var law = clubLaw(rep.club), start = law.face * o.face + (1 - law.face) * o.path, d = o.face - o.path;
    var starts = Math.abs(start) < 1 ? 'starts on line' : 'starts ' + (start > 0 ? (rep.hand > 0 ? 'right' : 'left') : (rep.hand > 0 ? 'left' : 'right'));
    var curves = Math.abs(d) < 1 ? 'flies straight' : d > 0 ? 'fades' : 'draws';
    return 'From your range shots, your ' + name + ' comes in with the face ' + faceWord(o.face) + ' and the path ' + pathWord(o.path) + ': it ' + starts + ' and ' + curves + '.';
  }

  // ---------------------------------------------------------------------------
  // A shot on the hole
  // ---------------------------------------------------------------------------
  var CUP = 0.06;  // the hole's radius (yds): 2¼ in
  var ROLL_COST = { fairway: 1, green: 1, fringe: 1.2, rough: 2.6, trees: 4 };
  var ROLL_MU = 0.15; // a fairway's rolling resistance, as a grade: a ball rolls R yds on level fairway
  var LAND_ROLL = { rough: 0.5, trees: 0.35, bunker: 0 };
  var STOPS = { water: 1, penalty: 1, ob: 1 };
  function flightOpts(club, equip) {
    var win = C.launchWindow(club, equip);
    return { kind: C.clubKind(club), club: club, launch: win ? (win[0] + win[1]) / 2 : null };
  }
  // How far a ball that lands at `land` and would roll R yds along `dir` on level fairway
  // really rolls, and where it stops: { d, lie, end }. It's a ball rolling to a stop: what
  // it has left to spend (R × ROLL_MU, less after landing in the rough or the trees) goes on
  // the grass it rolls over (more in the rough, ROLL_COST) and on climbing; going downhill
  // gives some back. A side slope turns it downhill, more as it slows. The greens are
  // level, as they putt (the heights are too coarse for a green's slopes). It stops in a
  // bunker and goes into water or out of bounds.
  function rollOut(H, land, dir, R) {
    var lie = lieAt(H, land.x, land.z);
    if (STOPS[lie] || R <= 0.05) return { d: 0, lie: lie, end: { x: land.x, z: land.z } };
    var G = H.ground, E = R * ROLL_MU * (LAND_ROLL[lie] != null ? LAND_ROLL[lie] : 1), step = 0.5;
    var x = land.x, z = land.z, dx = dir.x, dz = dir.z, d = 0, h = heightAt(G, x, z) / 3, maxD = 4 * R + 5;
    for (var guard = 0; E > 1e-6 && guard < 4000 && d < maxD; guard++) {
      var nx = x + dx * step, nz = z + dz * step, l = lieAt(H, nx, nz);
      if (STOPS[l]) return { d: d + step, lie: l, end: { x: nx, z: nz } };
      if (l === 'bunker') { var e = Math.min(0.8, E / (2 * ROLL_MU)); return { d: d + step + e, lie: 'bunker', end: { x: nx + dx * e, z: nz + dz * e } }; }
      var flat = l === 'green', h2 = heightAt(G, nx, nz) / 3, use = step * ROLL_MU * (ROLL_COST[l] || 1) + (flat ? 0 : h2 - h);
      if (use >= E) { var f = use > 0 ? E / use : 1; x += dx * step * f; z += dz * step * f; d += step * f; break; }
      E -= use;
      x = nx; z = nz; d += step; h = h2;
      if (G.elev && !flat) {
        var rx = dz, rz = -dx, side = (heightAt(G, x + rx, z + rz) - heightAt(G, x - rx, z - rz)) / 3 / 2;
        var turn = clamp(-side * step / (2 * Math.max(E, 0.03)), -0.15, 0.15), c = Math.cos(turn), sn = Math.sin(turn);
        var ndx = dx * c + rx * sn, ndz = dz * c + rz * sn;
        dx = ndx; dz = ndz;
      }
    }
    return { d: d, lie: lieAt(H, x, z), end: { x: x, z: z } };
  }
  // A point on the ground, in yds along and to the side of a shot hit from `from` along `heading`.
  function localOf(from, heading, p) {
    var dx = p.x - from.x, dz = p.z - from.z, sh = Math.sin(heading), ch = Math.cos(heading);
    return { along: dx * sh + dz * ch, side: dx * ch - dz * sh };
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
  // trueY(s): the ball's height s yds along, above the ground it was hit from (the drawn
  // flight's own height when not given); h0: that ground's height (yds). Each tree stands
  // on its own ground.
  function treeHit(H, placed, from, trueY, h0) {
    var skip = from.lie === 'trees' ? 14 : 5, sm = placed.samples, lt = placed.local.samples, G = H.ground;
    for (var i = 1; i < sm.length; i++) {
      if (lt[i].z < skip) continue;
      var p = sm[i], y = trueY ? trueY(lt[i].z) : p.y, near = treesNear(G, p.x, p.z);
      for (var j = 0; j < near.length; j++) {
        var t = near[j], r = t.r * 0.85, dx = p.x - t.x, dz = p.z - t.z;
        if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
        var yy = y - (G.elev ? heightAt(G, t.x, t.z) / 3 - (h0 || 0) : 0);
        if (yy >= t.h || yy < 0) continue;
        var d = Math.hypot(dx, dz);
        if (d < TRUNK || (d < r && yy > LEAVES * t.h)) return { i: i, t: sm[i].t, tree: t, p: p };
      }
    }
    return null;
  }
  // Where a flight comes down on the real ground, s yds along from where it was hit, and
  // the slope it lands on along its line (grade: + uphill). Its height counts from the
  // ground it was hit from (h0, yds): rising ground meets it sooner; over falling ground
  // it flies on past its carry, down at its landing angle, until it meets it.
  function groundMeet(G, tr, from, heading, h0) {
    var C = tr.carry, tanD = Math.tan(tr.landing * Math.PI / 180), s0 = Math.max(1, tr.apexPoint.z);
    function g(s) { var q = FL.offsetPoint(from.x, from.z, heading, s, tr.lateral(s)); return heightAt(G, q.x, q.z) / 3 - h0; }
    function y(s) { return s <= C ? tr.height(s) : -tanD * (s - C); }
    var ps = s0, pd = y(s0) - g(s0);
    if (pd <= 0) return { s: s0, grade: (g(s0 + 1) - g(s0 - 1)) / 2 };
    for (var s = s0 + 1; s <= C + 160; s += 1) {
      var dd = y(s) - g(s);
      if (dd <= 0) { var m = ps + (s - ps) * pd / (pd - dd); return { s: m, grade: (g(m + 1) - g(m - 1)) / 2 }; }
      ps = s; pd = dd;
    }
    return { s: C + 160, grade: 0 };
  }
  // When a flight reaches s yds along (past its carry, at the speed it landed).
  function timeAt(tr, s) {
    if (s >= tr.carry) { var t1 = Math.max(0, tr.hang - 0.05), v = (tr.carry - tr.along(t1)) / Math.max(1e-3, tr.hang - t1); return tr.hang + (s - tr.carry) / Math.max(1, v); }
    var lo = 0, hi = tr.hang;
    for (var k = 0; k < 40; k++) { var mid = (lo + hi) / 2; if (tr.along(mid) < s) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  // The same flight, coming down s yds along instead of at its carry, and rolling R yds.
  // It bends just as it did (the curve grows with the square of the distance) and starts
  // on the same line; only where it comes down changes.
  function landedAt(shot, tr, s, R) {
    var out = {}, k = s / tr.carry, cY = tr.curveY * k * k;
    Object.keys(shot).forEach(function (key) { out[key] = shot[key]; });
    out.carry_yds = s;
    out.total_yds = s + R;
    out.curve_ft = 3 * cY;
    out.offline_ft = 3 * (tr.start * (s + 0.6 * R) + cY * (1 + 1.2 * R / s));
    if (isNum(shot.hang_time_s)) out.hang_time_s = timeAt(tr, s);
    return out;
  }
  // Landing on a slope: an upslope stops the first bounce short, a downslope kicks it on.
  function rollOnLanding(R, grade) { return R > 0 ? R * clamp(1 - 3 * grade, 0.5, 1.6) : R; }
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
    var tr0 = FL.trajectory(shot, fo);
    if (!tr0) return null;
    // On the real ground: the flight comes down where it meets it (sooner uphill, later
    // downhill), and the first bounce goes with the slope it lands on.
    var G = H.ground, h0 = heightAt(G, from.x, from.z) / 3, tr = tr0, fs = { kind: fo.kind, club: fo.club, launch: fo.launch, start: tr0.start };
    if (G.elev) {
      var meet = groundMeet(G, tr0, from, heading, h0), mp = FL.offsetPoint(from.x, from.z, heading, meet.s, tr0.lateral(meet.s));
      // The greens are level (the heights are too coarse for one): no slope to bounce off.
      if (lieAt(H, mp.x, mp.z) === 'green') meet.grade = 0;
      if (Math.abs(meet.s - tr0.carry) > 0.25 || Math.abs(meet.grade) > 0.01) {
        shot = landedAt(shot, tr0, meet.s, rollOnLanding(tr0.roll, meet.grade));
        tr = FL.trajectory(shot, fs) || tr0;
      }
    }
    var trueY = G.elev ? function (s) { return s <= tr0.carry ? tr0.height(s) : -Math.tan(tr0.landing * Math.PI / 180) * (s - tr0.carry); } : null;
    var placed = FL.place(tr, from.x, from.z, heading), result = 'ok', holed = false, treeOf = null;
    var hit = treeHit(H, placed, from, trueY, h0);
    if (hit) {
      var back = Math.hypot(hit.p.x - from.x, hit.p.z - from.z) || 1, r = opts.rnd ? opts.rnd() : 0.5;
      var pull = Math.min(back, 1.2 + 1.8 * r);
      var drop = { x: hit.p.x + (from.x - hit.p.x) * pull / back, z: hit.p.z + (from.z - hit.p.z) * pull / back };
      placed = cutAtTree(placed, hit, drop);
      result = 'tree';
      treeOf = hit.tree;
    } else {
      var land = placed.land, rx = placed.rest.x - land.x, rz = placed.rest.z - land.z, rd = Math.hypot(rx, rz);
      var ro = rd > 0.05 && tr.roll > 0 ? rollOut(H, land, { x: rx / rd, z: rz / rd }, rd) : { d: rd, lie: lieAt(H, land.x, land.z), end: { x: placed.rest.x, z: placed.rest.z } };
      if (tr.roll <= 0 && STOPS[lieAt(H, land.x, land.z)]) ro = { d: 0, lie: lieAt(H, land.x, land.z), end: { x: land.x, z: land.z } };
      var end = ro.end;
      // Into the hole: rolling over it slowly enough, or landing right in it.
      if (opts.pin) {
        var pin = opts.pin, ex = end.x - land.x, ez = end.z - land.z, rolled = Math.hypot(ex, ez), ux = rolled > 0.05 ? ex / rolled : 0, uz = rolled > 0.05 ? ez / rolled : 0;
        var along = clamp((pin.x - land.x) * ux + (pin.z - land.z) * uz, 0, rolled);
        var near = Math.hypot(land.x + ux * along - pin.x, land.z + uz * along - pin.z);
        if (Math.hypot(land.x - pin.x, land.z - pin.z) <= CUP || (near <= CUP && rolled - along <= 3)) {
          holed = true;
          end = { x: land.x + ux * along, z: land.z + uz * along };
        }
      }
      // Where it stops, if not where the drawn flight would: rebuilt on the same line.
      if (Math.hypot(end.x - placed.rest.x, end.z - placed.rest.z) > 0.05) {
        var loc = localOf(from, heading, end), s2 = {};
        Object.keys(shot).forEach(function (k) { s2[k] = shot[k]; });
        s2.total_yds = loc.along;
        s2.offline_ft = 3 * loc.side;
        tr = FL.trajectory(s2, { kind: fo.kind, club: fo.club, launch: fo.launch, start: tr.start }) || tr;
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
  // The putting meter's target: where to stop the marker for a putt this long (ft).
  // sweep: s for the marker to cross the meter; it takes at least `lead` s to reach this
  // putt's line, whatever its length, so a short putt has the same easy rhythm as a long
  // one instead of a snatch.
  var PUTT = { normal: { sweep: 1.9, lead: 0.85, win: 0.06 }, easy: { sweep: 2.4, lead: 1, win: 0.09 } };
  function puttTarget(ft) { return clamp(0.12 + ft / 75, 0.14, 0.9); }
  function puttSweep(target, easy) { var c = easy ? PUTT.easy : PUTT.normal; return Math.max(c.sweep, c.lead / Math.max(0.05, target)); }
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
  // comes down). low: true for a punch from the trees, or a number to scale the height by
  // (a low or a high shot's apex).
  function treesInWay(H, a, b, reach, low) {
    var len = dist(a, b), top = Math.min(30, 0.16 * reach) * (typeof low === 'number' ? low : low ? LIE.trees.low : 1), n = Math.max(8, Math.ceil(len / 6)), hit = [];
    var G = H.ground, ha = heightAt(G, a.x, a.z) / 3, hb = heightAt(G, b.x, b.z) / 3;
    for (var k = 1; k < n; k++) {
      var u = k / n;
      if (u < 0.08 || u > 0.92) continue;
      var x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u, y = top * 4 * u * (1 - u) + (hb - ha) * u, near = treesNear(G, x, z);
      for (var i = 0; i < near.length; i++) {
        var t = near[i], yy = y - (G.elev ? heightAt(G, t.x, t.z) / 3 - ha : 0);
        var d = Math.hypot(x - t.x, z - t.z);
        if (yy < t.h && yy > 0 && hit.indexOf(t) < 0 && (d < TRUNK + 0.5 || (d < t.r * 0.85 + 1 && yy > LEAVES * t.h))) hit.push(t);
      }
      if (hit.length >= 2) return 2;
    }
    return hit.length;
  }
  // landing: the club's landing angle (an iron's 46° when not given), for how far a spot
  // plays with the climb to it.
  function aimFor(H, ball, pin, reach, landing) {
    var low = ball.lie === 'trees', G = H.ground, hb = heightAt(G, ball.x, ball.z) / 3, best = null, cost = Infinity;
    function far(q) { return G.elev ? playsLike(dist(ball, q), heightAt(G, q.x, q.z) / 3 - hb, landing || 46) : dist(ball, q); }
    var dPin = far(pin);
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
      if (far(p) <= reach) ahead = p; else if (ahead) break;
    }
    var h0 = headingTo(ball, dPin <= reach + 5 ? pin : ahead || pin), fan = ball.lie === 'rough' || ball.lie === 'trees' ? 80 : 40;
    var dMax = Math.min(reach, dist(ball, pin) + 10) * 1.3;
    for (var da = -fan; da <= fan; da += 5) {
      for (var f = 1; f >= 0.25 - 1e-9; f -= 0.05) {
        var q = FL.offsetPoint(ball.x, ball.z, h0 + da * Math.PI / 180, dMax * f, 0), l = lieAt(H, q.x, q.z);
        if (!(l in AIM_COST) || far(q) > Math.min(reach, dPin + 10)) continue;
        var c = costOf(q, l, da, dMax * f);
        if (c < cost) { cost = c; best = { x: q.x, z: q.z, pin: false }; }
      }
    }
    return best || { x: pin.x, z: pin.z, pin: true };
  }
  // The share of a full swing to send this club `d` yds from this lie, with this shot type.
  function powerFor(pool, d, lie, type) {
    var k = type && type !== 'normal' ? shotReach(type, pool.carry, pool.full - pool.carry, pool.club) : 1;
    return clamp(d / (pool.full * lieFactor(pool.club, lie).dist * k), 0.1, 1);
  }
  // How far back to take it for d yds: the power, on the shot type's own stroke (a chip's
  // full stroke is its biggest chip), from a twentieth of the stroke to all of it.
  function strokeFor(pool, d, lie, type) {
    var k = type && type !== 'normal' ? shotReach(type, pool.carry, pool.full - pool.carry, pool.club) : 1;
    return clamp(d / (pool.full * lieFactor(pool.club, lie).dist * k * strokeScale(type, pool)), ownStroke(type) ? 0.05 : 0.1, 1);
  }

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
    buildHole: buildHole, groundOf: groundOf, treesNear: treesNear, elevOf: elevOf, heightAt: heightAt, slopeAt: slopeAt, playsLike: playsLike, landingOf: landingOf,
    groundMeet: groundMeet, landedAt: landedAt, rollOnLanding: rollOnLanding, localOf: localOf, ROLL_MU: ROLL_MU, toHole: toHole, lieAt: lieAt, pinFor: pinFor, LIE_WORDS: LIE_WORDS, FRINGE: FRINGE, inPoly: inPoly, centroidOf: centroidOf,
    rankShots: rankShots, clubPools: clubPools, clubList: clubList, totalOf: totalOf,
    METER: METER, timingOf: timingOf, meterBackTime: meterBackTime, meterDownSpeed: meterDownSpeed, timingWord: timingWord, pickShot: pickShot, LIE: LIE, adjustShot: adjustShot,
    LAW: LAW, clubLaw: clubLaw, facePathOf: facePathOf, swingProfile: swingProfile, SWIPE: SWIPE, tempoTarget: tempoTarget, powerOfDepth: powerOfDepth,
    readSwing: readSwing, SWING: SWING, strikeOf: strikeOf, swingShot: swingShot, shapeOf: shapeOf, MIS_SHANK: MIS_SHANK,
    PUTT_SWING: PUTT_SWING, puttLength: puttLength, puttDepth: puttDepth, puttSwing: puttSwing, shapeAllowance: shapeAllowance,
    LOFT: LOFT, loftOf: loftOf, lieSlope: lieSlope, slopeShot: slopeShot, slopeWords: slopeWords,
    SHOTS: SHOTS, shotTypes: shotTypes, shotFits: shotFits, clubForShot: clubForShot, shapeSetup: shapeSetup, shotReach: shotReach, typeFlight: typeFlight, typeShot: typeShot,
    readMotion: readMotion, MOTION: MOTION, SPIN: SPIN, motionCue: motionCue, suggestShot: suggestShot, shotVerdict: shotVerdict, chipClub: chipClub, chipShare: chipShare, chipRun: chipRun, typeLanding: typeLanding, strokeScale: strokeScale, ownStroke: ownStroke, strokeFor: strokeFor, shotSay: shotSay, plainShot: plainShot, troubleBeside: troubleBeside, worseSide: worseSide,
    swingTips: swingTips, ownShapeText: ownShapeText, tempoWord: tempoWord, faceWord: faceWord, pathWord: pathWord, ratioText: ratioText, goalText: goalText,
    DECK: DECK, lieFactor: lieFactor, playShot: playShot, rollOut: rollOut, TRUNK: TRUNK, LEAVES: LEAVES, CUP: CUP, flightOpts: flightOpts,
    PUTT: PUTT, puttTarget: puttTarget, puttSweep: puttSweep, putt: putt, TAP_IN: TAP_IN,
    suggestClub: suggestClub, SURE: SURE, aimFor: aimFor, treesInWay: treesInWay, powerFor: powerFor, headingTo: headingTo, dist: dist,
    scoreName: scoreName, toParText: toParText, MAX_OVER: MAX_OVER, newRound: newRound, totals: totals, seedOf: seedOf
  };
});
