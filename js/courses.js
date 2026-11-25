// GolfCourses: real courses for the Game tab. Needs js/course-maps.js (GolfCourseMaps)
// and js/course-elev.js (GolfCourseElev); the node tests load it too.
//
// Each course: its scorecard (par and each set of tees' yardage for every hole, with a
// short note from course guides), its map (js/course-maps.js: the ground as mapped in
// OpenStreetMap, © OpenStreetMap contributors, ODbL) and the height of its ground
// (js/course-elev.js: from the USGS 3D Elevation Program).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./course-maps.js'), require('./course-elev.js'));
  else root.GolfCourses = factory(root.GolfCourseMaps, root.GolfCourseElev);
})(typeof self !== 'undefined' ? self : this, function (MAPS, ELEV) {
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
      { n: 1, par: 4, yds: { blue: 395, white: 375 }, note: 'A straight opener with no fairway bunkers. Cypress trees line the right.' },
      { n: 2, par: 4, yds: { blue: 430, white: 400 }, note: 'Fairway bunkers down the left side; cypress trees on the right.' },
      { n: 3, par: 3, yds: { blue: 165, white: 155 }, note: 'A short par 3 framed by cypress, with bunkers short left and right of the green.' },
      { n: 4, par: 5, yds: { blue: 580, white: 540 }, note: 'A long par 5 that bends to the left, with no bunkers in the fairway.' },
      { n: 5, par: 4, yds: { blue: 395, white: 365 }, note: 'Bends a little left. The green is long and narrow and falls away on the right.' },
      { n: 6, par: 4, yds: { blue: 440, white: 390 }, note: 'Tee off down a chute of trees; the hole bends right to left.' },
      { n: 7, par: 4, yds: { blue: 335, white: 325 }, note: 'A short par 4 that bends right, with a bunker on the left as you near the green.' },
      { n: 8, par: 3, yds: { blue: 200, white: 190 }, note: 'A long par 3 with a deep bunker short right of the green.' },
      { n: 9, par: 5, yds: { blue: 495, white: 475 }, note: 'A par 5 with a cluster of fairway bunkers down the right, and bunkers by the green.' },
      { n: 10, par: 5, yds: { blue: 550, white: 530 }, note: 'Fairway bunkers down the right, and three bunkers around the green.' },
      { n: 11, par: 3, yds: { blue: 185, white: 155 }, note: 'A par 3 with out of bounds just past the green.' },
      { n: 12, par: 5, yds: { blue: 480, white: 450 }, note: 'Bends right to left, with out of bounds all down the left. Bunkers and cypress guard the green.' },
      { n: 13, par: 4, yds: { blue: 405, white: 375 }, note: 'A fairway bunker on the right of the landing area, and out of bounds beyond the trees down the left.' },
      { n: 14, par: 4, yds: { blue: 440, white: 410 }, note: 'Straight: down to the landing area, then uphill to the green, with Lake Merced off to the left.' },
      { n: 15, par: 4, yds: { blue: 405, white: 375 }, note: 'A dogleg left past a bunker to aim at on the right, with the lake to the left.' },
      { n: 16, par: 4, yds: { blue: 330, white: 310 }, note: 'A short par 4 that bends right along Lake Merced, with bunkers short left of the green.' },
      { n: 17, par: 3, yds: { blue: 175, white: 165 }, note: 'A par 3 along the lake, which runs down the left, with bunkers on both sides of the green.' },
      { n: 18, par: 4, yds: { blue: 440, white: 420 }, note: 'A long, gentle dogleg left around Lake Merced. The tee shot carries the water, bunkers wait on the right, and the green sits above the fairway.' }
    ],
    // Blue yardages from Offcourse's scorecard, White from GolfPass's; the notes from the
    // course guides and hole-by-hole write-ups; the map from OpenStreetMap.
    sources: [
      { title: 'Scorecard, Blue tees (Offcourse)', url: 'https://offcourse.co/courses/scorecard/tpc-harding-park/' },
      { title: 'Scorecard, White tees (GolfPass)', url: 'https://www.golfpass.com/travel-advisor/courses/231-tpc-harding-park-harding-course' },
      { title: '2020 PGA Championship course guide (PGA.com)', url: 'https://www.pga.com/story/2020-pga-championship-tpc-harding-park-course-guide' },
      { title: 'Hole-by-hole guide (Irish Examiner)', url: 'https://www.irishexaminer.com/sport/golf/arid-40027592.html' },
      { title: 'A hole-by-hole look (CBS San Francisco)', url: 'https://www.cbsnews.com/sanfrancisco/news/pga-championship-a-hole-by-hole-look-at-tpc-harding-park/' },
      { title: 'Hole-by-hole lowdown, 2009 Presidents Cup (NBC Bay Area)', url: 'https://www.nbcbayarea.com/news/sports/hole-by-hole-lowdown-of-harding-park/1859473/' },
      { title: 'Course map: OpenStreetMap (© OpenStreetMap contributors, ODbL)', url: 'https://www.openstreetmap.org/way/16753068' },
      { title: 'Elevation: USGS 3D Elevation Program, via AWS Terrain Tiles', url: 'https://registry.opendata.aws/terrain-tiles/' }
    ],
    map: MAPS ? MAPS['harding-park'] : null,
    elev: ELEV ? ELEV['harding-park'] : null
  };

  var LIST = [HARDING];
  function get(id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return null; }
  function par(course, holes) {
    return course.holes.filter(function (h) { return !holes || holes.indexOf(h.n) >= 0; }).reduce(function (t, h) { return t + h.par; }, 0);
  }
  return { list: LIST, get: get, par: par, HARDING: HARDING };
});
