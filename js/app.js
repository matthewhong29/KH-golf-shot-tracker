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
  // Where goals are saved when a phone has a GitHub key (players.json "github" overrides this).
  const DEFAULT_GITHUB = { repo: 'matthewhong29/KH-golf-shot-tracker', branch: 'main' };
  function validGithub(g) { return g && /^[\w.-]+\/[\w.-]+$/.test(g.repo || '') ? { repo: g.repo, branch: g.branch || 'main' } : null; }

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
  let github = validGithub(loadJSON(LS + '.github')) || DEFAULT_GITHUB;
  let playerId = C.resolvePlayer(players, urlPlayer(), lastPlayer());
  let bundle = null;            // this player's data file
  let bundleStatus = 'loading'; // loading | fresh | offline | missing
  let local = null;             // this player's edits on this device
  let data = null;              // merged view
  const ui = freshUI();

  function freshUI() {
    return {
      tab: 'stats', scope: null, dispClub: 'All', progClub: null, progMetric: 'carry_yds', statClub: null, openTip: null,
      goalsEdit: false, goalsAll: false, goalSrc: 'me', practiceClub: null, check: {}, practiceView: 'range', rvFrame: {}, rvMarks: true,
      sessionsView: 'list', sessionId: null, newSession: false, addMode: null, editNotes: false,
      entry: { club: null, other: false, dir: { curve_ft: null, offline_ft: null } },
      imp: { text: '', parsed: null, columns: null, sig: '', include: {}, flips: {}, defaultClub: '', lateralUnit: 'ft', apexUnit: 'ft' }
    };
  }
  function playerInfo() { return players.find((p) => p.id === playerId) || players[0]; }
  function key(kind) { return LS + '.' + playerId + '.' + kind; }
  // Goals changed on this device: new ones, edits (done/text) and removals of file goals.
  function emptyGoals() { return { added: [], edits: {}, removed: [] }; }
  function emptyLocal() { return { sessions: [], hidden: [], player: null, baselineSessionId: null, goals: emptyGoals() }; }
  function loadLocal() {
    const d = loadJSON(key('local'));
    const l = d && Array.isArray(d.sessions) ? Object.assign(emptyLocal(), d) : emptyLocal();
    l.goals = Object.assign(emptyGoals(), l.goals || {});
    return l;
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
      equipment: b.equipment || null,
      // local.baselineSessionId: null = use the file's; '' = none (first session per club)
      baseline_session_id: local.baselineSessionId != null ? (local.baselineSessionId || null) : (b.baseline_session_id || null),
      goals: C.mergeGoals(b.personal_goals, local.goals),
      reviews: (Array.isArray(b.swing_reviews) ? b.swing_reviews : [])
        .filter((r) => r && r.id && Array.isArray(r.frames) && r.frames.length)
        .slice().sort((x, y) => String(y.date || '').localeCompare(String(x.date || ''))),
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
  // Line icons on a 24px grid, drawn in the current text colour.
  const ICONS = {
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    flag: '<path d="M6 21V4"/><path d="M6 4.5h11l-2.2 4 2.2 4H6"/>',
    bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
    launch: '<path d="M3 20h18"/><path d="M4.5 20 18 6.5"/><path d="M11.5 20a7.5 7.5 0 0 0-2.2-5.3"/>',
    line: '<path d="M12 21V4"/><path d="M7 9l5-5 5 5"/>',
    chevron: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 6.5v7"/><path d="M12 17.5h.01"/>',
    play: '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/>',
    coach: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    data: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    stack: '<path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5 12 21l9-4.5"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    pause: '<path d="M9 5.5v13M15 5.5v13"/>',
    run: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'
  };
  function icon(name, cls) {
    return `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function dateParts(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return null;
    return { mon: MONTHS[+m[2] - 1], day: +m[3], weekday: WEEKDAYS[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] };
  }
  function longDate(iso) { const d = dateParts(iso); return (d ? d.weekday + ', ' : '') + C.fmtDate(iso); }
  // A tear-off calendar tile for a session date.
  function calTile(iso) {
    const d = dateParts(iso);
    return d ? `<span class="sc-cal" aria-hidden="true"><span class="sc-mon">${d.mon}</span><span class="sc-day">${d.day}</span></span>` : '';
  }
  function clubBadge(c, small, hidden) {
    return `<span class="club-badge${small ? ' sm' : ''}${String(c).length > 3 ? ' long' : ''}"${hidden ? ' aria-hidden="true"' : ''}>${esc(c)}</span>`;
  }
  // "Lynx Black Cat · 33° loft" when the data file lists the player's clubs.
  function clubSpecLine(c) {
    const spec = C.clubSpec(c, data.equipment), loft = C.clubLoft(c, data.equipment);
    return [spec && spec.model, loft != null ? `${C.fmtRaw(loft)}° loft` : ''].filter(Boolean).join(' · ');
  }
  function clubHead(c) {
    const spec = clubSpecLine(c);
    return `<div class="cc-head">${clubBadge(c, false, true)}<span class="cc-titles"><span class="cc-name">${esc(C.clubName(c, data.clubs))}</span>${spec ? `<span class="cc-full">${esc(spec)}</span>` : ''}</span></div>`;
  }
  // A stat tile: label, a big number with a small unit, then an optional meter, note and change.
  function kpi(o) {
    const pct = o.meter == null ? null : Math.max(0, Math.min(100, o.meter));
    const d = o.delta;
    return `<div class="kpi${o.flag ? ' work' : ''}"><span class="kpi-l">${esc(o.label)}</span>
      <span class="kpi-v">${esc(o.value)}${o.unit ? ` <span class="kpi-u">${esc(o.unit)}</span>` : ''}</span>
      ${pct != null ? `<span class="meter" aria-hidden="true"><span style="width:${f1(pct)}%"></span></span>` : ''}
      ${o.sub ? `<span class="kpi-s">${esc(o.sub)}</span>` : ''}
      ${d ? `<span class="kpi-d ${d.cls}">${d.dir ? `<span aria-hidden="true">${d.dir === 'up' ? '▲' : '▼'} </span><span class="sr">${d.dir === 'up' ? 'Up' : 'Down'} </span>` : ''}${esc(d.text)}</span>` : ''}
      ${o.html || ''}
      ${o.flag ? '<span class="kpi-d nw">Needs work</span>' : ''}</div>`;
  }
  // "1.9" and "yds right", for a big number with its direction spelled out.
  function dirSplit(v, unit, dec) {
    if (!C.isNum(v)) return { value: '—', unit: '' };
    const m = /^(.*?)(?: ([LR]))?$/.exec(dec == null ? C.fmtRawDir(v) : C.fmtDir(v, dec));
    return { value: m[1], unit: unit + (m[2] ? (m[2] === 'L' ? ' left' : ' right') : '') };
  }
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
    artStop();
    renderHeader();
    renderGoals();
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
    $('#who').innerHTML = [pl.level ? cap(pl.level) : '', C.isNum(pl.age) ? 'Age ' + pl.age : '', C.fmtHeight(pl.height_in)]
      .filter(Boolean).map((t) => `<span class="who-chip">${esc(t)}</span>`).join('');
    document.title = playerName() + ' · KH Golf';
    const meta = $('meta[name="apple-mobile-web-app-title"]');
    if (meta) meta.setAttribute('content', playerName() + ' · Golf');
  }
  // ----- Goals pinned above every tab: personal goals and goals from a coach -----
  const GOALS_SHOWN = 3;
  function goalBadge(g) { return `<span class="gb-src ${g.source === 'coach' ? 'coach' : 'me'}">${g.source === 'coach' ? 'From coach' : 'My goal'}</span>`; }
  function renderGoals() {
    const el = $('#goalsBar');
    if (!el) return;
    const goals = data.goals || [];
    const active = goals.filter((g) => !g.done), done = goals.filter((g) => g.done);
    const title = `<span class="gb-title"><span class="gb-ico">${icon('target')}</span>${esc(playerName())}’s goals</span>`;
    if (ui.goalsEdit) {
      const row = (g) => `<li class="${g.done ? 'done' : ''}"><div class="gb-body"><span class="gb-text">${esc(g.text)}</span>${goalBadge(g)}</div>
        <button class="btn small ghost" data-action="goal-done" data-id="${esc(g.id)}">${g.done ? 'Undo' : 'Done'}</button>
        <button class="btn small danger" data-action="goal-remove" data-id="${esc(g.id)}" aria-label="Remove “${esc(g.text)}”">Remove</button></li>`;
      el.innerHTML = `<div class="gb">
        <div class="gb-head">${title}<button class="btn small" data-action="goals-close">Finish</button></div>
        <div class="gb-add">
          <label for="goalText">New goal</label>
          <input id="goalText" type="text" maxlength="140" placeholder="e.g. Hold your finish for 3 seconds" enterkeyhint="done">
          <div class="seg" role="group" aria-label="Who set this goal">
            <button type="button" data-action="goal-src" data-src="coach" aria-pressed="${ui.goalSrc === 'coach'}">From coach</button>
            <button type="button" data-action="goal-src" data-src="me" aria-pressed="${ui.goalSrc !== 'coach'}">My goal</button>
          </div>
          <button class="btn" data-action="goal-add">Add goal</button>
        </div>
        ${active.length ? `<h4 class="gb-sub">On the list</h4><ul class="gb-edit-list">${active.map(row).join('')}</ul>` : ''}
        ${done.length ? `<h4 class="gb-sub">Done</h4><ul class="gb-edit-list">${done.map(row).join('')}</ul>` : ''}
        ${goalSyncNote()}
        <p class="hint">${ghReady() ? 'Goals save straight to GitHub, so they show on every phone.'
          : 'Goals added here are saved on this phone. To keep them on every phone, add a GitHub key once in Sessions → Data &amp; backup.'}</p>
      </div>`;
      return;
    }
    if (!goals.length) {
      el.innerHTML = `<div class="gb gb-empty">${title}<span class="gb-note">Add a goal from a coach, or one of your own, to keep it here as a reminder.</span>
        <button class="btn small ghost" data-action="goals-edit">+ Add a goal</button></div>`;
      return;
    }
    const shown = ui.goalsAll ? active : active.slice(0, GOALS_SHOWN);
    el.innerHTML = `<div class="gb">
      <div class="gb-head">${title}<button class="btn small ghost" data-action="goals-edit">Edit</button></div>
      ${active.length ? `<ul class="gb-list">${shown.map((g) => `<li class="gb-item">
          <button class="gb-check" data-action="goal-done" data-id="${esc(g.id)}" aria-label="Mark done: ${esc(g.text)}"><span aria-hidden="true">✓</span></button>
          <div class="gb-body"><span class="gb-text">${esc(g.text)}</span>${goalBadge(g)}</div></li>`).join('')}</ul>`
        : `<p class="gb-alldone">Every goal is done. Nice work! Tap Edit to add the next one.</p>`}
      ${active.length > GOALS_SHOWN ? `<button class="gb-more" data-action="goals-all">${ui.goalsAll ? 'Show fewer' : `Show all ${active.length} goals`}</button>` : ''}
      ${goalSyncNote()}
    </div>`;
  }
  function addGoal() {
    const input = $('#goalText');
    const text = input ? input.value.trim().replace(/\s+/g, ' ') : '';
    if (!text) { toast('Type a goal first'); if (input) input.focus(); return; }
    const g = { id: 'goal-' + todayISO() + '-' + Math.random().toString(36).slice(2, 6), text, source: ui.goalSrc === 'coach' ? 'coach' : 'me', added: todayISO(), done: false };
    local.goals.added.push(g);
    saveLocal(); refresh();
    toast('Goal added');
    const again = $('#goalText'); if (again) again.focus();
    syncGoals();
  }
  function setGoalDone(id) {
    const g = (data.goals || []).find((x) => x.id === id);
    if (!g) return;
    local.goals.edits[id] = Object.assign({}, local.goals.edits[id], { done: !g.done });
    saveLocal(); refresh();
    toast(g.done ? 'Back on the list' : 'Nice work! Goal done');
    syncGoals();
  }
  function removeGoal(id) {
    const g = (data.goals || []).find((x) => x.id === id);
    if (!g || !confirm(`Remove this goal?\n\n“${g.text}”`)) return;
    const before = local.goals.added.length;
    local.goals.added = local.goals.added.filter((x) => x.id !== id);
    if (local.goals.added.length === before && local.goals.removed.indexOf(id) < 0) local.goals.removed.push(id);
    delete local.goals.edits[id];
    saveLocal(); refresh();
    toast('Goal removed');
    syncGoals();
  }

  // ----- Saving goals straight to the GitHub repo -----
  // A phone with a fine-grained GitHub key (Contents: read and write on this repo
  // only) writes each goal change into the player's data file, so every phone sees
  // it. The key stays in this browser; it is never part of the site or the repo.
  // Without a key, goals stay on the phone as local changes, as before.
  const GH_TOKEN = LS + '.githubToken';
  let ghBusy = false;
  let ghError = '';
  function ghToken() { try { return localStorage.getItem(GH_TOKEN) || ''; } catch (e) { return ''; } }
  function ghReady() { return !!(github && ghToken()); }
  function pendingGoals() { const g = local.goals; return g.added.length + Object.keys(g.edits).length + g.removed.length; }
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  async function ghRequest(method, path, body, token) {
    const r = await fetch(`https://api.github.com/repos/${github.repo}/${path}`, {
      method, cache: 'no-store',
      headers: Object.assign({ Authorization: 'Bearer ' + (token || ghToken()), Accept: 'application/vnd.github+json' },
        body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function ghGetFile(file, token) {
    const j = await ghRequest('GET', `contents/${file}?ref=${encodeURIComponent(github.branch)}&t=${Date.now()}`, null, token);
    return { text: b64decode(j.content), sha: j.sha };
  }
  function ghErrorText(e) {
    if (e && e.status === 401) return 'GitHub didn’t accept the key. It may have expired; make a new one in Data & backup.';
    if (e && (e.status === 403 || e.status === 404)) return 'The key can’t write to the repo. It needs Contents: Read and write for KH-golf-shot-tracker.';
    if (e && (e.status === 409 || e.status === 422)) return 'Someone else saved at the same moment. Tap Try again.';
    return navigator.onLine === false ? 'This phone is offline; it will upload next time.' : 'Couldn’t reach GitHub; it will try again next time.';
  }
  // Write this phone's goal changes into the player's data file on GitHub. Only the
  // changes that were sent are cleared, so a goal added mid-save isn't lost.
  async function syncGoals() {
    if (!ghReady() || ghBusy || !pendingGoals()) return;
    const myLocal = local, myKey = key('local'), myBundleKey = key('bundle'), pid = playerId;
    const file = playerInfo().file, who = playerName();
    const snap = clone(myLocal.goals);
    ghBusy = true; ghError = ''; renderGoals();
    try {
      let saved = null;
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        const f = await ghGetFile(file);
        const obj = JSON.parse(f.text);
        const next = C.applyGoals(obj, snap);
        if (!next) { saved = obj; break; }
        try {
          await ghRequest('PUT', `contents/${file}`, {
            message: `Update ${who}’s goals from the tracker`,
            content: b64encode(JSON.stringify(next, null, 2) + (f.text.endsWith('\n') ? '\n' : '')),
            sha: f.sha, branch: github.branch
          });
          saved = next;
        } catch (e) { if (e.status !== 409 && e.status !== 422) throw e; }
      }
      if (!saved) throw Object.assign(new Error('conflict'), { status: 409 });
      const g = myLocal.goals;
      const sentIds = snap.added.map((x) => x.id);
      g.added = g.added.filter((x) => sentIds.indexOf(x.id) < 0);
      Object.keys(snap.edits).forEach((id) => { if (JSON.stringify(g.edits[id]) === JSON.stringify(snap.edits[id])) delete g.edits[id]; });
      g.removed = g.removed.filter((id) => snap.removed.indexOf(id) < 0);
      saveJSON(myKey, myLocal);
      saveJSON(myBundleKey, saved);
      if (pid === playerId) { bundle = saved; refresh(); }
      toast('Saved to GitHub. It will show on every phone.');
    } catch (e) {
      ghError = ghErrorText(e);
      toast('Saved on this phone. ' + ghError);
    } finally {
      ghBusy = false;
      if (pid === playerId) renderGoals();
    }
    if (pid === playerId && !ghError && pendingGoals()) syncGoals();
  }
  // Status line under the goals: where the latest change is saved.
  function goalSyncNote() {
    if (ghBusy) return '<p class="gb-sync">Saving to GitHub…</p>';
    if (!pendingGoals()) return ghReady() && (data.goals || []).length ? '<p class="gb-sync ok">✓ Saved for every phone</p>' : '';
    if (!ghReady()) return '<p class="gb-sync">Saved on this phone only. <button class="link-btn" data-action="open-gh">Save for every phone</button></p>';
    return `<p class="gb-sync warn">Not on other phones yet. ${esc(ghError)} <button class="link-btn" data-action="gh-retry">Try again</button></p>`;
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
  const EMPTY_ART = `<svg class="empty-art" viewBox="0 0 200 130" aria-hidden="true">
    <circle cx="100" cy="64" r="62" fill="#e3f1e8"/>
    <path d="M14 108c28-15 58-21 88-21s58 6 84 21v6H14z" fill="#c4e2cf"/>
    <ellipse cx="134" cy="98" rx="32" ry="7.5" fill="#9fd0b2"/>
    <path d="M136 34v62" stroke="#0f5135" stroke-width="4" stroke-linecap="round"/>
    <path d="M138.5 34l25 9.5-25 9.5z" fill="#f2c94c"/>
    <path d="M34 104C44 40 92 24 115 88" fill="none" stroke="#187a4e" stroke-width="4.5" stroke-linecap="round" stroke-dasharray=".01 12"/>
    <ellipse cx="136" cy="97.5" rx="5.5" ry="2" fill="#0f5135"/>
    <circle cx="118" cy="94" r="6.5" fill="#fff" stroke="#0f5135" stroke-width="2.5"/>
  </svg>`;
  function skeleton() {
    return `<div class="skel" role="status"><span class="sr">Loading</span>
      <div class="card"><span class="sk sk-title"></span><div class="sk-tiles"><span class="sk sk-tile"></span><span class="sk sk-tile"></span><span class="sk sk-tile"></span><span class="sk sk-tile"></span></div><span class="sk sk-line"></span><span class="sk sk-line short"></span></div>
      <div class="card"><span class="sk sk-title"></span><span class="sk sk-line"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span></div></div>`;
  }
  function emptyState(onSessionsTab) {
    if (bundleStatus === 'loading' && !data.sessions.length) return skeleton();
    return `<div class="card empty-card">${EMPTY_ART}<h3>No sessions yet</h3>
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
  const TIP_FOR = { contact: ['contact', 'strike'], direction: ['straight', 'strike'], launch: ['hands', 'strike'], distance: ['plan', 'speed'] };
  function tipIdFor(kind) {
    const t = TIPS[playerId];
    if (!t || !kind) return null;
    return (TIP_FOR[kind] || []).find((id) => t.focus.some((f) => f.id === id)) || null;
  }
  const NW_PILL = '<span class="nw-pill">Needs work</span>';
  // Every club in the bag plus any he has hit: model, loft and launch target.
  function clubsCard(clubsHit) {
    const bag = (data.equipment && data.equipment.bag) || {};
    const list = C.sortClubs(Array.from(new Set(Object.keys(bag).concat(clubsHit))));
    if (!list.length) return '';
    const rows = list.map((c) => {
      const spec = C.clubSpec(c, data.equipment), loft = C.clubLoft(c, data.equipment), win = C.launchWindow(c, data.equipment);
      const what = [spec && spec.model, loft != null ? `${C.fmtRaw(loft)}°` : spec ? 'loft not listed' : 'not listed yet'].filter(Boolean).join(' · ');
      return `<li>${clubBadge(c, true, true)}<span class="aim-k">${esc(C.clubName(c, data.clubs))}<small>${esc(what)}</small></span><span class="aim-v">${win ? `${win[0]}–${win[1]}°` : '—'}<small>${loft != null ? 'from its loft' : 'general target'}</small></span></li>`;
    }).join('');
    return `<div class="card"><div class="card-head"><span class="head-ico">${icon('launch')}</span><h3 class="card-title">Your clubs and launch targets</h3></div>
      <p class="note">The launch a solid strike should have with each club, worked out from its loft.</p>
      <ul class="aim-list">${rows}</ul>
      ${data.equipment && data.equipment.note ? `<p class="hint">${esc(data.equipment.note)}</p>` : ''}</div>`;
  }
  function yds(n) { return n === '1' ? n + ' yd' : n + ' yds'; }
  function goalRow(g) {
    let target, now;
    if (g.id === 'carry') { target = `${g.lo}–${g.hi} yds`; now = `${g.n} of ${plural(g.of, 'shot')} landed in it`; }
    else if (g.id === 'line') { target = 'Within 10 yds of your target'; now = `${g.n} of ${plural(g.of, 'shot')} (goal: 8 of 10)`; }
    else if (g.id === 'launch') { target = `${g.lo}–${g.hi}°`; now = `${C.fmtNum(g.avg, 1)}° average${g.status === 'high' ? ', a bit high' : g.status === 'low' ? ', a bit low' : ''}`; }
    else { target = '9 of 10 swings'; now = `${g.n} of ${g.of} solid`; }
    const note = g.id === 'carry' ? `<span class="g-note">${g.pure ? `A pure strike carries about ${g.center} yds.` : `Your better shots already fly about ${g.center} yds.`}</span>` : '';
    return `<li class="goal${g.met ? ' met' : ''}"><div class="g-main"><span class="g-label">${esc(g.label)}</span><span class="g-target">${esc(target)}</span>${note}</div>
      <div class="g-now"><span class="g-state">${g.met ? '✓ On target' : 'Keep working'}</span><span>${esc(now)}</span></div></li>`;
  }
  function statRow(label, desc, value, sub, flagged) {
    return `<div class="stat-row${flagged ? ' work' : ''}"><dt><span class="sl">${esc(label)}</span><span class="sd">${esc(desc)}</span>${flagged ? NW_PILL : ''}</dt>
      <dd><span class="sv">${esc(value)}</span>${sub ? `<span class="sv-sub">${esc(sub)}</span>` : ''}</dd></div>`;
  }
  function clubCard(entries, club, scopeAll) {
    const e = entries[club];
    const flags = C.needsWork(e);
    const flagKeys = new Set(flags.map((f) => f.key));
    const G = C.clubGoals(e, club, data.equipment);
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
    let tiles = '';
    if (e.shots.length) {
      const car = C.metricStat(e, 'carry_yds'), off = C.metricStat(e, 'offline_ft'), ref = G && G.ref, sp = C.solidPct(e);
      const t = [];
      if (car && C.isNum(car.avg)) t.push(kpi({ label: 'Average carry', value: C.fmtNum(car.avg, 1), unit: 'yds', sub: `range ${C.fmtRange(car.min, car.max)}\u00a0yds`, flag: flagKeys.has('carry_yds') }));
      if (ref) t.push(kpi({ label: 'Pure strike', value: String(ref.carry), unit: 'yds', sub: `from your best ${plural(ref.n, 'shot')}` }));
      t.push(kpi({ label: 'Solid contact', value: C.roundHalfEven(sp, 0) + '%', meter: sp, sub: `${e.solid.length} of ${e.shots.length}`, flag: flagKeys.has('solid_pct') }));
      if (off && C.isNum(off.avg)) {
        const d = dirSplit(off.avg / 3, 'yds', 1);
        t.push(kpi({ label: 'Average miss', value: d.value, unit: d.unit, sub: `${dirU(off.avg, 'ft', 1)} on the screen`, flag: flagKeys.has('offline_ft') }));
      }
      tiles = `<div class="kpis four">${t.join('')}</div>`;
    }
    const tip = G ? tipIdFor(G.focus.kind) : null;
    const goals = G ? `<div class="goals">
        <h4 class="goals-title"><span class="head-ico">${icon('target')}</span>Goals for your ${esc(club)}</h4>
        <div class="focus-line"><span class="fl-label">Focus</span><span class="fl-text">${esc(G.focus.text)}</span>
          ${tip ? `<button class="btn ghost small" data-action="goto-tip" data-tip="${esc(tip)}">See drills →</button>` : ''}</div>
        <ul class="goal-list">${G.goals.map(goalRow).join('')}</ul>
        <p class="hint">Goals come from ${scopeAll ? 'all of your sessions' : 'your shots in this session'} and move as you improve. Launch windows are ballpark targets for your swing speed.</p>
      </div>` : '';
    return `<div class="club-card">
      ${clubHead(club)}
      <p class="cc-shots">${esc(shotsLine)}</p>
      ${tiles}
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
      `<button class="work-row" data-action="focus-club" data-club="${esc(w.club)}"><span class="wr-club">${esc(w.club)}</span><span class="wr-text">${esc(w.flags.map((f) => cap(f.text)).join('. '))}.</span>${icon('chevron', 'chev')}</button>`).join('')}</div>
      <p class="wr-hint">Tap a club to see its goals.</p></div>`;
  }

  // The session before this one that has shots, for "vs last time" changes.
  function prevShotSession(s) {
    if (!s) return null;
    const list = data.sessions.filter((x) => shotCount(x)).sort(C.compareSessions);
    const i = list.findIndex((x) => x.id === s.id);
    if (i < 1) return null;
    const p = list[i - 1], shots = C.sessionShots(p), mis = C.sessionMishits([p]);
    const solid = shots.filter((x) => !mis.has(x)), off = solid.filter((x) => C.isNum(x.offline_ft));
    return { session: p, solidPct: solid.length / shots.length * 100,
      linePct: off.length ? off.filter((x) => Math.abs(x.offline_ft) <= C.GOALS.lineFt).length / off.length * 100 : null };
  }
  function pctDelta(now, before, s) {
    const d = C.roundHalfEven(now, 0) - C.roundHalfEven(before, 0), when = C.fmtDate(s.date, { short: true });
    if (!d) return { cls: 'same', text: `Same as ${when}` };
    return { cls: d > 0 ? 'up' : 'down', dir: d > 0 ? 'up' : 'down', text: `${Math.abs(d)} ${Math.abs(d) === 1 ? 'point' : 'points'} vs ${when}` };
  }
  // The session at a glance: big numbers, then what needs work, then the highlights.
  function sessionSummary(sc, hl, work) {
    const isAll = sc.id === 'all', shots = [], mis = new Set();
    sc.sessions.forEach((s) => { C.sessionShots(s).forEach((x) => shots.push(x)); C.sessionMishits([s]).forEach((x) => mis.add(x)); });
    const solid = shots.filter((x) => !mis.has(x));
    const tiles = [], skip = new Set(['work']);
    if (shots.length) {
      const prev = isAll ? null : prevShotSession(sc.session);
      const clubs = new Set(shots.map((x) => x.club));
      tiles.push(kpi({ label: 'Shots', value: String(shots.length), sub: plural(clubs.size, 'club') + (isAll ? ` · ${plural(sc.sessions.length, 'session')}` : '') }));
      const sp = solid.length / shots.length * 100;
      tiles.push(kpi({ label: 'Solid contact', value: C.roundHalfEven(sp, 0) + '%', meter: sp, sub: `${solid.length} of ${shots.length}`, delta: prev ? pctDelta(sp, prev.solidPct, prev.session) : null }));
      const off = solid.filter((x) => C.isNum(x.offline_ft));
      if (off.length) {
        const on = off.filter((x) => Math.abs(x.offline_ft) <= C.GOALS.lineFt).length, lp = on / off.length * 100;
        tiles.push(kpi({ label: 'On line', value: C.roundHalfEven(lp, 0) + '%', meter: lp, sub: `${on} of ${off.length} within 10 yds`, delta: prev && prev.linePct != null ? pctDelta(lp, prev.linePct, prev.session) : null }));
      }
      const carried = solid.filter((x) => C.isNum(x.carry_yds));
      if (carried.length) {
        const best = carried.reduce((a, b) => (b.carry_yds > a.carry_yds ? b : a));
        tiles.push(kpi({ label: 'Longest carry', value: C.fmtRaw(best.carry_yds), unit: 'yds', sub: C.clubName(best.club, data.clubs) }));
      }
      skip.add('count'); skip.add('solid');
    }
    const items = hl.filter((h) => !skip.has(h.id));
    const sub = isAll ? `${plural(sc.sessions.length, 'session')} with shots` : sc.session ? `${longDate(sc.session.date)} · ${deviceLine(sc.session)}` : '';
    return `<div class="card summary">
      <div class="card-head"><span class="head-ico">${icon(isAll ? 'stack' : 'calendar')}</span><div><h3 class="card-title">${isAll ? 'All sessions' : 'Session summary'}</h3>${sub ? `<p class="sum-sub">${esc(sub)}</p>` : ''}</div></div>
      ${tiles.length ? `<div class="kpis four">${tiles.join('')}</div>` : ''}
      ${workBox(work)}
      ${items.length ? `<h4 class="sum-h">Highlights</h4><ul class="hl">${items.map((h) => `<li>${esc(h.text)}</li>`).join('')}</ul>` : ''}
    </div>`;
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
        const miss = dirSplit(off.avg / 3, 'yds', 1);
        inner = `<div class="kpis four">
            ${kpi({ label: 'Shots', value: String(e.shots.length), sub: e.mis.length ? `${e.solid.length} solid · ${plural(e.mis.length, 'mis-hit')}` : C.clubName(single, data.clubs) })}
            ${kpi({ label: 'Average carry', value: car.n ? C.fmtNum(car.avg, 1) : '—', unit: car.n ? 'yds' : '', sub: car.n ? `${C.fmtRange(car.min, car.max)} yds` : 'all mis-hits' })}
            ${kpi({ label: 'Average miss', value: miss.value, unit: miss.unit, sub: C.isNum(off.avg) ? `${dirU(off.avg, 'ft', 1)} on the screen` : '' })}
            ${kpi({ label: 'Left to right spread', value: C.isNum(spread) ? C.fmtNum(spread / 3, 1) : '—', unit: C.isNum(spread) ? 'yds' : '', sub: C.isNum(spread) ? `${C.fmtRange(off.min, off.max, true)} ft` : '' })}
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
      ${sessionSummary(sc, hl, work)}
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
  const TREND_WORDS = { better: ['', 'A little better', 'Better', 'Much better'], worse: ['', 'A little worse', 'Worse', 'Much worse'] };
  function trendIcon(t) {
    const n = t.dir === 'same' ? 0 : t.level;
    if (!n) return '<svg class="tr-ico" viewBox="0 0 14 20" aria-hidden="true"><path d="M2.5 10h9"/></svg>';
    const ys = { 1: [7.5], 2: [4.5, 10.5], 3: [1.5, 7.5, 13.5] }[n], up = t.dir === 'better';
    const d = ys.map((y) => (up ? `M2.5 ${y + 4.5}L7 ${y}L11.5 ${y + 4.5}` : `M2.5 ${y}L7 ${y + 4.5}L11.5 ${y}`)).join('');
    return `<svg class="tr-ico" viewBox="0 0 14 20" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  // Up arrows for better, down arrows for worse; more arrows for a bigger change.
  function trendBadge(t) {
    if (!t) return '';
    const full = t.dir === 'same' ? 'About the same' : TREND_WORDS[t.dir][t.level];
    const note = [t.basis === 'best' ? 'comparing the longest shots' : '', t.few ? 'only a few shots' : ''].filter(Boolean).join(', ');
    const word = t.dir === 'same' ? 'Same' : t.dir === 'better' ? 'Better' : 'Worse';
    return `<span class="trend ${t.dir} l${t.dir === 'same' ? 0 : t.level}" title="${esc(full + (note ? ` (${note})` : ''))}">${trendIcon(t)}<span aria-hidden="true">${word}</span><span class="sr">${esc(full + (note ? `, ${note}` : ''))}</span></span>`;
  }
  function progValue(m, st) {
    if (!st) return { value: '—', sub: 'not recorded' };
    if (st.allMis) return { value: '—', sub: `all ${st.total} were mis-hits` };
    const deg = m.unit === '°';
    if (C.isNum(st.avg)) {
      if (m.dir) { const d = dirSplit(st.avg, 'ft', m.dec); return { value: d.value, unit: d.unit, sub: 'average' }; }
      return { value: C.fmtAvg(m, st.avg) + (deg ? '°' : ''), unit: deg ? '' : m.unit, sub: `average of ${plural(st.n, 'solid shot')}` };
    }
    if (C.isNum(st.min) && C.isNum(st.max)) return { value: C.fmtRange(st.min, st.max, m.dir) + (deg ? '°' : ''), unit: deg ? '' : m.dir ? 'ft' : m.unit, sub: 'recorded range' };
    return { value: '—', sub: '' };
  }
  // Baseline and latest side by side, with the change, for the metric on the chart.
  function progKpis(P, m) {
    if (P.rows.length < 2 || !P.baseline || !P.latest) return '';
    const b = P.baseline, l = P.latest;
    const lb = (word, r) => `${word} · ${C.fmtDate(r.session.date, { short: true })}`;
    if (m.key === C.SOLID_METRIC.key) {
      const pa = C.solidPct(b.entry), pl = C.solidPct(l.entry);
      const v = (pc, e) => (pc == null ? { value: '—', sub: 'ranges only' } : { value: C.roundHalfEven(pc, 0) + '%', meter: pc, sub: `${e.solid.length} of ${e.shots.length}` });
      const t = pa != null && pl != null ? C.trend('solid_pct', { avg: pa }, { avg: pl }) : null;
      const extra = t ? trendBadge(t) + `<span class="kpi-s">${esc(C.fmtSigned(C.roundHalfEven(pl, 0) - C.roundHalfEven(pa, 0), 0))} points since the baseline</span>` : '';
      return `<div class="kpis">${kpi(Object.assign({ label: lb('Baseline', b) }, v(pa, b.entry)))}${kpi(Object.assign({ label: lb('Latest', l), html: extra }, v(pl, l.entry)))}</div>`;
    }
    const a = C.metricStat(b.entry, m.key), c = C.metricStat(l.entry, m.key);
    const t = C.trend(m.key, a, c, { window: C.launchWindow(P.club || ui.progClub, data.equipment) });
    let change = '';
    if (!m.dir && a && c && C.isNum(a.avg) && C.isNum(c.avg) && !a.summaryOnly && !c.summaryOnly) {
      const txt = C.fmtSigned(c.avg - a.avg, m.dec);
      change = `${txt}${m.unit === '°' ? '°' : ' ' + m.unit} since the baseline`;
    }
    const extra = trendBadge(t) + (change ? `<span class="kpi-s">${esc(change)}</span>` : '');
    return `<div class="kpis">${kpi(Object.assign({ label: lb('Baseline', b) }, progValue(m, a)))}${kpi(Object.assign({ label: lb('Latest', l), html: extra }, progValue(m, c)))}</div>`;
  }
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
      <div class="card"><h3 class="card-title">${esc(club)}: ${esc(m.label.toLowerCase())}${m.key === C.SOLID_METRIC.key ? ' %' : ''} by session</h3>${progKpis(P, m)}<div class="chart" id="progChart"></div>
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
    const solidT = pa != null && pl != null ? C.trend('solid_pct', { avg: pa }, { avg: pl }) : null;
    const solidRow = (b.entry.shots.length || l.entry.shots.length)
      ? `<tr><th scope="row">Solid contact</th><td>${pctCell(pa, b.entry)}</td><td>${pctCell(pl, l.entry)}${trendBadge(solidT)}${pa != null && pl != null ? `<span class="chg">${esc(C.fmtSigned(pl - pa, 0))} points</span>` : ''}</td></tr>` : '';
    const win = C.launchWindow(P.club || ui.progClub, data.equipment);
    const rows = C.METRICS.map((m) => {
      const a = C.metricStat(b.entry, m.key), c = C.metricStat(l.entry, m.key);
      if (!a && !c) return '';
      const t = C.trend(m.key, a, c, { window: win });
      const d = C.compareStats(a, c);
      let change = '';
      if (d) {
        if (m.dir) {
          if (t && t.basis === 'line') change = `${m.key === 'curve_ft' ? 'average bend' : 'average miss'} ${C.fmtNum(t.from, 1)} → ${C.fmtNum(t.to, 1)} ft`;
          else if (C.isNum(d.spreadA) && C.isNum(d.spreadB)) change = `spread ${C.fmtRaw(d.spreadA)} → ${C.fmtRaw(d.spreadB)} ft`;
        } else {
          const parts = [];
          if (C.isNum(d.dMin)) parts.push('low ' + C.fmtSigned(d.dMin));
          if (C.isNum(d.dMax)) parts.push('high ' + C.fmtSigned(d.dMax));
          if (C.isNum(d.dAvg)) parts.push('avg ' + C.fmtSigned(d.dAvg, m.dec));
          change = parts.join(' · ');
        }
      }
      return `<tr><th scope="row">${esc(m.label)}${m.unit ? `<span class="u">${esc(unitLabel(m))}</span>` : ''}</th><td>${statCell(m, a)}</td><td>${statCell(m, c)}${trendBadge(t)}${change ? `<span class="chg">${esc(change)}</span>` : ''}</td></tr>`;
    }).join('');
    const head = (r, label) => `${label}<span class="u">${esc(C.fmtDate(r.session.date))} · ${esc(C.shortDevice(r.session.device))}</span>`;
    return `<div class="table-wrap"><table class="matrix cmp"><thead><tr><th scope="col">Metric</th><th scope="col">${head(b, 'Baseline')}</th><th scope="col">${head(l, 'Latest')}</th></tr></thead><tbody>${solidRow}${rows}</tbody></table></div>
      <p class="hint trend-key"><span class="trend better l2">${trendIcon({ dir: 'better', level: 2 })}<span aria-hidden="true">Better</span></span> <span class="trend worse l2">${trendIcon({ dir: 'worse', level: 2 })}<span aria-hidden="true">Worse</span></span>
        Up arrows mean better since the baseline and down arrows worse: one arrow is a small change, three a big one. Launch is better when it moves toward the club’s target window; curve and offline when shots finish closer to the line on average. When the baseline only has ranges, the longest shots are compared. Peak height, landing and hang time get no arrow, since higher isn’t always better.</p>
      <p class="hint">Each cell shows the average (when individual shots exist), then lowest–highest, from solid shots. Changes are latest minus baseline.</p>`;
  }

  // ----- Practice (the "tips" tab): numbers to aim for at the range, a live shot check, then tips -----
  // Each club uses its most recent session with shots, so the numbers move as he improves.
  function practiceClubs() {
    const out = {};
    data.sessions.slice().sort(C.compareSessions).reverse().forEach((s) => {
      if (!C.sessionShots(s).length) return;
      const e = C.clubData([s]);
      Object.keys(e).forEach((c) => { if (!out[c] && e[c].shots.length) out[c] = { entry: e[c], session: s }; });
    });
    return out;
  }
  function numOrNull(id) { const el = $('#' + id); const v = el ? parseFloat(el.value) : NaN; return isFinite(v) ? v : null; }
  function readCheckInputs() {
    ui.check = Object.assign({}, ui.check, { carry: numOrNull('ckCarry'), ball: numOrNull('ckBall'), launch: numOrNull('ckLaunch'), off: numOrNull('ckOff') });
  }
  function runCheck() {
    readCheckInputs();
    const ck = ui.check, c = ui.practiceClub, sel = practiceClubs()[c];
    if (!sel) return;
    if (ck.carry == null && ck.ball == null && ck.launch == null && ck.off == null) { toast('Type at least one number from the screen'); const f = $('#ckCarry'); if (f) f.focus(); return; }
    if (ck.off && !ck.dir) { toast('Tap Left or Right for the offline number'); return; }
    const off = ck.off == null ? null : (ck.dir === 'L' ? -Math.abs(ck.off) : Math.abs(ck.off));
    ck.result = C.checkShot(sel.entry, c, { carry_yds: ck.carry, ball_speed_mph: ck.ball, launch_deg: ck.launch, offline_ft: off }, data.equipment);
    renderTips();
    const r = $('#checkResult'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function checkResultHtml(r) {
    const good = r.verdict === 'pure' || r.verdict === 'good';
    return `<div class="check-result ${esc(r.verdict)}" role="status" id="checkResult"><span class="cr-ico">${icon(good ? 'check' : 'alert')}</span><div class="cr-body"><p class="check-title">${esc(r.title)}</p>
      <ul class="check-lines">${r.lines.map((l) => `<li><span class="ck ${l.ok === true ? 'ok' : l.ok === false ? 'bad' : ''}" aria-hidden="true">${l.ok === true ? '✓' : l.ok === false ? '✗' : '~'}</span><span>${esc(l.text)}</span></li>`).join('')}</ul></div></div>`;
  }
  function practiceCard(c, sel, t) {
    const e = sel.entry, G = C.clubGoals(e, c, data.equipment), r = G.ref, m = r ? r.metrics : {};
    const zone = G.goals.find((g) => g.id === 'carry');
    const win = C.launchWindow(c, data.equipment);
    const flags = C.needsWork(e);
    const aim = [];
    if (zone) aim.push(['flag', 'Distance', 'Carry in this zone', `${zone.lo}–${zone.hi} yds`, r ? `pure strike about ${r.carry} yds` : '']);
    if (m.ball_speed_mph) aim.push(['bolt', 'Ball speed', 'Shows a centred strike', `${C.fmtRaw(m.ball_speed_mph.min)}+ mph`, `your pure strikes: ${C.fmtRange(m.ball_speed_mph.min, m.ball_speed_mph.max)} mph`]);
    if (win) aim.push(['launch', 'Launch', 'How steeply it starts', `${win[0]}–${win[1]}°`, m.launch_deg ? `your pure strikes: about ${C.fmtNum(m.launch_deg.avg, 0)}°` : '']);
    aim.push(['line', 'On line', 'Left or right of target', 'within 10 yds', '30 ft or less on the screen']);
    const look = [];
    if (m.apex_ft) look.push(`peak height about ${C.fmtNum(m.apex_ft.avg, 0)} ft`);
    if (m.landing_deg) look.push(`landing about ${C.fmtNum(m.landing_deg.avg, 0)}°`);
    if (m.total_yds) look.push(`total about ${C.fmtNum(m.total_yds.avg, 0)} yds`);
    const tipId = tipIdFor(G.focus.kind);
    const area = tipId && t ? t.focus.find((f) => f.id === tipId) : null;
    const drill = area && area.drills && area.drills[0];
    const ck = ui.check || {};
    const val = (v) => (v == null ? '' : esc(String(v)));
    return `
      ${clubHead(c)}
      <p class="cc-shots">From your ${esc(C.fmtDate(sel.session.date))} session${r ? `: ${plural(r.n, 'best-struck shot')} of ${plural(e.shots.length, 'shot')}` : ''}</p>
      ${flags.length ? `<div class="work-box">${NW_PILL}<ul>${flags.map((f) => `<li>${esc(cap(f.text))}.</li>`).join('')}</ul></div>` : ''}
      <h4 class="cc-sub">Aim for</h4>
      <ul class="aim-list targets">${aim.map((a) => `<li><span class="aim-ico">${icon(a[0])}</span><span class="aim-k">${esc(a[1])}</span><span class="aim-v">${esc(a[3])}</span>
        <span class="aim-s">${esc(a[2])}${a[4] ? `<span class="aim-n">${esc(cap(a[4]))}</span>` : ''}</span></li>`).join('')}</ul>
      ${look.length ? `<p class="pure-look">Your pure strikes also show ${esc(look.join(', '))}.</p>` : ''}
      <div class="focus-line" style="margin-top:14px"><span class="fl-label">Focus</span><span class="fl-text">${esc(G.focus.text)}</span></div>
      ${drill ? `<details class="focus-drill"><summary>Drill: ${esc(fillText(drill.name))}</summary>
        ${artHtml(drill.art, area.id + ':0', fillText(drill.name))}
        <ol>${drill.steps.map((s) => `<li>${esc(fillText(s))}</li>`).join('')}</ol>
        <p class="reps"><strong>Reps:</strong> ${esc(fillText(drill.reps))}</p>
        ${drillVideo(drill)}</details>` : ''}
      <h4 class="cc-sub">Check a shot</h4>
      <p class="note">Type the numbers from the range screen to see how this ${esc(c)} shot compares.</p>
      <div class="check-grid" style="margin-top:10px">
        <div class="field"><label for="ckCarry">Carry (yds)</label><input id="ckCarry" type="number" inputmode="decimal" value="${val(ck.carry)}"></div>
        <div class="field"><label for="ckBall">Ball speed (mph)</label><input id="ckBall" type="number" inputmode="decimal" value="${val(ck.ball)}"></div>
        <div class="field"><label for="ckLaunch">Launch (°)</label><input id="ckLaunch" type="number" inputmode="decimal" value="${val(ck.launch)}"></div>
        <div class="field"><label for="ckOff">Offline (ft)</label><input id="ckOff" type="number" inputmode="decimal" value="${val(ck.off)}"></div>
      </div>
      <div class="seg" role="group" aria-label="Offline direction">
        <button type="button" data-action="check-dir" data-dir="L" aria-pressed="${ck.dir === 'L'}">◀ Left</button>
        <button type="button" data-action="check-dir" data-dir="R" aria-pressed="${ck.dir === 'R'}">Right ▶</button>
      </div>
      <div class="row-actions"><button class="btn" data-action="check-shot">Check this shot</button>${ck.result ? '<button class="btn ghost" data-action="check-clear">Clear</button>' : ''}</div>
      ${ck.result ? checkResultHtml(ck.result) : ''}`;
  }
  // ----- Drill animations: the stage plays the frames; the strip under it jumps to one -----
  const DA = window.DrillArt;
  const REDUCED = (() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const ART_HOLD = 1700, ART_MOVE = 700;
  let artBoxes = [], artIO = null, artClock = null;
  // Where the camera goes and what to get in the picture, for swing videos.
  const FILM_ART = { scene: 'camera', auto: false, frames: [
    { view: 'face', cap: 'Face-on: in front of you, across the ball, 10 ft away' },
    { scene: 'framing', view: 'face', cap: 'Phone at hip height; whole body, club and ball in' },
    { view: 'dtl', cap: 'Down the line: behind your hands, aimed at the target' },
    { scene: 'framing', view: 'dtl', cap: 'Same height; your whole body, the club and the ball' }
  ] };
  function drillFor(key) {
    if (key === 'film') return { name: 'How to film your swing', art: FILM_ART };
    const m = /^([\w-]+):(\d+)$/.exec(key || ''), t = TIPS[playerId];
    const f = m && t ? t.focus.find((x) => x.id === m[1]) : null;
    return f ? f.drills[+m[2]] || null : null;
  }
  function artLabel(name, art, i) { return `${name}, step ${i + 1} of ${art.frames.length}: ${art.frames[i].cap}`; }
  function artHtml(art, key, name) {
    if (!DA || !art || !Array.isArray(art.frames) || !art.frames.length) return '';
    const auto = !REDUCED && art.auto !== false;
    return `<div class="da-box" data-art="${esc(key)}" data-name="${esc(name)}">
      <div class="da-stage">${DA.render(art, 0, { label: artLabel(name, art, 0) })}</div>
      <div class="da-strip" role="group" aria-label="${esc(name)}: steps">${art.frames.map((fr, i) => `<button type="button" class="da-step" data-action="art-step" data-i="${i}" aria-pressed="${i === 0}" aria-label="Step ${i + 1}: ${esc(fr.cap)}">${DA.render(art, i, { thumb: true })}<span class="da-num" aria-hidden="true">${i + 1}</span></button>`).join('')}</div>
      <div class="da-foot"><p class="da-cap"><span class="da-capn" aria-hidden="true">1</span><span class="da-capt">${esc(art.frames[0].cap)}</span></p>
        <button type="button" class="da-play" data-action="art-play" aria-label="${auto ? 'Pause' : 'Play'} the animation">${icon(auto ? 'pause' : 'run')}</button></div>
    </div>`;
  }
  function artStop() {
    if (artIO) { artIO.disconnect(); artIO = null; }
    clearInterval(artClock);
    artClock = null;
    artBoxes.forEach((b) => { if (b.raf) cancelAnimationFrame(b.raf); });
    artBoxes = [];
  }
  // Animations play only while on screen, and not at all when the phone asks for reduced motion.
  function artStart() {
    artStop();
    if (!DA) return;
    artBoxes = $$('.da-box').filter((el) => !el.closest('[hidden]')).map((el) => {
      const d = drillFor(el.dataset.art);
      return d && d.art ? { el, art: d.art, name: el.dataset.name, i: 0, playing: !REDUCED && d.art.auto !== false, visible: false, next: 0, raf: 0 } : null;
    }).filter(Boolean);
    if (!artBoxes.length) return;
    if ('IntersectionObserver' in window) {
      artIO = new IntersectionObserver((entries) => entries.forEach((en) => {
        const b = artBoxes.find((x) => x.el === en.target);
        if (!b) return;
        b.visible = en.isIntersecting;
        if (b.visible && !b.next) b.next = performance.now() + 900;
      }), { threshold: 0.5 });
      artBoxes.forEach((b) => artIO.observe(b.el));
    } else {
      artBoxes.forEach((b) => { b.visible = true; b.next = performance.now() + 900; });
    }
    artClock = setInterval(artTick, 200);
  }
  function artMark(b) {
    $$('.da-step', b.el).forEach((x, k) => x.setAttribute('aria-pressed', String(k === b.i)));
    b.el.querySelector('.da-capn').textContent = String(b.i + 1);
    b.el.querySelector('.da-capt').textContent = b.art.frames[b.i].cap;
  }
  function artShow(b, i) {
    b.i = i;
    b.el.querySelector('.da-stage').innerHTML = DA.render(b.art, i, { label: artLabel(b.name, b.art, i) });
    artMark(b);
  }
  function artTick() {
    const now = performance.now();
    artBoxes.forEach((b) => {
      if (!b.playing || !b.visible || b.raf || document.hidden || !b.next || now < b.next) return;
      const from = b.i, to = (b.i + 1) % b.art.frames.length;
      // Back to the start, or a scene that doesn't move: cut straight to the next frame.
      if (to === 0 || !DA.moves(b.art)) { artShow(b, to); b.next = now + ART_HOLD + (to === 0 ? 500 : 0); return; }
      b.i = to;
      artMark(b);
      const stage = b.el.querySelector('.da-stage'), t0 = now;
      const step = (ts) => {
        const t = Math.min(1, (ts - t0) / ART_MOVE);
        if (t < 1) { stage.innerHTML = DA.tween(b.art, from, to, t, { label: artLabel(b.name, b.art, to) }); b.raf = requestAnimationFrame(step); }
        else { b.raf = 0; artShow(b, to); b.next = performance.now() + ART_HOLD; }
      };
      b.raf = requestAnimationFrame(step);
    });
  }
  function artBox(el) { const box = el.closest('.da-box'); return artBoxes.find((x) => x.el === box) || null; }
  function artPlayButton(b) {
    const btn = b.el.querySelector('.da-play');
    btn.innerHTML = icon(b.playing ? 'pause' : 'run');
    btn.setAttribute('aria-label', (b.playing ? 'Pause' : 'Play') + ' the animation');
  }
  // A coach's video: a thumbnail that loads YouTube's player only when tapped.
  function drillVideo(d) {
    const v = d.video;
    if (!v || !/^[\w-]{11}$/.test(v.id || '')) {
      return `<a class="btn ghost small look" href="${esc(C.youtubeSearchUrl(d.search))}" target="_blank" rel="noopener">${icon('play')}Look it up on YouTube</a>`;
    }
    return `<div class="vid">
      <button type="button" class="vid-btn" data-action="play-video" data-id="${esc(v.id)}" aria-label="Play the coach’s video: ${esc(v.title)}">
        <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async" onerror="this.remove()">
        <span class="vid-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span>
      </button>
      <div class="vid-meta"><span class="vid-k">Coach’s video</span><span class="vid-title">${esc(v.title)}</span>
        <span class="vid-by">${esc(v.by || '')}${v.note ? ' · ' + esc(v.note) : ''}</span></div>
      <a class="vid-open" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">Open in YouTube <span aria-hidden="true">↗</span></a>
    </div>`;
  }
  const HERO_ART = `<svg class="hero-art" viewBox="0 0 160 110" aria-hidden="true"><path d="M6 106C24 32 90 8 126 86" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray=".01 13"/><path d="M140 20v78" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M143 20l17 7-17 7z" fill="#fff"/><circle cx="128" cy="94" r="7" fill="#fff"/></svg>`;
  function renderTips() {
    const el = $('#view-tips');
    const t = TIPS[playerId];
    const pc = practiceClubs();
    const clubs = C.sortClubs(Object.keys(pc));
    if (clubs.length && (!ui.practiceClub || !pc[ui.practiceClub])) ui.practiceClub = clubs[0];
    const refs = {};
    clubs.forEach((c) => { refs[c] = C.strikeReference(pc[c].entry, c, data.equipment); });
    const longest = Math.max(1, ...clubs.map((c) => (refs[c] ? refs[c].carry : 0)));
    const rows = clubs.map((c) => {
      const e = pc[c].entry, r = refs[c], nw = C.needsWork(e).length;
      const sub = [r && r.metrics.ball_speed_mph ? `${C.fmtRaw(r.metrics.ball_speed_mph.min)}+ mph ball speed` : '',
        r && r.solid < 4 ? `only ${plural(r.solid, 'solid shot')} so far` : ''].filter(Boolean).join(' · ');
      return `<li><button class="yard-row" data-action="practice-club" data-club="${esc(c)}" aria-pressed="${c === ui.practiceClub}">
        ${clubBadge(c, true)}
        <span class="yr-main"><span class="yr-top"><span class="yr-carry">${r ? `${r.carry} <span class="yr-u">yds</span>` : '—'}</span>${nw ? NW_PILL : ''}</span>
          ${r ? `<span class="yr-bar" aria-hidden="true"><span style="width:${f1(r.carry / longest * 100)}%"></span></span>` : ''}
          ${sub ? `<span class="yr-sub">${esc(sub)}</span>` : ''}</span>
        ${icon('chevron', 'chev')}</button></li>`;
    }).join('');
    const view = ['range', 'swing', 'drills'].indexOf(ui.practiceView) < 0 ? 'range' : ui.practiceView;
    const heads = {
      range: ['At the range', 'Pick the club you’re hitting, aim for its numbers, and check a shot against them.'],
      swing: ['Swing reviews', 'Frames from your swing videos, marked up to show what’s happening and how to fix it.'],
      drills: ['Tips & drills', t ? fillText(t.intro) : 'Drills for each part of the game.']
    };
    const latest = (data.reviews || [])[0];
    const rangeView = `${latest ? `<button class="setting-row rv-teaser" data-action="practice-view" data-view="swing"><span class="head-ico">${icon('play')}</span><span class="set-text"><span class="set-title">Swing review: ${esc(C.fmtDate(latest.date, { short: true }))}${latest.club ? ' · ' + esc(C.clubName(latest.club, data.clubs)) : ''}</span><span class="set-desc">${esc(reviewTeaser(latest))}</span></span>${icon('chevron', 'chev')}</button>` : ''}
      ${clubs.length ? `
        <div class="card"><div class="card-head"><span class="head-ico">${icon('flag')}</span><h3 class="card-title">Your yardages</h3></div>
          <p class="note">How far a pure strike carries with each club. Tap a club for its numbers.</p>
          <ul class="yard-list">${rows}</ul>
          <p class="hint">A pure strike is one of your best-struck shots: solid contact with your highest ball speeds, launched at a normal height. Each club uses its most recent session, so these grow as you improve.</p></div>
        <div class="card" id="practiceCard">${practiceCard(ui.practiceClub, pc[ui.practiceClub], t)}</div>
        ${clubsCard(clubs)}`
      : `<div class="card"><h3 class="card-title">Numbers to aim for</h3><p>After ${esc(playerName())}’s first range session, each club’s pure-strike distance and the numbers to aim for show up here, with a quick way to check a shot.</p></div>`}`;
    const drillsView = t ? `${t.focus.map((f, i) => focusCard(f, i, true)).join('')}
        <div class="card lesson"><div class="card-head"><span class="head-ico">${icon('coach')}</span><h3 class="card-title">Check it with a coach</h3></div><p style="margin-top:6px">${esc(fillText(t.lesson))}</p></div>` : '';
    el.innerHTML = `
      <div class="hero">${HERO_ART}<span class="hero-k">Practice</span><h2>${esc(heads[view][0])}</h2>
        <p>${esc(heads[view][1])}</p>
        <div class="pv" role="group" aria-label="Practice sections">${[['range', 'Range'], ['swing', 'Swing'], ['drills', 'Drills']].map(([id, label]) =>
          `<button type="button" data-action="practice-view" data-view="${id}" aria-pressed="${id === view}">${label}</button>`).join('')}</div></div>
      ${view === 'swing' ? swingView() : view === 'drills' ? drillsView : rangeView}`;
    artStart();
  }
  // ----- Swing reviews: key frames from a swing video, marked up, with numbered notes -----
  const SR = window.SwingReview;
  function reviewTeaser(r) {
    const n = (r.fixes || []).length;
    return n ? `${n === 1 ? 'One thing' : n + ' things'} to work on` : 'See the marked-up frames';
  }
  function reviewById(id) { return id === 'example' ? exampleReview() : (data.reviews || []).find((r) => r.id === id) || null; }
  function rvFrameHtml(r, i) {
    const f = r.frames[i], mk = SR ? SR.markup(f) : { svg: '', pins: [] };
    const ratio = Math.round(f.w / f.h * 1000) / 1000;
    const media = f.svg || `<img src="${esc(f.src)}" alt="" width="${f.w}" height="${f.h}" decoding="async">`;
    const pins = mk.pins.map((p) => `<span class="rv-pin ${p.kind}${p.n == null ? ' lab' : ''}" style="left:${f1(p.x)}%;top:${f1(p.y)}%">${p.n != null ? `<b>${esc(String(p.n))}</b>` : ''}${p.label ? `<span>${esc(p.label)}</span>` : ''}</span>`).join('');
    const notes = (f.notes || []).map((n) => {
      const kind = SR && SR.KINDS[n.kind] ? n.kind : 'ref';
      return `<li class="${kind}"><span class="rv-num${n.n == null ? ' dot' : ''}" aria-hidden="true">${n.n != null ? esc(String(n.n)) : ''}</span><span><strong>${esc(SR ? SR.KINDS[kind] : '')}${n.n != null ? ' ' + esc(String(n.n)) : ''}:</strong> ${esc(n.text)}</span></li>`;
    }).join('');
    return `<div class="rv-stage"><div class="rv-media${ui.rvMarks ? '' : ' clean'}" data-swipe="${esc(r.id)}" style="aspect-ratio:${f.w} / ${f.h};max-width:calc(min(64vh, 560px) * ${ratio})" role="img" aria-label="${esc(f.label || 'Frame ' + (i + 1))}${(f.notes || []).length ? ': ' + esc(f.notes.map((n) => n.text).join(' ')) : ''}">${media}${mk.svg}${pins}</div></div>
      <div class="rv-bar">
        <button type="button" class="rv-nav" data-action="rv-frame" data-id="${esc(r.id)}" data-i="${i - 1}" aria-label="Previous frame"${i ? '' : ' disabled'}>${icon('chevron', 'flip')}</button>
        <div class="rv-strip" role="group" aria-label="Frames">${r.frames.map((fr, k) => `<button type="button" class="rv-thumb" data-action="rv-frame" data-id="${esc(r.id)}" data-i="${k}" aria-pressed="${k === i}" aria-label="Frame ${k + 1}: ${esc(fr.label || '')}"><span class="rv-timg">${fr.thumb || fr.svg || `<img src="${esc(fr.src)}" alt="" loading="lazy" decoding="async">`}</span><span class="rv-tlabel">${esc(fr.label || String(k + 1))}</span></button>`).join('')}</div>
        <button type="button" class="rv-nav" data-action="rv-frame" data-id="${esc(r.id)}" data-i="${i + 1}" aria-label="Next frame"${i < r.frames.length - 1 ? '' : ' disabled'}>${icon('chevron')}</button>
      </div>
      <div class="rv-tools"><span class="rv-where">Frame ${i + 1} of ${r.frames.length}${f.label ? `: <strong>${esc(f.label)}</strong>` : ''}${C.isNum(f.time_s) ? ` · ${esc(f.time_s.toFixed(2))} s` : ''}</span>
        <button type="button" class="btn small ghost" data-action="rv-marks" aria-pressed="${ui.rvMarks}">${ui.rvMarks ? 'Hide the lines' : 'Show the lines'}</button></div>
      ${notes ? `<ol class="rv-notes">${notes}</ol>` : ''}`;
  }
  function reviewCard(r) {
    const i = Math.max(0, Math.min((ui.rvFrame[r.id] || 0), r.frames.length - 1));
    const sess = r.session_id ? getSession(r.session_id) : null;
    const meta = [r.id === 'example' ? '' : longDate(r.date), SR && SR.VIEWS[r.view], sess ? `from the ${C.shortDevice(sess.device)} session` : ''].filter(Boolean).join(' · ');
    const good = (r.good || []).filter(Boolean), fixes = (r.fixes || []).filter((x) => x && x.text);
    return `<article class="card rv" data-review="${esc(r.id)}">
      ${r.id === 'example' ? '<span class="rv-example">Example: a drawing, not a real swing</span>' : ''}
      <div class="cc-head">${r.club ? clubBadge(r.club, false, true) : `<span class="head-ico">${icon('play')}</span>`}<span class="cc-titles"><span class="cc-name">${esc(r.title || (r.club ? C.clubName(r.club, data.clubs) : 'Swing review'))}</span>${meta ? `<span class="cc-full">${esc(meta)}</span>` : ''}</span></div>
      ${r.summary ? `<p class="rv-sum">${esc(r.summary)}</p>` : ''}
      <div class="rv-viewer" data-review="${esc(r.id)}">${rvFrameHtml(r, i)}</div>
      ${good.length ? `<h4 class="cc-sub">What’s working</h4><ul class="rv-good">${good.map((g) => `<li>${icon('check')}<span>${esc(g)}</span></li>`).join('')}</ul>` : ''}
      ${fixes.length ? `<h4 class="cc-sub">What to work on</h4><ol class="rv-fix">${fixes.map((x, k) => {
        const d = x.drill ? drillFor(x.drill) : null;
        return `<li><span class="rv-fixn" aria-hidden="true">${k + 1}</span><span class="rv-fixt">${esc(x.text)}${d ? `<button class="btn small ghost" data-action="goto-tip" data-tip="${esc(x.drill.split(':')[0])}">Drill: ${esc(fillText(d.name))} ${icon('chevron')}</button>` : ''}</span></li>`;
      }).join('')}</ol>` : ''}
    </article>`;
  }
  // What a review looks like, drawn with the drill figure, until the first real one arrives.
  const EXAMPLES = {};
  function exampleReview() {
    if (EXAMPLES[playerId] || !DA) return EXAMPLES[playerId] || null;
    const art = { scene: 'swing', club: 'iron', frames: ['address', 'top', 'impact', 'finish'].map((pose) => ({ pose, cap: pose })) };
    const fr = (i, label, marks, notes) => ({ svg: DA.render(art, i, {}), thumb: DA.render(art, i, { thumb: true }), w: 240, h: 200, label, marks, notes });
    const pt = (i) => DA.points(art, i), r1 = (v) => Math.round(v * 10) / 10;
    const a = pt(0), top = pt(1), imp = pt(2), fin = pt(3);
    const headLine = { type: 'line', from: [r1(a.head[0]), 12], to: [r1(a.head[0]), 176], kind: 'ref', dash: true };
    const ex = {
      id: 'example', club: '7i', view: 'face-on', title: '7 iron, face-on',
      summary: 'Send a swing video and it comes back like this: the key frames, with lines drawn on them, numbered notes, and the drills that fix what they show.',
      frames: [
        fr(0, 'Address', [headLine, { type: 'circle', at: a.head.map(r1), r: 16, kind: 'good', n: 1 }],
          [{ n: 1, kind: 'good', text: 'Head over the ball and weight even. The dashed line marks where your head starts.' }]),
        fr(1, 'Top', [headLine, { type: 'circle', at: top.head.map(r1), r: 16, kind: 'issue', n: 1 }, { type: 'arrow', from: [r1(top.head[0] - 30), r1(top.head[1] + 28)], to: [r1(a.head[0] - 2), r1(top.head[1] + 28)], kind: 'fix', n: 2 }],
          [{ n: 1, kind: 'issue', text: 'Your head has slid back, away from the target, off the dashed line.' }, { n: 2, kind: 'fix', text: 'Turn your chest instead, and keep your head over the ball.' }]),
        fr(2, 'Impact', [{ type: 'line', from: imp.hands.map(r1), to: [r1(imp.hands[0]), 190], kind: 'ref', dash: true }, { type: 'arrow', from: [r1(imp.hands[0] + 28), r1(imp.hands[1] + 22)], to: [r1(imp.hands[0] + 5), r1(imp.hands[1] + 4)], kind: 'good', n: 1 }],
          [{ n: 1, kind: 'good', text: 'Hands ahead of the ball at impact: the dashed line from your hands is past the ball.' }]),
        fr(3, 'Finish', [{ type: 'line', from: [r1(fin.leadFoot[0]), 176], to: [r1(fin.leadFoot[0]), 58], kind: 'ref', dash: true }, { type: 'dot', at: [r1(fin.leadFoot[0]), 172], r: 5, kind: 'fix', n: 1 }],
          [{ n: 1, kind: 'fix', text: 'Finish balanced over your front foot, belt buckle to the target, and hold it.' }])
      ],
      good: ['Steady posture at address', 'Hands ahead at impact'],
      fixes: (playerId === 'brother' ? [{ text: 'Keep your head still through the backswing', drill: 'strike:0' }, { text: 'Hold a balanced finish' }]
        : [{ text: 'Keep your head still through the backswing', drill: 'turn:1' }, { text: 'Hold a balanced finish', drill: 'turn:2' }])
        .map((x) => (x.drill && !drillFor(x.drill) ? { text: x.text } : x))
    };
    EXAMPLES[playerId] = ex;
    return ex;
  }
  function filmGuide(open) {
    return `<details class="card rv-film"${open ? ' open' : ''}><summary><span class="head-ico">${icon('play')}</span><span>How to film your swing</span></summary>
      <div class="rv-film-body">
        <p class="note">Two camera spots show the most. Tap the pictures to see where the phone goes and what to get in the picture.</p>
        ${artHtml(FILM_ART, 'film', 'How to film your swing')}
        <ul class="rv-tips">
          <li><strong>Face-on:</strong> straight in front of you, across the ball, pointing at your belt buckle.</li>
          <li><strong>Down the line:</strong> behind you, on a line through your hands that runs parallel to the target line, pointing at the target.</li>
          <li>About 10 feet away, at hip height, and level, not tilted. Use a stand or lean the phone on your bag.</li>
          <li>Get your whole body, the ball, and the club at the top of your swing in the picture, with a little room above it. Don’t zoom; move the phone instead.</li>
          <li>Use slow motion if your phone has it, in good light. Film 3 to 5 swings with one club, then text the video to Matthew with the date and the club.</li>
        </ul>
      </div></details>`;
  }
  function swingView() {
    const list = data.reviews || [];
    if (list.length) return list.map(reviewCard).join('') + filmGuide(false);
    const ex = exampleReview();
    return `<div class="card"><div class="card-head"><span class="head-ico">${icon('play')}</span><h3 class="card-title">No swing reviews yet</h3></div>
        <p class="note">Film a few swings and text the video to Matthew. Claude pulls out the key frames (setup, top, impact and finish), draws on them to show what’s happening, and adds the fixes and drills here.</p></div>
      ${filmGuide(true)}
      ${ex ? reviewCard(ex) : ''}`;
  }
  function focusCard(f, i, openFirst) {
    const call = f.callout ? C.sessionCallout(f.callout, data.sessions) : null;
    const drills = f.drills.map((d, di) => `<div class="drill">
        <h4>${esc(fillText(d.name))}</h4>
        ${artHtml(d.art, f.id + ':' + di, fillText(d.name))}
        <ol>${d.steps.map((s) => `<li>${esc(fillText(s))}</li>`).join('')}</ol>
        <p class="reps"><strong>Reps:</strong> ${esc(fillText(d.reps))}</p>
        ${drillVideo(d)}
      </div>`).join('');
    const open = ui.openTip ? f.id === ui.openTip : !!openFirst && i === 0;
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
      <button class="setting-row data-link" data-action="open-data"><span class="head-ico">${icon('data')}</span><span class="set-text"><span class="set-title">Data &amp; backup</span><span class="set-desc">Player, baseline, GitHub key and backups</span></span>${icon('chevron', 'chev')}</button>
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
      ${calTile(s.date)}
      <span class="sc-body">
        <span class="sc-title">${esc(longDate(s.date))}</span>
        <span class="sc-meta">${esc(deviceLine(s))} · ${n ? plural(n, 'shot') : 'no individual shots'}</span>
        ${clubs.length ? `<span class="sc-clubs">${clubs.map((c) => `<span class="sc-club">${esc(c)}</span>`).join('')}</span>` : ''}
        ${badges.length ? `<span class="badges">${badges.map((b) => `<span class="badge${b === 'Baseline' ? ' base' : ''}">${esc(b)}</span>`).join('')}</span>` : ''}
      </span>${icon('chevron', 'chev')}
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
      <button class="back" data-action="close-session">${icon('chevron')}All sessions</button>
      <div class="detail-head">${calTile(s.date)}<div>
        <h2>${esc(longDate(s.date))}</h2>
        <p class="meta">${esc(deviceLine(s))}${s.equipment ? ' · ' + esc(s.equipment) : ''} · ${n ? plural(n, 'shot') : 'no individual shots'}</p></div></div>
      <div class="detail-extra">
        ${s.date_note ? `<p class="hint" style="margin-top:0">${esc(s.date_note)}</p>` : ''}
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
    const lg = local.goals || emptyGoals();
    const goals = lg.added.length + Object.keys(lg.edits).length + lg.removed.length;
    return { added, edited, hidden: local.hidden.length, other, goals, total: local.sessions.length + local.hidden.length + other + goals };
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
      <button class="back" data-action="close-data">${icon('chevron')}Sessions</button>
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
      <div class="card" id="ghCard"><h3 class="card-title">Save goals to GitHub</h3>
        ${ghReady() ? `<p class="note"><strong>✓ This phone saves goals to GitHub</strong> (${esc(github.repo)}). Goals added, finished or removed here show on every phone.</p>
          <div class="row-actions"><button class="btn small danger" data-action="gh-disconnect">Remove the key from this phone</button></div>`
        : `<p class="note">Right now, goals added on this phone stay on this phone. Add a GitHub key once and they save straight to the repo, so they show on every phone.</p>
          <ol class="gh-steps">
            <li>On GitHub, open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Settings → Fine-grained tokens → Generate new token</a>.</li>
            <li>Name it “Shot tracker”, set an expiration, and under <strong>Repository access</strong> pick <strong>Only select repositories → ${esc(github.repo.split('/')[1])}</strong>.</li>
            <li>Under <strong>Permissions</strong>, tap <strong>+ Add permissions</strong>, tick <strong>Contents</strong>, then change it from Read-only to <strong>Read and write</strong>. GitHub adds Metadata (read-only) by itself; leave it.</li>
            <li>Set an expiration, tap <strong>Generate token</strong>, and copy it right away (GitHub shows it only once). Paste it here on each phone.</li>
          </ol>
          <div class="field"><label for="ghTokenInput">GitHub key</label><input id="ghTokenInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></div>
          <button class="btn block" data-action="gh-connect">Save key on this phone</button>
          <p class="hint">The key stays in this phone’s browser and is never added to the site or the repo. It can only change files in ${esc(github.repo.split('/')[1])}, and you can delete it on GitHub any time.</p>`}
      </div>
      <div class="card"><h3 class="card-title">Backup</h3>
        <p class="note">${esc(status)} <code>${esc(file)}</code>${bundle && bundleStatus !== 'missing' ? ` (${plural(fileSessions().length, 'session')})` : ''}.</p>
        <p class="note" style="margin-top:8px">On this device: ${parts.length ? esc(parts.join(', ')) + (c.added + c.edited + c.hidden === 1 ? ' session' : ' sessions') : 'no session changes'}${c.other ? `, plus ${c.other === 1 ? 'one setting' : c.other + ' settings'}` : ''}${c.goals ? `, plus ${c.goals === 1 ? 'one goal change' : c.goals + ' goal changes'}` : ''}.</p>
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
    if (b.equipment) out.equipment = b.equipment;
    out.baseline_session_id = data.baseline_session_id;
    out.personal_goals = (data.goals || []).map((g) => ({ id: g.id, text: g.text, source: g.source, added: g.added, done: g.done }));
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
      // Goals merge by id: new ones are added; a known goal takes the file's done state.
      if (Array.isArray(d.personal_goals)) {
        const have = new Map((data.goals || []).map((g) => [g.id, g]));
        C.mergeGoals(d.personal_goals).forEach((g) => {
          if (!have.has(g.id)) local.goals.added.push(g);
          else if (have.get(g.id).done !== g.done) local.goals.edits[g.id] = Object.assign({}, local.goals.edits[g.id], { done: g.done });
        });
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
    'goals-edit'() { ui.goalsEdit = true; renderGoals(); const t = $('#goalText'); if (t) t.focus(); },
    'goals-close'() { ui.goalsEdit = false; renderGoals(); },
    'goals-all'() { ui.goalsAll = !ui.goalsAll; renderGoals(); },
    'goal-src'(b) {
      // Update in place so a half-typed goal isn't lost.
      ui.goalSrc = b.dataset.src;
      $$('[data-action="goal-src"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.src === ui.goalSrc)));
    },
    'goal-add'() { addGoal(); },
    'art-step'(b) {
      const st = artBox(b);
      if (!st) return;
      if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
      st.playing = false;
      artShow(st, +b.dataset.i);
      artPlayButton(st);
    },
    'art-play'(b) {
      const st = artBox(b);
      if (!st) return;
      st.playing = !st.playing;
      st.next = performance.now() + 400;
      artPlayButton(st);
    },
    'play-video'(b) {
      const id = b.dataset.id;
      if (!/^[\w-]{11}$/.test(id || '')) return;
      const f = document.createElement('iframe');
      f.className = 'vid-frame';
      f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
      f.title = (b.getAttribute('aria-label') || 'Coach’s video').replace(/^Play the coach’s video: /, '');
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      b.replaceWith(f);
    },
    'practice-club'(b) {
      ui.practiceClub = b.dataset.club; ui.check = {}; renderTips();
      const card = $('#practiceCard'); if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'check-dir'(b) {
      // Update in place so typed numbers stay put.
      ui.check = Object.assign({}, ui.check, { dir: ui.check && ui.check.dir === b.dataset.dir ? null : b.dataset.dir });
      $$('[data-action="check-dir"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.dir === ui.check.dir)));
    },
    'check-shot'() { runCheck(); },
    'check-clear'() { ui.check = {}; renderTips(); const f = $('#ckCarry'); if (f) f.focus(); },
    'gh-retry'() { ghError = ''; syncGoals(); },
    'open-gh'() {
      ui.tab = 'sessions'; ui.sessionsView = 'data'; ui.sessionId = null; ui.goalsEdit = false; render();
      const c = $('#ghCard'); if (c) c.scrollIntoView({ block: 'start' });
    },
    async 'gh-connect'(b) {
      const input = $('#ghTokenInput');
      const token = input ? input.value.trim() : '';
      if (!token) { toast('Paste the GitHub key first'); if (input) input.focus(); return; }
      b.disabled = true; b.textContent = 'Checking the key…';
      try {
        await ghGetFile(playerInfo().file, token);
        try { localStorage.setItem(GH_TOKEN, token); } catch (e) { throw new Error('storage'); }
        ghError = '';
        toast('Key saved. Goals on this phone now save to GitHub.');
        renderSessions(); renderGoals();
        syncGoals();
      } catch (e) {
        toast(e.message === 'storage' ? 'This browser won’t save the key (private mode?).' : ghErrorText(e));
        b.disabled = false; b.textContent = 'Save key on this phone';
      }
    },
    'gh-disconnect'() {
      if (!confirm('Remove the GitHub key from this phone? Goals added here will stay on this phone until a key is added again.')) return;
      try { localStorage.removeItem(GH_TOKEN); } catch (e) { /* ignore */ }
      toast('Key removed from this phone');
      renderSessions(); renderGoals();
    },
    'goal-done'(b) { setGoalDone(b.dataset.id); },
    'goal-remove'(b) { removeGoal(b.dataset.id); },
    'practice-view'(b) {
      ui.practiceView = b.dataset.view; ui.openTip = null; hideTip(); renderTips();
      const hero = $('#view-tips .hero');
      if (hero && hero.getBoundingClientRect().top < 0) hero.scrollIntoView({ block: 'start' });
    },
    'rv-frame'(b) {
      const r = reviewById(b.dataset.id), i = +b.dataset.i;
      if (!r || !(i >= 0 && i < r.frames.length)) return;
      ui.rvFrame[r.id] = i;
      const box = $(`.rv-viewer[data-review="${r.id}"]`);
      if (box) box.innerHTML = rvFrameHtml(r, i);
      const t = box && box.querySelector(`.rv-thumb[data-i="${i}"]`);
      if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    'rv-marks'() {
      ui.rvMarks = !ui.rvMarks;
      $$('.rv-media').forEach((m) => m.classList.toggle('clean', !ui.rvMarks));
      $$('[data-action="rv-marks"]').forEach((x) => { x.setAttribute('aria-pressed', String(ui.rvMarks)); x.textContent = ui.rvMarks ? 'Hide the lines' : 'Show the lines'; });
    },
    'goto-tip'(b) {
      ui.tab = 'tips'; ui.practiceView = 'drills'; ui.openTip = b.dataset.tip; hideTip(); render();
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.id === 'goalText') { e.preventDefault(); addGoal(); }
    if (e.key === 'Enter' && e.target && /^ck(Carry|Ball|Launch|Off)$/.test(e.target.id)) { e.preventDefault(); runCheck(); }
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

  let swipe = null;
  document.addEventListener('touchstart', (e) => {
    const m = e.target.closest ? e.target.closest('[data-swipe]') : null;
    swipe = m && e.touches.length === 1 ? { id: m.dataset.swipe, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!swipe || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y, id = swipe.id;
    swipe = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const r = reviewById(id);
    if (!r) return;
    const i = (ui.rvFrame[id] || 0) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < r.frames.length) actions['rv-frame']({ dataset: { id, i: String(i) } });
  }, { passive: true });

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
    // With a GitHub key, read the newest file straight from the repo, so a goal saved on
    // another phone shows up without waiting for the site to rebuild.
    const fromPages = () => fetch(file, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    const load = ghReady() ? ghGetFile(file).then((f) => JSON.parse(f.text)).catch(fromPages) : fromPages();
    load
      .then((d) => {
        if (id !== playerId) return;
        if (!d || !Array.isArray(d.sessions)) throw new Error('Unexpected data file');
        const changed = JSON.stringify(d) !== JSON.stringify(bundle);
        bundle = d;
        bundleStatus = 'fresh';
        saveJSON(key('bundle'), d);
        if (changed || !data.sessions.length) refresh(); else renderBanner();
        syncGoals(); // upload goal changes made earlier on this phone, if it has a key
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
        const gh = validGithub(d.github);
        if (gh) { github = gh; saveJSON(LS + '.github', gh); }
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
