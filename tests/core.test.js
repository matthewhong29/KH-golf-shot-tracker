// Run with: node tests/core.test.js   (no dependencies)
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');

const fileText = fs.readFileSync(path.join(__dirname, '..', 'data', 'dad_golf_data.json'), 'utf8');
const fileData = JSON.parse(fileText);
// The tests check numbers worked out by hand from Dad's first two sessions (Aug 2026 and
// Nov 1), with no goals. Pinning to those keeps them passing as new range sessions and
// goals are added to the real file; scripts/check-data.js checks the file itself.
const FIXTURE_SESSIONS = ['2026-08-rapsodo', '2026-11-01-toptracer'];
const data = Object.assign({}, fileData, { personal_goals: [], sessions: fileData.sessions.filter((s) => FIXTURE_SESSIONS.indexOf(s.id) >= 0) });

let passed = 0, failed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`  ✗ ${msg}\n      expected ${e}\n      actual   ${a}`);
}
function ok(cond, msg) { eq(!!cond, true, msg); }
function section(name) { console.log(name); }

const aug = data.sessions.find((s) => s.id === '2026-08-rapsodo');
const nov = data.sessions.find((s) => s.id === '2026-11-01-toptracer');

// ---------------------------------------------------------------------------
section('Expected averages from the brief (shots 001–036; unchanged in the full session)');
// Club: shots, carry avg (range), total, ball speed, launch, apex, landing, curve, offline
const EXPECTED = {
  PW: [9, '83.4', '69–96', '85.7', '71.8', '34.1', '62.1', '47.7', '5.0 R', '1.9 L'],
  '9i': [15, '100.7', '87–118', '102.8', '81.5', '31.7', '72.7', '47.7', '3.4 R', '7.2 R'],
  '7i': [8, '114.5', '100–128', '117.6', '88.8', '26.0', '70.9', '44.1', '9.4 R', '13.8 R'],
  '5hy': [4, '141.0', '131–152', '147.2', '101.8', '20.8', '71.2', '40.0', '27.0 R', '85.0 R'],
};
const AVG_KEYS = ['total_yds', 'ball_speed_mph', 'launch_deg', 'apex_ft', 'landing_deg', 'curve_ft', 'offline_ft'];
const nov36 = Object.assign({}, nov, { shots: nov.shots.slice(0, 36) });
const byClub36 = C.clubData([nov36]);
const byClub = C.clubData([nov]);
eq(C.sessionShots(nov).length, 48, 'Nov 1 has 48 shots');
eq(C.sortClubs(Object.keys(byClub36)), ['PW', '9i', '7i', '5hy'], 'shots 001–036: four clubs');
eq(C.sortClubs(Object.keys(byClub)), ['SW', 'PW', '9i', '7i', '5hy', '5w'], 'full session: clubs sorted short to long');
for (const [label, entries] of [['001–036', byClub36], ['full session', byClub]]) {
  for (const club of Object.keys(EXPECTED)) {
    const [shots, carryAvg, carryRange, ...rest] = EXPECTED[club];
    const e = entries[club];
    eq([e.shots.length, e.solid.length, e.mis.length], [shots, shots, 0], `${label} ${club}: shots, all solid`);
    const carry = C.metricStat(e, 'carry_yds');
    eq(C.fmtAvg('carry_yds', carry.avg), carryAvg, `${label} ${club} carry avg`);
    eq(C.fmtRange(carry.min, carry.max), carryRange, `${label} ${club} carry range`);
    AVG_KEYS.forEach((key, i) => {
      const st = C.metricStat(e, key);
      eq(C.fmtAvg(key, st.avg), rest[i], `${label} ${club} ${key} avg`);
      eq(st.n, shots, `${label} ${club} ${key} n`);
      // Ranges for the other metrics, checked against an independent min/max of the raw data.
      const vals = e.shots.map((s) => s[key]);
      eq(C.fmtRange(st.min, st.max, C.METRIC[key].dir), C.fmtRange(Math.min(...vals), Math.max(...vals), C.METRIC[key].dir), `${label} ${club} ${key} range`);
    });
  }
}
eq(C.fmtRange(-31, 54, true), '31 L – 54 R', 'directional range format');

section('Second screenshot: SW, and the 5w without its mis-hits (solid shots 040–041)');
const EXPECTED_NEW = {
  SW: { n: 7, total: 7, carry_yds: ['67.7', '54–88'], total_yds: ['70.3', '56–95'], ball_speed_mph: ['63.7', '55–77'], launch_deg: ['40.0', '22–51'],
    apex_ft: ['54.7', '40–66'], landing_deg: ['50.0', '37–58'], curve_ft: ['10.4 R', '2 L – 26 R'], offline_ft: ['9.7 R', '17 L – 37 R'] },
  '5w': { n: 2, total: 5, carry_yds: ['137.0', '136–138'], total_yds: ['153.5', '150–157'], ball_speed_mph: ['107.0', '106–108'], launch_deg: ['10.0', '9–11'],
    apex_ft: ['38.0', '35–41'], landing_deg: ['28.0', '26–30'], curve_ft: ['35.5 R', '24 R – 47 R'], offline_ft: ['48.5 R', '21 R – 76 R'] },
};
for (const club of Object.keys(EXPECTED_NEW)) {
  const exp = EXPECTED_NEW[club];
  eq([byClub[club].shots.length, byClub[club].solid.length], [exp.total, exp.n], `${club}: ${exp.n} solid of ${exp.total}`);
  for (const key of Object.keys(exp)) {
    if (key === 'n' || key === 'total') continue;
    const st = C.metricStat(byClub[club], key);
    eq([C.fmtAvg(key, st.avg), C.fmtRange(st.min, st.max, C.METRIC[key].dir), st.n, st.of], exp[key].concat([exp.n, exp.n]), `${club} ${key} avg, range, n of N`);
  }
}
eq(byClub['5w'].mis.map((s) => s.id), ['2026-11-01-037', '2026-11-01-038', '2026-11-01-039'], '5w mis-hits kept for the charts');
eq([C.solidPct(byClub['5w']), C.solidPct(byClub.PW)], [40, 100], 'solid contact % by club');
eq(C.fmtSigned(C.metricStat(byClub['5w'], 'carry_yds').avg - C.metricStat(byClub['5hy'], 'carry_yds').avg, 1), '−4.0', 'gap 5hy → 5w');

section('Partial and missing metrics');
const hang = C.metricStat(byClub.PW, 'hang_time_s');
eq([hang.n, hang.of, C.fmtNum(hang.avg, 1), C.fmtRange(hang.min, hang.max)], [3, 9, '4.7', '4.3–5.1'], 'PW hang time uses the 3 shots that have it');
eq(C.metricStat(byClub['9i'], 'hang_time_s'), null, '9i hang time: no data -> null');
eq(C.metricStat(byClub.PW, 'club_speed_mph'), null, 'Toptracer has no club speed');
eq(C.metricStat(byClub.PW, 'spin_rpm'), null, 'Toptracer has no spin');
eq(C.metricStat(byClub.PW, 'smash_factor'), null, 'no smash without club speed');
eq(C.metricValue({ ball_speed_mph: 100, club_speed_mph: 80 }, 'smash_factor'), 1.25, 'smash derived from ball / club speed');
eq(C.metricValue({ ball_speed_mph: 100, club_speed_mph: null }, 'smash_factor'), null, 'smash null without club speed');
eq(C.summarize([], 'carry_yds').n, 0, 'empty summary');
eq(C.summarize([{ carry_yds: null }, {}], 'carry_yds'), { n: 0, of: 2, avg: null, min: null, max: null, sd: null, values: [] }, 'all-null summary');

section('Summary-only session (Aug Rapsodo)');
const augData = C.clubData([aug]);
eq(Object.keys(augData), ['PW'], 'Aug has PW only');
eq(augData.PW.shots.length, 0, 'Aug has no shots');
const augCarry = C.metricStat(augData.PW, 'carry_yds');
eq([augCarry.summaryOnly, augCarry.avg, C.fmtRange(augCarry.min, augCarry.max)], [true, null, '9–95'], 'Aug carry range');
eq(C.fmtRange(C.metricStat(augData.PW, 'launch_deg').min, C.metricStat(augData.PW, 'launch_deg').max), '1.7–32.4', 'Aug launch range');
eq(C.fmtRange(C.metricStat(augData.PW, 'club_speed_mph').min, C.metricStat(augData.PW, 'club_speed_mph').max), '60–67', 'Aug club speed range');
eq(C.solidPct(augData.PW), null, 'Aug solid contact % is unknown');
ok(C.isSummaryOnly(aug) && !C.isSummaryOnly(nov), 'isSummaryOnly');

section('Rounding & formatting');
eq(C.roundHalfEven(147.25, 1), 147.2, '147.25 -> 147.2 (half to even)');
eq(C.roundHalfEven(71.25, 1), 71.2, '71.25 -> 71.2');
eq(C.roundHalfEven(88.75, 1), 88.8, '88.75 -> 88.8');
eq(C.roundHalfEven(13.75, 1), 13.8, '13.75 -> 13.8');
eq(C.roundHalfEven(-71.25, 1), -71.2, '-71.25 -> -71.2');
eq(C.roundHalfEven(2.5, 0), 2, '2.5 -> 2');
eq(C.roundHalfEven(3.5, 0), 4, '3.5 -> 4');
eq(C.roundHalfEven(-0.04, 1), 0, 'no negative zero');
eq(C.fmtDir(-1.8889, 1), '1.9 L', 'fmtDir left');
eq(C.fmtDir(0.01, 1), '0.0', 'fmtDir zero');
eq(C.fmtSigned(60), '+60', 'signed +');
eq(C.fmtSigned(-1.25, 1), '−1.2', 'signed − with half-even');
eq(C.fmtDate('2026-08-09'), 'Aug 9, 2026', 'date');
eq(C.fmtNum(null, 1), '—', 'missing number dash');

section('Clubs');
const CLUBS = { '7 Iron': '7i', '7-iron': '7i', '9i': '9i', '5 Hybrid': '5hy', '5H': '5hy', '5hy': '5hy', 'Pitching Wedge': 'PW',
  pw: 'PW', '3 Wood': '3w', '3w': '3w', driver: 'Driver', 'Sand Wedge': 'SW', '56° wedge': '56°', Putter: null, '5R': null, '15': null };
for (const [k, v] of Object.entries(CLUBS)) eq(C.normClub(k), v, `normClub(${k})`);
eq(C.sortClubs(['5hy', 'PW', '7i', '9i', 'Driver', '3w', '5i', 'SW']), ['SW', 'PW', '9i', '7i', '5i', '5hy', '3w', 'Driver'], 'sortClubs');

section('Mis-hits & highlights');
eq(C.mishits(C.sessionShots(nov)).map((m) => m.shot.id), ['2026-11-01-037', '2026-11-01-038', '2026-11-01-039'], 'mis-hits on Nov 1: exactly the three topped 5w shots');
eq(C.sessionMishits(data.sessions).size, 3, 'mis-hits across all sessions');
eq(['5hy', '4hy', '5w', '3w', 'Driver', '7i', '4i', 'PW', 'SW'].map(C.launchFloor), [5, 5, 5, 5, 5, 10, 10, 10, 10], 'launch floor: 5° woods/hybrids/driver, 10° irons/wedges');
eq(C.mishits([{ club: '5hy', carry_yds: 138, launch_deg: 9 }, { club: '5hy', carry_yds: 140, launch_deg: 18 }]).length, 0, 'a 9° hybrid shot is not a mis-hit');
eq(C.quantile([21, 26, 68, 136, 138], 0.75), 136, '5w upper quartile');
eq(C.quantile([54, 55, 63, 64, 70, 80, 88], 0.75), 75, 'SW upper quartile (interpolated)');
eq(C.median([21, 26, 68, 136, 138]), 68, 'median (why it was replaced: 60% of 68 misses the 68-yd top)');
const fake = [{ club: 'PW', carry_yds: 85, launch_deg: 30 }, { club: 'PW', carry_yds: 88, launch_deg: 31 }, { club: 'PW', carry_yds: 20, launch_deg: 12 }, { club: 'PW', carry_yds: 70, launch_deg: 4 }];
eq(C.mishits(fake).map((m) => m.reasons.join('+')), ['short carry', 'low launch'], 'mis-hit rules');
eq(C.mishits([{ club: 'Driver', carry_yds: 200, launch_deg: 7 }]).length, 0, 'driver launch floor is 5°');
const hlNov = C.buildHighlights([nov], aug).map((h) => h.text);
eq(hlNov, [
  '48 shots with 6 clubs (SW, PW, 9i, 7i, 5hy, 5w).',
  'Solid contact: 45 of 48 shots (94%).',
  '3 likely thin or topped shots, all with the 5w (launch as low as 2°, carry as short as 21 yds).',
  'Average miss: SW 3.2 R · PW 0.6 L · 9i 2.4 R · 7i 4.6 R · 5hy 28.3 R · 5w 16.2 R yds. Mis-hits are left out.',
  'Needs work: SW (carry varies a lot, 54 to 88 yds), 5hy (misses about 28 yds right on average), 5w (3 of 5 shots were mis-hits; misses about 16 yds right on average).',
  'Since Aug 9, 2026 (baseline): PW shortest carry 9 → 69 yds, lowest launch 1.7° → 26°.',
], 'Nov 1 highlights');
// The first 36 shots alone (the brief's original data) still give the clean-contact line and the rightward trend.
eq(C.buildHighlights([nov36], aug).map((h) => h.text).slice(1, 4), [
  'Solid contact: 36 of 36 shots (100%).',
  'No thin or topped shots, lowest launch 18° (9i, 5hy).',
  'Average miss: PW 0.6 L · 9i 2.4 R · 7i 4.6 R · 5hy 28.3 R yds. The miss moves farther right as the clubs get longer.',
], 'first 36 shots: clean contact and rightward miss trend');
eq(C.buildHighlights([{ id: 'x', shots: [{ club: 'SW', carry_yds: 70, launch_deg: 40 }, { club: 'SW', carry_yds: 72, launch_deg: 41 }, { club: 'SW', carry_yds: 20, launch_deg: 30 }, { club: '5w', carry_yds: 140, launch_deg: 10 }, { club: '5w', carry_yds: 60, launch_deg: 3 }] }], null)[2].text,
  '2 likely thin or topped shots: SW ×1, 5w ×1 (launch as low as 3°, carry as short as 20 yds).', 'contact text across clubs');
eq(C.buildHighlights([aug], aug).map((h) => h.text), [
  'Ranges only; individual shots weren’t recorded.',
  'Thin or topped contact: PW launch as low as 1.7°, carry as short as 9 yds.',
  'This is the baseline session that progress is measured from.',
], 'Aug highlights');
eq(C.buildHighlights([], null), [], 'no sessions -> no highlights');
// A club whose shots were all mis-hits: no numbers, nothing breaks.
const allMis = { id: 'am', date: '2026-12-01', shots: [
  { id: 'a1', club: '7i', carry_yds: 60, launch_deg: 4, offline_ft: 10 }, { id: 'a2', club: '7i', carry_yds: 62, launch_deg: 5, offline_ft: -5 },
  { id: 'a3', club: 'PW', carry_yds: 80, launch_deg: 30, offline_ft: 0 }] };
const am = C.clubData([allMis]);
const amSt = C.metricStat(am['7i'], 'carry_yds');
eq([amSt.allMis, amSt.total, amSt.avg, amSt.min, am['7i'].solid.length, C.solidPct(am['7i'])], [true, 2, null, null, 0, 0], 'a club whose shots were all mis-hits');
eq(C.metricStat(am['7i'], 'spin_rpm'), null, 'all-mis club: a metric no shot has stays null');
eq(C.buildHighlights([allMis], null).map((h) => h.text), [
  '3 shots with 2 clubs (PW, 7i).',
  'Solid contact: 1 of 3 shots (33%).',
  '2 likely thin or topped shots, all with the 7i (launch as low as 4°, carry as short as 60 yds).',
  'Needs work: 7i (2 of 2 shots were mis-hits).',
], 'highlights with an all-mis club');
eq(C.progressFor([allMis], '7i', null).rows.length, 1, 'progress still lists an all-mis club');

section('Outliers: far off the usual carry, still solid contact');
const ol = (carries, club, extra) => carries.map((c, i) => Object.assign({ id: 'o' + i, club: club || '7i', carry_yds: c, launch_deg: 20, offline_ft: 0 }, extra ? extra(c) : {}));
const olShots = ol([118, 120, 121, 119, 122, 120, 117, 123, 90, 150]);
eq(C.outliers(olShots).map((o) => [o.shot.carry_yds, o.side, o.usual]), [[90, 'short', 120], [150, 'long', 120]], 'a far-short and a far-long shot are outliers');
eq(C.outliers(ol([58, 61, 63, 66, 77, 77, 78, 82, 89, 92, 93, 94, 98, 102], 'PW')).length, 0, 'a wide spread has no outliers: the yardstick grows with it');
eq(C.outliers(ol([100, 100, 100, 101, 100, 110])).length, 0, 'tight group: 10% long is not an outlier (MAD floor)');
eq(C.outliers(ol([100, 100, 100, 101, 100, 117])).map((o) => o.shot.carry_yds), [117], 'tight group: 17% long is');
eq(C.outliers(ol([120, 121, 119, 90])).length, 0, 'needs 5 solid shots');
eq(C.outliers(ol([118, 120, 150, 119]).concat([{ id: 'm', club: '7i', carry_yds: 40, launch_deg: 4 }])).length, 0,
  'a mis-hit is never an outlier, and only solid shots count toward the 5');
eq(C.outliers(C.sessionShots(nov)).length, 0, 'Nov 1: no outliers, so the numbers above are unchanged');
const olSession = { id: 'ol', date: '2026-12-02', shots: olShots };
const olE = C.clubData([olSession])['7i'];
eq([olE.shots.length, olE.solid.length, olE.outliers.length, olE.mis.length, C.solidCount(olE), C.solidPct(olE)], [10, 8, 2, 0, 10, 100],
  'outliers stay out of the numbers but count as solid contact');
eq([C.metricStat(olE, 'carry_yds').avg, C.metricStat(olE, 'carry_yds').min, C.metricStat(olE, 'carry_yds').max], [120, 117, 123], 'average and range leave outliers out');
const olG = C.clubGoals(olE, '7i', null);
const olGoal = (id) => olG.goals.find((g) => g.id === id);
eq([olGoal('contact').n, olGoal('contact').of, olGoal('contact').met, olGoal('carry').of, olGoal('line').of], [10, 10, true, 10, 10],
  'goals: outliers count as solid, and in the carry-zone and on-line counts');
const olFast = C.clubData([{ id: 'f', shots: ol([118, 120, 121, 119, 122, 120, 117, 123, 150], '7i', (c) => ({ ball_speed_mph: c === 150 ? 105 : 88 + (c - 117) })) }])['7i'];
eq(C.strikeReference(olFast, '7i', null).metrics.carry_yds.max, 123, 'pure strike leaves out a long outlier, even with the fastest ball speed');
eq(C.buildHighlights([olSession], null).map((h) => h.text).slice(1, 4), [
  'Solid contact: 10 of 10 shots (100%).',
  'No thin or topped shots, lowest launch 20° (7i).',
  '2 outliers, far off the usual carry: 7i 90 and 150 yds (usually 120). They’re left out of the numbers but still count as solid contact.',
], 'highlights list the outliers');
eq(C.sessionCallout('carry', [olSession]).text, 'Average carry: 7i 120.0 yds. Outliers are left out.', 'callout says outliers are left out');
eq(C.sessionCallout('mishits', [olSession]).text, 'No thin or topped shots in 10 shots.', 'outliers are not thin or topped');

section('Needs work and per-club goals');
const novE = C.clubData([nov]);
eq(C.sortClubs(Object.keys(novE)).map((c) => [c, C.needsWork(novE[c]).map((f) => f.kind)]),
  [['SW', ['distance']], ['PW', []], ['9i', []], ['7i', []], ['5hy', ['direction']], ['5w', ['contact', 'direction']]], 'needs-work flags on Nov 1');
eq(C.needsWork(novE['5hy'])[0].text, 'misses about 28 yds right on average', '5hy direction text');
eq(C.needsWork(novE['5w']).map((f) => f.key), ['solid_pct', 'offline_ft'], '5w flags point at solid contact and offline');
eq(C.needsWork(novE.SW)[0].key, 'carry_yds', 'SW flag points at carry');
eq(C.needsWork(null), [], 'no entry, no flags');
const goalsOf = (c) => {
  const G = C.clubGoals(novE[c], c), o = {};
  G.goals.forEach((g) => { o[g.id] = g.id === 'carry' ? [g.lo, g.hi, g.n, g.of, g.met] : g.id === 'launch' ? [g.lo, g.hi, g.status] : [g.n, g.of, g.met]; });
  return [G.focus.kind, o];
};
eq(goalsOf('PW'), ['launch', { carry: [85, 97, 4, 9, false], line: [6, 9, false], launch: [26, 30, 'high'], contact: [9, 9, true] }], 'PW goals: focus on launch, zone around the 91-yd pure strike');
eq(goalsOf('5hy'), ['direction', { carry: [140, 156, 2, 4, false], line: [1, 4, false], launch: [15, 19, 'high'], contact: [4, 4, true] }], '5hy goals: focus on direction');
eq(goalsOf('5w'), ['contact', { carry: [129, 145, 2, 5, false], line: [1, 5, false], launch: [12, 16, 'low'], contact: [2, 5, false] }], '5w goals: focus on contact');
eq(goalsOf('SW'), ['launch', { carry: [66, 84, 2, 7, false], line: [6, 7, true], launch: [30, 34, 'high'], contact: [7, 7, true] }], 'SW goals');
eq(goalsOf('9i')[0], 'direction', '9i focus: direction (7 of 15 within 10 yds)');
eq(C.clubGoals(null, 'PW'), null, 'no shots, no goals');

section('Pure strikes and checking a live shot');
const refOf = (c) => { const r = C.strikeReference(novE[c], c); return [r.carry, r.n, r.metrics.ball_speed_mph.min, r.by]; };
eq(C.sortClubs(Object.keys(novE)).map((c) => [c].concat(refOf(c))), [
  ['SW', 75, 2, 64, 'ball_speed_mph'], ['PW', 91, 3, 73, 'ball_speed_mph'], ['9i', 109, 5, 84, 'ball_speed_mph'],
  ['7i', 127, 2, 95, 'ball_speed_mph'], ['5hy', 148, 2, 104, 'ball_speed_mph'], ['5w', 137, 2, 106, 'ball_speed_mph']],
  'pure-strike carry, shot count and ball speed per club');
eq(C.bestStrikes(novE.SW, 'SW').shots.some((s) => s.launch_deg === 22), false, 'the 22° sand wedge (a thin strike) is not a pure strike');
eq(C.bestStrikes(novE['9i'], '9i').shots.some((s) => s.launch_deg === 18), false, 'the 18° low 9i is left out');
eq(C.bestStrikes(novE['5w'], '5w').shots.map((s) => s.id).sort(), ['2026-11-01-040', '2026-11-01-041'], '5w: its two solid shots');
const noSpeed = { shots: [{ club: '7i', carry_yds: 100 }, { club: '7i', carry_yds: 120 }, { club: '7i', carry_yds: 110 }], mis: [], ranges: {} };
noSpeed.solid = noSpeed.shots;
eq([C.strikeReference(noSpeed, '7i').by, C.strikeReference(noSpeed, '7i').carry], ['carry_yds', 115], 'no ball speed: best quarter by carry');
eq(C.strikeReference(null, 'PW'), null, 'no data, no reference');
const pure = C.checkShot(novE.PW, 'PW', { carry_yds: 91, ball_speed_mph: 76, launch_deg: 28, offline_ft: 12 });
eq([pure.verdict, pure.title, pure.lines.map((l) => l.ok)], ['pure', 'Pure strike!', [true, true, true, true]], 'a pure PW strike');
eq(C.checkShot(novE.PW, 'PW', { carry_yds: 80, ball_speed_mph: 70, launch_deg: 35, offline_ft: -45 }).lines.map((l) => l.text), [
  'Ball speed 70 mph: close to a pure strike (73+).',
  'Carry 80 yds: 5 short of your 85–97 yd zone.',
  'Launch 35° is high (aim for 26–30°): keep your hands ahead.',
  '45 ft L (15 yds): outside the 10-yd target.'], 'a so-so PW: what was off');
eq(C.checkShot(novE.PW, 'PW', { carry_yds: 40, ball_speed_mph: 55, launch_deg: 6 }).verdict, 'mishit', 'a topped PW');
eq(C.checkShot(novE['5hy'], '5hy', { carry_yds: 150, launch_deg: 17 }).verdict, 'good', 'carry and launch only: good shot');
eq(C.checkShot(null, 'PW', { carry_yds: 80 }), null, 'no data for the club: nothing to check');

section('Launch targets from his club lofts');
const blackCats = { bag: { '7i': { model: 'Lynx Black Cat', loft_deg: 33 }, '9i': { model: 'Lynx Black Cat', loft_deg: 41 }, PW: { model: 'Lynx Black Cat', loft_deg: 45 },
  '3i': { model: 'Lynx Black Cat', loft_deg: 20 }, '5hy': { model: 'Callaway Edge', loft_deg: null }, Driver: { model: 'Callaway Edge', loft_deg: 10.5 } } };
eq(['7i', '9i', 'PW', '5hy', 'SW'].map((c) => C.launchWindow(c, blackCats)), [[19, 23], [24, 28], [27, 31], [15, 19], [30, 34]],
  'windows from loft (64%, ±2°); clubs without a loft keep the general windows');
eq([C.clubLoft('7i', blackCats), C.clubLoft('5hy', blackCats), C.clubLoft('7i', null)], [33, null, null], 'club loft lookup');
eq(C.launchWindow('PW', null), [26, 30], 'no equipment: general window');
const pwG = C.clubGoals(novE.PW, 'PW', blackCats).goals.find((g) => g.id === 'launch');
eq([pwG.lo, pwG.hi, pwG.status], [27, 31, 'high'], 'PW goal uses the Black Cat loft');
eq(C.checkShot(novE.PW, 'PW', { launch_deg: 31 }, blackCats).lines[0].ok, true, 'a 31° PW launch is on target with a 45° PW');
eq(C.checkShot(novE.PW, 'PW', { launch_deg: 31 }).lines[0].ok, false, 'but high against the general 26–30° window');
eq(['3i', 'Driver', '5hy'].map((c) => C.launchWindow(c, blackCats)), [[11, 15], [12, 16], [15, 19]], '3 iron from its loft, driver loft + 3°, hybrid without a loft keeps the general window');
eq(C.launchWindow('5hy', { bag: { '5hy': { loft_deg: 25 } } }), [15, 19], 'a 25° hybrid: 68% of loft');
eq(C.launchWindow('3w', { bag: { '3w': { loft_deg: 15 } } }), [9, 13], 'a 15° 3 wood: 75% of loft');
eq(['PW', '7i', 'Driver', '5w', 'SW'].map(C.clubKind), ['iron', 'iron', 'driver', 'wood', 'iron'], 'club kinds');
eq([C.clubSpec('5hy', blackCats).model, C.clubSpec('SW', blackCats)], ['Callaway Edge', null], 'club spec lookup');
eq(Object.keys(fileData.equipment.bag).map((c) => [c, fileData.equipment.bag[c].model]).filter((x) => x[1] === 'Callaway Edge').map((x) => x[0]), ['5hy', 'Driver'],
  'Dad\u2019s file: the 5 hybrid and driver are Callaway Edge');
eq(['3i', '4i', '5i', '6i', '7i', '8i', '9i', 'PW'].every((c) => fileData.equipment.bag[c].model === 'Lynx Black Cat'), true, 'Dad\u2019s file: 3 iron to PW are Lynx Black Cats');
const w56 = { club: '56°', shots: [{ club: '56°', carry_yds: 60, launch_deg: 33 }], mis: [], ranges: {} };
w56.solid = w56.shots;
eq(C.clubGoals(w56, '56°').goals.map((g) => g.id), ['carry', 'contact'], 'no launch window or offline data: carry and contact goals only');

section('Personal and coach goals');
const fileGoals = [
  { id: 'g1', text: 'Hold your finish for 3 seconds', source: 'coach', added: '2026-11-02', done: false },
  { id: 'g2', text: 'Break 100 by spring', source: 'me', added: '2026-11-02', done: false },
  { id: 'g3', text: 'Old goal', source: 'coach', added: '2026-10-01', done: true },
];
eq(C.mergeGoals(fileGoals).map((g) => [g.id, g.source, g.done]), [['g1', 'coach', false], ['g2', 'me', false], ['g3', 'coach', true]], 'file goals pass through');
eq(C.mergeGoals(fileGoals, { added: [{ id: 'g4', text: 'Ball first, then turf', source: 'me', added: '2026-11-03' }], edits: { g1: { done: true }, g3: { done: false } }, removed: ['g2'] })
  .map((g) => [g.id, g.done]), [['g1', true], ['g3', false], ['g4', false]], 'device changes: add, mark done, undo, remove');
eq(C.mergeGoals([{ id: 'x', text: 'Keep your head still', source: 'Coach Jim' }, { id: 'x', text: 'dupe', source: 'me' }, { id: 'y', text: '' }, null, 'junk'])
  .map((g) => [g.id, g.source, g.text]), [['x', 'coach', 'Keep your head still']], 'bad entries skipped, first id wins, "Coach …" counts as a coach goal');
eq(C.mergeGoals(null, null), [], 'no goals');
eq(Array.isArray(fileData.personal_goals), true, 'Dad\u2019s file has a goals list');
eq(FIXTURE_SESSIONS.every((id) => fileData.sessions.some((s) => s.id === id)), true, 'the hand-checked sessions are still in the file');
// Saving goals back to the repo: only personal_goals changes, key order and formatting are kept.
const dadObj = JSON.parse(JSON.stringify(data));
const dadText = JSON.stringify(dadObj, null, 2) + (fileText.endsWith('\n') ? '\n' : '');
eq(C.applyGoals(dadObj, { added: [], edits: {}, removed: [] }), null, 'no goal changes: nothing to save');
const saved = C.applyGoals(dadObj, { added: [{ id: 'goal-2026-11-02-1', text: 'Keep your head still', source: 'coach', added: '2026-11-02' }], edits: {}, removed: [] });
eq(Object.keys(saved), Object.keys(dadObj), 'key order kept');
eq(saved.personal_goals, [{ id: 'goal-2026-11-02-1', text: 'Keep your head still', source: 'coach', added: '2026-11-02', done: false }], 'goal written in the file format');
eq(JSON.stringify(saved.sessions) === JSON.stringify(dadObj.sessions) && saved.player === dadObj.player, true, 'sessions and player untouched');
const savedText = JSON.stringify(saved, null, 2) + (dadText.endsWith('\n') ? '\n' : '');
const lineDiff = savedText.split('\n').filter((l, i, a) => dadText.split('\n').indexOf(l) < 0);
eq(lineDiff.every((l) => /goal-2026-11-02-1|Keep your head still|"source": "coach"|"added": "2026-11-02"|"done": false|"personal_goals": \[|^\s*[{}\]],?$/.test(l)), true, 'rewritten file differs only in the goals lines');
const done1 = C.applyGoals(saved, { added: [], edits: { 'goal-2026-11-02-1': { done: true } }, removed: [] });
eq(done1.personal_goals[0].done, true, 'mark done saves to the file');
eq(C.applyGoals(done1, { added: [], edits: {}, removed: ['goal-2026-11-02-1'] }).personal_goals, [], 'remove saves to the file');
const noKey = { player: { name: 'X' }, sessions: [] };
eq(Object.keys(C.applyGoals(noKey, { added: [{ id: 'a', text: 'Hi', source: 'me' }] })), ['player', 'personal_goals', 'sessions'], 'personal_goals added before sessions when missing');

section('Progress');
const pPW = C.progressFor(data.sessions, 'PW', data.baseline_session_id);
eq([pPW.rows.length, pPW.baseline.session.id, pPW.latest.session.id, pPW.fallback], [2, '2026-08-rapsodo', '2026-11-01-toptracer', false], 'PW progress uses the Aug baseline');
eq(pPW.rows.map((r) => C.solidPct(r.entry)), [null, 100], 'PW solid contact: unknown in Aug, 100% on Nov 1');
const p9 = C.progressFor(data.sessions, '9i', data.baseline_session_id);
eq([p9.rows.length, p9.baseline.session.id, p9.fallback], [1, '2026-11-01-toptracer', true], '9i falls back to its first session');
const cmp = C.compareStats(C.metricStat(pPW.baseline.entry, 'carry_yds'), C.metricStat(pPW.latest.entry, 'carry_yds'));
eq([cmp.dMin, cmp.dMax, cmp.dAvg], [60, 1, null], 'PW carry change since baseline');
eq(C.solidPct(C.progressFor(data.sessions, '5w', null).latest.entry), 40, '5w solid contact 40% in progress');

section('Better or worse since the baseline');
const sum = (key, vals) => C.summarize(vals.map((v) => ({ [key]: v })), key);
const tr = (key, a, b, w) => { const t = C.trend(key, sum(key, a), sum(key, b), { window: w }); return t && [t.dir, t.level, t.basis]; };
eq(tr('carry_yds', [100, 100], [105, 105]), ['better', 2, 'average'], 'carry +5%: better, two arrows');
eq(tr('carry_yds', [100, 100], [90, 90]), ['worse', 3, 'average'], 'carry −10%: much worse');
eq(tr('carry_yds', [100, 100], [101, 101]), ['same', 0, 'average'], 'carry +1%: about the same');
eq(tr('ball_speed_mph', [80, 80], [82, 82]), ['better', 1, 'average'], 'ball speed +2.5%: a little better');
eq(tr('launch_deg', [26, 26], [23, 23], [19, 23]), ['better', 2, 'target'], 'launch moving into its window: better');
eq(tr('launch_deg', [21, 21], [27, 27], [19, 23]), ['worse', 3, 'target'], 'launch moving 4° past its window: much worse');
eq(C.trend('launch_deg', sum('launch_deg', [26]), sum('launch_deg', [23]), {}), null, 'launch with no window: no arrow');
eq(tr('offline_ft', [80, 90, 85], [-60, 20, 40, 30, 10, -5]), ['better', 3, 'line'], 'offline closer to the line on average is better, even with a wider spread');
eq(tr('curve_ft', [5, -5], [20, -20]), ['worse', 3, 'line'], 'more bend: worse');
eq(tr('apex_ft', [60, 60], [70, 70]), null, 'peak height gets no arrow');
eq(C.trend('solid_pct', { avg: 80 }, { avg: 90 }).dir + C.trend('solid_pct', { avg: 80 }, { avg: 90 }).level, 'better2', 'solid contact +10 points: better');
eq(C.trend('solid_pct', { avg: 90 }, { avg: 88 }).dir, 'same', 'solid contact −2 points: about the same');
const summaryOnly = { n: 0, of: 0, avg: null, min: 9, max: 95, summaryOnly: true, values: [] };
eq((({ dir, level, basis }) => [dir, level, basis])(C.trend('carry_yds', summaryOnly, sum('carry_yds', [80, 108]))), ['better', 3, 'best'], 'a ranges-only baseline compares the longest shots');
eq(C.trend('offline_ft', summaryOnly, sum('offline_ft', [5, 10])), null, 'a ranges-only baseline: no verdict on offline');
eq(C.trend('carry_yds', { allMis: true }, sum('carry_yds', [100])), null, 'all mis-hits: no arrow');
ok(C.trend('carry_yds', sum('carry_yds', [100, 101]), sum('carry_yds', [110])).few, 'flags a comparison with only a few shots');


section('Tips callouts (from the last session)');
const callTitle = 'From your last session (Nov 1, 2026)';
eq(C.sessionCallout('mishits', data.sessions), { sessionId: '2026-11-01-toptracer', title: callTitle,
  text: '3 likely thin or topped shots, all with the 5w (launch as low as 2°, carry as short as 21 yds). Solid contact: 45 of 48 shots (94%).' }, 'mis-hits callout');
eq(C.sessionCallout('launch', data.sessions).text, 'Average launch: SW 40.0° · PW 34.1° · 9i 31.7° · 7i 26.0° · 5hy 20.8° · 5w 10.0°. Mis-hits are left out.', 'launch callout');
eq(C.sessionCallout('miss', data.sessions).text, 'Average miss: SW 3.2 R · PW 0.6 L · 9i 2.4 R · 7i 4.6 R · 5hy 28.3 R · 5w 16.2 R yds. Mis-hits are left out.', 'miss callout');
eq(C.sessionCallout('carry', data.sessions).text, 'Average carry: SW 67.7 · PW 83.4 · 9i 100.7 · 7i 114.5 · 5hy 141.0 · 5w 137.0 yds. Mis-hits are left out.', 'carry callout');
eq(C.sessionCallout('mishits', [nov36]).text, 'No thin or topped shots in 36 shots.', 'clean-session callout');
eq([C.sessionCallout('mishits', [aug]), C.sessionCallout('launch', []), C.sessionCallout('nope', data.sessions)], [null, null, null], 'no callout without shot data');

section('Players and tips content');
const root = path.join(__dirname, '..');
const players = JSON.parse(fs.readFileSync(path.join(root, 'data', 'players.json'), 'utf8')).players;
eq(players.map((p) => [p.id, p.name, p.file]), [['dad', 'Dad', 'data/dad_golf_data.json'], ['brother', 'M3', 'data/brother_golf_data.json']], 'players.json');
for (const p of players) {
  const d = JSON.parse(fs.readFileSync(path.join(root, p.file), 'utf8'));
  eq([d.player.name, Array.isArray(d.sessions)], [p.name, true], `${p.id}: data file name matches and has sessions`);
}
const bro = JSON.parse(fs.readFileSync(path.join(root, 'data', 'brother_golf_data.json'), 'utf8'));
eq([bro.player.relationship, bro.player.level, bro.player.age, bro.player.height_in, bro.baseline_session_id],
  ["Matthew's brother", 'beginner', 14, 60, null], 'brother file: player details, baseline is each club’s first session');
ok(bro.sessions.every((s) => (s.shots || []).every((x) => bro.clubs[x.club])), 'brother file: every club he has hit is in the clubs map');
const broNov12 = bro.sessions.find((s) => s.id === '2026-11-12-toptracer');
eq(C.outliers(C.sessionShots(broNov12)).map((o) => [o.shot.id, o.shot.club, o.shot.carry_yds, o.side]), [['2026-11-12-toptracer-071', 'Driver', 132, 'short']],
  'M3 Nov 12: the 132-yd driver is the one outlier');
eq(Object.keys(bro), Object.keys(data).filter((k) => k !== 'equipment'), 'brother file has the same top-level keys as Dad’s (equipment is optional)');
eq([data.player.age, data.player.height_in], [56, 73], 'Dad: age and height');
eq([C.buildHighlights([], null), C.sessionCallout('carry', []), C.progressFor([], 'PW', null).rows.length], [[], null, 0], 'no data: no highlights, callouts or progress rows');
eq([C.resolvePlayer(players, 'brother', 'dad'), C.resolvePlayer(players, 'nobody', 'brother'), C.resolvePlayer(players, null, null), C.resolvePlayer([], 'x', 'y')],
  ['brother', 'brother', 'dad', null], 'resolvePlayer: URL, then last used, then first');
eq([C.fmtHeight(73), C.fmtHeight(60), C.fmtHeight(null)], ['6′1″', '5′0″', ''], 'fmtHeight');
eq(C.youtubeSearchUrl('golf towel drill'), 'https://www.youtube.com/results?search_query=golf%20towel%20drill', 'YouTube search link');
const TIPS = require('../js/tips.js');
eq(TIPS.dad.focus.map((f) => f.id), ['contact', 'turn', 'hands', 'straight', 'fit', 'plan'], 'Dad focus areas');
eq(TIPS.brother.focus.map((f) => f.id), ['clubs', 'strike', 'short', 'speed', 'games', 'plan'], 'M3 focus areas');
for (const p of players) {
  const t = TIPS[p.id];
  ok(t && t.intro && /coach/i.test(t.lesson || ''), `${p.id}: intro and a coach line`);
  ok(!/brother/i.test(JSON.stringify(t)), `${p.id}: tips don't say "brother" (names come from the data)`);
  t.focus.forEach((f) => {
    ok(f.title && f.why && f.drills.length >= 2 && f.drills.length <= 4, `${p.id}/${f.id}: title, why, 2–4 drills`);
    ok(!f.callout || ['mishits', 'launch', 'miss', 'carry'].indexOf(f.callout) >= 0, `${p.id}/${f.id}: known callout`);
    f.drills.forEach((d) => ok(d.name && d.reps && d.search && d.steps.length >= 2, `${p.id}/${f.id}/${d.name}: steps, reps, search`));
  });
}

// ---------------------------------------------------------------------------
section('Drill animations and coach videos');
const DA = require('../js/drillart.js');
for (const p of players) {
  TIPS[p.id].focus.forEach((f) => f.drills.forEach((d, i) => {
    const w = `${p.id}/${f.id}:${i} ${d.name}`;
    eq(DA.validate(d.art), [], `${w}: animation is valid`);
    const big = DA.render(d.art, 0, { label: d.name }), thumb = DA.render(d.art, d.art.frames.length - 1, { thumb: true });
    ok(/^<svg class="da"/.test(big) && /role="img"/.test(big) && /aria-label="/.test(big), `${w}: stage frame is a labelled SVG`);
    ok(!/<text/.test(thumb), `${w}: strip frames have no text`);
    if (d.video) ok(/^[\w-]{11}$/.test(d.video.id) && d.video.title && d.video.by, `${w}: video has an id, title and coach`);
  }));
}
const towel = TIPS.dad.focus[0].drills[0].art;
ok(/da-towel/.test(DA.render(towel, 0)), 'towel drill frame draws the towel');
ok(DA.moves(towel) && !DA.moves(TIPS.brother.focus.find((f) => f.id === 'short').drills[0].art), 'swing scenes move; putting games cut');
const mid = DA.tween(towel, 0, 1, 0.5, {});
ok(mid !== DA.render(towel, 0) && mid !== DA.render(towel, 1), 'tween draws an in-between position');
eq(DA.tween(towel, 0, 1, 1, {}), DA.render(towel, 1, {}), 'tween at the end = the next frame');
eq(DA.validate({ scene: 'swing', frames: [{ pose: 'nope', cap: 'x' }] }), ['needs 2–4 frames', 'frame 1: unknown pose nope'], 'validate catches bad specs');
// The figure's positions follow real face-on swing positions.
const iron = { scene: 'swing', club: 'iron', frames: ['address', 'halfBack', 'top', 'impact', 'halfThru', 'finish'].map((pose) => ({ pose, cap: pose })) };
const P = iron.frames.map((f, i) => DA.points(iron, i));
ok(P[0].hands[1] > P[0].hip[1], 'address: hands hang below the belt');
ok(Math.abs(P[1].hands[1] - P[1].hip[1]) < 6 && P[1].hands[0] < P[0].hands[0] - 12, 'halfway back: hands at hip height, toward the trail side');
ok(P[2].hands[0] < P[2].head[0] - 14 && P[2].hands[1] < P[2].head[1], 'top: hands above and behind the head, not on it');
ok(P[3].hands[0] > P[3].ball[0], 'impact: hands ahead of the ball');
ok(P[4].hands[0] > P[3].hands[0] + 8, 'halfway through: hands past impact, toward the target');
ok(P[5].hands[0] > P[5].head[0] + 12 && P[5].hands[1] < P[5].head[1], 'finish: hands high on the target side of the head');
const film = { scene: 'camera', auto: false, frames: [{ view: 'face', cap: 'a' }, { scene: 'framing', view: 'face', cap: 'b' }, { view: 'dtl', cap: 'c' }, { scene: 'framing', view: 'dtl', cap: 'd' }] };
eq(DA.validate(film), [], 'filming guide spec is valid');
ok(/da-cam on/.test(DA.render(film, 0)) && /Face-on/.test(DA.render(film, 0)) && /Down the line/.test(DA.render(film, 2)), 'filming guide: the active camera and its label');
ok(/da-phone/.test(DA.render(film, 1)) && /da-phone/.test(DA.render(film, 3)), 'filming guide: what goes in the picture');

section('Shot replay: the flight from the numbers');
const FL = require('../js/flight.js');
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const peakOf = (tr) => { let m = 0; for (let i = 0; i <= 2000; i++) m = Math.max(m, tr.at(tr.hang * i / 2000).y); return m; };
const slopeDeg = (tr, s0, s1) => Math.atan2(tr.height(s1) - tr.height(s0), s1 - s0) * 180 / Math.PI;
const top3w0 = FL.trajectory({ club: '3w', carry_yds: 65, total_yds: 145, ball_speed_mph: 115, launch_deg: 2, apex_ft: 2, landing_deg: 3, curve_ft: 0, offline_ft: 15 }, { kind: 'wood' });
const t7 = FL.trajectory({ club: '7i', carry_yds: 125, total_yds: 130, ball_speed_mph: 94, launch_deg: 22, apex_ft: 63, landing_deg: 40, hang_time_s: null, curve_ft: -16, offline_ft: 6 }, { kind: 'iron' });
ok(near(peakOf(t7) * 3, 63, 0.2), 'peaks at the apex height (63 ft)');
ok(near(slopeDeg(t7, 0, 0.05), 22, 0.3), 'leaves the ground at the launch angle');
ok(near(-slopeDeg(t7, 124.95, 125), 40, 0.5), 'comes down at the landing angle');
ok(t7.apexPoint.z > 0.5 * 125 && t7.apexPoint.z < 0.7 * 125, 'apex a little past halfway');
eq([Math.round(t7.at(t7.hang).z), t7.rest.x, t7.rest.z, t7.at(t7.duration).x], [125, 2, 130, 2], 'lands at the carry, then finishes at the total, 6 ft right (offline is where it finished)');
ok(near(t7.land.x, 2, 0.2), 'the roll moves it only a little sideways');
ok(near((top3w0.rest.x - top3w0.land.x) / top3w0.roll, 0.6 * (top3w0.lateral(65) - top3w0.lateral(64.99)) / 0.01, 1e-3), 'it rolls on the way it was heading as it landed, a bit straighter');
ok(near(t7.lateral(125) - 125 * t7.lateral(0.01) / 0.01, -16 / 3, 0.05), 'bends 16 ft left of its start line (curve)');
ok(t7.samples.every((p, i, a) => !i || p.z > a[i - 1].z), 'always moving away from the tee');
ok(t7.estimated.join() === 'hang' && t7.hang > 4 && t7.hang < 6, 'no hang time on the screen: estimated from the apex (about 5 s)');
eq(['tee', 'flight', 'roll', 'rest'].map((ph, i) => t7.at([0, 1, t7.hang + 0.1, t7.duration + 1][i]).phase), ['tee', 'flight', 'roll', 'rest'], 'tee, flight, roll, rest');
ok(t7.along(1) > 30 && t7.along(1) < 45, 'first second: about the ball speed (94 mph is 46 yd/s across the ground at 22°)');
const top3w = FL.trajectory({ club: '3w', carry_yds: 65, total_yds: 145, ball_speed_mph: 115, launch_deg: 2, apex_ft: 2, landing_deg: 3, curve_ft: 0, offline_ft: 15 }, { kind: 'wood' });
ok(top3w.hang >= 65 / (115 * 1760 / 3600) && peakOf(top3w) * 3 <= 2.01 && top3w.rest.z === 145, 'topped 3 wood: low, never faster than it left the club, runs out to 145');
const bare = FL.trajectory({ club: 'PW', carry_yds: 90 }, { kind: 'iron' });
eq(bare.estimated, ['launch', 'apex', 'landing', 'total', 'curve', 'offline', 'hang'], 'only a carry: everything else estimated');
ok(near(bare.launch, 30, 1e-9) && near(bare.rest.z, 90 * 1.03, 1e-9) && bare.land.x === 0, 'wedge defaults: 30° launch, 3% roll, on line');
const back = FL.trajectory({ club: 'SW', carry_yds: 60, total_yds: 57, launch_deg: 34, apex_ft: 50, landing_deg: 50, curve_ft: 0, offline_ft: 0 }, { kind: 'iron' });
ok(back.rest.z === 57 && back.at(back.duration).z === 57, 'spins back to a total shorter than the carry');
eq([FL.trajectory({ club: '7i' }), FL.trajectory({ club: '7i', carry_yds: 0 })], [null, null], 'no replay without a carry');
// Every real shot in both data files flies to its own numbers.
let flown = 0, wrong = [];
['dad', 'brother'].forEach((pid) => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `${pid}_golf_data.json`), 'utf8'));
  d.sessions.forEach((s) => C.sessionShots(s).forEach((x) => {
    if (!C.isNum(x.carry_yds)) return;
    const tr = FL.trajectory(x, { kind: C.clubKind(x.club) });
    flown++;
    const bad = [];
    if (!tr || Math.abs(tr.at(tr.hang).z - x.carry_yds) > 1e-6) bad.push('carry');
    else {
      if (C.isNum(x.total_yds) && Math.abs(tr.rest.z - x.total_yds) > 1e-6) bad.push('total');
      if (C.isNum(x.offline_ft) && (Math.abs(tr.rest.x - x.offline_ft / 3) > 1e-6 || Math.abs(tr.at(tr.duration).x - x.offline_ft / 3) > 1e-6)) bad.push('offline');
      if (C.isNum(x.curve_ft) && Math.abs(tr.lateral(x.carry_yds) - x.carry_yds * tr.lateral(1e-3) / 1e-3 - x.curve_ft / 3) > 0.01) bad.push('curve');
      if (C.isNum(x.apex_ft) && Math.abs(peakOf(tr) * 3 - x.apex_ft) > Math.max(0.3, 0.01 * x.apex_ft)) bad.push('apex');
      if (!(tr.duration > 0 && tr.duration < 20)) bad.push('time');
      if (tr.at(tr.duration).phase !== 'rest') bad.push('still moving at the end');
    }
    if (bad.length) wrong.push(`${pid} ${x.id || x.time}: ${bad.join(', ')}`);
  }));
});
eq(wrong, [], `every real shot (${flown}) lands at its carry, bends by its curve, peaks at its apex, and finishes at its total and offline`);
// Cameras: from the tee box and from the side the whole flight fits, every point of it;
// above the green, the ball and the pin.
const camPts = FL.keyPoints(t7).concat([{ x: 0, y: 0, z: 145 }, { x: -13, y: 0, z: 130 }, { x: 13, y: 0, z: 130 }]);
const allIn = (cam, pts, w, h) => pts.every((p) => { const q = FL.project(cam, p.x, p.y, p.z); return q && q.x >= 0 && q.x <= w && q.y >= 0 && q.y <= h; });
const flightPts = t7.samples.concat([t7.rest, { x: 0, y: 0, z: 0 }]);
[[358, 222], [268, 200], [600, 372]].forEach(([w, h]) => {
  const tee = FL.fitTee(camPts, w, h), side = FL.fitSide(camPts, w, h);
  ok(allIn(tee, flightPts, w, h) && allIn(tee, camPts, w, h), `tee box at ${w}×${h}: the ball on the tee, the whole climb and drop, the landing and the pin in view`);
  ok(tee.z < -3 && tee.z > -25 && Math.abs(tee.x) < 1 && tee.y > 2 && tee.y < 3 && tee.yaw === 0, `${w}×${h}: tee box camera stands behind the ball at eye height, facing down the line`);
  ok(allIn(side, flightPts, w, h), `side at ${w}×${h}: the whole arc in view`);
  const lo = FL.project(side, 0, 0, 0), hi = FL.project(side, 0, 0, 130);
  ok(side.x > 30 && lo.x < hi.x, `${w}×${h}: side camera off to the right, tee on the left`);
  const green = FL.fitGreen([t7.rest, t7.land, { x: 0, y: 0, z: 128 }], w, h);
  ok(allIn(green, [t7.rest, { x: 0, y: 0, z: 128 }], w, h) && green.pitch < -50 * Math.PI / 180, `above the green at ${w}×${h}: ball and pin in view, looking down`);
});
eq(FL.VIEWS, ['tee', 'side', 'green'], 'three camera views');
const crs = FL.course(128, 150, 42);
eq(JSON.stringify(FL.course(128, 150, 42)), JSON.stringify(crs), 'the same course every time for one club');
ok(crs.trees.every((t) => Math.abs(t.x) > crs.half + 15 || t.z > crs.pin + crs.green.rz + 20), 'trees stay off the fairway and the green');
eq([crs.green.z, crs.markers], [128, [50, 100]], 'green at the pin; yardage markers before it');
// Drawing runs start to finish on a stand-in canvas, for every view.
let drawCalls = 0;
const fakeCtx = new Proxy({}, {
  get: (o, k) => (k in o ? o[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 8 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => { drawCalls++; }),
  set: (o, k, v) => { o[k] = v; return true; }
});
let drewAll = true;
try {
  const cams = { tee: FL.fitTee(camPts, 358, 222), side: FL.fitSide(camPts, 358, 222), green: FL.fitGreen([t7.rest, t7.land, { x: 0, y: 0, z: 128 }], 358, 222) };
  FL.VIEWS.forEach((view) => [0, 1, t7.apexT + 0.1, t7.hang, t7.hang + 0.5, t7.duration].forEach((t) =>
    FL.drawFrame(fakeCtx, { cam: cams[view], view, course: crs, cur: t7, t, past: [top3w, back] })));
} catch (e) { drewAll = false; console.error(e); }
ok(drewAll && drawCalls > 500, 'draws the course, tracer, ball and labels in every view');

section('Best 10 for the shot replay');
// Ball speed rises with carry, so the longest normal shots are the pure strikes.
const bsShot = (id, carry, off, launch) => ({ id, club: '7i', carry_yds: carry, total_yds: carry + 4, ball_speed_mph: 80 + (carry - 100) / 2, launch_deg: launch || 20, offline_ft: off });
const bsEntry = C.clubData([{ id: 'bs', date: '2026-12-03', shots: [
  bsShot('a', 120, 0), bsShot('b', 118, 6), bsShot('c', 125, 30), bsShot('d', 110, 0), bsShot('e', 121, -3), bsShot('f', 119, 3),
  bsShot('g', 122, -60), bsShot('h', 117, 9), bsShot('low', 126, 0, 14), bsShot('j', 116, 0), bsShot('mis', 40, 0, 4), bsShot('l', 123, 15),
  bsShot('m', 115, 3), bsShot('n', 119, -12)] }])['7i'];
const bsRef = C.strikeReference(bsEntry, '7i', null);
const bsBest = C.bestShots(bsEntry, '7i', null, 10);
const bsScore = (s) => Math.max(0, bsRef.carry - s.carry_yds) + Math.abs(s.offline_ft) / 3;
eq(bsBest.length, 10, 'up to 10');
ok(!bsBest.some((s) => s.id === 'mis' || s.id === 'low'), 'no mis-hits, and nothing launched below the normal height (15° for a 7 iron, though 14° is no mis-hit)');
ok(bsBest.every((s, i, a) => !i || bsScore(a[i - 1]) <= bsScore(s)), 'ranked by yards short of the pure-strike carry plus yards off line');
const bsAll = C.bestShots(bsEntry, '7i', null, 20);
eq([bsRef.carry, bsAll.length], [123, 12], 'pure-strike carry 123 (the three fastest normal shots); 12 shots to rank');
ok(bsAll.findIndex((s) => s.id === 'c') < bsAll.findIndex((s) => s.id === 'd'), 'a long shot 10 yds right beats a straight one 13 yds short of a pure strike');
eq(bsBest.slice(0, 2).map((s) => s.id), ['e', 'a'], 'equal scores (3): the faster ball speed first');
eq([C.bestShots(bsEntry, '7i', null, 3).length, C.bestShots(null, '7i', null).length], [3, 0], 'n caps the list; no shots, no list');
eq(C.pinFor(bsEntry, '7i', null), Math.round(bsRef.metrics.total_yds.avg), 'the pin is where a pure strike finishes, carry plus roll');
const dadNov22 = C.clubData([fileData.sessions.find((s) => s.id === '2026-11-22-toptracer')]);
eq(C.bestShots(dadNov22['5hy'], '5hy', fileData.equipment, 10).slice(0, 2).map((s) => [s.id, s.carry_yds]), [['2026-11-22-toptracer-080', 146], ['2026-11-22-toptracer-067', 152]],
  'Dad Nov 22: the best hybrids are his longest straight ones (146 yds 6 right, 152 yds 7 left)');

section('Swing reviews');
const SR = require('../js/review.js');
const rf = { src: 'media/dad/r1/1-top.jpg', w: 720, h: 1280, label: 'Top', marks: [
  { type: 'line', from: [360, 80], to: [360, 1200], kind: 'ref', dash: true },
  { type: 'circle', at: [360, 300], r: 60, kind: 'issue', n: 1 },
  { type: 'arrow', from: [600, 400], to: [420, 520], kind: 'fix', n: 2, label: 'turn here' },
  { type: 'angle', vertex: [360, 700], a: [360, 200], b: [610, 700], kind: 'ref' }],
  notes: [{ n: 1, kind: 'issue', text: 'Head moved back.' }, { n: 2, kind: 'fix', text: 'Turn your chest.' }] };
const mk = SR.markup(rf);
ok(/^<svg class="rv-svg" viewBox="0 0 720 1280"/.test(mk.svg) && (mk.svg.match(/class="rv-halo/g) || []).length === (mk.svg.match(/class="rv-ink/g) || []).length, 'markup: every shape has a halo and an ink stroke');
ok(/rv-m ref dash/.test(mk.svg) && /rv-m issue/.test(mk.svg) && /rv-m fix/.test(mk.svg), 'markup: kinds and dashes become classes');
eq(mk.pins.map((p) => [p.n, p.kind, p.label]), [[1, 'issue', ''], [2, 'fix', 'turn here'], [null, 'ref', '90°']], 'markup: number pins, labels and the angle in degrees');
eq([Math.round(mk.pins[1].x), Math.round(mk.pins[1].y)], [83, 31], 'markup: pins are placed in percent of the frame');
const review = { id: 'r1', date: '2026-11-15', view: 'face-on', club: '7i', summary: 's', frames: [rf], fixes: [{ text: 'Keep your head still', drill: 'contact:0' }] };
const ctx = { fileExists: () => true, clubOk: (c) => c === '7i', drillExists: (k) => k === 'contact:0', sessionExists: () => true };
eq(SR.validate(review, ctx), { errors: [], warnings: [] }, 'a good review passes');
const bad = SR.validate(Object.assign({}, review, { view: 'side', frames: [Object.assign({}, rf, { src: 'photos/x.heic', marks: [{ type: 'circle', at: [900, 10], kind: 'oops' }] })], fixes: [{ text: 'x', drill: 'nope:1' }] }), ctx);
eq(bad.errors.length, 6, 'a bad review: view, image path, mark kind, point outside the frame, circle radius, drill link');

// ---------------------------------------------------------------------------
section('Paste parser');
function shotsOf(text, opts, columns) {
  const p = C.parsePaste(text);
  return { p, rows: C.buildShots(p, columns || p.columns, opts || {}) };
}
function pick(shot, keys) { const o = {}; keys.forEach((k) => { o[k] = shot[k] === undefined ? null : shot[k]; }); return o; }
const K = ['club', 'time', ...C.TOPTRACER_ORDER];

let r = shotsOf('11:52 PW 81 87 72 26 44 41 24R 15R\n11:53 PW 69 75 63 29 38 40 7L 31L');
eq(r.p.columns, C.TOPTRACER_ORDER.filter((k) => k !== 'hang_time_s'), '8 values -> Toptracer order without hang time');
eq(pick(r.rows[0].shot, K), { club: 'PW', time: '11:52', carry_yds: 81, total_yds: 87, ball_speed_mph: 72, launch_deg: 26, apex_ft: 44, landing_deg: 41, hang_time_s: null, curve_ft: 24, offline_ft: 15 }, 'headerless row with attached R');
eq([r.rows[1].shot.curve_ft, r.rows[1].shot.offline_ft], [-7, -31], 'attached L');
eq(r.rows.every((x) => x.include && !x.warn.length), true, 'clean rows have no warnings');

r = shotsOf('PW 85 88 73 30 54 44 1 R 11 L');
eq([r.rows[0].shot.landing_deg, r.rows[0].shot.curve_ft, r.rows[0].shot.offline_ft], [44, 1, -11], 'detached suffix L/R');

r = shotsOf('PW 87 88 72 36 67 49 R 27 R 54\nPW 91 92 76 35 71 50 L 1 L 26');
eq(r.p.dirStyle, 'prefix', 'prefix style detected');
eq(r.rows.map((x) => [x.shot.landing_deg, x.shot.curve_ft, x.shot.offline_ft]), [[49, 27, 54], [50, -1, -26]], 'detached prefix L/R');

r = shotsOf('9i 111 112 86 33 86 50 -17 -58');
eq([r.rows[0].shot.curve_ft, r.rows[0].shot.offline_ft], [-17, -58], 'negative numbers = left');

r = shotsOf('PW 82 82 70 41 73 53 4.7 5R 15R\nPW 81 87 72 26 44 41 — 24R 15R');
eq(r.p.columns, C.TOPTRACER_ORDER, '9 values -> full Toptracer order');
eq(r.rows.map((x) => [x.shot.hang_time_s, x.shot.curve_ft, x.shot.offline_ft]), [[4.7, 5, 15], [null, 24, 15]], 'hang time and em-dash missing value');

r = shotsOf('7 iron\n12:21 113 116 90 22 61 43 5R 12L\n101 105 81 27 57 42 18R 41R\n5 Hybrid\n138 148 99 18 54 34 17L 19R');
eq(r.rows.map((x) => [x.shot.club, x.shot.time, x.shot.carry_yds]), [['7i', '12:21', 113], ['7i', null, 101], ['5hy', null, 138]], 'club-only lines set the club');

r = shotsOf('Pitching Wedge 91 92 76 35 71 50 1L 26L\n9 Iron 89 91 73 34 64 47 2R 13L');
eq(r.rows.map((x) => x.shot.club), ['PW', '9i'], 'long club names');

r = shotsOf('Average 83 86 72 34 62 4.4 47 5R 2L\nPW 81 87 72 26 44 41 24R 15R\nStd Dev 7 6 5 5 13 0.3 5 12 28');
eq(r.rows.length, 1, 'average / std rows skipped');

r = shotsOf('81\n69\n85', { defaultClub: 'PW' });
eq(r.rows.map((x) => [x.shot.club, x.shot.carry_yds]), [['PW', 81], ['PW', 69], ['PW', 85]], 'one value per line = carry');
r = shotsOf('81 15R\n69 31 L', { defaultClub: 'PW' });
eq(r.rows.map((x) => [x.shot.carry_yds, x.shot.offline_ft]), [[81, 15], [69, -31]], 'two values = carry, offline');
r = shotsOf('81 5R', { defaultClub: 'PW', lateralUnit: 'yd' });
eq(r.rows[0].shot.offline_ft, 15, 'offline in yards converted to feet');
r = shotsOf('81');
eq(r.rows[0].warn.indexOf('No club') >= 0 && !r.rows[0].include, true, 'no club -> warned and unticked');

r = shotsOf('Time Club Carry Total Ball Speed Launch Apex Landing Hang Time Curve Offline\n11:58 PW 82 82 70 41 73 53 4.7 5 R 15 R');
eq(r.p.hasHeader && r.p.columns, C.TOPTRACER_ORDER, 'whitespace header found by phrase scan');
eq(pick(r.rows[0].shot, K), { club: 'PW', time: '11:58', carry_yds: 82, total_yds: 82, ball_speed_mph: 70, launch_deg: 41, apex_ft: 73, landing_deg: 53, hang_time_s: 4.7, curve_ft: 5, offline_ft: 15 }, 'row under a whitespace header');

const RAPSODO = [
  'Rapsodo MLM2PRO: Dad - 08/09/2026 10:12 AM',
  '',
  '"Club Type","Club Brand","Club Model","Carry Distance (yds)","Total Distance (yds)","Ball Speed (mph)","Launch Angle (deg)","Launch Direction (deg)","Apex (ft)","Side Carry (yds)","Side Total (yds)","Club Speed (mph)","Smash Factor","Descent Angle (deg)","Attack Angle (deg)","Club Path (deg)","Spin Rate (rpm)","Spin Axis (deg)"',
  '"Pitching Wedge","Callaway","Edge",88.2,92.1,72.4,28.3,1.2,61.0,"3.1 R","4.0 R",63.5,1.14,48.2,-3.1,2.0,"7,812",4.1',
  '"Pitching Wedge","Callaway","Edge",9.4,31.0,40.2,1.7,-0.5,0.8,"0.4 L","1.2 L",62.0,0.65,2.1,-1.0,1.0,"1,204",-2.0',
  '"Average","","",48.8,61.6,56.3,15.0,0.4,30.9,"1.4 R","1.4 R",62.8,0.90,25.2,-2.1,1.5,"4,508",1.1',
  '"Std. Dev.","","",39.4,30.6,16.1,13.3,0.9,30.1,"1.8","2.6",0.8,0.25,23.1,1.1,0.5,"3,304",3.1',
].join('\n');
r = shotsOf(RAPSODO);
eq(r.p.delim, ',', 'Rapsodo CSV detected');
eq(r.p.columns, ['club', 'ignore', 'ignore', 'carry_yds', 'total_yds', 'ball_speed_mph', 'launch_deg', 'ignore', 'apex_ft', 'ignore', 'offline_ft', 'club_speed_mph', 'smash_factor', 'landing_deg', 'ignore', 'ignore', 'spin_rpm', 'ignore'], 'Rapsodo header mapping (Side Total preferred)');
eq(r.rows.length, 2, 'Rapsodo summary rows skipped');
eq(pick(r.rows[0].shot, ['club', 'carry_yds', 'total_yds', 'ball_speed_mph', 'launch_deg', 'apex_ft', 'offline_ft', 'club_speed_mph', 'smash_factor', 'landing_deg', 'spin_rpm']),
  { club: 'PW', carry_yds: 88.2, total_yds: 92.1, ball_speed_mph: 72.4, launch_deg: 28.3, apex_ft: 61, offline_ft: 12, club_speed_mph: 63.5, smash_factor: 1.14, landing_deg: 48.2, spin_rpm: 7812 }, 'Rapsodo row values and units');
eq(r.rows[1].shot.offline_ft, -3.6, 'Rapsodo side total in yds, L -> negative feet');
eq(C.mishits(r.rows.map((x) => x.shot)).length, 1, 'topped Rapsodo shot flagged');

r = shotsOf('Club,Carry (m),Ball Speed (km/h),Side (m)\n7i,100,150,-5');
eq(pick(r.rows[0].shot, ['club', 'carry_yds', 'ball_speed_mph', 'offline_ft']), { club: '7i', carry_yds: 109.4, ball_speed_mph: 93.2, offline_ft: -16.4 }, 'metres and km/h converted');

r = shotsOf('Club\tCarry\tTotal\tOffline (yds)\n7i\t113\t116\t4 L');
eq([r.p.delim, r.rows[0].shot.club, r.rows[0].shot.offline_ft], ['\t', '7i', -12], 'tab-separated with header units');

r = shotsOf('Club;Carry;Ball Speed;Hang Time\nPW;81;72;4,7');
eq([r.p.delim, r.rows[0].shot.hang_time_s], [';', 4.7], 'semicolon CSV with decimal comma');

r = shotsOf('PW 82 82 70 41 73 53 4.7 5R 15R\nPW 81 87 72 26 44 41 24R 15R');
eq(r.p.nCols, 9, 'mixed row lengths: mapping follows the longer row on a tie');
ok(r.rows[1].warn.some((w) => /8 values, expected 9/.test(w)), 'count mismatch warned');
ok(r.rows[1].warn.some((w) => /Hang time 24 looks off/.test(w)), 'out-of-range value warned');

r = shotsOf('11:52\tPW\t81\t87\t72\t26\t44\t41\t\t24 R\t15 R');
eq([r.p.delim, r.p.nCols, r.rows[0].shot.hang_time_s, r.rows[0].shot.offline_ft], ['\t', 9, null, 15], 'headerless TSV keeps empty cells as missing');

section('Toptracer arrows, AM/PM and newest-first lists');
const SCREEN = [
  '01:00 PM Sw 63 64 60 51 65 58 16 ▶ 3 ▶',
  '01:00 PM Sw 55 57 55 44 49 52 3 ▶ 18 ▶',
  '12:58 PM Sw 70 72 64 38 57 49 ◀ 0 ◀ 2',
  '12:58 PM Sw 64 65 61 50 66 56 11 ▶ ◀ 17',
  '12:57 PM Sw 54 56 58 45 55 53 ◀ 2 2 ▶',
  '12:56 PM Sw 80 83 71 30 51 45 19 ▶ 27 ▶',
  '12:55 PM Sw 88 95 77 22 40 37 26 ▶ 37 ▶',
  '12:53 PM 5w 138 157 108 9 35 26 24 ▶ 21 ▶',
  '12:52 PM 5w 136 150 106 11 41 30 47 ▶ 76 ▶',
  '12:52 PM 5w 68 139 107 2 2 4 ◀ 2 ◀ 76',
  '12:52 PM 5w 26 35 44 30 12 34 ◀ 0 ◀ 55',
  '12:52 PM 5w 21 82 84 7 2 8 ◀ 2 ◀ 102',
];
const want = nov.shots.slice(36).map((x) => pick(x, K));
eq(want.length, 12, 'twelve reference shots in the data file');
r = shotsOf(SCREEN.join('\n'));
eq([r.p.reversed, r.p.nCols], [true, 8], 'newest-first list reversed; 8 columns');
eq(r.rows.map((x) => pick(x.shot, K)), want, 'screenshot rows (whitespace) = shots 037–048, chronological');
eq(r.rows.every((x) => x.include && !x.warn.length), true, 'screenshot rows clean');

const TSV = ['Time\tClub\tFlat carry\tTotal\tBall speed\tLaunch\tApex\tLanding\tCurve\tOffline']
  .concat(SCREEN.map((l) => {
    const m = /^(\S+ [AP]M) (\S+) (.*)$/.exec(l);
    const toks = m[3].split(' ');
    const vals = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t === '◀') { vals.push('◀ ' + toks[++i]); continue; }
      if (t === '▶') { vals[vals.length - 1] += ' ▶'; continue; }
      vals.push(t);
    }
    return [m[1], m[2]].concat(vals).join('\t');
  }));
r = shotsOf(TSV.join('\n'));
eq([r.p.delim, r.p.hasHeader, r.p.reversed], ['\t', true, true], 'TSV with header, reversed');
eq(r.p.columns, ['time', 'club', 'carry_yds', 'total_yds', 'ball_speed_mph', 'launch_deg', 'apex_ft', 'landing_deg', 'curve_ft', 'offline_ft'], '"Flat carry" maps to carry');
eq(r.rows.map((x) => pick(x.shot, K)), want, 'screenshot rows (TSV) = shots 037–048');

r = shotsOf('PW 81 87 72 26 44 41 24▶ ◀15\nPW 82 82 70 41 73 53 ⬅️5 15➡️');
eq(r.rows.map((x) => [x.shot.curve_ft, x.shot.offline_ft]), [[24, -15], [-5, 15]], 'attached arrows and emoji arrows');
eq(C.parseCell('11 ▶', 'curve_ft'), 11, '▶ in a cell = right');
eq(C.parseCell('◀ 17', 'offline_ft'), -17, '◀ in a cell = left');
eq([C.normTime('01:00 PM'), C.normTime('12:58 PM'), C.normTime('12:05 am'), C.normTime('9:05'), C.normTime('noon')], ['13:00', '12:58', '00:05', '09:05', null], 'normTime');
r = shotsOf('11:52 PW 81\n11:53 PW 69');
eq(r.p.reversed, false, 'chronological list left alone');
const pr = C.parsedFromRows([{ cells: ['81', '15 R'], club: 'PW', time: '12:01 PM' }, { cells: ['69', '◀ 31'], club: 'PW', time: '11:59 AM' }]);
eq([pr.reversed, pr.columns, C.buildShots(pr).map((x) => [x.shot.time, x.shot.carry_yds, x.shot.offline_ft])],
  [true, ['carry_yds', 'offline_ft'], [['11:59', 69, -31], ['12:01', 81, 15]]], 'parsedFromRows takes rows from any source');

eq(C.parseCell('n/a', 'carry_yds'), null, 'n/a = missing');
eq(C.parseCell('-', 'carry_yds'), null, 'dash = missing');
eq(C.parseCell('abc', 'carry_yds'), undefined, 'unreadable = undefined');
eq(C.parseCell('R 15', 'offline_ft'), 15, 'prefix R inside a cell');
eq(C.parseCell('15 left', 'offline_ft'), -15, '"left" word');
eq(C.parseCell('44 ft', 'apex_ft', 'yd'), 44, 'cell unit beats the column hint');
eq(C.parseCell('26°', 'launch_deg'), 26, 'degree sign');
eq(C.parseCell('6200 rpm', 'spin_rpm'), 6200, 'rpm not read as direction or metres');

// ---------------------------------------------------------------------------
section('Game: TPC Harding Park');
const CO = require('../js/courses.js');
const GG = require('../js/game.js');
const HP = CO.get('harding-park');
eq(HP.holes.map((h) => h.n), Array.from({ length: 18 }, (_, i) => i + 1), 'holes 1–18 in order');
eq(HP.holes.map((h) => h.par), [4, 4, 3, 5, 4, 4, 4, 3, 5, 5, 3, 5, 4, 4, 4, 4, 3, 4], 'pars from the scorecard');
eq([CO.par(HP), CO.par(HP, [1, 2, 3, 4, 5, 6, 7, 8, 9]), CO.par(HP, [10, 11, 12, 13, 14, 15, 16, 17, 18])], [72, 36, 36], 'par 72: 36 out, 36 in');
eq(HP.holes.map((h) => h.yds.blue), [395, 430, 165, 580, 395, 440, 335, 200, 495, 550, 185, 480, 405, 440, 405, 330, 175, 440], 'Blue yardages (Offcourse)');
eq(HP.holes.map((h) => h.yds.white), [375, 400, 155, 540, 365, 390, 325, 190, 475, 530, 155, 450, 375, 410, 375, 310, 165, 420], 'White yardages (GolfPass)');
HP.tees.forEach((t) => eq(HP.holes.reduce((s, h) => s + h.yds[t.id], 0), t.yds, `${t.name} tees add up to ${t.yds}`));
ok(HP.holes.every((h) => h.yds.blue >= h.yds.white), 'every Blue tee is behind the White one');
ok(HP.sources.length >= 2 && HP.sources.every((s) => /^https:\/\//.test(s.url) && s.title), 'sources listed');
ok(HP.holes.every((h) => h.note && h.note.length <= 140), 'every hole has a short note');

section('Game: the holes on the ground (OpenStreetMap)');
const MAP = HP.map;
ok(MAP && MAP.boundary.length > 20 && MAP.greens.length > 18 && MAP.trees.length > 500, 'the course map is loaded: the boundary, the golf features and the trees');
const offCard = [];
let badTee = 0, badGreen = 0, badPin = 0;
HP.holes.forEach((h) => HP.tees.forEach((t) => {
  const H = GG.buildHole(HP, h.n, t.id), st = GG.toHole(H, H.start.x, H.start.z), pin = GG.pinFor(H, 99);
  if (Math.abs(st.g - h.yds[t.id]) > 12) offCard.push(`${h.n} ${t.id}: ${Math.round(st.g)}`);
  if (GG.lieAt(H, H.start.x, H.start.z) !== 'fairway') badTee++;
  if (GG.lieAt(H, H.green.x, H.green.z) !== 'green') badGreen++;
  if (GG.lieAt(H, pin.x, pin.z) !== 'green') badPin++;
}));
eq([offCard, badTee, badGreen, badPin], [[], 0, 0, 0], 'every tee is within 12 yds of its scorecard yardage along the line of play and stands on a tee box; every green and pin is on its green');
const usedGreens = new Set();
let sharedGreens = 0;
HP.holes.forEach((h) => { const gi = MAP.holes[h.n].green; if (gi != null) { if (usedGreens.has(gi)) sharedGreens++; usedGreens.add(gi); } });
eq([sharedGreens, MAP.holes[9].green, !!MAP.holes[18].built, GG.buildHole(HP, 9, 'white').green.standIn], [0, null, true, true], 'each hole has its own green; the 9th green (not mapped) stands in, and the 18th’s line (not mapped) is built');
let lakeEdges = 0, obEdges = 0, wrongSide = 0;
const H1w = GG.buildHole(HP, 1, 'white'), t1w = GG.toHole(H1w, H1w.start.x, H1w.start.z);
MAP.boundary.forEach((a, i) => {
  const b = MAP.boundary[(i + 1) % MAP.boundary.length], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
  if (GG.inPoly(MAP.boundary, mx + nx * 3, mz + nz * 3)) { nx = -nx; nz = -nz; }
  const lake = MAP.lakeFrom > MAP.lakeTo ? i >= MAP.lakeFrom || i < MAP.lakeTo : i >= MAP.lakeFrom && i < MAP.lakeTo;
  const lie = GG.lieAt(H1w, mx + nx * 20, mz + nz * 20);
  if (lie !== (lake ? 'water' : 'ob')) wrongSide++;
  if (lake) lakeEdges++; else obEdges++;
});
ok(wrongSide === 0 && lakeEdges > 10 && obEdges > 10, 'beyond the boundary: Lake Merced along the lake shore, out of bounds everywhere else');
// The nearest water (or out of bounds) left and right of a hole's line of play, from the tee to the green.
function sideOf(n, kind) {
  const H = GG.buildHole(HP, n, 'white'), t = GG.toHole(H, H.start.x, H.start.z);
  let l = Infinity, r = Infinity;
  for (let s = t.s + 20; s <= H.L; s += 8) {
    const p = H.at(s);
    for (let d = 6; d <= 90; d += 3) {
      if (GG.lieAt(H, p.x - Math.cos(p.h) * d, p.z + Math.sin(p.h) * d) === kind) l = Math.min(l, d);
      if (GG.lieAt(H, p.x + Math.cos(p.h) * d, p.z - Math.sin(p.h) * d) === kind) r = Math.min(r, d);
    }
  }
  return [l, r];
}
eq([14, 15, 16, 17].map((n) => { const s = sideOf(n, 'water'); return s[0] < 80 && s[1] === Infinity; }), [true, true, true, true], 'Lake Merced down the left of 14–17, and not the right');
ok(sideOf(12, 'ob')[0] < 20 && sideOf(1, 'ob')[0] === Infinity, 'out of bounds all down the left of 12 (none near the 1st)');
const H18w = GG.buildHole(HP, 18, 'white'), t18 = GG.toHole(H18w, H18w.start.x, H18w.start.z);
let inlet = 0;
for (let s = t18.s; s < t18.s + 200; s += 4) { const p = H18w.at(s); if (GG.lieAt(H18w, p.x, p.z) === 'water') inlet++; }
ok(inlet > 15, '18: the line of play carries the inlet of Lake Merced');
function bendOf(n) {
  const H = GG.buildHole(HP, n, 'blue'), t = GG.toHole(H, H.start.x, H.start.z);
  let d = (H.at(H.L - 10).h - H.at(t.s + 20).h) * 180 / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
eq([[4, 15, 18].every((n) => bendOf(n) < -25), [7, 16].every((n) => bendOf(n) > 15), Math.abs(bendOf(14)) < 8], [true, true, true], 'doglegs left on 4, 15 and 18; 7 and 16 bend right; 14 is straight');
eq([110, 150, 200, 250].map((d) => { const p = H1w.at(t1w.s + d); return GG.lieAt(H1w, p.x, p.z); }), ['fairway', 'fairway', 'fairway', 'fairway'], 'the 1st fairway, 110 to 250 yds from the White tee');
const H2w = GG.buildHole(HP, 2, 'white'), t2w = GG.toHole(H2w, H2w.start.x, H2w.start.z);
const fwBunkers = H2w.ground.bunkers.map((b) => GG.centroidOf(b.poly)).map((c) => GG.toHole(H2w, c.x, c.z)).filter((q) => Math.abs(q.lat) < 45 && q.s - t2w.s > 60 && q.g > 40);
ok(fwBunkers.length >= 3 && fwBunkers.every((q) => q.lat < 0), 'the 2nd’s fairway bunkers are all down the left');
ok(MAP.trees.every((t) => GG.lieAt(H1w, t[0], t[1]) === 'trees'), 'every tree stands in the rough: off the fairways, greens, tee boxes and bunkers');
const g2 = H2w.green;
eq(GG.lieAt(H1w, g2.x, g2.z), 'fairway', 'another hole’s green plays as fairway');
const H4 = GG.buildHole(HP, 4, 'blue');
eq(JSON.stringify(GG.buildHole(HP, 15, 'white').start), JSON.stringify(GG.buildHole(HP, 15, 'white').start), 'a hole is the same every time');
ok(GG.pinFor(H4, 1).x !== GG.pinFor(H4, 2).x, 'the pin moves from round to round');

section('Game: his own shots');
const dadPools = GG.clubPools(fileData.sessions, fileData.equipment);
const m3Data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'brother_golf_data.json'), 'utf8'));
const m3Pools = GG.clubPools(m3Data.sessions, m3Data.equipment);
const allDad = C.clubData(fileData.sessions);
eq(Object.keys(dadPools).sort(), Object.keys(allDad).filter((c) => allDad[c].solid.length).sort(), 'a pool for every club with a solid shot');
eq(GG.rankShots(allDad['7i'], '7i', fileData.equipment).slice(0, 10).map((s) => s.id), C.bestShots(allDad['7i'], '7i', fileData.equipment, 10).map((s) => s.id), 'ranked the same way as Best 10');
eq(dadPools['5w'].misRate, 3 / 5, '5 wood: 3 of 5 shots were mis-hits');
ok(Object.keys(dadPools).every((c) => dadPools[c].full >= dadPools[c].carry), 'a good swing’s total is at least its carry');
let rnd = FL.rng(5);
const p7 = dadPools['7i'], n7 = p7.ranked.length;
const perfect = Array.from({ length: 60 }, () => GG.pickShot(p7, 0, rnd));
ok(perfect.every((x) => x.rank <= 1 + 2 * Math.round(n7 * 0.08) && x.grade === 'perfect'), 'on the line: one of his very best');
const early = Array.from({ length: 60 }, () => GG.pickShot(p7, -0.6, rnd)), late = Array.from({ length: 60 }, () => GG.pickShot(p7, 0.6, rnd));
ok(early.filter((x) => x.grade !== 'mishit').every((x) => x.shot.offline_ft < 0) && late.filter((x) => x.grade !== 'mishit').every((x) => x.shot.offline_ft > 0), 'early ones went left, late ones right');
const middle = Array.from({ length: 200 }, () => GG.pickShot(p7, 0.37, rnd)).filter((x) => x.rank);
const midRank = middle.reduce((s, x) => s + x.rank, 0) / middle.length / n7;
ok(midRank > 0.35 && midRank < 0.65, `a third of the window off: from the middle of his list (${midRank.toFixed(2)})`);
const way = GG.pickShot(p7, 1.4, rnd);
eq([way.grade, p7.mis.indexOf(way.shot) >= 0], ['mishit', true], 'outside the window: one of his mis-hits');
const noMis = Object.keys(m3Pools).find((c) => !m3Pools[c].mis.length), wayM3 = GG.pickShot(m3Pools[noMis], -1.4, rnd);
ok(wayM3.grade === 'mishit' && wayM3.rank > m3Pools[noMis].ranked.length * 0.6, 'a club he has never mis-hit: one of his worst solid shots');
eq([GG.timingOf(0.06), GG.timingOf(-0.12), GG.timingOf(0), GG.timingOf(0.17, true)], [-0.5, 1, -0, -1], 'timing: early is negative, late positive, ±1 at the window’s edge');
eq([0.05, -0.3, 0.7, -0.7, 1.3, -1.3].map(GG.timingWord), ['Perfect timing', 'Good timing', 'A little late', 'A little early', 'Way late', 'Way early'], 'timing in words');

section('Game: power, lie and the driver off the turf');
const base = { club: '7i', carry_yds: 120, total_yds: 128, ball_speed_mph: 90, launch_deg: 20, apex_ft: 70, landing_deg: 44, hang_time_s: 5, curve_ft: 10, offline_ft: 30 };
const half = GG.adjustShot(base, 0.5, 'fairway');
eq([half.carry_yds, half.total_yds, half.offline_ft, half.curve_ft, half.apex_ft, Math.round(half.ball_speed_mph * 10) / 10, half.launch_deg], [60, 64, 15, 5, 35, 63.6, 20], 'half power: half as far and as wide, same launch');
const rough = GG.adjustShot(base, 1, 'rough');
eq([rough.carry_yds, Math.round(rough.offline_ft * 100) / 100], [108, 31.05], 'from the rough: 10% shorter, 15% wider');
const punch = GG.adjustShot(base, 1, 'trees');
ok(punch.carry_yds === 72 && punch.apex_ft < 30 && Math.abs(punch.total_yds - punch.carry_yds - 8 * 0.6 * 1.6) < 1e-9, 'from the trees: a low punch that runs');
const drv = { club: 'Driver', carry_yds: 160, total_yds: 170, offline_ft: 20 };
eq([GG.adjustShot(drv, 1, 'tee').carry_yds, Math.round(GG.adjustShot(drv, 1, 'fairway').carry_yds * 10) / 10], [160, 147.2], 'a driver off the turf goes a little shorter');
eq(base.carry_yds, 120, 'the real shot is left as it was');

section('Game: a shot on the hole');
const H1 = H1w, pin1 = GG.pinFor(H1, 3), tee1 = { x: H1.start.x, z: H1.start.z, lie: 'tee' }, down1 = H1.at(t1w.s + 175);
const aimHd = GG.headingTo(tee1, down1), across = (p) => (p.x - tee1.x) * Math.cos(aimHd) - (p.z - tee1.z) * Math.sin(aimHd);
const straight = GG.playShot(H1, tee1, down1, { club: '7i', carry_yds: 150, total_yds: 160, offline_ft: 0, curve_ft: 0 }, { pin: pin1, rnd: FL.rng(1) });
eq([straight.result, straight.lie, Math.round(straight.carry), Math.round(GG.dist(tee1, straight.rest)), Math.abs(across(straight.rest)) < 0.01],
  ['ok', 'fairway', 150, 160, true], 'straight down the 1st fairway: lands at its carry and finishes at its total, on the aim line');
eq(straight.next, { x: straight.rest.x, z: straight.rest.z, lie: 'fairway' }, 'the next shot is from where it stopped');
const right = GG.playShot(H1, tee1, down1, { club: '7i', carry_yds: 150, total_yds: 160, offline_ft: 30, curve_ft: 20 }, { pin: pin1, rnd: FL.rng(1) });
ok(Math.abs(across(right.rest) - 10) < 0.5, 'offline 30 ft: finishes 10 yds right of the aim line');
let wideAim = null;
for (let lat = 20; lat <= 34 && !wideAim; lat += 1) {
  const p = H1.at(t1w.s + 175), q = FL.offsetPoint(p.x, p.z, p.h, 0, lat), land = FL.offsetPoint(tee1.x, tee1.z, GG.headingTo(tee1, q), 150, 0);
  if (GG.lieAt(H1, land.x, land.z) === 'rough') wideAim = q;
}
const rollRough = GG.playShot(H1, tee1, wideAim, { club: '7i', carry_yds: 150, total_yds: 170, offline_ft: 0, curve_ft: 0 }, { pin: pin1, rnd: FL.rng(1) });
ok(GG.lieAt(H1, rollRough.land.x, rollRough.land.z) === 'rough' && GG.dist(rollRough.land, rollRough.rest) < 11, 'landing in the rough cuts the roll');
const H17 = GG.buildHole(HP, 17, 'white'), tee17 = { x: H17.start.x, z: H17.start.z, lie: 'tee' };
const wet = GG.playShot(H17, tee17, H17.spot(20, -70), { club: '7i', carry_yds: 150, total_yds: 158, offline_ft: 0, curve_ft: 0 }, { pin: GG.pinFor(H17, 3), rnd: FL.rng(1) });
ok(wet.result === 'water' && wet.penalty === 1 && !/water|ob/.test(wet.next.lie) && GG.dist(tee17, wet.next) < GG.dist(tee17, wet.land), 'into Lake Merced on 17: a penalty stroke, and a drop where it went in');
const H12 = GG.buildHole(HP, 12, 'white'), tee12 = { x: H12.start.x, z: H12.start.z, lie: 'tee' };
const ob = GG.playShot(H12, tee12, H12.spot(300, -60), { club: '7i', carry_yds: 150, total_yds: 155, apex_ft: 160, offline_ft: 0, curve_ft: 0 }, { pin: GG.pinFor(H12, 3), rnd: FL.rng(1) });
eq([ob.result, ob.penalty, ob.next], ['ob', 1, tee12], 'out of bounds left of 12: a penalty stroke and hit again from the same spot');
const H3 = GG.buildHole(HP, 3, 'white'), tee3 = { x: H3.start.x, z: H3.start.z, lie: 'tee' }, s3 = GG.toHole(H3, tee3.x, tee3.z).s;
const tree3 = H3.ground.trees.find((t) => GG.dist(tee3, t) > 40 && GG.dist(tee3, t) < 120 && GG.toHole(H3, t.x, t.z).s > s3);
const low = GG.playShot(H3, tee3, tree3, { club: '7i', carry_yds: 140, total_yds: 150, apex_ft: 20, launch_deg: 8, landing_deg: 15, offline_ft: 0, curve_ft: 0 }, { pin: GG.pinFor(H3, 3), rnd: FL.rng(1) });
ok(low.result === 'tree' && low.tree && GG.dist(low.rest, low.tree) < low.tree.r + 4 && low.traj.hang < 4, 'a low shot into a cypress drops by the tree');
const tee2 = { x: H2w.start.x, z: H2w.start.z, lie: 'tee' };
const bk = H2w.ground.bunkers.map((b) => ({ b, c: GG.centroidOf(b.poly) })).find((o) => { const q = GG.toHole(H2w, o.c.x, o.c.z); return q.s - t2w.s > 200 && q.s - t2w.s < 260 && Math.abs(q.lat) < 30; }).c;
const toBk = GG.headingTo(tee2, bk);
let edge = 0;
while (GG.lieAt(H2w, bk.x - Math.sin(toBk) * edge, bk.z - Math.cos(toBk) * edge) === 'bunker') edge += 0.25;
const landSpot = { x: bk.x - Math.sin(toBk) * (edge + 1.5), z: bk.z - Math.cos(toBk) * (edge + 1.5) }, c2 = GG.dist(tee2, landSpot);
const intoSand = GG.playShot(H2w, tee2, bk, { club: '5hy', carry_yds: c2, total_yds: c2 + 12, apex_ft: 70, offline_ft: 0, curve_ft: 0 }, { pin: GG.pinFor(H2w, 3), rnd: FL.rng(1) });
ok(intoSand.result === 'ok' && intoSand.lie === 'bunker' && GG.dist(intoSand.land, intoSand.rest) < 5, 'a ball rolling into a fairway bunker on the 2nd stays in it');
const nearPin = { x: pin1.x - Math.sin(GG.headingTo(tee1, pin1)) * 30, z: pin1.z - Math.cos(GG.headingTo(tee1, pin1)) * 30, lie: 'fairway' };
const chip = GG.playShot(H1, nearPin, pin1, { club: 'SW', carry_yds: 27, total_yds: 31, offline_ft: 0, curve_ft: 0 }, { pin: pin1, rnd: FL.rng(1) });
eq([chip.result, chip.lie, chip.next], ['holed', 'holed', undefined], 'rolling over the hole slowly: in!');
ok(GG.dist(chip.rest, pin1) < GG.CUP, '…and it stops in the cup');

section('Game: putting, clubs and the score');
rnd = FL.rng(11);
const makes = (ft, e) => Array.from({ length: 400 }, () => GG.putt(ft, e, rnd)).filter((r) => r.holed).length / 400;
const m3 = makes(3, 0), m10 = makes(10, 0), m30 = makes(30, 0), mShort = makes(10, -1.2);
ok(m3 > 0.75 && m10 > 0.25 && m10 < 0.6 && m30 < 0.25 && mShort === 0, `putts: 3 ft ${Math.round(m3 * 100)}%, 10 ft ${Math.round(m10 * 100)}%, 30 ft ${Math.round(m30 * 100)}%; never up, never in`);
ok(Array.from({ length: 100 }, () => GG.putt(20, 0.5, rnd)).every((r) => r.holed ? r.along === 20 : r.along > 0), 'a putt goes forward and a holed one ends at the hole');
ok([2, 6, 12, 25, 50, 90].map(GG.puttTarget).every((v, i, a) => v >= 0.14 && v <= 0.9 && (!i || v >= a[i - 1])), 'a longer putt needs a longer stroke');
eq([GG.suggestClub(dadPools, 200, 'tee'), GG.suggestClub(dadPools, 88, 'fairway'), GG.suggestClub(dadPools, 88, 'rough')], ['5hy', 'PW', '9i'], 'Dad: his 5 hybrid over the 5 wood he often mis-hits; one more club from the rough');
eq([GG.suggestClub(m3Pools, 250, 'tee'), GG.suggestClub(m3Pools, 250, 'fairway')], ['Driver', '3w'], 'M3: driver off the tee, 3 wood off the fairway');
const H4w = GG.buildHole(HP, 4, 'white'), aim4 = GG.aimFor(H4w, H4w.start, GG.pinFor(H4w, 1), 156);
ok(!aim4.pin && Math.abs(GG.dist(H4w.start, aim4) - 156) < 10 && GG.lieAt(H4w, aim4.x, aim4.z) === 'fairway', 'a long hole: aim down the fairway as far as the club goes');
const wetCarry = (H, a) => { let w = 0; for (let k = 1; k < 20; k++) { if (GG.lieAt(H, H.start.x + (a.x - H.start.x) * k / 20, H.start.z + (a.z - H.start.z) * k / 20) === 'water') w = k / 20; } return w * GG.dist(H.start, a); };
const aimDad18 = GG.aimFor(H18w, H18w.start, GG.pinFor(H18w, 1), 156), aimM318 = GG.aimFor(H18w, H18w.start, GG.pinFor(H18w, 1), 185);
ok(wetCarry(H18w, aimDad18) === 0 && wetCarry(H18w, aimM318) > 80 && !/water|ob/.test(GG.lieAt(H18w, aimM318.x, aimM318.z)), '18: with 156 yds he plays round the inlet; with 185 he carries it');
const near1 = H1.spot(120, 0);
eq(GG.aimFor(H1, near1, pin1, 140).pin, true, 'in range: aim at the pin');
eq([GG.scoreName(1, 3), GG.scoreName(2, 5), GG.scoreName(3, 4), GG.scoreName(4, 4), GG.scoreName(5, 4), GG.scoreName(6, 4), GG.scoreName(8, 4)],
  ['Hole in one', 'Albatross', 'Birdie', 'Par', 'Bogey', 'Double bogey', '+4'], 'score names');
eq([GG.toParText(0), GG.toParText(5), GG.toParText(-2)], ['Even', '+5', '-2'], 'to par');
const round = GG.newRound(HP, { tee: 'white', holes: [1, 2, 3], mode: 'meter', seed: 7 });
eq(round.cards.map((c) => [c.n, c.par, c.yds]), [[1, 4, 375], [2, 4, 400], [3, 3, 155]], 'a round’s cards');
Object.assign(round.cards[0], { done: true, score: 5 });
Object.assign(round.cards[1], { done: true, score: 4 });
eq(GG.totals(round), { played: 2, holes: 3, strokes: 9, par: 8, toPar: 1, allPar: 11 }, 'totals so far');

section('Game: a whole round for each player');
function botRound(d, pools, seed) {
  const r = FL.rng(seed), gauss = () => { const u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return HP.holes.map((h) => {
    const H = GG.buildHole(HP, h.n, 'white'), pin = GG.pinFor(H, seed);
    let ball = { x: H.start.x, z: H.start.z, lie: 'tee' }, strokes = 0;
    while (strokes < 2 * h.par) {
      const dd = GG.dist(ball, pin);
      if (ball.lie === 'green') {
        strokes++;
        if (dd * 3 <= GG.TAP_IN) return strokes;
        const pr = GG.putt(dd * 3, gauss() * 0.5, r);
        if (pr.holed) return strokes;
        const q = FL.offsetPoint(ball.x, ball.z, GG.headingTo(ball, pin), pr.along / 3, pr.side / 3);
        ball = { x: q.x, z: q.z, lie: 'green' };
        continue;
      }
      const club = GG.suggestClub(pools, dd, ball.lie), pool = pools[club];
      const aim = GG.aimFor(H, ball, pin, pool.full * GG.lieFactor(club, ball.lie).dist);
      const pw = Math.max(0.05, Math.min(1, GG.powerFor(pool, GG.dist(ball, aim), ball.lie) + gauss() * 0.035));
      const res = GG.playShot(H, ball, aim, GG.adjustShot(GG.pickShot(pool, gauss() * 0.5, r).shot, pw, ball.lie), { pin, equip: d.equipment, rnd: r });
      strokes += 1 + res.penalty;
      if (res.result === 'holed') return strokes;
      ball = res.next.lie === 'fringe' ? Object.assign({}, res.next, { lie: 'green' }) : res.next;
    }
    return 2 * h.par;
  });
}
[[fileData, dadPools, 'Dad'], [m3Data, m3Pools, 'M3']].forEach(([d, pools, name]) => {
  const scores = botRound(d, pools, 21), total = scores.reduce((a, b) => a + b, 0);
  ok(scores.length === 18 && scores.every((s, i) => s >= 1 && s <= 2 * HP.holes[i].par) && total > 72 && total < 130, `${name}: 18 holes played, ${total} on the White tees`);
});
eq(JSON.stringify(botRound(fileData, dadPools, 4)), JSON.stringify(botRound(fileData, dadPools, 4)), 'the same seed plays the same round');


section('Game: the real swing (reading a swipe)');
// A finger's swipe as the pad samples it: rest on the ball, ease down for the backswing,
// maybe pause, speed up through the ball and on a little. Times in s, pixels with y down.
function fakeSwipe(o) {
  o = Object.assign({ back: 0.75, down: 0.25, depth: 1, full: 120, angle: 0, strike: 0, pause: 0, hz: 60, x0: 170, y0: 54, follow: 28, rest: 0.08, stopShort: 0 }, o);
  const D = o.depth * o.full, tan = Math.tan(o.angle * Math.PI / 180), xTop = o.x0 + o.strike - D * tan, yTop = o.y0 + D;
  const tB = o.rest, tTop = tB + o.back, tD = tTop + o.pause, tX = tD + o.down, vEnd = D * 1.6 / o.down, tEnd = tX + o.follow / vEnd + 1.5 / o.hz, out = [];
  for (let i = 0; i * (1 / o.hz) <= tEnd + 1e-9; i++) {
    const t = i / o.hz;
    let x, y;
    if (t < tB) { x = o.x0; y = o.y0; }
    else if (t < tTop) { const u = (t - tB) / o.back, k = u * u * (3 - 2 * u); x = o.x0 + (xTop - o.x0) * k; y = o.y0 + D * k; }
    else if (t < tD) { x = xTop; y = yTop; }
    else if (t < tX) { const u = (t - tD) / o.down; y = yTop - D * Math.pow(u, 1.6); x = xTop + (yTop - y) * tan; }
    else { const over = (t - tX) * vEnd; y = o.y0 - over; x = o.x0 + o.strike + over * tan; }
    if (o.stopShort && t >= tD && y < o.y0 + o.stopShort) break;
    out.push({ t, x, y });
  }
  return out;
}
const PAD = { full: 120, ball: 30 };
const rs = (o, putt) => GG.readSwing(fakeSwipe(o), Object.assign({ putt: !!putt }, PAD));
const s31 = rs({}), s41 = rs({ back: 0.8, down: 0.2 }), s21 = rs({ back: 0.7, down: 0.35 });
ok(s31.ok && Math.abs(s31.ratio - 3) < 0.1 && Math.abs(s31.depth - 1) < 0.01 && Math.abs(s31.angle) < 0.1 && Math.abs(s31.strike) < 0.01, `a 3 : 1 swipe reads 3 : 1 (${s31.ratio.toFixed(2)}), full, straight, out of the middle`);
ok(Math.abs(s41.ratio - 4) < 0.15 && s41.tempo > 0.25 && Math.abs(s21.ratio - 2) < 0.1 && s21.tempo < -0.35, `4 : 1 is quick (${s41.ratio.toFixed(2)}), 2 : 1 slow (${s21.ratio.toFixed(2)})`);
ok([[0.6, 0.2], [1.5, 0.5], [0.45, 0.15]].every(([b, d]) => Math.abs(rs({ back: b, down: d }).ratio - 3) < 0.15), 'the tempo is the ratio, whatever the pace');
const sP = rs({ pause: 0.3 });
ok(Math.abs(sP.pause - 0.3) < 0.03 && Math.abs(sP.ratio - 3) < 0.15, `a pause at the top counts in neither half (${sP.pause.toFixed(2)} s, ${sP.ratio.toFixed(2)} : 1)`);
ok(Math.abs(rs({ hz: 120 }).ratio - 3) < 0.1, 'the same on a 120 Hz screen');
eq([rs({ angle: 12 }).angle, rs({ angle: -8 }).angle].map((a) => Math.round(a)), [12, -8], 'the swipe’s angle, right of straight up');
eq(Math.round(rs({ strike: 21 }).strike * 10) / 10, 0.7, 'where it came back through: 21 px right is 0.7 of a ball');
eq([rs({ depth: 0.5, back: 0.5, down: 0.25 }).depth, rs({ depth: 1.2 }).depth].map((v) => Math.round(v * 100) / 100), [0.5, 1.2], 'how far back it went');
eq([GG.tempoTarget(1), GG.tempoTarget(0.3), GG.tempoTarget(0.575), GG.tempoTarget(1, true)], [3, 2, 2.5, 2], 'the tempo goal: 3 : 1 full, 2 : 1 short and for a putt');
eq([GG.powerOfDepth(0.6), GG.powerOfDepth(1), GG.powerOfDepth(1.2), GG.powerOfDepth(1.4)], [0.6, 1, 1.05, 1.06], 'power: the backswing, and only a little more past full');
eq([GG.readSwing([], PAD).why, GG.readSwing(fakeSwipe({ depth: 0.03 }), PAD).why, GG.readSwing(fakeSwipe({ stopShort: 40 }), PAD).why], ['still', 'noBack', 'noThrough'], 'not a swing: no movement, no backswing, or never back up through the ball');
const flick = GG.readSwing(fakeSwipe({ back: 0.6, down: 0.12, stopShort: 8 }), PAD);
ok(flick.ok && flick.ratio > 4, 'a quick flick that leaves the glass just short of the ball still counts');

section('Game: the real swing (face, path and the ball-flight laws)');
const d7 = dadPools['7i'], d5 = dadPools['5hy'], m8 = m3Pools['8i'];
const pr5 = GG.swingProfile(d5), pr8 = GG.swingProfile(m8);
ok(pr5.face > 2 && pr5.face > pr5.path && GG.swingProfile(d5) === pr5, `Dad’s 5 hybrid: the face ${pr5.face.toFixed(1)}° open, more than the path (${pr5.path.toFixed(1)}°): it starts right and fades`);
ok(pr8.path > 2 && pr8.face < pr8.path, `M3’s 8 iron: the path ${pr8.path.toFixed(1)}° in-to-out, the face shut to it: a draw`);
ok(Object.keys(GG.LAW).every((c) => GG.LAW[c][0] >= 0.6 && GG.LAW[c][0] <= 0.9) && GG.clubLaw('Driver').curve > GG.clubLaw('7i').curve && GG.clubLaw('7i').curve > GG.clubLaw('SW').curve,
  'the face sets most of the start line; a driver curves most for its face to path, a wedge least');
const still = (pool, sw, o) => GG.swingShot(pool, sw, Object.assign({ still: true, equip: fileData.equipment }, o || {})).rep;
const p0 = still(d7, s31), pQ = still(d7, s41), pS = still(d7, s21);
ok(pQ.face < p0.face - 2 && pQ.start < p0.start - 1.5 && pS.face > p0.face + 2 && pS.start > p0.start + 1.5, `quick from the top shuts the face (${(pQ.face - p0.face).toFixed(1)}°) and starts it left; slow opens it and starts it right`);
const rebuilt = (pool, rep, sw) => { const shot = GG.swingShot(pool, sw, { still: true }).shot; return GG.facePathOf(shot); };
const fp = rebuilt(d7, pQ, s41);
ok(Math.abs(fp.face - pQ.face) < 0.05 && Math.abs(fp.path - pQ.path) < 0.05, 'a shot built from a face and a path reads back as the same face and path');
const pIn = still(d7, rs({ angle: 12 })), pOut = still(d7, rs({ angle: -12 }));
ok(pIn.path > p0.path + 2.5 && pIn.curve < p0.curve - 5 && pOut.path < p0.path - 2.5 && pOut.curve > p0.curve + 5, `up and to the right is in-to-out and curves it left (${(pIn.curve - p0.curve).toFixed(0)} yds); up and to the left curves it right`);
ok(Math.abs(pIn.start - p0.start) < Math.abs(pQ.start - p0.start), 'the path moves the start line far less than the face does');
const drvM3 = m3Pools.Driver, w = still(drvM3, rs({ angle: 12 })), w0 = still(drvM3, s31), pw = still(dadPools.PW, rs({ angle: 12 })), pw0 = still(dadPools.PW, s31);
ok((w0.curve - w.curve) / w0.carry > 2 * (pw0.curve - pw.curve) / pw0.carry, 'the same swipe curves a driver more than twice as much as a wedge, for its carry');
const lefty = still(d7, s41, { hand: 'L' });
ok(lefty.start > p0.start + 1.5 && lefty.face < 0 && still(d7, rs({ angle: 12 }), { hand: 'L' }).path < 0, 'left-handed: quick shuts the face and starts it right; up and to the right is out-to-in');
eq([GG.shapeOf(0, 0, 150, 1), GG.shapeOf(-3, 0, 150, 1), GG.shapeOf(2.5, -6, 150, 1), GG.shapeOf(-2, 14, 150, 1), GG.shapeOf(0.5, -13, 150, 1), GG.shapeOf(-3, 0, 150, -1)],
  ['Straight', 'Pull', 'Push-draw', 'Pull-slice', 'Hook', 'Push'], 'shapes, for his hand');
const carryOf = (pool, sw) => FL.trajectory(GG.swingShot(pool, sw, { still: true }).shot, GG.flightOpts(pool.club)).carry;
ok(Math.abs(carryOf(d7, s31) - d7.pure) / d7.pure < 0.06 && Math.abs(carryOf(d7, rs({ depth: 0.5, back: 0.5, down: 0.25 })) / carryOf(d7, s31) - 0.5) < 0.06, `a perfect full swing carries his pure-strike carry (${carryOf(d7, s31).toFixed(0)} of ${d7.pure}); half back, about half as far`);
eq(JSON.stringify(GG.swingShot(d7, s41, { still: true })), JSON.stringify(GG.swingShot(d7, s41, { still: true })), 'a practice swing is the same every time');
const allow = GG.shapeAllowance(d5, 1, 'fairway', { equip: fileData.equipment });
ok(allow.side > 8 && /fade|slice/i.test(allow.shape), `the aim allows for his shape: Dad’s 5 hybrid finishes ${allow.side.toFixed(0)} yds right (${allow.shape})`);

section('Game: the real swing (strikes and mis-hits)');
rnd = FL.rng(31);
const kinds = (pool, sw, n) => { const k = {}; for (let i = 0; i < n; i++) { const r = GG.swingShot(pool, sw, { rnd }).rep; k[r.mis || 'solid'] = (k[r.mis || 'solid'] || 0) + 1; } return k; };
const kR = kinds(d7, rs({ back: 0.75, down: 0.12 }), 200), kS = kinds(d7, rs({ back: 0.75, down: 0.5 }), 200), kH = kinds(d7, rs({ strike: 80 }), 200), kT = kinds(d7, rs({ strike: -80 }), 200), kP = kinds(d7, s31, 200);
ok(kR.thin > 40 && !kR.fat && kS.fat > 40 && !kS.thin, `rushed, he thins it (${kR.thin} of 200); slow, he hits it fat (${kS.fat})`);
ok(kH.shank > 30 && !kH.toe && kT.toe > 30 && !kT.shank && kP.solid === 200, 'way off the heel, a shank; off the toe, a weak one; a perfect swing is always solid');
const shank = GG.swingShot(d7, rs({ strike: 80 }), { rnd: FL.rng(2) });
const sh = Array.from({ length: 40 }, () => GG.swingShot(d7, rs({ strike: 80 }), { rnd })).filter((x) => x.rep.mis === 'shank');
ok(sh.length && sh.every((x) => x.rep.start > 15 && x.rep.carry < 0.6 * d7.pure), 'a shank shoots off to the right, short');
const qOf = (o) => GG.strikeOf(rs(o), GG.SWING.normal).q;
ok(qOf({}) < 0.1 && qOf({ back: 0.8, down: 0.2 }) > 0.5 && qOf({ depth: 1.25 }) > 1 && qOf({ back: 0.15, down: 0.05 }) > 0.5, 'the strike: pure with a good swing, worse rushed, past full or snatched back');
const best = Array.from({ length: 60 }, () => GG.swingShot(d7, s31, { rnd }).shot.carry_yds), worse = Array.from({ length: 60 }, () => GG.swingShot(d7, s41, { rnd }).shot.carry_yds);
ok(best.reduce((a, b) => a + b) / 60 > worse.reduce((a, b) => a + b) / 60 + 3, 'the better the swing, the better struck: a good tempo carries further');
const tipsQ = GG.swingTips(still(d7, rs({ back: 0.8, down: 0.18 }))), tipsOut = GG.swingTips(pOut), tipsOver = GG.swingTips(still(d7, rs({ depth: 1.15 })));
ok(tipsQ.length && /quick from the top/.test(tipsQ[0]) && /left/.test(tipsQ[0]) && /out-to-in/.test(tipsOut.join(' ')) && /Full line/.test(tipsOver.join(' ')) && !GG.swingTips(p0).length,
  'the tips: quick from the top (it went left), out-to-in, past full; none for a perfect swing');
ok(/face 3\.\d° open/.test(GG.ownShapeText(still(d5, s31), '5 hybrid')) && GG.ownShapeText(still(d7, s31), '7 iron') === '', 'what a club usually does, when it’s worth saying');

section('Game: the real swing (putting)');
rnd = FL.rng(17);
const pDepth = (ft) => GG.puttDepth(ft), pSwipe = (ft, o) => rs(Object.assign({ depth: pDepth(ft), back: 0.35 + 0.45 * pDepth(ft), down: (0.35 + 0.45 * pDepth(ft)) / 2, follow: 20 }, o), true);
ok([3, 10, 25, 50].every((ft) => Math.abs(GG.puttLength(GG.puttDepth(ft)) - ft - 1.2) < 1e-9) && GG.puttDepth(40) > GG.puttDepth(10), 'the backstroke for a putt rolls it a foot past; a longer putt needs a longer one');
const putts = (ft, sw, n) => Array.from({ length: n }, () => GG.puttSwing(ft, sw, rnd, 'green'));
const makesP = (ft, sw) => putts(ft, sw, 300).filter((x) => x.holed).length / 300;
const m4 = makesP(4, pSwipe(4)), m10s = makesP(10, pSwipe(10)), m25 = makesP(25, pSwipe(25));
ok(m4 > 0.8 && m10s > 0.3 && m10s < 0.75 && m25 < 0.35, `a perfect stroke: 4 ft ${Math.round(m4 * 100)}%, 10 ft ${Math.round(m10s * 100)}%, 25 ft ${Math.round(m25 * 100)}%`);
const jab = GG.puttSwing(10, pSwipe(10, { down: (0.35 + 0.45 * pDepth(10)) / 3.2 }), rnd, 'green', { still: true }).rep, dead = GG.puttSwing(10, pSwipe(10, { down: (0.35 + 0.45 * pDepth(10)) / 1.3 }), rnd, 'green', { still: true }).rep;
ok(jab.past > 2 && dead.past < -0.5, `a jabbed stroke runs past (${jab.past.toFixed(1)} ft), a slow one dies short (${dead.past.toFixed(1)} ft)`);
const pushP = GG.puttSwing(10, pSwipe(10, { angle: 12 }), rnd, 'green', { still: true }).rep;
ok(pushP.start > 1 && putts(12, pSwipe(12), 50).every((x) => x.holed ? x.along === 12 : x.along > 0), 'swiped up to the right, it starts right; a putt goes forward, and a holed one ends at the hole');

section('Game: a whole round with the real swing');
function swingRound(d, pools, seed) {
  const r = FL.rng(seed), gauss = () => { const u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const swipe = (power, putt) => {
    const depth = Math.max(0.07, power + gauss() * 0.03), back = 0.55 + 0.3 * Math.min(1, depth);
    return GG.readSwing(fakeSwipe({ back, down: back / (GG.tempoTarget(depth, putt) * Math.exp(gauss() * 0.15)), depth, angle: gauss() * 5, strike: gauss() * 15 }), Object.assign({ putt }, PAD));
  };
  return HP.holes.map((h) => {
    const H = GG.buildHole(HP, h.n, 'white'), pin = GG.pinFor(H, seed);
    let ball = { x: H.start.x, z: H.start.z, lie: 'tee' }, strokes = 0;
    while (strokes < 2 * h.par) {
      const dd = GG.dist(ball, pin);
      if (ball.lie === 'green') {
        strokes++;
        if (dd * 3 <= GG.TAP_IN) return strokes;
        const pr = GG.puttSwing(dd * 3, swipe(Math.min(1.2, GG.puttDepth(dd * 3)), true), r, 'green');
        if (pr.holed) return strokes;
        const q = FL.offsetPoint(ball.x, ball.z, GG.headingTo(ball, pin), pr.along / 3, pr.side / 3);
        ball = { x: q.x, z: q.z, lie: 'green' };
        continue;
      }
      const club = GG.suggestClub(pools, dd, ball.lie), pool = pools[club];
      const target = GG.aimFor(H, ball, pin, pool.full * GG.lieFactor(club, ball.lie).dist), power = GG.powerFor(pool, GG.dist(ball, target), ball.lie);
      const side = GG.shapeAllowance(pool, power, ball.lie).side, aim = Math.abs(side) >= 3 ? FL.offsetPoint(target.x, target.z, GG.headingTo(ball, target), 0, -side) : target;
      const res = GG.playShot(H, ball, aim, GG.swingShot(pool, swipe(power, false), { lie: ball.lie, rnd: r }).shot, { pin, equip: d.equipment, rnd: r });
      strokes += 1 + res.penalty;
      if (res.result === 'holed') return strokes;
      ball = res.next.lie === 'fringe' ? Object.assign({}, res.next, { lie: 'green' }) : res.next;
    }
    return 2 * h.par;
  });
}
[[fileData, dadPools, 'Dad'], [m3Data, m3Pools, 'M3']].forEach(([d, pools, name]) => {
  const scores = swingRound(d, pools, 8), total = scores.reduce((a, b) => a + b, 0);
  ok(scores.length === 18 && scores.every((x, i) => x >= 1 && x <= 2 * HP.holes[i].par) && total > 72 && total < 130, `${name}: 18 holes with the real swing, ${total} on the White tees`);
});
eq(JSON.stringify(swingRound(m3Data, m3Pools, 5)), JSON.stringify(swingRound(m3Data, m3Pools, 5)), 'the same seed plays the same round');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
