/* KH Golf: swing reviews. Frames pulled from a swing video, with markup drawn on them (lines, arrows,
   circles, angles) and numbered notes. Coordinates are pixels in the frame image (x right, y down).
   No DOM here, so the node tests and scripts/check-data.js use this file too. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SwingReview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // What each colour means. Problems are orange, fixes green, good things blue, guides white.
  var KINDS = { issue: 'Problem', fix: 'Fix', good: 'Good', ref: 'Guide' };
  var MARKS = ['line', 'arrow', 'circle', 'box', 'angle', 'path', 'dot'];
  var VIEWS = { 'face-on': 'Face-on', 'down-the-line': 'Down the line' };

  function r1(v) { return Math.round(v * 10) / 10; }
  function pt(p) { return r1(p[0]) + ' ' + r1(p[1]); }
  function isPt(p) { return Array.isArray(p) && p.length === 2 && isFinite(p[0]) && isFinite(p[1]); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Each shape is drawn twice: a dark halo underneath, then the colour, so it shows on any background.
  function twice(shape, kind, dash, fill) {
    var f = fill ? ' rv-fill' : '';
    return '<g class="rv-m ' + kind + (dash ? ' dash' : '') + '">' + shape.replace('/>', ' class="rv-halo' + f + '"/>') + shape.replace('/>', ' class="rv-ink' + f + '"/>') + '</g>';
  }
  function arrowHead(tip, from, s) {
    var dx = tip[0] - from[0], dy = tip[1] - from[1], l = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / l, uy = dy / l;
    return '<path d="M' + pt([tip[0] - ux * s - uy * s * 0.62, tip[1] - uy * s + ux * s * 0.62]) + 'L' + pt(tip) + 'L' + pt([tip[0] - ux * s + uy * s * 0.62, tip[1] - uy * s - ux * s * 0.62]) + '"/>';
  }
  function angleOf(v, a) { return Math.atan2(a[1] - v[1], a[0] - v[0]); }
  // The angle between two rays from a vertex, in whole degrees.
  function degrees(m) {
    var a1 = angleOf(m.vertex, m.a), a2 = angleOf(m.vertex, m.b), d = Math.abs(a1 - a2) * 180 / Math.PI;
    return Math.round(d > 180 ? 360 - d : d);
  }
  // Where a mark's number pin goes when the mark doesn't say.
  function anchor(m) {
    if (isPt(m.pin)) return m.pin;
    if (m.type === 'circle' || m.type === 'dot') return [m.at[0] + (m.r || 0) * 0.72, m.at[1] - (m.r || 0) * 0.72];
    if (m.type === 'angle') return m.vertex;
    if (m.type === 'path') return m.points[0];
    if (m.type === 'box') return [Math.min(m.from[0], m.to[0]), Math.min(m.from[1], m.to[1])];
    return m.from;
  }
  function shape(m, u) {
    var out = '';
    if (m.type === 'line') out = '<line x1="' + r1(m.from[0]) + '" y1="' + r1(m.from[1]) + '" x2="' + r1(m.to[0]) + '" y2="' + r1(m.to[1]) + '"/>';
    else if (m.type === 'arrow') out = '<line x1="' + r1(m.from[0]) + '" y1="' + r1(m.from[1]) + '" x2="' + r1(m.to[0]) + '" y2="' + r1(m.to[1]) + '"/>' + arrowHead(m.to, m.from, 7 * u);
    else if (m.type === 'circle') out = '<circle cx="' + r1(m.at[0]) + '" cy="' + r1(m.at[1]) + '" r="' + r1(m.r) + '"/>';
    else if (m.type === 'dot') out = '<circle cx="' + r1(m.at[0]) + '" cy="' + r1(m.at[1]) + '" r="' + r1(m.r || 4 * u) + '"/>';
    else if (m.type === 'box') {
      var x = Math.min(m.from[0], m.to[0]), y = Math.min(m.from[1], m.to[1]);
      out = '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(Math.abs(m.to[0] - m.from[0])) + '" height="' + r1(Math.abs(m.to[1] - m.from[1])) + '" rx="' + r1(6 * u) + '"/>';
    } else if (m.type === 'path') out = '<polyline points="' + m.points.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' ') + '"/>';
    else if (m.type === 'angle') {
      var a1 = angleOf(m.vertex, m.a), a2 = angleOf(m.vertex, m.b), rr = 22 * u;
      var p1 = [m.vertex[0] + rr * Math.cos(a1), m.vertex[1] + rr * Math.sin(a1)], p2 = [m.vertex[0] + rr * Math.cos(a2), m.vertex[1] + rr * Math.sin(a2)];
      var sweep = ((a2 - a1 + 2 * Math.PI) % (2 * Math.PI)) < Math.PI ? 1 : 0;
      out = '<line x1="' + r1(m.vertex[0]) + '" y1="' + r1(m.vertex[1]) + '" x2="' + r1(m.a[0]) + '" y2="' + r1(m.a[1]) + '"/>' +
        '<line x1="' + r1(m.vertex[0]) + '" y1="' + r1(m.vertex[1]) + '" x2="' + r1(m.b[0]) + '" y2="' + r1(m.b[1]) + '"/>' +
        '<path d="M' + pt(p1) + 'A' + r1(rr) + ' ' + r1(rr) + ' 0 0 ' + sweep + ' ' + pt(p2) + '"/>';
    }
    return out;
  }
  // The markup for one frame: an SVG of the shapes, plus number pins and labels for the page to place
  // (in percent of the frame, so they stay a readable size on any screen).
  function markup(frame) {
    var w = frame.w, h = frame.h, u = w / 360, marks = frame.marks || [], pins = [];
    var body = marks.map(function (m) {
      var kind = KINDS[m.kind] ? m.kind : 'ref';
      var s = shape(m, u);
      if (!s) return '';
      if (m.n != null || m.label) {
        var a = anchor(m);
        pins.push({ n: m.n, kind: kind, label: m.label || (m.type === 'angle' && m.showDeg !== false ? degrees(m) + '°' : ''), x: a[0] / w * 100, y: a[1] / h * 100 });
      } else if (m.type === 'angle' && m.showDeg !== false) {
        pins.push({ n: null, kind: kind, label: degrees(m) + '°', x: m.vertex[0] / w * 100, y: m.vertex[1] / h * 100 });
      }
      return s.split(/(?=<(?:line|path|circle|rect|polyline))/).map(function (piece) { return twice(piece, kind, m.dash, m.type === 'dot'); }).join('');
    }).join('');
    var svg = '<svg class="rv-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true" style="--rv-w:' + r1(2.4 * u) + ';--rv-halo:' + r1(5.2 * u) + ';--rv-dash:' + r1(7 * u) + ' ' + r1(5 * u) + '">' + body + '</svg>';
    return { svg: svg, pins: pins };
  }

  // Problems with one review. ctx can supply fileExists(path), drillExists(key) and clubOk(club).
  function validate(r, ctx) {
    ctx = ctx || {};
    var errs = [], warns = [];
    var where = 'swing review ' + (r && r.id ? r.id : '?');
    if (!r || typeof r !== 'object') return { errors: [where + ': must be an object'], warnings: [] };
    if (!/^[\w-]+$/.test(r.id || '')) errs.push(where + ': id must be letters, digits and dashes');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) errs.push(where + ': date must be YYYY-MM-DD');
    if (r.view != null && !VIEWS[r.view]) errs.push(where + ': view must be "face-on" or "down-the-line"');
    if (r.club != null && ctx.clubOk && !ctx.clubOk(r.club)) errs.push(where + ': club "' + r.club + '" isn\'t a standard name');
    if (r.session_id != null && ctx.sessionExists && !ctx.sessionExists(r.session_id)) errs.push(where + ': session_id "' + r.session_id + '" doesn\'t match a session');
    if (!r.summary) warns.push(where + ': no summary');
    if (!Array.isArray(r.frames) || !r.frames.length) errs.push(where + ': needs at least one frame');
    else if (r.frames.length > 8) warns.push(where + ': ' + r.frames.length + ' frames; 4 to 6 is easier to follow');
    (r.frames || []).forEach(function (f, i) {
      var w2 = where + ', frame ' + (i + 1);
      if (!f || typeof f !== 'object') { errs.push(w2 + ': must be an object'); return; }
      if (!f.svg) {
        if (!/^media\/[\w.\/-]+\.(jpe?g|png|webp)$/i.test(f.src || '')) errs.push(w2 + ': src must be an image under media/ (.jpg, .png or .webp)');
        else if (ctx.fileExists && !ctx.fileExists(f.src)) errs.push(w2 + ': ' + f.src + ' doesn\'t exist');
      }
      if (!(f.w > 0 && f.h > 0)) errs.push(w2 + ': w and h (the image size in pixels) are needed');
      if (!f.label) warns.push(w2 + ': no label (for example "Top of the backswing")');
      var nums = {};
      (f.marks || []).forEach(function (m, j) {
        var w3 = w2 + ', mark ' + (j + 1);
        if (MARKS.indexOf(m.type) < 0) { errs.push(w3 + ': type must be one of ' + MARKS.join(', ')); return; }
        if (m.kind != null && !KINDS[m.kind]) errs.push(w3 + ': kind must be issue, fix, good or ref');
        var need = { line: ['from', 'to'], arrow: ['from', 'to'], box: ['from', 'to'], circle: ['at'], dot: ['at'], angle: ['vertex', 'a', 'b'] }[m.type] || [];
        need.forEach(function (k) {
          if (!isPt(m[k])) errs.push(w3 + ': ' + k + ' must be [x, y]');
          else if (m[k][0] < 0 || m[k][1] < 0 || m[k][0] > f.w || m[k][1] > f.h) errs.push(w3 + ': ' + k + ' is outside the frame');
        });
        if (m.type === 'circle' && !(m.r > 0)) errs.push(w3 + ': circle needs r');
        if (m.type === 'path' && (!Array.isArray(m.points) || m.points.length < 2 || !m.points.every(isPt))) errs.push(w3 + ': path needs 2 or more [x, y] points');
        if (m.label && m.label.length > 24) warns.push(w3 + ': label is long; keep it under 24 characters and put the rest in a note');
        if (m.n != null) nums[m.n] = true;
      });
      (f.notes || []).forEach(function (n, j) {
        if (!n || !n.text) errs.push(w2 + ', note ' + (j + 1) + ': needs text');
        else if (n.kind != null && !KINDS[n.kind]) errs.push(w2 + ', note ' + (j + 1) + ': kind must be issue, fix, good or ref');
        if (n && n.n != null && !nums[n.n]) warns.push(w2 + ', note ' + (j + 1) + ': number ' + n.n + ' has no mark on the frame');
      });
    });
    (r.fixes || []).forEach(function (fx, i) {
      if (!fx || !fx.text) errs.push(where + ', fix ' + (i + 1) + ': needs text');
      else if (fx.drill && ctx.drillExists && !ctx.drillExists(fx.drill)) errs.push(where + ', fix ' + (i + 1) + ': drill "' + fx.drill + '" isn\'t in js/tips.js (use focus id:drill number, e.g. "contact:0")');
    });
    return { errors: errs, warnings: warns };
  }

  return { markup: markup, validate: validate, degrees: degrees, KINDS: KINDS, MARKS: MARKS, VIEWS: VIEWS };
});
