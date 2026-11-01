/* Golf Shot Tracker: UI. Needs js/core.js (GolfCore) and js/tips.js (GolfTips). */
(function () {
  'use strict';
  const C = window.GolfCore;
  const TIPS = window.GolfTips || {};
  const LS = 'golfTracker.v3';
  const REGISTRY_URL = 'data/players.json';
  const OPTIONAL_KEYS = ['club_speed_mph', 'smash_factor', 'spin_rpm'];
  // Used until data/players.json loads (and if it can't).
  const DEFAULT_PLAYERS = [
    { id: 'dad', name: 'Dad', file: 'data/dad_golf_data.json' },
    { id: 'brother', name: 'M3', file: 'data/brother_golf_data.json' }
  ];

  // ---------------------------------------------------------------------------
  // Players and per-player state
  // ---------------------------------------------------------------------------
  function loadJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function validPlayers(list) { return Array.isArray(list) && list.length && list.every((p) => p && p.id && p.file) ? list : null; }
  function urlPlayer() { try { return new URLSearchParams(window.location.search).get('player'); } catch (e) { return null; } }
  function lastPlayer() { try { return localStorage.getItem(LS + '.lastPlayer'); } catch (e) { return null; } }

  // v2 kept Dad's edits under one key; carry them over once.
  (function migrate() {
    try {
      const old = localStorage.getItem('golfTracker.v2');
      if (old && !localStorage.getItem(LS + '.dad.local')) localStorage.setItem(LS + '.dad.local', old);
      const oldB = localStorage.getItem('golfTracker.bundleCache');
      if (oldB && !localStorage.getItem(LS + '.dad.bundle')) localStorage.setItem(LS + '.dad.bundle', oldB);
    } catch (e) { /* storage blocked */ }
  })();

  let players = validPlayers(loadJSON(LS + '.players')) || DEFAULT_PLAYERS;
  let playerId = C.resolvePlayer(players, urlPlayer(), lastPlayer());
  let bundle = null;            // this player's data file
  let bundleStatus = 'loading'; // loading | fresh | offline | missing
  let local = null;             // this player's edits on this device
  let data = null;              // merged view
  const ui = freshUI();

  function freshUI() {
    return {
      tab: 'stats', scope: null, dispClub: 'All', progClub: null, progMetric: 'carry_yds', statClub: null, openTip: null,
      sessionsView: 'list', sessionId: null, newSession: false, addMode: null, editNotes: false,
      entry: { club: null, other: false, dir: { curve_ft: null, offline_ft: null } },
      imp: { text: '', parsed: null, columns: null, sig: '', include: {}, flips: {}, defaultClub: '', lateralUnit: 'ft', apexUnit: 'ft' }
    };
  }
  function playerInfo() { return players.find((p) => p.id === playerId) || players[0]; }
  function key(kind) { return LS + '.' + playerId + '.' + kind; }
  function emptyLocal() { return { sessions: [], hidden: [], player: null, baselineSessionId: null }; }
  function loadLocal() {
    const d = loadJSON(key('local'));
    return d && Array.isArray(d.sessions) ? Object.assign(emptyLocal(), d) : emptyLocal();
  }
  function saveLocal() { if (!saveJSON(key('local'), local)) toast('Couldn’t save on this device. Export a backup from Data & backup.'); }
  function loadPlayerState() {
    bundle = loadJSON(key('bundle'));
    bundleStatus = 'loading';
    local = loadLocal();
    data = merge();
  }
  function setURL() {
    try {
      const want = '?player=' + encodeURIComponent(playerId);
      if (window.location.search !== want) history.replaceState(null, '', window.location.pathname + want + window.location.hash);
    } catch (e) { /* file:// or sandboxed */ }
  }
  function switchPlayer(id) {
    if (!players.some((p) => p.id === id)) return;
    const tab = ui.tab;
    playerId = id;
    try { localStorage.setItem(LS + '.lastPlayer', id); } catch (e) { /* ignore */ }
    setURL();
    loadPlayerState();
    Object.assign(ui, freshUI(), { tab });
    render();
    window.scrollTo(0, 0);
    fetchBundle();
  }

  function fileSessions() { return bundle && Array.isArray(bundle.sessions) ? bundle.sessions : []; }
  function fileSession(id) { return fileSessions().find((s) => s.id === id) || null; }
  // Merged view: file sessions minus hidden ones, local sessions win by id.
  function merge() {
    const b = bundle || {};
    const hidden = new Set(local.hidden);
    const byId = new Map();
    fileSessions().forEach((s) => { if (s && s.id && !hidden.has(s.id)) byId.set(s.id, { s, source: 'file' }); });
    local.sessions.forEach((s) => { byId.set(s.id, { s, source: fileSession(s.id) ? 'edited' : 'local' }); });
    const sessions = Array.from(byId.values()).map((x) => Object.assign({}, x.s, { _source: x.source })).sort(C.compareSessions);
    return {
      player: local.player || b.player || { name: playerInfo().name },
      clubs: Object.assign({}, b.clubs || {}, local.clubs || {}),
      // local.baselineSessionId: null = use the file's; '' = none (first session per club)
      baseline_session_id: local.baselineSessionId != null ? (local.baselineSessionId || null) : (b.baseline_session_id || null),
      sessions
    };
  }
  function refresh() { data = merge(); render(); }
  function stripUI(s) { const o = Object.assign({}, s); delete o._source; return o; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function getSession(id) { return data.sessions.find((s) => s.id === id) || null; }
  function baselineSession() { return getSession(data.baseline_session_id); }
  function playerName() { return (data.player && data.player.name) || playerInfo().name; }

  function editSession(id, fn) {
    let s = local.sessions.find((x) => x.id === id);
    if (!s) {
      const cur = getSession(id);
      if (!cur) return;
      s = clone(stripUI(cur));
      local.sessions.push(s);
    }
    if (!Array.isArray(s.shots)) s.shots = [];
    fn(s);
    saveLocal();
    refresh();
  }
  function revertSession(id) { local.sessions = local.sessions.filter((x) => x.id !== id); saveLocal(); refresh(); }
  function deleteSession(id) {
    local.sessions = local.sessions.filter((x) => x.id !== id);
    if (fileSession(id) && local.hidden.indexOf(id) < 0) local.hidden.push(id);
    saveLocal();
    refresh();
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function tipAttr(lines) { return esc(lines.filter(Boolean).join('\n')); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function nowHHMM() { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'; }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function deviceLine(s) { return [s.device || 'Session', s.bay != null ? 'Bay ' + s.bay : s.location].filter(Boolean).join(' · '); }
  function unitLabel(m) { return m.dir ? 'ft, L/R' : m.unit; }
  function shotCount(s) { return C.sessionShots(s).length; }
  function plural(n, w) { return C.plural(n, w); }
  // Direction with its unit, golf style: "27 ft R", "9.0 yds L".
  function dirU(v, unit, dec) {
    if (!C.isNum(v)) return '—';
    const m = /^(.*?)( [LR])?$/.exec(dec == null ? C.fmtRawDir(v) : C.fmtDir(v, dec));
    return m[1] + ' ' + unit + (m[2] || '');
  }
  function withUnit(m, v) {
    if (!C.isNum(v)) return '—';
    if (m.dir) return dirU(v, 'ft', m.dec);
    const s = C.fmtAvg(m, v);
    return m.unit === '°' ? s + '°' : m.unit ? s + ' ' + m.unit : s;
  }
  function fillText(s) {
    const pl = data.player || {};
    const h = C.fmtHeight(pl.height_in);
    return String(s || '')
      .replace(/a \{height\} golfer/g, h ? 'a ' + h + ' golfer' : 'your height')
      .replace(/\{height\}/g, h || 'your height')
      .replace(/\{name\}/g, playerName())
      .replace(/\{age\}/g, C.isNum(pl.age) ? String(pl.age) : '');
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------------------------------------------------------------------------
  // Chart helpers (SVG strings drawn at the real pixel width; colours from CSS)
  // ---------------------------------------------------------------------------
  function chartWidth(el, min) { return Math.max(min || 240, Math.floor(el.getBoundingClientRect().width)); }
  function niceStep(span, target) {
    const raw = Math.max(span, 1e-9) / Math.max(target, 1);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
  }
  function ticksFor(lo, hi, target) {
    if (lo === hi) { lo -= 5; hi += 5; }
    const step = niceStep(hi - lo, target);
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = a; v <= b + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return { lo: a, hi: b, step, ticks };
  }
  function lin(d0, d1, r0, r1) { return (v) => r0 + (v - d0) / ((d1 - d0) || 1) * (r1 - r0); }
  function f1(v) { return Math.round(v * 10) / 10; }
  function line(cls, x1, y1, x2, y2) { return `<line class="${cls}" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`; }
  function text(cls, x, y, s, anchor) { return `<text class="${cls}" x="${f1(x)}" y="${f1(y)}"${anchor ? ` text-anchor="${anchor}"` : ''}>${esc(s)}</text>`; }
  function svg(w, h, label, body) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;
  }
  function dotMark(cx, cy, r, tip, mis) {
    return `<g class="pt" tabindex="0" data-tip="${tip}" aria-label="${tip}"><circle class="dot${mis ? ' mis' : ''}" cx="${f1(cx)}" cy="${f1(cy)}" r="${r}"/><circle class="hit" cx="${f1(cx)}" cy="${f1(cy)}" r="14"/></g>`;
  }
  function rangeMark(x0, x1, cy, tip) {
    return `<g class="pt" tabindex="0" data-tip="${tip}" aria-label="${tip}"><rect class="rng" x="${f1(x0)}" y="${f1(cy - 5)}" width="${f1(Math.max(10, x1 - x0))}" height="10" rx="5"/><rect class="hit" x="${f1(x0 - 6)}" y="${f1(cy - 14)}" width="${f1(x1 - x0 + 12)}" height="28"/></g>`;
  }
  // Spread overlapping dots vertically so every shot stays visible.
  function swarm(xs, r) {
    const placed = [], out = [];
    const offsets = [0, -1, 1, -2, 2];
    xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]).forEach(([x, i]) => {
      for (let k = 0; k < offsets.length; k++) {
        const dy = offsets[k] * r * 1.7;
        if (!placed.some((p) => Math.abs(p.x - x) < r * 2.1 && p.dy === dy)) { placed.push({ x, dy }); out[i] = dy; return; }
      }
      out[i] = 0;
    });
    return out;
  }
  function shotTip(s, mis) {
    return tipAttr([
      `${C.fmtRaw(s.carry_yds)} yds carry` + (C.isNum(s.offline_ft) ? ` · ${dirU(s.offline_ft, 'ft')} (${dirU(s.offline_ft / 3, 'yds', 1)})` : ''),
      [s.club, s.time].filter(Boolean).join(' · '),
      mis ? 'Likely thin or topped, left out of the numbers' : ''
    ]);
  }

  // Carry gapping: a row per club (label above, so the bar gets the full width).
  function drawGap(el, entries, clubs) {
    const rows = clubs.map((c) => {
      const e = entries[c];
      return { club: c, e, st: C.metricStat(e, 'carry_yds'), pts: e.shots.filter((s) => C.isNum(s.carry_yds)), mis: new Set(e.mis) };
    }).filter((r) => r.pts.length || (r.st && C.isNum(r.st.min)));
    if (!rows.length) { el.innerHTML = '<p class="empty">No carry data in this session.</p>'; return; }
    const W = chartWidth(el), rowH = 94, top = 2, axisH = 32, padL = 16, padR = 20;
    const H = top + rows.length * rowH + axisH;
    const vals = [];
    rows.forEach((r) => { r.pts.forEach((s) => vals.push(s.carry_yds)); if (r.st && C.isNum(r.st.min)) vals.push(r.st.min, r.st.max); });
    const t = ticksFor(Math.min(...vals), Math.max(...vals), W < 420 ? 4 : 6);
    const x = lin(t.lo, t.hi, padL, W - padR);
    const g = [];
    t.ticks.forEach((v) => { g.push(line('grid', x(v), top, x(v), H - axisH)); g.push(text('tick', x(v), H - 10, C.fmtRaw(v), 'middle')); });
    let prev = null;
    rows.forEach((r, i) => {
      const y0 = top + i * rowH, ty = y0 + 22, cy = y0 + 62;
      g.push(text('rowlbl', padL, ty, r.club));
      if (r.st && C.isNum(r.st.avg)) {
        const gap = prev != null ? `${C.fmtSigned(r.st.avg - prev, 1)} gap` : '';
        g.push(`<text class="val" x="${f1(W - padR)}" y="${f1(ty)}" text-anchor="end">${esc(C.fmtNum(r.st.avg, 1))} yds${gap ? `<tspan class="sub"> · ${esc(gap)}</tspan>` : ''}</text>`);
        prev = r.st.avg;
      } else if (r.st && r.st.allMis) {
        g.push(text('sub', W - padR, ty, `all ${r.st.total} were mis-hits`, 'end'));
      } else {
        g.push(text('sub', W - padR, ty, 'recorded range', 'end'));
      }
      if (r.st && C.isNum(r.st.min) && C.isNum(r.st.max)) {
        g.push(rangeMark(x(r.st.min), x(r.st.max), cy, tipAttr([`${C.fmtRange(r.st.min, r.st.max)} yds`,
          `${r.club} carry range` + (r.st.summaryOnly ? ' (recorded, includes any topped shots)' : ` · ${plural(r.st.n, 'solid shot')}`)])));
      }
      const dys = swarm(r.pts.map((s) => x(s.carry_yds)), 6);
      r.pts.forEach((s, k) => { const mis = r.mis.has(s); g.push(dotMark(x(s.carry_yds), cy + dys[k], 6, shotTip(s, mis), mis)); });
      if (r.st && C.isNum(r.st.avg)) {
        const xa = x(r.st.avg);
        g.push(line('halo', xa, cy - 17, xa, cy + 17), line('avg', xa, cy - 17, xa, cy + 17));
      }
    });
    el.innerHTML = svg(W, H, 'Carry by club: range and average of solid shots, plus every shot', g.join(''));
  }

  // Dispersion. Offline is converted from feet to yards so both axes share one scale.
  function dispPoints(entry) {
    const mis = new Set(entry.mis);
    return entry.shots.filter((s) => C.isNum(s.offline_ft) && C.isNum(s.carry_yds)).map((s) => ({ s, x: s.offline_ft / 3, y: s.carry_yds, mis: mis.has(s) }));
  }
  function dispBody(pts, o) {
    const sx = (v) => o.padL + (v + o.xMax) * o.k;
    const sy = (v) => o.padT + (o.yHi - v) * o.k;
    const plotB = sy(o.yLo), plotR = sx(o.xMax);
    const g = [];
    const half = Math.min(15, o.xMax);
    g.push(`<rect class="fair" x="${f1(sx(-half))}" y="${f1(o.padT)}" width="${f1(sx(half) - sx(-half))}" height="${f1(plotB - o.padT)}"/>`);
    const tx = ticksFor(-o.xMax, o.xMax, o.small ? 2 : 4);
    tx.ticks.filter((v) => v >= -o.xMax - 1e-6 && v <= o.xMax + 1e-6).forEach((v) => {
      if (v !== 0) g.push(line('grid', sx(v), o.padT, sx(v), plotB));
      g.push(text('tick', sx(v), plotB + 22, C.fmtRawDir(v), 'middle'));
    });
    const ty = ticksFor(o.yLo, o.yHi, o.small ? 4 : 5);
    ty.ticks.filter((v) => sy(v) >= o.padT + 8 && sy(v) <= plotB - 14).forEach((v) => {
      g.push(line('grid', o.padL, sy(v), plotR, sy(v)));
      g.push(text('tick', o.padL - 7, sy(v) + 5, C.fmtRaw(v), 'end'));
    });
    g.push(line('target', sx(0), o.padT, sx(0), plotB));
    pts.forEach((p) => g.push(dotMark(sx(p.x), sy(p.y), 6, shotTip(p.s, p.mis), p.mis)));
    const solid = pts.filter((p) => !p.mis);
    if (solid.length >= 2) {
      const mx = solid.reduce((a, p) => a + p.x, 0) / solid.length, my = solid.reduce((a, p) => a + p.y, 0) / solid.length;
      const cx = sx(mx), cy = sy(my), a = 10;
      const tip = tipAttr([`${C.fmtNum(my, 1)} yds carry · ${dirU(mx, 'yds', 1)}`, 'Average of ' + plural(solid.length, 'solid shot')]);
      g.push(`<g class="pt" tabindex="0" data-tip="${tip}" aria-label="${tip}">` +
        line('halo', cx - a, cy, cx + a, cy) + line('halo', cx, cy - a, cx, cy + a) +
        line('avg', cx - a, cy, cx + a, cy) + line('avg', cx, cy - a, cx, cy + a) +
        `<circle class="hit" cx="${f1(cx)}" cy="${f1(cy)}" r="14"/></g>`);
    }
    return g.join('');
  }
  function drawDispersion(el, entry, club) {
    const pts = dispPoints(entry);
    if (!pts.length) { el.innerHTML = '<p class="empty">No shots with both carry and offline.</p>'; return; }
    const W = chartWidth(el), padL = 46, padR = 22, padT = 12, padB = 34;
    let xMax = Math.max(15, Math.ceil((Math.max(...pts.map((p) => Math.abs(p.x))) + 3) / 5) * 5);
    let yLo = Math.floor((Math.min(...pts.map((p) => p.y)) - 5) / 10) * 10;
    let yHi = Math.ceil((Math.max(...pts.map((p) => p.y)) + 5) / 10) * 10;
    const plotW = W - padL - padR;
    let k = plotW / (2 * xMax);
    let plotH = (yHi - yLo) * k;
    const maxH = Math.max(260, Math.min(480, Math.round(window.innerHeight * 0.6))), minH = 230;
    if (plotH > maxH) { k = maxH / (yHi - yLo); plotH = maxH; xMax = plotW / (2 * k); }
    if (plotH < minH) { const extra = (minH / k - (yHi - yLo)) / 2; yLo -= extra; yHi += extra; plotH = minH; }
    const H = Math.round(padT + plotH + padB);
    el.innerHTML = svg(W, H, `${club} dispersion: carry against yards left or right`, dispBody(pts, { padL, padT, xMax, yLo, yHi, k }));
  }
  function drawFacets(box, entries, clubs) {
    const items = clubs.map((c) => ({ c, e: entries[c], pts: dispPoints(entries[c]) })).filter((i) => i.pts.length);
    box.innerHTML = items.map((i) => {
      const car = C.summarize(i.e.solid, 'carry_yds'), off = C.summarize(i.e.solid, 'offline_ft');
      const nm = i.e.mis.length;
      const nums = car.n ? ` · ${C.fmtNum(car.avg, 1)} yds · ${dirU(off.avg / 3, 'yds', 1)}` : ' · all mis-hits';
      return `<div class="facet"><h4>${esc(i.c)}</h4><div class="fmeta">${plural(i.e.shots.length, 'shot')}${nm ? ` (${plural(nm, 'mis-hit')})` : ''}${esc(nums)}</div><div class="chart" data-facet="${esc(i.c)}"></div></div>`;
    }).join('');
    if (!items.length) return;
    const fw = chartWidth($('[data-facet]', box), 200), padL = 44, padR = 22, padT = 10, padB = 34;
    const xMax = Math.max(15, Math.ceil((Math.max(...items.map((i) => Math.max(...i.pts.map((p) => Math.abs(p.x))))) + 3) / 5) * 5);
    const k = (fw - padL - padR) / (2 * xMax);
    items.forEach((i) => {
      const ys = i.pts.map((p) => p.y);
      const lo = Math.min(...ys), hi = Math.max(...ys);
      const plotH = Math.max(170, (hi - lo + 24) * k);
      const span = plotH / k, mid = (lo + hi) / 2;
      const H = Math.round(padT + plotH + padB);
      const o = { padL, padT, xMax, yLo: mid - span / 2, yHi: mid + span / 2, k, small: true };
      $$('[data-facet]', box).filter((d) => d.getAttribute('data-facet') === i.c)[0].innerHTML = svg(fw, H, `${i.c} dispersion`, dispBody(i.pts, o));
    });
  }

  // Average miss by club: bars grow left or right from the target line; values in a column.
  // Clubs in `flagged` (average miss 10+ yds) sit on a soft "needs work" band.
  function drawMiss(el, rows, flagged) {
    flagged = flagged || new Set();
    const anyFlag = rows.some((r) => flagged.has(r.club));
    const W = chartWidth(el), rowH = anyFlag ? 66 : 54, top = 4, axisH = 32, padL = 62, padR = 88;
    const H = top + rows.length * rowH + axisH;
    const vals = rows.map((r) => r.st.avg / 3);
    const D = Math.max(5, ...vals.map(Math.abs)) * 1.08;
    const x = lin(-D, D, padL, W - padR), cx = x(0);
    const g = [];
    rows.forEach((r, i) => { if (flagged.has(r.club)) g.push(`<rect class="nwband" x="1" y="${f1(top + i * rowH + 3)}" width="${f1(W - 2)}" height="${rowH - 6}" rx="10"/>`); });
    const t = ticksFor(-D, D, W < 420 ? 3 : 5);
    t.ticks.filter((v) => Math.abs(v) <= D + 1e-6 && v !== 0).forEach((v) => {
      g.push(line('grid', x(v), top, x(v), H - axisH));
      g.push(text('tick', x(v), H - 10, C.fmtRawDir(v), 'middle'));
    });
    g.push(line('axis', cx, top, cx, H - axisH), text('tick', cx, H - 10, '0', 'middle'));
    rows.forEach((r, i) => {
      const cy = top + i * rowH + rowH / 2, v = vals[i], h = 20, x1 = x(v);
      const w = Math.abs(x1 - cx), rr = Math.min(5, w / 2, h / 2), y0 = cy - h / 2, y1 = cy + h / 2;
      let path = '';
      if (w >= 0.5) {
        path = v >= 0
          ? `M${f1(cx)} ${f1(y0)}H${f1(x1 - rr)}Q${f1(x1)} ${f1(y0)} ${f1(x1)} ${f1(y0 + rr)}V${f1(y1 - rr)}Q${f1(x1)} ${f1(y1)} ${f1(x1 - rr)} ${f1(y1)}H${f1(cx)}Z`
          : `M${f1(cx)} ${f1(y0)}H${f1(x1 + rr)}Q${f1(x1)} ${f1(y0)} ${f1(x1)} ${f1(y0 + rr)}V${f1(y1 - rr)}Q${f1(x1)} ${f1(y1)} ${f1(x1 + rr)} ${f1(y1)}H${f1(cx)}Z`;
      }
      const nm = r.e.mis.filter((s) => C.isNum(s.offline_ft)).length;
      const tip = tipAttr([`${dirU(v, 'yds', 1)} (${dirU(r.st.avg, 'ft', 1)})`, `${r.club} average miss · ${plural(r.st.n, 'solid shot')}`,
        `Range ${C.fmtRange(r.st.min, r.st.max, true)} ft`, nm ? `Leaves out ${plural(nm, 'mis-hit')}` : '']);
      g.push(text('rowlbl', padL - 12, cy + 6, r.club, 'end'));
      g.push(`<g class="pt" tabindex="0" data-tip="${tip}" aria-label="${tip}">${path ? `<path class="bar" d="${path}"/>` : ''}<rect class="hit" x="${f1(Math.min(cx, x1) - 6)}" y="${f1(cy - 15)}" width="${f1(w + 12)}" height="30"/></g>`);
      if (flagged.has(r.club)) {
        g.push(text('val', W - 10, cy - 2, C.fmtDir(v, 1), 'end'));
        g.push(text('nwtext', W - 10, cy + 19, 'needs work', 'end'));
      } else {
        g.push(text('val', W - 6, cy + 6, C.fmtDir(v, 1), 'end'));
      }
    });
    el.innerHTML = svg(W, H, 'Average miss by club, in yards left or right of the target line', g.join(''));
  }

  // Progress: a row per session for one club and metric (label above each bar).
  function drawProgress(el, P, metricKey) {
    const solidMode = metricKey === C.SOLID_METRIC.key;
    const m = solidMode ? C.SOLID_METRIC : C.METRIC[metricKey];
    const rows = P.rows.map((r) => ({ r, st: solidMode ? null : C.metricStat(r.entry, metricKey), p: solidMode ? C.solidPct(r.entry) : null }))
      .filter((x) => solidMode || x.st);
    if (!rows.length) { el.innerHTML = '<p class="empty">No data for this metric.</p>'; return; }
    // On very narrow charts (small phones, or zoomed-in text) the right-hand note gets its own line.
    const W = chartWidth(el), narrow = W < 300, rowH = narrow ? 120 : 100, top = 2, axisH = 32, padL = 16, padR = 20;
    const H = top + rows.length * rowH + axisH;
    let t;
    if (solidMode) t = { lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100] };
    else {
      const vals = [];
      rows.forEach((x) => [x.st.min, x.st.max, x.st.avg].forEach((v) => { if (C.isNum(v)) vals.push(v); }));
      if (m.dir) vals.push(0);
      t = vals.length ? ticksFor(Math.min(...vals), Math.max(...vals), W < 420 ? 4 : 6) : { lo: 0, hi: 1, ticks: [] };
    }
    const x = lin(t.lo, t.hi, padL, W - padR);
    const fmtT = solidMode ? (v) => v + '%' : m.dir ? C.fmtRawDir : C.fmtRaw;
    const g = [];
    t.ticks.forEach((v) => { g.push(line(m.dir && v === 0 ? 'axis' : 'grid', x(v), top, x(v), H - axisH)); g.push(text('tick', x(v), H - 10, fmtT(v), 'middle')); });
    rows.forEach((row, i) => {
      const s = row.r.session, e = row.r.entry, st = row.st;
      const y0 = top + i * rowH, ty1 = y0 + 22, ty2 = y0 + 44, ty3 = narrow ? y0 + 66 : ty2, cy = narrow ? y0 + 94 : y0 + 74;
      const isBase = P.baseline && P.baseline.session.id === s.id;
      g.push(text('rowlbl', padL, ty1, C.fmtDate(s.date)));
      g.push(text('rowsub', padL, ty2, C.shortDevice(s.device) + (isBase ? ' · baseline' : '')));
      let value, sub;
      if (solidMode) {
        value = row.p == null ? 'unknown' : C.roundHalfEven(row.p, 0) + '%';
        sub = row.p == null ? 'ranges only' : `${e.solid.length} of ${plural(e.shots.length, 'shot')}`;
        if (row.p != null) {
          g.push(rangeMark(x(0), x(row.p), cy, tipAttr([`${C.roundHalfEven(row.p, 0)}% solid contact`, `${e.solid.length} of ${plural(e.shots.length, 'shot')} · ${C.fmtDate(s.date)}`])));
          g.push(dotMark(x(row.p), cy, 6, tipAttr([`${C.roundHalfEven(row.p, 0)}% solid contact`, C.fmtDate(s.date)]), false));
        }
      } else {
        value = st.allMis ? '—' : C.isNum(st.avg) ? withUnit(m, st.avg) : C.fmtRange(st.min, st.max, m.dir);
        sub = st.allMis ? `all ${st.total} were mis-hits` : st.summaryOnly ? 'recorded range' : e.mis.length ? `${st.n} solid of ${e.shots.length}` : plural(st.n, 'shot');
        if (C.isNum(st.min) && C.isNum(st.max)) {
          g.push(rangeMark(x(st.min), x(st.max), cy, tipAttr([`${C.fmtRange(st.min, st.max, m.dir)} ${m.dir ? 'ft' : m.unit}`.trim(),
            `${m.label} range · ${C.fmtDate(s.date)}` + (st.summaryOnly ? ' (includes any topped shots)' : '')])));
        }
        if (C.isNum(st.avg)) g.push(dotMark(x(st.avg), cy, 6, tipAttr([withUnit(m, st.avg) + ' average', `${C.fmtDate(s.date)} · ${plural(st.n, 'solid shot')}`]), false));
      }
      g.push(text('val', W - padR, ty1, value, 'end'));
      g.push(text('sub', W - padR, ty3, sub, 'end'));
    });
    el.innerHTML = svg(W, H, `${m.label} by session`, g.join(''));
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    renderHeader();
    renderBanner();
    $$('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
    $$('section.view').forEach((v) => { v.hidden = v.dataset.view !== ui.tab; });
    ({ stats: renderStats, progress: renderProgress, tips: renderTips, sessions: renderSessions })[ui.tab]();
  }
  function renderHeader() {
    const box = $('#players');
    box.innerHTML = players.map((p) => `<button type="button" data-action="player" data-id="${esc(p.id)}" aria-pressed="${p.id === playerId}">${esc(p.id === playerId ? playerName() : p.name)}</button>`).join('');
    box.hidden = players.length < 2;
    const pl = data.player || {};
    $('#who').textContent = [pl.level ? cap(pl.level) : '', C.isNum(pl.age) ? 'age ' + pl.age : '', C.fmtHeight(pl.height_in)].filter(Boolean).join(' · ');
    document.title = playerName() + ' · Shot Tracker';
    const meta = $('meta[name="apple-mobile-web-app-title"]');
    if (meta) meta.setAttribute('content', playerName() + ' · Golf');
  }
  function renderBanner() {
    const el = $('#banner');
    let msg = '';
    const file = playerInfo().file;
    if (bundleStatus === 'missing') {
      msg = data.sessions.length
        ? `Couldn’t load ${file}, so only sessions saved on this device are shown.`
        : `Couldn’t load ${file}. If you opened index.html straight from your computer, serve the folder instead (for example python3 -m http.server), or use Sessions → Data & backup → Import JSON.`;
    } else if (bundleStatus === 'offline') {
      msg = 'Offline: showing the last downloaded copy of the data.';
    }
    el.textContent = msg;
    el.hidden = !msg;
  }
  function emptyState(onSessionsTab) {
    if (bundleStatus === 'loading' && !data.sessions.length) return '<p class="empty" style="margin-top:20px">Loading…</p>';
    return `<div class="card empty-card" style="margin-top:22px"><h3>No sessions yet</h3>
      <p>After a range session, text the screen photos to Matthew.</p>
      <p class="hint">${onSessionsTab ? 'Or tap “+ New session” to add shots yourself.' : 'You can also add shots yourself on the Sessions tab.'}</p></div>`;
  }

  // ----- Stats -----
  function scopeInfo() {
    const withShots = data.sessions.filter((s) => shotCount(s));
    let id = ui.scope;
    if (id !== 'all' && !getSession(id)) id = null;
    if (id === 'all' && !withShots.length) id = null;
    if (!id) id = withShots.length ? withShots[withShots.length - 1].id : (data.sessions.length ? data.sessions[data.sessions.length - 1].id : null);
    ui.scope = id;
    if (id === 'all') return { id, sessions: withShots };
    const s = getSession(id);
    return { id, sessions: s ? [s] : [], session: s };
  }
  function scopeOptions(cur) {
    const opts = data.sessions.slice().reverse().map((s) => {
      const n = shotCount(s);
      return `<option value="${esc(s.id)}"${s.id === cur ? ' selected' : ''}>${esc(C.fmtDate(s.date))} · ${esc(C.shortDevice(s.device))} (${n ? plural(n, 'shot') : 'ranges only'})</option>`;
    });
    const total = data.sessions.reduce((a, s) => a + shotCount(s), 0);
    if (total) opts.push(`<option value="all"${cur === 'all' ? ' selected' : ''}>All sessions (${plural(total, 'shot')})</option>`);
    return opts.join('');
  }
  function cellHtml(m, s) {
    if (!s) return '<td class="muted">—</td>';
    if (s.allMis) return `<td><span class="v">—</span><span class="n">all ${s.total} were mis-hits</span></td>`;
    const avg = C.isNum(s.avg) ? C.fmtAvg(m, s.avg) : '—';
    const part = s.n && s.n < s.of ? `<span class="n">${s.n} of ${s.of}</span>` : '';
    return `<td><span class="v">${esc(avg)}</span><span class="r">${esc(C.fmtRange(s.min, s.max, m.dir))}</span>${part}</td>`;
  }
  function matrixTable(entries, clubs) {
    if (!clubs.length) return '<p class="empty">No club data in this session.</p>';
    const head = `<thead><tr><th scope="col">Club</th>${clubs.map((c) => `<th scope="col" title="${esc(C.clubName(c, data.clubs))}">${esc(c)}</th>`).join('')}</tr></thead>`;
    const shotsRow = `<tr><th scope="row">Shots</th>${clubs.map((c) => {
      const e = entries[c];
      if (!e.shots.length) return '<td><span class="v">—</span><span class="n">ranges only</span></td>';
      return `<td><span class="v">${e.shots.length}</span>${e.mis.length ? `<span class="n">${plural(e.mis.length, 'mis-hit')}</span>` : ''}</td>`;
    }).join('')}</tr>`;
    const rows = [shotsRow], missing = [];
    C.METRICS.forEach((m) => {
      const stats = clubs.map((c) => C.metricStat(entries[c], m.key));
      if (stats.every((s) => !s)) { missing.push(m.label.toLowerCase()); return; }
      rows.push(`<tr><th scope="row">${esc(m.label)}${m.unit ? `<span class="u">${esc(unitLabel(m))}</span>` : ''}</th>${stats.map((s) => cellHtml(m, s)).join('')}</tr>`);
    });
    const anyMis = clubs.some((c) => entries[c].mis.length);
    const swipe = clubs.length > 2 ? `<p class="swipe-hint">Swipe the table sideways to see all ${clubs.length} clubs →</p>` : '';
    return `${swipe}<div class="table-wrap"><table class="matrix">${head}<tbody>${rows.join('')}</tbody></table></div>
      <p class="hint">Each cell shows the average, then lowest–highest. ${anyMis ? 'Averages and ranges leave out likely mis-hits (the hollow dots on the charts). ' : ''}“3 of 9” means only some ${anyMis ? 'solid ' : ''}shots had that number. Curve and offline are in feet; L = left, R = right.${missing.length ? ' Not measured: ' + esc(missing.join(', ')) + '.' : ''}</p>`;
  }
  // ----- One club at a time: goals, "needs work" and plain-language numbers -----
  const PLAIN = {
    solid_pct: ['Solid contact', 'Shots without a thin or topped miss'],
    carry_yds: ['Carry', 'How far it flies in the air'],
    total_yds: ['Total', 'Carry plus roll'],
    ball_speed_mph: ['Ball speed', 'How fast the ball leaves the club'],
    launch_deg: ['Launch', 'How steeply it starts climbing'],
    apex_ft: ['Peak height', 'Highest point of the flight'],
    landing_deg: ['Landing angle', 'How steeply it comes down'],
    hang_time_s: ['Hang time', 'Seconds in the air'],
    curve_ft: ['Curve', 'How much it bends in the air'],
    offline_ft: ['Offline', 'Where it finishes, left or right of the target'],
    club_speed_mph: ['Club speed', 'How fast the club head is moving'],
    smash_factor: ['Smash factor', 'Ball speed ÷ club speed; higher means better contact'],
    spin_rpm: ['Spin', 'Backspin, in revolutions per minute']
  };
  // The Tips section that helps with each kind of focus (first one the player has).
  const TIP_FOR = { contact: ['contact', 'basics'], direction: ['straight', 'basics'], launch: ['hands', 'basics'], distance: ['plan', 'speed'] };
  function tipIdFor(kind) {
    const t = TIPS[playerId];
    if (!t || !kind) return null;
    return (TIP_FOR[kind] || []).find((id) => t.focus.some((f) => f.id === id)) || null;
  }
  const NW_PILL = '<span class="nw-pill">Needs work</span>';
  function yds(n) { return n === '1' ? n + ' yd' : n + ' yds'; }
  function goalRow(g) {
    let target, now;
    if (g.id === 'carry') { target = `${g.lo}–${g.hi} yds`; now = `${g.n} of ${plural(g.of, 'shot')} landed in it`; }
    else if (g.id === 'line') { target = 'Within 10 yds of your target'; now = `${g.n} of ${plural(g.of, 'shot')} (goal: 8 of 10)`; }
    else if (g.id === 'launch') { target = `${g.lo}–${g.hi}°`; now = `${C.fmtNum(g.avg, 1)}° average${g.status === 'high' ? ', a bit high' : g.status === 'low' ? ', a bit low' : ''}`; }
    else { target = '9 of 10 swings'; now = `${g.n} of ${g.of} solid`; }
    const note = g.id === 'carry' ? `<span class="g-note">Your better shots already fly about ${g.center} yds.</span>` : '';
    return `<li class="goal${g.met ? ' met' : ''}"><div class="g-main"><span class="g-label">${esc(g.label)}</span><span class="g-target">${esc(target)}</span>${note}</div>
      <div class="g-now"><span class="g-state">${g.met ? '✓ On target' : 'Keep working'}</span><span>${esc(now)}</span></div></li>`;
  }
  function statRow(label, desc, value, sub, flagged) {
    return `<div class="stat-row${flagged ? ' work' : ''}"><dt><span class="sl">${esc(label)}</span><span class="sd">${esc(desc)}</span>${flagged ? NW_PILL : ''}</dt>
      <dd><span class="sv">${esc(value)}</span>${sub ? `<span class="sr">${esc(sub)}</span>` : ''}</dd></div>`;
  }
  function clubCard(entries, club, scopeAll) {
    const e = entries[club];
    const flags = C.needsWork(e);
    const flagKeys = new Set(flags.map((f) => f.key));
    const G = C.clubGoals(e, club);
    const shotsLine = !e.shots.length ? 'Ranges only; individual shots weren’t recorded.'
      : e.mis.length ? `${plural(e.shots.length, 'shot')}: ${e.solid.length} solid, ${plural(e.mis.length, 'likely mis-hit')} (left out of the numbers)`
        : `${plural(e.shots.length, 'shot')}, all solid`;
    const rows = [];
    if (e.shots.length) {
      rows.push(statRow(PLAIN.solid_pct[0], PLAIN.solid_pct[1], C.roundHalfEven(C.solidPct(e), 0) + '%',
        `${e.solid.length} of ${plural(e.shots.length, 'shot')}`, flagKeys.has('solid_pct')));
    }
    C.METRICS.forEach((m) => {
      const s = C.metricStat(e, m.key);
      if (!s) return;
      const [label, desc] = PLAIN[m.key] || [m.label, ''];
      let value, sub;
      if (s.allMis) { value = '—'; sub = `all ${s.total} were mis-hits`; }
      else {
        value = C.isNum(s.avg) ? withUnit(m, s.avg) : '—';
        const unit = m.dir ? ' ft' : m.unit === '°' ? '°' : m.unit ? ' ' + m.unit : '';
        const range = C.isNum(s.min) && C.isNum(s.max) ? (s.summaryOnly ? 'recorded range ' : 'range ') + C.fmtRange(s.min, s.max, m.dir) + unit : '';
        const asYds = m.key === 'offline_ft' && C.isNum(s.avg) && Math.abs(s.avg) >= 1.5 ? `about ${yds(C.fmtNum(Math.abs(s.avg) / 3, 0))} ${s.avg < 0 ? 'left' : 'right'}` : '';
        const part = s.n && s.n < s.of ? `${s.n} of ${s.of} shots` : '';
        sub = [asYds, range, part].filter(Boolean).join(' · ');
      }
      rows.push(statRow(label, desc, value, sub, flagKeys.has(m.key)));
    });
    const tip = G ? tipIdFor(G.focus.kind) : null;
    const goals = G ? `<div class="goals">
        <h4 class="goals-title">Goals for your ${esc(club)}</h4>
        <div class="focus-line"><span class="fl-label">Focus</span><span class="fl-text">${esc(G.focus.text)}</span>
          ${tip ? `<button class="btn ghost small" data-action="goto-tip" data-tip="${esc(tip)}">See drills →</button>` : ''}</div>
        <ul class="goal-list">${G.goals.map(goalRow).join('')}</ul>
        <p class="hint">Goals come from ${scopeAll ? 'all of your sessions' : 'your shots in this session'} and move as you improve. Launch windows are ballpark targets for your swing speed.</p>
      </div>` : '';
    return `<div class="club-card">
      <div class="cc-head"><span class="cc-name">${esc(club)}</span><span class="cc-full">${esc(C.clubName(club, data.clubs))}</span></div>
      <p class="cc-shots">${esc(shotsLine)}</p>
      ${flags.length ? `<div class="work-box">${NW_PILL}<ul>${flags.map((f) => `<li>${esc(cap(f.text))}.</li>`).join('')}</ul></div>` : ''}
      ${goals}
      <h4 class="cc-sub">The numbers</h4>
      <dl class="stat-list">${rows.join('')}</dl>
      <p class="hint">Averages and ranges leave out likely mis-hits. Curve and offline are in feet; L = left, R = right.</p>
    </div>`;
  }
  function workBox(work) {
    if (!work) return '';
    return `<div class="work-box">${NW_PILL}<div class="work-list">${work.clubs.map((w) =>
      `<button class="work-row" data-action="focus-club" data-club="${esc(w.club)}"><span class="wr-club">${esc(w.club)}</span><span class="wr-text">${esc(w.flags.map((f) => cap(f.text)).join('. '))}.</span><span class="wr-go" aria-hidden="true">›</span></button>`).join('')}</div>
      <p class="wr-hint">Tap a club to see its goals.</p></div>`;
  }

  function renderStats() {
    const el = $('#view-stats');
    if (!data.sessions.length) { el.innerHTML = emptyState(); return; }
    const sc = scopeInfo();
    const entries = C.clubData(sc.sessions);
    const clubs = C.sortClubs(Object.keys(entries));
    const hl = C.buildHighlights(sc.sessions, baselineSession());
    const dispClubs = clubs.filter((c) => dispPoints(entries[c]).length);
    if (ui.dispClub !== 'All' && dispClubs.indexOf(ui.dispClub) < 0) ui.dispClub = 'All';
    const single = dispClubs.length === 1 ? dispClubs[0] : (ui.dispClub !== 'All' ? ui.dispClub : null);
    const missRows = clubs.map((c) => ({ club: c, e: entries[c], st: C.summarize(entries[c].solid, 'offline_ft') })).filter((r) => r.st.n);
    const notes = sc.session ? C.asList(sc.session.coaching_notes) : [];
    const hasMis = clubs.some((c) => entries[c].mis.length);
    const flagsBy = {};
    clubs.forEach((c) => { flagsBy[c] = C.needsWork(entries[c]); });
    if (!ui.statClub || clubs.indexOf(ui.statClub) < 0) ui.statClub = clubs[0];
    const dirFlagged = new Set(clubs.filter((c) => flagsBy[c].some((f) => f.kind === 'direction')));
    const work = hl.find((h) => h.id === 'work');
    const clubChips = clubs.map((c) => {
      const nw = flagsBy[c].length;
      return `<button class="chip${nw ? ' nw' : ''}" data-action="stat-club" data-club="${esc(c)}" aria-pressed="${c === ui.statClub}"${nw ? ` aria-label="${esc(c)}, needs work"` : ''}>${esc(c)}${nw ? '<span class="nw-dot" aria-hidden="true"></span>' : ''}</button>`;
    }).join('');

    let disp = '';
    if (dispClubs.length) {
      let inner;
      if (single) {
        const e = entries[single];
        const car = C.summarize(e.solid, 'carry_yds'), off = C.summarize(e.solid, 'offline_ft');
        const spread = C.isNum(off.min) ? off.max - off.min : null;
        inner = `<div class="tiles">
            <div class="tile"><div class="k">Shots</div><div class="v">${e.shots.length}</div><div class="s">${e.mis.length ? `${e.solid.length} solid · ${plural(e.mis.length, 'mis-hit')}` : esc(C.clubName(single, data.clubs))}</div></div>
            <div class="tile"><div class="k">Average carry</div><div class="v">${car.n ? C.fmtNum(car.avg, 1) + ' yds' : '—'}</div><div class="s">${car.n ? esc(C.fmtRange(car.min, car.max)) : 'all mis-hits'}</div></div>
            <div class="tile"><div class="k">Average miss</div><div class="v">${dirU(off.avg / 3, 'yds', 1)}</div><div class="s">${dirU(off.avg, 'ft', 1)}</div></div>
            <div class="tile"><div class="k">Left to right spread</div><div class="v">${C.isNum(spread) ? C.fmtNum(spread / 3, 1) + ' yds' : '—'}</div><div class="s">${C.isNum(spread) ? esc(C.fmtRange(off.min, off.max, true)) + ' ft' : ''}</div></div>
          </div><div class="chart" id="dispChart"></div>`;
      } else {
        inner = '<div class="facets" id="facets"></div>';
      }
      const shotsForTable = single ? entries[single].shots : [].concat(...clubs.map((c) => entries[c].shots));
      const misSet = new Set([].concat(...clubs.map((c) => entries[c].mis)));
      disp = `<h2>Dispersion</h2><div class="card">
        ${dispClubs.length > 1 ? `<div class="chips" role="group" aria-label="Club">${['All'].concat(dispClubs).map((c) => `<button class="chip" data-action="disp-club" data-club="${esc(c)}" aria-pressed="${c === (single || 'All')}">${c === 'All' ? 'All clubs' : esc(c)}</button>`).join('')}</div>` : ''}
        ${inner}
        <p class="hint">${single ? '' : 'Each panel is one club, all drawn to the same scale. '}Up is carry in yards; across is yards left or right of the target line. The cross is the average of solid shots. The grey band is a 30-yard-wide fairway.${hasMis ? ' Hollow dots are likely mis-hits.' : ''}</p>
        <details class="more"><summary>Show as a table</summary>${shotTable(shotsForTable, misSet)}</details>
      </div>`;
    }

    el.innerHTML = `
      <div class="filters"><label for="scope">Session</label><select id="scope" data-change="scope">${scopeOptions(sc.id)}</select></div>
      ${sc.id === 'all' && data.sessions.some((s) => C.isSummaryOnly(s)) ? '<p class="note" style="margin-bottom:14px">“All sessions” pools sessions with individual shots. Sessions with ranges only are left out; pick one in the menu to see its ranges.</p>' : ''}
      <div class="card"><h3 class="card-title">Highlights</h3>${workBox(work)}<ul class="hl">${hl.filter((h) => h.id !== 'work').map((h) => `<li>${esc(h.text)}</li>`).join('')}</ul></div>
      ${clubs.length ? `<h2 id="clubSection">Club by club</h2>
      <div class="card">
        <div class="chips" role="group" aria-label="Club">${clubChips}</div>
        ${clubs.some((c) => flagsBy[c].length) ? '<p class="nw-key"><span class="nw-dot" aria-hidden="true"></span> marks a club that needs work</p>' : ''}
        ${clubCard(entries, ui.statClub, sc.id === 'all')}
        <details class="more"><summary>Compare all clubs in one table</summary>${matrixTable(entries, clubs)}</details>
      </div>` : ''}
      <h2>Carry gapping</h2>
      <div class="card"><div class="chart" id="gapChart"></div>
        <p class="hint">Carry in yards. Bar: shortest to longest solid shot. Black line and number: average of solid shots. Dots: every shot${hasMis ? ' (hollow = likely mis-hit, left out of the numbers)' : ''}. “Gap” is the change from the next-shorter club.</p></div>
      ${disp}
      ${missRows.length >= 2 ? `<h2>Average miss by club</h2><div class="card"><div class="chart" id="missChart"></div><p class="hint">Average offline of solid shots, in yards. Bars to the right are misses right of the target line.${missRows.some((r) => dirFlagged.has(r.club)) ? ` Clubs marked “needs work” average ${C.NEEDS_WORK.missYds} yds or more off line.` : ''}</p></div>` : ''}
      ${sc.session ? `<h2>Coaching notes</h2><div class="card">${notes.length ? `<ul class="plain">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="empty">No coaching notes for this session.</p>'}
        <div class="row-actions"><button class="btn small ghost" data-action="goto-notes" data-id="${esc(sc.session.id)}">${notes.length ? 'Edit notes' : 'Add notes'}</button></div></div>` : ''}
    `;
    drawGap($('#gapChart'), entries, clubs);
    if ($('#dispChart')) drawDispersion($('#dispChart'), entries[single], single);
    if ($('#facets')) drawFacets($('#facets'), entries, dispClubs);
    if ($('#missChart')) drawMiss($('#missChart'), missRows, dirFlagged);
  }
  function shotTable(shots, misSet) {
    const rows = C.sortClubs(Array.from(new Set(shots.map((s) => s.club)))).map((c) => shots.filter((s) => s.club === c))
      .reduce((a, b) => a.concat(b), [])
      .filter((s) => C.isNum(s.carry_yds) || C.isNum(s.offline_ft))
      .map((s) => `<tr><td>${esc(s.club)}</td><td>${esc(s.time || '')}</td><td>${C.fmtRaw(s.carry_yds)}</td><td>${esc(C.fmtRawDir(s.offline_ft))}</td><td>${esc(C.fmtRawDir(s.curve_ft))}</td><td>${misSet.has(s) ? 'mis-hit' : ''}</td></tr>`);
    return `<div class="table-wrap"><table class="matrix"><thead><tr><th>Club</th><th>Time</th><th>Carry yds</th><th>Offline ft</th><th>Curve ft</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  // ----- Progress -----
  function renderProgress() {
    const el = $('#view-progress');
    const clubs = C.sortClubs(Object.keys(C.clubData(data.sessions)));
    if (!data.sessions.length || !clubs.length) { el.innerHTML = emptyState(); return; }
    if (clubs.indexOf(ui.progClub) < 0) {
      ui.progClub = clubs.find((c) => C.progressFor(data.sessions, c, data.baseline_session_id).rows.length >= 2) || clubs[0];
    }
    const club = ui.progClub;
    const P = C.progressFor(data.sessions, club, data.baseline_session_id);
    const metrics = (P.rows.some((r) => r.entry.shots.length) ? [C.SOLID_METRIC] : [])
      .concat(C.METRICS.filter((m) => P.rows.some((r) => C.metricStat(r.entry, m.key))));
    if (!metrics.some((m) => m.key === ui.progMetric)) ui.progMetric = metrics.some((m) => m.key === 'carry_yds') ? 'carry_yds' : metrics[0].key;
    const m = metrics.find((x) => x.key === ui.progMetric);
    const base = baselineSession();
    const rangeOnly = P.rows.filter((r) => !r.entry.shots.length).map((r) => C.fmtDate(r.session.date));
    el.innerHTML = `
      <div class="filters">
        <span class="label">Club</span>
        <div class="chips" role="group" aria-label="Club">${clubs.map((c) => `<button class="chip" data-action="prog-club" data-club="${esc(c)}" aria-pressed="${c === club}">${esc(c)}</button>`).join('')}</div>
        <label for="progMetric" style="margin-top:6px">Metric</label>
        <select id="progMetric" data-change="prog-metric">${metrics.map((x) => `<option value="${x.key}"${x.key === m.key ? ' selected' : ''}>${esc(x.label)}${x.key === C.SOLID_METRIC.key ? ' %' : ''}</option>`).join('')}</select>
      </div>
      ${P.fallback && P.baseline ? `<p class="note" style="margin-bottom:14px">${base ? `The ${esc(C.fmtDate(base.date))} baseline has no ${esc(club)}, so` : 'No baseline session is set, so'} the first ${esc(club)} session (${esc(C.fmtDate(P.baseline.session.date))}) is its baseline.</p>` : ''}
      <div class="card"><h3 class="card-title">${esc(club)}: ${esc(m.label.toLowerCase())}${m.key === C.SOLID_METRIC.key ? ' %' : ''} by session</h3><div class="chart" id="progChart"></div>
        <p class="hint">${m.key === C.SOLID_METRIC.key ? 'Share of shots that weren’t likely mis-hits.' : 'Bar: lowest to highest. Dot and number: average. Solid shots only.'}${m.dir ? ' Feet; L = left, R = right.' : ''}${rangeOnly.length ? ` ${esc(rangeOnly.join(', '))} recorded ranges only, so ${rangeOnly.length > 1 ? 'their' : 'its'} numbers include any topped shots and ${rangeOnly.length > 1 ? 'their' : 'its'} solid-contact rate is unknown.` : ''}</p></div>
      ${P.rows.length < 2
        ? `<div class="card"><p class="note">Only one session with the ${esc(club)} so far. Progress shows up after the next one.</p></div>`
        : `<h2>Since the baseline</h2><div class="card">${progTable(P)}</div>`}
    `;
    drawProgress($('#progChart'), P, m.key);
  }
  function statCell(m, s) {
    if (!s) return '<span class="muted">—</span>';
    if (s.allMis) return `<span class="v">—</span><span class="n">all ${s.total} were mis-hits</span>`;
    return (C.isNum(s.avg) ? `<span class="v">${esc(C.fmtAvg(m, s.avg))}</span>` : '') + `<span class="r">${esc(C.fmtRange(s.min, s.max, m.dir))}</span>`;
  }
  function progTable(P) {
    const b = P.baseline, l = P.latest;
    const pa = C.solidPct(b.entry), pl = C.solidPct(l.entry);
    const pctCell = (p, e) => p == null ? '<span class="v">—</span><span class="n">unknown (ranges only)</span>' : `<span class="v">${C.roundHalfEven(p, 0)}%</span><span class="r">${e.solid.length} of ${e.shots.length}</span>`;
    const solidRow = (b.entry.shots.length || l.entry.shots.length)
      ? `<tr><th scope="row">Solid contact</th><td>${pctCell(pa, b.entry)}</td><td>${pctCell(pl, l.entry)}${pa != null && pl != null ? `<span class="chg">${esc(C.fmtSigned(pl - pa, 0))} points</span>` : ''}</td></tr>` : '';
    const rows = C.METRICS.map((m) => {
      const a = C.metricStat(b.entry, m.key), c = C.metricStat(l.entry, m.key);
      if (!a && !c) return '';
      const d = C.compareStats(a, c);
      let change = '';
      if (d) {
        if (m.dir) {
          if (C.isNum(d.spreadA) && C.isNum(d.spreadB)) change = `spread ${C.fmtRaw(d.spreadA)} → ${C.fmtRaw(d.spreadB)} ft`;
        } else {
          const parts = [];
          if (C.isNum(d.dMin)) parts.push('low ' + C.fmtSigned(d.dMin));
          if (C.isNum(d.dMax)) parts.push('high ' + C.fmtSigned(d.dMax));
          if (C.isNum(d.dAvg)) parts.push('avg ' + C.fmtSigned(d.dAvg, m.dec));
          change = parts.join(' · ');
        }
      }
      return `<tr><th scope="row">${esc(m.label)}${m.unit ? `<span class="u">${esc(unitLabel(m))}</span>` : ''}</th><td>${statCell(m, a)}</td><td>${statCell(m, c)}${change ? `<span class="chg">${esc(change)}</span>` : ''}</td></tr>`;
    }).join('');
    const head = (r, label) => `${label}<span class="u">${esc(C.fmtDate(r.session.date))} · ${esc(C.shortDevice(r.session.device))}</span>`;
    return `<div class="table-wrap"><table class="matrix cmp"><thead><tr><th scope="col">Metric</th><th scope="col">${head(b, 'Baseline')}</th><th scope="col">${head(l, 'Latest')}</th></tr></thead><tbody>${solidRow}${rows}</tbody></table></div>
      <p class="hint">Each cell shows the average (when individual shots exist), then lowest–highest, from solid shots. Changes are latest minus baseline.</p>`;
  }

  // ----- Tips -----
  function renderTips() {
    const el = $('#view-tips');
    const t = TIPS[playerId];
    if (!t) { el.innerHTML = '<div class="card" style="margin-top:22px"><p>No tips for this player yet.</p></div>'; return; }
    el.innerHTML = `
      <h2>Tips &amp; drills</h2>
      <p class="lead">${esc(fillText(t.intro))}</p>
      ${t.focus.map((f, i) => focusCard(f, i)).join('')}
      <div class="card lesson"><h3>Check it with a coach</h3><p style="margin-top:6px">${esc(fillText(t.lesson))}</p></div>`;
  }
  function focusCard(f, i) {
    const call = f.callout ? C.sessionCallout(f.callout, data.sessions) : null;
    const drills = f.drills.map((d) => `<div class="drill">
        <h4>${esc(fillText(d.name))}</h4>
        <ol>${d.steps.map((s) => `<li>${esc(fillText(s))}</li>`).join('')}</ol>
        <p class="reps"><strong>Reps:</strong> ${esc(fillText(d.reps))}</p>
        <a class="btn ghost small look" href="${esc(C.youtubeSearchUrl(d.search))}" target="_blank" rel="noopener">Look it up on YouTube <span aria-hidden="true">↗</span></a>
      </div>`).join('');
    const open = ui.openTip ? f.id === ui.openTip : i === 0;
    return `<details class="card focus" data-focus="${esc(f.id)}"${open ? ' open' : ''}>
      <summary><span class="fnum" aria-hidden="true">${i + 1}</span><span>${esc(fillText(f.title))}</span></summary>
      <div class="focus-body">
        <p class="why"><strong>Why it matters:</strong> ${esc(fillText(f.why))}</p>
        ${call ? `<div class="callout"><p class="ctitle">${esc(call.title)}</p><p>${esc(call.text)}</p></div>` : ''}
        ${drills}
      </div>
    </details>`;
  }

  // ----- Sessions -----
  function renderSessions() {
    const el = $('#view-sessions');
    if (ui.sessionsView === 'data') { renderData(el); return; }
    if (ui.sessionId) {
      const s = getSession(ui.sessionId);
      if (s) { renderSessionDetail(el, s); return; }
      ui.sessionId = null;
    }
    el.innerHTML = `
      <div class="row-between"><h2>Sessions</h2>${ui.newSession ? '' : '<button class="btn small" data-action="new-session">+ New session</button>'}</div>
      <button class="btn ghost block data-link" data-action="open-data">Data &amp; backup</button>
      ${ui.newSession ? newSessionForm() : ''}
      ${data.sessions.length ? data.sessions.slice().reverse().map(sessionCard).join('') : emptyState(true)}
    `;
  }
  function sessionCard(s) {
    const n = shotCount(s);
    const clubs = C.sortClubs(Object.keys(C.clubData([s])));
    const badges = [];
    if (s._source === 'edited') badges.push('Edited on this device');
    if (s._source === 'local') badges.push('Added on this device');
    if (C.isSummaryOnly(s)) badges.push('Ranges only');
    if (s.id === data.baseline_session_id) badges.push('Baseline');
    return `<button class="session-card" data-action="open-session" data-id="${esc(s.id)}">
      <span class="sc-date">${esc(C.fmtDate(s.date))}</span>
      <span class="sc-meta">${esc(deviceLine(s))}</span>
      <span class="sc-meta">${n ? plural(n, 'shot') : 'No individual shots'}${clubs.length ? ' · ' + esc(clubs.join(', ')) : ''}</span>
      ${badges.length ? `<span class="badges">${badges.map((b) => `<span class="badge">${esc(b)}</span>`).join('')}</span>` : ''}
    </button>`;
  }
  function newSessionForm() {
    return `<div class="card">
      <h3 class="card-title">New session</h3>
      <div class="field"><label for="nsDate">Date</label><input id="nsDate" type="date" value="${todayISO()}"></div>
      <div class="field"><label for="nsDevice">Device</label><select id="nsDevice" data-change="ns-device">
        <option>Toptracer Range</option><option>Rapsodo</option><option>TrackMan</option><option value="other">Other…</option></select></div>
      <div class="field" id="nsOtherWrap" hidden><label for="nsOther">Device name</label><input id="nsOther" type="text"></div>
      <div class="field"><label for="nsLoc">Location or bay</label><input id="nsLoc" type="text" placeholder="e.g. Bay 7"></div>
      <div class="field"><label for="nsNotes">Coaching notes (one per line)</label><textarea id="nsNotes" rows="3"></textarea></div>
      <div class="row-actions"><button class="btn" data-action="create-session">Create session</button><button class="btn ghost" data-action="cancel-new-session">Cancel</button></div>
    </div>`;
  }
  function listHtml(items) { return items.length ? `<ul class="plain">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''; }
  function renderSessionDetail(el, s) {
    const n = shotCount(s);
    const dataNotes = C.asList(s.notes);
    const notMeasured = Array.isArray(s.metrics_not_available) ? s.metrics_not_available.map((k) => (C.METRIC[k] ? C.METRIC[k].label : k).toLowerCase()) : [];
    const coaching = C.asList(s.coaching_notes);
    if (!ui.addMode) ui.addMode = n ? 'enter' : 'paste';
    el.innerHTML = `
      <button class="back" data-action="close-session">← All sessions</button>
      <div class="detail-head">
        <h2>${esc(C.fmtDate(s.date))}</h2>
        <p class="meta">${esc(deviceLine(s))}${s.equipment ? ' · ' + esc(s.equipment) : ''} · ${n ? plural(n, 'shot') : 'no individual shots'}</p>
        ${s.date_note ? `<p class="hint">${esc(s.date_note)}</p>` : ''}
        ${s._source === 'edited' ? '<div class="edited"><span class="badge">Edited on this device</span><button class="btn small ghost" data-action="revert-session">Revert to file version</button></div>' : ''}
        ${s._source === 'local' ? '<div class="edited"><span class="badge">Added on this device</span></div>' : ''}
      </div>
      <div class="card">
        <div class="row-between"><h3>Coaching notes</h3>${ui.editNotes ? '' : '<button class="btn small ghost" data-action="edit-notes">Edit</button>'}</div>
        ${ui.editNotes
          ? `<div class="field" style="margin-top:10px"><label for="notesText">One note per line</label><textarea id="notesText" rows="6">${esc(coaching.join('\n'))}</textarea></div>
             <div class="row-actions"><button class="btn small" data-action="save-notes">Save notes</button><button class="btn small ghost" data-action="cancel-notes">Cancel</button></div>`
          : (listHtml(coaching) || '<p class="empty">No coaching notes yet.</p>')}
      </div>
      ${dataNotes.length || notMeasured.length ? `<div class="card"><h3>Data notes</h3>${listHtml(dataNotes)}${notMeasured.length ? `<p class="hint">Not measured: ${esc(notMeasured.join(', '))}.</p>` : ''}</div>` : ''}
      ${s.screen_averages ? screenAvgCard(s) : ''}
      ${C.hasSummary(s) ? summaryCard(s) : ''}
      <div class="card">
        <h3>Add shots</h3>
        <div class="seg" role="group" aria-label="How to add shots" style="margin:12px 0 16px">
          <button data-action="add-mode" data-mode="enter" aria-pressed="${ui.addMode === 'enter'}">Enter a shot</button>
          <button data-action="add-mode" data-mode="paste" aria-pressed="${ui.addMode === 'paste'}">Paste rows</button>
        </div>
        ${ui.addMode === 'paste' ? pasteForm() : entryForm()}
      </div>
      <div class="card"><h3>Shots</h3>${shotList(s)}</div>
      <button class="btn danger" data-action="delete-session">Delete session</button>
    `;
    if (ui.addMode === 'paste') {
      if (ui.imp.text && !ui.imp.parsed) setImportParsed(C.parsePaste(ui.imp.text));
      else renderImportPreview();
    }
  }
  function screenAvgCard(s) {
    const sa = s.screen_averages || {};
    const clubs = C.sortClubs(Object.keys(sa));
    if (!clubs.length) return '';
    const keys = [];
    clubs.forEach((c) => Object.keys(sa[c] || {}).forEach((k) => { if (keys.indexOf(k) < 0) keys.push(k); }));
    const order = C.METRICS.map((m) => m.key);
    keys.sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
    const label = (k) => C.METRIC[k] ? C.METRIC[k].label + (C.METRIC[k].unit ? ` (${unitLabel(C.METRIC[k])})` : '') : k === 'consistency_pct' ? 'Consistency (%)' : k;
    const fmt = (k, v) => !C.isNum(v) ? '—' : C.METRIC[k] && C.METRIC[k].dir ? C.fmtRawDir(v) : C.fmtRaw(v);
    return `<div class="card"><h3>Screen averages</h3><p class="hint" style="margin:4px 0 8px">As shown on the ${esc(C.shortDevice(s.device))} screen (all shots), for checking.</p>
      <div class="table-wrap"><table class="matrix"><thead><tr><th>Metric</th>${clubs.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${keys.map((k) => `<tr><th scope="row">${esc(label(k))}</th>${clubs.map((c) => `<td>${esc(fmt(k, (sa[c] || {})[k]))}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>`;
  }
  function summaryCard(s) {
    const sum = s.summary || {};
    const clubs = C.sortClubs(Object.keys(sum));
    const keys = C.METRICS.map((m) => m.key).filter((k) => clubs.some((c) => sum[c] && sum[c][k]));
    return `<div class="card"><h3>Recorded ranges</h3><p class="hint" style="margin:4px 0 8px">Only ranges were kept from this session, so they include any topped shots.</p>
      <div class="table-wrap"><table class="matrix"><thead><tr><th>Metric</th>${clubs.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${keys.map((k) => `<tr><th scope="row">${esc(C.METRIC[k].label)}<span class="u">${esc(unitLabel(C.METRIC[k]))}</span></th>${clubs.map((c) => { const r = (sum[c] || {})[k]; return `<td>${r ? esc(C.fmtRange(r.min, r.max, C.METRIC[k].dir)) : '—'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div></div>`;
  }
  function shotList(s) {
    const shots = s.shots || [];
    if (!C.sessionShots(s).length) return `<p class="empty">${C.isSummaryOnly(s) ? 'Ranges only. Individual shots weren’t recorded.' : 'No shots yet.'}</p>`;
    const mis = C.sessionMishits([s]);
    const clubs = C.sortClubs(Array.from(new Set(C.sessionShots(s).map((x) => x.club))));
    return clubs.map((c) => {
      const items = [];
      shots.forEach((x, idx) => { if (x && x.club === c) items.push(shotRow(x, idx, mis.has(x))); });
      return `<details class="club-group" open><summary>${esc(c)} · ${plural(items.length, 'shot')}</summary>${items.join('')}</details>`;
    }).join('');
  }
  function shotRow(x, idx, mis) {
    const main = [x.time, C.isNum(x.carry_yds) ? C.fmtRaw(x.carry_yds) + ' carry' : null, C.isNum(x.total_yds) ? C.fmtRaw(x.total_yds) + ' total' : null,
      C.isNum(x.offline_ft) ? 'offline ' + dirU(x.offline_ft, 'ft') : null].filter(Boolean).join(' · ');
    const sub = [
      C.isNum(x.ball_speed_mph) ? C.fmtRaw(x.ball_speed_mph) + ' mph' : null,
      C.isNum(x.launch_deg) ? C.fmtRaw(x.launch_deg) + '° launch' : null,
      C.isNum(x.apex_ft) ? C.fmtRaw(x.apex_ft) + ' ft apex' : null,
      C.isNum(x.landing_deg) ? C.fmtRaw(x.landing_deg) + '° landing' : null,
      C.isNum(x.curve_ft) ? 'curve ' + dirU(x.curve_ft, 'ft') : null,
      C.isNum(x.hang_time_s) ? C.fmtRaw(x.hang_time_s) + ' s hang' : null,
      C.isNum(x.club_speed_mph) ? C.fmtRaw(x.club_speed_mph) + ' mph club' : null,
      C.isNum(x.spin_rpm) ? C.fmtRaw(x.spin_rpm) + ' rpm' : null,
      mis ? 'likely mis-hit (left out of the numbers)' : null
    ].filter(Boolean).join(' · ');
    return `<div class="shot"><div class="main">${esc(main)}</div><div class="meta">${esc(sub)}${x.note ? ' — ' + esc(x.note) : ''}</div>
      <button class="icon-btn" data-action="delete-shot" data-idx="${idx}" aria-label="Delete shot ${esc(x.club)} ${esc(x.time || '')}">×</button></div>`;
  }

  // ----- Enter a shot -----
  const ENTRY_FIELDS = [
    { key: 'carry_yds', label: 'Carry (yds)', req: true }, { key: 'total_yds', label: 'Total (yds)' },
    { key: 'ball_speed_mph', label: 'Ball speed (mph)' }, { key: 'launch_deg', label: 'Launch (°)' },
    { key: 'apex_ft', label: 'Apex (ft)' }, { key: 'landing_deg', label: 'Landing (°)' },
    { key: 'hang_time_s', label: 'Hang time (s)' }, { key: 'club_speed_mph', label: 'Club speed (mph)' },
    { key: 'spin_rpm', label: 'Spin (rpm)' }
  ];
  function knownClubs() {
    const set = new Set(Object.keys(C.clubData(data.sessions)).concat(Object.keys(data.clubs || {})));
    if (ui.entry.club) set.add(ui.entry.club);
    return C.sortClubs(Array.from(set));
  }
  function entryForm() {
    const clubs = knownClubs();
    const dirField = (key, label) => `<div class="field"><label for="e_${key}">${label}</label><div class="lr">
      <button type="button" class="chip" data-action="entry-dir" data-key="${key}" data-dir="L" aria-pressed="${ui.entry.dir[key] === 'L'}" aria-label="${label} left">L</button>
      <input id="e_${key}" type="number" inputmode="decimal" min="0" step="any" placeholder="0">
      <button type="button" class="chip" data-action="entry-dir" data-key="${key}" data-dir="R" aria-pressed="${ui.entry.dir[key] === 'R'}" aria-label="${label} right">R</button></div></div>`;
    return `
      <div class="field"><span class="label">Club <span class="req">*</span></span>
        <div class="chips" id="entryClubs">${clubs.map((c) => `<button type="button" class="chip" data-action="entry-club" data-club="${esc(c)}" aria-pressed="${c === ui.entry.club}">${esc(c)}</button>`).join('')}
          <button type="button" class="chip" data-action="entry-other" aria-pressed="${ui.entry.other}">Other…</button></div>
        <select id="entryOther" data-change="entry-other-club" style="margin-top:10px"${ui.entry.other ? '' : ' hidden'} aria-label="Another club"><option value="">Pick another club</option>
          ${C.STANDARD_CLUBS.filter((c) => clubs.indexOf(c) < 0).map((c) => `<option value="${c}">${esc(C.clubName(c))} (${c})</option>`).join('')}</select>
      </div>
      <div class="grid2">${ENTRY_FIELDS.map((f) => `<div class="field"><label for="e_${f.key}">${f.label}${f.req ? ' <span class="req">*</span>' : ''}</label><input id="e_${f.key}" type="number" inputmode="decimal" step="any"></div>`).join('')}</div>
      ${dirField('curve_ft', 'Curve (ft)')}${dirField('offline_ft', 'Offline (ft)')}
      <div class="grid2"><div class="field"><label for="e_time">Time</label><input id="e_time" type="time" value="${nowHHMM()}"></div>
        <div class="field"><label for="e_note">Note</label><input id="e_note" type="text" placeholder="optional"></div></div>
      <button class="btn block" data-action="save-shot">Save shot</button>
      <p class="hint">Only the club and carry are needed. Leave anything you don’t have blank.</p>`;
  }
  function nextShotId(s) {
    const shots = (s.shots || []).filter(Boolean);
    const ids = new Set(shots.map((x) => x.id));
    const ms = shots.map((x) => /^(.*?)(\d+)$/.exec(x.id || '')).filter(Boolean);
    let prefix = s.id + '-', width = 3, n = shots.length + 1;
    if (ms.length && ms.length === shots.length && ms.every((m) => m[1] === ms[0][1])) {
      prefix = ms[0][1]; width = ms[0][2].length; n = Math.max(...ms.map((m) => +m[2])) + 1;
    }
    let id;
    do { id = prefix + String(n).padStart(width, '0'); n++; } while (ids.has(id));
    return id;
  }
  function finalizeShot(session, src) {
    const shot = { id: nextShotId(session), time: src.time || null, club: src.club };
    C.CORE_KEYS.forEach((k) => { shot[k] = C.isNum(src[k]) ? src[k] : null; });
    OPTIONAL_KEYS.forEach((k) => { if (C.isNum(src[k])) shot[k] = src[k]; });
    if (src.note) shot.note = src.note;
    return shot;
  }
  function saveShot() {
    const s = getSession(ui.sessionId);
    if (!s) return;
    const club = ui.entry.club;
    if (!club) { toast('Pick a club first'); return; }
    const src = { club, time: C.normTime($('#e_time').value) };
    for (const f of ENTRY_FIELDS) {
      const raw = $('#e_' + f.key).value.trim();
      src[f.key] = raw === '' ? null : parseFloat(raw);
      if (src[f.key] != null && !isFinite(src[f.key])) src[f.key] = null;
    }
    for (const k of ['curve_ft', 'offline_ft']) {
      const raw = $('#e_' + k).value.trim();
      let v = raw === '' ? null : parseFloat(raw);
      if (v != null && !isFinite(v)) v = null;
      const d = ui.entry.dir[k];
      if (v != null && v !== 0 && !d) { toast(`Tap L or R for ${k === 'curve_ft' ? 'curve' : 'offline'}`); return; }
      src[k] = v == null ? null : Math.abs(v) * (d === 'L' ? -1 : 1) || 0;
    }
    if (!C.isNum(src.carry_yds) || src.carry_yds <= 0) { toast('Enter the carry distance'); $('#e_carry_yds').focus(); return; }
    const note = $('#e_note').value.trim();
    if (note) src.note = note;
    editSession(s.id, (x) => {
      if (x.shot_level_data === false) x.shot_level_data = true;
      x.shots.push(finalizeShot(x, src));
    });
    ui.entry.dir = { curve_ft: null, offline_ft: null };
    toast(`${club} · ${C.fmtRaw(src.carry_yds)} yds saved`);
    const c = $('#e_carry_yds');
    if (c) c.focus();
  }

  // ----- Paste rows. The preview only looks at ui.imp.parsed (rows of cells),
  // so another importer (a photo/OCR reader, say) can feed it the same way. -----
  function pasteForm() {
    const imp = ui.imp;
    const kc = knownClubs();
    const clubs = kc.concat(C.STANDARD_CLUBS.filter((c) => kc.indexOf(c) < 0));
    const seg = (k, v, label) => `<button data-action="imp-unit" data-k="${k}" data-v="${v}" aria-pressed="${imp[k] === v}">${label}</button>`;
    return `
      <div class="field"><label for="pasteText">Rows from a Toptracer screen or a Rapsodo CSV export</label>
        <textarea id="pasteText" rows="6" data-input="paste-text" spellcheck="false" autocapitalize="off" placeholder="12:52 PM 5w 136 150 106 11 41 30 47 ▶ 76 ▶&#10;or paste a Rapsodo CSV with its header row">${esc(imp.text)}</textarea>
        <p class="hint">One shot per line. Without a header row, numbers are read in Toptracer order: carry, total, ball speed, launch, apex, landing, (hang time), curve, offline. ◀ before a number means left; ▶ after it means right. A line with only a club (like “7 iron”) sets the club for the rows under it. Newest-first lists are put back in order.</p>
      </div>
      <div class="field"><label for="impClub">Club for rows without one</label><select id="impClub" data-change="imp-club"><option value="">None</option>
        ${clubs.map((c) => `<option value="${esc(c)}"${c === imp.defaultClub ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="grid2">
        <div class="field"><span class="label">Curve and offline in</span><div class="seg">${seg('lateralUnit', 'ft', 'ft')}${seg('lateralUnit', 'yd', 'yds')}</div></div>
        <div class="field"><span class="label">Apex in</span><div class="seg">${seg('apexUnit', 'ft', 'ft')}${seg('apexUnit', 'yd', 'yds')}</div></div>
      </div>
      <div id="impPreview" aria-live="polite"></div>`;
  }
  function fieldOptions(sel) {
    const opts = [['ignore', 'Ignore'], ['club', 'Club'], ['time', 'Time']].concat(C.METRICS.map((m) => [m.key, m.label + (m.unit ? ` (${m.dir ? 'ft' : m.unit})` : '')]));
    return opts.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }
  function setImportParsed(parsed) {
    const imp = ui.imp;
    imp.parsed = parsed;
    const sig = parsed ? (parsed.hasHeader ? 'h' : 'n') + parsed.nCols + '|' + parsed.columns.join(',') : '';
    if (sig !== imp.sig || !imp.columns) { imp.columns = parsed ? parsed.columns.slice() : null; imp.sig = sig; }
    renderImportPreview();
  }
  function importRows() {
    const imp = ui.imp, p = imp.parsed;
    if (!p || !p.rows.length) return [];
    const built = C.buildShots(p, imp.columns, { lateralUnit: imp.lateralUnit, apexUnit: imp.apexUnit, defaultClub: imp.defaultClub || null });
    built.forEach((b, i) => {
      ['curve_ft', 'offline_ft'].forEach((f) => { if (imp.flips[i + ':' + f] && C.isNum(b.shot[f]) && b.shot[f] !== 0) b.shot[f] = -b.shot[f]; });
      if (imp.include[i] !== undefined) b.include = imp.include[i] && !!b.shot.club;
    });
    return built;
  }
  function previewCell(b, f, cell, i) {
    if (f === 'ignore') return `<td class="muted">${esc(cell || '')}</td>`;
    if (f === 'club') return `<td>${esc(b.shot.club || '—')}</td>`;
    if (f === 'time') return `<td>${esc(b.shot.time || '—')}</td>`;
    const v = b.shot[f], m = C.METRIC[f];
    const shown = C.isNum(v) ? (m.dir ? C.fmtRawDir(v) : C.fmtRaw(v)) : '—';
    if (m.dir && C.isNum(v) && v !== 0) {
      return `<td class="${b.bad[f] ? 'bad' : ''}"><button type="button" class="flip" data-action="imp-flip" data-i="${i}" data-f="${f}" title="Tap to flip left/right" aria-label="${esc(m.label)} ${esc(shown)}, tap to flip left or right">${esc(shown)}</button></td>`;
    }
    return `<td class="${b.bad[f] ? 'bad' : ''}">${esc(shown)}</td>`;
  }
  function renderImportPreview() {
    const box = $('#impPreview');
    if (!box) return;
    const imp = ui.imp, p = imp.parsed;
    if (!p || !imp.text.trim()) { box.innerHTML = ''; return; }
    if (!p.rows.length) { box.innerHTML = '<p class="empty">No shot rows found yet.</p>'; return; }
    if (!imp.columns || imp.columns.length !== p.nCols) imp.columns = p.columns.slice();
    const built = importRows();
    const included = built.filter((b) => b.include);
    const cols = imp.columns;
    const facts = [plural(built.length, 'row'), p.hasHeader ? 'header row found' : 'no header: Toptracer order', p.reversed ? 'newest-first list put back in order' : ''].filter(Boolean).join(' · ');
    box.innerHTML = `
      <p class="hint">${esc(facts)}. Check the columns, untick rows you don’t want, and tap a curve or offline value to flip L/R.</p>
      <div class="table-wrap"><table class="preview">
        <thead><tr><th>Add</th><th>Club</th>${cols.map((f, j) => `<th><select data-change="imp-col" data-j="${j}" aria-label="Column ${j + 1}">${fieldOptions(f)}</select>${p.headerLabels && p.headerLabels[j] ? `<span class="raw-h">${esc(p.headerLabels[j])}</span>` : ''}</th>`).join('')}<th>Check</th></tr></thead>
        <tbody>${built.map((b, i) => `<tr class="${b.include ? '' : 'off'}"><td><input type="checkbox" data-change="imp-inc" data-i="${i}"${b.include ? ' checked' : ''} aria-label="Add row ${i + 1}"></td><td>${esc(b.shot.club || '—')}</td>${cols.map((f, j) => previewCell(b, f, p.rows[i].cells[j], i)).join('')}<td class="warn">${esc(b.warn.join('; '))}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="row-actions"><button class="btn" data-action="imp-add"${included.length ? '' : ' disabled'}>Add ${plural(included.length, 'shot')}</button><button class="btn ghost" data-action="imp-clear">Clear</button></div>`;
  }
  function resetImport() {
    Object.assign(ui.imp, { text: '', parsed: null, include: {}, flips: {}, sig: '', columns: null });
  }
  function addImported() {
    const rows = importRows().filter((b) => b.include);
    if (!rows.length) return;
    editSession(ui.sessionId, (x) => {
      if (x.shot_level_data === false) x.shot_level_data = true;
      rows.forEach((b) => x.shots.push(finalizeShot(x, b.shot)));
    });
    resetImport();
    renderSessions();
    toast(`Added ${plural(rows.length, 'shot')}`);
  }

  // ----- Data & backup (inside Sessions) -----
  function localCounts() {
    const added = local.sessions.filter((s) => !fileSession(s.id)).length;
    const edited = local.sessions.length - added;
    const other = (local.player ? 1 : 0) + (local.baselineSessionId != null ? 1 : 0);
    return { added, edited, hidden: local.hidden.length, other, total: local.sessions.length + local.hidden.length + other };
  }
  function renderData(el) {
    const c = localCounts();
    const file = playerInfo().file;
    const status = { fresh: 'Loaded', offline: 'Offline, using the last downloaded copy of', missing: 'Couldn’t load', loading: 'Loading' }[bundleStatus];
    const parts = [];
    if (c.added) parts.push(`${c.added} added`);
    if (c.edited) parts.push(`${c.edited} edited`);
    if (c.hidden) parts.push(`${c.hidden} deleted`);
    el.innerHTML = `
      <button class="back" data-action="close-data">← Sessions</button>
      <h2 style="margin-top:6px">Data &amp; backup</h2>
      <p class="lead">For ${esc(playerName())}. Each person’s data and backups are separate.</p>
      <div class="card"><h3 class="card-title">Player</h3><div class="grid2">
        <div class="field"><label for="pName">Name</label><input id="pName" type="text" data-change="player" data-k="name" value="${esc(data.player.name || '')}"></div>
        <div class="field"><label for="pLevel">Level</label><input id="pLevel" type="text" data-change="player" data-k="level" value="${esc(data.player.level || '')}"></div>
      </div></div>
      <div class="card"><h3 class="card-title">Progress baseline</h3>
        ${data.sessions.length ? `<div class="field"><label for="baseSel">Baseline session</label>
          <select id="baseSel" data-change="baseline"><option value="">First session for each club</option>${data.sessions.slice().reverse().map((s) => `<option value="${esc(s.id)}"${s.id === data.baseline_session_id ? ' selected' : ''}>${esc(C.fmtDate(s.date))} · ${esc(C.shortDevice(s.device))}</option>`).join('')}</select></div>` : '<p class="empty">No sessions yet.</p>'}
        <p class="hint">Progress compares each club with this session. A club it doesn’t include uses its own first session.</p></div>
      <div class="card"><h3 class="card-title">Backup</h3>
        <p class="note">${esc(status)} <code>${esc(file)}</code>${bundle && bundleStatus !== 'missing' ? ` (${plural(fileSessions().length, 'session')})` : ''}.</p>
        <p class="note" style="margin-top:8px">On this device: ${parts.length ? esc(parts.join(', ')) + (c.added + c.edited + c.hidden === 1 ? ' session' : ' sessions') : 'no session changes'}${c.other ? `, plus ${c.other === 1 ? 'one setting' : c.other + ' settings'}` : ''}.</p>
        <div class="row-actions">
          <button class="btn small" data-action="export-json">Export JSON</button>
          <button class="btn small" data-action="export-csv">Export CSV</button>
          <button class="btn small ghost" data-action="import-json">Import JSON</button>
          <button class="btn small danger" data-action="reset-local"${c.total ? '' : ' disabled'}>Reset local changes</button>
        </div>
        <p class="hint">Sessions added or edited here are saved in this browser only. To share them, export the JSON and replace <code>${esc(file)}</code> in the repo; every device then picks them up. Import merges sessions by id.</p>
      </div>`;
  }
  function exportObject() {
    const b = bundle || {};
    const clubs = Object.assign({}, data.clubs);
    data.sessions.forEach((s) => C.sessionShots(s).forEach((x) => { if (x.club && !clubs[x.club]) clubs[x.club] = C.clubName(x.club); }));
    const out = { player: data.player };
    if (b.units) out.units = b.units;
    if (b.sign_convention) out.sign_convention = b.sign_convention;
    out.clubs = clubs;
    out.baseline_session_id = data.baseline_session_id;
    out.sessions = data.sessions.map(stripUI);
    return out;
  }
  function exportName(ext) { return (playerInfo().file.split('/').pop() || playerId + '_golf_data.json').replace(/\.json$/, '') + ext; }
  function exportCSV() {
    const cols = ['session_id', 'date', 'device', 'shot_id', 'time', 'club'].concat(C.METRICS.map((m) => m.key), ['likely_mishit', 'note']);
    const q = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    const lines = [cols.join(',')];
    data.sessions.forEach((s) => {
      const mis = C.sessionMishits([s]);
      C.sessionShots(s).forEach((x) => {
        lines.push([s.id, s.date, s.device, x.id, x.time, x.club].concat(C.METRICS.map((m) => C.metricValue(x, m.key)), [mis.has(x) ? 'yes' : '', x.note]).map(q).join(','));
      });
    });
    download(exportName('.csv'), lines.join('\n'), 'text/csv');
  }
  function importData(d) {
    const sessions = Array.isArray(d) ? d : d && d.sessions;
    if (!Array.isArray(sessions)) throw new Error('No sessions in that file');
    const clean = sessions.filter((s) => s && typeof s === 'object').map((s, i) => {
      const o = clone(s);
      delete o._source;
      if (!o.id) o.id = (o.date || todayISO()) + '-import-' + (i + 1);
      if (!Array.isArray(o.shots)) o.shots = [];
      return o;
    });
    const existing = new Set(data.sessions.map((s) => s.id));
    const nNew = clean.filter((s) => !existing.has(s.id)).length;
    if (!confirm(`Import ${plural(clean.length, 'session')} into ${playerName()}’s data? ${nNew} new, ${clean.length - nNew} replacing a session with the same id.`)) return false;
    clean.forEach((s) => {
      local.sessions = local.sessions.filter((x) => x.id !== s.id);
      local.hidden = local.hidden.filter((id) => id !== s.id);
      const f = fileSession(s.id);
      if (!(f && JSON.stringify(f) === JSON.stringify(s))) local.sessions.push(s);
    });
    if (!Array.isArray(d)) {
      const b = bundle || {};
      if (d.player && JSON.stringify(d.player) !== JSON.stringify(b.player)) local.player = d.player;
      if (d.baseline_session_id && d.baseline_session_id !== b.baseline_session_id) local.baselineSessionId = d.baseline_session_id;
      if (d.clubs && typeof d.clubs === 'object') {
        const extra = {};
        Object.keys(d.clubs).forEach((k) => { if (!b.clubs || b.clubs[k] !== d.clubs[k]) extra[k] = d.clubs[k]; });
        if (Object.keys(extra).length) local.clubs = Object.assign({}, local.clubs, extra);
      }
    }
    saveLocal();
    refresh();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  const actions = {
    tab(b) { ui.tab = b.dataset.tab; ui.openTip = null; hideTip(); render(); window.scrollTo(0, 0); },
    player(b) { if (b.dataset.id !== playerId) switchPlayer(b.dataset.id); },
    'disp-club'(b) { ui.dispClub = b.dataset.club; renderStats(); },
    'stat-club'(b) { ui.statClub = b.dataset.club; renderStats(); },
    'focus-club'(b) {
      ui.statClub = b.dataset.club; renderStats();
      const sec = $('#clubSection'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'goto-tip'(b) {
      ui.tab = 'tips'; ui.openTip = b.dataset.tip; hideTip(); render();
      const d = $(`details[data-focus="${b.dataset.tip}"]`);
      if (d) d.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
    },
    'prog-club'(b) { ui.progClub = b.dataset.club; renderProgress(); },
    'goto-notes'(b) { Object.assign(ui, { tab: 'sessions', sessionsView: 'list', sessionId: b.dataset.id, editNotes: true, addMode: null }); render(); window.scrollTo(0, 0); },
    'open-data'() { ui.sessionsView = 'data'; ui.sessionId = null; renderSessions(); window.scrollTo(0, 0); },
    'close-data'() { ui.sessionsView = 'list'; renderSessions(); window.scrollTo(0, 0); },
    'new-session'() { ui.newSession = true; renderSessions(); const d = $('#nsDate'); if (d) d.focus(); },
    'cancel-new-session'() { ui.newSession = false; renderSessions(); },
    'create-session'() { createSession(); },
    'open-session'(b) { Object.assign(ui, { sessionsView: 'list', sessionId: b.dataset.id, editNotes: false, addMode: null }); resetImport(); renderSessions(); window.scrollTo(0, 0); },
    'close-session'() { ui.sessionId = null; ui.editNotes = false; renderSessions(); window.scrollTo(0, 0); },
    'revert-session'() {
      if (confirm('Discard this device’s changes to this session and go back to the version in the data file?')) { revertSession(ui.sessionId); toast('Reverted to the file version'); }
    },
    'delete-session'() {
      const s = getSession(ui.sessionId);
      if (!s) return;
      const inFile = !!fileSession(s.id);
      if (!confirm(`Delete the ${C.fmtDate(s.date)} session${shotCount(s) ? ` and its ${plural(shotCount(s), 'shot')}` : ''}?${inFile ? ' It stays in the data file; this hides it on this device (Reset local changes brings it back).' : ''}`)) return;
      ui.sessionId = null;
      deleteSession(s.id);
      toast('Session deleted');
    },
    'edit-notes'() { ui.editNotes = true; renderSessions(); const t = $('#notesText'); if (t) t.focus(); },
    'cancel-notes'() { ui.editNotes = false; renderSessions(); },
    'save-notes'() {
      const lines = $('#notesText').value.split('\n').map((x) => x.trim()).filter(Boolean);
      ui.editNotes = false;
      editSession(ui.sessionId, (x) => { x.coaching_notes = lines; });
      toast('Notes saved');
    },
    'add-mode'(b) { ui.addMode = b.dataset.mode; renderSessions(); },
    'entry-club'(b) {
      ui.entry.club = b.dataset.club; ui.entry.other = false;
      $$('[data-action="entry-club"]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('[data-action="entry-other"]').setAttribute('aria-pressed', 'false');
      const sel = $('#entryOther'); if (sel) { sel.hidden = true; sel.value = ''; }
    },
    'entry-other'(b) {
      ui.entry.other = !ui.entry.other;
      b.setAttribute('aria-pressed', String(ui.entry.other));
      const sel = $('#entryOther'); if (sel) { sel.hidden = !ui.entry.other; if (ui.entry.other) sel.focus(); }
    },
    'entry-dir'(b) {
      const k = b.dataset.key, d = b.dataset.dir;
      ui.entry.dir[k] = ui.entry.dir[k] === d ? null : d;
      $$(`[data-action="entry-dir"][data-key="${k}"]`).forEach((x) => x.setAttribute('aria-pressed', String(ui.entry.dir[k] === x.dataset.dir)));
    },
    'save-shot'() { saveShot(); },
    'delete-shot'(b) {
      const s = getSession(ui.sessionId), idx = +b.dataset.idx;
      const x = s && s.shots && s.shots[idx];
      if (!x || !confirm(`Delete this ${x.club} shot${C.isNum(x.carry_yds) ? ` (${C.fmtRaw(x.carry_yds)} yds)` : ''}?`)) return;
      editSession(s.id, (y) => { y.shots.splice(idx, 1); });
      toast('Shot deleted');
    },
    'imp-unit'(b) {
      ui.imp[b.dataset.k] = b.dataset.v;
      $$(`[data-action="imp-unit"][data-k="${b.dataset.k}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === b.dataset.v)));
      renderImportPreview();
    },
    'imp-flip'(b) { const k = b.dataset.i + ':' + b.dataset.f; ui.imp.flips[k] = !ui.imp.flips[k]; renderImportPreview(); },
    'imp-add'() { addImported(); },
    'imp-clear'() { resetImport(); renderSessions(); },
    'export-json'() { download(exportName('.json'), JSON.stringify(exportObject(), null, 2), 'application/json'); },
    'export-csv'() { exportCSV(); },
    'import-json'() { $('#importFile').click(); },
    'reset-local'() {
      if (!confirm(`Discard every change made on this device to ${playerName()}’s data (added, edited and deleted sessions, and settings) and go back to the data file?`)) return;
      local = emptyLocal(); saveLocal(); ui.sessionId = null; refresh(); toast('Local changes reset');
    }
  };
  const changes = {
    scope(el) { ui.scope = el.value; renderStats(); },
    'prog-metric'(el) { ui.progMetric = el.value; renderProgress(); },
    'ns-device'(el) { $('#nsOtherWrap').hidden = el.value !== 'other'; },
    'entry-other-club'(el) {
      ui.entry.club = el.value || null;
      $$('[data-action="entry-club"]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    },
    'imp-club'(el) { ui.imp.defaultClub = el.value; renderImportPreview(); },
    'imp-col'(el) { ui.imp.columns[+el.dataset.j] = el.value; renderImportPreview(); },
    'imp-inc'(el) { ui.imp.include[+el.dataset.i] = el.checked; renderImportPreview(); },
    player(el) {
      const p = Object.assign({}, data.player);
      p[el.dataset.k] = el.value.trim();
      local.player = bundle && JSON.stringify(bundle.player) === JSON.stringify(p) ? null : p;
      saveLocal(); data = merge(); renderHeader(); toast('Saved');
    },
    baseline(el) {
      const fileBase = bundle ? bundle.baseline_session_id || '' : '';
      local.baselineSessionId = el.value === fileBase ? null : el.value;
      saveLocal(); refresh(); toast('Baseline updated');
    }
  };
  let pasteTimer;
  const inputs = {
    'paste-text'(el) {
      ui.imp.text = el.value;
      ui.imp.include = {}; ui.imp.flips = {};
      clearTimeout(pasteTimer);
      pasteTimer = setTimeout(() => setImportParsed(ui.imp.text.trim() ? C.parsePaste(ui.imp.text) : null), 150);
    }
  };
  function createSession() {
    const date = $('#nsDate').value || todayISO();
    let dev = $('#nsDevice').value;
    if (dev === 'other') dev = ($('#nsOther').value || '').trim() || 'Other';
    const loc = $('#nsLoc').value.trim();
    const notes = $('#nsNotes').value.split('\n').map((x) => x.trim()).filter(Boolean);
    const base = date + '-' + slug(C.shortDevice(dev));
    let id = base, n = 2;
    while (getSession(id) || local.hidden.indexOf(id) >= 0 || fileSession(id)) id = base + '-' + n++;
    const s = { id, date, device: dev };
    const bay = /^bay\s*#?\s*(\d+)$/i.exec(loc);
    if (bay) s.bay = +bay[1]; else if (loc) s.location = loc;
    s.shot_level_data = true;
    s.notes = [];
    s.coaching_notes = notes;
    s.shots = [];
    local.sessions.push(s);
    saveLocal();
    Object.assign(ui, { newSession: false, sessionId: id, editNotes: false, addMode: /toptracer|rapsodo/i.test(dev) ? 'paste' : 'enter' });
    resetImport();
    refresh();
    window.scrollTo(0, 0);
    toast('Session created');
  }

  // Tooltip: hover with a mouse, tap on touch, focus with the keyboard.
  const tip = $('#tip');
  let tipFor = null;
  function showTip(target) {
    const lines = (target.getAttribute('data-tip') || '').split('\n').filter(Boolean);
    if (!lines.length) return;
    tip.textContent = '';
    lines.forEach((l, i) => { const d = document.createElement('div'); d.className = i ? 'tl' : 'tv'; d.textContent = l; tip.appendChild(d); });
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
    let top = r.top - th - 10;
    if (top < 8) top = r.bottom + 10;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tipFor = target;
  }
  function hideTip() { tip.hidden = true; tipFor = null; }
  const closestTip = (el) => (el && el.closest ? el.closest('[data-tip]') : null);
  document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') { const t = closestTip(e.target); if (t) showTip(t); } });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = closestTip(e.target);
    if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip();
  });
  document.addEventListener('focusin', (e) => { const t = closestTip(e.target); if (t) showTip(t); });
  document.addEventListener('focusout', (e) => { if (tipFor && e.target === tipFor) hideTip(); });
  window.addEventListener('scroll', hideTip, { passive: true });

  document.addEventListener('click', (e) => {
    const t = closestTip(e.target);
    if (t) showTip(t); else if (!e.target.closest('#tip')) hideTip();
    const a = e.target.closest ? e.target.closest('[data-action]') : null;
    if (a && actions[a.dataset.action] && !a.disabled) actions[a.dataset.action](a, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest ? e.target.closest('[data-change]') : null;
    if (el && changes[el.dataset.change]) changes[el.dataset.change](el, e);
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest ? e.target.closest('[data-input]') : null;
    if (el && inputs[el.dataset.input]) inputs[el.dataset.input](el, e);
  });
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (importData(JSON.parse(await file.text()))) toast('Imported');
    } catch (err) {
      toast('That file isn’t a tracker JSON file');
    }
  });

  // Charts are drawn at the real pixel width, so redraw when the width changes.
  let lastW = window.innerWidth, resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      hideTip();
      if (ui.tab === 'stats') renderStats(); else if (ui.tab === 'progress') renderProgress();
    }, 150);
  });

  // ---------------------------------------------------------------------------
  // Start: draw from cached copies right away, then refresh from the files.
  // ---------------------------------------------------------------------------
  function fetchBundle() {
    const id = playerId, file = playerInfo().file;
    fetch(file, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => {
        if (id !== playerId) return;
        if (!d || !Array.isArray(d.sessions)) throw new Error('Unexpected data file');
        const changed = JSON.stringify(d) !== JSON.stringify(bundle);
        bundle = d;
        bundleStatus = 'fresh';
        saveJSON(key('bundle'), d);
        if (changed || !data.sessions.length) refresh(); else renderBanner();
      })
      .catch(() => {
        if (id !== playerId) return;
        bundleStatus = bundle ? 'offline' : 'missing';
        refresh();
      });
  }
  function fetchPlayers() {
    fetch(REGISTRY_URL, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => {
        const list = validPlayers(d && d.players);
        if (!list) return;
        players = list;
        saveJSON(LS + '.players', list);
        const want = C.resolvePlayer(players, urlPlayer(), lastPlayer());
        if (want !== playerId) switchPlayer(want); else renderHeader();
      })
      .catch(() => { /* keep the cached or built-in list */ });
  }

  loadPlayerState();
  setURL();
  try { localStorage.setItem(LS + '.lastPlayer', playerId); } catch (e) { /* ignore */ }
  render();
  fetchBundle();
  fetchPlayers();
})();
