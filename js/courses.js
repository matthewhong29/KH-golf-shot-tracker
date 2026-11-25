// GolfCourses: real courses for the Game tab. No dependencies; the node tests load it too.
//
// Pars and yardages come from the course's scorecard. The shape of each hole (where it
// bends, the bunkers, trees, water and out of bounds) is drawn from course guides and
// hole-by-hole write-ups, so the holes play like the real ones but aren't surveyed maps.
//
// Along a hole, distances (g) are yards back from the middle of the green along the line
// of play, so a bunker stays put whichever tee you play. Sideways (x) is yards right (+)
// or left (−) of the line of play, facing the green.
//   turns:    [{ g, deg }]: the line of play bends deg degrees (− left, + right) about
//             g yds from the green
//   fw:       half the fairway's width (yds); par 3s have no fairway
//   green:    { w, d }: width and depth (yds)
//   bunkers:  [{ g, x, w, d }]: sand, w wide and d deep
//   hollows:  [{ g, x, w, d }]: grass bunkers (hollows of rough)
//   trees:    { left, right }: how far the tree lines are from the line of play (null: none)
//   extraTrees: [{ g, x }]: single trees, such as cypress that hang over the fairway
//   water:    [{ side, from, to, edge }]: a lake or penalty area on one side, from g = from
//             to g = to, starting edge yds from the line of play (a number, or [[g, edge], …]
//             for a shore that comes and goes; a negative edge crosses the line of play).
//             kind: 'penalty' is a penalty area that isn't open water.
//   ob:       [{ side, from, to, edge }]: out of bounds beyond a line, the same way
//   obLong:   out of bounds this many yds past the middle of the green
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GolfCourses = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HARDING = {
    id: 'harding-park',
    name: 'TPC Harding Park',
    place: 'San Francisco, California',
    blurb: 'A public course on Lake Merced, lined with tall cypress trees. It has hosted the PGA Championship.',
    tees: [
      { id: 'blue', name: 'Blue', yds: 6845 },
      { id: 'white', name: 'White', yds: 6405 }
    ],
    holes: [
      { n: 1, par: 4, yds: { blue: 395, white: 375 }, fw: 17,
        note: 'A straight opener with no fairway bunkers. Cypress trees line the right.',
        green: { w: 26, d: 30 }, trees: { left: 44, right: 30 },
        bunkers: [{ g: 12, x: -16, w: 10, d: 7 }, { g: -2, x: 17, w: 8, d: 10 }] },
      { n: 2, par: 4, yds: { blue: 430, white: 400 }, fw: 16,
        note: 'Fairway bunkers and a penalty area on the left; cypress trees on the right.',
        green: { w: 26, d: 30 }, trees: { left: 86, right: 30 },
        bunkers: [{ g: 185, x: -19, w: 12, d: 7 }, { g: 160, x: -22, w: 9, d: 6 }, { g: 6, x: -16, w: 8, d: 10 }, { g: 14, x: 15, w: 9, d: 6 }],
        water: [{ kind: 'penalty', side: 'left', from: 330, to: 40, edge: 42, width: 40 }] },
      { n: 3, par: 3, yds: { blue: 165, white: 155 },
        note: 'A short par 3 framed by cypress trees.',
        green: { w: 26, d: 28 }, trees: { left: 26, right: 26 },
        bunkers: [{ g: 13, x: -11, w: 10, d: 6 }, { g: 0, x: 16, w: 7, d: 11 }] },
      { n: 4, par: 5, yds: { blue: 580, white: 540 }, fw: 17, turns: [{ g: 270, deg: -28 }],
        note: 'A long par 5 that bends to the left, with no bunkers in the fairway.',
        green: { w: 26, d: 30 }, trees: { left: 34, right: 40 },
        bunkers: [{ g: 4, x: 17, w: 8, d: 11 }, { g: 14, x: -14, w: 9, d: 6 }] },
      { n: 5, par: 4, yds: { blue: 395, white: 365 }, fw: 16,
        note: 'Straight, with no fairway bunkers. The green is long and narrow and falls away on the right.',
        green: { w: 20, d: 38 }, trees: { left: 40, right: 30 },
        bunkers: [{ g: 4, x: -14, w: 7, d: 12 }] },
      { n: 6, par: 4, yds: { blue: 440, white: 390 }, fw: 15, turns: [{ g: 170, deg: -18 }],
        note: 'Tee off down a chute of trees; the hole bends right to left.',
        green: { w: 26, d: 30 }, trees: { left: 28, right: 28 },
        bunkers: [{ g: 6, x: 16, w: 8, d: 10 }, { g: 15, x: -12, w: 9, d: 6 }] },
      { n: 7, par: 4, yds: { blue: 335, white: 325 }, fw: 16,
        note: 'A short par 4. A big grassy hollow guards the left of the green.',
        green: { w: 26, d: 28 }, trees: { left: 40, right: 34 },
        bunkers: [{ g: 8, x: 15, w: 8, d: 9 }], hollows: [{ g: 2, x: -21, w: 12, d: 16 }] },
      { n: 8, par: 3, yds: { blue: 200, white: 190 },
        note: 'A long par 3 with a deep bunker by the green.',
        green: { w: 26, d: 30 }, trees: { left: 30, right: 34 },
        bunkers: [{ g: 13, x: -12, w: 13, d: 7 }] },
      { n: 9, par: 5, yds: { blue: 495, white: 475 }, fw: 17,
        note: 'A par 5 with a cluster of fairway bunkers, and bunkers around the green.',
        green: { w: 26, d: 30 }, trees: { left: 40, right: 36 },
        bunkers: [{ g: 140, x: -18, w: 8, d: 6 }, { g: 126, x: -24, w: 7, d: 5 }, { g: 115, x: -15, w: 6, d: 5 },
          { g: 4, x: -16, w: 7, d: 10 }, { g: 8, x: 16, w: 7, d: 10 }, { g: -17, x: 4, w: 10, d: 5 }] },
      { n: 10, par: 5, yds: { blue: 550, white: 530 }, fw: 17,
        note: 'Fairway bunkers down the right, and three bunkers around the green.',
        green: { w: 26, d: 30 }, trees: { left: 38, right: 38 },
        bunkers: [{ g: 300, x: 20, w: 12, d: 7 }, { g: 280, x: 25, w: 8, d: 6 },
          { g: 14, x: -12, w: 9, d: 6 }, { g: 3, x: 16, w: 7, d: 10 }, { g: -14, x: -10, w: 9, d: 5 }] },
      { n: 11, par: 3, yds: { blue: 185, white: 155 },
        note: 'A par 3 with out of bounds just over the green.',
        green: { w: 26, d: 28 }, trees: { left: 30, right: 30 }, obLong: 24,
        bunkers: [{ g: 12, x: 12, w: 9, d: 6 }, { g: 0, x: -16, w: 7, d: 10 }] },
      { n: 12, par: 5, yds: { blue: 480, white: 450 }, fw: 16, turns: [{ g: 190, deg: -20 }],
        note: 'Bends right to left, with out of bounds all down the left. Cypress trees guard the green.',
        green: { w: 26, d: 30 }, trees: { left: 46, right: 34 },
        ob: [{ side: 'left', from: 540, to: -60, edge: 36 }],
        extraTrees: [{ g: 42, x: -21 }, { g: 56, x: -25 }, { g: 30, x: 24 }],
        bunkers: [{ g: 6, x: 16, w: 8, d: 10 }] },
      { n: 13, par: 4, yds: { blue: 405, white: 375 }, fw: 16, turns: [{ g: 180, deg: 16 }],
        note: 'The tee shot moves left to right, past a fairway bunker on the right and overhanging cypress.',
        green: { w: 26, d: 30 }, trees: { left: 36, right: 32 },
        extraTrees: [{ g: 232, x: 25 }, { g: 214, x: 23 }],
        bunkers: [{ g: 185, x: 20, w: 12, d: 7 }, { g: 6, x: -15, w: 8, d: 10 }, { g: 14, x: 13, w: 8, d: 6 }] },
      { n: 14, par: 4, yds: { blue: 440, white: 410 }, fw: 17,
        note: 'Straight and uphill, with Lake Merced off to the left.',
        green: { w: 26, d: 30 }, trees: { left: null, right: 34 },
        water: [{ side: 'left', from: 470, to: -60, edge: 48 }],
        bunkers: [{ g: 6, x: 15, w: 8, d: 10 }, { g: 15, x: -13, w: 9, d: 6 }] },
      { n: 15, par: 4, yds: { blue: 405, white: 375 }, fw: 16, turns: [{ g: 175, deg: -24 }],
        note: 'A dogleg left past overhanging cypress, with a bunker to aim at on the right and the lake to the left.',
        green: { w: 26, d: 30 }, trees: { left: 34, right: 36 },
        water: [{ side: 'left', from: 440, to: 200, edge: 56 }],
        extraTrees: [{ g: 202, x: -25 }, { g: 186, x: -27 }],
        bunkers: [{ g: 180, x: 21, w: 12, d: 8 }, { g: 4, x: -15, w: 8, d: 10 }, { g: 12, x: 14, w: 8, d: 6 }] },
      { n: 16, par: 4, yds: { blue: 330, white: 310 }, fw: 15,
        note: 'A short par 4 along Lake Merced, with two bunkers by a small green.',
        green: { w: 20, d: 24 }, trees: { left: null, right: 30 },
        water: [{ side: 'left', from: 360, to: -60, edge: 36 }],
        bunkers: [{ g: 9, x: -11, w: 8, d: 6 }, { g: 1, x: 13, w: 7, d: 9 }] },
      { n: 17, par: 3, yds: { blue: 175, white: 165 },
        note: 'A par 3 along the lake, which runs down the left.',
        green: { w: 28, d: 30 }, trees: { left: null, right: 32 },
        water: [{ side: 'left', from: 205, to: -60, edge: 30 }],
        bunkers: [{ g: 3, x: 17, w: 7, d: 11 }, { g: 16, x: 6, w: 9, d: 5 }] },
      { n: 18, par: 4, yds: { blue: 440, white: 420 }, fw: 17, turns: [{ g: 210, deg: -28 }],
        note: 'A dogleg left around Lake Merced. The tee shot carries the water, bunkers wait on the right, and the green sits up high.',
        green: { w: 26, d: 30 }, trees: { left: null, right: 34 },
        water: [{ side: 'left', from: 398, to: -60, edge: [[398, -6], [350, -6], [310, 24], [210, 34], [0, 44], [-60, 44]] }],
        bunkers: [{ g: 215, x: 21, w: 12, d: 7 }, { g: 195, x: 25, w: 8, d: 6 }, { g: 5, x: -15, w: 8, d: 10 }, { g: 14, x: 13, w: 9, d: 6 }] }
    ],
    // Blue yardages from Offcourse's scorecard, White from GolfPass's; hole shapes from the
    // course guides and hole-by-hole write-ups.
    sources: [
      { title: 'Scorecard, Blue tees (Offcourse)', url: 'https://offcourse.co/courses/scorecard/tpc-harding-park/' },
      { title: 'Scorecard, White tees (GolfPass)', url: 'https://www.golfpass.com/travel-advisor/courses/231-tpc-harding-park-harding-course' },
      { title: '2020 PGA Championship course guide (PGA.com)', url: 'https://www.pga.com/story/2020-pga-championship-tpc-harding-park-course-guide' },
      { title: 'Hole-by-hole guide (Irish Examiner)', url: 'https://www.irishexaminer.com/sport/golf/arid-40027592.html' },
      { title: 'A hole-by-hole look (CBS San Francisco)', url: 'https://www.cbsnews.com/sanfrancisco/news/pga-championship-a-hole-by-hole-look-at-tpc-harding-park/' }
    ]
  };

  var LIST = [HARDING];
  function get(id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return null; }
  function par(course, holes) {
    return course.holes.filter(function (h) { return !holes || holes.indexOf(h.n) >= 0; }).reduce(function (t, h) { return t + h.par; }, 0);
  }
  return { list: LIST, get: get, par: par, HARDING: HARDING };
});
