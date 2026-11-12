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
eq([bro.player.relationship, bro.player.level, bro.player.age, bro.player.height_in, bro.baseline_session_id, bro.sessions.length, Object.keys(bro.clubs).length],
  ["Matthew's brother", 'beginner', 14, 60, null, 0, 0], 'brother file: empty, same schema');
eq(Object.keys(bro), Object.keys(data).filter((k) => k !== 'equipment'), 'brother file has the same top-level keys as Dad’s (equipment is optional)');
eq([data.player.age, data.player.height_in], [56, 73], 'Dad: age and height');
eq([C.buildHighlights(bro.sessions, null), C.sessionCallout('carry', bro.sessions), C.progressFor(bro.sessions, 'PW', null).rows.length], [[], null, 0], 'no data: no highlights, callouts or progress rows');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
