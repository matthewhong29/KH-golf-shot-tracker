/* KH Golf: drill animations. Original line-art scenes drawn as SVG strings (no DOM, so the node
   tests load this file too). Each drill in js/tips.js has an `art` spec: a scene, the props that stay
   on screen, and 2–4 frames. The page shows the frames as a strip and plays them as an animation;
   swing and posture scenes move smoothly from one position to the next. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DrillArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W = 240, H = 200;   // view box
  var GY = 176;           // ground line
  var CX = 120;           // the golfer's centre line

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function r1(v) { return Math.round(v * 10) / 10; }
  function rad(d) { return d * Math.PI / 180; }
  // Direction for an angle measured from straight down; positive turns toward the trail side (left).
  function dir(deg) { var a = rad(deg); return [-Math.sin(a), Math.cos(a)]; }
  function at(p, v, s) { return [p[0] + v[0] * s, p[1] + v[1] * s]; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function dist(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); }
  function pt(p) { return r1(p[0]) + ' ' + r1(p[1]); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ln(cls, a, b) { return '<line class="' + cls + '" x1="' + r1(a[0]) + '" y1="' + r1(a[1]) + '" x2="' + r1(b[0]) + '" y2="' + r1(b[1]) + '"/>'; }
  function path(cls, pts, close) { return '<path class="' + cls + '" d="M' + pts.map(pt).join('L') + (close ? 'Z' : '') + '"/>'; }
  function dot(cls, c, r) { return '<circle class="' + cls + '" cx="' + r1(c[0]) + '" cy="' + r1(c[1]) + '" r="' + r1(r) + '"/>'; }
  function rect(cls, x, y, w, h, rx) { return '<rect class="' + cls + '" x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" rx="' + r1(rx || 0) + '"/>'; }
  function oval(cls, c, rx, ry, rot) {
    return '<ellipse class="' + cls + '" cx="' + r1(c[0]) + '" cy="' + r1(c[1]) + '" rx="' + r1(rx) + '" ry="' + r1(ry) + '"' + (rot ? ' transform="rotate(' + r1(rot) + ' ' + r1(c[0]) + ' ' + r1(c[1]) + ')"' : '') + '/>';
  }
  function curve(cls, a, c, b) { return '<path class="' + cls + '" d="M' + pt(a) + 'Q' + pt(c) + ' ' + pt(b) + '"/>'; }
  // Labels are drawn only on the big stage; the small frames in the strip have no text.
  function label(o, s, x, y, anchor) {
    return o.thumb ? '' : '<text class="da-t" x="' + r1(x) + '" y="' + r1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + esc(s) + '</text>';
  }
  function badge(o, s, x, y, w) {
    w = w || 52;
    return rect('da-badge', x, y, w, 28, 14) + (o.thumb ? '' : '<text class="da-bt" x="' + r1(x + w / 2) + '" y="' + r1(y + 19.5) + '" text-anchor="middle">' + esc(s) + '</text>');
  }
  function arrowHead(cls, tip, from, size) {
    var dx = tip[0] - from[0], dy = tip[1] - from[1], d = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / d, uy = dy / d, s = size || 7;
    return path(cls, [[tip[0] - ux * s - uy * s * 0.6, tip[1] - uy * s + ux * s * 0.6], tip, [tip[0] - ux * s + uy * s * 0.6, tip[1] - uy * s - ux * s * 0.6]]);
  }
  function arrow(cls, a, b) { return ln(cls, a, b) + arrowHead(cls, b, a); }

  // ---------------------------------------------------------------------------
  // Swing scene: a golfer seen face-on (the target is to the right)
  // ---------------------------------------------------------------------------
  // th: hands' angle around the chest; cl: club angle (both from straight down, + toward the trail side);
  // hip: pelvis shift toward the target; tilt: spine tilt away from the target; turn: how square the
  // shoulders are to the camera (1 = square); sTilt: shoulder tilt (+ = lead shoulder lower);
  // kneeT: trail knee kicking in; heel: trail heel lift; aim: point the club at the ball;
  // toe: draw the clubhead toe up; reach: hands' distance from the chest; drop: lower the body.
  var BASE = { th: -4, cl: 4, hip: 0, tilt: 6, turn: 1, sTilt: 4, kneeT: 0, heel: 0, headX: 0, reach: 44, drop: 0 };
  var POSES = {
    address: { aim: true },
    halfBack: { th: 47, cl: 92, hip: -2, tilt: 7, turn: 0.72, sTilt: 9, toe: true },
    threeQ: { th: 106, cl: 196, hip: -3, tilt: 8, turn: 0.55, sTilt: 12 },
    top: { th: 140, cl: 262, hip: -3, tilt: 9, turn: 0.42, sTilt: 14 },
    impact: { th: -11, aim: true, hip: 7, tilt: 12, turn: 0.86, sTilt: 9, kneeT: 6 },
    halfThru: { th: -48, cl: -92, hip: 10, tilt: 8, turn: 0.62, sTilt: -2, kneeT: 10, heel: 3, toe: true },
    finish: { th: -150, cl: -290, hip: 14, tilt: -3, turn: 0.38, sTilt: -12, kneeT: 18, heel: 9, headX: 4 },
    punchBack: { th: 46, cl: 118, hip: -1, tilt: 7, turn: 0.78, sTilt: 7 },
    punchThru: { th: -58, cl: -84, hip: 11, tilt: 7, turn: 0.6, sTilt: -3, kneeT: 10, heel: 3 },
    putt: { aim: true, tilt: 3, sTilt: 2, reach: 50, drop: 6 },
    puttBack: { th: 15, cl: 15, tilt: 3, sTilt: 4, reach: 50, drop: 6 },
    puttThru: { th: -17, cl: -17, tilt: 3, sTilt: 0, reach: 50, drop: 6 },
    chipBack: { th: 30, cl: 48, tilt: 5, turn: 0.86, sTilt: 6, hip: 2 },
    chipThru: { th: -34, cl: -40, hip: 6, tilt: 4, turn: 0.75, sTilt: 1, kneeT: 6 },
    stand: { arms: 'side', tilt: 0, sTilt: 0, turn: 1 },
    crossAddr: { arms: 'cross' },
    crossBack: { arms: 'cross', turn: 0.36, sTilt: 17, tilt: 7, hip: -2 },
    crossThru: { arms: 'cross', turn: 0.36, sTilt: -15, tilt: -2, hip: 11, kneeT: 15, heel: 7 }
  };
  function poseOf(name) {
    var p = {}, k, src = POSES[name] || {};
    for (k in BASE) p[k] = BASE[k];
    for (k in src) p[k] = src[k];
    return p;
  }

  var CLUBS = {
    wedge: { ball: 0, head: 'blade' }, iron: { ball: 3, head: 'blade' }, hybrid: { ball: 9, head: 'hybrid' },
    wood: { ball: 11, head: 'wood' }, driver: { ball: 16, head: 'driver' }, putter: { ball: 4, head: 'putter' },
    none: { ball: 0 }, cross: { ball: 0 }, reversed: { ball: 0 }
  };

  // Body points for a pose.
  function body(p, art) {
    var st = art.stance === 'together' ? 6 : art.stance === 'narrow' ? 15 : 23;
    var P = [CX + p.hip, 99 + p.drop];
    var t = rad(p.tilt), sv = [Math.sin(t), Math.cos(t)];
    var N = [P[0] - 50 * sv[0], P[1] - 50 * sv[1]];
    var Sc = [N[0] + 5 * sv[0], N[1] + 5 * sv[1]];
    var s = rad(p.sTilt), hw = 17 * p.turn;
    var SL = [Sc[0] + hw * Math.cos(s), Sc[1] + hw * Math.sin(s)];
    var ST = [Sc[0] - hw * Math.cos(s), Sc[1] - hw * Math.sin(s)];
    var C = [Sc[0] + 9 * sv[0], Sc[1] + 9 * sv[1]];
    var hipW = 9 * (0.6 + 0.4 * p.turn);
    var HL = [P[0] + hipW, P[1]], HT = [P[0] - hipW, P[1]];
    var FL = [CX + st, GY - 2], FT = [CX - st + p.kneeT * 0.2, GY - 2 - p.heel];
    return {
      P: P, N: N, Sc: Sc, SL: SL, ST: ST, C: C, HL: HL, HT: HT, FL: FL, FT: FT,
      head: [N[0] - 13 * sv[0] + p.headX, N[1] - 13 * sv[1]],
      KL: [(HL[0] + FL[0]) / 2 - 1.5, (HL[1] + FL[1]) / 2],
      KT: [(HT[0] + FT[0]) / 2 + 1.5 + p.kneeT, (HT[1] + FT[1]) / 2 + p.kneeT * 0.2],
      H: at(C, dir(p.th), p.reach)
    };
  }
  // Where the ball sits and where the clubhead meets it.
  function ballPoint(art) {
    var c = CLUBS[art.club] || CLUBS.iron, b = art.ball || {};
    var lift = b.tee ? 6 : 0;
    var x = CX + c.ball + (b.x || 0);
    return { ball: [x, GY - 4.5 - lift], contact: [x, GY - 1.5 - lift], tee: !!b.tee };
  }
  // The angle that points the club from the hands at the ball.
  function aimAngle(Hp, contact) { var dx = contact[0] - Hp[0], dy = contact[1] - Hp[1]; return Math.atan2(-dx, dy) * 180 / Math.PI; }
  function clubLength(art) {
    if (art._len) return art._len;
    var p = poseOf(art.club === 'putter' ? 'putt' : 'address'), B = body(p, art), c = ballPoint(art).contact;
    art._len = dist(B.H, [c[0] - ({ hybrid: 6, wood: 7, driver: 9 }[art.club] || 2), c[1]]);
    return art._len;
  }
  function resolvePose(p, art) {
    if (p.aim) {
      var c = ballPoint(art).contact, back = p.th > -6 ? ({ hybrid: 6, wood: 7, driver: 9 }[art.club] || 2) : 0;
      p.cl = aimAngle(body(p, art).H, [c[0] - back, c[1]]);
    }
    return p;
  }

  function elbow(a, b, l1, l2, away) {
    var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.sqrt(dx * dx + dy * dy) || 0.001;
    var dd = Math.min(d, l1 + l2 - 0.01);
    var ang = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd))));
    var base = Math.atan2(dy, dx);
    var e1 = [a[0] + l1 * Math.cos(base + ang), a[1] + l1 * Math.sin(base + ang)];
    var e2 = [a[0] + l1 * Math.cos(base - ang), a[1] + l1 * Math.sin(base - ang)];
    return dist(e1, away) > dist(e2, away) ? e1 : e2;
  }
  function arm(S, Hp, away) {
    var E = elbow(S, Hp, 25, 25, away);
    return ln('da-sleeve', S, E) + ln('da-limb', E, Hp);
  }
  // A golf cap: crown and a short brim (pointing at the camera face-on, forward side-on).
  function cap(hd, side) {
    var x = hd[0], y = hd[1];
    var crown = '<path class="da-cap" d="M' + pt([x - 11.2, y - 1.5]) + 'A11.2 11.2 0 0 1 ' + pt([x + 11.2, y - 1.5]) + 'Z"/>';
    return crown + (side ? ln('da-brim', [x + 4, y - 2], [x + 17, y - 1]) : ln('da-brim', [x - 13, y - 1.5], [x + 13, y - 1.5]));
  }
  function shoe(F, lifted) {
    return lifted ? oval('da-shoe', [F[0], F[1] - 1], 4, 6.5) : oval('da-shoe', [F[0], F[1] + 0.5], 7.5, 4);
  }
  function clubHead(kind, end, d, toe) {
    var n = [d[1], -d[0]];
    if (n[1] > 0 || (Math.abs(n[1]) < 0.2 && n[0] < 0)) n = [-n[0], -n[1]];  // toe side faces up
    if (kind === 'putter') return ln('da-head da-thick', at(end, [1, 0], -7), at(end, [1, 0], 7));
    if (kind === 'blade') {
      return toe ? ln('da-head da-thick', end, at(end, n, 11)) : ln('da-head da-thick', at(end, n, -4), at(end, n, 4.5));
    }
    var size = { hybrid: [6.5, 4.2], wood: [7.5, 4.6], driver: [9, 5.6] }[kind] || [6, 4];
    var ang = Math.atan2(n[1], n[0]) * 180 / Math.PI;
    return oval('da-head', toe ? at(end, n, size[0] - 1) : end, size[0], size[1], ang);
  }
  function drawClub(p, art, B) {
    var kind = art.club || 'iron', o = [];
    if (kind === 'none' || p.arms) return '';
    var d = dir(p.cl), len = clubLength(art), choke = p.choke || 0;
    var Hp = B.H;
    if (kind === 'reversed') {
      var far = at(Hp, d, len);
      o.push(ln('da-shaft', at(Hp, d, -5), far), ln('da-grip', at(Hp, d, len - 15), far));
      o.push(oval('da-head', at(Hp, d, -8), 6, 3.6, Math.atan2(d[1], d[0]) * 180 / Math.PI + 90));
      return o.join('');
    }
    var butt = at(Hp, d, -(6 + choke)), end = at(Hp, d, len);
    o.push(ln('da-shaft', Hp, end), ln('da-grip', butt, at(butt, d, 15)));
    o.push(clubHead((CLUBS[kind] || CLUBS.iron).head, end, d, p.toe));
    return o.join('');
  }
  function drawFigure(p, art) {
    var B = body(p, art), o = [];
    var behind = !p.arms && at(B.H, dir(p.cl), clubLength(art))[1] < B.Sc[1] + 4;
    if (behind) o.push(drawClub(p, art, B));
    o.push(path('da-leg', [B.HT, B.KT, B.FT]), path('da-leg', [B.HL, B.KL, B.FL]));
    o.push(shoe(B.FT, p.heel > 4), shoe(B.FL, false));
    o.push(path('da-shirt', [B.ST, B.SL, B.HL, B.HT], true));
    o.push(ln('da-neck', B.Sc, B.N), dot('da-skin', B.head, 11), cap(B.head, 0));
    if (p.arms === 'side') {
      o.push(arm(B.SL, [B.SL[0] + 4, B.SL[1] + 49], [B.C[0] - 30, B.C[1]]), arm(B.ST, [B.ST[0] - 4, B.ST[1] + 49], [B.C[0] + 30, B.C[1]]));
      o.push(dot('da-skin', [B.SL[0] + 4, B.SL[1] + 50], 4.5), dot('da-skin', [B.ST[0] - 4, B.ST[1] + 50], 4.5));
      return { svg: o.join(''), B: B };
    }
    if (p.arms === 'cross') {
      var u = [B.SL[0] - B.ST[0], B.SL[1] - B.ST[1]], ul = Math.sqrt(u[0] * u[0] + u[1] * u[1]) || 1;
      u = [u[0] / ul, u[1] / ul];
      var down = [Math.sin(rad(p.tilt)) * 0 , 1];
      var a = at(at(B.ST, u, -13), down, 7), b = at(at(B.SL, u, 13), down, 7);
      o.push(ln('da-across', a, b));
      var hl = at(B.ST, down, 8), ht = at(B.SL, down, 8);
      o.push(path('da-sleeve', [B.SL, [B.C[0] + 2, B.C[1] + 12], hl]), path('da-sleeve', [B.ST, [B.C[0] - 2, B.C[1] + 14], ht]));
      o.push(dot('da-skin', hl, 4.5), dot('da-skin', ht, 4.5));
      return { svg: o.join(''), B: B };
    }
    if (!behind) o.push(drawClub(p, art, B));
    o.push(arm(B.ST, B.H, B.P), arm(B.SL, B.H, B.P));
    o.push(dot('da-skin', B.H, 4.8));
    if (art.split) o.push(dot('da-skin', at(B.H, dir(p.cl), 11), 4.8));
    return { svg: o.join(''), B: B };
  }

  function ground() {
    return rect('da-ground', 0, GY, W, H - GY) + ln('da-gline', [0, GY], [W, GY]);
  }
  // Props that sit on the ground, under the golfer.
  function propsUnder(names, art, bp) {
    var o = [], x = bp.ball[0];
    names.forEach(function (n) {
      if (n === 'towel') {
        o.push(rect('da-towel', x - 37, GY - 3, 25, 7, 2.5), ln('da-towel2', [x - 31, GY - 2], [x - 31, GY + 3]), ln('da-towel2', [x - 18, GY - 2], [x - 18, GY + 3]));
      } else if (n === 'line') {
        o.push(ln('da-paint', [x - 7, GY - 4], [x - 12, GY + 20]));
      } else if (n === 'sticks') {
        o.push(ln('da-stick da-stick1', [52, GY + 5], [188, GY + 5]), ln('da-stick da-stick2', [64, GY + 17], [204, GY + 17]));
      } else if (n === 'gate') {
        o.push(tee([x + 66, GY - 1]), tee([x + 66, GY + 12]));
      } else if (n === 'target') {
        o.push(ln('da-pole', [226, 104], [226, GY - 2]), path('da-flag', [[226, 104], [212, 109], [226, 114]], true));
      } else if (n === 'mirror') {
        o.push(rect('da-mirror', 188, 30, 44, 140, 8), ln('da-glint', [200, 60], [214, 46]), ln('da-glint', [200, 76], [222, 54]));
      }
    });
    return o.join('');
  }
  function tee(top) {
    return path('da-tee', [[top[0] - 3.2, top[1] - 1], [top[0] + 3.2, top[1] - 1], [top[0] + 1.1, top[1] + 2.5], [top[0] + 0.7, top[1] + 9], [top[0] - 0.7, top[1] + 9], [top[0] - 1.1, top[1] + 2.5]], true);
  }
  // Marks that point at something in this frame.
  function marks(list, o, B, p, art, bp) {
    var out = [], x = bp.ball[0];
    (list || []).forEach(function (m) {
      var k = typeof m === 'string' ? m : m[0], v = typeof m === 'string' ? '' : m[1];
      if (k === 'gap') { out.push(arrow('da-mark', [x - 12, GY + 11], [x - 4, GY + 11]), label(o, v || '4–6 in', x - 16, GY + 21, 'end')); }
      else if (k === 'brush') { out.push(curve('da-brush', [x + 2, GY + 1], [x + 10, GY + 5], [x + 21, GY + 2])); }
      else if (k === 'divot') { out.push(curve('da-brush', [x + 2, GY + 1], [x + 12, GY + 6], [x + 24, GY + 2])); }
      else if (k === 'handsAhead') { out.push('<path class="da-guide" d="M' + pt(B.H) + 'L' + pt([B.H[0], GY + 14]) + '"/>', label(o, v || 'hands ahead', B.H[0] - 12, B.H[1] + 30, 'end')); }
      else if (k === 'toeUp') { var e = at(B.H, dir(p.cl), clubLength(art)); out.push(e[0] < CX ? label(o, 'toe up', Math.max(4, e[0] - 4), e[1] - 18) : label(o, 'toe up', Math.min(236, e[0] + 4), e[1] - 18, 'end')); }
      else if (k === 'timer') { out.push(badge(o, v || '3 s', 182, 10)); }
      else if (k === 'flightLow') { out.push(curve('da-flight', bp.ball, [x + 60, GY - 46], [236, GY - 40])); }
      else if (k === 'flight') { out.push(curve('da-flight', bp.ball, [x + 54, 10], [236, 40])); }
      else if (k === 'startLine') { out.push('<path class="da-flight" d="M' + pt(bp.ball) + 'L' + pt([236, GY + 7]) + '"/>', label(o, v || '3 ft', x + 66, GY - 18, 'middle')); }
      else if (k === 'whoosh') {
        [10, 18, 26].forEach(function (r) { out.push('<path class="da-wave" d="M' + pt([x + 34 + r, GY - 30 - r * 0.7]) + 'Q' + pt([x + 46 + r, GY - 18]) + ' ' + pt([x + 34 + r, GY - 6 + r * 0.2]) + '"/>'); });
        out.push(label(o, 'whoosh!', x + 70, GY - 52, 'middle'));
      }
      else if (k === 'armTowels') { out.push(rect('da-towel', B.SL[0] - 6, B.SL[1] + 2, 10, 14, 2.5), rect('da-towel', B.ST[0] - 4, B.ST[1] + 2, 10, 14, 2.5)); }
      else if (k === 'chin') { out.push(dot('da-ring', B.SL, 7), label(o, v || 'under chin', 34, 40)); }
      else if (k === 'chest') { out.push(arrow('da-mark', [B.Sc[0] + 18, B.Sc[1] + 18], [222, B.Sc[1] + 18]), label(o, 'target', 206, B.Sc[1] + 8, 'middle')); }
      else if (k === 'weight') { out.push(arrow('da-mark', [B.FL[0] + 34, GY - 46], [B.FL[0] + 8, GY - 14]), label(o, v || 'weight here', 236, GY - 54, 'end')); }
      else if (k === 'measure') {
        var hy = B.SL[1] + 50;
        out.push(ln('da-dim', [186, hy], [186, GY - 2]), arrowHead('da-dim', [186, hy], [186, hy + 10]), arrowHead('da-dim', [186, GY - 2], [186, GY - 12]));
        out.push(ln('da-guide', [B.SL[0] + 10, hy], [192, hy]), label(o, 'measure', 236, hy - 10, 'end'));
      }
      else if (k === 'tooLong') { var e2 = at(B.H, dir(p.cl), clubLength(art)); out.push(dot('da-ring', [e2[0] + 4, e2[1] - 2], 11), label(o, 'toe up', e2[0] + 22, e2[1] - 18)); }
      else if (k === 'choke') { out.push(arrow('da-mark', [B.H[0] + 26, B.H[1] - 20], [B.H[0] + 8, B.H[1] - 6]), label(o, v || '1 in down', B.H[0] + 28, B.H[1] - 24)); }
      else if (k === 'hold') { out.push(badge(o, v || 'hold', 176, 10, 60)); }
    });
    return out.join('');
  }
  function swingScene(art, frame, o, pose) {
    var p = resolvePose(pose || poseOf(frame.pose), art), bp = ballPoint(art);
    if (p.choke == null) p.choke = frame.choke != null ? frame.choke : art.choke || 0;
    var props = (art.props || []).concat(frame.props || []);
    var fig = drawFigure(p, art);
    var out = [ground(), propsUnder(props, art, bp)];
    if (art.club !== 'none' && art.club !== 'cross' && !p.arms && art.ballShown !== false && frame.ball !== false) {
      if (bp.tee) out.push(tee([bp.ball[0], GY - 7]));
      out.push(dot('da-ball', bp.ball, 4.5));
    }
    out.push(fig.svg, marks(frame.marks, o, fig.B, p, art, bp));
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // Posture scene: a golfer seen side-on (facing right, the ball on the right)
  // ---------------------------------------------------------------------------
  var SIDE = {
    tall: { ankle: [106, 174], knee: [106, 137], hip: [106, 99], sh: [108, 51], head: [110, 33], el: [109, 77], hand: [111, 101] },
    hinge: { ankle: [110, 174], knee: [114, 139], hip: [94, 103], sh: [128, 65], head: [141, 51], el: [130, 90], hand: [131, 115] },
    knees: { ankle: [110, 174], knee: [119, 141], hip: [96, 107], sh: [130, 69], head: [143, 55], el: [132, 94], hand: [133, 119] }
  };
  function sidePose(name) { return SIDE[name] || SIDE.tall; }
  function mixSide(a, b, t) {
    var out = {};
    Object.keys(a).forEach(function (k) { out[k] = [mix(a[k][0], b[k][0], t), mix(a[k][1], b[k][1], t)]; });
    return out;
  }
  function sideScene(art, frame, o, pose) {
    var s = pose || sidePose(frame.pose), out = [ground()];
    var hasClub = (frame.club != null ? frame.club : art.club) !== 'none';
    var ballX = 182;
    if (hasClub) out.push(dot('da-ball', [ballX, GY - 4.5], 4.5));
    out.push(path('da-leg', [s.hip, s.knee, s.ankle]), ln('da-shoe da-thick', [s.ankle[0] - 3, GY - 2], [s.ankle[0] + 13, GY - 2]));
    out.push(ln('da-torso', s.hip, s.sh), dot('da-skin', s.head, 11), cap(s.head, 1));
    if (hasClub) out.push(ln('da-shaft', s.hand, [ballX - 4, GY - 2]), ln('da-grip', at(s.hand, [-(ballX - 4 - s.hand[0]), -(GY - 2 - s.hand[1])], 0.1), s.hand), ln('da-head da-thick', [ballX - 10, GY - 1.5], [ballX, GY - 1.5]));
    out.push(ln('da-sleeve', s.sh, s.el), ln('da-limb', s.el, s.hand), dot('da-skin', s.hand, 4.8));
    (frame.marks || []).forEach(function (m) {
      var k = typeof m === 'string' ? m : m[0];
      if (k === 'spine') out.push('<path class="da-guide" d="M' + pt(at(s.hip, [s.sh[0] - s.hip[0], s.sh[1] - s.hip[1]], -0.25)) + 'L' + pt(at(s.hip, [s.sh[0] - s.hip[0], s.sh[1] - s.hip[1]], 1.35)) + '"/>', label(o, 'flat back', 30, 60));
      else if (k === 'plumb') out.push('<path class="da-guide" d="M' + pt(s.sh) + 'L' + pt([s.sh[0], GY - 2]) + '"/>', label(o, 'arms hang', s.sh[0] + 12, s.sh[1] - 12));
      else if (k === 'hips') out.push(dot('da-ring', s.hip, 9), label(o, 'hinge', s.hip[0] - 14, s.hip[1] + 6, 'end'));
      else if (k === 'knees') out.push(dot('da-ring', s.knee, 8), label(o, 'soft knees', s.knee[0] + 14, s.knee[1] + 6));
      else if (k === 'tall') out.push(arrow('da-mark', [72, 120], [72, 40]), label(o, 'stand tall', 20, 30));
      else if (k === 'phone') out.push(rect('da-phone', 200, 74, 30, 52, 6), dot('da-lens', [215, 84], 3.5));
    });
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // Stance from above: where the ball goes for each club
  // ---------------------------------------------------------------------------
  var STANCE_BALLS = { wedge: [120, 'Wedge'], mid: [129, '7 iron'], hybrid: [137, 'Hybrid'], driver: [145, 'Driver'] };
  function stanceScene(art, frame, o) {
    var out = [rect('da-mat', 14, 20, 212, 168, 14)];
    out.push(oval('da-foot', [92, 140], 11, 23, -4), oval('da-foot', [152, 140], 11, 23, 14));
    out.push(ln('da-tline', [24, 88], [216, 88]), arrowHead('da-tline', [222, 88], [210, 88]));
    var hi = STANCE_BALLS[frame.ball] || STANCE_BALLS.wedge;
    Object.keys(STANCE_BALLS).forEach(function (k) {
      var b = STANCE_BALLS[k];
      if (b !== hi) out.push(dot('da-ghost', [b[0], 88], 4.5));
    });
    out.push(ln('da-paint', [hi[0], 96], [hi[0], 164]), dot('da-ball', [hi[0], 88], 5.5), label(o, hi[1], hi[0], 70, 'middle'));
    out.push(label(o, 'target', 222, 78, 'end'));
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // Putting and chipping games from above
  // ---------------------------------------------------------------------------
  function green(holeAt) {
    return oval('da-green', [120, 104], 114, 86) + flagTop(holeAt);
  }
  function flagTop(c) { return dot('da-hole', c, 6) + ln('da-pole', c, [c[0], c[1] - 30]) + path('da-flag', [[c[0], c[1] - 30], [c[0] + 14, c[1] - 25], [c[0], c[1] - 20]], true); }
  function greenScene(art, frame, o) {
    var game = art.game, step = frame.step || 0, out = [];
    if (game === 'ladder') {
      var hole = [210, 112];
      out.push(green(hole));
      [1, 2, 3, 4].forEach(function (k) {
        var tx = hole[0] - 40 * k;
        out.push(tee([tx, hole[1] + 6]));
        if (!o.thumb) out.push(label(o, k === 1 ? '3 ft' : String(k * 3), tx, hole[1] + 38, 'middle'));
      });
      if (step) {
        var bx = hole[0] - 40 * step + 2;
        out.push('<path class="da-flight" d="M' + pt([bx, hole[1]]) + 'L' + pt([hole[0] - 6, hole[1]]) + '"/>', dot('da-ball', [bx, hole[1]], 5));
      }
    } else if (game === 'world') {
      var c = [120, 112];
      out.push(green(c), '<circle class="da-guide" cx="120" cy="112" r="' + (step >= 3 ? 58 : 42) + '"/>');
      for (var i = 0; i < 6; i++) {
        var a = rad(i * 60 + 30), q = [c[0] + 42 * Math.cos(a), c[1] + 42 * Math.sin(a)];
        if (step >= 3) q = [c[0] + 58 * Math.cos(a), c[1] + 58 * Math.sin(a)];
        var made = step === 1 ? i < 2 : step === 2 ? i < 6 : false;
        if (!made) out.push(dot('da-ball', q, 5));
      }
      if (step === 1 || step === 2) out.push(badge(o, step === 1 ? '2 made' : '6 made!', 152, 10, 82));
      if (step >= 3) out.push(label(o, '4 ft', 120, 186, 'middle'));
    } else if (game === 'updown') {
      var hl = [150, 98];
      out.push(green(hl));
      var spots = [[34, 132], [60, 176], [214, 170], [226, 60], [38, 56]];
      spots.forEach(function (s2, j) { if (!(step >= 2 && j === 0)) out.push(dot('da-ball', s2, 5)); });
      if (step >= 1) out.push(curve('da-flight', spots[0], [80, 60], [134, 104]));
      if (step === 1) out.push(dot('da-ball', [134, 104], 5));
      if (step >= 2) out.push('<path class="da-flight" d="M' + pt([134, 104]) + 'L' + pt([hl[0] - 5, hl[1] + 2]) + '"/>');
      if (step >= 3) out.push(badge(o, '2 shots', 158, 10, 76));
    } else if (game === 'closest') {
      var fl = [120, 100];
      out.push(green(fl));
      var balls = [[96, 132], [158, 74], [134, 112]];
      balls.forEach(function (b, j) {
        out.push(dot('da-ball', b, 5.5));
        if (!o.thumb) out.push('<text class="da-n" x="' + r1(b[0]) + '" y="' + r1(b[1] + 22) + '" text-anchor="middle">' + (j + 1) + '</text>');
      });
      if (step >= 1) balls.forEach(function (b) { out.push('<path class="da-guide" d="M' + pt(b) + 'L' + pt(fl) + '"/>'); });
      if (step >= 2) out.push(dot('da-ring', balls[2], 10), badge(o, '+1 point', 152, 10, 82));
    }
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // The grip, close up, as the golfer sees it looking down
  // ---------------------------------------------------------------------------
  function handsScene(art, frame, o) {
    var step = frame.step || 0, out = [];
    out.push(rect('da-gripbar', 108, 0, 24, 200, 8));
    // lead hand in a white glove
    out.push('<path class="da-glove" d="M82 50 Q80 34 96 30 L140 28 Q158 28 158 46 L154 100 Q152 114 138 116 L100 116 Q86 114 86 100 Z"/>');
    out.push('<path class="da-fold" d="M86 64 Q92 66 96 62 M86 80 Q92 82 96 78 M87 96 Q93 98 97 94"/>');
    out.push('<path class="da-glove" d="M113 104 L129 102 L128 142 Q121 151 114 142 Z"/>');
    var knuckles = [[102, 33], [117, 30], [132, 30]];
    knuckles.forEach(function (k, i) { out.push(dot(step === 0 || step === 1 ? 'da-knuckle on' : 'da-knuckle', k, 5)); });
    if (step === 0) out.push(label(o, '2–3 knuckles', 120, 20, 'middle'));
    if (step === 1 || step === 2) {
      out.push(path('da-v', [[136, 78], [122, 102], [116, 74]]));
      out.push(arrow('da-mark', [140, 72], [214, 18]), label(o, 'V to back', 228, 46, 'end'), label(o, 'shoulder', 228, 66, 'end'));
    }
    if (step >= 2 && art.trail) {
      out.push('<path class="da-trail" d="M96 120 Q92 106 108 104 L136 106 Q150 108 148 124 L144 168 Q142 180 128 180 L104 178 Q94 176 96 164 Z"/>');
      if (step === 3) out.push(label(o, 'covers thumb', 120, 196, 'middle'));
    }
    if (step === 3 && !art.trail) out.push(label(o, 'light hold', 120, 196, 'middle'));
    if (step === 3 && art.trail) out.push(badge(o, 'firm, not tight', 6, 8, 128));
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // The range, side-on: how far each club carries
  // ---------------------------------------------------------------------------
  function rangeScene(art, frame, o) {
    var flags = art.flags || [['PW', 0.36], ['7i', 0.62], ['5hy', 0.9]], step = frame.step == null ? flags.length : frame.step;
    var out = [rect('da-ground', 0, 166, W, H - 166), ln('da-gline', [0, 166], [W, 166])];
    var tee0 = [14, 164];
    out.push(dot('da-ball', tee0, 4));
    flags.forEach(function (f, i) {
      var x = 24 + f[1] * 206, show = i < step;
      out.push(ln('da-pole', [x, 166], [x, 126]), path('da-flag', [[x, 126], [x + 13, 131], [x, 136]], true));
      if (show) {
        out.push(curve('da-flight', tee0, [(tee0[0] + x) / 2, 166 - 70 - f[1] * 90], [x - 4, 166]));
        var half = f[0].length * 5.4;
        out.push(label(o, f[0], Math.max(half + 2, Math.min(W - 2 - half, x)), 188, 'middle'));
      }
    });
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // The tracker: the range screen, a phone photo, then a text to Matthew
  // ---------------------------------------------------------------------------
  function trackerScene(art, frame, o) {
    var step = frame.step || 0, out = [];
    out.push(rect('da-screen', 12, 14, 156, 112, 10), rect('da-scrhead', 12, 14, 156, 32, 10), rect('da-scrhead', 12, 30, 156, 16, 0));
    out.push(label(o, 'All shots', 26, 37));
    var rows = step === 0 ? 3 : 7;
    for (var i = 0; i < rows; i++) out.push(ln(step >= 1 ? 'da-row on' : 'da-row', [26, 54 + i * 10], [154, 54 + i * 10]));
    if (step === 0) out.push(badge(o, art.shots || '5–10 shots', 90, 136, 96));
    if (step >= 2) {
      out.push(rect('da-phone', 150, 62, 74, 126, 12), rect('da-phonescreen', 156, 72, 62, 92, 4));
      out.push(path('da-bracket', [[160, 84], [160, 78], [166, 78]]), path('da-bracket', [[208, 78], [214, 78], [214, 84]]), path('da-bracket', [[160, 152], [160, 158], [166, 158]]), path('da-bracket', [[208, 158], [214, 158], [214, 152]]));
      for (var j = 0; j < 5; j++) out.push(ln('da-row on', [166, 96 + j * 11], [208, 96 + j * 11]));
      out.push(dot('da-shutter', [187, 176], 6));
    }
    if (step >= 3) {
      out.push('<path class="da-bubble" d="M18 140 h112 a12 12 0 0 1 12 12 v16 a12 12 0 0 1 -12 12 h-96 l-12 10 v-10 a12 12 0 0 1 -4 -10 v-18 a12 12 0 0 1 0 -12 z"/>');
      out.push(label(o, 'To Matthew', 76, 166, 'middle'));
    }
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // A practice plan: blocks of balls or minutes, one lit up per frame
  // ---------------------------------------------------------------------------
  function planScene(art, frame, o) {
    var blocks = art.blocks || [], step = frame.step || 0, out = [];
    var total = blocks.reduce(function (a, b) { return a + b[1]; }, 0) || 1, x = 12, wAll = 216;
    blocks.forEach(function (b, i) {
      var w = Math.max(18, wAll * b[1] / total) - 3;
      out.push(rect(i === step ? 'da-seg on' : 'da-seg', x, 150, w, 28, 6));
      x += w + 3;
    });
    var cur = blocks[step] || ['', 0];
    if (!o.thumb) {
      out.push('<text class="da-big" x="120" y="92" text-anchor="middle">' + esc(cur[2] || String(cur[1])) + '</text>');
      out.push(label(o, cur[0], 120, 126, 'middle'));
    } else {
      out.push(rect('da-seg on', 84, 60, 72, 40, 10));
    }
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // Chipping HORSE: a chip to the hole, then letters
  // ---------------------------------------------------------------------------
  function horseScene(art, frame, o) {
    var step = frame.step || 0, out = [], letters = 'HORSE';
    out.push(oval('da-green', [150, 160], 108, 40));
    var hole = [170, 160];
    out.push(dot('da-hole', hole, 5), ln('da-pole', hole, [hole[0], 118]), path('da-flag', [[hole[0], 118], [hole[0] + 13, 123], [hole[0], 128]], true));
    if (step >= 1) out.push(curve('da-flight', [22, 168], [70, 96], [150, 162]), dot('da-ball', [152, 162], 4.5), '<circle class="da-guide" cx="170" cy="160" r="26"/>');
    if (step === 0) out.push(dot('da-ball', [22, 168], 4.5));
    for (var i = 0; i < 5; i++) {
      var on = step >= 3 ? i < 2 : step === 2 ? i < 1 : false;
      out.push(rect(on ? 'da-letter on' : 'da-letter', 22 + i * 40, 18, 34, 40, 8));
      if (!o.thumb) out.push('<text class="' + (on ? 'da-lt on' : 'da-lt') + '" x="' + (39 + i * 40) + '" y="46" text-anchor="middle">' + letters[i] + '</text>');
    }
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // Club check: measure, look at the grips, ask a fitter
  // ---------------------------------------------------------------------------
  function gripScene(art, frame, o) {
    var out = [rect('da-gripbar', 30, 86, 180, 28, 12)];
    out.push(ln('da-shaft', [210, 100], [236, 100]));
    if (frame.worn) {
      [[60, 96, 24], [104, 92, 30], [150, 98, 20]].forEach(function (s) { out.push(rect('da-worn', s[0], s[1], s[2], 8, 4)); });
      out.push(label(o, 'shiny = worn', 120, 70, 'middle'), label(o, 'regrip it', 120, 146, 'middle'));
    } else {
      out.push(label(o, 'new grip', 120, 70, 'middle'));
    }
    return out.join('');
  }

  var SCENES = { swing: swingScene, side: sideScene, stance: stanceScene, green: greenScene, hands: handsScene, range: rangeScene, tracker: trackerScene, plan: planScene, horse: horseScene, grip: gripScene };

  function frameScene(art, frame) { return frame.scene || art.scene; }
  function wrap(inner, o) {
    return '<svg class="da' + (o.thumb ? ' da-th' : '') + '" viewBox="0 0 ' + W + ' ' + H + '"' + (o.label ? ' role="img" aria-label="' + esc(o.label) + '"' : ' aria-hidden="true"') + '>' + inner + '</svg>';
  }
  // One frame of a drill, as an SVG string.
  function render(art, i, o) {
    o = o || {};
    var frame = art.frames[Math.max(0, Math.min(art.frames.length - 1, i))];
    var scene = SCENES[frameScene(art, frame)];
    return wrap(scene ? scene(art, frame, o) : '', o);
  }
  function unwrapNear(a, b) { while (b - a > 180) b -= 360; while (b - a < -180) b += 360; return b; }
  // A frame part way between two frames (t from 0 to 1). Swing and posture scenes move; others cut.
  function tween(art, from, to, t, o) {
    o = o || {};
    var fa = art.frames[from], fb = art.frames[to], sa = frameScene(art, fa), sb = frameScene(art, fb);
    if (t >= 1 || sa !== sb || (sa !== 'swing' && sa !== 'side')) return render(art, t < 0.5 ? from : to, o);
    var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    if (sa === 'side') return wrap(sideScene(art, fb, { thumb: true }, mixSide(sidePose(fa.pose), sidePose(fb.pose), e)), o);
    var pa = resolvePose(poseOf(fa.pose), art), pb = resolvePose(poseOf(fb.pose), art), p = {};
    Object.keys(BASE).forEach(function (k) { p[k] = mix(pa[k], pb[k], e); });
    p.th = mix(pa.th, unwrapNear(pa.th, pb.th), e);
    p.cl = mix(pa.cl, unwrapNear(pa.cl, pb.cl), e);
    p.arms = e < 0.5 ? pa.arms : pb.arms;
    p.toe = e > 0.85 ? pb.toe : e < 0.15 ? pa.toe : false;
    p.choke = mix(fa.choke != null ? fa.choke : art.choke || 0, fb.choke != null ? fb.choke : art.choke || 0, e);
    return wrap(swingScene(art, { pose: fb.pose, props: fb.props, marks: [] }, o, p), o);
  }
  // Problems with an art spec (used by the tests).
  function validate(art) {
    var errs = [];
    if (!art || !SCENES[art.scene]) return ['unknown scene ' + (art && art.scene)];
    if (!Array.isArray(art.frames) || art.frames.length < 2 || art.frames.length > 4) errs.push('needs 2–4 frames');
    (art.frames || []).forEach(function (f, i) {
      var sc = frameScene(art, f);
      if (!SCENES[sc]) errs.push('frame ' + (i + 1) + ': unknown scene ' + sc);
      if (!f.cap || f.cap.length > 60) errs.push('frame ' + (i + 1) + ': caption missing or over 60 characters');
      if (sc === 'swing' && !POSES[f.pose]) errs.push('frame ' + (i + 1) + ': unknown pose ' + f.pose);
      if (sc === 'side' && !SIDE[f.pose]) errs.push('frame ' + (i + 1) + ': unknown side pose ' + f.pose);
    });
    if (art.club && !CLUBS[art.club]) errs.push('unknown club ' + art.club);
    return errs;
  }
  function moves(art) { return art.frames.some(function (f) { var s = frameScene(art, f); return s === 'swing' || s === 'side'; }); }

  return { render: render, tween: tween, validate: validate, moves: moves, POSES: POSES, SIDE: SIDE, SCENES: Object.keys(SCENES) };
});
