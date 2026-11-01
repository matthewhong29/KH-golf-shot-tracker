#!/usr/bin/env node
// Checks data/dad_golf_data.json before it's committed.
// Errors fail the check (exit code 1); warnings are printed for a human to look at.
// Usage: node scripts/check-data.js [path/to/data.json]
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'dad_golf_data.json');
const errors = [];
const warnings = [];

let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✗ ${file} is not valid JSON: ${e.message}`);
  process.exit(1);
}

const CLUB_RE = /^(Driver|[2-9]w|[2-7]hy|[2-9]i|PW|GW|SW|LW|\d{2}°)$/;
const CORE_KEYS = ['carry_yds', 'total_yds', 'ball_speed_mph', 'launch_deg', 'apex_ft', 'landing_deg', 'hang_time_s', 'curve_ft', 'offline_ft'];
// Loose plausibility ranges: outside them is a warning (likely a misread), not an error.
const RANGES = {
  carry_yds: [0, 400], total_yds: [0, 450], ball_speed_mph: [0, 220], launch_deg: [-20, 90],
  apex_ft: [0, 300], landing_deg: [0, 90], hang_time_s: [0, 12], curve_ft: [-500, 500],
  offline_ft: [-700, 700], club_speed_mph: [0, 160], smash_factor: [0, 1.8], spin_rpm: [0, 15000],
};

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

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);
console.log(errors.length
  ? `\n${errors.length} error(s) in ${file}`
  : `✓ ${path.basename(file)}: ${sessionIds.size} sessions, ${shotIds.size} shots${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
process.exit(errors.length ? 1 : 0);
