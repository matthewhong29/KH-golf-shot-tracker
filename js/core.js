/*
 * Golf Shot Tracker: core logic.
 * Pure functions with no DOM access, so the same file runs in the browser
 * (window.GolfCore) and in node (require('./core.js')) for the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GolfCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------
  // Units follow the data file: distances in yards, apex/curve/offline in feet,
  // curve and offline negative = left, positive = right.
  var METRICS = [
    { key: 'carry_yds', label: 'Carry', unit: 'yds', dec: 1 },
    { key: 'total_yds', label: 'Total', unit: 'yds', dec: 1 },
    { key: 'ball_speed_mph', label: 'Ball speed', unit: 'mph', dec: 1 },
    { key: 'launch_deg', label: 'Launch', unit: '°', dec: 1 },
    { key: 'apex_ft', label: 'Apex', unit: 'ft', dec: 1 },
    { key: 'landing_deg', label: 'Landing', unit: '°', dec: 1 },
    { key: 'hang_time_s', label: 'Hang time', unit: 's', dec: 1 },
    { key: 'curve_ft', label: 'Curve', unit: 'ft', dec: 1, dir: true },
    { key: 'offline_ft', label: 'Offline', unit: 'ft', dec: 1, dir: true },
    { key: 'club_speed_mph', label: 'Club speed', unit: 'mph', dec: 1, optional: true },
    { key: 'smash_factor', label: 'Smash factor', unit: '', dec: 2, optional: true },
    { key: 'spin_rpm', label: 'Spin', unit: 'rpm', dec: 0, optional: true }
  ];
  var METRIC = {};
  METRICS.forEach(function (m) { METRIC[m.key] = m; });
  // Keys written on every new shot (null when missing), matching the data file.
  var CORE_KEYS = METRICS.filter(function (m) { return !m.optional; }).map(function (m) { return m.key; });

  // Plausible ranges, used only to flag pasted values that look mis-mapped.
  var SANE = {
    carry_yds: [1, 400], total_yds: [1, 450], ball_speed_mph: [10, 220], club_speed_mph: [10, 160],
    smash_factor: [0.5, 1.7], launch_deg: [-15, 80], apex_ft: [0, 250], landing_deg: [0, 90],
    hang_time_s: [0, 12], spin_rpm: [0, 15000], curve_ft: [-400, 400], offline_ft: [-600, 600]
  };

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function metricValue(shot, key) {
    if (!shot) return null;
    var v = shot[key];
    if (key === 'smash_factor' && !isNum(v) && isNum(shot.ball_speed_mph) && isNum(shot.club_speed_mph) && shot.club_speed_mph > 0) {
      v = shot.ball_speed_mph / shot.club_speed_mph;
    }
    return isNum(v) ? v : null;
  }

  // ---------------------------------------------------------------------------
  // Rounding & formatting
  // ---------------------------------------------------------------------------
  // Round half to even (the convention Python and most stats tools use), so an
  // exact tie like 147.25 shows as 147.2 rather than 147.3.
  function roundHalfEven(x, d) {
    d = d || 0;
    var m = Math.pow(10, d);
    var y = x * m;
    var f = Math.floor(y);
    var diff = y - f;
    var r;
    if (Math.abs(diff - 0.5) < 1e-8) r = (f % 2 === 0) ? f : f + 1;
    else r = Math.round(y);
    r = r / m;
    return r === 0 ? 0 : r; // no negative zero
  }

  var DASH = '—';
  var MINUS = '−';

  function fmtNum(v, dec) {
    if (!isNum(v)) return DASH;
    return roundHalfEven(v, dec).toFixed(dec);
  }
  // Directional value: 5 -> "5.0 R", -1.89 -> "1.9 L", 0 -> "0.0".
  function fmtDir(v, dec) {
    if (!isNum(v)) return DASH;
    var r = roundHalfEven(v, dec);
    if (r === 0) return (0).toFixed(dec);
    return Math.abs(r).toFixed(dec) + (r < 0 ? ' L' : ' R');
  }
  // Raw values (ranges): integers as-is, otherwise one decimal.
  function fmtRaw(v) {
    if (!isNum(v)) return DASH;
    var r = roundHalfEven(v, 1);
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }
  function fmtRawDir(v) {
    if (!isNum(v)) return DASH;
    var r = roundHalfEven(v, 1);
    if (r === 0) return '0';
    return fmtRaw(Math.abs(r)) + (r < 0 ? ' L' : ' R');
  }
  function fmtRange(min, max, dir) {
    if (!isNum(min) && !isNum(max)) return DASH;
    var f = dir ? fmtRawDir : fmtRaw;
    if (!isNum(min)) return '≤ ' + f(max);
    if (!isNum(max)) return '≥ ' + f(min);
    if (roundHalfEven(min, 1) === roundHalfEven(max, 1)) return f(min);
    return dir ? f(min) + ' – ' + f(max) : f(min) + '–' + f(max);
  }
  function fmtAvg(metric, v) {
    var m = typeof metric === 'string' ? METRIC[metric] : metric;
    return m && m.dir ? fmtDir(v, m.dec) : fmtNum(v, m ? m.dec : 1);
  }
  // Signed change: +60, −1.2, ±0
  function fmtSigned(v, dec) {
    if (!isNum(v)) return DASH;
    var r = dec == null ? roundHalfEven(v, 1) : roundHalfEven(v, dec);
    var s = dec == null ? fmtRaw(Math.abs(r)) : Math.abs(r).toFixed(dec);
    if (r === 0) return '±' + s;
    return (r > 0 ? '+' : MINUS) + s;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso, opts) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    var s = MONTHS[+m[2] - 1] + ' ' + (+m[3]);
    return opts && opts.short ? s : s + ', ' + m[1];
  }
  function shortDevice(d) {
    if (!d) return 'Session';
    if (/toptracer/i.test(d)) return 'Toptracer';
    if (/rapsodo/i.test(d)) return 'Rapsodo';
    if (/trackman/i.test(d)) return 'TrackMan';
    if (/garmin/i.test(d)) return 'Garmin';
    return String(d);
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------
  function summarize(shots, key) {
    var of = shots ? shots.length : 0;
    var vals = [];
    for (var i = 0; i < of; i++) {
      var v = metricValue(shots[i], key);
      if (v != null) vals.push(v);
    }
    if (!vals.length) return { n: 0, of: of, avg: null, min: null, max: null, sd: null, values: [] };
    var sum = 0, min = Infinity, max = -Infinity;
    vals.forEach(function (v) { sum += v; if (v < min) min = v; if (v > max) max = v; });
    var avg = sum / vals.length;
    var sd = null;
    if (vals.length > 1) {
      var ss = 0;
      vals.forEach(function (v) { ss += (v - avg) * (v - avg); });
      sd = Math.sqrt(ss / (vals.length - 1));
    }
    return { n: vals.length, of: of, avg: avg, min: min, max: max, sd: sd, values: vals };
  }

  // Quantile with linear interpolation between closest ranks (numpy's default).
  function quantile(arr, q) {
    var a = (arr || []).filter(isNum).slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }
  function median(arr) { return quantile(arr, 0.5); }

  // ---------------------------------------------------------------------------
  // Clubs
  // ---------------------------------------------------------------------------
  // Canonical names follow the data file: PW, 9i, 7i, 5hy, plus 3w, Driver, GW…
  function normClub(raw) {
    if (raw == null) return null;
    var t = String(raw).trim().toLowerCase().replace(/[‐‑‒–—―]/g, '-').replace(/[\s_.\-]+/g, ' ').trim();
    if (!t) return null;
    var m;
    if (/^(?:dr|drv|driver|1 ?w|1 ?wood)$/.test(t)) return 'Driver';
    if ((m = /^([2-9]) ?(?:w|wd|wood|fw|fairway(?: wood)?)$/.exec(t))) return m[1] + 'w';
    if ((m = /^([1-9]) ?(?:h|hy|hyb|hybrid|ut|utility)$/.exec(t))) return m[1] + 'hy';
    if ((m = /^([1-9]) ?(?:i|ir|iron)$/.exec(t))) return m[1] + 'i';
    if (/^(?:pw|pitching|pitching wedge|p wedge)$/.test(t)) return 'PW';
    if (/^(?:gw|aw|uw|gap|gap wedge|approach|approach wedge|a wedge|g wedge|utility wedge)$/.test(t)) return 'GW';
    if (/^(?:sw|sand|sand wedge|s wedge)$/.test(t)) return 'SW';
    if (/^(?:lw|lob|lob wedge|l wedge)$/.test(t)) return 'LW';
    if ((m = /^(4[6-9]|5\d|6[0-4]) ?(?:°|deg|degrees?)? ?(?:w|wedge)$/.exec(t))) return m[1] + '°';
    return null;
  }

  var WEDGE_RANK = { LW: 0, SW: 1, GW: 2, PW: 3 };
  // Short to long. Hybrids sit just past the iron with the same number.
  function clubRank(c) {
    var m;
    if (Object.prototype.hasOwnProperty.call(WEDGE_RANK, c)) return WEDGE_RANK[c];
    if ((m = /^(\d+)°$/.exec(c))) return (64 - +m[1]) / 6;
    if ((m = /^(\d)i$/.exec(c))) return 3 + (10 - +m[1]) * 2;
    if ((m = /^(\d)hy$/.exec(c))) return 4 + (10 - +m[1]) * 2;
    if ((m = /^(\d)w$/.exec(c))) return 40 - +m[1];
    if (c === 'Driver') return 50;
    return 100;
  }
  function sortClubs(list) {
    return list.slice().sort(function (a, b) { return clubRank(a) - clubRank(b) || String(a).localeCompare(String(b)); });
  }
  function clubName(c, names) {
    if (names && names[c]) return names[c];
    var m;
    if (c === 'Driver') return 'Driver';
    if ((m = /^(\d)w$/.exec(c))) return m[1] + ' wood';
    if ((m = /^(\d)hy$/.exec(c))) return m[1] + ' hybrid';
    if ((m = /^(\d)i$/.exec(c))) return m[1] + ' iron';
    if ((m = /^(\d+)°$/.exec(c))) return m[1] + '° wedge';
    return { PW: 'Pitching wedge', GW: 'Gap wedge', SW: 'Sand wedge', LW: 'Lob wedge' }[c] || String(c);
  }
  var STANDARD_CLUBS = ['Driver', '3w', '5w', '7w', '3hy', '4hy', '5hy', '6hy', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'];
  // Mis-hit launch floor: under 5° for woods, hybrids and driver; under 10° for irons and wedges.
  function launchFloor(club) { return /^(Driver|\d+w|\d+hy)$/.test(String(club)) ? 5 : 10; }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------
  function sessionShots(s) { return s && Array.isArray(s.shots) ? s.shots.filter(Boolean) : []; }
  function hasSummary(s) { return !!(s && s.summary && typeof s.summary === 'object' && Object.keys(s.summary).length); }
  function isSummaryOnly(s) { return !sessionShots(s).length && hasSummary(s); }
  function compareSessions(a, b) {
    var da = (a && a.date) || '', db = (b && b.date) || '';
    if (da !== db) return da < db ? -1 : 1;
    var ia = (a && a.id) || '', ib = (b && b.id) || '';
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  }
  function asList(v) {
    if (v == null || v === '') return [];
    return (Array.isArray(v) ? v : [v]).map(String).filter(function (x) { return x.trim(); });
  }

  // Likely mis-hits, judged within each session, so a shot's status doesn't
  // change with whatever other sessions it's pooled with.
  function sessionMishits(sessions) {
    var set = new Set();
    (sessions || []).forEach(function (s) { mishits(sessionShots(s)).forEach(function (m) { set.add(m.shot); }); });
    return set;
  }
  // Outliers, judged within each session the same way.
  function sessionOutliers(sessions) {
    var set = new Set();
    (sessions || []).forEach(function (s) { outliers(sessionShots(s)).forEach(function (o) { set.add(o.shot); }); });
    return set;
  }

  // { club: { club, shots: [all], solid: [...], mis: [...], outliers: [...], ranges: { metric: {min,max,avg?} } } }
  // Every computed number uses `solid`. Mis-hits and outliers stay in `shots` for
  // the charts, and outliers still count as solid contact (see solidCount).
  function clubData(sessions) {
    var out = {};
    var mis = sessionMishits(sessions), odd = sessionOutliers(sessions);
    function get(c) { return out[c] || (out[c] = { club: c, shots: [], solid: [], mis: [], outliers: [], ranges: {} }); }
    (sessions || []).forEach(function (s) {
      sessionShots(s).forEach(function (shot) {
        if (!shot.club) return;
        var e = get(shot.club);
        e.shots.push(shot);
        (mis.has(shot) ? e.mis : odd.has(shot) ? e.outliers : e.solid).push(shot);
      });
      if (hasSummary(s)) {
        Object.keys(s.summary).forEach(function (club) {
          var e = get(club), metrics = s.summary[club] || {};
          Object.keys(metrics).forEach(function (key) {
            var r = metrics[key];
            if (r && typeof r === 'object' && (isNum(r.min) || isNum(r.max) || isNum(r.avg))) e.ranges[key] = r;
          });
        });
      }
    });
    return out;
  }
  function entryHasData(e) { return !!e && (e.shots.length > 0 || Object.keys(e.ranges).length > 0); }
  // Shots with solid contact: every shot but the likely mis-hits, so outliers count.
  function solidCount(entry) { return entry && entry.shots ? entry.shots.length - (entry.mis || []).length : 0; }
  function solidPct(entry) { return entry && entry.shots && entry.shots.length ? 100 * solidCount(entry) / entry.shots.length : null; }
  var SOLID_METRIC = { key: 'solid_pct', label: 'Solid contact', unit: '%', dec: 0 };

  // "Needs work" flags for one club, from its solid shots. Three simple rules a
  // beginner can act on:
  //   contact:   fewer than 80% of the club's shots were solid
  //   direction: the average shot finishes 10+ yds left or right of the target
  //              (a third of a 30-yard fairway)
  //   distance:  carry varies a lot: standard deviation over 15% of the average
  //              carry, judged only with 4+ solid shots
  // Each flag names the stat it belongs to (`key`) so the page can highlight it.
  var NEEDS_WORK = { solidPct: 80, missYds: 10, carryCv: 0.15, minCvShots: 4 };
  function needsWork(entry) {
    var out = [];
    if (!entry || !entry.shots || !entry.shots.length) return out;
    var sp = solidPct(entry);
    if (sp != null && sp < NEEDS_WORK.solidPct) {
      out.push({ kind: 'contact', key: 'solid_pct', text: entry.mis.length + ' of ' + plural(entry.shots.length, 'shot') + ' were mis-hits' });
    }
    var off = summarize(entry.solid, 'offline_ft');
    if (off.n && Math.abs(off.avg) / 3 >= NEEDS_WORK.missYds) {
      out.push({ kind: 'direction', key: 'offline_ft', text: 'misses about ' + fmtNum(Math.abs(off.avg) / 3, 0) + ' yds ' + (off.avg < 0 ? 'left' : 'right') + ' on average' });
    }
    var car = summarize(entry.solid, 'carry_yds');
    if (car.n >= NEEDS_WORK.minCvShots && car.avg > 0 && isNum(car.sd) && car.sd / car.avg > NEEDS_WORK.carryCv) {
      out.push({ kind: 'distance', key: 'carry_yds', text: 'carry varies a lot, ' + fmtRaw(car.min) + ' to ' + fmtRaw(car.max) + ' yds' });
    }
    return out;
  }

  // Personal and coach goals: the shared list from the data file
  // (`personal_goals`), plus changes made on this device:
  // { added: [goal], edits: { id: { done, text } }, removed: [id] }.
  // A goal is { id, text, source: 'coach' | 'me', added: 'YYYY-MM-DD', done }.
  function mergeGoals(fileGoals, localGoals) {
    var lg = localGoals || {};
    var removed = lg.removed || [], edits = lg.edits || {};
    var out = [], seen = {};
    (Array.isArray(fileGoals) ? fileGoals : []).concat(Array.isArray(lg.added) ? lg.added : []).forEach(function (g) {
      if (!g || typeof g !== 'object' || !g.id || !g.text || seen[g.id] || removed.indexOf(g.id) >= 0) return;
      seen[g.id] = true;
      var e = edits[g.id] || {};
      out.push({
        id: g.id, text: e.text || g.text, source: /coach/i.test(String(g.source || '')) ? 'coach' : 'me',
        added: g.added || null, done: e.done != null ? !!e.done : !!g.done
      });
    });
    return out;
  }

  // Apply this device's goal changes to a parsed data file, for saving it back to
  // the repo. Returns a new object with the same key order (personal_goals goes
  // before sessions if it wasn't there), or null when nothing would change.
  function applyGoals(fileObj, localGoals) {
    if (!fileObj || typeof fileObj !== 'object') return null;
    var before = Array.isArray(fileObj.personal_goals) ? fileObj.personal_goals : [];
    var merged = mergeGoals(before, localGoals).map(function (g) {
      return { id: g.id, text: g.text, source: g.source, added: g.added, done: g.done };
    });
    if (JSON.stringify(merged) === JSON.stringify(before)) return null;
    var out = {}, placed = false;
    Object.keys(fileObj).forEach(function (k) {
      if (k === 'personal_goals') { out.personal_goals = merged; placed = true; return; }
      if (k === 'sessions' && !placed) { out.personal_goals = merged; placed = true; }
      out[k] = fileObj[k];
    });
    if (!placed) out.personal_goals = merged;
    return out;
  }

  // Ballpark launch windows (degrees) for a modest swing speed. Slower swings
  // launch a little higher than tour players, so these sit a few degrees above
  // tour averages. They're targets to aim at, not hard rules.
  var LAUNCH_WINDOWS = {
    LW: [32, 36], SW: [30, 34], GW: [28, 32], PW: [26, 30],
    '9i': [23, 27], '8i': [21, 25], '7i': [19, 23], '6i': [17, 21], '5i': [15, 19], '4i': [14, 18], '3i': [13, 17],
    '6hy': [16, 20], '5hy': [15, 19], '4hy': [14, 18], '3hy': [13, 17],
    '7w': [13, 17], '5w': [12, 16], '4w': [11, 15], '3w': [11, 15], Driver: [12, 16]
  };
  // A player's clubs, from his data file: equipment.bag = { "7i": { model, loft_deg }, ... }.
  function clubSpec(club, equip) {
    var bag = equip && equip.bag;
    return bag && bag[club] && typeof bag[club] === 'object' ? bag[club] : null;
  }
  function clubLoft(club, equip) {
    var spec = clubSpec(club, equip);
    return spec && isNum(spec.loft_deg) ? spec.loft_deg : null;
  }
  // Launch window for a club. When the player's data file gives the club's loft,
  // the window is ±2° around what a solid strike at a modest swing speed usually
  // launches at: about 64% of the loft for irons and wedges, 68% for hybrids
  // (their weight sits lower and farther back), 75% for fairway woods, and about
  // 3° above the loft for a driver hit off a tee. Without a loft, the ballpark
  // LAUNCH_WINDOWS apply.
  var LAUNCH_PER_LOFT = { iron: 0.64, hybrid: 0.68, wood: 0.75 };
  function clubKind(club) {
    var c = String(club);
    if (c === 'Driver') return 'driver';
    if (/^\d+w$/.test(c)) return 'wood';
    if (/^\d+hy$/.test(c)) return 'hybrid';
    return 'iron';
  }
  function launchWindow(club, equip) {
    var loft = clubLoft(club, equip);
    if (loft != null) {
      var kind = clubKind(club);
      var c = roundHalfEven(kind === 'driver' ? loft + 3 : LAUNCH_PER_LOFT[kind] * loft, 0);
      return [c - 2, c + 2];
    }
    return LAUNCH_WINDOWS[club] || null;
  }

  // ----- Pure strikes: what a well-struck shot does for this player -----
  // His best-struck shots with a club: solid shots that weren't launched more
  // than 4° below the club's launch window (those are usually thin), then the top
  // quarter by ball speed, ties included and at least 2 shots. Ball speed is the
  // best sign of a centred strike that Toptracer shows. Without ball speed the
  // top quarter by carry is used instead.
  function topQuarter(pool, key) {
    var sorted = pool.slice().sort(function (a, b) { return b[key] - a[key]; });
    var k = Math.max(Math.min(2, sorted.length), Math.ceil(sorted.length / 4));
    var cut = sorted[k - 1][key];
    return sorted.filter(function (s) { return s[key] >= cut; });
  }
  function bestStrikes(entry, club, equip) {
    if (!entry || !entry.solid) return { shots: [], by: null };
    var win = launchWindow(club, equip), floor = win ? win[0] - 4 : -Infinity;
    var normal = entry.solid.filter(function (s) { return isNum(s.carry_yds) && !(isNum(s.launch_deg) && s.launch_deg < floor); });
    var withSpeed = normal.filter(function (s) { return isNum(s.ball_speed_mph); });
    if (withSpeed.length) return { shots: topQuarter(withSpeed, 'ball_speed_mph'), by: 'ball_speed_mph' };
    if (normal.length) return { shots: topQuarter(normal, 'carry_yds'), by: 'carry_yds' };
    return { shots: [], by: null };
  }
  var REF_KEYS = ['carry_yds', 'total_yds', 'ball_speed_mph', 'launch_deg', 'apex_ft', 'landing_deg'];
  // Reference numbers for a pure strike with this club: averages and ranges of
  // the best strikes, plus the pure-strike carry rounded to a yard.
  function strikeReference(entry, club, equip) {
    var b = bestStrikes(entry, club, equip);
    if (!b.shots.length) return null;
    var m = {};
    REF_KEYS.forEach(function (k) {
      var s = summarize(b.shots, k);
      if (s.n) m[k] = { avg: s.avg, min: s.min, max: s.max, n: s.n };
    });
    return { club: club, n: b.shots.length, solid: entry.solid.length, by: b.by, carry: roundHalfEven(m.carry_yds.avg, 0), metrics: m };
  }

  // Smallest carry window (± yds) worth aiming at for each kind of club.
  function minCarryWindow(club) {
    var c = String(club);
    if (/^(LW|SW|GW|AW|PW|\d{2}°)$/.test(c)) return 5;
    if (/^\d+i$/.test(c)) return 6;
    return 8;
  }
  var GOALS = { inZone: 0.7, onLine: 0.8, lineFt: 30, solidPct: 90 };

  // Range goals for one club, built from the player's own shots:
  //   distance:   a carry zone centred on the club's pure-strike carry (see
  //               strikeReference), ± a window 25% tighter than his current
  //               spread (never tighter than minCarryWindow); met when 7 of 10
  //               shots land in it
  //   on line:    8 of 10 shots finish within 10 yds (30 ft) of the target line
  //   launch:     average launch of solid shots inside LAUNCH_WINDOWS
  //   contact:    9 of 10 swings solid
  // `focus` picks the one thing to work on first: contact, then direction, then
  // launch, then distance.
  function clubGoals(entry, club, equip) {
    if (!entry || !entry.shots || !entry.shots.length) return null;
    var goals = [], g = {};
    function add(x) { goals.push(x); g[x.id] = x; }
    var ref = strikeReference(entry, club, equip);
    var solidCarry = entry.solid.map(function (s) { return s.carry_yds; }).filter(isNum);
    if (solidCarry.length) {
      // Centred on the pure-strike carry (falls back to the upper-quartile carry).
      var center = ref ? ref.carry : roundHalfEven(quantile(solidCarry, 0.75), 0);
      var half = minCarryWindow(club);
      var car = summarize(entry.solid, 'carry_yds');
      if (car.n >= NEEDS_WORK.minCvShots && isNum(car.sd)) half = Math.max(half, roundHalfEven(0.75 * car.sd, 0));
      var withCarry = entry.shots.filter(function (s) { return isNum(s.carry_yds); });
      var inZone = withCarry.filter(function (s) { return s.carry_yds >= center - half && s.carry_yds <= center + half; }).length;
      add({ id: 'carry', label: 'Distance', lo: center - half, hi: center + half, center: center, pure: !!ref, n: inZone, of: withCarry.length,
        met: inZone / withCarry.length >= GOALS.inZone });
    }
    var offShots = entry.shots.filter(function (s) { return isNum(s.offline_ft); });
    if (offShots.length) {
      var within = offShots.filter(function (s) { return Math.abs(s.offline_ft) <= GOALS.lineFt; }).length;
      add({ id: 'line', label: 'On line', n: within, of: offShots.length, met: within / offShots.length >= GOALS.onLine });
    }
    var win = launchWindow(club, equip), la = summarize(entry.solid, 'launch_deg');
    if (win && la.n) {
      var status = la.avg > win[1] ? 'high' : la.avg < win[0] ? 'low' : 'ok';
      add({ id: 'launch', label: 'Launch', lo: win[0], hi: win[1], avg: la.avg, status: status, met: status === 'ok' });
    }
    add({ id: 'contact', label: 'Solid contact', n: solidCount(entry), of: entry.shots.length, met: solidPct(entry) >= GOALS.solidPct });

    var flags = needsWork(entry);
    var focus;
    if (!g.contact.met) focus = { kind: 'contact', text: 'Solid contact first: hit the ball, then the ground.' };
    else if (g.line && !g.line.met && (g.line.n / g.line.of < 0.5 || flags.some(function (f) { return f.kind === 'direction'; }))) {
      focus = { kind: 'direction', text: 'Start it on line: check your aim and grip before every shot.' };
    } else if (g.launch && g.launch.status === 'high') focus = { kind: 'launch', text: 'Lower launch: keep your hands ahead of the ball at impact.' };
    else if (g.launch && g.launch.status === 'low') focus = { kind: 'launch', text: 'A little more height: let the club’s loft do the work.' };
    else if (g.carry && !g.carry.met) focus = { kind: 'distance', text: 'Same distance every time: pick one target and land it in your carry zone.' };
    else if (g.line && !g.line.met) focus = { kind: 'direction', text: 'Start it on line: check your aim and grip before every shot.' };
    else focus = { kind: null, text: 'Keep it going: every goal here is on target.' };
    return { focus: focus, goals: goals, ref: ref };
  }

  // Compare one live shot from the range screen with the player's numbers for
  // that club. shot: { carry_yds, ball_speed_mph, launch_deg, offline_ft }, any
  // of them missing. Returns { verdict: 'pure' | 'good' | 'mishit' | 'keep',
  // title, lines: [{ key, ok: true | false | null, text }] }.
  function checkShot(entry, club, shot, equip) {
    var G = clubGoals(entry, club, equip);
    if (!G) return null;
    shot = shot || {};
    var ref = G.ref, lines = [], bad = 0, good = 0;
    var zone = G.goals.filter(function (g) { return g.id === 'carry'; })[0];
    var minBs = ref && ref.metrics.ball_speed_mph ? ref.metrics.ball_speed_mph.min : null;
    var bs = shot.ball_speed_mph, carry = shot.carry_yds, la = shot.launch_deg, off = shot.offline_ft;
    function line(key, ok, text) { lines.push({ key: key, ok: ok, text: text }); if (ok === true) good++; if (ok === false) bad++; }
    if (isNum(bs) && isNum(minBs)) {
      if (bs >= minBs) line('ball', true, 'Ball speed ' + fmtRaw(bs) + ' mph: pure-strike speed (' + fmtRaw(minBs) + '+).');
      else if (bs >= 0.95 * minBs) line('ball', null, 'Ball speed ' + fmtRaw(bs) + ' mph: close to a pure strike (' + fmtRaw(minBs) + '+).');
      else line('ball', false, 'Ball speed ' + fmtRaw(bs) + ' mph is low for a pure strike (' + fmtRaw(minBs) + '+), so it was likely off-centre.');
    }
    if (isNum(carry) && zone) {
      if (carry >= zone.lo && carry <= zone.hi) line('carry', true, 'Carry ' + fmtRaw(carry) + ' yds: in your ' + zone.lo + '–' + zone.hi + ' yd zone.');
      else if (carry < zone.lo) line('carry', false, 'Carry ' + fmtRaw(carry) + ' yds: ' + fmtRaw(roundHalfEven(zone.lo - carry, 1)) + ' short of your ' + zone.lo + '–' + zone.hi + ' yd zone.');
      else line('carry', null, 'Carry ' + fmtRaw(carry) + ' yds: ' + fmtRaw(roundHalfEven(carry - zone.hi, 1)) + ' past your ' + zone.lo + '–' + zone.hi + ' yd zone.');
    }
    var win = launchWindow(club, equip);
    if (isNum(la) && win) {
      if (la >= win[0] && la <= win[1]) line('launch', true, 'Launch ' + fmtRaw(la) + '°: in the ' + win[0] + '–' + win[1] + '° window.');
      else if (la > win[1]) line('launch', false, 'Launch ' + fmtRaw(la) + '° is high (aim for ' + win[0] + '–' + win[1] + '°): keep your hands ahead.');
      else line('launch', false, 'Launch ' + fmtRaw(la) + '° is low (aim for ' + win[0] + '–' + win[1] + '°).');
    }
    if (isNum(off)) {
      var dir = off < 0 ? ' L' : off > 0 ? ' R' : '';
      if (Math.abs(off) <= GOALS.lineFt) line('line', true, 'On line: ' + fmtRaw(Math.abs(off)) + ' ft' + dir + '.');
      else line('line', false, fmtRaw(Math.abs(off)) + ' ft' + dir + ' (' + fmtNum(Math.abs(off) / 3, 0) + ' yds): outside the 10-yd target.');
    }
    var mis = (isNum(la) && la < launchFloor(club)) || (isNum(carry) && ref && carry < 0.6 * ref.carry);
    var ballOk = lines.some(function (l) { return l.key === 'ball' && l.ok === true; });
    var carryOk = lines.some(function (l) { return l.key === 'carry' && l.ok === true; });
    var verdict = mis ? 'mishit' : ballOk && carryOk ? 'pure' : good && !bad ? 'good' : 'keep';
    var title = { mishit: 'Looks thin or topped', pure: 'Pure strike!', good: 'Good shot', keep: 'Keep working' }[verdict];
    return { verdict: verdict, title: title, lines: lines };
  }

  // Summary of a metric over the club's solid shots ("n of N" counts solid
  // shots); { allMis: true } when every shot was a mis-hit; the recorded range
  // for summary-only sessions; else null.
  function metricStat(entry, key) {
    if (!entry) return null;
    var solid = entry.solid || entry.shots;
    var s = summarize(solid, key);
    if (s.n) return s;
    var mis = entry.mis || [];
    if (!solid.length && mis.some(function (x) { return metricValue(x, key) != null; })) {
      return { n: 0, of: 0, avg: null, min: null, max: null, sd: null, values: [], allMis: true, total: entry.shots.length };
    }
    var r = entry.ranges && entry.ranges[key];
    if (r) {
      return { n: 0, of: 0, avg: isNum(r.avg) ? r.avg : null, min: isNum(r.min) ? r.min : null,
        max: isNum(r.max) ? r.max : null, sd: null, values: [], summaryOnly: true };
    }
    return null;
  }

  // A likely thin, topped or fat shot: launch under 10° (5° for woods, hybrids
  // and driver), or carry under 60% of that club's upper-quartile carry. The
  // upper quartile stays sensible even when most of a club's shots were
  // mis-hit, where the median would not.
  function mishits(shots) {
    var by = {};
    (shots || []).forEach(function (s) { if (s && s.club) (by[s.club] || (by[s.club] = [])).push(s); });
    var q3 = {};
    Object.keys(by).forEach(function (c) { q3[c] = quantile(by[c].map(function (s) { return s.carry_yds; }), 0.75); });
    var out = [];
    (shots || []).forEach(function (s) {
      if (!s) return;
      var reasons = [];
      if (isNum(s.launch_deg) && s.launch_deg < launchFloor(s.club)) reasons.push('low launch');
      if (isNum(s.carry_yds) && by[s.club] && by[s.club].length >= 2 && isNum(q3[s.club]) && s.carry_yds < 0.6 * q3[s.club]) reasons.push('short carry');
      if (reasons.length) out.push({ shot: s, reasons: reasons });
    });
    return out;
  }

  // Outliers: solid shots whose carry is far off that club's usual in the session,
  // like a soft warm-up swing or a freak long one. They're left out of the
  // numbers (averages, ranges, pure strike, gapping) but still count as solid
  // contact, and in hit rates such as on line and in the carry zone.
  // The rule, for a club with 5+ solid shots: carry more than 3.5 robust standard
  // deviations from the median, i.e. 0.6745 × |carry − median| / MAD > 3.5, where
  // MAD is the median distance from the median. MAD is never taken below 3% of
  // the median, so a tight group can't turn ordinary shots into outliers: an
  // outlier is always at least about 16% shorter or longer than usual.
  var OUTLIER = { z: 3.5, minShots: 5, madFloor: 0.03 };
  function outliers(shots) {
    var bad = new Set(mishits(shots).map(function (m) { return m.shot; }));
    var by = {};
    (shots || []).forEach(function (s) { if (s && s.club && !bad.has(s) && isNum(s.carry_yds)) (by[s.club] || (by[s.club] = [])).push(s); });
    var hit = new Map();
    Object.keys(by).forEach(function (c) {
      var list = by[c];
      if (list.length < OUTLIER.minShots) return;
      var carries = list.map(function (s) { return s.carry_yds; });
      var med = median(carries);
      var mad = Math.max(median(carries.map(function (v) { return Math.abs(v - med); })), OUTLIER.madFloor * Math.abs(med));
      if (!(mad > 0)) return;
      list.forEach(function (s) {
        var z = 0.6745 * (s.carry_yds - med) / mad;
        if (Math.abs(z) > OUTLIER.z) hit.set(s, { shot: s, side: z < 0 ? 'short' : 'long', usual: med });
      });
    });
    return (shots || []).filter(function (s) { return hit.has(s); }).map(function (s) { return hit.get(s); });
  }
  // " Mis-hits are left out." and the like, for lines built from the numbers.
  function leftOutNote(nMis, nOut) {
    if (!nMis && !nOut) return '';
    return ' ' + (nMis && nOut ? 'Mis-hits and outliers are' : nMis ? 'Mis-hits are' : 'Outliers are') + ' left out.';
  }
  // "1 outlier, far off the usual carry: Driver 132 yds (usually 162). …"
  // usual: { club: typical carry } from the shots that count.
  function outlierText(odd, usual) {
    var clubs = sortClubs(odd.map(function (o) { return o.shot.club; }).filter(function (c, i, a) { return a.indexOf(c) === i; }));
    var parts = clubs.map(function (c) {
      var v = odd.filter(function (o) { return o.shot.club === c; }).map(function (o) { return o.shot.carry_yds; }).sort(function (a, b) { return a - b; });
      var vals = v.length <= 6 ? joinList(v.map(fmtRaw)) : v.length + ' shots from ' + fmtRaw(v[0]) + ' to ' + fmtRaw(v[v.length - 1]);
      return c + ' ' + vals + ' yds' + (usual && isNum(usual[c]) ? ' (usually ' + fmtRaw(roundHalfEven(usual[c], 0)) + ')' : '');
    });
    var one = odd.length === 1;
    return plural(odd.length, 'outlier') + ', far off the usual carry: ' + parts.join('; ') + '. ' +
      (one ? 'It’s' : 'They’re') + ' left out of the numbers but still count' + (one ? 's' : '') + ' as solid contact.';
  }
  function joinList(a) { return a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function minOf(arr) { var a = arr.filter(isNum); return a.length ? Math.min.apply(null, a) : null; }
  function pct(n, of) { return roundHalfEven(100 * n / of, 0) + '%'; }

  function contactText(bad) {
    var clubs = sortClubs(bad.map(function (b) { return b.shot.club; }).filter(function (c, i, a) { return a.indexOf(c) === i; }));
    var many = bad.length > 1;
    var low = minOf(bad.map(function (b) { return b.shot.launch_deg; }));
    var short = minOf(bad.map(function (b) { return b.shot.carry_yds; }));
    var detail = [];
    if (low != null) detail.push((many ? 'launch as low as ' : 'launch ') + fmtRaw(low) + '°');
    if (short != null) detail.push((many ? 'carry as short as ' : 'carry ') + fmtRaw(short) + ' yds');
    var who = clubs.length === 1
      ? (many ? ', all with the ' : ', with the ') + clubs[0]
      : ': ' + clubs.map(function (c) { return c + ' ×' + bad.filter(function (b) { return b.shot.club === c; }).length; }).join(', ');
    return plural(bad.length, 'likely thin or topped shot') + who + (detail.length ? ' (' + detail.join(', ') + ')' : '') + '.';
  }

  // Plain-language highlights for the sessions in scope. Numbers use solid shots.
  function buildHighlights(scope, baseline) {
    var out = [];
    scope = scope || [];
    var shots = [], bad = [], odd = [];
    scope.forEach(function (s) {
      sessionShots(s).forEach(function (x) { shots.push(x); });
      mishits(sessionShots(s)).forEach(function (m) { bad.push(m); });
      outliers(sessionShots(s)).forEach(function (o) { odd.push(o); });
    });
    var data = clubData(scope);
    var clubs = sortClubs(Object.keys(data));
    if (shots.length) {
      var shotClubs = clubs.filter(function (c) { return data[c].shots.length; });
      out.push({ id: 'count', text: plural(shots.length, 'shot') + ' with ' + plural(shotClubs.length, 'club') + ' (' + shotClubs.join(', ') + ').' });
      out.push({ id: 'solid', text: 'Solid contact: ' + (shots.length - bad.length) + ' of ' + plural(shots.length, 'shot') + ' (' + pct(shots.length - bad.length, shots.length) + ').' });

      if (!bad.length) {
        var launch = summarize(shots, 'launch_deg');
        var lowClubs = [];
        if (launch.n) shots.forEach(function (s) { if (s.launch_deg === launch.min && lowClubs.indexOf(s.club) < 0) lowClubs.push(s.club); });
        out.push({ id: 'contact', text: 'No thin or topped shots' + (launch.n ? ', lowest launch ' + fmtRaw(launch.min) + '° (' + sortClubs(lowClubs).join(', ') + ')' : '') + '.' });
      } else {
        out.push({ id: 'contact', text: contactText(bad) });
      }
      if (odd.length) {
        var usual = {};
        shotClubs.forEach(function (c) { usual[c] = median(data[c].solid.map(function (x) { return x.carry_yds; })); });
        out.push({ id: 'outliers', text: outlierText(odd, usual) });
      }

      var miss = shotClubs.map(function (c) { return { club: c, st: summarize(data[c].solid, 'offline_ft') }; })
        .filter(function (x) { return x.st.n; });
      if (miss.length >= 2) {
        var text = 'Average miss: ' + miss.map(function (x) { return x.club + ' ' + fmtDir(x.st.avg / 3, 1); }).join(' · ') + ' yds.';
        if (miss.length >= 3) {
          var a = miss.map(function (x) { return x.st.avg; });
          if (a.every(function (v, i) { return !i || v > a[i - 1]; })) text += ' The miss moves farther right as the clubs get longer.';
          else if (a.every(function (v, i) { return !i || v < a[i - 1]; })) text += ' The miss moves farther left as the clubs get longer.';
        }
        text += leftOutNote(bad.length, odd.length);
        out.push({ id: 'miss', text: text });
      }

      var work = shotClubs.map(function (c) { return { club: c, flags: needsWork(data[c]) }; })
        .filter(function (w) { return w.flags.length; });
      if (work.length) {
        out.push({ id: 'work', clubs: work, text: 'Needs work: ' + work.map(function (w) {
          return w.club + ' (' + w.flags.map(function (f) { return f.text; }).join('; ') + ')';
        }).join(', ') + '.' });
      }
    } else if (clubs.length) {
      out.push({ id: 'count', text: 'Ranges only; individual shots weren’t recorded.' });
      var parts = [];
      clubs.forEach(function (c) {
        var l = metricStat(data[c], 'launch_deg'), cr = metricStat(data[c], 'carry_yds');
        var lowL = l && isNum(l.min) && l.min < launchFloor(c);
        var lowC = cr && isNum(cr.min) && isNum(cr.max) && cr.min < 0.6 * cr.max;
        if (!lowL && !lowC) return;
        var seg = [];
        if (l && isNum(l.min)) seg.push('launch as low as ' + fmtRaw(l.min) + '°');
        if (cr && isNum(cr.min)) seg.push('carry as short as ' + fmtRaw(cr.min) + ' yds');
        parts.push(c + ' ' + seg.join(', '));
      });
      if (parts.length) out.push({ id: 'contact', text: 'Thin or topped contact: ' + parts.join('; ') + '.' });
    }

    if (scope.length === 1 && baseline && baseline.id !== scope[0].id) {
      var bd = clubData([baseline]);
      var bparts = [];
      clubs.forEach(function (c) {
        if (!bd[c]) return;
        var seg = [];
        var ac = metricStat(bd[c], 'carry_yds'), bc = metricStat(data[c], 'carry_yds');
        if (ac && bc && isNum(ac.min) && isNum(bc.min)) seg.push('shortest carry ' + fmtRaw(ac.min) + ' → ' + fmtRaw(bc.min) + ' yds');
        var al = metricStat(bd[c], 'launch_deg'), bl = metricStat(data[c], 'launch_deg');
        if (al && bl && isNum(al.min) && isNum(bl.min)) seg.push('lowest launch ' + fmtRaw(al.min) + '° → ' + fmtRaw(bl.min) + '°');
        if (seg.length) bparts.push(c + ' ' + seg.join(', '));
      });
      if (bparts.length) out.push({ id: 'baseline', text: 'Since ' + fmtDate(baseline.date) + ' (baseline): ' + bparts.join('; ') + '.' });
    } else if (scope.length === 1 && baseline && baseline.id === scope[0].id) {
      out.push({ id: 'baseline', text: 'This is the baseline session that progress is measured from.' });
    }
    return out;
  }

  // Sessions that have data for a club, oldest first, with the baseline picked
  // from baselineId when that session has the club, else the club's first session.
  function progressFor(sessions, club, baselineId) {
    var rows = [];
    (sessions || []).slice().sort(compareSessions).forEach(function (s) {
      var e = clubData([s])[club];
      if (entryHasData(e)) rows.push({ session: s, entry: e });
    });
    var baseline = null;
    rows.forEach(function (r) { if (r.session.id === baselineId) baseline = r; });
    var fallback = !baseline && rows.length > 0;
    if (!baseline) baseline = rows[0] || null;
    return { rows: rows, baseline: baseline, latest: rows.length ? rows[rows.length - 1] : null, fallback: fallback };
  }
  function compareStats(a, b) {
    if (!a || !b) return null;
    function d(x, y) { return isNum(x) && isNum(y) ? y - x : null; }
    function spread(s) { return isNum(s.min) && isNum(s.max) ? s.max - s.min : null; }
    return { dMin: d(a.min, b.min), dMax: d(a.max, b.max), dAvg: d(a.avg, b.avg), spreadA: spread(a), spreadB: spread(b) };
  }

  // Better or worse since the baseline, and by how much. `better` says what counts as better:
  // 'up' (a higher average), 'line' (closer to the target line on average, so less miss or less bend,
  // which doesn't depend on how many shots were hit) or 'target' (an average closer to the club's
  // launch window). steps are the changes that count as a little, clearly and a lot (a share
  // of the baseline when rel). Apex, landing angle, hang time and spin aren't better higher or lower,
  // so they get no verdict.
  var TREND = {
    solid_pct: { better: 'up', steps: [3, 8, 20] },
    carry_yds: { better: 'up', rel: true, steps: [0.015, 0.04, 0.08] },
    total_yds: { better: 'up', rel: true, steps: [0.015, 0.04, 0.08] },
    ball_speed_mph: { better: 'up', rel: true, steps: [0.015, 0.035, 0.07] },
    club_speed_mph: { better: 'up', rel: true, steps: [0.015, 0.035, 0.07] },
    smash_factor: { better: 'up', steps: [0.02, 0.05, 0.1] },
    launch_deg: { better: 'target', steps: [0.5, 1.5, 4] },
    curve_ft: { better: 'line', steps: [0.1, 0.25, 0.45] },
    offline_ft: { better: 'line', steps: [0.1, 0.25, 0.45] }
  };
  // a, b: metricStat-style stats for the baseline and the latest session ({ avg } is enough for solid
  // contact). opts.window: the launch window [lo, hi]. Returns null when there's no fair comparison, else
  // { dir: 'better' | 'worse' | 'same', level: 0 (same) to 3 (a lot), basis, few }.
  // basis 'best' means the baseline had ranges only, so the longest shots were compared.
  function trend(key, a, b, opts) {
    var t = TREND[key];
    if (!t || !a || !b || a.allMis || b.allMis) return null;
    var shots = !a.summaryOnly && !b.summaryOnly, both = shots && isNum(a.avg) && isNum(b.avg);
    var gain = null, size = null, basis = null, from = null, to = null;
    function rel(d, base) { return t.rel ? Math.abs(d) / Math.max(Math.abs(base), 1e-9) : Math.abs(d); }
    if (t.better === 'up') {
      if (both) { gain = b.avg - a.avg; size = rel(gain, a.avg); basis = 'average'; from = a.avg; to = b.avg; }
      else if (isNum(a.max) && isNum(b.max)) { gain = b.max - a.max; size = rel(gain, a.max); basis = 'best'; from = a.max; to = b.max; }
    } else if (t.better === 'line') {
      var mean = function (v) { return v.reduce(function (x, y) { return x + Math.abs(y); }, 0) / v.length; };
      if (shots && a.values && a.values.length && b.values && b.values.length) {
        var ma = mean(a.values), mb = mean(b.values);
        gain = ma - mb; size = Math.abs(gain) / Math.max(ma, 3); basis = 'line'; from = ma; to = mb;
      }
    } else if (t.better === 'target') {
      var w = opts && opts.window;
      if (both && w) {
        var off = function (v) { return v < w[0] ? w[0] - v : v > w[1] ? v - w[1] : 0; };
        from = off(a.avg); to = off(b.avg); gain = from - to; size = Math.abs(gain); basis = 'target';
      }
    }
    if (gain == null) return null;
    var level = size < t.steps[0] ? 0 : size < t.steps[1] ? 1 : size < t.steps[2] ? 2 : 3;
    var few = shots && ((a.n != null && a.n < 3) || (b.n != null && b.n < 3));
    return { dir: level === 0 ? 'same' : gain > 0 ? 'better' : 'worse', level: level, basis: basis, from: from, to: to, few: !!few };
  }

  // ---------------------------------------------------------------------------
  // Tips & players
  // ---------------------------------------------------------------------------
  function latestShotSession(sessions) {
    var withShots = (sessions || []).filter(function (s) { return sessionShots(s).length; }).sort(compareSessions);
    return withShots.length ? withShots[withShots.length - 1] : null;
  }
  // "From your last session" line for a tip; null when there's no shot data.
  // kind: mishits | launch | miss | carry
  function sessionCallout(kind, sessions) {
    var s = latestShotSession(sessions);
    if (!s) return null;
    var shots = sessionShots(s);
    var data = clubData([s]);
    var clubs = sortClubs(Object.keys(data)).filter(function (c) { return data[c].shots.length; });
    var bad = mishits(shots);
    var note = leftOutNote(bad.length, outliers(shots).length);
    function per(key, fmt) {
      return clubs.map(function (c) { var st = summarize(data[c].solid, key); return st.n ? c + ' ' + fmt(st.avg) : null; }).filter(Boolean);
    }
    var text = null, list;
    if (kind === 'mishits') {
      text = bad.length
        ? contactText(bad) + ' Solid contact: ' + (shots.length - bad.length) + ' of ' + plural(shots.length, 'shot') + ' (' + pct(shots.length - bad.length, shots.length) + ').'
        : 'No thin or topped shots in ' + plural(shots.length, 'shot') + '.';
    } else if (kind === 'launch') {
      list = per('launch_deg', function (v) { return fmtNum(v, 1) + '°'; });
      if (list.length) text = 'Average launch: ' + list.join(' · ') + '.' + note;
    } else if (kind === 'miss') {
      list = per('offline_ft', function (v) { return fmtDir(v / 3, 1); });
      if (list.length) text = 'Average miss: ' + list.join(' · ') + ' yds.' + note;
    } else if (kind === 'carry') {
      list = per('carry_yds', function (v) { return fmtNum(v, 1); });
      if (list.length) text = 'Average carry: ' + list.join(' · ') + ' yds.' + note;
    }
    return text ? { sessionId: s.id, title: 'From your last session (' + fmtDate(s.date) + ')', text: text } : null;
  }
  // Which player to show: the ?player= value, else the last one used, else the first.
  function resolvePlayer(players, requested, last) {
    var ids = (players || []).map(function (p) { return p && p.id; }).filter(Boolean);
    if (requested && ids.indexOf(requested) >= 0) return requested;
    if (last && ids.indexOf(last) >= 0) return last;
    return ids[0] || null;
  }
  function fmtHeight(inches) {
    if (!isNum(inches) || inches <= 0) return '';
    var ft = Math.floor(inches / 12), inch = Math.round(inches - ft * 12);
    if (inch === 12) { ft++; inch = 0; }
    return ft + '′' + inch + '″';
  }
  function youtubeSearchUrl(query) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(String(query || '')); }

  // ---------------------------------------------------------------------------
  // Paste parser
  // ---------------------------------------------------------------------------
  var TOPTRACER_ORDER = ['carry_yds', 'total_yds', 'ball_speed_mph', 'launch_deg', 'apex_ft', 'landing_deg', 'hang_time_s', 'curve_ft', 'offline_ft'];

  // [field, priority, aliases...]; priority breaks ties when two columns map to one field.
  var ALIAS_TABLE = [
    ['club', 1, 'club', 'club type', 'club name', 'clubs', 'club used'],
    ['time', 1, 'time', 'shot time', 'timestamp', 'time stamp', 'date', 'date time', 'datetime'],
    ['carry_yds', 1, 'carry', 'carry distance', 'carry dist', 'flat carry', 'carry flat'],
    ['total_yds', 1, 'total', 'total distance', 'total dist', 'distance'],
    ['ball_speed_mph', 1, 'ball speed', 'ball spd', 'ballspeed', 'ball velocity'],
    ['club_speed_mph', 1, 'club speed', 'clubhead speed', 'club head speed', 'swing speed', 'club spd', 'chs'],
    ['smash_factor', 1, 'smash', 'smash factor'],
    ['launch_deg', 1, 'launch', 'launch angle', 'launch ang', 'vla', 'vertical launch', 'vertical launch angle'],
    ['apex_ft', 1, 'apex', 'height', 'max height', 'peak height', 'apex height'],
    ['landing_deg', 1, 'landing', 'landing angle', 'land angle', 'descent', 'descent angle', 'angle of descent'],
    ['hang_time_s', 1, 'hang time', 'hang', 'hangtime', 'flight time', 'air time', 'airtime'],
    ['spin_rpm', 1, 'spin', 'spin rate', 'total spin', 'backspin', 'back spin'],
    ['curve_ft', 1, 'curve', 'curvature', 'curve distance'],
    ['offline_ft', 3, 'side total', 'total side', 'side total distance'],
    ['offline_ft', 2, 'offline', 'offline distance', 'off line'],
    ['offline_ft', 1, 'side', 'side carry', 'carry side', 'side distance', 'lateral', 'lateral distance', 'deviation', 'dispersion'],
    ['ignore', 0, 'launch direction', 'hla', 'horizontal launch', 'horizontal launch angle', 'attack angle', 'angle of attack',
      'aoa', 'club path', 'path', 'face angle', 'face to path', 'spin axis', 'axis', 'side spin', 'sidespin', 'club brand',
      'club model', 'brand', 'model', 'shot', 'shot number', 'shot no', '#', 'consistency', 'dynamic loft', 'low point',
      'roll', 'run', 'notes', 'note', 'tag', 'club data est type', 'player', 'session']
  ];
  var ALIAS_MAP = {};
  var ALIASES_BY_LEN = [];
  ALIAS_TABLE.forEach(function (row) {
    for (var i = 2; i < row.length; i++) {
      ALIAS_MAP[row[i]] = { field: row[0], prio: row[1] };
      ALIASES_BY_LEN.push({ alias: row[i], field: row[0], prio: row[1] });
    }
  });
  ALIASES_BY_LEN.sort(function (a, b) { return b.alias.length - a.alias.length; });
  ALIASES_BY_LEN.forEach(function (a) {
    a.re = new RegExp('(^|[\\s,;|/])(' + a.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+') + ')(?=[\\s,;|/(\\[]|$)', 'g');
  });

  var MISSING_RE = /^(?:-{1,3}|—|–|n\/?a|null|none|nan)?$/i;
  var DIR_WORD = /^(?:l|r|left|right)$/i;
  var UNIT_WORD = /^(?:yds?|yards?|ft|feet|'|m|mph|km\/h|kph|m\/s|°|deg|degs|degrees?|s|sec|secs|seconds?|rpm|%)$/i;
  var TIME_RE = /(^|\s)(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?)(?=\s|$)/gi;
  var DATE_RE = /(^|\s)(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})(?=\s|$)/g;
  var TIME_CELL = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?$/i;
  var DATE_CELL = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?)?$/i;
  var CLUB_SEARCH = /(^|[\s,;|])(driver|dr|pw|gw|aw|sw|lw|(?:pitching|gap|sand|lob|approach)(?:\s+wedge)?|[2-9]\s?(?:wood|wd|w)|1\s?(?:wood|w)|[1-9]\s?-?\s?(?:iron|i|hybrid|hyb|hy|h)|(?:4[6-9]|5\d|6[0-4])\s?°?\s?(?:wedge|w))(?=$|[\s,;|])/i;
  var SUMMARY_RE = /^\s*(?:avg|average|averages|mean|median|std|st\.?\s?dev|stdev|standard deviation|totals?\s*[:,]|summary|min|max|consistency)\b/i;

  function unitOf(t) {
    t = ' ' + String(t || '').toLowerCase() + ' ';
    if (/m\/s/.test(t)) return 'm/s';
    if (/km\/?h|kph/.test(t)) return 'km/h';
    if (/mph/.test(t)) return 'mph';
    if (/[^a-z](?:yds?|yards?)[^a-z]/.test(t)) return 'yd';
    if (/[^a-z](?:ft|feet|foot)[^a-z]|'/.test(t)) return 'ft';
    if (/[^a-z/](?:m|meters?|metres?)[^a-z/]/.test(t)) return 'm';
    return null;
  }

  var TO_YD = { yd: 1, ft: 1 / 3, m: 1.09361 };
  var TO_FT = { yd: 3, ft: 1, m: 3.28084 };
  var TO_MPH = { mph: 1, 'km/h': 0.621371, 'm/s': 2.23694 };
  function round1(v) { var r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; }

  // "01:00 PM" -> "13:00", "9:05" -> "09:05"; null when it isn't a time.
  function normTime(t) {
    var m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s?m\.?)?\s*$/i.exec(t == null ? '' : String(t));
    if (!m) return null;
    var h = +m[1];
    if (m[4]) h = (h % 12) + (m[4].toLowerCase() === 'p' ? 12 : 0);
    if (h > 23 || +m[2] > 59) return null;
    return (h < 10 ? '0' : '') + h + ':' + m[2] + (m[3] ? ':' + m[3] : '');
  }

  // Toptracer shows direction as arrows: ◀ before a number (left), ▶ after it (right).
  var LEFT_ARROWS = '◀◄←⬅';
  var RIGHT_ARROWS = '▶►→➡';
  var ARROW_RE = /[◀◄←⬅▶►→➡][︎️]?/g;
  function arrowsToLetters(s) {
    return String(s).replace(ARROW_RE, function (a) { return LEFT_ARROWS.indexOf(a.charAt(0)) >= 0 ? ' l ' : ' r '; });
  }

  function convert(v, field, u) {
    switch (field) {
      case 'carry_yds': case 'total_yds': return round1(v * (TO_YD[u] || 1));
      case 'apex_ft': case 'curve_ft': case 'offline_ft': return round1(v * (TO_FT[u] || 1));
      case 'ball_speed_mph': case 'club_speed_mph': return round1(v * (TO_MPH[u] || 1));
      case 'spin_rpm': return Math.round(v);
      case 'smash_factor': return Math.round(v * 100) / 100;
      default: return round1(v);
    }
  }

  // One cell -> number in the field's unit, null (missing), or undefined (unreadable).
  function parseCell(cell, field, unitHint) {
    if (cell == null) return null;
    var s = String(cell).trim();
    if (MISSING_RE.test(s)) return null;
    s = s.replace(/[−‒–]/g, '-')
      .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
      .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
    var nm = /-?\d*\.?\d+/.exec(s);
    if (!nm) return undefined;
    var v = parseFloat(nm[0]);
    if (!isFinite(v)) return undefined;
    var rest = arrowsToLetters(s.slice(0, nm.index) + ' ' + s.slice(nm.index + nm[0].length)).toLowerCase();
    if (METRIC[field] && METRIC[field].dir) {
      var d = /(?:^|[^a-z])(left|right|l|r)(?![a-z])/.exec(rest);
      if (d) v = (d[1].charAt(0) === 'l' ? -1 : 1) * Math.abs(v);
    }
    return convert(v, field, unitOf(rest) || unitHint || null);
  }

  function splitCells(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) {
        if (ch === '"') { if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    out = out.map(function (c) { return c.trim(); });
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }

  function detectDelimiter(lines) {
    var sample = lines.slice(0, 25);
    if (sample.some(function (l) { return l.indexOf('\t') >= 0; })) return '\t';
    var half = Math.ceil(sample.length / 2);
    var semi = sample.filter(function (l) { return (l.match(/;/g) || []).length >= 2; }).length;
    if (semi >= half) return ';';
    var comma = sample.filter(function (l) { return (l.match(/,/g) || []).length >= 2; }).length;
    if (comma >= half) return ',';
    return 'ws';
  }

  function normHeader(cell) {
    var s = String(cell || '').toLowerCase().trim();
    var unit = null;
    s = s.replace(/[(\[]([^)\]]*)[)\]]/g, function (_, u) { unit = unit || unitOf(u); return ' '; });
    s = s.replace(/[^a-z0-9#°\/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
    var m = /\s(yds?|yards?|ft|feet|m|meters?|metres?|mph|kmh|km\/h|kph|m\/s|deg|degrees?|°|rpm|sec|secs|seconds?)$/.exec(s);
    if (m) { unit = unit || unitOf(m[1]); s = s.slice(0, m.index).trim(); }
    return { name: s, unit: unit };
  }

  function resolveDuplicates(cols) {
    var best = {};
    cols.forEach(function (c, i) {
      if (!c.field || c.field === 'ignore') return;
      if (!(c.field in best) || c.prio > cols[best[c.field]].prio) best[c.field] = i;
    });
    cols.forEach(function (c, i) {
      if (c.field && c.field !== 'ignore' && best[c.field] !== i) c.field = 'ignore';
    });
  }

  function headerFromCells(cells) {
    if (cells.length < 2) return null;
    var cols = cells.map(function (c) {
      var h = normHeader(c);
      var f = ALIAS_MAP[h.name] || ALIAS_MAP[h.name.replace(/ /g, '')] || null;
      return { field: f ? f.field : null, prio: f ? f.prio : 0, unit: h.unit, raw: c };
    });
    var known = cols.filter(function (c) { return c.field && c.field !== 'ignore'; }).length;
    var numeric = cells.filter(function (c) { return /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(c); }).length;
    if (known < 2 || numeric > cells.length / 2) return null;
    resolveDuplicates(cols);
    cols.forEach(function (c) { if (!c.field) c.field = 'ignore'; });
    return { columns: cols };
  }

  function scanHeaderWS(line) {
    var s0 = ' ' + line.toLowerCase() + ' ';
    var s = s0.replace(/[(\[][^)\]]*[)\]]/g, function (m) { return new Array(m.length + 1).join(' '); });
    var found = [];
    ALIASES_BY_LEN.forEach(function (a) {
      a.re.lastIndex = 0;
      s = s.replace(a.re, function (m, pre, word, off) {
        found.push({ idx: off + pre.length, len: word.length, field: a.field, prio: a.prio });
        return pre + new Array(word.length + 1).join(' ');
      });
    });
    var numeric = (s.match(/(?:^|\s)-?\d+(?:\.\d+)?(?=\s|$)/g) || []).length;
    var known = found.filter(function (f) { return f.field !== 'ignore'; }).length;
    if (known < 2 || numeric > 1) return null;
    found.sort(function (a, b) { return a.idx - b.idx; });
    found.forEach(function (f) {
      var um = /^\s*[(\[]([^)\]]*)[)\]]/.exec(s0.slice(f.idx + f.len));
      f.unit = um ? unitOf(um[1]) : null;
      f.raw = line.substr(f.idx - 1, f.len);
    });
    var cols = found.filter(function (f) { return f.field !== 'club' && f.field !== 'time'; });
    resolveDuplicates(cols);
    return { columns: cols, ws: true };
  }

  // Pull time, date and club out of a whitespace line.
  function stripTimeClub(line) {
    var time = null, club = null;
    var s = ' ' + line + ' ';
    s = s.replace(TIME_RE, function (m, pre, t) { if (!time) time = normTime(t) || t; return pre + ' '; });
    s = s.replace(DATE_RE, function (m, pre) { return pre + ' '; });
    var cm = CLUB_SEARCH.exec(s);
    if (cm) {
      club = normClub(cm[2]);
      if (club) s = s.slice(0, cm.index) + cm[1] + ' ' + s.slice(cm.index + cm[0].length);
    }
    s = s.replace(/(^|\s)#\d+(?=\s|$)/g, ' ');
    return { time: time, club: club, rest: s.trim() };
  }

  function detectDirStyle(lines) {
    var suffix = 0, prefix = 0;
    lines.forEach(function (line) {
      var toks = stripTimeClub(line).rest.split(/\s+/).filter(Boolean);
      toks.forEach(function (t, j) {
        if (!DIR_WORD.test(t)) return;
        if (j === toks.length - 1) suffix++;                                   // "... 15 R"
        else if (j === 0) prefix++;                                            // "R 15 ..."
        else if (j === toks.length - 2 && /\d/.test(toks[j + 1])) prefix++;    // "... R 15"
      });
    });
    return prefix > suffix ? 'prefix' : 'suffix';
  }

  var ATTACHED_DIR = /^(?:l|r|left|right)-?\.?\d|\d(?:l|r|left|right)$/i;

  function rowFromWS(line, style) {
    var st = stripTimeClub(line);
    var toks = st.rest.replace(ARROW_RE, function (a) { return ' ' + a.charAt(0) + ' '; }).split(/\s+/).filter(Boolean);
    var cells = [], dirs = [], pending = null;
    toks.forEach(function (t) {
      var n = cells.length;
      if (t.length === 1 && LEFT_ARROWS.indexOf(t) >= 0) { pending = 'L'; return; }   // ◀ belongs to the next number
      if (t.length === 1 && RIGHT_ARROWS.indexOf(t) >= 0) {                            // ▶ belongs to the one before
        if (n && cells[n - 1] !== '' && !dirs[n - 1]) { cells[n - 1] += ' R'; dirs[n - 1] = true; }
        else pending = 'R';
        return;
      }
      if (DIR_WORD.test(t)) {
        // Suffix style ("24 R"): the letter belongs to the value before it,
        // unless that value already has a direction; prefix style ("R 24"): the next.
        if (style === 'suffix' && n && cells[n - 1] !== '' && !dirs[n - 1]) { cells[n - 1] += ' ' + t; dirs[n - 1] = true; }
        else pending = t;
        return;
      }
      if (UNIT_WORD.test(t) && n && cells[n - 1] !== '') { cells[n - 1] += ' ' + t; return; }
      if (MISSING_RE.test(t)) { cells.push(''); dirs.push(false); pending = null; return; }
      if (/\d/.test(t)) {
        cells.push((pending ? pending + ' ' : '') + t);
        dirs.push(!!pending || ATTACHED_DIR.test(t));
        pending = null;
      }
      // other words are ignored
    });
    return { time: st.time, club: st.club, cells: cells, clubOnly: !cells.length && !!st.club };
  }

  function rowFromCells(cells) {
    var time = null, club = null, vals = [];
    cells.forEach(function (c) {
      if (!time && TIME_CELL.test(c)) { time = normTime(c) || c; return; }
      if (DATE_CELL.test(c)) return;
      var n = !club && !/^-?\d+(?:\.\d+)?$/.test(c) ? normClub(c) : null;
      if (n) { club = n; return; }
      vals.push(c);
    });
    while (vals.length && vals[vals.length - 1] === '') vals.pop();
    var empty = !vals.some(function (v) { return /\d/.test(v); });
    return { time: time, club: club, cells: vals, clubOnly: empty && !!club, empty: empty };
  }

  function modeOf(arr) {
    var count = {}, best = 0, val = 0;
    arr.forEach(function (x) {
      count[x] = (count[x] || 0) + 1;
      if (count[x] > best || (count[x] === best && x > val)) { best = count[x]; val = x; }
    });
    return val;
  }

  function defaultColumns(n) {
    if (n <= 0) return [];
    if (n === 1) return ['carry_yds'];
    if (n === 2) return ['carry_yds', 'offline_ft'];
    var order = n === TOPTRACER_ORDER.length - 1
      ? TOPTRACER_ORDER.filter(function (k) { return k !== 'hang_time_s'; })
      : TOPTRACER_ORDER;
    var cols = order.slice(0, n);
    while (cols.length < n) cols.push('ignore');
    return cols;
  }

  // Parse pasted text into rows of cells plus a suggested column mapping.
  function parsePaste(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
      .map(function (l) { return l.replace(/\u00a0/g, ' ').trim(); })
      .filter(function (l) { return l.length; });
    var delim = detectDelimiter(lines);
    var header = null, headerIdx = -1;
    for (var i = 0; i < Math.min(lines.length, 15); i++) {
      header = delim === 'ws' ? scanHeaderWS(lines[i]) : headerFromCells(splitCells(lines[i], delim));
      if (header) { headerIdx = i; break; }
    }
    var style = delim === 'ws' ? detectDirStyle(lines.slice(headerIdx + 1)) : 'suffix';
    var rows = [];
    var currentClub = null;
    for (var j = headerIdx + 1; j < lines.length; j++) {
      var line = lines[j];
      if (SUMMARY_RE.test(line.replace(/^["'\s]+/, ''))) continue;
      var row;
      if (delim !== 'ws' && header) {
        var cells = splitCells(line, delim);
        if (!cells.some(function (c) { return /\d/.test(c); })) continue;
        row = { time: null, club: null, cells: cells };
      } else if (delim !== 'ws') {
        row = rowFromCells(splitCells(line, delim));
        if (row.clubOnly) { currentClub = row.club; continue; }
        if (row.empty) continue;
      } else {
        row = rowFromWS(line, style);
        if (row.clubOnly) { currentClub = row.club; continue; }
        if (!row.cells.some(function (c) { return /\d/.test(c); })) continue;
      }
      row.clubFromGroup = !row.club && !!currentClub;
      if (!row.club) row.club = currentClub;
      row.line = line;
      rows.push(row);
    }
    return parsedFromRows(rows, header, { delim: delim, dirStyle: style, source: 'paste' });
  }

  // The structure the import preview works from. It doesn't care where rows
  // came from: paste today, a photo/OCR importer could feed it the same way.
  // rows:   [{ cells: [string], club?, time?, line? }]
  // header: optional { columns: [{ field, unit, raw }] }; without one the
  //         columns default to Toptracer order.
  // Lists shown newest first (first time later than the last) are reversed
  // so shots are stored in the order they were hit.
  function parsedFromRows(rows, header, meta) {
    meta = meta || {};
    rows = (rows || []).map(function (r) {
      return {
        cells: (r.cells || []).map(function (c) { return c == null ? '' : String(c); }),
        club: r.club || null,
        time: r.time ? (normTime(r.time) || String(r.time)) : null,
        line: r.line || '',
        clubFromGroup: !!r.clubFromGroup
      };
    });
    var nCols = header ? header.columns.length : modeOf(rows.map(function (r) { return r.cells.length; }));
    var columns = header ? header.columns.map(function (c) { return c.field; }) : defaultColumns(nCols);
    var timeIdx = columns.indexOf('time');
    function timeOf(r) { return r.time || (timeIdx >= 0 ? normTime(r.cells[timeIdx]) : null); }
    var reversed = false;
    if (rows.length >= 2) {
      var first = timeOf(rows[0]), last = timeOf(rows[rows.length - 1]);
      if (first && last && first > last) { rows.reverse(); reversed = true; }
    }
    return {
      source: meta.source || 'rows',
      delim: meta.delim || null,
      dirStyle: meta.dirStyle || null,
      hasHeader: !!header,
      columns: columns,
      units: header ? header.columns.map(function (c) { return c.unit || null; }) : new Array(nCols).fill(null),
      headerLabels: header ? header.columns.map(function (c) { return c.raw || null; }) : null,
      nCols: nCols,
      rows: rows,
      reversed: reversed
    };
  }

  // Turn parsed rows into shots with the given column mapping.
  // opts: { lateralUnit: 'ft'|'yd', apexUnit: 'ft'|'yd', defaultClub }
  function buildShots(parsed, columns, opts) {
    opts = opts || {};
    columns = columns || parsed.columns;
    var lateral = opts.lateralUnit || 'ft', apexU = opts.apexUnit || 'ft';
    return parsed.rows.map(function (row) {
      var shot = { club: row.club || null, time: row.time || null };
      var warn = [], bad = {};
      columns.forEach(function (field, j) {
        if (!field || field === 'ignore') return;
        var cell = row.cells[j];
        if (field === 'club') {
          if (cell && String(cell).trim()) {
            var c = normClub(cell);
            shot.club = c || String(cell).trim();
            if (!c) warn.push('Unknown club “' + String(cell).trim() + '”');
          }
          return;
        }
        if (field === 'time') { if (cell && String(cell).trim()) shot.time = normTime(cell) || String(cell).trim(); return; }
        if (cell == null || String(cell).trim() === '') { if (!(field in shot)) shot[field] = null; return; }
        var hint = parsed.units && parsed.units[j];
        if (!hint) {
          if (field === 'apex_ft') hint = apexU;
          else if (field === 'curve_ft' || field === 'offline_ft') hint = lateral;
        }
        var v = parseCell(cell, field, hint);
        if (v === undefined) { warn.push('Can’t read “' + cell + '” as ' + METRIC[field].label.toLowerCase()); bad[field] = true; return; }
        shot[field] = v;
        var r = SANE[field];
        if (v != null && r && (v < r[0] || v > r[1])) { warn.push(METRIC[field].label + ' ' + fmtRaw(v) + ' looks off'); bad[field] = true; }
      });
      if (!shot.club && opts.defaultClub) shot.club = opts.defaultClub;
      if (!shot.club) warn.push('No club');
      if (!isNum(shot.carry_yds)) warn.push('No carry');
      if (parsed.nCols && row.cells.length !== parsed.nCols) warn.push(row.cells.length + ' values, expected ' + parsed.nCols);
      if (isNum(shot.total_yds) && isNum(shot.carry_yds) && shot.total_yds < shot.carry_yds - 0.5) warn.push('Total is shorter than carry');
      var numeric = METRICS.filter(function (m) { return isNum(shot[m.key]); }).length;
      var include = !!shot.club && numeric > 0 && !(parsed.nCols >= 4 && row.cells.length < parsed.nCols / 2);
      return { shot: shot, warn: warn, bad: bad, include: include, line: row.line };
    });
  }

  return {
    METRICS: METRICS, METRIC: METRIC, CORE_KEYS: CORE_KEYS, SANE: SANE, STANDARD_CLUBS: STANDARD_CLUBS,
    TOPTRACER_ORDER: TOPTRACER_ORDER,
    isNum: isNum, metricValue: metricValue, roundHalfEven: roundHalfEven,
    fmtNum: fmtNum, fmtDir: fmtDir, fmtRaw: fmtRaw, fmtRawDir: fmtRawDir, fmtRange: fmtRange,
    fmtAvg: fmtAvg, fmtSigned: fmtSigned, fmtDate: fmtDate, shortDevice: shortDevice, plural: plural,
    summarize: summarize, median: median,
    normClub: normClub, clubRank: clubRank, sortClubs: sortClubs, clubName: clubName, launchFloor: launchFloor,
    sessionShots: sessionShots, hasSummary: hasSummary, isSummaryOnly: isSummaryOnly, compareSessions: compareSessions,
    asList: asList, clubData: clubData, entryHasData: entryHasData, metricStat: metricStat, mishits: mishits,
    sessionMishits: sessionMishits, outliers: outliers, sessionOutliers: sessionOutliers, OUTLIER: OUTLIER,
    solidCount: solidCount, solidPct: solidPct, SOLID_METRIC: SOLID_METRIC, latestShotSession: latestShotSession,
    needsWork: needsWork, NEEDS_WORK: NEEDS_WORK, clubGoals: clubGoals, GOALS: GOALS, LAUNCH_WINDOWS: LAUNCH_WINDOWS,
    mergeGoals: mergeGoals, applyGoals: applyGoals,
    bestStrikes: bestStrikes, strikeReference: strikeReference, checkShot: checkShot,
    launchWindow: launchWindow, clubLoft: clubLoft, clubSpec: clubSpec, clubKind: clubKind, LAUNCH_PER_LOFT: LAUNCH_PER_LOFT,
    sessionCallout: sessionCallout, resolvePlayer: resolvePlayer, fmtHeight: fmtHeight, youtubeSearchUrl: youtubeSearchUrl,
    buildHighlights: buildHighlights, progressFor: progressFor, compareStats: compareStats, trend: trend, TREND: TREND,
    parsePaste: parsePaste, parsedFromRows: parsedFromRows, buildShots: buildShots, normTime: normTime, quantile: quantile, parseCell: parseCell, defaultColumns: defaultColumns, unitOf: unitOf
  };
});
