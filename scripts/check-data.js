#!/usr/bin/env node
// Checks the data files before they're committed.
// Errors fail the check (exit code 1); warnings are printed for a human to look at.
// Usage:
//   node scripts/check-data.js                    checks data/players.json and every player file it lists
//   node scripts/check-data.js path/to/data.json  checks one player file
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SwingReview = require('../js/review.js');
const TIPS = require('../js/tips.js');
const CLUB_RE = /^(Driver|[2-9]w|[2-7]hy|[2-9]i|PW|GW|SW|LW|\d{2}°)$/;
const CORE_KEYS = ['carry_yds', 'total_yds', 'ball_speed_mph', 'launch_deg', 'apex_ft', 'landing_deg', 'hang_time_s', 'curve_ft', 'offline_ft'];
// Loose plausibility ranges: outside them is a warning (likely a misread), not an error.
const RANGES = {
  carry_yds: [0, 400], total_yds: [0, 450], ball_speed_mph: [0, 220], launch_deg: [-20, 90],
  apex_ft: [0, 300], landing_deg: [0, 90], hang_time_s: [0, 12], curve_ft: [-500, 500],
  offline_ft: [-700, 700], club_speed_mph: [0, 160], smash_factor: [0, 1.8], spin_rpm: [0, 15000],
};

function readJSON(file, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`not valid JSON, or can't be read: ${e.message}`);
    return null;
  }
}

// Checks one player data file. Returns { errors, warnings, sessions, shots, name }.
// playerId (from players.json) lets swing reviews check their drill links against js/tips.js.
function checkPlayerFile(file, playerId) {
  const errors = [];
  const warnings = [];
  const data = readJSON(file, errors);
  if (!data) return { errors, warnings, sessions: 0, shots: 0 };

  if (!data.player || typeof data.player !== 'object' || !data.player.name) errors.push('top level: "player" needs a "name"');
  if (!Array.isArray(data.sessions)) errors.push('top level: "sessions" must be an array');
  const clubs = data.clubs || {};
  const sessionIds = new Set();
  const shotIds = new Set();

  (data.sessions || []).forEach((s, i) => {
    const where = `session ${s.id || '#' + (i + 1)}`;
    if (!s.id) errors.push(`${where}: missing id`);
    else if (sessionIds.has(s.id)) errors.push(`${where}: duplicate session id`);
    sessionIds.add(s.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) errors.push(`${where}: date must be YYYY-MM-DD`);
    if (!s.device) warnings.push(`${where}: no device`);
    if (!Array.isArray(s.shots)) {
      errors.push(`${where}: "shots" must be an array (use [] for a summary-only session)`);
      return;
    }

    let prevTime = null;
    s.shots.forEach((shot, j) => {
      const w = `${where}, shot ${shot.id || '#' + (j + 1)}`;
      if (!shot.id) errors.push(`${w}: missing id`);
      else if (shotIds.has(shot.id)) errors.push(`${w}: duplicate shot id`);
      shotIds.add(shot.id);

      if (!CLUB_RE.test(shot.club || '')) errors.push(`${w}: club "${shot.club}" isn't a standard name (PW, SW, 9i, 5hy, 5w, Driver…)`);
      else if (!clubs[shot.club]) warnings.push(`${w}: club ${shot.club} is missing from the top-level "clubs" map`);

      if (shot.time != null) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(shot.time)) {
          errors.push(`${w}: time "${shot.time}" must be 24-hour HH:MM`);
        } else {
          if (prevTime && shot.time < prevTime) errors.push(`${w}: ${shot.time} comes before the previous shot's ${prevTime}; keep shots in time order`);
          prevTime = shot.time;
        }
      }

      for (const k of CORE_KEYS) {
        if (!(k in shot)) warnings.push(`${w}: missing key ${k} (use null when the screen doesn't show it)`);
      }
      for (const [k, [lo, hi]] of Object.entries(RANGES)) {
        const v = shot[k];
        if (v == null) continue;
        if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${w}: ${k} must be a number or null`); continue; }
        if (v < lo || v > hi) warnings.push(`${w}: ${k} = ${v} looks out of range; check the photo`);
      }
      if (shot.carry_yds == null) warnings.push(`${w}: no carry distance`);
      if (typeof shot.carry_yds === 'number' && typeof shot.total_yds === 'number' && shot.total_yds < shot.carry_yds - 5) {
        warnings.push(`${w}: total (${shot.total_yds}) is well short of carry (${shot.carry_yds}); check the photo`);
      }
    });
  });

  if (data.baseline_session_id && !sessionIds.has(data.baseline_session_id)) {
    errors.push(`baseline_session_id "${data.baseline_session_id}" doesn't match any session`);
  }

  // personal_goals: [{ id, text, source: "coach" | "me", added: "YYYY-MM-DD", done: false }]
  let goals = 0;
  if (data.personal_goals != null) {
    if (!Array.isArray(data.personal_goals)) {
      errors.push('"personal_goals" must be an array (use [] for none)');
    } else {
      const goalIds = new Set();
      data.personal_goals.forEach((g, i) => {
        const w = `goal ${g && g.id ? g.id : '#' + (i + 1)}`;
        if (!g || typeof g !== 'object') { errors.push(`${w}: must be an object`); return; }
        if (!g.id) errors.push(`${w}: missing id`);
        else if (goalIds.has(g.id)) errors.push(`${w}: duplicate goal id`);
        goalIds.add(g.id);
        if (typeof g.text !== 'string' || !g.text.trim()) errors.push(`${w}: "text" must be a non-empty string`);
        else if (g.text.length > 140) warnings.push(`${w}: text is ${g.text.length} characters; keep goals short enough to read at a glance`);
        if (g.source !== 'coach' && g.source !== 'me') errors.push(`${w}: "source" must be "coach" or "me"`);
        if (g.added != null && !/^\d{4}-\d{2}-\d{2}$/.test(g.added)) errors.push(`${w}: "added" must be YYYY-MM-DD`);
        if (g.done != null && typeof g.done !== 'boolean') errors.push(`${w}: "done" must be true or false`);
      });
      goals = data.personal_goals.length;
    }
  }
  // equipment (optional): { note, bag: { "7i": { "model": "Lynx Black Cat", "loft_deg": 33 }, ... } }
  // The page sets each club's launch target from its loft (loft_deg may be null when unknown).
  if (data.equipment != null) {
    const eq = data.equipment;
    if (typeof eq !== 'object' || Array.isArray(eq)) errors.push('"equipment" must be an object');
    else if (eq.bag != null) {
      if (typeof eq.bag !== 'object' || Array.isArray(eq.bag)) errors.push('equipment.bag must be an object like { "7i": { "model": "…", "loft_deg": 33 } }');
      else Object.entries(eq.bag).forEach(([club, spec]) => {
        const w = `equipment.bag.${club}`;
        if (!CLUB_RE.test(club)) errors.push(`${w}: "${club}" isn't a standard club name`);
        if (!spec || typeof spec !== 'object') { errors.push(`${w} must be an object`); return; }
        if (spec.model != null && typeof spec.model !== 'string') errors.push(`${w}.model must be text`);
        if (spec.loft_deg != null) {
          if (typeof spec.loft_deg !== 'number' || !Number.isFinite(spec.loft_deg)) errors.push(`${w}.loft_deg must be a number of degrees or null`);
          else if (spec.loft_deg < 5 || spec.loft_deg > 65) warnings.push(`${w}.loft_deg = ${spec.loft_deg}° looks out of range`);
        }
      });
    }
  }
  // swing_reviews (optional): frames from a swing video with markup; see CLAUDE.md and js/review.js.
  let reviews = 0;
  if (data.swing_reviews != null) {
    if (!Array.isArray(data.swing_reviews)) errors.push('"swing_reviews" must be an array (use [] for none)');
    else {
      const ids = new Set();
      const tips = playerId ? TIPS[playerId] : null;
      const ctx = {
        fileExists: (src) => fs.existsSync(path.join(ROOT, src)),
        clubOk: (c) => CLUB_RE.test(c),
        sessionExists: (id) => sessionIds.has(id),
        drillExists: tips ? (key) => { const m = /^([\w-]+):(\d+)$/.exec(key); const f = m && tips.focus.find((x) => x.id === m[1]); return !!(f && f.drills[+m[2]]); } : null
      };
      data.swing_reviews.forEach((r) => {
        if (r && r.id) { if (ids.has(r.id)) errors.push(`swing review ${r.id}: duplicate id`); ids.add(r.id); }
        const res = SwingReview.validate(r, ctx);
        errors.push(...res.errors);
        warnings.push(...res.warnings);
      });
      reviews = data.swing_reviews.length;
    }
  }
  return { errors, warnings, sessions: sessionIds.size, shots: shotIds.size, goals, reviews, name: data.player && data.player.name };
}

// Checks data/players.json. Returns { errors, warnings, files: [{ id, name, file }] }.
function checkRegistry(file) {
  const errors = [];
  const files = [];
  const reg = readJSON(file, errors);
  if (!reg) return { errors, warnings: [], files };
  if (!Array.isArray(reg.players) || !reg.players.length) {
    errors.push('"players" must be a non-empty array');
    return { errors, warnings: [], files };
  }
  const ids = new Set();
  reg.players.forEach((p, i) => {
    const where = `player ${p && p.id ? p.id : '#' + (i + 1)}`;
    if (!p || typeof p !== 'object') { errors.push(`${where}: must be an object`); return; }
    if (!/^[a-z0-9-]+$/.test(p.id || '')) errors.push(`${where}: id must be lowercase letters, digits or dashes (it's used in ?player=)`);
    else if (ids.has(p.id)) errors.push(`${where}: duplicate id`);
    ids.add(p.id);
    if (!p.name) errors.push(`${where}: missing name`);
    if (!/^data\/[\w.-]+\.json$/.test(p.file || '')) errors.push(`${where}: file must look like data/<name>.json`);
    else if (!fs.existsSync(path.join(ROOT, p.file))) errors.push(`${where}: ${p.file} doesn't exist`);
    else files.push({ id: p.id, name: p.name, file: p.file });
  });
  return { errors, warnings: [], files };
}

function report(label, res) {
  for (const w of res.warnings) console.log(`⚠ ${label}: ${w}`);
  for (const e of res.errors) console.log(`✗ ${label}: ${e}`);
}
function summary(res) {
  return `${res.sessions} sessions, ${res.shots} shots, ${res.goals} goal${res.goals === 1 ? '' : 's'}${res.reviews ? `, ${res.reviews} swing review${res.reviews === 1 ? '' : 's'}` : ''}${res.warnings.length ? `, ${res.warnings.length} warning(s)` : ''}`;
}

// js/tips.js: each drill's animation must draw, and a video id must look like a YouTube id.
function checkTips() {
  const DrillArt = require('../js/drillart.js');
  const errors = [], warnings = [];
  let drills = 0, videos = 0;
  Object.entries(TIPS).forEach(([pid, t]) => (t.focus || []).forEach((f) => (f.drills || []).forEach((d, i) => {
    const w = `${pid}/${f.id}:${i} ${d.name}`;
    drills++;
    if (!d.art) warnings.push(`${w}: no animation`);
    else {
      DrillArt.validate(d.art).forEach((e) => errors.push(`${w}: ${e}`));
      try { d.art.frames.forEach((fr, k) => DrillArt.render(d.art, k, {})); } catch (e) { errors.push(`${w}: animation doesn't draw (${e.message})`); }
    }
    if (d.video) {
      videos++;
      if (!/^[\w-]{11}$/.test(d.video.id || '')) errors.push(`${w}: video id "${d.video.id}" isn't an 11-character YouTube id`);
      if (!d.video.title || !d.video.by) errors.push(`${w}: video needs a title and "by" (the coach)`);
    }
  })));
  return { errors, warnings, drills, videos };
}

let failed = 0;
const arg = process.argv[2];
if (arg) {
  const res = checkPlayerFile(arg);
  report(path.basename(arg), res);
  failed += res.errors.length;
  if (!res.errors.length) console.log(`✓ ${path.basename(arg)}: ${summary(res)}`);
} else {
  const reg = checkRegistry(path.join(ROOT, 'data', 'players.json'));
  report('data/players.json', reg);
  failed += reg.errors.length;
  if (!reg.errors.length) console.log(`✓ data/players.json: ${reg.files.length} players`);
  for (const p of reg.files) {
    const res = checkPlayerFile(path.join(ROOT, p.file), p.id);
    if (res.name && res.name !== p.name) res.warnings.push(`player.name "${res.name}" differs from the name in players.json ("${p.name}")`);
    report(p.file, res);
    failed += res.errors.length;
    if (!res.errors.length) console.log(`✓ ${p.file} (${p.name}): ${summary(res)}`);
  }
  const tips = checkTips();
  report('js/tips.js', tips);
  failed += tips.errors.length;
  if (!tips.errors.length) console.log(`✓ js/tips.js: ${tips.drills} drills, ${tips.videos} with a coach's video${tips.warnings.length ? `, ${tips.warnings.length} warning(s)` : ''}`);
}
if (failed) console.log(`\n${failed} error(s)`);
process.exit(failed ? 1 : 0);
