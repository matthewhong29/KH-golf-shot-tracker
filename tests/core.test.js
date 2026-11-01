// Run with: node tests/core.test.js   (no dependencies)
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dad_golf_data.json'), 'utf8'));

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
section('Expected averages from the brief (Nov 1 Toptracer)');
// Club: shots, carry avg (range), total, ball speed, launch, apex, landing, curve, offline
const EXPECTED = {
  PW: [9, '83.4', '69–96', '85.7', '71.8', '34.1', '62.1', '47.7', '5.0 R', '1.9 L'],
  '9i': [15, '100.7', '87–118', '102.8', '81.5', '31.7', '72.7', '47.7', '3.4 R', '7.2 R'],
  '7i': [8, '114.5', '100–128', '117.6', '88.8', '26.0', '70.9', '44.1', '9.4 R', '13.8 R'],
  '5hy': [4, '141.0', '131–152', '147.2', '101.8', '20.8', '71.2', '40.0', '27.0 R', '85.0 R'],
};
const AVG_KEYS = ['total_yds', 'ball_speed_mph', 'launch_deg', 'apex_ft', 'landing_deg', 'curve_ft', 'offline_ft'];
const byClub = C.clubData([nov]);
eq(C.sessionShots(nov).length, 48, 'Nov 1 has 48 shots');
eq(C.sortClubs(Object.keys(byClub)), ['SW', 'PW', '9i', '7i', '5hy', '5w'], 'clubs sorted short to long');
for (const club of Object.keys(EXPECTED)) {
  const [shots, carryAvg, carryRange, ...rest] = EXPECTED[club];
  const e = byClub[club];
  eq(e.shots.length, shots, `${club} shot count`);
  const carry = C.metricStat(e, 'carry_yds');
  eq(C.fmtAvg('carry_yds', carry.avg), carryAvg, `${club} carry avg`);
  eq(C.fmtRange(carry.min, carry.max), carryRange, `${club} carry range`);
  AVG_KEYS.forEach((key, i) => {
    const st = C.metricStat(e, key);
    eq(C.fmtAvg(key, st.avg), rest[i], `${club} ${key} avg`);
    eq(st.n, shots, `${club} ${key} n`);
    // Ranges for the other metrics, checked against an independent min/max of the raw data.
    const vals = e.shots.map((s) => s[key]);
    eq(C.fmtRange(st.min, st.max, C.METRIC[key].dir), C.fmtRange(Math.min(...vals), Math.max(...vals), C.METRIC[key].dir), `${club} ${key} range`);
  });
}
eq(C.fmtRange(-31, 54, true), '31 L – 54 R', 'directional range format');

section('Second screenshot: SW and 5w (avg and range, half-even)');
const EXPECTED_NEW = {
  SW: { n: 7, carry_yds: ['67.7', '54–88'], total_yds: ['70.3', '56–95'], ball_speed_mph: ['63.7', '55–77'], launch_deg: ['40.0', '22–51'],
    apex_ft: ['54.7', '40–66'], landing_deg: ['50.0', '37–58'], curve_ft: ['10.4 R', '2 L – 26 R'], offline_ft: ['9.7 R', '17 L – 37 R'] },
  '5w': { n: 5, carry_yds: ['77.8', '21–138'], total_yds: ['112.6', '35–157'], ball_speed_mph: ['89.8', '44–108'], launch_deg: ['11.8', '2–30'],
    apex_ft: ['18.4', '2–41'], landing_deg: ['20.4', '4–34'], curve_ft: ['13.4 R', '2 L – 47 R'], offline_ft: ['27.2 L', '102 L – 76 R'] },
};
for (const club of Object.keys(EXPECTED_NEW)) {
  const exp = EXPECTED_NEW[club];
  eq(byClub[club].shots.length, exp.n, `${club} shot count`);
  for (const key of Object.keys(exp)) {
    if (key === 'n') continue;
    const st = C.metricStat(byClub[club], key);
    eq([C.fmtAvg(key, st.avg), C.fmtRange(st.min, st.max, C.METRIC[key].dir)], exp[key], `${club} ${key} avg and range`);
  }
}

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
eq(C.quantile([21, 26, 68, 136, 138], 0.75), 136, '5w upper quartile');
eq(C.quantile([54, 55, 63, 64, 70, 80, 88], 0.75), 75, 'SW upper quartile (interpolated)');
eq(C.median([21, 26, 68, 136, 138]), 68, 'median (why it was replaced: 60% of 68 misses the 68-yd top)');
const fake = [{ club: 'PW', carry_yds: 85, launch_deg: 30 }, { club: 'PW', carry_yds: 88, launch_deg: 31 }, { club: 'PW', carry_yds: 20, launch_deg: 12 }, { club: 'PW', carry_yds: 70, launch_deg: 4 }];
eq(C.mishits(fake).map((m) => m.reasons.join('+')), ['short carry', 'low launch'], 'mis-hit rules');
eq(C.mishits([{ club: 'Driver', carry_yds: 200, launch_deg: 7 }]).length, 0, 'driver launch floor is 5°');
const hlNov = C.buildHighlights([nov], aug).map((h) => h.text);
eq(hlNov, [
  '48 shots with 6 clubs (SW, PW, 9i, 7i, 5hy, 5w).',
  '3 likely thin or topped shots, all with the 5w (launch as low as 2°, carry as short as 21 yds).',
  'Average miss: SW 3.2 R · PW 0.6 L · 9i 2.4 R · 7i 4.6 R · 5hy 28.3 R · 5w 9.1 L yds. The 5w average includes its 3 thin or topped shots.',
  'Since Aug 9, 2026 (baseline): PW shortest carry 9 → 69 yds, lowest launch 1.7° → 26°.',
], 'Nov 1 highlights');
// The first 36 shots alone (the brief's original data) still give the clean-contact line and the rightward trend.
const nov36 = Object.assign({}, nov, { shots: nov.shots.slice(0, 36) });
eq(C.buildHighlights([nov36], aug).map((h) => h.text).slice(1, 3), [
  'No thin or topped shots, lowest launch 18° (9i, 5hy).',
  'Average miss: PW 0.6 L · 9i 2.4 R · 7i 4.6 R · 5hy 28.3 R yds. The miss moves farther right as the clubs get longer.',
], 'first 36 shots: clean contact and rightward miss trend');
eq(C.buildHighlights([{ id: 'x', shots: [{ club: 'SW', carry_yds: 70, launch_deg: 40 }, { club: 'SW', carry_yds: 72, launch_deg: 41 }, { club: 'SW', carry_yds: 20, launch_deg: 30 }, { club: '5w', carry_yds: 140, launch_deg: 10 }, { club: '5w', carry_yds: 60, launch_deg: 3 }] }], null)[1].text,
  '2 likely thin or topped shots: SW ×1, 5w ×1 (launch as low as 3°, carry as short as 20 yds).', 'contact text across clubs');
eq(C.buildHighlights([aug], aug).map((h) => h.text), [
  'Ranges only; individual shots weren’t recorded.',
  'Thin or topped contact: PW launch as low as 1.7°, carry as short as 9 yds.',
  'This is the baseline session that progress is measured from.',
], 'Aug highlights');
eq(C.buildHighlights([], null), [], 'no sessions -> no highlights');

section('Progress');
const pPW = C.progressFor(data.sessions, 'PW', data.baseline_session_id);
eq([pPW.rows.length, pPW.baseline.session.id, pPW.latest.session.id, pPW.fallback], [2, '2026-08-rapsodo', '2026-11-01-toptracer', false], 'PW progress uses the Aug baseline');
const p9 = C.progressFor(data.sessions, '9i', data.baseline_session_id);
eq([p9.rows.length, p9.baseline.session.id, p9.fallback], [1, '2026-11-01-toptracer', true], '9i falls back to its first session');
const cmp = C.compareStats(C.metricStat(pPW.baseline.entry, 'carry_yds'), C.metricStat(pPW.latest.entry, 'carry_yds'));
eq([cmp.dMin, cmp.dMax, cmp.dAvg], [60, 1, null], 'PW carry change since baseline');

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
