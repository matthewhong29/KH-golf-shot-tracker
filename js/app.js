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
    { id: 'matthew', name: 'M2', file: 'data/matthew_golf_data.json' },
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
  // The player the link asked for, kept until data/players.json has loaded: a player added since
  // this phone last saw the list isn't in it yet, and the address is rewritten below.
  let askedFor = urlPlayer();
  let playerId = C.resolvePlayer(players, urlPlayer(), lastPlayer());
  let bundle = null;            // this player's data file
  let bundleStatus = 'loading'; // loading | fresh | offline | missing
  let local = null;             // this player's edits on this device
  let data = null;              // merged view
  const ui = freshUI();

  function freshUI() {
    return {
      tab: 'stats', scope: null, dispClub: 'All', progClub: null, progMetric: 'carry_yds', statClub: null, openTip: null,
      rp: { club: 'All', idx: 0, speed: 1, view: 'tee', best: false },
      game: { setup: false, card: false, dir: null },
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
  // This device's edits, checked over, so a corrupt or hand-edited copy can't break the page.
  function loadLocal() {
    const d = loadJSON(key('local'));
    const l = d && typeof d === 'object' && Array.isArray(d.sessions) ? Object.assign(emptyLocal(), d) : emptyLocal();
    const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
    l.sessions = l.sessions.filter((s) => obj(s) && s.id != null && s.id !== '')
      .map((s) => Object.assign({}, s, { id: String(s.id), shots: Array.isArray(s.shots) ? s.shots.filter(obj) : [] }));
    if (!Array.isArray(l.hidden)) l.hidden = [];
    if (!obj(l.player)) l.player = null;
    const g = obj(l.goals) ? l.goals : {};
    l.goals = { added: Array.isArray(g.added) ? g.added.filter(obj) : [], edits: obj(g.edits) ? g.edits : {}, removed: Array.isArray(g.removed) ? g.removed : [] };
    return l;
  }
  // A swing review from the data file: its frames are images, so any markup in them is dropped
  // (only the built-in example draws its frames) and the sizes are kept as numbers.
  function safeReview(r) {
    const frames = r.frames.filter((f) => f && typeof f === 'object').map((f) => {
      const o = Object.assign({}, f, { w: Number(f.w) > 0 ? Number(f.w) : 360, h: Number(f.h) > 0 ? Number(f.h) : 640 });
      delete o.svg; delete o.thumb;
      return o;
    });
    return Object.assign({}, r, { frames });
  }
  function saveLocal() { if (!saveJSON(key('local'), local)) toast('Couldn’t save on this device. Export a backup from Data & backup.'); }
  function loadPlayerState() {
    bundle = loadJSON(key('bundle'));
    bundleStatus = 'loading';
    local = loadLocal();
    data = merge();
    gmApplyReset();
  }
  function setURL() {
    try {
      const want = '?player=' + encodeURIComponent(playerId);
      if (window.location.search !== want) history.replaceState(null, '', window.location.pathname + want + window.location.hash);
    } catch (e) { /* file:// or sandboxed */ }
  }
  function switchPlayer(id) {
    if (!players.some((p) => p.id === id)) return;
    askedFor = null;
    if (gmMo) gmMotionStop();
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
    local.sessions.forEach((s) => { if (s && s.id) byId.set(s.id, { s, source: fileSession(s.id) ? 'edited' : 'local' }); });
    const sessions = Array.from(byId.values()).map((x) => Object.assign({}, x.s, { _source: x.source })).sort(C.compareSessions);
    return {
      player: local.player || b.player || { name: playerInfo().name },
      clubs: Object.assign({}, b.clubs || {}, local.clubs || {}),
      equipment: b.equipment || null,
      // local.baselineSessionId: null = use the file's; '' = none (first session per club)
      baseline_session_id: local.baselineSessionId != null ? (local.baselineSessionId || null) : (b.baseline_session_id || null),
      goals: C.mergeGoals(b.personal_goals, local.goals),
      swingNotes: (Array.isArray(b.swing_notes) ? b.swing_notes : []).filter((x) => x && typeof x.note === 'string' && x.note.trim()),
      reviews: (Array.isArray(b.swing_reviews) ? b.swing_reviews : [])
        .filter((r) => r && r.id && Array.isArray(r.frames) && r.frames.length).map(safeReview).filter((r) => r.frames.length)
        .sort((x, y) => String(y.date || '').localeCompare(String(x.date || ''))),
      sessions
    };
  }
  function refresh() { data = merge(); render(); }
  // Goals only change the goals bar, so that's all that's drawn again (a full redraw would
  // stop a shot in flight on the Game tab, or clear a number being typed).
  function refreshGoals() { data = merge(); renderGoals(); }
  // New data that arrives while he's typing a number or in the middle of a swing waits until
  // he's done, so it never clears what he typed or resets the meter mid-swing.
  let refreshTimer = 0;
  function userBusy() {
    const a = document.activeElement;
    if (a && (/^(TEXTAREA|SELECT)$/.test(a.tagName) || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range)$/.test(a.type)))) return true;
    return !!gm && (gm.busy || gmSwinging() || (!!gmMo && !!gmMo.phase && gmMo.phase !== 'idle'));
  }
  function refreshWhenFree() {
    clearInterval(refreshTimer); refreshTimer = 0;
    if (!userBusy()) { refresh(); return; }
    renderBanner();
    refreshTimer = setInterval(() => { if (!userBusy()) { clearInterval(refreshTimer); refreshTimer = 0; refresh(); } }, 700);
  }
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
    replay: '<path d="M4.6 13a7.5 7.5 0 1 0 2.1-6.4"/><path d="M4.5 4.2v4.6h4.6"/>',
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
  // A chart: a labelled group whose dots and bars are images with their own labels. Only the
  // first is a tab stop; the arrow keys move along the rest (see the keydown handler).
  function svg(w, h, label, body) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="group" aria-label="${esc(label)}">${body.replace('class="pt" tabindex="-1"', 'class="pt" tabindex="0"')}</svg>`;
  }
  // kind: '' (counts in the numbers), 'mis' (likely mis-hit: hollow) or 'out' (outlier: ringed).
  function dotMark(cx, cy, r, tip, kind) {
    const ring = kind === 'out' ? `<circle class="ring" cx="${f1(cx)}" cy="${f1(cy)}" r="${r + 4}"/>` : '';
    return `<g class="pt" tabindex="-1" role="img" data-tip="${tip}" aria-label="${tip}">${ring}<circle class="dot${kind ? ' ' + kind : ''}" cx="${f1(cx)}" cy="${f1(cy)}" r="${r}"/><circle class="hit" cx="${f1(cx)}" cy="${f1(cy)}" r="14"/></g>`;
  }
  // How a shot counts: 'mis', 'out' or ''.
  function shotKind(entry, s) { return entry.mis.indexOf(s) >= 0 ? 'mis' : (entry.outliers || []).indexOf(s) >= 0 ? 'out' : ''; }
  // "2 mis-hits and 1 outlier"; '' when none.
  function leftOut(nMis, nOut, sep) { return [nMis ? plural(nMis, 'mis-hit') : '', nOut ? plural(nOut, 'outlier') : ''].filter(Boolean).join(sep || ' and '); }
  function rangeMark(x0, x1, cy, tip) {
    return `<g class="pt" tabindex="-1" role="img" data-tip="${tip}" aria-label="${tip}"><rect class="rng" x="${f1(x0)}" y="${f1(cy - 5)}" width="${f1(Math.max(10, x1 - x0))}" height="10" rx="5"/><rect class="hit" x="${f1(x0 - 6)}" y="${f1(cy - 14)}" width="${f1(x1 - x0 + 12)}" height="28"/></g>`;
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
  function shotTip(s, kind) {
    return tipAttr([
      `${C.fmtRaw(s.carry_yds)} yds carry` + (C.isNum(s.offline_ft) ? ` · ${dirU(s.offline_ft, 'ft')} (${dirU(s.offline_ft / 3, 'yds', 1)})` : ''),
      [s.club, s.time].filter(Boolean).join(' · '),
      kind === 'mis' ? 'Likely mis-hit (thin, topped or fat), left out of the numbers'
        : kind === 'out' ? 'Outlier: far off the usual carry, left out of the numbers but still solid contact' : ''
    ]);
  }

  // True when a row label runs into the value at the other end of its line.
  function labelsCollide(el) {
    const s = el.querySelector('svg');
    if (!s || !s.getBBox) return false;
    const vals = $$('text.val, text.sub', s).map((v) => v.getBBox());
    return $$('text.rowlbl', s).some((l) => {
      const a = l.getBBox();
      return vals.some((b) => Math.abs(b.y - a.y) < 6 && a.x + a.width + 12 > b.x);
    });
  }
  // Carry gapping: a row per club (label above, so the bar gets the full width). When a
  // club name would run into its numbers (long names on small phones), the numbers get
  // their own line.
  function drawGap(el, entries, clubs, twoLine) {
    const rows = clubs.map((c) => {
      const e = entries[c];
      return { club: c, e, st: C.metricStat(e, 'carry_yds'), pts: e.shots.filter((s) => C.isNum(s.carry_yds)) };
    }).filter((r) => r.pts.length || (r.st && C.isNum(r.st.min)));
    if (!rows.length) { el.innerHTML = '<p class="empty">No carry data in this session.</p>'; return; }
    const W = chartWidth(el), rowH = twoLine ? 116 : 94, top = 2, axisH = 32, padL = 16, padR = 20;
    const H = top + rows.length * rowH + axisH;
    const vals = [];
    rows.forEach((r) => { r.pts.forEach((s) => vals.push(s.carry_yds)); if (r.st && C.isNum(r.st.min)) vals.push(r.st.min, r.st.max); });
    const t = ticksFor(Math.min(...vals), Math.max(...vals), W < 420 ? 4 : 6);
    const x = lin(t.lo, t.hi, padL, W - padR);
    const g = [];
    t.ticks.forEach((v) => { g.push(line('grid', x(v), top, x(v), H - axisH)); g.push(text('tick', x(v), H - 10, C.fmtRaw(v), 'middle')); });
    let prev = null;
    rows.forEach((r, i) => {
      const y0 = top + i * rowH, ty = y0 + 22, tv = twoLine ? y0 + 46 : ty, cy = twoLine ? y0 + 84 : y0 + 62;
      g.push(text('rowlbl', padL, ty, r.club));
      if (r.st && C.isNum(r.st.avg)) {
        const gap = prev != null ? `${C.fmtSigned(r.st.avg - prev, 1)} gap` : '', few = r.st.n < 4 ? `${plural(r.st.n, 'solid shot')}` : '';
        g.push(`<text class="val" x="${f1(W - padR)}" y="${f1(tv)}" text-anchor="end">${esc(C.fmtNum(r.st.avg, 1))} yds${gap || few ? `<tspan class="sub"> · ${esc([gap, few].filter(Boolean).join(' · '))}</tspan>` : ''}</text>`);
        prev = r.st.avg;
      } else if (r.st && r.st.allMis) {
        g.push(text('sub', W - padR, tv, `all ${r.st.total} were mis-hits`, 'end'));
      } else {
        g.push(text('sub', W - padR, tv, 'recorded range', 'end'));
      }
      if (r.st && C.isNum(r.st.min) && C.isNum(r.st.max)) {
        g.push(rangeMark(x(r.st.min), x(r.st.max), cy, tipAttr([`${C.fmtRange(r.st.min, r.st.max)} yds`,
          `${r.club} carry range` + (r.st.summaryOnly ? ' (recorded, includes any mis-hits)' : ` · ${plural(r.st.n, 'solid shot')}`)])));
      }
      const dys = swarm(r.pts.map((s) => x(s.carry_yds)), 6);
      r.pts.forEach((s, k) => { const kind = shotKind(r.e, s); g.push(dotMark(x(s.carry_yds), cy + dys[k], 6, shotTip(s, kind), kind)); });
      if (r.st && C.isNum(r.st.avg)) {
        const xa = x(r.st.avg);
        g.push(line('halo', xa, cy - 17, xa, cy + 17), line('avg', xa, cy - 17, xa, cy + 17));
      }
    });
    el.innerHTML = svg(W, H, 'Carry by club: range and average of solid shots, plus every shot', g.join(''));
    if (!twoLine && labelsCollide(el)) drawGap(el, entries, clubs, true);
  }

  // Dispersion. Offline is converted from feet to yards so both axes share one scale.
  function dispPoints(entry) {
    return entry.shots.filter((s) => C.isNum(s.offline_ft) && C.isNum(s.carry_yds)).map((s) => ({ s, x: s.offline_ft / 3, y: s.carry_yds, kind: shotKind(entry, s) }));
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
    pts.forEach((p) => g.push(dotMark(sx(p.x), sy(p.y), 6, shotTip(p.s, p.kind), p.kind)));
    const solid = pts.filter((p) => !p.kind);
    if (solid.length >= 2) {
      const mx = solid.reduce((a, p) => a + p.x, 0) / solid.length, my = solid.reduce((a, p) => a + p.y, 0) / solid.length;
      const cx = sx(mx), cy = sy(my), a = 10;
      const tip = tipAttr([`${C.fmtNum(my, 1)} yds carry · ${dirU(mx, 'yds', 1)}`, 'Average of ' + plural(solid.length, 'solid shot')]);
      g.push(`<g class="pt" tabindex="-1" role="img" data-tip="${tip}" aria-label="${tip}">` +
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
      const left = leftOut(i.e.mis.length, i.e.outliers.length, ', ');
      const nums = car.n ? ` · ${C.fmtNum(car.avg, 1)} yds · ${dirU(off.avg / 3, 'yds', 1)}` : ' · all mis-hits';
      return `<div class="facet"><h4>${esc(i.c)}</h4><div class="fmeta">${plural(i.e.shots.length, 'shot')}${left ? ` (${left})` : ''}${esc(nums)}</div><div class="chart" data-facet="${esc(i.c)}"></div></div>`;
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
      const left = leftOut(r.e.mis.filter((s) => C.isNum(s.offline_ft)).length, r.e.outliers.filter((s) => C.isNum(s.offline_ft)).length);
      const tip = tipAttr([`${dirU(v, 'yds', 1)} (${dirU(r.st.avg, 'ft', 1)})`, `${r.club} average miss · ${plural(r.st.n, 'solid shot')}`,
        `Range ${C.fmtRange(r.st.min, r.st.max, true)} ft`, left ? `Leaves out ${left}` : '']);
      g.push(text('rowlbl', padL - 12, cy + 6, r.club, 'end'));
      g.push(`<g class="pt" tabindex="-1" role="img" data-tip="${tip}" aria-label="${tip}">${path ? `<path class="bar" d="${path}"/>` : ''}<rect class="hit" x="${f1(Math.min(cx, x1) - 6)}" y="${f1(cy - 15)}" width="${f1(w + 12)}" height="30"/></g>`);
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
        sub = row.p == null ? 'ranges only' : `${C.solidCount(e)} of ${plural(e.shots.length, 'shot')}`;
        if (row.p != null) {
          g.push(rangeMark(x(0), x(row.p), cy, tipAttr([`${C.roundHalfEven(row.p, 0)}% solid contact`, `${C.solidCount(e)} of ${plural(e.shots.length, 'shot')} · ${C.fmtDate(s.date)}`])));
          g.push(dotMark(x(row.p), cy, 6, tipAttr([`${C.roundHalfEven(row.p, 0)}% solid contact`, C.fmtDate(s.date)]), false));
        }
      } else {
        value = st.allMis ? '—' : C.isNum(st.avg) ? withUnit(m, st.avg) : C.fmtRange(st.min, st.max, m.dir);
        sub = st.allMis ? `all ${st.total} were mis-hits` : st.summaryOnly ? 'recorded range'
          : e.outliers.length ? `${st.n} of ${plural(e.shots.length, 'shot')}` : e.mis.length ? `${st.n} solid of ${e.shots.length}` : plural(st.n, 'shot');
        if (C.isNum(st.min) && C.isNum(st.max)) {
          g.push(rangeMark(x(st.min), x(st.max), cy, tipAttr([`${C.fmtRange(st.min, st.max, m.dir)} ${m.dir ? 'ft' : m.unit}`.trim(),
            `${m.label} range · ${C.fmtDate(s.date)}` + (st.summaryOnly ? ' (includes any mis-hits)' : '')])));
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
    rpStop();
    gmStop();
    // the phone's motion is only read on the Game tab
    if (gmMo && ui.tab !== 'game') gmMotionStop();
    renderHeader();
    renderGoals();
    renderBanner();
    $$('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
    fitTabs();
    $$('section.view').forEach((v) => { v.hidden = v.dataset.view !== ui.tab; });
    ({ stats: renderStats, progress: renderProgress, tips: renderTips, game: renderGame, sessions: renderSessions })[ui.tab]();
  }
  // Five tabs: when a tab's name won't fit (a narrow phone, or a wide font), only the tab
  // you're on shows its name; the others keep their icons, and their names for screen readers.
  function fitTabs() {
    const nav = $('nav.tabs');
    if (!nav) return;
    nav.classList.remove('compact');
    const tight = $$('.tl', nav).some((t) => t.getBoundingClientRect().width > t.parentElement.getBoundingClientRect().width - 4);
    nav.classList.toggle('compact', tight);
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
    saveLocal(); refreshGoals();
    toast('Goal added');
    const again = $('#goalText'); if (again) again.focus();
    syncGoals();
  }
  function setGoalDone(id) {
    const g = (data.goals || []).find((x) => x.id === id);
    if (!g) return;
    local.goals.edits[id] = Object.assign({}, local.goals.edits[id], { done: !g.done });
    saveLocal(); refreshGoals();
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
    saveLocal(); refreshGoals();
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
      if (pid === playerId) { bundle = saved; refreshWhenFree(); }
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
  // Photos and videos go to Matthew, who adds them with Claude; on his own page, straight to Claude.
  function isMatthew() { return /^matthew\b/i.test(String((data.player && data.player.relationship) || '')); }
  function sendTo(what) { return isMatthew() ? `send the ${what} to Claude` : `text the ${what} to Matthew`; }
  function emptyState(onSessionsTab) {
    if (bundleStatus === 'loading' && !data.sessions.length) return skeleton();
    return `<div class="card empty-card">${EMPTY_ART}<h3>No sessions yet</h3>
      <p>After a range session, ${sendTo('screen photos')}.</p>
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
      return `<td><span class="v">${e.shots.length}</span>${e.mis.length ? `<span class="n">${plural(e.mis.length, 'mis-hit')}</span>` : ''}${e.outliers.length ? `<span class="n">${plural(e.outliers.length, 'outlier')}</span>` : ''}</td>`;
    }).join('')}</tr>`;
    const rows = [shotsRow], missing = [];
    C.METRICS.forEach((m) => {
      const stats = clubs.map((c) => C.metricStat(entries[c], m.key));
      if (stats.every((s) => !s)) { missing.push(m.label.toLowerCase()); return; }
      rows.push(`<tr><th scope="row">${esc(m.label)}${m.unit ? `<span class="u">${esc(unitLabel(m))}</span>` : ''}</th>${stats.map((s) => cellHtml(m, s)).join('')}</tr>`);
    });
    const anyMis = clubs.some((c) => entries[c].mis.length), anyOut = clubs.some((c) => entries[c].outliers.length);
    const leftOutText = [anyMis ? 'likely mis-hits (the hollow dots on the charts)' : '', anyOut ? 'outliers (the ringed dots)' : ''].filter(Boolean).join(' and ');
    const swipe = clubs.length > 2 ? `<p class="swipe-hint">Swipe the table sideways to see all ${clubs.length} clubs →</p>` : '';
    return `${swipe}<div class="table-wrap"><table class="matrix">${head}<tbody>${rows.join('')}</tbody></table></div>
      <p class="hint">Each cell shows the average, then lowest–highest. ${leftOutText ? `Averages and ranges leave out ${leftOutText}. ` : ''}“3 of 9” means only some ${anyMis || anyOut ? 'solid ' : ''}shots had that number. Curve and offline are in feet; L = left, R = right.${missing.length ? ' Not measured: ' + esc(missing.join(', ')) + '.' : ''}</p>`;
  }
  // ----- One club at a time: goals, "needs work" and plain-language numbers -----
  const PLAIN = {
    solid_pct: ['Solid contact', 'Shots that weren’t likely mis-hits'],
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
  // The drill that trains each kind of focus, best first, as 'section:drill' keys into js/tips.js:
  // the first one this player has. Long clubs get the long-club drills: sweeping it off a low tee
  // for contact, and for the start line a fairway game off the tee, else the gate.
  function focusDrills(focus, club) {
    const kind = C.clubKind(club), long = kind !== 'iron', tee = kind === 'driver' || kind === 'wood';
    switch (focus && focus.kind) {
      case 'contact': return long ? ['contact:3', 'strike:0'] : ['contact:0', 'strike:0'];
      case 'direction': return tee ? ['games:2', 'straight:2', 'strike:1'] : ['straight:2', 'strike:1'];
      case 'launch': return focus.status === 'low' ? (long ? ['contact:3'] : []) : ['hands:0', 'strike:2'];
      case 'distance': return ['plan:2', 'speed:1'];
      default: return [];
    }
  }
  function focusDrillKey(focus, club) { return focusDrills(focus, club).find((k) => drillFor(k)) || null; }
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
    if (g.id === 'carry') { target = `${g.lo}–${g.hi} yds`; now = `${g.n} of ${plural(g.of, 'shot')} landed in it (goal: 7 of 10)`; }
    else if (g.id === 'line') { target = 'Within 10 yds of your target'; now = `${g.n} of ${plural(g.of, 'shot')} (goal: 8 of 10)`; }
    else if (g.id === 'launch') { target = `${g.lo}–${g.hi}°`; now = `${C.fmtNum(g.avg, 1)}° average${g.status === 'high' ? ', a bit high' : g.status === 'low' ? ', a bit low' : ''}`; }
    else { target = '9 of 10 swings'; now = `${g.n} of ${g.of} solid`; }
    const note = g.id === 'carry' ? `<span class="g-note">The same distance every time: within ${Math.round((g.hi - g.lo) / 2)} yds of your typical ${g.typical}.${C.isNum(g.pureCarry) ? ` A pure strike carries about ${g.pureCarry}.` : ''}</span>` : '';
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
    const nMis = e.mis.length, nOut = e.outliers.length;
    const shotsLine = !e.shots.length ? 'Ranges only; individual shots weren’t recorded.'
      : (nMis ? `${plural(e.shots.length, 'shot')}: ${C.solidCount(e)} solid, ${plural(nMis, 'likely mis-hit')}` : `${plural(e.shots.length, 'shot')}, all solid`)
        + (nMis && nOut ? ` (the mis-hit${nMis > 1 ? 's' : ''} and ${plural(nOut, 'outlier')} are left out of the numbers)`
          : nMis ? ' (left out of the numbers)'
            : nOut ? `; ${plural(nOut, 'outlier')}, far off the usual carry, ${nOut > 1 ? 'are' : 'is'} left out of the numbers` : '')
        + (e.easy && e.easy.length ? `, plus ${plural(e.easy.length, 'warm-up or half swing', 'warm-up or half swings')} that ${e.easy.length > 1 ? 'aren’t' : 'isn’t'} counted` : '');
    const rows = [];
    if (e.shots.length) {
      rows.push(statRow(PLAIN.solid_pct[0], PLAIN.solid_pct[1], C.roundHalfEven(C.solidPct(e), 0) + '%',
        `${C.solidCount(e)} of ${plural(e.shots.length, 'shot')}`, flagKeys.has('solid_pct')));
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
      t.push(kpi({ label: 'Solid contact', value: C.roundHalfEven(sp, 0) + '%', meter: sp, sub: `${C.solidCount(e)} of ${e.shots.length}`, flag: flagKeys.has('solid_pct') }));
      if (off && C.isNum(off.avg)) {
        const d = dirSplit(off.avg / 3, 'yds', 1);
        t.push(kpi({ label: 'Average miss', value: d.value, unit: d.unit, sub: `${dirU(off.avg, 'ft', 1)} on the screen`, flag: flagKeys.has('offline_ft') }));
      }
      tiles = `<div class="kpis four">${t.join('')}</div>`;
    }
    const dk = G ? focusDrillKey(G.focus, club) : null, dd = dk ? drillFor(dk) : null;
    const goals = G ? `<div class="goals">
        <h4 class="goals-title"><span class="head-ico">${icon('target')}</span>Goals for your ${esc(club)}</h4>
        <div class="focus-line"><span class="fl-label">Focus</span><span class="fl-text">${esc(G.focus.text)}</span>
          ${dd ? `<button class="btn ghost small" data-action="goto-tip" data-goto="${esc(dk.split(':')[0])}" data-drill="${esc(dk)}">Drill: ${esc(fillText(dd.name))} →</button>` : ''}</div>
        <ul class="goal-list">${G.goals.map(goalRow).join('')}</ul>
        <p class="hint">Goals come from ${scopeAll ? 'all of your sessions' : 'your shots in this session'} and move as you improve. Launch windows are ballpark targets for a modest swing speed.</p>
      </div>` : '';
    return `<div class="club-card">
      ${clubHead(club)}
      <p class="cc-shots">${esc(shotsLine)}</p>
      ${tiles}
      ${flags.length ? `<div class="work-box">${NW_PILL}<ul>${flags.map((f) => `<li>${esc(cap(f.text))}.</li>`).join('')}</ul></div>` : ''}
      ${goals}
      <h4 class="cc-sub">The numbers</h4>
      <dl class="stat-list">${rows.join('')}</dl>
      <p class="hint">Averages and ranges leave out likely mis-hits${nOut ? ' and outliers (shots far off the usual carry, which still count as solid contact)' : ''}. Curve and offline are in feet; L = left, R = right.</p>
    </div>`;
  }
  function workBox(work) {
    if (!work) return '';
    return `<div class="work-box">${NW_PILL}<div class="work-list">${work.clubs.map((w) =>
      `<button class="work-row" data-action="focus-club" data-club="${esc(w.club)}"><span class="wr-club">${esc(w.club)}</span><span class="wr-text">${esc(w.flags.map((f) => cap(f.text)).join('. '))}.</span>${icon('chevron', 'chev')}</button>`).join('')}</div>
      <p class="wr-hint">Tap a club to see its goals.</p></div>`;
  }

  // The session before this one that has shots, for "vs last time" changes. Each is
  // judged club by club over the clubs hit both times (GolfCore.rateChange), so a day of
  // mostly hybrids isn't set against a day of mostly wedges, and only a change bigger than
  // the luck of a few shots gets an arrow.
  function prevShotSession(s) {
    if (!s) return null;
    const list = data.sessions.filter((x) => shotCount(x)).sort(C.compareSessions);
    const i = list.findIndex((x) => x.id === s.id);
    if (i < 1) return null;
    return { session: list[i - 1] };
  }
  // Each shot of a session as { club, ok } for a rate: solid contact, or on line (solid shots).
  function rateShots(s, kind) {
    const mis = C.sessionMishits([s]);
    return C.fullSwings(C.sessionShots(s)).map((x) => ({ club: x.club, ok: kind === 'solid' ? !mis.has(x)
      : mis.has(x) || !C.isNum(x.offline_ft) ? null : Math.abs(x.offline_ft) <= C.GOALS.lineFt }));
  }
  function rateDelta(prev, cur, kind) {
    const rc = C.rateChange(rateShots(prev.session, kind), rateShots(cur, kind)), when = C.fmtDate(prev.session.date, { short: true });
    if (!rc) return null;
    const same = rc.clubs.length < new Set(C.sessionShots(cur).map((x) => x.club)).size ? ', same clubs' : '';
    if (!rc.sig) return { cls: 'same', text: `About the same as ${when}${same}` };
    const d = Math.round(Math.abs(rc.d));
    return { cls: rc.d > 0 ? 'up' : 'down', dir: rc.d > 0 ? 'up' : 'down', text: `${d} ${d === 1 ? 'point' : 'points'} vs ${when}${same}` };
  }
  // The session at a glance: big numbers, then what needs work, then the highlights.
  function sessionSummary(sc, hl, work) {
    const isAll = sc.id === 'all', shots = [], mis = new Set(), odd = new Set(), balls = [];
    sc.sessions.forEach((s) => {
      C.sessionShots(s).forEach((x) => balls.push(x));
      C.fullSwings(C.sessionShots(s)).forEach((x) => shots.push(x));
      C.sessionMishits([s]).forEach((x) => mis.add(x));
      C.sessionOutliers([s]).forEach((x) => odd.add(x));
    });
    // Solid contact and on line count outliers; the longest carry leaves them out.
    const solid = shots.filter((x) => !mis.has(x));
    const tiles = [], skip = new Set(['work']);
    if (shots.length) {
      const prev = isAll ? null : prevShotSession(sc.session);
      const clubs = new Set(balls.map((x) => x.club));
      tiles.push(kpi({ label: 'Shots', value: String(balls.length), sub: plural(clubs.size, 'club') + (isAll ? ` · ${plural(sc.sessions.length, 'session')}` : '') }));
      const sp = solid.length / shots.length * 100;
      tiles.push(kpi({ label: 'Solid contact', value: C.roundHalfEven(sp, 0) + '%', meter: sp, sub: `${solid.length} of ${shots.length}${balls.length > shots.length ? ' full swings' : ''}`, delta: prev ? rateDelta(prev, sc.session, 'solid') : null }));
      const off = solid.filter((x) => C.isNum(x.offline_ft));
      if (off.length) {
        const on = off.filter((x) => Math.abs(x.offline_ft) <= C.GOALS.lineFt).length, lp = on / off.length * 100;
        tiles.push(kpi({ label: 'On line', value: C.roundHalfEven(lp, 0) + '%', meter: lp, sub: `${on} of ${off.length} within 10 yds`, delta: prev ? rateDelta(prev, sc.session, 'line') : null }));
      }
      const carried = solid.filter((x) => C.isNum(x.carry_yds) && !odd.has(x));
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

  // ----- Shot replay: each shot's flight drawn from its numbers, on a course -----
  // The pin sits where a pure strike with that club finishes. Pick the camera: from the
  // tee box (the golfer's view, the default), from the side (the whole arc), or above
  // the green (where it landed and how close it finished). Switching mid-shot cuts to
  // the new camera without restarting. "Play all" runs the shots in order and keeps
  // the earlier tracers of the same club, like a range session's pattern. "Best 10"
  // shows each club's best shots flying together (C.bestShots), a picture of his ideal
  // flight, with their average numbers.
  const FL = window.GolfFlight;
  const RP_NEXT = 1.2, RP_SPEEDS = [1, 2, 4];
  const RP_VIEWS = [['tee', 'Tee box'], ['side', 'Side'], ['green', 'Green']];
  const RP_VIEW_WORDS = { tee: 'from the tee box', side: 'from the side', green: 'above the green' };
  let rp = null;
  function rpItems(sessions) {
    const out = [];
    sessions.slice().sort(C.compareSessions).forEach((s) => {
      const mis = C.sessionMishits([s]), odd = C.sessionOutliers([s]), easy = C.sessionPractice([s]);
      C.sessionShots(s).forEach((x) => {
        if (x.club && C.isNum(x.carry_yds) && x.carry_yds > 0) out.push({ shot: x, session: s, kind: easy.has(x) ? easy.get(x) : mis.has(x) ? 'mis' : odd.has(x) ? 'out' : '' });
      });
    });
    return out;
  }
  function replayCard(items, scopeId) {
    if (!FL || !items.length) return '';
    // A different session (or all of them) starts again from its first shot.
    if (ui.rp.scope !== scopeId) Object.assign(ui.rp, { scope: scopeId, idx: 0 });
    const clubs = C.sortClubs(Array.from(new Set(items.map((i) => i.shot.club))));
    if (ui.rp.club !== 'All' && clubs.indexOf(ui.rp.club) < 0) { ui.rp.club = 'All'; ui.rp.idx = 0; }
    const chips = clubs.length > 1 ? `<div class="chips rp-clubs" role="group" aria-label="Club to replay">${['All'].concat(clubs).map((c) =>
      `<button class="chip" data-action="rp-club" data-club="${esc(c)}" aria-pressed="${c === ui.rp.club}">${c === 'All' ? 'All clubs' : esc(c)}</button>`).join('')}</div>` : '';
    return `<h2>Shot replay</h2>
      <div class="card replay" id="replay">
        <p class="note">Watch each shot fly on a course, drawn from the range screen’s numbers.</p>
        ${chips}
        <div class="seg rp-views" role="group" aria-label="Camera">${RP_VIEWS.map(([id, label]) =>
          `<button type="button" data-action="rp-view" data-view="${id}" aria-pressed="${id === ui.rp.view}">${label}</button>`).join('')}</div>
        <div class="rp-stage">
          <canvas class="rp-canvas" role="img" aria-label="Shot replay" data-action="rp-play"></canvas>
          <button type="button" class="rp-big" data-action="rp-play" aria-label="Play this shot">${icon('run')}</button>
        </div>
        <div class="rp-bar">
          <button type="button" class="rp-nav prev" data-action="rp-step" data-d="-1" aria-label="Previous shot">${icon('chevron')}</button>
          <div class="rp-what" aria-live="polite"></div>
          <button type="button" class="rp-nav" data-action="rp-step" data-d="1" aria-label="Next shot">${icon('chevron')}</button>
        </div>
        <div class="rp-ctrl">
          <button type="button" class="btn small rp-play" data-action="rp-play"></button>
          <button type="button" class="btn small ghost rp-all" data-action="rp-all" aria-pressed="false">Play all</button>
          <button type="button" class="btn small ghost rp-best" data-action="rp-best" aria-pressed="false">Best 10</button>
          <button type="button" class="btn small ghost rp-speed" data-action="rp-speed"></button>
        </div>
        <p class="rp-avg"></p>
        <div class="kpis four rp-nums"></div>
        <p class="rp-line"></p>
        <p class="hint rp-hint"></p>
      </div>`;
  }
  function rpStop() {
    if (!rp) return;
    if (rp.raf) cancelAnimationFrame(rp.raf);
    if (rp.io) rp.io.disconnect();
    rp = null;
  }
  function rpMount(items, entries) {
    rpStop();
    const card = $('#replay');
    if (!card || !FL) return;
    const canvas = $('.rp-canvas', card), ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) { card.hidden = true; return; }
    if (RP_VIEWS.every(([id]) => id !== ui.rp.view)) ui.rp.view = 'tee';
    rp = { card, canvas, ctx, items, entries, list: [], clubs: {}, bgs: new Map(), idx: 0, t: 0, playing: false, autoPaused: false, phase: 'idle', past: [], all: false, raf: 0, last: 0, shotGreen: null };
    rpSize();
    rpFilter();
    rpShow(ui.rp.idx, false);
    if ('IntersectionObserver' in window) {
      rp.io = new IntersectionObserver((en) => en.forEach((e) => {
        if (!rp) return;
        if (!e.isIntersecting && rp.playing) rpPause(true);
        else if (e.isIntersecting && rp.autoPaused) rpResume();
      }), { threshold: 0.3 });
      rp.io.observe(canvas);
    }
  }
  function rpSize() {
    const w = Math.max(240, Math.floor(rp.canvas.parentElement.getBoundingClientRect().width));
    const h = Math.round(Math.min(460, Math.max(200, w * 0.62)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    rp.canvas.width = Math.round(w * dpr);
    rp.canvas.height = Math.round(h * dpr);
    rp.canvas.style.height = h + 'px';
    rp.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Object.assign(rp, { w, h, dpr, clubs: {}, bgs: new Map() });
  }
  // The shots to step through: every shot (with the chosen club), or with Best 10 each
  // club's best shots, best first, each marked with its place.
  function rpFilter() {
    if (!ui.rp.best) { rp.list = ui.rp.club === 'All' ? rp.items : rp.items.filter((i) => i.shot.club === ui.rp.club); return; }
    const clubs = ui.rp.club === 'All' ? C.sortClubs(Array.from(new Set(rp.items.map((i) => i.shot.club)))) : [ui.rp.club];
    rp.list = [];
    clubs.forEach((c) => {
      const best = C.bestShots(rp.entries[c], c, data.equipment, 10);
      best.forEach((shot, k) => {
        const it = rp.items.find((x) => x.shot === shot);
        if (it) rp.list.push(Object.assign(it, { rank: k + 1, of: best.length }));
      });
    });
  }
  // With Best 10, the club's other best shots stay on screen as faint tracers.
  function rpBestPast() { return rp.list.filter((i) => i !== rp.item && i.shot.club === rp.item.shot.club).map(rpTraj).filter(Boolean); }
  function rpTraj(item) {
    if (item.traj === undefined) {
      const club = item.shot.club, win = C.launchWindow(club, data.equipment);
      item.traj = FL.trajectory(item.shot, { kind: C.clubKind(club), club, launch: win ? (win[0] + win[1]) / 2 : null });
    }
    return item.traj;
  }
  // The green and the ground around it, for framing the view above the green.
  function rpGreenPts(pin) { return [{ x: -20, y: 0, z: pin - 22 }, { x: 20, y: 0, z: pin - 22 }, { x: -20, y: 0, z: pin + 22 }, { x: 20, y: 0, z: pin + 22 }]; }
  // The course and a camera for each view, once per club, framed to fit every shot with
  // that club (with Best 10, just its best shots, so they show bigger) so the view holds
  // still from shot to shot. Above the green, it frames the shots that finished near the
  // green; a shot that finished farther away gets its own.
  function rpClub(club) {
    const key = club + (ui.rp.best ? ' best' : '');
    if (rp.clubs[key]) return rp.clubs[key];
    const pin = C.pinFor(rp.entries[club], club, data.equipment), trs = [];
    (ui.rp.best ? rp.list : rp.items).forEach((i) => { if (i.shot.club === club) { const t = rpTraj(i); if (t) trs.push(t); } });
    const pts = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: pin + 15 }, { x: -13, y: 0, z: pin }, { x: 13, y: 0, z: pin }, { x: 0, y: 2.4, z: pin }];
    trs.forEach((t) => FL.keyPoints(t).forEach((p) => pts.push(p)));
    const near = rpGreenPts(pin);
    trs.forEach((t) => { [t.land, t.rest].forEach((p) => { if (Math.hypot(p.x, p.z - pin) <= 40) near.push(p); }); });
    let seed = pin * 131;
    for (let k = 0; k < club.length; k++) seed = (seed * 31 + club.charCodeAt(k)) >>> 0;
    const course = FL.course(pin, Math.max(...pts.map((p) => p.z)), seed);
    return (rp.clubs[key] = { club, pin, course, tee: FL.fitTee(pts, rp.w, rp.h), side: FL.fitSide(pts, rp.w, rp.h), green: FL.fitGreen(near, rp.w, rp.h) });
  }
  // The camera for the chosen view and this shot.
  function rpCam() {
    const v = ui.rp.view, c = rp.c, tr = rp.cur;
    if (v !== 'green') return c[v];
    if ([tr.land, tr.rest].every((p) => FL.inside(c.green, p, 0.06))) return c.green;
    if (!rp.shotGreen) rp.shotGreen = FL.fitGreen(rpGreenPts(c.pin).concat([tr.land, tr.rest]), rp.w, rp.h);
    return rp.shotGreen;
  }
  // The course drawn once for each camera, so a frame only adds the ball and tracers.
  function rpBg(cam) {
    let bg = rp.bgs.get(cam);
    if (!bg) {
      bg = document.createElement('canvas');
      bg.width = rp.canvas.width;
      bg.height = rp.canvas.height;
      const b = bg.getContext('2d');
      b.setTransform(rp.dpr, 0, 0, rp.dpr, 0, 0);
      FL.drawCourse(b, cam, rp.c.course);
      rp.bgs.set(cam, bg);
    }
    return bg;
  }
  function rpShow(i, play) {
    if (!rp || !rp.list.length) return;
    if (rp.raf) { cancelAnimationFrame(rp.raf); rp.raf = 0; }
    rp.idx = ui.rp.idx = Math.max(0, Math.min(rp.list.length - 1, i));
    rp.item = rp.list[rp.idx];
    rp.cur = rpTraj(rp.item);
    // Keep only this club's drawn backgrounds (each is a full-size picture), and drop
    // the last shot's own view of the green.
    if (rp.c && rp.c.club !== rp.item.shot.club) rp.bgs.clear();
    if (rp.shotGreen) rp.bgs.delete(rp.shotGreen);
    rp.c = rpClub(rp.item.shot.club);
    Object.assign(rp, { shotGreen: null, t: 0, phase: 'idle', playing: false, autoPaused: false });
    // Best 10 opens on the finished picture: all the best flights, this one highlighted.
    if (ui.rp.best) Object.assign(rp, { past: rpBestPast(), t: play ? 0 : rp.cur.duration, phase: play ? 'idle' : 'done' });
    rpInfo();
    if (play) rpPlay();
    else { rpDraw(); rpControls(); }
  }
  function rpDraw() {
    if (!rp || !rp.cur) return;
    const cam = rpCam();
    rp.ctx.clearRect(0, 0, rp.w, rp.h);
    FL.drawFrame(rp.ctx, { cam, view: ui.rp.view, course: rp.c.course, bg: rpBg(cam), past: rp.past, cur: rp.cur, t: rp.t, hud: rp.phase !== 'idle' });
  }
  function rpPlay() {
    if (!rp || !rp.cur) return;
    if (rp.phase === 'idle' || rp.phase === 'done') Object.assign(rp, { t: 0, phase: 'flight' });
    if (REDUCED) { rpEnd(); return; }
    Object.assign(rp, { playing: true, autoPaused: false, last: 0 });
    rpControls();
    rp.raf = requestAnimationFrame(rpTick);
  }
  function rpTick(ts) {
    if (!rp || !rp.playing) return;
    rp.raf = 0;
    const dt = rp.last ? Math.min(0.05, (ts - rp.last) / 1000) : 0;
    rp.last = ts;
    rp.t += dt * ui.rp.speed;
    const T = rp.cur.duration;
    if (rp.t < T) rp.phase = 'flight';
    else if (!rp.all) { Object.assign(rp, { t: T, phase: 'done', playing: false }); rpDraw(); rpControls(); return; }
    else {
      rp.phase = 'hold';
      if (rp.t >= T + RP_NEXT) { rpAdvance(); return; }
    }
    rpDraw();
    rp.raf = requestAnimationFrame(rpTick);
  }
  // Straight to the end: for phones that ask for less motion.
  function rpEnd() {
    Object.assign(rp, { playing: false, t: rp.cur.duration, phase: 'done' });
    rpDraw();
    rpControls();
  }
  // Play all: on to the next shot, keeping this tracer when the club stays the same.
  function rpAdvance() {
    if (rp.idx >= rp.list.length - 1) {
      Object.assign(rp, { all: false, playing: false, phase: 'done' });
      rpDraw();
      rpControls();
      return;
    }
    const next = rp.list[rp.idx + 1];
    if (next.shot.club === rp.item.shot.club) { rp.past.push(rp.cur); if (rp.past.length > 40) rp.past.shift(); } else rp.past = [];
    rpShow(rp.idx + 1, true);
  }
  // With reduced motion, Play all draws every shot with the club at once.
  function rpAllAtOnce() {
    const same = rp.list.filter((i) => i.shot.club === rp.item.shot.club);
    const past = same.slice(0, -1).map(rpTraj).filter(Boolean);
    rp.all = false;
    rpShow(rp.list.indexOf(same[same.length - 1]), false);
    Object.assign(rp, { past, t: rp.cur.duration, phase: 'done' });
    rpDraw();
    rpControls();
  }
  function rpPause(auto) {
    if (!rp || !rp.playing) return;
    if (rp.raf) cancelAnimationFrame(rp.raf);
    Object.assign(rp, { raf: 0, playing: false, autoPaused: !!auto });
    rpControls();
  }
  function rpResume() {
    if (!rp || rp.playing) return;
    Object.assign(rp, { playing: true, autoPaused: false, last: 0 });
    rpControls();
    rp.raf = requestAnimationFrame(rpTick);
  }
  function rpToggle() {
    if (!rp) return;
    if (rp.playing) rpPause(false);
    else if (rp.phase === 'idle' || rp.phase === 'done') rpPlay();
    else rpResume();
  }
  function rpControls() {
    if (!rp) return;
    const started = rp.phase !== 'idle' && rp.phase !== 'done';
    const label = rp.playing ? 'Pause' : started ? 'Resume' : rp.phase === 'done' ? 'Replay' : 'Play';
    const pb = $('.rp-play', rp.card);
    pb.innerHTML = `${icon(rp.playing ? 'pause' : rp.phase === 'done' ? 'replay' : 'run')}<span>${label}</span>`;
    const big = $('.rp-big', rp.card);
    big.hidden = rp.playing || rp.phase === 'done';
    big.setAttribute('aria-label', started ? 'Resume the shot' : 'Play this shot');
    $('.rp-all', rp.card).setAttribute('aria-pressed', String(rp.all));
    $('.rp-best', rp.card).setAttribute('aria-pressed', String(!!ui.rp.best));
    const sp = $('.rp-speed', rp.card);
    sp.textContent = ui.rp.speed + '× speed';
    const nav = $$('.rp-nav', rp.card);
    nav[0].disabled = rp.idx <= 0;
    nav[1].disabled = rp.idx >= rp.list.length - 1;
  }
  function ftDir(ft, what) {
    if (!C.isNum(ft)) return '';
    const r = Math.round(Math.abs(ft));
    return r ? `${what} ${r} ft ${ft < 0 ? 'left' : 'right'}` : '';
  }
  // The shot's numbers under the picture, and what the picture says for screen readers.
  function rpInfo() {
    const it = rp.item, s = it.shot, tr = rp.cur, pin = rp.c.pin, name = C.clubName(s.club, data.clubs);
    const many = new Set(rp.items.map((i) => i.session.id)).size > 1;
    const tag = { mis: 'Likely mis-hit', out: 'Outlier', 'warm-up': 'Warm-up swing', partial: 'Half swing or drill ball' }[it.kind] || '';
    const best = ui.rp.best && it.rank;
    $('.rp-what', rp.card).innerHTML = `<span class="t">${esc(name)} · ${best ? `best ${it.rank} of ${it.of}` : `shot ${rp.idx + 1} of ${rp.list.length}`}</span>
      <span class="s">${esc([many ? C.fmtDate(it.session.date, { short: true }) : '', s.time, tag].filter(Boolean).join(' · '))}</span>`;
    const dz = tr.rest.z - pin, dx = tr.rest.x, d = Math.hypot(dx, dz);
    const onGreen = (dx / 11) * (dx / 11) + (dz / 13) * (dz / 13) <= 1;
    const away = [Math.abs(dz) >= 1 ? `${Math.round(Math.abs(dz))} ${dz < 0 ? 'short' : 'long'}` : '', Math.abs(dx) >= 1 ? `${Math.round(Math.abs(dx))} ${dx < 0 ? 'left' : 'right'}` : ''].filter(Boolean).join(' · ');
    const rolled = C.isNum(s.total_yds) ? (tr.roll >= 0.5 ? `rolled ${Math.round(tr.roll)} yds` : tr.roll <= -0.5 ? `spun back ${Math.round(-tr.roll)} yds` : 'stopped where it landed') : 'total not on the screen';
    $('.rp-nums', rp.card).innerHTML = [
      kpi({ label: 'Carry', value: C.fmtRaw(s.carry_yds), unit: 'yds', sub: C.isNum(s.ball_speed_mph) ? `${C.fmtRaw(s.ball_speed_mph)} mph ball speed` : '' }),
      kpi({ label: 'Total', value: C.isNum(s.total_yds) ? C.fmtRaw(s.total_yds) : '—', unit: C.isNum(s.total_yds) ? 'yds' : '', sub: rolled }),
      kpi({ label: 'To the pin', value: String(Math.round(d)), unit: Math.round(d) === 1 ? 'yd' : 'yds', sub: d < 1 ? 'next to the pin' : onGreen ? `on the green · ${away}` : away }),
      kpi({ label: 'Peak height', value: C.isNum(s.apex_ft) ? C.fmtRaw(s.apex_ft) : '—', unit: C.isNum(s.apex_ft) ? 'ft' : '', sub: [C.isNum(s.launch_deg) ? `launch ${C.fmtRaw(s.launch_deg)}°` : '', C.isNum(s.landing_deg) ? `lands ${C.fmtRaw(s.landing_deg)}°` : ''].filter(Boolean).join(' · ') })
    ].join('');
    const bend = ftDir(s.curve_ft, 'curved'), side = ftDir(s.offline_ft, 'finished');
    $('.rp-line', rp.card).textContent = bend && side ? `${cap(bend)} in the air and ${side} of the target line.`
      : bend ? `${cap(bend)} in the air.` : side ? `${cap(side)} of the target line.`
        : C.isNum(s.curve_ft) || C.isNum(s.offline_ft) ? 'Straight down the target line.' : '';
    $('.rp-avg', rp.card).textContent = best ? rpBestAverage(s.club, name, it.of) : '';
    const words = { launch: 'launch angle', apex: 'peak height', landing: 'landing angle', hang: 'time in the air', total: 'roll', curve: 'curve', offline: 'direction' };
    const est = tr.estimated.filter((k) => words[k]).map((k) => words[k]);
    const ref = best ? C.strikeReference(rp.entries[s.club], s.club, data.equipment) : null;
    $('.rp-hint', rp.card).textContent = (best ? `Best ${it.of}: the solid shots that came closest to an ideal one, ranked by the yards each landed short of a pure strike${ref ? ` (${ref.carry} yds)` : ''} plus the yards it finished off line. ` : '') +
      `The pin is where a pure strike with your ${name.toLowerCase()} finishes: ${pin} yds, carry plus roll. ` +
      (est.length ? `Not on the screen, so estimated: ${est.join(', ')}.` : 'Everything is drawn from the screen’s numbers.');
    rpLabel();
  }
  // "Your best 10 with the 5 hybrid average 133 yds carry, 140 total, 65 ft high, landing at 40°."
  function rpBestAverage(club, name, n) {
    const shots = rp.list.filter((i) => i.shot.club === club).map((i) => i.shot);
    const avg = (k) => { const st = C.summarize(shots, k); return st.n ? Math.round(st.avg) : null; };
    const carry = avg('carry_yds'), total = avg('total_yds'), apex = avg('apex_ft'), land = avg('landing_deg');
    const parts = [carry != null ? `${carry} yds carry` : '', total != null ? `${total} total` : '', apex != null ? `${apex} ft high` : '', land != null ? `landing at ${land}°` : ''].filter(Boolean);
    if (!parts.length) return '';
    return n === 1 ? `Your best shot with the ${name.toLowerCase()}: ${parts.join(', ')}.` : `Your best ${n} with the ${name.toLowerCase()} average ${parts.join(', ')}.`;
  }
  // What the picture shows, for screen readers.
  function rpLabel() {
    const it = rp.item, s = it.shot, tr = rp.cur, pin = rp.c.pin, d = Math.hypot(tr.rest.x, tr.rest.z - pin);
    const which = ui.rp.best && it.rank ? `best shot ${it.rank} of ${it.of}, shown with the others` : `shot ${rp.idx + 1} of ${rp.list.length}`;
    rp.canvas.setAttribute('aria-label', `Replay ${RP_VIEW_WORDS[ui.rp.view]} of ${which}, ${C.clubName(s.club, data.clubs)}: ${C.fmtRaw(s.carry_yds)} yards carry, finished ${Math.round(d)} yards from the pin.`);
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
    const hasMis = clubs.some((c) => entries[c].mis.length), hasOut = clubs.some((c) => entries[c].outliers.length);
    const flagsBy = {};
    clubs.forEach((c) => { flagsBy[c] = C.needsWork(entries[c]); });
    if (!ui.statClub || clubs.indexOf(ui.statClub) < 0) ui.statClub = clubs[0];
    const dirFlagged = new Set(clubs.filter((c) => flagsBy[c].some((f) => f.kind === 'direction')));
    const work = hl.find((h) => h.id === 'work');
    const replayItems = rpItems(sc.sessions);
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
            ${kpi({ label: 'Shots', value: String(e.shots.length), sub: [e.mis.length ? `${C.solidCount(e)} solid · ${plural(e.mis.length, 'mis-hit')}` : '', e.outliers.length ? plural(e.outliers.length, 'outlier') : ''].filter(Boolean).join(' · ') || C.clubName(single, data.clubs) })}
            ${kpi({ label: 'Average carry', value: car.n ? C.fmtNum(car.avg, 1) : '—', unit: car.n ? 'yds' : '', sub: car.n ? `${C.fmtRange(car.min, car.max)} yds` : 'all mis-hits' })}
            ${kpi({ label: 'Average miss', value: miss.value, unit: miss.unit, sub: C.isNum(off.avg) ? `${dirU(off.avg, 'ft', 1)} on the screen` : '' })}
            ${kpi({ label: 'Left to right spread', value: C.isNum(spread) ? C.fmtNum(spread / 3, 1) : '—', unit: C.isNum(spread) ? 'yds' : '', sub: C.isNum(spread) ? `${C.fmtRange(off.min, off.max, true)} ft` : '' })}
          </div><div class="chart" id="dispChart"></div>`;
      } else {
        inner = '<div class="facets" id="facets"></div>';
      }
      const shotsForTable = single ? entries[single].shots : [].concat(...clubs.map((c) => entries[c].shots));
      const misSet = new Set([].concat(...clubs.map((c) => entries[c].mis))), outSet = new Set([].concat(...clubs.map((c) => entries[c].outliers)));
      disp = `<h2>Dispersion</h2><div class="card">
        ${dispClubs.length > 1 ? `<div class="chips" role="group" aria-label="Club">${['All'].concat(dispClubs).map((c) => `<button class="chip" data-action="disp-club" data-club="${esc(c)}" aria-pressed="${c === (single || 'All')}">${c === 'All' ? 'All clubs' : esc(c)}</button>`).join('')}</div>` : ''}
        ${inner}
        <p class="hint">${single ? '' : 'Each panel is one club, all drawn to the same scale. '}Up is carry in yards; across is yards left or right of the target line. The cross is the average of solid shots${hasOut ? ', leaving out outliers' : ''}. The grey band is a 30-yard-wide fairway.${hasMis ? ' Hollow dots are likely mis-hits.' : ''}${hasOut ? ' Ringed dots are outliers: solid, but far off the usual carry.' : ''}</p>
        <details class="more"><summary>Show as a table</summary>${shotTable(shotsForTable, misSet, outSet)}</details>
      </div>`;
    }

    el.innerHTML = `
      <div class="filters"><label for="scope">Session</label><select id="scope" data-change="scope">${scopeOptions(sc.id)}</select></div>
      ${sc.id === 'all' && data.sessions.some((s) => C.isSummaryOnly(s)) ? '<p class="note" style="margin-bottom:14px">“All sessions” pools sessions with individual shots. Sessions with ranges only are left out; pick one in the menu to see its ranges.</p>' : ''}
      ${sessionSummary(sc, hl, work)}
      ${replayCard(replayItems, sc.id)}
      ${clubs.length ? `<h2 id="clubSection">Club by club</h2>
      <div class="card">
        <div class="chips" role="group" aria-label="Club">${clubChips}</div>
        ${clubs.some((c) => flagsBy[c].length) ? '<p class="nw-key"><span class="nw-dot" aria-hidden="true"></span> marks a club that needs work</p>' : ''}
        ${clubCard(entries, ui.statClub, sc.id === 'all')}
        <details class="more"><summary>Compare all clubs in one table</summary>${matrixTable(entries, clubs)}</details>
      </div>` : ''}
      <h2>Carry gapping</h2>
      <div class="card"><div class="chart" id="gapChart"></div>
        <p class="hint">Carry in yards. Bar: shortest to longest solid shot. Black line and number: average of solid shots. Dots: every shot${hasMis && hasOut ? ' (hollow = likely mis-hit; ringed = outlier, solid but far off the usual carry; both are left out of the numbers)'
          : hasMis ? ' (hollow = likely mis-hit, left out of the numbers)'
            : hasOut ? ' (ringed = outlier, solid but far off the usual carry, left out of the numbers)' : ''}. “Gap” is the change from the next-shorter club.</p></div>
      ${disp}
      ${missRows.length >= 2 ? `<h2>Average miss by club</h2><div class="card"><div class="chart" id="missChart"></div><p class="hint">Average offline of solid shots${hasOut ? ' (outliers left out)' : ''}, in yards. Bars to the right are misses right of the target line.${missRows.some((r) => dirFlagged.has(r.club)) ? ` Clubs marked “needs work” average ${C.NEEDS_WORK.missYds} yds or more off line.` : ''}</p></div>` : ''}
      ${sc.session ? `<h2>Coaching notes</h2><div class="card">${notes.length ? `<ul class="plain">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="empty">No coaching notes for this session.</p>'}
        <div class="row-actions"><button class="btn small ghost" data-action="goto-notes" data-id="${esc(sc.session.id)}">${notes.length ? 'Edit notes' : 'Add notes'}</button></div></div>` : ''}
    `;
    rpMount(replayItems, entries);
    drawGap($('#gapChart'), entries, clubs);
    if ($('#dispChart')) drawDispersion($('#dispChart'), entries[single], single);
    if ($('#facets')) drawFacets($('#facets'), entries, dispClubs);
    if ($('#missChart')) drawMiss($('#missChart'), missRows, dirFlagged);
  }
  function shotTable(shots, misSet, outSet) {
    const rows = C.sortClubs(Array.from(new Set(shots.map((s) => s.club)))).map((c) => shots.filter((s) => s.club === c))
      .reduce((a, b) => a.concat(b), [])
      .filter((s) => C.isNum(s.carry_yds) || C.isNum(s.offline_ft))
      .map((s) => `<tr><td>${esc(s.club)}</td><td>${esc(s.time || '')}</td><td>${C.fmtRaw(s.carry_yds)}</td><td>${esc(C.fmtRawDir(s.offline_ft))}</td><td>${esc(C.fmtRawDir(s.curve_ft))}</td><td>${misSet.has(s) ? 'mis-hit' : outSet && outSet.has(s) ? 'outlier' : ''}</td></tr>`);
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
  // Solid contact as the trend wants it: the share, and the counts behind it.
  function solidStat(e) { return { avg: C.solidPct(e), n: C.solidCount(e), of: e.shots.length }; }
  // Up arrows for better, down arrows for worse; more arrows for a bigger change. A
  // change within the luck of his shots is "about the same".
  function trendBadge(t) {
    if (!t) return '';
    const full = t.basis === 'best' ? 'Can’t tell' : t.dir === 'same' ? 'About the same' : TREND_WORDS[t.dir][t.level];
    const note = [t.basis === 'best' ? 'the baseline kept only ranges' : '', t.few ? 'only a few shots' : ''].filter(Boolean).join(', ');
    const word = t.basis === 'best' ? 'Can’t tell' : t.dir === 'same' ? 'Same' : t.dir === 'better' ? 'Better' : 'Worse';
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
      const v = (pc, e) => (pc == null ? { value: '—', sub: 'ranges only' } : { value: C.roundHalfEven(pc, 0) + '%', meter: pc, sub: `${C.solidCount(e)} of ${e.shots.length}` });
      const t = pa != null && pl != null ? C.trend('solid_pct', solidStat(b.entry), solidStat(l.entry)) : null;
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
      ${P.baseline && P.latest && typeof P.baseline.session.equipment === 'string' && P.baseline.session.equipment && P.baseline.session.equipment !== P.latest.session.equipment
        ? `<p class="note" style="margin-bottom:14px">The ${esc(C.fmtDate(P.baseline.session.date))} baseline was hit with ${esc(P.baseline.session.equipment)}, so some of the change since then is the clubs, not just the swing.</p>` : ''}
      <div class="card"><h3 class="card-title">${esc(club)}: ${esc(m.label.toLowerCase())}${m.key === C.SOLID_METRIC.key ? ' %' : ''} by session</h3>${progKpis(P, m)}<div class="chart" id="progChart"></div>
        <p class="hint">${m.key === C.SOLID_METRIC.key ? `Share of shots that weren’t likely mis-hits${P.rows.some((r) => r.entry.outliers.length) ? ' (outliers count as solid)' : ''}.` : `Bar: lowest to highest. Dot and number: average. Solid shots only${P.rows.some((r) => r.entry.outliers.length) ? ', leaving out outliers' : ''}.`}${m.dir ? ' Feet; L = left, R = right.' : ''}${rangeOnly.length ? ` ${esc(rangeOnly.join(', '))} recorded ranges only, so ${rangeOnly.length > 1 ? 'their' : 'its'} numbers include any mis-hits and ${rangeOnly.length > 1 ? 'their' : 'its'} solid-contact rate is unknown.` : ''}</p></div>
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
    const pctCell = (p, e) => p == null ? '<span class="v">—</span><span class="n">unknown (ranges only)</span>' : `<span class="v">${C.roundHalfEven(p, 0)}%</span><span class="r">${C.solidCount(e)} of ${e.shots.length}</span>`;
    const solidT = pa != null && pl != null ? C.trend('solid_pct', solidStat(b.entry), solidStat(l.entry)) : null;
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
          if (t && t.basis === 'line') change = `${m.key === 'curve_ft' ? 'average bend' : 'average distance off line'} ${C.fmtNum(t.from, 1)} → ${C.fmtNum(t.to, 1)} ft`;
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
        Up arrows mean better since the baseline and down arrows worse: one arrow is a small change, three a big one. An arrow shows only when the change is bigger than the spread of his shots could make by luck, so a few more shots one way don’t count as better or worse. Launch is better when it moves toward the club’s target window; curve and offline when shots finish closer to the line on average. When the baseline kept only ranges, the longest shots are set side by side with no arrow, since a longer list of shots has a longer longest. Peak height, landing and hang time get no arrow, since higher isn’t always better.</p>
      <p class="hint">Each cell shows the average (when individual shots exist), then lowest–highest, from solid shots. Changes are latest minus baseline.</p>`;
  }

  // ----- Practice (the "tips" tab): numbers to aim for at the range, a live shot check, then tips -----
  // Each club: its most recent session with shots (what to work on now), and its last 3
  // (PRACTICE_POOL) pooled for its yardages, so they move as he improves but one bad day
  // doesn't move them. Mis-hits and outliers are judged within each session.
  const PRACTICE_POOL = 3;
  function practiceClubs() {
    const out = {}, recent = {};
    data.sessions.slice().sort(C.compareSessions).reverse().forEach((s) => {
      if (!C.sessionShots(s).length) return;
      const e = C.clubData([s]);
      Object.keys(e).forEach((c) => {
        if (!e[c].shots.length) return;
        if (!out[c]) out[c] = { entry: e[c], session: s };
        const r = recent[c] || (recent[c] = []);
        if (r.length < PRACTICE_POOL) r.push(s);
      });
    });
    Object.keys(out).forEach((c) => {
      const pooled = C.clubData(recent[c])[c], carries = pooled.solid.map((x) => x.carry_yds).filter(C.isNum);
      Object.assign(out[c], { pooled, sessions: recent[c], typical: carries.length ? C.roundHalfEven(C.median(carries), 0) : null });
    });
    return out;
  }
  // "your last 3 sessions" or "your Nov 12, 2026 session"
  function poolWords(sel) { return sel.sessions.length > 1 ? `your last ${sel.sessions.length} sessions` : `your ${C.fmtDate(sel.session.date)} session`; }
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
    ck.result = C.checkShot(sel.pooled, c, { carry_yds: ck.carry, ball_speed_mph: ck.ball, launch_deg: ck.launch, offline_ft: off }, data.equipment);
    renderTips();
    const r = $('#checkResult'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function checkResultHtml(r) {
    const good = r.verdict === 'pure' || r.verdict === 'good';
    return `<div class="check-result ${esc(r.verdict)}" role="status" id="checkResult"><span class="cr-ico">${icon(good ? 'check' : 'alert')}</span><div class="cr-body"><p class="check-title">${esc(r.title)}</p>
      <ul class="check-lines">${r.lines.map((l) => `<li><span class="ck ${l.ok === true ? 'ok' : l.ok === false ? 'bad' : ''}" aria-hidden="true">${l.ok === true ? '✓' : l.ok === false ? '✗' : '~'}</span><span>${esc(l.text)}</span></li>`).join('')}</ul></div></div>`;
  }
  function practiceCard(c, sel, t) {
    const e = sel.entry, G = C.clubGoals(e, c, data.equipment, { typical: sel.typical }), r = C.strikeReference(sel.pooled, c, data.equipment), m = r ? r.metrics : {};
    const zone = G.goals.find((g) => g.id === 'carry');
    const win = C.launchWindow(c, data.equipment);
    const flags = C.needsWork(e);
    const aim = [];
    if (zone) aim.push(['flag', 'Distance', 'The same distance every time', `${zone.lo}–${zone.hi} yds`, `your typical ${zone.typical} yds${r ? ` · pure strike about ${r.carry}` : ''}`]);
    if (m.ball_speed_mph) aim.push(['bolt', 'Ball speed', 'Shows a centred strike', `${C.fmtRaw(m.ball_speed_mph.min)}+ mph`, `your pure strikes: ${C.fmtRange(m.ball_speed_mph.min, m.ball_speed_mph.max)} mph`]);
    if (win) aim.push(['launch', 'Launch', 'How steeply it starts', `${win[0]}–${win[1]}°`, m.launch_deg ? `your pure strikes: about ${C.fmtNum(m.launch_deg.avg, 0)}°` : '']);
    aim.push(['line', 'On line', 'Left or right of target', 'within 10 yds', '30 ft or less on the screen']);
    const look = [];
    if (m.apex_ft) look.push(`peak height about ${C.fmtNum(m.apex_ft.avg, 0)} ft`);
    if (m.landing_deg) look.push(`landing about ${C.fmtNum(m.landing_deg.avg, 0)}°`);
    if (m.total_yds) look.push(`total about ${C.fmtNum(m.total_yds.avg, 0)} yds`);
    const drillKey = focusDrillKey(G.focus, c), drill = drillKey ? drillFor(drillKey) : null;
    const ck = ui.check || {};
    const val = (v) => (v == null ? '' : esc(String(v)));
    return `
      ${clubHead(c)}
      <p class="cc-shots">How it went in your ${esc(C.fmtDate(sel.session.date))} session; the numbers to aim for come from ${esc(poolWords(sel))}${r ? ` (${plural(r.n, 'best-struck shot')} of ${plural(sel.pooled.shots.length, 'shot')})` : ''}.</p>
      ${flags.length ? `<div class="work-box">${NW_PILL}<ul>${flags.map((f) => `<li>${esc(cap(f.text))}.</li>`).join('')}</ul></div>` : ''}
      <h4 class="cc-sub">Aim for</h4>
      <ul class="aim-list targets">${aim.map((a) => `<li><span class="aim-ico">${icon(a[0])}</span><span class="aim-k">${esc(a[1])}</span><span class="aim-v">${esc(a[3])}</span>
        <span class="aim-s">${esc(a[2])}${a[4] ? `<span class="aim-n">${esc(cap(a[4]))}</span>` : ''}</span></li>`).join('')}</ul>
      ${look.length ? `<p class="pure-look">Your pure strikes also show ${esc(look.join(', '))}.</p>` : ''}
      <div class="focus-line" style="margin-top:14px"><span class="fl-label">Focus</span><span class="fl-text">${esc(G.focus.text)}</span></div>
      ${drill ? `<details class="focus-drill"><summary>Drill: ${esc(fillText(drill.name))}</summary>
        ${artHtml(drill.art, drillKey, fillText(drill.name))}
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
        <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async">
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
    clubs.forEach((c) => { refs[c] = C.strikeReference(pc[c].pooled, c, data.equipment); });
    const longest = Math.max(1, ...clubs.map((c) => Math.max(refs[c] ? refs[c].carry : 0, pc[c].typical || 0)));
    const rows = clubs.map((c) => {
      const e = pc[c].entry, r = refs[c], ty = pc[c].typical, nw = C.needsWork(e).length;
      const sub = [r ? `pure strike\u00a0${r.carry}` : '', r && r.metrics.ball_speed_mph ? `${C.fmtRaw(r.metrics.ball_speed_mph.min)}+\u00a0mph ball\u00a0speed` : '',
        r && r.solid < 4 ? `only ${plural(r.solid, 'solid shot')} so far` : ''].filter(Boolean).join(' · ');
      const big = C.isNum(ty) ? ty : r ? r.carry : null;
      return `<li><button class="yard-row" data-action="practice-club" data-club="${esc(c)}" aria-pressed="${c === ui.practiceClub}">
        ${clubBadge(c, true)}
        <span class="yr-main"><span class="yr-top"><span class="yr-carry">${big != null ? `${big} <span class="yr-u">yds</span>` : '—'}</span>${nw ? NW_PILL : ''}</span>
          ${big != null ? `<span class="yr-bar" aria-hidden="true"><span style="width:${f1(big / longest * 100)}%"></span>${r && r.carry > big ? `<span class="yr-pure" style="left:${f1(big / longest * 100)}%;width:${f1((r.carry - big) / longest * 100)}%"></span>` : ''}</span>` : ''}
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
          <p class="note">How far each club usually carries: the middle of your solid shots, the number to play on the course. The lighter bar is how far a pure strike goes. Tap a club for its numbers.</p>
          <ul class="yard-list">${rows}</ul>
          <p class="hint">A pure strike is one of your best-struck shots: the top quarter by ball speed, launched at a normal height. Each club uses its last ${PRACTICE_POOL} sessions, so these grow as you improve, and one bad day doesn’t move them.</p></div>
        <div class="card" id="practiceCard">${practiceCard(ui.practiceClub, pc[ui.practiceClub], t)}</div>
        ${clubsCard(clubs)}`
      : `<div class="card"><h3 class="card-title">Numbers to aim for</h3><p>After ${esc(playerName())}’s first range session, each club’s pure-strike distance and the numbers to aim for show up here, with a quick way to check a shot.</p></div>`}`;
    const drillsView = t ? `${t.focus.map((f, i) => focusCard(f, i, true)).join('')}
        <div class="card lesson"><div class="card-head"><span class="head-ico">${icon('coach')}</span><h3 class="card-title">Check it with a coach</h3></div><p style="margin-top:6px">${esc(fillText(t.lesson))}</p></div>`
      : `<div class="card"><p class="empty">No drills for ${esc(playerName())} yet. Once his first range sessions are in, ask Claude for a plan built from them.</p></div>`;
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
    const fw = Number(f.w) || 1, fh = Number(f.h) || 1, ratio = Math.round(fw / fh * 1000) / 1000;
    const media = f.svg || `<img src="${esc(f.src)}" alt="" width="${fw}" height="${fh}" decoding="async">`;
    const pins = mk.pins.map((p) => `<span class="rv-pin ${p.kind}${p.n == null ? ' lab' : ''}" style="left:${f1(p.x)}%;top:${f1(p.y)}%">${p.n != null ? `<b>${esc(String(p.n))}</b>` : ''}${p.label ? `<span>${esc(p.label)}</span>` : ''}</span>`).join('');
    const notes = (f.notes || []).map((n) => {
      const kind = SR && SR.KINDS[n.kind] ? n.kind : 'ref';
      return `<li class="${kind}"><span class="rv-num${n.n == null ? ' dot' : ''}" aria-hidden="true">${n.n != null ? esc(String(n.n)) : ''}</span><span><strong>${esc(SR ? SR.KINDS[kind] : '')}${n.n != null ? ' ' + esc(String(n.n)) : ''}:</strong> ${esc(n.text)}</span></li>`;
    }).join('');
    return `<div class="rv-stage"><div class="rv-media${ui.rvMarks ? '' : ' clean'}" data-swipe="${esc(r.id)}" style="aspect-ratio:${fw} / ${fh};max-width:calc(min(64vh, 560px) * ${ratio})" role="img" aria-label="${esc(f.label || 'Frame ' + (i + 1))}${(f.notes || []).length ? ': ' + esc(f.notes.map((n) => n.text).join(' ')) : ''}">${media}${mk.svg}${pins}</div></div>
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
        return `<li><span class="rv-fixn" aria-hidden="true">${k + 1}</span><span class="rv-fixt">${esc(x.text)}${d ? `<button class="btn small ghost" data-action="goto-tip" data-goto="${esc(x.drill.split(':')[0])}" data-drill="${esc(x.drill)}">Drill: ${esc(fillText(d.name))} ${icon('chevron')}</button>` : ''}</span></li>`;
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
          <li>Use slow motion if your phone has it, in good light. Film 3 to 5 swings with one club, then ${sendTo('video')} with the date and the club.</li>
        </ul>
      </div></details>`;
  }
  // Notes on his swing kept in the data file (swing_notes: { date, source, note }), newest first.
  function swingNotesHtml() {
    const list = (data.swingNotes || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (!list.length) return '';
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const when = (d) => { const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(d || ''); return !m ? '' : m[3] ? C.fmtDate(d) : `${MON[+m[2] - 1]} ${m[1]}`; };
    return `<div class="card"><div class="card-head"><span class="head-ico">${icon('coach')}</span><h3 class="card-title">Swing notes</h3></div>
      <ul class="rv-good">${list.map((x) => `<li>${icon('check')}<span>${esc(x.note)}${x.source || x.date ? `<span class="muted"> (${esc([when(x.date), x.source].filter(Boolean).join(', '))})</span>` : ''}</span></li>`).join('')}</ul></div>`;
  }
  function swingView() {
    const list = data.reviews || [];
    if (list.length) return swingNotesHtml() + list.map(reviewCard).join('') + filmGuide(false);
    const ex = exampleReview();
    return `${swingNotesHtml()}<div class="card"><div class="card-head"><span class="head-ico">${icon('play')}</span><h3 class="card-title">No swing reviews yet</h3></div>
        <p class="note">Film a few swings and ${sendTo('video')}. Claude pulls out the key frames (setup, top, impact and finish), draws on them to show what’s happening, and adds the fixes and drills here.</p></div>
      ${filmGuide(true)}
      ${ex ? reviewCard(ex) : ''}`;
  }
  function focusCard(f, i, openFirst) {
    const call = f.callout ? C.sessionCallout(f.callout, data.sessions) : null;
    const drills = f.drills.map((d, di) => `<div class="drill" id="drill-${esc(f.id)}-${di}">
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

  // ----- Game: play a real course with your own shots -----
  // Three ways to hit a shot. The real swing (the swing pad): he drags back and swipes up
  // through the ball, and GolfGame reads it like a launch monitor (backswing, tempo, path,
  // strike) and flies the ball by the ball-flight laws from his own clubs' face, path,
  // distances and scatter (GolfGame.swingShot). The swing meter: three taps, and the
  // timing picks one of his real range shots (GolfGame.pickShot). From the range, he
  // types in the shot he just hit. The canvas shows the hole
  // from above for aiming (tap it to aim), then the shot from behind the ball as it
  // flies. Each stroke is saved as it's hit, so a reload carries on where he was.
  // Rounds are saved on this phone, for each player.
  const GM = window.GolfGame, COURSES = window.GolfCourses;
  const GM_HOLD = 1.1;      // seconds a finished shot stays on screen before the map comes back
  const GM_POS0 = -0.32;    // the swing meter's left end, past the line
  const GM_PUTT_END = 1.1;  // the putting meter's right end
  const GM_NUDGE = 3;       // yds the aim moves for each ◀ ▶ tap
  // How far to aim a club that has no shots yet (only from the range), yds.
  const GM_GUESS = { Driver: 200, '3w': 180, '5w': 170, '7w': 160, '3hy': 170, '4hy': 160, '5hy': 150, '6hy': 140, '3i': 165, '4i': 155, '5i': 145, '6i': 135, '7i': 125, '8i': 115, '9i': 105, PW: 95, GW: 85, SW: 72, LW: 58 };
  const GM_CLUB_RE = /^(Driver|[2-9]w|[2-7]hy|[2-9]i|PW|GW|SW|LW)$/;
  const GM_HOLES = { all: '18 holes', front: 'Front 9', back: 'Back 9' };
  const GM_MODES = [['swing', 'Real swing'], ['meter', 'Swing meter'], ['live', 'From the range']];
  const GM_MODE_OK = { swing: 1, meter: 1, live: 1 };
  // The course maps are OpenStreetMap's (ODbL), which asks for this wherever they're shown.
  const GM_MAP_CREDIT = '<p class="gm-src">Course map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · Elevation: <a href="https://www.usgs.gov/3d-elevation-program" target="_blank" rel="noopener">USGS 3DEP</a></p>';
  const GM_FROM = { rough: 'from the rough', bunker: 'from the sand', trees: 'punched out from under the trees' };
  const GM_WHERE = { fairway: 'In the fairway', rough: 'In the rough', bunker: 'In a bunker', trees: 'Under the trees', green: 'On the green', fringe: 'On the fringe', tee: 'On the tee' };
  let gm = null;
  function gmClamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function gmState() { const st = loadJSON(key('game')); return st && typeof st === 'object' ? st : {}; }
  function gmStore(st) { if (!saveJSON(key('game'), st)) toast('Couldn’t save the round on this phone'); }
  function gmCourse(id) { return COURSES ? COURSES.get(id) || COURSES.list[0] : null; }
  // The settings for the next round. The real swing is the way to play now: settings
  // saved before it existed (v < 2) move from the swing meter to it.
  function gmSettings(st, pools) {
    const set = Object.assign({ tee: 'white', holes: 'all', one: 1, mode: Object.keys(pools).length ? 'swing' : 'live', easy: false, hand: 'R' }, st.last && typeof st.last === 'object' ? st.last : {});
    if (!GM_MODE_OK[set.mode] || (set.mode === 'meter' && !(set.v >= 2))) set.mode = Object.keys(pools).length ? 'swing' : 'live';
    // anything a saved copy holds that this course doesn't have goes back to the default
    const course = gmCourse();
    if (course && !course.tees.some((t) => t.id === set.tee)) set.tee = course.tees.some((t) => t.id === 'white') ? 'white' : course.tees[0].id;
    if (!GM_HOLES[set.holes] && set.holes !== 'one') set.holes = 'all';
    if (course && !course.holes.some((h) => h.n === +set.one)) set.one = 1;
    set.easy = set.easy === true;
    set.hand = set.hand === 'L' ? 'L' : 'R';
    set.v = 2;
    return set;
  }
  function gmHand() { const st = gm ? gm.st : gmState(); return st.last && st.last.hand === 'L' ? 'L' : 'R'; }
  function gmTeeName(course, id) { const t = course.tees.find((x) => x.id === id); return t ? t.name : cap(id); }
  // The saved round, if it's one this page can carry on with: a known course and tees, and
  // holes with their shots. Anything else is set aside rather than breaking the tab.
  function gmRound(st) {
    const r = st.round, course = r && typeof r === 'object' && COURSES ? COURSES.get(r.course) : null;
    if (!course || r.v !== 1 || !Array.isArray(r.cards) || !r.cards.length || !course.tees.some((t) => t.id === r.tee)) return null;
    const holes = new Set(course.holes.map((h) => h.n)), num = (v) => typeof v === 'number' && isFinite(v);
    const okCard = (c) => !!c && typeof c === 'object' && holes.has(c.n) && num(c.par) && num(c.strokes) && Array.isArray(c.shots) && c.shots.every((x) => x && typeof x === 'object');
    if (!r.cards.every(okCard)) return null;
    if (!(Number.isInteger(r.idx) && r.idx >= 0 && r.idx < r.cards.length)) r.idx = Math.max(0, r.cards.findIndex((c) => !c.done));
    if (r.ball && !(typeof r.ball === 'object' && num(r.ball.x) && num(r.ball.z))) delete r.ball;
    return r;
  }
  function gmFtText(ft) { const r = Math.round(ft); return r <= 1 ? 'a foot' : r + ' ft'; }
  function gmYds(d) { const r = Math.round(d); return r === 1 ? '1 yd' : r + ' yds'; }

  // A saved round this page can't draw (from an older version, or a corrupt copy) is set aside
  // and a new one can start, rather than leaving the tab blank.
  function renderGame() {
    try { renderGameNow(); } catch (e) {
      const st = gmState();
      if (st.round) {
        gmStop();
        delete st.round; gmStore(st);
        toast('The saved round couldn’t be read, so it was set aside');
        try { renderGameNow(); return; } catch (e2) { /* fall through */ }
      }
      $('#view-game').innerHTML = '<div class="card"><p class="empty">The game didn’t load. Reload the page to try again.</p></div>';
    }
  }
  function renderGameNow() {
    const el = $('#view-game');
    if (!GM || !COURSES || !FL) { el.innerHTML = '<div class="card"><p class="empty">The game didn’t load. Reload the page to try again.</p></div>'; return; }
    const st = gmState(), pools = GM.clubPools(data.sessions, data.equipment), round = gmRound(st);
    if (!round || ui.game.setup) { el.innerHTML = gmSetupHtml(st, pools, round); return; }
    if (round.cards.every((c) => c.done)) { el.innerHTML = gmOverHtml(round); return; }
    el.innerHTML = gmPlayHtml(round);
    gmMount(st, round, pools);
  }

  // ----- Before a round: the course, tees, holes and how shots are played -----
  function gmChip(k, v, label, cur) {
    return `<button type="button" class="chip" data-action="gm-set" data-k="${k}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${label}</button>`;
  }
  function gmSetupHtml(st, pools, round) {
    const course = gmCourse(), set = gmSettings(st, pools), clubs = GM.clubList(pools).map((p) => p.club);
    const live = set.mode === 'live' || !clubs.length, mode = live ? 'live' : set.mode, lefty = set.hand === 'L';
    const t = round ? GM.totals(round) : null, next = round ? round.cards.find((c) => !c.done) : null;
    const going = round && next ? `<div class="card">
        <div class="card-head"><span class="head-ico">${icon('flag')}</span><h3 class="card-title">Round in progress</h3></div>
        <p class="note">${esc(gmCourse(round.course).name)}, ${esc(gmTeeName(course, round.tee))} tees: hole ${next.n} is next${t.played ? `, ${GM.toParText(t.toPar)} after ${plural(t.played, 'hole')}` : ''}.</p>
        <div class="row-actions"><button class="btn" data-action="gm-continue">Carry on</button></div></div>` : '';
    return `${going}
      <h2>${round && next ? 'Or start a new round' : 'Play a round'}</h2>
      <div class="card gm-setup">
        <div class="card-head"><span class="head-ico">${icon('flag')}</span><h3 class="card-title">${esc(course.name)}</h3></div>
        <p class="note">${esc(course.place)} · par ${COURSES.par(course)}. ${esc(course.blurb)}</p>
        <ul class="gm-how">
          <li>Every shot flies like your real range shots with that club: its distance, its height and your usual shape.</li>
          <li><strong>Real swing:</strong> put your thumb on the ball, drag down for the backswing, then swipe up through the ball. A gold ring rises at the pace of a perfect tempo: 3 : 1, back to down.</li>
          <li>Quick from the top shuts the face, so it starts ${lefty ? 'right' : 'left'}; slow leaves it open, so it starts ${lefty ? 'left' : 'right'}. Swipe up and to the ${lefty ? 'left' : 'right'} for a draw, up and to the ${lefty ? 'right' : 'left'} for a fade.</li>
          <li>Tap the map to aim. The oval shows where most of your shots with that club finish.</li>
          <li>At the range? Choose <strong>From the range</strong> and type in each shot from the screen to play the hole live.</li>
        </ul>
        <div class="field"><span class="label" id="gmTeeL">Tees</span><div class="chips" role="group" aria-labelledby="gmTeeL">${course.tees.map((x) => gmChip('tee', x.id, `${esc(x.name)} · ${x.yds.toLocaleString('en-US')} yds`, set.tee)).join('')}</div></div>
        <div class="field"><span class="label" id="gmHolesL">Holes</span><div class="chips" role="group" aria-labelledby="gmHolesL">${[['all', 'All 18'], ['front', 'Front 9'], ['back', 'Back 9'], ['one', 'One hole']].map(([v, l]) => gmChip('holes', v, l, set.holes)).join('')}</div>
          ${set.holes === 'one' ? `<div class="chips gm-holes" role="group" aria-label="Which hole">${course.holes.map((h) => gmChip('one', h.n, String(h.n), set.one)).join('')}</div>
          <p class="hint">Hole ${+set.one}: par ${course.holes[+set.one - 1].par}, ${course.holes[+set.one - 1].yds[set.tee] || '–'} yds. ${esc(course.holes[+set.one - 1].note)}</p>` : ''}</div>
        <div class="field"><span class="label" id="gmModeL">Shots</span><div class="chips" role="group" aria-labelledby="gmModeL">${GM_MODES.filter(([v]) => clubs.length || v === 'live').map(([v, l]) => gmChip('mode', v, l, mode)).join('')}</div>
          <p class="hint">${live ? 'After each shot at the range, type in its carry and offline from the screen, and it plays on the hole. You can switch during a round.'
            : mode === 'meter' ? `Three taps: start the swing, set the power, then tap on the yellow line. Early pulls it ${lefty ? 'right' : 'left'}, late pushes it ${lefty ? 'left' : 'right'}. Each club plays your real shots: ${esc(clubs.join(', '))}.`
            : `A swing like a real one: your tempo sets the clubface and the way you swipe sets the path, so you see what starts a ball left or right and what curves it. Each club plays your real distances and your usual shape: ${esc(clubs.join(', '))}.`}</p></div>
        ${live ? '' : `<label class="gm-check"><input type="checkbox" data-change="gm-easy"${set.easy ? ' checked' : ''}> Easy: more room for error</label>
        <label class="gm-check"><input type="checkbox" data-change="gm-hand"${lefty ? ' checked' : ''}> I play left-handed</label>`}
        <div class="row-actions"><button class="btn block" data-action="gm-start">${icon('flag')}<span>Tee off</span></button></div>
        <p class="gm-src">Pars and yardages come from the course scorecard, and the holes from OpenStreetMap’s map of the course: its fairways, greens, tee boxes and bunkers, Lake Merced and the boundary. The trees are placed between the holes. The most a hole can cost is double par.</p>
        ${GM_MAP_CREDIT}
      </div>
      ${gmHistoryHtml(st, course, round)}`;
  }
  function gmHistoryHtml(st, course, round) {
    const hist = (st.history || []).filter((r) => r && C.isNum(r.strokes));
    const erase = round || hist.length ? `<div class="row-actions"><button class="btn ghost small" data-action="gm-erase">Erase all rounds</button></div>` : '';
    if (!hist.length) return erase ? `<div class="card">${erase}</div>` : '';
    const full = hist.filter((r) => r.holes === 18), best = full.length ? full.reduce((a, b) => (b.strokes < a.strokes ? b : a)) : null;
    return `<h2>Your rounds</h2><div class="card"><ul class="plain gm-rounds">${hist.slice(0, 8).map((r) => `<li><span>${esc(C.fmtDate(r.date, { short: true }))} · ${esc(r.label || plural(r.holes, 'hole'))} · ${esc(gmTeeName(course, r.tee))}${r.mode === 'live' ? ' · from the range' : r.mode === 'meter' ? ' · swing meter' : ''}</span>
      <span class="sc">${r.strokes} (${GM.toParText(r.toPar)})</span></li>`).join('')}</ul>
      ${best ? `<p class="hint">Best 18 holes: ${best.strokes} (${GM.toParText(best.toPar)}) on ${esc(C.fmtDate(best.date, { short: true }))}.</p>` : ''}${erase}</div>`;
  }
  // A rounds reset from the data file ("rounds_reset": "YYYY-MM-DD"): the first time a phone
  // sees it, it erases this player's round in progress and past rounds from that day or
  // before (so test rounds go from every phone). Rounds played after that are kept.
  function gmApplyReset() {
    const day = bundle && /^\d{4}-\d{2}-\d{2}$/.test(String(bundle.rounds_reset || '')) ? bundle.rounds_reset : null;
    if (!day) return false;
    const st = gmState();
    if (st.resetApplied === day) return false;
    st.history = (st.history || []).filter((r) => r && r.date && r.date > day);
    if (st.round && !(st.round.started && st.round.started > day)) delete st.round;
    st.resetApplied = day;
    gmStore(st);
    if (gm) gmStop();
    return true;
  }

  // ----- During a round -----
  function gmPlayHtml(round) {
    const course = gmCourse(round.course), card = round.cards[round.idx], def = course.holes.find((h) => h.n === card.n), t = GM.totals(round);
    return `<div class="gm-top">
        <div class="gm-title"><h2>Hole ${card.n} <span class="gm-par">· par ${card.par} · ${card.yds} yds</span></h2>
          <span class="gm-total">${t.played ? `${GM.toParText(t.toPar)} after ${plural(t.played, 'hole')}` : `${esc(gmTeeName(course, round.tee))} tees`}</span></div>
        <p class="gm-note">${esc(def ? def.note : '')}</p>
      </div>
      <div class="card game" id="game">
        <div class="gm-stage"><canvas class="gm-canvas" role="img" aria-label="The hole from above"></canvas>
          <button type="button" class="gm-skip" data-action="gm-skip" hidden>Skip ▸▸</button></div>
        <p class="gm-status" aria-live="polite"></p>
        <div class="gm-hit"></div>
        <div class="gm-msg" aria-live="polite" hidden></div>
        <div class="gm-controls"></div>
        <div class="row-actions gm-actions">
          <button type="button" class="btn small ghost" data-action="gm-card" aria-expanded="${!!ui.game.card}">Scorecard</button>
          <button type="button" class="btn small ghost" data-action="gm-pickup">Pick up</button>
          <button type="button" class="btn small ghost" data-action="gm-quit">End round</button>
        </div>
        <div class="gm-scorecard"${ui.game.card ? '' : ' hidden'}>${ui.game.card ? gmScorecardHtml(round) : ''}</div>
        ${GM_MAP_CREDIT}
      </div>`;
  }
  function gmScorecardHtml(round) {
    const t = GM.totals(round);
    return `<div class="gm-sc">${round.cards.map((c, i) => {
      const cur = i === round.idx && !c.done;
      const n = `<span class="n">${c.n} · par ${c.par}</span>`;
      if (!c.done && !cur) return `<div class="h">${n}<span class="p">${c.yds} yds</span></div>`;
      return `<div class="h${cur ? ' cur' : ''}${c.done && c.score < c.par ? ' under' : ''}">${n}
        <span class="s">${c.done ? c.score : c.strokes || '–'}</span>
        <span class="p">${c.done ? esc(c.picked ? 'Picked up' : GM.scoreName(c.score, c.par)) : 'Playing'}</span></div>`;
    }).join('')}</div>
      <p class="gm-sc-sum"><span>${t.played} of ${plural(t.holes, 'hole')}</span><span>${plural(t.strokes, 'stroke')}</span><span>${GM.toParText(t.toPar)}</span></p>`;
  }
  function gmOverHtml(round) {
    const course = gmCourse(round.course), t = GM.totals(round);
    return `<h2>Round over</h2>
      <div class="card"><div class="gm-done"><span class="big">${t.strokes}</span>
        <span class="s">${GM.toParText(t.toPar)} · ${esc(round.label || plural(t.holes, 'hole'))} at ${esc(course.name)}, ${esc(gmTeeName(course, round.tee))} tees</span></div>
        ${gmScorecardHtml(round)}
        ${gmSwingSummary([].concat(...round.cards.map((c) => c.shots || [])), 'this round')}
        <div class="row-actions"><button class="btn block" data-action="gm-new">${icon('flag')}<span>Play again</span></button></div></div>`;
  }

  function gmMount(st, round, pools) {
    gmStop();
    const box = $('#game'), canvas = $('.gm-canvas', box), ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) { $('.gm-controls', box).innerHTML = '<p class="empty">This phone can’t draw the hole.</p>'; return; }
    const course = gmCourse(round.course), card = round.cards[round.idx];
    const H = GM.buildHole(course, card.n, round.tee), pin = GM.pinFor(H, round.seed);
    // A round started with the swing meter before the real swing existed moves to it once.
    if (round.mode === 'meter' && !(round.v2 >= 2)) round.mode = 'swing';
    round.v2 = 2;
    if (!GM_MODE_OK[round.mode] || (round.mode !== 'live' && !Object.keys(pools).length)) round.mode = 'live';
    gm = { st, round, card, course, H, pin, pools, box, canvas, ctx, phase: 'aim', aim: null, club: null, busy: false, raf: 0, meter: null, meterEl: null, pad: null, lastSwing: null, bgs: new Map() };
    if (!card.done && !round.ball) round.ball = { x: H.start.x, z: H.start.z, lie: 'tee' };
    gm.ball = round.ball || { x: pin.x, z: pin.z, lie: 'green' };
    gmSize();
    canvas.addEventListener('click', gmCanvasTap);
    if (card.done) { gm.phase = 'holed'; gm.ballHidden = true; gmView(); gmControls(); gmDraw(); return; }
    gmNewSpot();
  }
  function gmStop() {
    if (!gm) return;
    if (gm.raf) cancelAnimationFrame(gm.raf);
    if (gm.meter && gm.meter.raf) cancelAnimationFrame(gm.meter.raf);
    if (gm.pad && gm.pad.raf) cancelAnimationFrame(gm.pad.raf);
    gm = null;
  }
  function gmSize() {
    const w = Math.max(240, Math.floor(gm.canvas.parentElement.getBoundingClientRect().width));
    const h = Math.round(Math.min(520, Math.max(280, w)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    gm.canvas.width = Math.round(w * dpr);
    gm.canvas.height = Math.round(h * dpr);
    gm.canvas.style.height = h + 'px';
    gm.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Object.assign(gm, { w, h, dpr, viewKey: null });
    gm.bgs.clear();
  }
  function gmLie() { return gm.ball.lie || 'fairway'; }
  function gmPutting() { return gm.club === 'Putter'; }
  // The clubs he can pick: with the swing meter, the ones he has range shots with;
  // from the range, everything in his bag too.
  function gmClubs() {
    const withShots = GM.clubList(gm.pools).map((p) => p.club);
    if (gm.round.mode !== 'live') return withShots;
    const all = new Set(withShots);
    Object.keys(data.clubs || {}).forEach((c) => all.add(c));
    const bag = data.equipment && data.equipment.bag;
    if (bag && typeof bag === 'object' && !Array.isArray(bag)) Object.keys(bag).forEach((c) => all.add(c));
    return C.sortClubs(Array.from(all).filter((c) => GM_CLUB_RE.test(c)));
  }
  function gmReach(club) {
    const p = gm.pools[club], f = GM.lieFactor(club, gmLie()).dist;
    return (p ? p.full : GM_GUESS[club] || 120) * f;
  }
  // The real ground: how much higher a spot is than the ball (yds, + uphill), how far it
  // plays with this club (its landing angle), and the slope of the lie facing it.
  function gmRise(at) { const G = gm.H.ground; return (GM.heightAt(G, at.x, at.z) - GM.heightAt(G, gm.ball.x, gm.ball.z)) / 3; }
  // (with the shot type in play: a chip comes down shallower, so a climb costs it more)
  function gmPlays(at, club) {
    const c = club || gm.club, pool = gm.pools[c];
    return GM.playsLike(GM.dist(gm.ball, at), gmRise(at), pool ? GM.typeLanding(pool, club || gmPutting() ? 'normal' : gmShotType()) : GM.landingOf(c));
  }
  function gmSlopeTo(at) { return GM.slopeAt(gm.H.ground, gm.ball.x, gm.ball.z, GM.headingTo(gm.ball, at)); }
  function gmLieSlope(at) { return GM.lieSlope(gmSlopeTo(at || gmAimPoint()), gm.club, gmHand(), data.equipment); }
  function gmSuggest() {
    const list = gmClubs(), d = GM.playsLike(GM.dist(gm.ball, gm.pin), gmRise(gm.pin), 46);
    const withShots = {};
    list.forEach((c) => { if (gm.pools[c]) withShots[c] = gm.pools[c]; });
    const c = GM.suggestClub(withShots, d, gmLie());
    if (c) return c;
    // From the range with no shots yet: the shortest club that gets there by the usual distances.
    const byGuess = list.slice().sort((a, b) => (GM_GUESS[a] || 0) - (GM_GUESS[b] || 0));
    return byGuess.find((x) => (GM_GUESS[x] || 0) * (GM.LIE[gmLie()] || GM.LIE.fairway).dist >= d - 3) || byGuess[byGuess.length - 1] || null;
  }
  // Where this club's shot wants to finish from here (GolfGame.aimFor), whatever the shot
  // type: worked out once for each club and spot.
  function gmTarget() {
    const k = gm.club + '@' + gm.ball.x.toFixed(2) + ',' + gm.ball.z.toFixed(2);
    if (gm.targetKey !== k) Object.assign(gm, { targetKey: k, target: GM.aimFor(gm.H, gm.ball, gm.pin, gmReach(gm.club), gm.pools[gm.club] ? gm.pools[gm.club].landing : GM.landingOf(gm.club)) });
    return gm.target;
  }
  // What a golfer weighs before choosing the shot (GolfGame.suggestShot): the lie, how far
  // to the pin and to the green's edge, how much green there is between its near edge and
  // the pin, a bunker short of the pin, trees in the way of a normal flight but not a low
  // or a high one, the trouble either side of where he's aiming, and which way the hole
  // bends over this shot and a little past it (when the pin is out of reach).
  function gmShotCtx() {
    const H = gm.H, b = gm.ball, pin = gm.pin, d = GM.dist(b, pin), hd = GM.headingTo(b, pin);
    let toGreen = d, room = 0, overSand = false;
    for (let s = 0; s < d; s += 1) { const q = FL.offsetPoint(b.x, b.z, hd, s, 0), l = GM.lieAt(H, q.x, q.z); if (l === 'green' || l === 'fringe') { toGreen = s; break; } }
    for (let s = 0; s < 45; s += 0.5) { const q = FL.offsetPoint(pin.x, pin.z, hd + Math.PI, s, 0); room = s; if (GM.lieAt(H, q.x, q.z) !== 'green') break; }
    for (let s = Math.max(3, d - 40); s < d - 1; s += 1) { const q = FL.offsetPoint(b.x, b.z, hd, s, 0); if (GM.lieAt(H, q.x, q.z) === 'bunker') { overSand = true; break; } }
    const reach = gmReach(gm.club), t = GM.toHole(H, b.x, b.z), a0 = H.at(t.s + 15).h, a1 = H.at(Math.min(H.L, t.s + reach + 40)).h;
    let turn = a1 - a0;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const bend = Math.abs(turn) > 14 * Math.PI / 180 && d > reach + 10 ? (turn < 0 ? -1 : 1) : 0, tg = gmTarget();
    const inWay = GM.treesInWay(H, b, tg, reach, gmLie() === 'trees');
    const treesLow = inWay > 0 && GM.treesInWay(H, b, tg, reach, GM.SHOTS.low.apex) === 0;
    const treesHigh = inWay > 0 && !treesLow && GM.treesInWay(H, b, tg, reach, GM.SHOTS.high.apex) === 0;
    const rise = gmRise(pin);
    return { lie: gmLie(), d, toGreen, room, overSand, bend, treesLow, treesHigh, beside: GM.troubleBeside(H, b, tg), hand: gmHand(), club: gm.club, reach, rise, chipClub: GM.chipClub(gm.pools, d, toGreen, rise),
      spinSpeed: gm.pools[gm.club] ? gm.pools[gm.club].pureSpeed : null, ownCurve: gm.pools[gm.club] ? gm.pools[gm.club].curve : null };
  }
  // The shots on offer from here, the suggested one (with why), and the one in play.
  function gmShotSugg() {
    const k = gm.club + '@' + gm.ball.x.toFixed(2) + ',' + gm.ball.z.toFixed(2);
    if (gm.suggKey !== k) {
      const ctx = gmShotCtx(), types = gmPutting() || gm.round.mode === 'live' ? [] : GM.shotTypes(ctx);
      Object.assign(gm, { suggKey: k, shotCtx: ctx, shotTypes: types, shotSugg: types.length ? GM.suggestShot(Object.assign(ctx, { types })) : null });
    }
    return gm.shotSugg;
  }
  function gmShotType() {
    gmShotSugg();
    const types = (gm.shotTypes || []).filter((t) => GM.shotFits(t, gm.club));
    if (gm.shot && types.indexOf(gm.shot) >= 0) return gm.shot;
    if (gm.shotSugg && types.indexOf(gm.shotSugg.type) >= 0) return gm.shotSugg.type;
    return types[0] || 'normal';
  }
  // His aim, or the default for this club from this spot (worked out once for each).
  // With the real swing, the default allows for his usual shape: if a perfect swing with
  // the club finishes 8 yds right, it aims 8 yds left of the spot it wants.
  function gmAimPoint() {
    if (gm.aim) return gm.aim;
    const k = gm.round.mode + ':' + gm.club + ':' + gmShotType() + '@' + gm.ball.x.toFixed(2) + ',' + gm.ball.z.toFixed(2);
    if (gm.autoKey !== k) {
      const target = gmTarget(), shape = gmShapeAt(target), allow = shape && Math.abs(shape.side) >= 3 ? shape.side : 0;
      const aim = allow ? Object.assign(FL.offsetPoint(target.x, target.z, GM.headingTo(gm.ball, target), 0, -allow), { pin: target.pin }) : target;
      Object.assign(gm, { autoKey: k, autoAim: aim, autoTarget: target, autoAllow: allow, autoShape: shape });
    }
    return gm.autoAim;
  }
  // Where a perfect real swing with this club, aimed at `at`, finishes: yds right (+) or
  // left of the aim, and the shape. Only for the real swing (the meter's best shots fly
  // straight), and worked out once for each club, spot and distance.
  function gmShapeAt(at) {
    const pool = gm.pools[gm.club];
    if (gm.round.mode !== 'swing' || !pool || gmPutting()) return null;
    const type = gmShotType(), d = gmPlays(at), k = gm.club + ':' + type + '@' + gm.ball.x.toFixed(1) + ',' + gm.ball.z.toFixed(1) + ':' + Math.round(d) + ':' + Math.round(GM.headingTo(gm.ball, at) * 20) + ':' + gmHand() + (gm.round.easy ? 'e' : '');
    gm.shapes = gm.shapes || new Map();
    if (!gm.shapes.has(k)) gm.shapes.set(k, GM.shapeAllowance(pool, GM.strokeFor(pool, d, gmLie(), type), gmLie(), { hand: gmHand(), easy: gm.round.easy, equip: data.equipment, slope: gmSlopeTo(at), type }));
    return gm.shapes.get(k);
  }
  // A new spot for the ball (a new hole, or after a shot): pick the club and the view.
  function gmNewSpot() {
    gm.aim = null;
    gm.ballHidden = false;
    gm.rollPos = null;
    const lie = gmLie(), ft = GM.dist(gm.ball, gm.pin) * 3;
    gm.club = lie === 'green' || (lie === 'fringe' && ft < 90) ? 'Putter' : gmSuggest();
    gm.shot = null;
    gm.suggClub = gm.club;
    // The suggested shot can want another club: a chip wants one that runs, a flop or a
    // splash his most lofted wedge.
    if (!gmPutting() && gm.round.mode !== 'live') {
      const sg = gmShotSugg(), want = sg ? GM.clubForShot(sg.type, gm.pools, gm.club, gm.shotCtx) : gm.club;
      if (want !== gm.club && gm.pools[want]) { gm.club = gm.suggClub = want; gmShotSugg(); }
    }
    gm.phase = gmPutting() ? 'putt' : 'aim';
    gmView();
    gmControls();
    gmDraw();
  }
  // The map's camera: the hole from the ball to the green, straight down, green at the
  // top; on the green (or putting from the fringe), close in on the ball and the hole;
  // and once the hole is over, all of it, with every shot.
  function gmView() {
    const H = gm.H, pin = gm.pin, whole = gm.phase === 'holed', b = whole ? H.start : gm.ball;
    const close = !whole && (gm.phase === 'putt' || gm.phase === 'roll');
    const vk = (whole ? 'hole:' : close ? 'putt:' : 'map:') + b.x.toFixed(2) + ',' + b.z.toFixed(2);
    if (gm.viewKey === vk && gm.mapBg) return;
    gm.viewKey = vk;
    let cam;
    if (close) {
      const hd = GM.dist(b, pin) > 0.3 ? GM.headingTo(b, pin) : H.green.rot, d = GM.dist(b, pin), pad = Math.max(5, d * 0.3);
      const pts = [b, pin];
      [[-pad, -pad], [pad, -pad], [-pad, d + pad], [pad, d + pad]].forEach(([s, a]) => pts.push(FL.offsetPoint(b.x, b.z, hd, a, s)));
      cam = FL.fitTop(pts, gm.w, gm.h, hd, 0.06);
    } else {
      const green = { x: H.green.x, z: H.green.z };
      const hd = GM.dist(b, green) > 3 ? GM.headingTo(b, green) : H.green.rot, s0 = GM.toHole(H, b.x, b.z).s;
      const pts = [b, pin, green, FL.offsetPoint(b.x, b.z, hd, -10, 0)];
      H.path.forEach((q) => { if (q.s >= s0 - 8 && q.s <= H.L + 24) pts.push(FL.offsetPoint(q.x, q.z, q.h, 0, -30), FL.offsetPoint(q.x, q.z, q.h, 0, 30)); });
      cam = FL.fitTop(pts, gm.w, gm.h, hd, 0.03);
    }
    gm.mapCam = cam;
    gm.bgs.clear();
    gm.mapBg = gmBg(cam, {});
  }
  // The hole drawn once for a camera, so a frame only adds what moves.
  function gmBg(cam, opts) {
    let bg = gm.bgs.get(cam);
    if (!bg) {
      bg = document.createElement('canvas');
      bg.width = gm.canvas.width;
      bg.height = gm.canvas.height;
      const b = bg.getContext('2d');
      b.setTransform(gm.dpr, 0, 0, gm.dpr, 0, 0);
      FL.drawHole(b, cam, gm.H, gm.pin, opts);
      gm.bgs.set(cam, bg);
    }
    return bg;
  }

  // ----- The map: the ball, this hole's shots so far, the aim and where shots finish -----
  function gmPathOnMap(ctx, cam, pts, color, width, dash) {
    const scr = pts.map((p) => FL.project(cam, p[0], 0, p[1])).filter(Boolean);
    if (scr.length < 2) return;
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    scr.forEach((s, i) => { if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function gmDot(ctx, cam, x, z, r, fill, edge) {
    const q = FL.project(cam, x, 0, z);
    if (!q) return null;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, 2 * Math.PI);
    ctx.fill();
    if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke(); }
    return q;
  }
  function gmFlag(ctx, cam, pin) {
    const q = FL.project(cam, pin.x, 0, pin.z);
    if (!q) return;
    ctx.fillStyle = '#111a15';
    ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - 24); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - 24); ctx.stroke();
    ctx.fillStyle = '#e8463a';
    ctx.beginPath(); ctx.moveTo(q.x, q.y - 24); ctx.lineTo(q.x + 14, q.y - 19.5); ctx.lineTo(q.x, q.y - 15); ctx.closePath(); ctx.fill();
  }
  // Where most of his shots with the club finish: an oval around the aim (1.5 standard
  // deviations each way, about two of every three solid shots), moved by his average
  // miss, and smaller for a smaller swing.
  function gmZone(ctx, cam, aim, hd) {
    const pool = gm.pools[gm.club];
    if (!pool) return;
    const lie = gmLie(), f = GM.lieFactor(gm.club, lie), p = GM.powerFor(pool, gmPlays(aim), lie, gmShotType()), k = p * f.dist, sp = pool.spread;
    const shape = gmShapeAt(aim), c = FL.offsetPoint(aim.x, aim.z, hd, 0, shape ? shape.side : sp.off * k * f.spray);
    const rx = Math.max(2, 1.5 * sp.offSd * k * f.spray), rz = Math.max(2, 1.5 * sp.lenSd * k), pts = [];
    for (let i = 0; i < 40; i++) {
      const a = 2 * Math.PI * i / 40, q = FL.offsetPoint(c.x, c.z, hd, rz * Math.sin(a), rx * Math.cos(a)), s = FL.project(cam, q.x, 0, q.z);
      if (s) pts.push(s);
    }
    if (pts.length < 3) return;
    ctx.beginPath();
    pts.forEach((s, i) => { if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function gmDraw() {
    if (!gm) return;
    const ctx = gm.ctx, cam = gm.mapCam, b = gm.rollPos || gm.ball;
    ctx.clearRect(0, 0, gm.w, gm.h);
    ctx.drawImage(gm.mapBg, 0, 0, gm.w, gm.h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    gm.card.shots.forEach((s) => {
      const pts = s.track && s.track.length > 1 ? s.track : s.from && s.to ? [s.from, s.to] : null;
      if (!pts) return;
      gmPathOnMap(ctx, cam, pts, 'rgba(0,0,0,0.35)', 4);
      gmPathOnMap(ctx, cam, pts, 'rgba(255,255,255,0.85)', 2);
      gmDot(ctx, cam, pts[0][0], pts[0][1], 3, 'rgba(255,255,255,0.9)');
    });
    if (gm.phase === 'aim') {
      const aim = gmAimPoint(), hd = GM.headingTo(b, aim), d = GM.dist(b, aim);
      gmZone(ctx, cam, aim, hd);
      gmPathOnMap(ctx, cam, [[b.x, b.z], [aim.x, aim.z]], 'rgba(255,255,255,0.95)', 2, [7, 6]);
      const q = FL.project(cam, aim.x, 0, aim.z);
      if (q) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, 2 * Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(q.x - 14, q.y); ctx.lineTo(q.x - 5, q.y); ctx.moveTo(q.x + 5, q.y); ctx.lineTo(q.x + 14, q.y);
        ctx.moveTo(q.x, q.y - 14); ctx.lineTo(q.x, q.y - 5); ctx.moveTo(q.x, q.y + 5); ctx.lineTo(q.x, q.y + 14); ctx.stroke();
        FL.pill(ctx, cam, q.x, q.y - 12, gmYds(d));
      }
    }
    if (gm.phase === 'putt' && GM.dist(b, gm.pin) > 0.2) {
      gmPathOnMap(ctx, cam, [[b.x, b.z], [gm.pin.x, gm.pin.z]], 'rgba(255,255,255,0.95)', 2, [7, 6]);
      const m = FL.offsetPoint(b.x, b.z, GM.headingTo(b, gm.pin), GM.dist(b, gm.pin) / 2, 0), q = FL.project(cam, m.x, 0, m.z);
      if (q) FL.pill(ctx, cam, q.x + 40, q.y + 14, gmFtText(GM.dist(b, gm.pin) * 3));
    }
    gmFlag(ctx, cam, gm.pin);
    if (!gm.ballHidden) gmDot(ctx, cam, b.x, b.z, 5.5, '#ffffff', 'rgba(0,0,0,0.6)');
    gmLabel();
  }
  function gmLabel() {
    const b = gm.ball, d = GM.dist(b, gm.pin), where = (GM_WHERE[b.lie] || GM.LIE_WORDS[b.lie] || '').toLowerCase();
    let s = `Hole ${gm.card.n} from above. The ball is ${where || 'in play'}, ${gmPutting() ? gmFtText(d * 3) + ' from the hole' : gmYds(d) + ' from the pin'}.`;
    if (gm.phase === 'aim') s += ` Aiming ${gmYds(GM.dist(b, gmAimPoint()))} with the ${C.clubName(gm.club, data.clubs).toLowerCase()}.`;
    gm.canvas.setAttribute('aria-label', s);
    gm.canvas.classList.toggle('aim', gm.phase === 'aim');
  }
  function gmStatusText() {
    const card = gm.card, b = gm.ball, d = GM.dist(b, gm.pin);
    if (card.done) return `Hole ${card.n}: ${card.picked ? 'picked up' : plural(card.score, 'stroke')}`;
    const where = GM_WHERE[b.lie] || GM.LIE_WORDS[b.lie] || '';
    const far = gmPutting() || b.lie === 'green' ? `${gmFtText(d * 3)} from the hole` : `${gmYds(d)} to the pin`;
    const slope = gmPutting() || b.lie === 'green' ? '' : GM.slopeWords(GM.lieSlope(gmSlopeTo(gm.pin), gm.club || '7i', gmHand(), data.equipment));
    return [`Shot ${card.strokes + 1}`, where + (slope ? ', ' + slope : ''), far, card.penalties ? plural(card.penalties, 'penalty stroke') : ''].filter(Boolean).join(' · ');
  }

  // ----- Controls under the map -----
  function gmClubChips() {
    const clubs = gmClubs().slice();
    if (gmLie() === 'fringe' || gmLie() === 'green') clubs.unshift('Putter');
    return `<div class="chips gm-clubs" role="group" aria-label="Club">${clubs.map((c) => {
      const p = gm.pools[c];
      return `<button type="button" class="chip" data-action="gm-club" data-club="${esc(c)}" aria-pressed="${c === gm.club}">${esc(c)}${p ? `<span class="cd">${Math.round(p.full)}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }
  // The shot to hit: the ones that make sense from here, the suggested one and why, and
  // what the one picked does.
  function gmShotChips() {
    const sg = gmShotSugg(), types = gm.shotTypes || [], cur = gmShotType();
    if (types.length < 2) return '';
    const why = sg && sg.type === cur && sg.why ? `Suggested: ${sg.why}. ` : '';
    return `<div class="gm-label"><span>Shot</span>${sg && sg.why ? `<span class="sg">Suggested: ${esc(GM.SHOTS[sg.type].name.toLowerCase())}</span>` : ''}</div>
      <div class="chips gm-shots" role="group" aria-label="Shot">${types.map((ty) => `<button type="button" class="chip" data-action="gm-shot" data-type="${ty}" aria-pressed="${ty === cur}">${esc(GM.SHOTS[ty].name)}</button>`).join('')}</div>
      <p class="hint gm-shot-say">${esc(why + GM.shotSay(cur, gmHand()))}</p>`;
  }
  function gmMeterHtml(kind) {
    return `<div class="gm-meter" id="gmMeter" role="button" tabindex="0" data-kind="${kind}">
      <div class="gm-track" aria-hidden="true"><span class="gm-zone"></span><span class="gm-line"></span><span class="gm-target"></span><span class="gm-fill"></span><span class="gm-needle"></span></div>
      <div class="gm-ticks" aria-hidden="true">${kind === 'putt' ? '<span class="l">Short</span><span class="r">Long</span>'
        : `<span class="c" style="left:${gmPct('swing', 0)}%">Line</span><span class="r">${GM.ownStroke(gmShotType()) ? 'Full chip' : 'Full swing'}</span>`}</div>
      <p class="gm-meter-text"></p>
    </div>`;
  }
  function gmLiveHtml() {
    const lie = gmLie(), f = GM.LIE[lie], dir = ui.game.dir;
    const lieNote = f && f.dist < 1 ? ` From the ${lie === 'trees' ? 'trees it’s a low punch, about 40%' : lie === 'bunker' ? 'sand it goes about 20%' : 'rough it goes about 10%'} shorter than on the range.` : '';
    return `<div class="gm-live">
      <p class="hint">Hit your ${esc(C.clubName(gm.club, data.clubs).toLowerCase())} at the range, then type in what the screen shows.${lieNote}</p>
      <div class="grid2">
        <div class="field"><label for="gmCarry">Carry (yds)</label><input id="gmCarry" type="number" inputmode="decimal" min="1"></div>
        <div class="field"><label for="gmTotal">Total (yds)</label><input id="gmTotal" type="number" inputmode="decimal" placeholder="if shown"></div>
      </div>
      <div class="field"><label for="gmOff">Offline (ft)</label><input id="gmOff" type="number" inputmode="decimal" placeholder="0 if straight"></div>
      <div class="seg" role="group" aria-label="Offline direction">
        <button type="button" data-action="gm-dir" data-dir="L" aria-pressed="${dir === 'L'}">◀ Left</button>
        <button type="button" data-action="gm-dir" data-dir="R" aria-pressed="${dir === 'R'}">Right ▶</button>
      </div>
      <button type="button" class="btn block" data-action="gm-live">Play this shot</button>
    </div>`;
  }
  // The controls: where the shot is hit (the swing pad, the meter or the range form)
  // right under the map, then the message about the last shot, then the clubs, the aim
  // and the way to play.
  function gmControls() {
    const hit = $('.gm-hit', gm.box), box = $('.gm-controls', gm.box);
    if (!box || !hit) return;
    $('.gm-status', gm.box).textContent = gmStatusText();
    if (gm.pad && gm.pad.raf) cancelAnimationFrame(gm.pad.raf);
    gm.meter = null;
    gm.meterEl = null;
    gm.pad = null;
    if (gm.phase === 'holed') {
      const card = gm.card, r = gm.round, t = GM.totals(r), nxt = r.cards[r.idx + 1];
      const name = card.picked ? 'Picked up' : GM.scoreName(card.score, card.par);
      hit.innerHTML = '';
      box.innerHTML = `<div class="gm-done"><span class="big">${esc(name)}</span>
        <span class="s">${card.picked ? `Double par: ${card.score}` : plural(card.score, 'stroke')} on hole ${card.n} · ${GM.toParText(t.toPar)} after ${plural(t.played, 'hole')}</span>
        ${gmSwingSummary(card.shots, 'this hole')}
        <button type="button" class="btn block" data-action="gm-next">${nxt ? `Next: hole ${nxt.n}` : 'See your round'}</button></div>`;
      $('[data-action="gm-pickup"]', gm.box).disabled = true;
      return;
    }
    $('[data-action="gm-pickup"]', gm.box).disabled = false;
    const real = gm.round.mode === 'swing', noPools = !Object.keys(gm.pools).length;
    const modes = `<div class="seg gm-modes" role="group" aria-label="How to play the shot">${GM_MODES.map(([v, l]) =>
      `<button type="button" data-action="gm-mode" data-v="${v}" aria-pressed="${gm.round.mode === v}"${v !== 'live' && noPools ? ' disabled' : ''}>${l}</button>`).join('')}</div>`;
    if (gm.phase === 'putt') {
      const ft = GM.dist(gm.ball, gm.pin) * 3;
      const chips = gmLie() === 'fringe' ? `<div class="gm-label"><span>Club</span><span class="sg">Putt it, or chip with a club</span></div>${gmClubChips()}` : '';
      hit.innerHTML = ft <= GM.TAP_IN
        ? `<div class="gm-label"><span>Putter · ${gmFtText(ft)}</span></div><button type="button" class="btn block" data-action="gm-tapin">Tap it in</button>`
        : real ? `<div class="gm-label"><span>Putter · ${gmFtText(ft)}</span></div>${gmPadHtml('putt')}`
          : `<div class="gm-label"><span>Putter · ${gmFtText(ft)}</span><span class="sg">Stop on the yellow line</span></div>${gmMeterHtml('putt')}`;
      box.innerHTML = chips + modes;
      if (ft > GM.TAP_IN) { if (real) gmPadSetup('putt'); else gmMeterSetup('putt'); }
      return;
    }
    const sugg = gm.suggClub || gmSuggest();
    hit.innerHTML = gm.round.mode === 'live' ? gmLiveHtml() : real ? gmPadHtml('swing') : gmMeterHtml('swing');
    box.innerHTML = `<div class="gm-label"><span>Club</span>${sugg ? `<span class="sg">Suggested: ${esc(C.clubName(sugg, data.clubs).toLowerCase())}</span>` : ''}</div>
      ${gmClubChips()}
      ${gmShotChips()}
      <div class="gm-aimrow">
        <button type="button" class="btn small ghost" data-action="gm-nudge" data-d="-1" aria-label="Aim a little left">◀</button>
        <p class="gm-aimtext" aria-live="polite"></p>
        <button type="button" class="btn small ghost" data-action="gm-nudge" data-d="1" aria-label="Aim a little right">▶</button>
      </div>
      ${modes}`;
    if (real) gmPadSetup('swing'); else if (gm.round.mode !== 'live') gmMeterSetup('swing');
    gmAimText();
  }
  // A swing (or a putt) that's under way: nothing else changes until it's hit.
  function gmSwinging() { return !!gm && ((gm.meter && gm.meter.phase !== 'ready') || (gm.pad && gm.pad.phase === 'swing') || (!!gmMo && gmMo.phase === 'swing')); }
  function gmAimText() {
    const el = $('.gm-aimtext', gm.box);
    if (!el) return;
    const aim = gmAimPoint(), d = GM.dist(gm.ball, aim), pool = gm.pools[gm.club], allow = !gm.aim && gm.autoAllow ? gm.autoAllow : 0;
    const atPin = GM.dist(allow ? gm.autoTarget : aim, gm.pin) < 1.5, rise = gmRise(aim), plays = gmPlays(aim);
    // The climb to the spot, when it's worth a club's thought: "plays 163, 21 ft uphill".
    const climb = Math.abs(rise) >= 1.5 ? `plays ${Math.round(plays)}, ${Math.round(Math.abs(rise) * 3)} ft ${rise > 0 ? 'uphill' : 'downhill'}` : '';
    let sub = '';
    if (gm.round.mode === 'live') sub = pool ? `A good ${C.clubName(gm.club, data.clubs).toLowerCase()} goes about ${Math.round(pool.full)}` : 'Tap the map to aim';
    else if (pool) {
      const type = gmShotType(), sc = GM.strokeScale(type, pool), p = GM.strokeFor(pool, plays, gmLie(), type), full = gmReach(gm.club) * (type === 'normal' ? 1 : GM.shotReach(type, pool.carry, pool.full - pool.carry, gm.club)) * sc;
      const what = GM.ownStroke(type) ? GM.SHOTS[type].name.toLowerCase() + ' stroke' : 'swing';
      // Out of reach only when it's the pin or a spot he picked: the spot the game picks is
      // within a normal full swing, and a shot that goes shorter (a fade, a high one) just
      // comes up a little short of it.
      sub = plays > full + 2 && (gm.aim || atPin) ? `Out of reach: a full ${what} goes about ${Math.round(full)}` : p >= 0.97 ? `A full ${what}` : `About a ${Math.round(p * 100)}% ${what}`;
      if (allow) sub += ` · ${gmYds(Math.abs(allow))} ${allow > 0 ? 'left' : 'right'} for your ${gm.autoShape.shape.toLowerCase()}`;
    }
    el.innerHTML = `Aiming ${gmYds(d)}${atPin ? ' at the pin' : ''}${climb ? `<span class="s">${esc(climb)}</span>` : ''}<span class="s">${esc(sub)}</span>`;
    if (gm.meter && gm.meter.kind === 'swing' && gm.meter.phase === 'ready') gmMeterSetup('swing');
    if (gm.pad && gm.pad.kind === 'swing' && gm.pad.phase !== 'swing') { gm.pad.target = gmPadTarget('swing'); gmPadDraw(); }
  }
  function gmMsg(title, line, sub, kind) {
    const el = $('.gm-msg', gm.box);
    if (!el) return;
    el.className = 'gm-msg' + (kind ? ' ' + kind : '');
    el.innerHTML = `<span class="t">${esc(title)}</span>${line ? `<span>${esc(line)}</span>` : ''}${sub ? `<span class="s">${esc(sub)}</span>` : ''}`;
    el.hidden = false;
  }
  // The same with a swing report (already made safe) under it.
  function gmMsgHtml(title, line, html, kind) {
    const el = $('.gm-msg', gm.box);
    if (!el) return;
    el.className = 'gm-msg' + (kind ? ' ' + kind : '');
    el.innerHTML = `<span class="t">${esc(title)}</span>${line ? `<span>${esc(line)}</span>` : ''}${html || ''}`;
    el.hidden = false;
  }

  // ----- The meters -----
  function gmSwingCfg() { return gm.round.easy ? GM.METER.easy : GM.METER.normal; }
  function gmPuttCfg() { return gm.round.easy ? GM.PUTT.easy : GM.PUTT.normal; }
  function gmPct(kind, pos) { return kind === 'putt' ? gmClamp(pos / GM_PUTT_END, 0, 1) * 100 : gmClamp((pos - GM_POS0) / (1 - GM_POS0), 0, 1) * 100; }
  function gmMeterSetup(kind) {
    const el = $('#gmMeter', gm.box);
    if (!el) return;
    const old = gm.meter && gm.meter.kind === kind && gm.meter.phase !== 'ready' ? gm.meter : null;
    const m = old || { kind, phase: 'ready', t0: 0, t1: 0, power: 0, raf: 0 };
    if (kind === 'swing') {
      const cfg = gmSwingCfg(), pool = gm.pools[gm.club];
      m.target = pool ? GM.strokeFor(pool, gmPlays(gmAimPoint()), gmLie(), gmShotType()) : 1;
      m.win = cfg.win;
      if (m.phase === 'ready') m.backT = GM.meterBackTime(m.target, gm.round.easy);
      const z0 = gmPct('swing', -cfg.win), z1 = gmPct('swing', cfg.win);
      $('.gm-zone', el).style.left = z0 + '%';
      $('.gm-zone', el).style.width = (z1 - z0) + '%';
      $('.gm-line', el).style.left = gmPct('swing', 0) + '%';
      $('.gm-target', el).style.left = gmPct('swing', m.target) + '%';
      $('.gm-target', el).hidden = m.target >= 0.97;
    } else {
      const cfg = gmPuttCfg(), ft = GM.dist(gm.ball, gm.pin) * 3;
      m.target = GM.puttTarget(ft);
      m.win = cfg.win;
      if (m.phase === 'ready') m.sweep = GM.puttSweep(m.target, gm.round.easy);
      const z0 = gmPct('putt', m.target - cfg.win), z1 = gmPct('putt', m.target + cfg.win);
      $('.gm-zone', el).style.left = z0 + '%';
      $('.gm-zone', el).style.width = (z1 - z0) + '%';
      $('.gm-line', el).style.left = gmPct('putt', m.target) + '%';
      $('.gm-target', el).hidden = true;
    }
    gm.meter = m;
    gm.meterEl = el;
    if (!el.dataset.bound) {
      el.dataset.bound = '1';
      el.addEventListener('pointerdown', (e) => { if (e.button > 0) return; e.preventDefault(); gmTap(e.timeStamp); });
      el.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); gmTap(); } });
    }
    gmMeterPaint(m.phase === 'ready' ? 0 : m.power);
    gmMeterText();
  }
  function gmMeterText(word) {
    const m = gm.meter, el = gm.meterEl;
    if (!m || !el) return;
    if (word) m.word = word;
    const txt = (m.phase === 'done' && m.word) || (m.kind === 'putt' ? (m.phase === 'run' ? 'Tap on the yellow line!' : 'Tap to start the putt')
      : m.phase === 'back' ? 'Tap to set the power' + (m.target < 0.97 ? ' (the white line)' : '') : m.phase === 'down' ? 'Tap on the yellow line!' : 'Tap to start your swing');
    $('.gm-meter-text', el).textContent = txt;
    el.setAttribute('aria-label', `${m.kind === 'putt' ? 'Putting' : 'Swing'} meter. ${txt}`);
    el.classList.toggle('off', !!gm.busy || m.phase === 'done');
  }
  function gmMeterPaint(pos) {
    const m = gm.meter, el = gm.meterEl;
    if (!m || !el) return;
    $('.gm-needle', el).style.left = gmPct(m.kind, pos) + '%';
    const fill = $('.gm-fill', el);
    if (m.kind === 'swing') {
      const a = gmPct('swing', 0), top = m.phase === 'down' || m.phase === 'done' ? m.power : Math.max(0, pos);
      fill.style.left = a + '%';
      fill.style.width = Math.max(0, gmPct('swing', top) - a) + '%';
    } else {
      fill.style.left = '0%';
      fill.style.width = gmPct('putt', Math.max(0, pos)) + '%';
    }
  }
  // The downswing comes back a little slower after a short backswing, so a chip can
  // still be timed (GolfGame.meterDownSpeed).
  function gmDownSpeed(m) { return GM.meterDownSpeed(m.power, gm.round.easy); }
  function gmBackT(m) { return m.backT || gmSwingCfg().back; }
  function gmSweep(m) { return m.sweep || gmPuttCfg().sweep; }
  function gmMeterLoop() {
    const m = gm && gm.meter;
    if (!m) return;
    m.raf = 0;
    const now = performance.now();
    if (m.kind === 'swing') {
      const cfg = gmSwingCfg();
      if (m.phase === 'back') {
        const pos = (now - m.t0) / 1000 / gmBackT(m);
        if (pos >= 1) { Object.assign(m, { power: 1, phase: 'down', t1: m.t0 + gmBackT(m) * 1000 }); gmMeterText(); } else gmMeterPaint(pos);
      }
      if (m.phase === 'down') {
        const pos = m.power - (now - m.t1) / 1000 * gmDownSpeed(m);
        if (pos <= cfg.end) { gmMeterPaint(cfg.end); gmSwingDone(cfg.end); return; }
        gmMeterPaint(pos);
      }
    } else if (m.phase === 'run') {
      const pos = (now - m.t0) / 1000 / gmSweep(m);
      if (pos >= GM_PUTT_END) { gmMeterPaint(GM_PUTT_END); gmPuttDone(GM_PUTT_END); return; }
      gmMeterPaint(pos);
    }
    if (m.phase === 'back' || m.phase === 'down' || m.phase === 'run') m.raf = requestAnimationFrame(gmMeterLoop);
  }
  // A tap on the meter, timed by the tap itself rather than the last frame drawn.
  function gmTap(ts) {
    if (!gm || gm.busy || !gm.meter) return;
    const m = gm.meter, pn = performance.now(), now = typeof ts === 'number' && ts > pn - 1000 && ts <= pn + 5 ? ts : pn;
    if (m.kind === 'swing') {
      if (!gm.pools[gm.club]) { toast('No range shots with this club yet. Play it from the range.'); return; }
      if (m.phase === 'ready') { Object.assign(m, { phase: 'back', t0: now }); gmMeterText(); m.raf = m.raf || requestAnimationFrame(gmMeterLoop); }
      else if (m.phase === 'back') { Object.assign(m, { power: gmClamp((now - m.t0) / 1000 / gmBackT(m), 0.03, 1), phase: 'down', t1: now }); gmMeterText(); }
      else if (m.phase === 'down') { const pos = m.power - (now - m.t1) / 1000 * gmDownSpeed(m); gmMeterPaint(pos); gmSwingDone(pos); }
    } else if (m.phase === 'ready') { Object.assign(m, { phase: 'run', t0: now }); gmMeterText(); m.raf = m.raf || requestAnimationFrame(gmMeterLoop); }
    else if (m.phase === 'run') { const pos = (now - m.t0) / 1000 / gmSweep(m); gmMeterPaint(pos); gmPuttDone(pos); }
  }
  function gmMeterStop() {
    const m = gm.meter;
    if (m && m.raf) cancelAnimationFrame(m.raf);
    if (m) Object.assign(m, { raf: 0, phase: 'done' });
  }
  // A swing (or a putt) that's under way stops if the page goes to the background.
  function gmMeterReset() {
    if (gm && gm.pad && gm.pad.phase === 'swing') gmPadCancel();
    if (!gm || !gm.meter || gm.busy) return;
    if (gm.meter.raf) cancelAnimationFrame(gm.meter.raf);
    gm.meter = null;
    gmMeterSetup(gm.phase === 'putt' ? 'putt' : 'swing');
  }
  function gmRnd() { return FL.rng((Math.random() * 4294967296) >>> 0); }

  // ----- The swing pad: a real swing -----
  // The ball seen from above, with the target straight up the dashed line. He puts a
  // thumb on it, drags down for the backswing (the marks show a quarter, half, three
  // quarters and full; red past full) and swipes up through the ball. His finger leaves
  // a trail, white going back and gold coming through, and once he turns at the top a
  // gold ring rises to the ball at the pace of a perfect tempo, so he can see if he beat
  // it (quick) or lagged it (slow). GolfGame.readSwing reads the swipe when it's a little
  // past the ball. The trail stays, with its tempo, until his next swing. For a putt the
  // marks are how far it rolls, and the gold line is this putt.
  const GM_PAD = { h: 214, y0: 54, full: 120, ball: 30, follow: 26, after: 0.12, topGap: 6, maxT: 8 };
  const GM_PUTT_TICKS = [10, 20, 30, 45];
  const GM_PAD_FONT = "'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
  function gmPadHtml(kind) {
    const putt = kind === 'putt', mo = gmMo && gmMo.on;
    const label = mo ? (putt ? 'Putting with the phone: hold still, then make your stroke' : 'Swinging the phone: hold still, then swing')
      : putt ? 'Putting pad: drag down from the ball for the backstroke, then stroke up through it' : 'Swing pad: drag down from the ball for the backswing, then swipe up through it';
    return `<div class="gm-pad${mo ? ' mo' : ''}" id="gmPad" data-kind="${kind}" tabindex="0" role="group" aria-label="${label}">
      <canvas class="gm-pad-c" aria-hidden="true"></canvas>
      <div class="gm-pad-row"><p class="gm-pad-text" aria-live="polite"></p>
        <button type="button" class="gm-practice" data-action="gm-practice" aria-pressed="${!!ui.game.practice}" aria-label="${putt ? 'Practice stroke: one that doesn’t count' : 'Practice swing: one that doesn’t count'}">Practice</button></div>
      ${gmMotionHtml(kind)}
    </div>`;
  }
  // ----- Swinging the phone -----
  // He holds the phone like a grip, the screen facing the target like the clubface, and
  // swings it (GolfGame.readMotion reads its gyroscope). It's offered on phones and
  // tablets, after a word on safety, and he can go back to the pad any time. The state
  // lives here, not on the round, so it carries on from shot to shot and hole to hole.
  let gmMo = null;
  function gmMotionAvail() {
    return typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined'
      && ((navigator.maxTouchPoints || 0) > 0 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
  }
  // Before every shot with the phone, a ready check: his grip and the screen, the space round
  // him, a smooth swing. Its "I'm ready" starts watching for the swing (the first time, the
  // fuller check also asks the phone for its motion), so it's one tap a shot. While it's
  // watching, Cancel stops it; after the shot, a miss or a cancel, the check comes back.
  function gmMotionHtml(kind) {
    if (!gmMotionAvail()) return '';
    const putt = kind === 'putt', first = !!(gmMo && gmMo.ask);
    if (first || (gmMo && gmMo.on && !gmMotionArmed())) {
      const items = first
        ? ['Hold it in both hands like the grip of a club, the screen facing the target like the clubface, and hold on tight. A case with a wrist strap helps.',
          'Make sure no one is near you and there’s nothing you could hit.',
          'Swing smoothly, not hard. It reads how far back you go, your tempo and where the screen faces at impact, not your speed: a half-speed swing is plenty.']
        : ['Both hands on it, the screen to the target, holding tight', 'No one near you, nothing you could hit', putt ? 'A smooth stroke' : 'Smooth, not hard'];
      const title = first ? 'Before you swing the phone' : putt ? 'Before you putt' : 'Before you swing';
      return `<div class="gm-mo" id="gmMo"><div class="gm-mo-ask${first ? '' : ' each'}" role="group" aria-label="${title}">
        <p class="t">${title}</p>
        <ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>
        <div class="gm-mo-btns"><button type="button" class="gm-practice on gm-mo-arm" data-action="${first ? 'gm-motion-go' : 'gm-motion-arm'}">I’m ready</button>
          <button type="button" class="gm-practice" data-action="${first ? 'gm-motion-no' : 'gm-motion'}">${first ? 'Not now' : 'Use the pad'}</button></div>
      </div></div>`;
    }
    return gmMo && gmMo.on
      ? `<div class="gm-mo" id="gmMo"><div class="gm-mo-row"><button type="button" class="gm-practice on gm-mo-arm" data-action="gm-motion-arm" aria-pressed="true">Cancel</button>
          <button type="button" class="gm-practice" data-action="gm-motion">Use the pad</button></div></div>`
      : '<div class="gm-mo" id="gmMo"><div class="gm-mo-row"><p class="gm-mo-safe">Or hold your phone like a club and swing it.</p><button type="button" class="gm-practice" data-action="gm-motion">Swing the phone</button></div></div>';
  }
  // Nothing he does with the phone counts until he's set up and taps I'm ready on the ready
  // check: then it lets him get set (GM_MO.set s, turning the screen to the target and
  // taking his grip), waits for him to keep still, and beeps (and buzzes, where the phone
  // can) for him to swing, as he can't see the screen at address. One swing a tap: after
  // it, a miss, or GM_MO.timeout s without a swing, the ready check comes back.
  const GM_MO = { set: 1.5, timeout: 30 };
  function gmMotionArmed() { return !!gmMo && gmMo.on && /^(set|wait|ready|swing)$/.test(gmMo.phase || ''); }
  // The ready check, or Cancel while it's watching, drawn again under the pad.
  function gmMotionButtons() {
    const p = gm && gm.pad, box = p && $('#gmMo', p.el);
    if (!box) return;
    const had = box.contains(document.activeElement), tmp = document.createElement('div');
    tmp.innerHTML = gmMotionHtml(p.kind);
    if (!tmp.firstElementChild) return;
    box.replaceWith(tmp.firstElementChild);
    if (had) { const b = $('#gmMo .gm-mo-arm', p.el); if (b) b.focus({ preventScroll: true }); }
  }
  // He's ready: watch for the swing (get set, keep still, the beep, then the swing).
  function gmMotionArm() {
    if (!gm || gm.busy || !gmMo || !gmMo.on) return;
    if (gm.pad && gm.pad.kind === 'swing' && !gm.pools[gm.club]) { toast('No range shots with this club yet. Play it from the range.'); return; }
    gmBeepInit();
    Object.assign(gmMo, { phase: 'set', setUntil: null, armedAt: null, buf: [], samples: [], stillSince: null, movingSince: null, word: '', miss: '' });
    gmMotionButtons();
    gmMotionText();
    gmPadDraw();
  }
  // Back to waiting for a tap on Ready, saying why if there's a reason.
  function gmMotionIdle(miss) {
    if (!gmMo) return;
    Object.assign(gmMo, { phase: 'idle', buf: [], samples: [], stillSince: null, movingSince: null, setUntil: null, armedAt: null, theta: 0, miss: miss || '' });
    gmMotionButtons();
    gmMotionText();
    gmPadDraw();
  }
  // The beep that says "swing", made with the tap on Ready (a page can only start sound
  // from a tap).
  let gmAudio = null;
  function gmBeepInit() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      gmAudio = gmAudio || new AC();
      if (gmAudio.state === 'suspended') gmAudio.resume();
    } catch (err) { gmAudio = null; }
  }
  function gmBeep() {
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (err) { /* no vibration here */ }
    if (!gmAudio) return;
    try {
      const t0 = gmAudio.currentTime, o = gmAudio.createOscillator(), g = gmAudio.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.connect(g);
      g.connect(gmAudio.destination);
      o.start(t0);
      o.stop(t0 + 0.18);
    } catch (err) { /* no sound here */ }
  }
  const GM_MO_WHY = {
    noThrough: 'Swing back down through the ball to hit it.',
    noBack: 'Take the phone back further, then swing through.',
    still: 'Hold still, then swing.',
    tooFast: 'Too quick for the phone to follow: swing a little gentler.',
    long: 'That took too long.',
    idle: 'No swing for a while, so it stopped watching.'
  };
  // Asking for the motion has to happen right in the tap (iPhones ask the player first).
  // arm: he's just said he's ready, so start watching for the swing straight away.
  function gmMotionStart(arm) {
    const go = () => {
      gmMo = { on: true, phase: 'idle', buf: [], samples: [], stillSince: null, theta: 0, got: false, word: '' };
      window.addEventListener('devicemotion', gmMotionEvent);
      setTimeout(() => {
        if (gmMo && gmMo.on && !gmMo.got) { gmMotionStop(); toast('This phone isn’t sharing its motion with the page. Swipe on the pad instead.'); }
      }, 2000);
      if (gm) gmControls();
      if (arm) gmMotionArm();
    };
    const DM = window.DeviceMotionEvent;
    if (DM && typeof DM.requestPermission === 'function') {
      DM.requestPermission().then((r) => {
        if (r === 'granted') go();
        else { gmMo = null; if (gm) gmControls(); toast('Motion wasn’t allowed. To swing the phone, allow motion for this site in the browser’s settings (on an iPhone, Motion & Orientation Access), then try again.'); }
      }).catch(() => { gmMo = null; if (gm) gmControls(); toast('The phone wouldn’t share its motion. Swipe on the pad instead.'); });
    } else go();
  }
  function gmMotionStop() {
    window.removeEventListener('devicemotion', gmMotionEvent);
    gmMo = null;
    if (gm) gmControls();
  }
  function gmMotionText(word) {
    const p = gm && gm.pad;
    if (!p || !gmMo || !gmMo.on) return;
    if (word != null) gmMo.word = word;
    const putt = p.kind === 'putt', cue = GM.motionCue(Math.min(1, p.target), putt), ph = gmMo.phase, go = 'I’m ready';
    const txt = ph === 'swing' ? '…'
      : ph === 'set' ? 'Get set: grip it, the screen facing the target, then keep still.'
        : ph === 'wait' ? 'Keep still…'
          : ph === 'ready' ? `${putt ? 'Putt' : 'Swing'}! This one wants ${cue}.`
            : gmMo.word ? gmMo.word
              : gmMo.miss ? `${gmMo.miss} Set up again, then tap ${go}.`
                : `${ui.game.practice ? (putt ? 'Practice stroke. ' : 'Practice swing. ') : ''}This one wants ${cue}. Set up to the ball, then tap ${go}.`;
    const t = $('.gm-pad-text', p.el);
    if (t && t.textContent !== txt) t.textContent = txt;
    p.el.classList.toggle('off', !!gm.busy);
  }
  function gmMotionEvent(e) {
    const mo = gmMo;
    if (!mo || !mo.on) { window.removeEventListener('devicemotion', gmMotionEvent); return; }
    const r = e.rotationRate;
    if (!r || r.alpha == null || r.beta == null || r.gamma == null) return;
    mo.got = true;
    if (mo.phase === 'idle') return;  // not set up yet: nothing he does counts
    const p = gm && gm.pad, t = e.timeStamp / 1000;
    if (!p || gm.busy || (gm.phase !== 'aim' && gm.phase !== 'putt') || (p.kind === 'swing' && !gm.pools[gm.club])) { gmMotionIdle(''); return; }
    // Just tapped Ready: let him get set, then wait for him to keep still.
    if (mo.phase === 'set') {
      if (mo.setUntil == null) Object.assign(mo, { setUntil: t + GM_MO.set, armedAt: t });
      if (t < mo.setUntil) return;
      Object.assign(mo, { phase: 'wait', stillSince: null, buf: [] });
      gmMotionText();
      gmPadDraw();
    }
    if (mo.phase !== 'swing' && t - mo.armedAt > GM_MO.timeout) { gmMotionIdle(GM_MO_WHY.idle); return; }
    const g = e.accelerationIncludingGravity, smp = { t, w: [r.beta, r.gamma, r.alpha] };
    if (g && g.x != null) smp.g = [g.x, g.y, g.z];
    const putt = p.kind === 'putt', rate = Math.hypot(r.alpha, r.beta, r.gamma), M = GM.MOTION;
    const still = putt ? M.stillPutt : M.still, start = putt ? M.startPutt : M.start;
    if (mo.phase === 'wait' || mo.phase === 'ready') {
      mo.buf.push(smp);
      while (mo.buf.length > 2 && t - mo.buf[0].t > 0.5) mo.buf.shift();
      if (mo.phase === 'ready') {
        // Ready: a turn past `start` is the swing (the slow first inches of the takeaway
        // are kept, from the buffer); stirring that never gets there is only fidgeting,
        // and after half a second of it he has to settle again.
        if (rate > start) {
          Object.assign(mo, { phase: 'swing', samples: mo.buf.slice(), began: t, word: '', miss: '', movingSince: null });
          gm.lastSwing = null;
          gmMotionText();
          return;
        }
        if (rate < still) mo.movingSince = null;
        else if (mo.movingSince == null) mo.movingSince = t;
        else if (t - mo.movingSince > 0.5) { Object.assign(mo, { phase: 'wait', stillSince: null, movingSince: null }); gmMotionText(); gmPadDraw(); }
        return;
      }
      if (rate < still) { if (mo.stillSince == null) mo.stillSince = t; } else mo.stillSince = null;
      if (mo.stillSince != null && t - mo.stillSince >= 0.5) { mo.phase = 'ready'; gmBeep(); gmMotionText(''); gmPadDraw(); }
      return;
    }
    if (mo.phase !== 'swing') return;
    mo.samples.push(smp);
    const sw = GM.readMotion(mo.samples, { putt, hand: gmHand() });
    mo.theta = sw.theta || 0;
    if (!mo.drawing) { mo.drawing = true; requestAnimationFrame(() => { if (gmMo) { gmMo.drawing = false; gmPadDraw(); } }); }
    if (sw.ok && t - sw.tImpact >= 0.25) { gmMotionFinish(sw); return; }
    if (!sw.ok && (sw.why === 'tooFast' || t - mo.began > GM_PAD.maxT)) gmMotionMiss(sw.why === 'tooFast' ? 'tooFast' : 'long');
    // Stopped again without coming through: not a swing.
    else if (!sw.ok && rate < still && t - mo.began > 0.6) {
      const quiet = mo.samples.slice(-8).every((q) => Math.hypot(q.w[0], q.w[1], q.w[2]) < still);
      if (quiet) gmMotionMiss(sw.why === 'noThrough' ? 'noThrough' : 'noBack');
    }
  }
  // A swing that couldn't be read: what went wrong, said until he taps Ready again.
  function gmMotionMiss(why) {
    gmMo.word = '';
    gmMotionIdle(GM_MO_WHY[why] || GM_MO_WHY.still);
  }
  function gmMotionFinish(sw) {
    const p = gm.pad, putt = p.kind === 'putt';
    Object.assign(gmMo, { phase: 'idle', buf: [], samples: [], stillSince: null, setUntil: null, armedAt: null, word: '', miss: '' });
    gmMotionButtons();
    p.last = gm.lastSwing = { samples: null, sw, kind: p.kind, word: '', motion: true, theta: sw.turn };
    ui.game.shown = true;
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* no vibration here */ }
    if (ui.game.practice) { gmPractice(sw); return; }
    if (putt) gmRealPutt(sw); else gmRealSwing(sw);
  }
  // The dial: the swing seen from in front, the ball at the bottom and the club going back
  // round (clockwise for a right-hander), with quarters, full and past full, a gold line
  // for this shot, and the club where the phone is (or where the last swing turned).
  function gmMotionDraw(p) {
    const c = p.ctx, w = p.w, h = p.h, putt = p.kind === 'putt', M = GM.MOTION, full = putt ? M.puttFull : M.full;
    const cx = w / 2, cy = 98, R = 68, dir = gmHand() === 'L' ? -1 : 1;
    // a turn of th (° of the phone) to a point on the dial: 240° of dial is a full one
    const at = (th, r) => { const a = (th * 240 / full) * Math.PI / 180; return [cx - dir * Math.sin(a) * r, cy + Math.cos(a) * r]; };
    c.clearRect(0, 0, w, h);
    c.lineCap = 'round';
    c.textBaseline = 'middle';
    c.font = '650 15px ' + GM_PAD_FONT;
    // the arc of the backswing, and past full in red
    const arc = (a0, a1, col, lw) => { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); for (let k = 0; k <= 40; k++) { const q = at(a0 + (a1 - a0) * k / 40, R); if (k) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); } c.stroke(); };
    arc(0, full, 'rgba(255,255,255,0.28)', 6);
    arc(full * 1.02, full * 1.3, 'rgba(232,70,58,0.5)', 6);
    const marks = putt ? GM_PUTT_TICKS.map((ft) => [gmPuttTickDepth(ft), ft + ' ft']) : [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, 'Full']];
    c.fillStyle = 'rgba(255,255,255,0.88)';
    marks.forEach(([d, label]) => {
      if (d > 1.3) return;
      const a = at(d * full, R - 8), b = at(d * full, R + 8), q = at(d * full, R + 21);
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      c.textAlign = 'center'; c.fillText(label, q[0], q[1]);
    });
    // the ball, the target line for this shot, and the club
    c.fillStyle = '#ffffff';
    const ball = at(0, R + 4);
    c.beginPath(); c.arc(ball[0], ball[1], 6, 0, Math.PI * 2); c.fill();
    const tg = at(Math.min(1.3, p.target) * full, R + 10);
    c.setLineDash([7, 5]); c.strokeStyle = '#f2c94c'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(tg[0], tg[1]); c.stroke(); c.setLineDash([]);
    const mo = gmMo, live = mo && mo.phase === 'swing', last = gm.lastSwing && gm.lastSwing.motion && gm.lastSwing.kind === p.kind ? gm.lastSwing : null;
    const th = live ? Math.max(-full * 0.6, mo.theta) : last ? last.theta : 0, head = at(th, R - 6);
    c.strokeStyle = live || !last ? '#ffffff' : 'rgba(255,255,255,0.6)'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(head[0], head[1]); c.stroke();
    c.fillStyle = c.strokeStyle; c.beginPath(); c.arc(cx, cy, 6, 0, Math.PI * 2); c.fill();
    if (last && !live && last.sw) {
      c.textAlign = 'center'; c.fillStyle = gmTempoColor(last.sw.tempo);
      c.fillText(`${GM.ratioText(last.sw.ratio)} · back ${Math.round(last.sw.depth * 100)}%`, cx, h - 14);
    }
    const word = mo && !live ? { set: 'Get set…', wait: 'Keep still…', ready: putt ? 'Putt!' : 'Swing!' }[mo.phase] : '';
    if (word) { c.textAlign = 'center'; c.fillStyle = mo.phase === 'ready' ? '#b9f2c9' : '#f2c94c'; c.clearRect(0, h - 28, w, 28); c.fillText(word, cx, h - 14); }
  }
  // How far back to drag for this shot: the swing it needs, or for a putt the backstroke
  // that rolls it a foot past.
  function gmPadTarget(kind) {
    if (kind === 'putt') return gmClamp(GM.puttDepth(GM.dist(gm.ball, gm.pin) * 3, gm.round.easy), 0.05, 1.25);
    const pool = gm.pools[gm.club];
    return pool ? GM.strokeFor(pool, gmPlays(gmAimPoint()), gmLie(), gmShotType()) : 1;
  }
  function gmPuttTickDepth(ft) { const c = GM.PUTT_SWING.normal; return Math.pow(ft / c.full, 1 / c.exp); }
  function gmPadSetup(kind) {
    const el = $('#gmPad', gm.box);
    if (gm.pad && gm.pad.raf) cancelAnimationFrame(gm.pad.raf);
    if (!el) return;
    const cv = $('.gm-pad-c', el), w = Math.max(200, Math.floor(cv.getBoundingClientRect().width || el.getBoundingClientRect().width)), h = GM_PAD.h;
    const dpr = Math.min(2, window.devicePixelRatio || 1), ctx = cv.getContext ? cv.getContext('2d') : null;
    if (!ctx) return;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const last = gm.lastSwing && gm.lastSwing.kind === kind ? gm.lastSwing : null;
    gm.pad = { kind, el, cv, ctx, w, h, x0: Math.round(w / 2), y0: GM_PAD.y0, full: GM_PAD.full, phase: 'ready', samples: [], raf: 0, target: gmPadTarget(kind), word: last ? last.word : '', last };
    // Until his first swing, the pad shows how: a thumb going back and through at the
    // tempo it wants, three times (not when the phone asks for less motion).
    const pad = gm.pad;
    if (!REDUCED && !ui.game.shown && !last && !(gmMo && gmMo.on)) { pad.demo = { t0: performance.now(), y: null }; pad.raf = requestAnimationFrame((ts) => gmPadDemo(ts, pad)); }
    if (!el.dataset.bound) {
      el.dataset.bound = '1';
      cv.addEventListener('pointerdown', gmPadDown);
      cv.addEventListener('pointermove', gmPadMove);
      cv.addEventListener('pointerup', gmPadUp);
      cv.addEventListener('pointercancel', gmPadCancel);
      el.addEventListener('keydown', (e) => {
        if (e.target === el && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toast('The swing pad needs a finger or a mouse. To play with the keys, choose Swing meter.'); }
      });
    }
    gmPadText();
    gmPadDraw();
  }
  function gmPadText(word) {
    const p = gm && gm.pad;
    if (!p) return;
    if (gmMo && gmMo.on) { gmMotionText(word); return; }
    if (word != null) p.word = word;
    const putt = p.kind === 'putt';
    const txt = (p.phase !== 'swing' && ui.game.practice) ? (putt ? 'Practice stroke: it won’t count.' : 'Practice swing: it won’t count.')
      : p.word || (putt ? 'Back to the gold line, then up through the ball.' : 'Drag down from the ball, then swipe up through it.');
    const t = $('.gm-pad-text', p.el);
    if (t.textContent !== txt) t.textContent = txt;
    p.el.classList.toggle('off', !!gm.busy);
  }
  // Tempo in a colour: green on it, gold a touch off, orange well off.
  function gmTempoColor(e) { const q = Math.abs(e); return q < 0.07 ? '#b9f2c9' : q < 0.15 ? '#f2c94c' : '#ffc2ad'; }
  function gmPadDraw(now) {
    const p = gm && gm.pad;
    if (!p) return;
    if (gmMo && gmMo.on) { gmMotionDraw(p); return; }
    const c = p.ctx, w = p.w, h = p.h, x0 = p.x0, y0 = p.y0, F = p.full, putt = p.kind === 'putt', live = p.phase === 'swing';
    c.clearRect(0, 0, w, h);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.textBaseline = 'middle';
    c.font = '650 16px ' + GM_PAD_FONT;
    // The target line, straight up.
    c.setLineDash([5, 7]);
    c.strokeStyle = 'rgba(255,255,255,0.32)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(x0, 18); c.lineTo(x0, h - 6); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.beginPath(); c.moveTo(x0, 6); c.lineTo(x0 - 6, 17); c.lineTo(x0 + 6, 17); c.closePath(); c.fill();
    // Past full (red), the backswing marks, and how far back this shot wants.
    if (!putt) {
      c.fillStyle = 'rgba(232,70,58,0.24)';
      c.fillRect(x0 - 64, y0 + 1.02 * F, 128, Math.min(h - 2, y0 + 1.32 * F) - (y0 + 1.02 * F));
    }
    const chip = !putt && GM.ownStroke(gmShotType());
    const marks = putt ? GM_PUTT_TICKS.map((ft) => [gmPuttTickDepth(ft), ft + ' ft']) : [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, chip ? 'Full chip' : 'Full']];
    c.textAlign = 'left';
    const tY = y0 + Math.min(1.3, p.target) * F, full = !putt && p.target >= 0.97;
    marks.forEach(([d, label]) => {
      const y = y0 + d * F;
      if (y > h - 8 || (full && d === 1)) return;
      c.strokeStyle = 'rgba(255,255,255,0.5)';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(x0 + 12, y); c.lineTo(x0 + 26, y); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.88)';
      c.fillText(label, x0 + 32, y);
    });
    if (!putt && y0 + 1.17 * F < h - 8) { c.fillStyle = 'rgba(255,190,180,0.95)'; c.fillText('Over', x0 + 32, y0 + 1.17 * F); }
    c.setLineDash([7, 5]);
    c.strokeStyle = '#f2c94c';
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(x0 - 56, tY); c.lineTo(x0 + 8, tY); c.stroke();
    c.setLineDash([]);
    c.textAlign = 'right';
    c.fillStyle = '#f2c94c';
    const tl = putt ? 'This putt' : full ? 'Full' : Math.round(p.target * 100) + '%';
    c.fillText(c.measureText(tl).width > x0 - 70 ? (putt ? 'Putt' : tl) : tl, x0 - 62, tY);
    // The swing: in progress, or the last one, fainter.
    const tr = live ? p.samples : p.last ? p.last.samples : null, iTop = live ? p.iMax : p.last ? p.last.iTop : 0;
    if (tr && tr.length > 1) {
      const sx = tr[0].x - x0, sy = tr[0].y - y0;
      const seg = (a, b, color, width) => {
        if (b <= a) return;
        c.strokeStyle = color;
        c.lineWidth = width;
        c.beginPath();
        for (let i = a; i <= b; i++) { const q = tr[i]; if (i === a) c.moveTo(q.x - sx, q.y - sy); else c.lineTo(q.x - sx, q.y - sy); }
        c.stroke();
      };
      seg(0, Math.min(iTop, tr.length - 1), live ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)', 5);
      seg(Math.min(iTop, tr.length - 1), tr.length - 1, live ? '#f2c94c' : 'rgba(242,201,76,0.65)', 5);
      // The ring at a perfect tempo's pace, from the top to the ball.
      if (live && p.top) {
        const t = (now != null ? now : performance.now()) / 1000 - p.off;
        const u = (t - p.top.t) / Math.max(0.05, p.top.ideal), top = { x: p.top.x - sx, y: p.top.y - sy };
        const k = Math.pow(Math.min(1, Math.max(0, u)), 1.6), gx = top.x + (x0 - top.x) * k, gy = top.y + (y0 - top.y) * k;
        c.strokeStyle = '#f2c94c';
        c.lineWidth = 3;
        c.beginPath(); c.arc(gx, gy, 11, 0, 2 * Math.PI); c.stroke();
        if (u > 1) {
          const f = Math.min(1, (u - 1) * 3);
          c.strokeStyle = `rgba(242,201,76,${(1 - f).toFixed(2)})`;
          c.beginPath(); c.arc(x0, y0, 11 + 14 * f, 0, 2 * Math.PI); c.stroke();
        }
      }
      // After a swing: the line it came through on, and where it met the ball.
      if (!live && p.last && p.last.sw) {
        const sw = p.last.sw, a = sw.angle * Math.PI / 180, cx = sw.cross.x - sx, off = Math.abs(sw.angle) >= 3 ? '#ffc2ad' : 'rgba(255,255,255,0.95)';
        c.strokeStyle = off;
        c.lineWidth = 3;
        c.beginPath(); c.moveTo(cx - Math.sin(a) * 44, y0 + Math.cos(a) * 44); c.lineTo(cx + Math.sin(a) * 34, y0 - Math.cos(a) * 34); c.stroke();
        c.fillStyle = off;
        const ax = cx + Math.sin(a) * 40, ay = y0 - Math.cos(a) * 40;
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax - Math.cos(a) * 6 - Math.sin(a) * 9, ay - Math.sin(a) * 6 + Math.cos(a) * 9); c.lineTo(ax + Math.cos(a) * 6 - Math.sin(a) * 9, ay + Math.sin(a) * 6 + Math.cos(a) * 9); c.closePath(); c.fill();
      }
    }
    // How to swing, until his first one: a faint thumb back and through.
    if (p.demo && p.demo.y != null) {
      c.fillStyle = p.demo.gold ? 'rgba(242,201,76,0.3)' : 'rgba(255,255,255,0.2)';
      c.strokeStyle = p.demo.gold ? '#f2c94c' : 'rgba(255,255,255,0.75)';
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(x0, p.demo.y, 15, 0, 2 * Math.PI); c.fill(); c.stroke();
    }
    // The ball.
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(x0, y0, 9, 0, 2 * Math.PI); c.fill(); c.stroke();
    // The numbers: how far back while swinging, then the last swing's tempo and backswing.
    c.textAlign = 'left';
    c.font = '750 16px ' + GM_PAD_FONT;
    if (live) {
      const d = Math.max(0, (tr[p.iMax].y - tr[0].y) / F);
      c.textAlign = 'right';
      c.fillStyle = !putt && d > 1.02 ? '#ffc2ad' : '#ffffff';
      c.fillText(putt ? Math.round(GM.puttLength(d, gm.round.easy)) + ' ft' : d > 1.02 ? 'Over!' : Math.round(d * 100) + '%', w - 12, 22);
    } else if (p.last && p.last.sw) {
      const sw = p.last.sw, tt = 'Tempo ' + GM.ratioText(sw.ratio);
      c.fillStyle = gmTempoColor(sw.tempo);
      c.fillText(c.measureText(tt).width < x0 - 22 ? tt : GM.ratioText(sw.ratio), 12, 22);
      c.font = '650 16px ' + GM_PAD_FONT;
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillText('Goal ' + GM.goalText(sw.target), 12, 44);
      c.textAlign = 'right';
      const bt = putt ? Math.round(GM.puttLength(sw.depth, gm.round.easy)) + ' ft' : Math.round(sw.depth * 100) + '% back';
      c.fillText(c.measureText(bt).width < w - x0 - 22 ? bt : bt.replace(' back', ''), w - 12, 22);
    } else {
      c.font = '650 16px ' + GM_PAD_FONT;
      c.fillStyle = 'rgba(255,255,255,0.85)';
      const goal = GM.goalText(putt ? 2 : GM.tempoTarget(p.target, false)), long = 'Tempo goal ' + goal;
      c.fillText(c.measureText(long).width < x0 - 26 ? long : 'Goal ' + goal, 12, 22);
    }
  }
  const GM_DEMO = { rest: 0.35, back: 0.75, after: 1.4, times: 3 };
  function gmPadDemo(ts, p) {
    if (!gm || gm.pad !== p || !p.demo || p.phase !== 'ready') return;
    p.raf = 0;
    const d = GM_DEMO, goal = p.kind === 'putt' ? 2 : GM.tempoTarget(Math.min(1, p.target)), down = d.back / goal, cycle = d.rest + d.back + down + d.after;
    const t = (ts - p.demo.t0) / 1000, k = Math.floor(t / cycle), u = t - k * cycle, D = Math.min(1, p.target) * p.full;
    if (k >= d.times) { p.demo = null; gmPadDraw(); return; }
    let y = null, gold = false;
    if (u < d.rest) y = p.y0;
    else if (u < d.rest + d.back) { const v = (u - d.rest) / d.back; y = p.y0 + D * v * v * (3 - 2 * v); }
    else if (u < d.rest + d.back + down) { const v = (u - d.rest - d.back) / down; y = p.y0 + D - (D + GM_PAD.follow) * Math.pow(v, 1.6); gold = true; }
    else if (u < d.rest + d.back + down + 0.35) { y = p.y0 - GM_PAD.follow; gold = true; }
    Object.assign(p.demo, { y, gold });
    gmPadDraw();
    p.raf = requestAnimationFrame((t2) => gmPadDemo(t2, p));
  }
  function gmPadPt(p, e) { return { t: e.timeStamp / 1000, x: e.clientX - p.rect.left, y: e.clientY - p.rect.top }; }
  function gmPadDown(e) {
    const p = gm && gm.pad;
    if (!p || !e.isPrimary || e.button > 0 || (gmMo && gmMo.on)) return;
    e.preventDefault();
    if (gm.busy || p.phase === 'swing' || (gm.phase !== 'aim' && gm.phase !== 'putt')) return;
    if (p.kind === 'swing' && !gm.pools[gm.club]) { toast('No range shots with this club yet. Play it from the range.'); return; }
    if (p.raf) cancelAnimationFrame(p.raf);
    p.raf = 0;
    p.demo = null;
    try { p.cv.setPointerCapture(e.pointerId); } catch (err) { /* the swipe still works inside the pad */ }
    p.rect = p.cv.getBoundingClientRect();
    // Event times and the page clock usually agree; if not, the ring keeps to the page clock.
    const off = performance.now() / 1000 - e.timeStamp / 1000;
    Object.assign(p, { phase: 'swing', pid: e.pointerId, samples: [gmPadPt(p, e)], iMax: 0, top: null, tMove: null, crossT: 0, last: null, off: Math.abs(off) > 5 ? off : 0, began: performance.now() });
    gm.lastSwing = null;
    gmPadText(p.kind === 'putt' ? 'Back… and through.' : 'Back… and through the ball.');
    if (!p.raf) p.raf = requestAnimationFrame(gmPadLoop);
  }
  function gmPadAdd(p, q) {
    const sm = p.samples, last = sm[sm.length - 1];
    // The same point twice (a coalesced event and its own) is dropped; a finger resting at
    // the same spot a moment later is kept, as it says how long it stayed there.
    if (q.t < last.t || (q.t === last.t && q.x === last.x && q.y === last.y)) return;
    sm.push(q);
    const y0 = sm[0].y, i = sm.length - 1;
    if (p.tMove == null && Math.hypot(q.x - sm[0].x, q.y - y0) > GM.SWIPE.still) p.tMove = last.t;
    if (q.y > sm[p.iMax].y) { p.iMax = i; p.top = null; }
    const depth = (sm[p.iMax].y - y0) / p.full;
    if (!p.top && depth >= GM.SWIPE.minDepth && sm[p.iMax].y - q.y >= GM_PAD.topGap) {
      const back = Math.max(0.05, sm[p.iMax].t - (p.tMove != null ? p.tMove : sm[0].t));
      p.top = { t: sm[p.iMax].t, x: sm[p.iMax].x, y: sm[p.iMax].y, ideal: back / GM.tempoTarget(Math.min(depth, 1.35), p.kind === 'putt') };
    }
    if (p.top && !p.crossT && q.y <= y0) p.crossT = q.t;
    if (p.crossT && (q.y <= y0 - GM_PAD.follow || q.t - p.crossT >= GM_PAD.after)) gmPadFinish();
  }
  function gmPadMove(e) {
    const p = gm && gm.pad;
    if (!p || p.phase !== 'swing' || e.pointerId !== p.pid) return;
    e.preventDefault();
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    (list && list.length ? list : [e]).forEach((ev) => { if (p.phase === 'swing') gmPadAdd(p, gmPadPt(p, ev)); });
  }
  function gmPadUp(e) {
    const p = gm && gm.pad;
    if (!p || p.phase !== 'swing' || e.pointerId !== p.pid) return;
    gmPadAdd(p, gmPadPt(p, e));
    if (p.phase === 'swing') gmPadFinish();
  }
  function gmPadCancel(e) {
    const p = gm && gm.pad;
    if (!p || p.phase !== 'swing' || (e && e.pointerId !== p.pid)) return;
    if (p.raf) cancelAnimationFrame(p.raf);
    Object.assign(p, { phase: 'ready', raf: 0, samples: [] });
    gmPadText('Swing stopped. Try again.');
    gmPadDraw();
  }
  function gmPadLoop(ts) {
    const p = gm && gm.pad;
    if (!p) return;
    p.raf = 0;
    if (p.phase !== 'swing') return;
    const now = performance.now();
    if (p.crossT && now / 1000 - p.off - p.crossT >= GM_PAD.after) { gmPadFinish(); return; }
    if (now - p.began > GM_PAD.maxT * 1000) { gmPadCancel(); return; }
    gmPadDraw(now);
    p.raf = requestAnimationFrame(gmPadLoop);
  }
  const GM_SWING_WHY = {
    noThrough: 'Swipe all the way up through the ball to hit it.',
    noBack: 'Drag further down for a backswing, then swipe up through the ball.',
    still: 'Drag down from the ball, then swipe up through it.'
  };
  function gmPadFinish() {
    const p = gm && gm.pad;
    if (!p || p.phase !== 'swing') return;
    p.phase = 'done';
    if (p.raf) cancelAnimationFrame(p.raf);
    p.raf = 0;
    try { if (p.cv.hasPointerCapture && p.cv.hasPointerCapture(p.pid)) p.cv.releasePointerCapture(p.pid); } catch (err) { /* already let go */ }
    const putt = p.kind === 'putt', sw = GM.readSwing(p.samples, { full: p.full, ball: GM_PAD.ball, putt });
    if (!sw.ok) {
      Object.assign(p, { phase: 'ready', samples: [] });
      gmPadText(GM_SWING_WHY[sw.why] || GM_SWING_WHY.still);
      gmPadDraw();
      return;
    }
    p.last = gm.lastSwing = { samples: p.samples, sw, iTop: p.iMax, kind: p.kind, word: '' };
    ui.game.shown = true;
    // A tick at impact, on phones that can.
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* no vibration here */ }
    if (ui.game.practice) { gmPractice(sw); return; }
    if (putt) gmRealPutt(sw); else gmRealSwing(sw);
  }
  // The words on the pad after a swing: its tempo and what the ball did.
  function gmPadWord(rep, what) {
    const w = `${GM.tempoWord(rep)} (${GM.ratioText(rep.ratio)})${what ? ' · ' + what : ''}`;
    if (gm.lastSwing) gm.lastSwing.word = w;
    gmPadText(w);
    gmPadDraw();
  }
  // A practice swing: the report of what a swing like that does, and no shot.
  function gmPractice(sw) {
    const p = gm.pad;
    ui.game.practice = false;
    p.phase = 'ready';
    const b = $('.gm-practice', p.el);
    if (b) b.setAttribute('aria-pressed', 'false');
    if (p.kind === 'putt') {
      const ft = GM.dist(gm.ball, gm.pin) * 3, r = GM.puttSwing(ft, sw, gmRnd(), gmLie(), { easy: gm.round.easy, hand: gmHand(), still: true });
      gmPadWord(r.rep, 'practice');
      gmMsgHtml('Practice stroke', `A stroke like that rolls about ${gmFtText(r.rep.len)}${r.holed ? ', and it would drop' : ''}.`, gmPuttReportHtml(r.rep, ft, true));
      return;
    }
    const out = GM.swingShot(gm.pools[gm.club], sw, { lie: gmLie(), easy: gm.round.easy, hand: gmHand(), still: true, slope: gmSlopeTo(gmAimPoint()), equip: data.equipment, type: gmShotType() });
    const r = out.rep, side = Math.round(Math.abs(r.side));
    gmPadWord(r, 'practice');
    gmMsgHtml(`Practice swing · ${r.shape}`, `A swing like that: ${Math.round(r.carry)} yds carry${side >= 1 ? `, ${gmYds(side)} ${r.side < 0 ? 'left' : 'right'}` : ', on line'}.`, gmSwingReportHtml(r, true));
  }
  function gmRealSwing(sw) {
    const rnd = gmRnd(), lie = gmLie(), out = GM.swingShot(gm.pools[gm.club], sw, { lie, rnd, easy: gm.round.easy, hand: gmHand(), slope: gmSlopeTo(gmAimPoint()), equip: data.equipment, type: gmShotType() });
    if (!out) { gmPadCancel(); return; }
    gmPadWord(out.rep, out.rep.mis ? out.rep.shape.toLowerCase() + ', ' + GM_MIS_WORD[out.rep.mis].toLowerCase() : out.rep.shape.toLowerCase());
    gmPlay(out.shot, { kind: 'real', rep: out.rep, power: sw.power, rnd, lie });
  }
  function gmRealPutt(sw) {
    const ft = GM.dist(gm.ball, gm.pin) * 3, res = GM.puttSwing(ft, sw, gmRnd(), gmLie(), { easy: gm.round.easy, hand: gmHand() });
    gmPadWord(res.rep, '');
    gmPutt(ft, res, res.rep);
  }

  // ----- After a real swing: what it did and why -----
  const GM_MIS_WORD = { thin: 'Thin', fat: 'Fat', shank: 'Shank', toe: 'Off the toe' };
  function gmStrikeWord(rep) {
    if (rep.mis) return GM_MIS_WORD[rep.mis];
    const u = rep.strike, mid = (gm.round.easy ? GM.SWING.easy : GM.SWING.normal).strikeMid;
    if (Math.abs(u) <= mid) return 'Middle';
    return (Math.abs(u) < 1 ? 'Toward the ' : 'Off the ') + (u > 0 ? 'heel' : 'toe');
  }
  // The impact from above, the target straight up, its angles drawn four times as big:
  // the path (blue arrow), the face (orange, square to where it points) and the ball's
  // flight (green), starting mostly where the face points and curving away from the path.
  function gmFacePathSvg(rep) {
    const K = 4, h = rep.hand, rad = (d) => gmClamp(d * K, -40, 40) * Math.PI / 180;
    const pr = rad(h * rep.path), fr = rad(h * rep.face), sr = rad(rep.start), er = rad(Math.atan2(rep.side, Math.max(rep.carry, 1)) * 180 / Math.PI);
    const bx = 50, by = 66, n = (v) => (Math.round(v * 10) / 10).toFixed(1);
    const p0 = [bx - Math.sin(pr) * 30, by + Math.cos(pr) * 30], p1 = [bx + Math.sin(pr) * 22, by - Math.cos(pr) * 22];
    const head = (x, y, a) => `M${n(x)} ${n(y)}L${n(x - Math.cos(a) * 4.5 - Math.sin(a) * 7)} ${n(y - Math.sin(a) * 4.5 + Math.cos(a) * 7)}L${n(x + Math.cos(a) * 4.5 - Math.sin(a) * 7)} ${n(y + Math.sin(a) * 4.5 + Math.cos(a) * 7)}Z`;
    const fc = [bx, by + 6], f0 = [fc[0] - Math.cos(fr) * 14, fc[1] - Math.sin(fr) * 14], f1 = [fc[0] + Math.cos(fr) * 14, fc[1] + Math.sin(fr) * 14];
    const top = 10, rise = by - top, end = [bx + Math.tan(er) * rise, top], ctl = [bx + Math.tan(sr) * rise * 0.6, by - rise * 0.6];
    return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <line x1="50" y1="4" x2="50" y2="96" stroke="#8d9a92" stroke-width="1.5" stroke-dasharray="4 4"/>
      <path d="M${n(bx)} ${n(by)}Q${n(ctl[0])} ${n(ctl[1])} ${n(end[0])} ${n(end[1])}" fill="none" stroke="#136641" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${n(end[0])}" cy="${n(end[1])}" r="3" fill="#136641"/>
      <line x1="${n(p0[0])}" y1="${n(p0[1])}" x2="${n(p1[0])}" y2="${n(p1[1])}" stroke="#1f4b80" stroke-width="3" stroke-linecap="round"/>
      <path d="${head(p1[0], p1[1], pr)}" fill="#1f4b80"/>
      <line x1="${n(f0[0])}" y1="${n(f0[1])}" x2="${n(f1[0])}" y2="${n(f1[1])}" stroke="#9a2b0c" stroke-width="4.5" stroke-linecap="round"/>
      <circle cx="${bx}" cy="${by}" r="4.5" fill="#fff" stroke="#2e3b33" stroke-width="1.5"/>
    </svg>`;
  }
  // The ball-flight laws, for this shot: it started where the face pointed (mostly) and
  // curved away from the path, by how open or shut the face was to it.
  function gmBallWord(rep) {
    const deg = (d) => (Math.round(Math.abs(d) * 10) / 10).toFixed(1) + '°';
    const st = Math.abs(rep.start) < 0.5 ? 'The ball started on line' : `The ball started ${deg(rep.start)} ${rep.start < 0 ? 'left' : 'right'}`;
    const why = Math.abs(rep.face) < 0.5 ? ' (the face was square)' : ' (where the face pointed)';
    const f2p = rep.f2p, cv = Math.abs(rep.curve) < 1.5 ? ' and flew straight' : ` and curved ${gmYds(Math.abs(rep.curve))} ${rep.curve < 0 ? 'left' : 'right'}`;
    const cause = Math.abs(rep.curve) < 1.5 ? (Math.abs(f2p) < 1 ? ', the face square to the path' : '') : Math.abs(f2p) < 0.5 ? '' : `, the face ${deg(f2p)} ${f2p > 0 ? 'open' : 'shut'} to the path`;
    return `${st}${rep.mis === 'shank' ? ' (off the hosel)' : why}${cv}${cause}.`;
  }
  // What the phone itself did at impact, as it read it (the club gets a share of it).
  function gmPhoneWord(rep) {
    const deg = (d) => (Math.round(Math.abs(d) * 10) / 10).toFixed(1) + '°';
    const f = rep.phoneFace, pth = rep.phonePath;
    const fw = !C.isNum(f) ? '' : Math.abs(f) < 1 ? 'the screen square' : `the screen ${deg(f)} ${f > 0 ? 'open' : 'shut'}`;
    const pw = !C.isNum(pth) ? '' : Math.abs(pth) < 1 ? 'swinging straight along the line' : `swinging ${deg(pth)} ${pth > 0 ? 'in-to-out' : 'out-to-in'}`;
    return `The phone at impact: ${[fw, pw].filter(Boolean).join(', ')}.`;
  }
  function gmRealShotLine(rep) {
    const r = rep.real;
    if (!r || r.made) return '';
    const sess = gmSessionOf(r), name = C.clubName(rep.club, data.clubs).toLowerCase();
    return `${rep.mis ? 'A mis-hit like' : 'Struck like'} your ${name}${sess ? ` on ${C.fmtDate(sess.date, { short: true })}` : ''}${r.time ? ` at ${r.time}` : ''}: ${C.fmtRaw(r.carry_yds)} yds carry.`;
  }
  function gmSwingReportHtml(rep, practice) {
    const name = C.clubName(rep.club, data.clubs).toLowerCase();
    const rows = [
      ['Tempo', `${GM.ratioText(rep.ratio)} <span class="w">(goal ${GM.goalText(rep.target)})</span>`],
      ['Back', `${Math.round(rep.depth * 100)}%${rep.depth > 1.02 ? ' <span class="w">(past full)</span>' : ''}`],
      ['<span class="k path"></span>Path', esc(GM.pathWord(rep.path))],
      ['<span class="k face"></span>Face', esc(GM.faceWord(rep.face))],
      ['Strike', esc(gmStrikeWord(rep))]
    ];
    if (rep.motion) rows.pop();  // the phone can't feel where it was struck
    // A good swing that still curved off: that's the spread in his own shots with the club
    // (his face and path wander from swing to swing), and worth saying so. A planned draw
    // or fade moves them on purpose (rep.plan), and when it came off that's no spread.
    const tips = GM.swingTips(rep), own = GM.ownShapeText(rep, name), plan = rep.plan || { face: 0, path: 0 }, v = GM.shotVerdict(rep);
    const spread = rep.own && !(v && v.ok && (rep.type === 'draw' || rep.type === 'fade')) && (Math.abs(rep.face - rep.own.face - plan.face) > 2 || Math.abs(rep.path - rep.own.path - plan.path) > 2.5) && rep.shape !== 'Straight';
    const good = `<b>${esc(GM.tempoWord(rep))}</b>${Math.abs(rep.angle) < 4 ? ' and a straight swipe' : ''}`
      + (spread ? `, and still a ${esc(rep.shape.toLowerCase())}: that’s the spread in your own ${esc(name)} shots. Even good swings vary.` : ': nicely done.' + (own ? ' ' + esc(own) : ''));
    const tip = tips.length ? tips.slice(0, 2).map(esc).join(' ') : good;
    const foot = practice ? (rep.pMis >= 0.05 ? `About ${Math.round(rep.pMis * 100)} in 100 swings like that would be mis-hit.` : '') : gmRealShotLine(rep);
    const planned = v ? `<p class="gm-plan${v.ok ? ' ok' : ''}"><b>${esc(GM.SHOTS[rep.type].name)}:</b> ${esc(v.text)}</p>` : '';
    return `${planned}<div class="gm-rep">${gmFacePathSvg(rep)}<ul class="gm-rep-l">${rows.map(([k, v2]) => `<li><b>${k}</b> ${v2}</li>`).join('')}</ul></div>
      <p class="gm-law"><span class="k ball"></span>${esc(gmBallWord(rep))}</p>${rep.motion ? `<p class="gm-law">${esc(gmPhoneWord(rep))}</p>` : ''}
      <p class="gm-tip">${tip}</p>${foot ? `<span class="s gm-real">${esc(foot)}</span>` : ''}`;
  }
  function gmPuttReportHtml(rep, ft, practice) {
    const past = rep.len - ft, startW = Math.abs(rep.start) < 0.3 ? 'on line' : `${(Math.round(Math.abs(rep.start) * 10) / 10).toFixed(1)}° ${rep.start < 0 ? 'left' : 'right'}`;
    const rows = [
      ['Tempo', `${GM.ratioText(rep.ratio)} <span class="w">(goal ${GM.goalText(rep.target)})</span>`],
      ['Pace', past >= 0 ? (past < 0.5 ? 'just reached the hole' : `${gmFtText(past)} past`) : `${gmFtText(-past)} short`],
      ['Start', esc(startW)]
    ];
    const tips = GM.swingTips(rep, true);
    if (past < -0.3) tips.push(rep.motion ? 'Short: take it back a little further.' : 'Short: drag back a little further.');
    else if (past > 4) tips.push('Long: a shorter backstroke, at the same tempo.');
    const tip = tips.length ? tips.slice(0, 2).map(esc).join(' ') : `<b>${esc(GM.tempoWord(rep))}</b> and a good pace${practice ? '.' : ': nicely done.'}`;
    return `<div class="gm-rep gm-rep-putt"><ul class="gm-rep-l">${rows.map(([k, v]) => `<li><b>${k}</b> ${v}</li>`).join('')}</ul></div><p class="gm-tip">${tip}</p>`;
  }
  // How his real swings went (this hole's, or the round's): how many were on tempo,
  // within 10% of the goal; which way the rest missed; his most common shape.
  function gmSwingSummary(shots, when) {
    const sw = shots.filter((s) => s && s.sw && C.isNum(s.sw.r));
    if (!sw.length) return '';
    const full = sw.filter((s) => s.kind === 'real'), putts = sw.filter((s) => s.kind === 'putt');
    const part = (list, what) => {
      if (!list.length) return '';
      const e = list.map((s) => Math.log(s.sw.r / (s.sw.g || 3))), on = e.filter((v) => Math.abs(v) <= 0.1).length;
      const quick = e.filter((v) => v > 0.1).length, slow = e.filter((v) => v < -0.1).length;
      return `${on} of ${plural(list.length, what)} on tempo${quick || slow ? ` (${[quick ? quick + ' quick' : '', slow ? slow + ' slow' : ''].filter(Boolean).join(', ')})` : ''}`;
    };
    const shapes = {};
    full.forEach((s) => { if (s.sw.s) shapes[s.sw.s] = (shapes[s.sw.s] || 0) + 1; });
    const order = Object.keys(shapes).sort((a, b) => shapes[b] - shapes[a]), top = order[0];
    const often = top && shapes[top] >= 2 && (order.length < 2 || shapes[top] > shapes[order[1]]);
    const bits = [part(full, 'swing'), part(putts, 'putt')].filter(Boolean).join('; ');
    return `<p class="gm-swing"><b>Your tempo ${esc(when)}:</b> ${esc(bits)}.${often ? ` Most often: ${esc(top.toLowerCase())} (${shapes[top]} of ${full.length}).` : ''}</p>`;
  }

  // ----- Hitting a shot -----
  function gmSwingDone(pos) {
    gmMeterStop();
    const m = gm.meter, e = GM.timingOf(pos, gm.round.easy), pool = gm.pools[gm.club];
    gmMeterText(GM.timingWord(e));
    const rnd = gmRnd(), pick = GM.pickShot(pool, e, rnd);
    const type = gmShotType();
    const power = m.power * GM.strokeScale(type, gm.pools[gm.club]);
    gmPlay(GM.typeShot(GM.slopeShot(GM.adjustShot(pick.shot, power, gmLie()), gmLieSlope(), gmHand()), type, gmHand(), gmLie(), Math.abs(e)), { kind: 'meter', e, power, pick, rnd, lie: gmLie(), type });
  }
  function gmLiveShot() {
    const carry = numOrNull('gmCarry'), total = numOrNull('gmTotal'), off = numOrNull('gmOff');
    if (!(carry > 0)) { toast('Type the carry from the range screen'); const f = $('#gmCarry'); if (f) f.focus(); return; }
    if (off && !ui.game.dir) { toast('Tap Left or Right for the offline number'); return; }
    if (total != null && !(total > 0)) { toast('The total should be a number of yards'); return; }
    // The same limits the data check uses: anything longer is a typo.
    if (carry > 400 || (total != null && total > 450) || (off != null && Math.abs(off) > 700)) { toast('That looks too long. Check the number on the screen.'); return; }
    const shot = { club: gm.club, carry_yds: carry, total_yds: total, offline_ft: off ? (ui.game.dir === 'L' ? -Math.abs(off) : Math.abs(off)) : 0, curve_ft: null,
      ball_speed_mph: null, launch_deg: null, apex_ft: null, landing_deg: null, hang_time_s: null };
    ui.game.dir = null;
    gmPlay(GM.slopeShot(GM.adjustShot(shot, 1, gmLie()), gmLieSlope(), gmHand()), { kind: 'live', rnd: gmRnd(), lie: gmLie() });
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  // What a real swing did, kept with the stroke: tempo (r) and its goal (g), the swipe's
  // angle (a), the backswing (d), the face (f) and path (p) for his hand, the shape (s),
  // the mis-hit (m) and the strike (q).
  function gmSwingRecord(rep) {
    const out = { r: r2(rep.ratio), g: r1(rep.target), a: r1(rep.angle), d: r2(rep.depth) };
    if (rep.motion) out.mo = 1;
    if (C.isNum(rep.face)) Object.assign(out, { f: r1(rep.face), p: r1(rep.path), s: rep.shape, m: rep.mis || null, q: r2(rep.q) });
    if (C.isNum(rep.len)) Object.assign(out, { l: r1(rep.len), st: r1(rep.start) });
    return out;
  }
  // Every stroke is saved before it's shown, with the hole's result if it finished it.
  function gmCommit(stroke, next, holed) {
    const r = gm.round, card = gm.card;
    card.shots.push(stroke);
    card.strokes += 1 + (stroke.penalty || 0);
    card.penalties += stroke.penalty || 0;
    if (holed) Object.assign(card, { done: true, score: card.strokes });
    else if (card.strokes >= GM.MAX_OVER * card.par) Object.assign(card, { done: true, picked: true, score: GM.MAX_OVER * card.par });
    r.ball = card.done ? null : next;
    if (card.done && r.cards.every((c) => c.done)) gmFinish(r);
    gmStore(gm.st);
  }
  function gmPlay(shot, info) {
    const from = gm.ball, aim = gmAimPoint();
    const res = GM.playShot(gm.H, from, aim, shot, { pin: gm.pin, equip: data.equipment, rnd: info.rnd });
    if (!res) { toast('That shot needs a carry'); gmMeterReset(); return; }
    const pick = info.pick, rep = info.rep, real = pick ? pick.shot : rep ? rep.real : null;
    const stroke = {
      kind: info.kind, club: shot.club, from: [r1(from.x), r1(from.z)], to: [r1(res.rest.x), r1(res.rest.z)], lie0: from.lie, lie: res.lie, result: res.result,
      penalty: res.penalty, carry: r1(res.carry), total: r1(res.total), e: C.isNum(info.e) ? r1(info.e * 100) / 100 : null, power: C.isNum(info.power) ? r1(info.power * 100) / 100 : null,
      grade: pick ? pick.grade : rep ? (rep.mis ? 'mishit' : null) : null, real: real && real.id && !real.made ? real.id : null, track: res.track
    };
    if (rep) stroke.sw = gmSwingRecord(rep);
    const type = info.type || (rep && rep.type);
    if (type && !GM.plainShot(type)) stroke.type = type;
    gmCommit(stroke, res.next, res.result === 'holed');
    gm.busy = true;
    gmMeterText();
    gmPadText();
    gmFly(res, () => {
      if (!gm) return;
      gm.busy = false;
      gmAfterShot(res, info, shot);
    });
  }
  // The shot from behind the ball as it flies, then back to the map.
  function gmFly(res, after) {
    if (REDUCED) { after(); return; }
    const tr = res.traj, o = tr.origin, aim = gmAimPoint();
    const pts = [o, tr.apexPoint, tr.land, tr.rest, { x: aim.x, y: 0, z: aim.z }].concat(tr.samples.filter((s, i) => i % 6 === 4));
    const cam = FL.fitBehind(pts, gm.w, gm.h, o.x, o.z, res.heading);
    const bg = gmBg(cam, { near: 12 });
    // Once the ball is past its peak and on its way down, the camera cuts to where it's
    // landing, so he sees it come down, bounce and roll out (and the flag, near the pin).
    const cut = FL.landCut(tr), landing = tr.duration - cut > 0.8;
    const camL = landing ? FL.fitLanding(tr, gm.w, gm.h, res.heading, GM.dist(tr.rest, gm.pin) < 30 ? [{ x: gm.pin.x, y: 0, z: gm.pin.z }] : []) : null;
    const bgL = camL ? gmBg(camL, { near: 25 }) : null;
    const skip = $('.gm-skip', gm.box);
    if (skip) skip.hidden = false;
    gm.phase = 'flight';
    gm.canvas.setAttribute('aria-label', 'The shot from behind the ball');
    gm.canvas.classList.remove('aim');
    const fl = gm.fl = { cam, bg, camL, bgL, cut: camL ? cut : Infinity, tr, t: 0, last: 0, after, done: false };
    const end = () => {
      if (!gm || fl.done) return;
      fl.done = true;
      if (gm.raf) cancelAnimationFrame(gm.raf);
      gm.raf = 0;
      if (skip) skip.hidden = true;
      gm.bgs.delete(cam);
      if (camL) gm.bgs.delete(camL);
      gm.fl = null;
      after();
    };
    fl.end = end;
    const tick = (ts) => {
      if (!gm || gm.fl !== fl) return;
      const dt = fl.last ? Math.min(0.05, (ts - fl.last) / 1000) : 0;
      fl.last = ts;
      fl.t += dt;
      const down = fl.t >= fl.cut;
      if (down && !fl.landed) { fl.landed = true; gm.canvas.setAttribute('aria-label', 'Where the ball lands, and how it rolls'); }
      gm.ctx.clearRect(0, 0, gm.w, gm.h);
      FL.drawFrame(gm.ctx, { cam: down ? camL : cam, view: 'game', bg: down ? bgL : bg, past: [], cur: tr, t: Math.min(fl.t, tr.duration), hud: true });
      if (fl.t >= tr.duration + GM_HOLD) { end(); return; }
      gm.raf = requestAnimationFrame(tick);
    };
    gm.raf = requestAnimationFrame(tick);
  }
  function gmSessionOf(shot) { return data.sessions.find((s) => C.sessionShots(s).indexOf(shot) >= 0) || null; }
  function gmAfterShot(res, info, shot) {
    const card = gm.card, name = C.clubName(shot.club, data.clubs);
    const flown = `${Math.round(res.carry)} carry${Math.abs(res.total - res.carry) >= 1 ? `, ${Math.round(res.total)} total` : ''}`;
    const title = (info.kind === 'meter' ? GM.timingWord(info.e) + ' · ' : info.kind === 'real' ? info.rep.shape + ' · ' : 'From the range · ') + `${name} · ${flown}`;
    const nb = res.next, d = nb ? GM.dist(nb, gm.pin) : 0;
    const where = nb ? `${GM_WHERE[nb.lie] || GM.LIE_WORDS[nb.lie]}, ${nb.lie === 'green' ? gmFtText(d * 3) + ' from the hole' : gmYds(d) + ' to the pin'}.` : '';
    let line = where, kind = '';
    if (res.result === 'holed') { line = card.strokes === 1 ? 'Hole in one!' : 'In the hole!'; kind = 'great'; }
    else if (res.result === 'water') { line = `In the water. One penalty stroke: drop where it went in. ${where}`; kind = 'bad'; }
    else if (res.result === 'penalty') { line = `In the penalty area. One penalty stroke: drop where it went in. ${where}`; kind = 'bad'; }
    else if (res.result === 'ob') { line = 'Out of bounds. One penalty stroke: hit again from the same spot.'; kind = 'bad'; }
    else if (res.result === 'tree') line = `Hit a tree! ${where}`;
    else if ((info.pick && info.pick.grade === 'mishit') || (info.rep && info.rep.mis)) kind = 'bad';
    if (info.kind === 'real') {
      if (card.done && card.picked) line = `${line ? line + ' ' : ''}That’s double par, so you pick up.`;
      gmMsgHtml(title, line, gmSwingReportHtml(info.rep), kind);
      if (card.done) { gm.phase = 'holed'; gm.ballHidden = res.result === 'holed'; if (res.next) gm.ball = res.next; gmView(); gmControls(); gmDraw(); return; }
      gm.ball = res.next;
      gmNewSpot();
      return;
    }
    let sub = '';
    const real = info.pick && info.pick.shot, sess = real ? gmSessionOf(real) : null;
    if (real) {
      const side = C.isNum(real.offline_ft) && Math.round(Math.abs(real.offline_ft)) ? `, ${Math.round(Math.abs(real.offline_ft))} ft ${real.offline_ft < 0 ? 'left' : 'right'}` : '';
      const how = [Math.round(info.power * 100) < 100 ? `at ${Math.round(info.power * 100)}% power` : '', GM_FROM[info.lie] || ''].filter(Boolean).join(', ');
      const wasMis = (gm.pools[shot.club] || { mis: [] }).mis.indexOf(real) >= 0;
      sub = `${wasMis ? 'A mis-hit, like' : 'It flew like'} your ${name.toLowerCase()}${sess ? ` on ${C.fmtDate(sess.date, { short: true })}` : ''}${real.time ? ` at ${real.time}` : ''}: ${C.fmtRaw(real.carry_yds)} yds carry${side}${how ? `. This one was ${how}` : ''}.`;
    } else if (GM_FROM[info.lie]) sub = `Played ${GM_FROM[info.lie]}.`;
    if (card.done && card.picked) line = `${line ? line + ' ' : ''}That’s double par, so you pick up.`;
    // The shot he planned, and whether it came off.
    const v = info.type ? GM.shotVerdict({ type: info.type, curve: (shot.curve_ft || 0) / 3, carry: shot.carry_yds, hand: gmHand(), spun: !!shot.spun, checked: !!shot.checked, lie: info.lie, mis: info.pick && info.pick.grade === 'mishit' ? 'mis' : null }) : null;
    if (v) gmMsgHtml(title, line, `<p class="gm-plan${v.ok ? ' ok' : ''}"><b>${esc(GM.SHOTS[info.type].name)}:</b> ${esc(v.text)}</p>${sub ? `<span class="s">${esc(sub)}</span>` : ''}`, kind);
    else gmMsg(title, line, sub, kind);
    if (card.done) { gm.phase = 'holed'; gm.ballHidden = res.result === 'holed'; if (res.next) gm.ball = res.next; gmView(); gmControls(); gmDraw(); return; }
    gm.ball = res.next;
    gmNewSpot();
  }

  // ----- Putting -----
  function gmPuttDone(pos) {
    gmMeterStop();
    const ft = GM.dist(gm.ball, gm.pin) * 3, m = gm.meter, e = (pos - m.target) / m.win;
    gmMeterText(Math.abs(e) < 0.25 ? 'Nice pace' : e < 0 ? (e < -1 ? 'Way short' : 'A little short') : (e > 1 ? 'Way long' : 'A little long'));
    gmPutt(ft, GM.putt(ft, e, gmRnd(), gmLie()));
  }
  function gmPutt(ft, res, rep) {
    const b = gm.ball, hd = GM.headingTo(b, gm.pin), H = gm.H;
    let end = res.holed ? { x: gm.pin.x, z: gm.pin.z } : FL.offsetPoint(b.x, b.z, hd, res.along / 3, res.side / 3);
    // A putt stays on the green or the fringe: one that runs off stops at the edge.
    for (let k = 0; k < 30 && !res.holed && !/^(green|fringe)$/.test(GM.lieAt(H, end.x, end.z)); k++) end = { x: end.x + (b.x - end.x) * 0.08, z: end.z + (b.z - end.z) * 0.08 };
    const lie = res.holed ? 'holed' : GM.lieAt(H, end.x, end.z), left = res.holed ? 0 : GM.dist(end, gm.pin) * 3;
    const stroke = { kind: 'putt', club: 'Putter', from: [r1(b.x), r1(b.z)], to: [r1(end.x), r1(end.z)], lie0: b.lie, lie, result: res.holed ? 'holed' : 'ok', penalty: 0, ft: r1(ft) };
    if (rep) stroke.sw = gmSwingRecord(rep);
    gmCommit(stroke, res.holed ? null : { x: end.x, z: end.z, lie: /^(green|fringe)$/.test(lie) ? lie : 'fringe' }, res.holed);
    const card = gm.card, report = rep ? gmPuttReportHtml(rep, ft) : '';
    const msg = () => {
      if (res.holed) gmMsgHtml(ft >= 20 ? 'What a putt!' : 'In the hole!', ft <= GM.TAP_IN ? 'Tapped in.' : `${gmFtText(ft)} putt.`, report, 'great');
      else gmMsgHtml(`${gmFtText(ft)} putt`, `${res.along < ft ? 'Short' : 'Past the hole'}: ${gmFtText(left)} left.${card.done ? ' That’s double par, so you pick up.' : ''}`, report);
      gm.ball = res.holed ? { x: gm.pin.x, z: gm.pin.z, lie: 'green' } : { x: end.x, z: end.z, lie: /^(green|fringe)$/.test(lie) ? lie : 'fringe' };
      if (card.done) { gm.phase = 'holed'; gm.ballHidden = res.holed; gmView(); gmControls(); gmDraw(); return; }
      gmNewSpot();
    };
    gmRoll(b, end, res.holed, msg);
  }
  // The putt rolling on the map, slowing to a stop (or dropping in).
  function gmRoll(from, to, holed, after) {
    gm.busy = true;
    gmMeterText();
    gmPadText();
    if (REDUCED) { gm.busy = false; after(); return; }
    const len = GM.dist(from, to) * 3, T = gmClamp(0.6 + len / 22, 0.7, 2.6);
    gm.phase = 'roll';
    let t0 = 0;
    const tick = (ts) => {
      if (!gm) return;
      if (!t0) t0 = ts;
      const u = Math.min(1, (ts - t0) / 1000 / T), f = 1 - (1 - u) * (1 - u);
      gm.rollPos = { x: from.x + (to.x - from.x) * f, z: from.z + (to.z - from.z) * f };
      gm.ballHidden = holed && u >= 1;
      gmDraw();
      if (u < 1) { gm.raf = requestAnimationFrame(tick); return; }
      gm.raf = 0;
      setTimeout(() => { if (!gm) return; gm.busy = false; gm.rollPos = null; after(); }, holed ? 500 : 250);
    };
    gm.raf = requestAnimationFrame(tick);
  }

  // ----- The round -----
  function gmFinish(r) {
    if (r.finished) return;
    r.finished = true;
    const t = GM.totals(r);
    gm.st.history = [{ date: todayISO(), course: r.course, tee: r.tee, holes: t.holes, label: r.label || '', strokes: t.strokes, par: t.par, toPar: t.toPar, mode: r.mode, scores: r.cards.map((c) => c.score) }]
      .concat(gm.st.history || []).slice(0, 20);
  }
  function gmCanvasTap(e) {
    if (!gm) return;
    if (gm.phase === 'flight' && gm.fl) { gm.fl.end(); return; }
    if (gm.phase !== 'aim' || gm.busy || gmSwinging()) return;
    const r = gm.canvas.getBoundingClientRect(), p = FL.unproject(gm.mapCam, e.clientX - r.left, e.clientY - r.top);
    if (!p) return;
    gm.aim = { x: p.x, z: p.z };
    gmAimText();
    gmDraw();
  }
  function gmStartRound() {
    const st = gmState(), pools = GM.clubPools(data.sessions, data.equipment), set = gmSettings(st, pools), course = gmCourse();
    const old = gmRound(st);
    if (old && !old.finished && old.cards.some((c) => !c.done)) {
      if (!window.confirm('Start a new round? The one you’re playing ends.')) return;
      if (old.cards.some((c) => c.done)) {
        const t = GM.totals(old);
        st.history = [{ date: todayISO(), course: old.course, tee: old.tee, holes: t.played, label: `${t.played} of ${old.label || plural(t.holes, 'hole')}`, strokes: t.strokes, par: t.par, toPar: t.toPar, mode: old.mode, scores: old.cards.filter((c) => c.done).map((c) => c.score) }]
          .concat(st.history || []).slice(0, 20);
      }
    }
    const all = course.holes.map((h) => h.n);
    const holes = set.holes === 'front' ? all.filter((n) => n <= 9) : set.holes === 'back' ? all.filter((n) => n >= 10) : set.holes === 'one' ? [+set.one] : all;
    const mode = Object.keys(pools).length ? set.mode : 'live';
    st.round = GM.newRound(course, { tee: set.tee, holes, mode, easy: set.easy, date: todayISO() });
    st.round.v2 = 2;
    st.round.label = set.holes === 'one' ? `Hole ${+set.one}` : GM_HOLES[set.holes] || '';
    gmStore(st);
    Object.assign(ui.game, { setup: false, card: false, dir: null });
    renderGame();
    gmScrollTop();
  }
  // Bring the hole's title and map into view (they sit below the header and goals).
  function gmScrollTop() {
    const top = $('.gm-top') || $('#view-game');
    if (top) top.scrollIntoView({ block: 'start' });
  }
  function gmEndRound() {
    const st = gm ? gm.st : gmState(), r = gmRound(st);
    if (!r) return;
    const t = GM.totals(r);
    if (!window.confirm(t.played ? `End this round? Your ${plural(t.played, 'hole')} so far go in Your rounds.` : 'End this round?')) return;
    if (t.played && !r.finished) {
      st.history = [{ date: todayISO(), course: r.course, tee: r.tee, holes: t.played, label: `${t.played} of ${r.label || plural(t.holes, 'hole')}`, strokes: t.strokes, par: t.par, toPar: t.toPar, mode: r.mode, scores: r.cards.filter((c) => c.done).map((c) => c.score) }]
        .concat(st.history || []).slice(0, 20);
    }
    st.round = null;
    gmStore(st);
    gmStop();
    Object.assign(ui.game, { setup: false, card: false });
    renderGame();
    window.scrollTo(0, 0);
  }
  function gmResize() {
    if (!gm || gm.busy || gm.phase === 'flight' || gmSwinging()) return;
    if (gm.pad) gmPadSetup(gm.pad.kind);
    gmSize();
    gmView();
    gmDraw();
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
    return `<div class="card"><h3>Recorded ranges</h3><p class="hint" style="margin:4px 0 8px">Only ranges were kept from this session, so they include any mis-hits.</p>
      <div class="table-wrap"><table class="matrix"><thead><tr><th>Metric</th>${clubs.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${keys.map((k) => `<tr><th scope="row">${esc(C.METRIC[k].label)}<span class="u">${esc(unitLabel(C.METRIC[k]))}</span></th>${clubs.map((c) => { const r = (sum[c] || {})[k]; return `<td>${r ? esc(C.fmtRange(r.min, r.max, C.METRIC[k].dir)) : '—'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div></div>`;
  }
  function shotList(s) {
    const shots = s.shots || [];
    if (!C.sessionShots(s).length) return `<p class="empty">${C.isSummaryOnly(s) ? 'Ranges only. Individual shots weren’t recorded.' : 'No shots yet.'}</p>`;
    const mis = C.sessionMishits([s]), odd = C.sessionOutliers([s]), easy = C.sessionPractice([s]);
    const clubs = C.sortClubs(Array.from(new Set(C.sessionShots(s).map((x) => x.club))));
    return clubs.map((c) => {
      const items = [];
      shots.forEach((x, idx) => { if (x && x.club === c) items.push(shotRow(x, idx, easy.has(x) ? easy.get(x) : mis.has(x) ? 'mis' : odd.has(x) ? 'out' : '')); });
      return `<details class="club-group" open><summary>${esc(c)} · ${plural(items.length, 'shot')}</summary>${items.join('')}</details>`;
    }).join('');
  }
  function shotRow(x, idx, kind) {
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
      kind === 'mis' ? 'likely mis-hit (left out of the numbers)' : null,
      kind === 'out' ? 'outlier: far off the usual carry (left out of the numbers, still solid contact)' : null,
      kind === 'warm-up' ? 'warm-up swing (left out of the numbers, not a mis-hit)' : null,
      kind === 'partial' ? 'half swing or drill ball (left out of the numbers)' : null
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
    const cols = ['session_id', 'date', 'device', 'shot_id', 'time', 'club'].concat(C.METRICS.map((m) => m.key), ['likely_mishit', 'outlier', 'practice_swing', 'note']);
    const q = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    const lines = [cols.join(',')];
    data.sessions.forEach((s) => {
      const mis = C.sessionMishits([s]), odd = C.sessionOutliers([s]), easy = C.sessionPractice([s]);
      C.sessionShots(s).forEach((x) => {
        lines.push([s.id, s.date, s.device, x.id, x.time, x.club].concat(C.METRICS.map((m) => C.metricValue(x, m.key)), [mis.has(x) ? 'yes' : '', odd.has(x) ? 'yes' : '', easy.get(x) || '', x.note]).map(q).join(','));
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
    // The replay updates in place, so a shot that's playing keeps playing.
    'rp-play'() { rpToggle(); },
    'rp-step'(b) {
      if (!rp) return;
      const go = rp.playing || rp.all;
      rp.past = [];
      rpShow(rp.idx + Number(b.dataset.d), go);
    },
    'rp-club'(b) {
      if (!rp) return;
      ui.rp.club = b.dataset.club;
      Object.assign(rp, { all: false, past: [] });
      $$('[data-action="rp-club"]', rp.card).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.club === ui.rp.club)));
      rpFilter();
      if (!rp.list.length && ui.rp.best) { ui.rp.best = false; rpFilter(); toast('No solid shots with that club to pick the best from'); }
      rpShow(0, false);
    },
    // Best 10 on or off: each club's best shots flying together, or every shot again.
    'rp-best'() {
      if (!rp) return;
      ui.rp.best = !ui.rp.best;
      Object.assign(rp, { all: false, past: [] });
      rp.bgs.clear();
      rpFilter();
      if (!rp.list.length) { ui.rp.best = false; rpFilter(); toast('No solid shots with that club to pick the best from'); }
      rpShow(0, false);
    },
    'rp-all'() {
      if (!rp) return;
      rp.all = !rp.all;
      rp.past = [];
      if (!rp.all) { rpControls(); return; }
      if (REDUCED) { rpAllAtOnce(); return; }
      rpShow(rp.idx >= rp.list.length - 1 ? 0 : rp.idx, true);
    },
    'rp-speed'() { ui.rp.speed = RP_SPEEDS[(RP_SPEEDS.indexOf(ui.rp.speed) + 1) % RP_SPEEDS.length]; rpControls(); },
    // A new camera picks up where the shot is, so it can change mid-flight.
    'rp-view'(b) {
      if (!rp) return;
      ui.rp.view = b.dataset.view;
      $$('[data-action="rp-view"]', rp.card).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === ui.rp.view)));
      rpDraw();
      rpLabel();
    },
    // ----- Game -----
    'gm-set'(b) {
      const st = gmState(), k = b.dataset.k, v = k === 'one' ? Number(b.dataset.v) : b.dataset.v;
      st.last = Object.assign(gmSettings(st, GM.clubPools(data.sessions, data.equipment)), { [k]: v });
      gmStore(st);
      renderGame();
    },
    'gm-start'() { gmStartRound(); },
    'gm-continue'() { ui.game.setup = false; renderGame(); gmScrollTop(); },
    'gm-new'() { ui.game.setup = true; gmStop(); renderGame(); window.scrollTo(0, 0); },
    'gm-erase'() {
      if (!window.confirm(`Erase all of ${playerName()}’s rounds on this phone? The round in progress and every past round are deleted.`)) return;
      const st = gmState();
      delete st.round; st.history = [];
      gmStop(); gmStore(st);
      Object.assign(ui.game, { setup: false, card: false });
      renderGame(); window.scrollTo(0, 0);
      toast('Rounds erased');
    },
    'gm-quit'() { gmEndRound(); },
    'gm-card'(b) {
      ui.game.card = !ui.game.card;
      const box = $('.gm-scorecard'), r = gmRound(gm ? gm.st : gmState());
      if (box && r) { box.innerHTML = ui.game.card ? gmScorecardHtml(r) : ''; box.hidden = !ui.game.card; }
      b.setAttribute('aria-expanded', String(ui.game.card));
    },
    'gm-club'(b) {
      if (!gm || gm.busy || gmSwinging()) return;
      gm.club = b.dataset.club;
      if (gm.shot && !GM.shotFits(gm.shot, gm.club)) gm.shot = null;
      gm.aim = null;
      gm.phase = gm.club === 'Putter' ? 'putt' : 'aim';
      gmView();
      gmControls();
      gmDraw();
    },
    'gm-mode'(b) {
      if (!gm || gm.busy || b.dataset.v === gm.round.mode || !GM_MODE_OK[b.dataset.v] || gmSwinging()) return;
      gm.round.mode = b.dataset.v;
      gmStore(gm.st);
      if (gm.club !== 'Putter' && gmClubs().indexOf(gm.club) < 0) { gm.club = gmSuggest(); gm.aim = null; }
      gmControls();
      gmDraw();
    },
    'gm-nudge'(b) {
      if (!gm || gm.phase !== 'aim' || gm.busy || gmSwinging()) return;
      const a = gmAimPoint(), hd = GM.headingTo(gm.ball, a);
      gm.aim = FL.offsetPoint(a.x, a.z, hd, 0, GM_NUDGE * Number(b.dataset.d));
      gmAimText();
      gmDraw();
    },
    'gm-dir'(b) {
      ui.game.dir = ui.game.dir === b.dataset.dir ? null : b.dataset.dir;
      $$('[data-action="gm-dir"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.dir === ui.game.dir)));
    },
    'gm-live'() { if (gm && !gm.busy && gm.phase === 'aim') gmLiveShot(); },
    'gm-tapin'() { if (gm && !gm.busy && gm.phase === 'putt') gmPutt(GM.dist(gm.ball, gm.pin) * 3, { holed: true, along: 0, side: 0 }); },
    'gm-skip'() { if (gm && gm.fl) gm.fl.end(); },
    'gm-shot'(b) {
      if (!gm || gm.busy || gmSwinging()) return;
      gmShotSugg();
      const type = b.dataset.type, want = GM.clubForShot(type, gm.pools, gm.club, gm.shotCtx);
      gm.shot = type;
      gm.aim = null;
      if (want !== gm.club && gm.pools[want]) { gm.club = want; gmView(); }
      gmControls();
      gmDraw();
    },
    'gm-motion'() {
      if (!gm || gm.busy || gmSwinging()) return;
      if (gmMo && gmMo.on) { gmMotionStop(); return; }
      if (ui.game.motionOk) { gmMotionStart(); return; }
      gmMo = { ask: true };
      gmControls();
    },
    'gm-motion-arm'() {
      if (!gm || gm.busy || !gmMo || !gmMo.on) return;
      if (gmMotionArmed()) { gmMo.word = ''; gmMotionIdle(''); return; }  // Cancel
      gmMotionArm();
    },
    'gm-motion-go'() {
      if (!gm || gm.busy || gmSwinging()) return;
      gmBeepInit();  // sound has to be switched on in the tap itself
      ui.game.motionOk = true;
      gmMotionStart(true);
    },
    'gm-motion-no'() {
      gmMo = null;
      if (gm) gmControls();
    },
    'gm-practice'(b) {
      if (!gm || gm.busy || gmSwinging()) return;
      ui.game.practice = !ui.game.practice;
      b.setAttribute('aria-pressed', String(ui.game.practice));
      if (gm.pad) { gm.pad.word = ''; gmPadText(); }
    },
    'gm-next'() {
      if (!gm) return;
      const r = gm.round;
      if (r.idx < r.cards.length - 1) r.idx++;
      gmStore(gm.st);
      ui.game.card = false;
      renderGame();
      gmScrollTop();
    },
    'gm-pickup'() {
      if (!gm || gm.busy || gm.card.done) return;
      if (!window.confirm(`Pick up on this hole? It counts as double par (${GM.MAX_OVER * gm.card.par}).`)) return;
      if (gm.meter && gm.meter.raf) cancelAnimationFrame(gm.meter.raf);
      const r = gm.round, card = gm.card;
      Object.assign(card, { done: true, picked: true, score: GM.MAX_OVER * card.par });
      r.ball = null;
      if (r.cards.every((c) => c.done)) gmFinish(r);
      gmStore(gm.st);
      gm.phase = 'holed';
      gmMsg('Picked up', `Double par: ${card.score} on hole ${card.n}.`, '', '');
      gmView();
      gmControls();
      gmDraw();
    },
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
      ui.tab = 'tips'; ui.practiceView = 'drills'; ui.openTip = b.dataset.goto; hideTip(); render();
      const m = /^([\w-]+):(\d+)$/.exec(b.dataset.drill || '');
      const d = (m && document.getElementById(`drill-${m[1]}-${m[2]}`)) || (/^[\w-]+$/.test(b.dataset.goto || '') && $(`details[data-focus="${b.dataset.goto}"]`));
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
    'gm-easy'(el) { const st = gmState(); st.last = Object.assign(gmSettings(st, GM.clubPools(data.sessions, data.equipment)), { easy: el.checked }); gmStore(st); },
    'gm-hand'(el) { const st = gmState(); st.last = Object.assign(gmSettings(st, GM.clubPools(data.sessions, data.equipment)), { hand: el.checked ? 'L' : 'R' }); gmStore(st); renderGame(); },
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
    // On a chart, the arrow keys move from dot to dot (only one of them is a tab stop).
    const pt = e.target && e.target.closest ? e.target.closest('g.pt') : null;
    if (pt && /^(ArrowRight|ArrowDown|ArrowLeft|ArrowUp|Home|End)$/.test(e.key) && pt.ownerSVGElement) {
      const all = Array.from(pt.ownerSVGElement.querySelectorAll('g.pt')), i = all.indexOf(pt);
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : /Right|Down/.test(e.key) ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1);
      e.preventDefault();
      if (all[j] && j !== i) { pt.setAttribute('tabindex', '-1'); all[j].setAttribute('tabindex', '0'); all[j].focus(); }
      return;
    }
    if (e.key === 'Enter' && e.target && e.target.id === 'goalText') { e.preventDefault(); addGoal(); }
    if (e.key === 'Enter' && e.target && /^ck(Carry|Ball|Launch|Off)$/.test(e.target.id)) { e.preventDefault(); runCheck(); }
    if (e.key === 'Enter' && e.target && /^gm(Carry|Total|Off)$/.test(e.target.id)) { e.preventDefault(); actions['gm-live'](); }
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

  // A replay pauses while the page is in the background, and picks up when it's back;
  // a swing on the game's meter starts over.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && gm) gmMeterReset();
    if (document.hidden && gmMo) gmMotionStop();  // no reading the phone's motion in a pocket
    if (!rp) return;
    if (document.hidden && rp.playing) rpPause(true);
    else if (!document.hidden && rp.autoPaused) rpResume();
  });

  // Charts are drawn at the real pixel width, so redraw when the width changes.
  let lastW = window.innerWidth, resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      hideTip();
      fitTabs();
      if (ui.tab === 'stats') renderStats(); else if (ui.tab === 'progress') renderProgress(); else if (ui.tab === 'game') gmResize();
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
        if (gmApplyReset() && ui.tab === 'game') refreshWhenFree();
        if (changed || !data.sessions.length) refreshWhenFree(); else renderBanner();
        syncGoals(); // upload goal changes made earlier on this phone, if it has a key
      })
      .catch(() => {
        if (id !== playerId) return;
        bundleStatus = bundle ? 'offline' : 'missing';
        refreshWhenFree();
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
        const want = C.resolvePlayer(players, askedFor || urlPlayer(), lastPlayer());
        askedFor = null;
        if (want !== playerId) switchPlayer(want); else renderHeader();
      })
      .catch(() => { /* keep the cached or built-in list */ });
  }

  // The web font, switched on now that the page has drawn (index.html loads it as a print sheet).
  const fontCss = document.getElementById('fontCss');
  if (fontCss) fontCss.media = 'all';
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTabs).catch(() => {});
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => fitTabs());
  // A video's thumbnail that doesn't load is taken away (the play button stays).
  document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && t.closest && t.closest('.vid-btn')) t.remove(); }, true);
  loadPlayerState();
  setURL();
  try { localStorage.setItem(LS + '.lastPlayer', playerId); } catch (e) { /* ignore */ }
  render();
  fetchBundle();
  fetchPlayers();
})();
