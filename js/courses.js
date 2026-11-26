// GolfCourses: real courses for the Game tab; the node tests load it too.
//
// Each course: its scorecard (par and each set of tees' yardage for every hole, with a
// short note from course guides), and two files of its own in js/courses/, loaded when a
// round on it starts (load), so the page doesn't fetch every course on every visit: its map
// (COURSE.js: the ground as mapped in OpenStreetMap, © OpenStreetMap contributors, ODbL)
// and the height of its ground (COURSE-elev.js: from the USGS 3D Elevation Program). In
// node every course's files are loaded at once.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else root.GolfCourses = factory(null);
})(typeof self !== 'undefined' ? self : this, function (req) {
  'use strict';

  var HARDING = {
    id: 'harding-park',
    name: 'TPC Harding Park',
    place: 'San Francisco, California',
    blurb: 'A public course on Lake Merced, lined with tall cypress trees. It has hosted the PGA Championship.',
    water: 'Lake Merced',
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
      { n: 18, par: 4, yds: { blue: 440, white: 420 }, note: 'A long, gentle dogleg left around Lake Merced. The drive carries the water, bunkers wait on the right, and the green sits above the fairway.' }
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
  };

  var EDGEWOOD = {
    id: 'edgewood-tahoe',
    name: 'Edgewood Tahoe',
    place: 'Stateline, Nevada',
    blurb: 'On the shore of Lake Tahoe, among tall pines, with water on many holes. It hosts the American Century Championship. At 6,250 ft the ball carries about 7% farther than at sea level.',
    water: 'Lake Tahoe, the ponds and Edgewood Creek',
    altitudeFt: 6250,
    tees: [
      { id: 'blue', name: 'Blue', yds: 6904 },
      { id: 'white', name: 'White', yds: 6339 }
    ],
    holes: [
      { n: 1, par: 4, yds: { blue: 402, white: 370 }, note: 'A gentle opener that bends right: drive over Edgewood Creek, with a pond down the left and a bunker right of the green.' },
      { n: 2, par: 4, yds: { blue: 393, white: 362 }, note: 'Straightaway, with water down the left all the way to the green.' },
      { n: 3, par: 5, yds: { blue: 575, white: 532 }, note: 'A long dogleg right, with the big pond down the left the whole way, fairway bunkers where the drives and lay-ups land, and two short of the green.' },
      { n: 4, par: 5, yds: { blue: 520, white: 488 }, note: 'A straight par 5 with out of bounds down the left and Edgewood Creek on the right as you near the green.' },
      { n: 5, par: 3, yds: { blue: 188, white: 152 }, note: 'A par 3 over Edgewood Creek, with bunkers short left and right of the green.' },
      { n: 6, par: 4, yds: { blue: 398, white: 368 }, note: 'Bends right, then the approach carries a pond to a green ringed by bunkers. Water and an uphill approach make it a common bogey.' },
      { n: 7, par: 3, yds: { blue: 161, white: 149 }, note: 'A short par 3 to a green guarded by bunkers on the left and short right.' },
      { n: 8, par: 4, yds: { blue: 430, white: 382 }, note: 'A long par 4 that bends gently right through the pines, with a bunker short right of the green.' },
      { n: 9, par: 4, yds: { blue: 417, white: 380 }, note: 'Doglegs right, with out of bounds down the left, fairway bunkers on the right, and bunkers short right and left of the green.' },
      { n: 10, par: 4, yds: { blue: 413, white: 383 }, note: 'Drive over Edgewood Creek, then water down the left all the way to the green.' },
      { n: 11, par: 4, yds: { blue: 372, white: 328 }, note: 'The drive carries a pond; the green is tucked into the trees, with a bunker short right.' },
      { n: 12, par: 3, yds: { blue: 187, white: 167 }, note: 'A par 3 over Edgewood Creek, with bunkers short of the green and over it.' },
      { n: 13, par: 4, yds: { blue: 425, white: 387 }, note: 'Doglegs right along Edgewood Creek, with two fairway bunkers on the right, and bunkers short and long left of the green.' },
      { n: 14, par: 4, yds: { blue: 406, white: 388 }, note: 'Doglegs right with the big pond down the left the whole way, a fairway bunker on the right and one short right of the green.' },
      { n: 15, par: 4, yds: { blue: 394, white: 341 }, note: 'Bends gently right through the pines to a green with bunkers short and long right.' },
      { n: 16, par: 5, yds: { blue: 547, white: 533 }, note: 'Heads straight for Lake Tahoe, with bunkers both sides of the fairway and sand round the green.' },
      { n: 17, par: 3, yds: { blue: 175, white: 140 }, note: 'A par 3 along the lake, with the beach all down the right and bunkers round the green.' },
      { n: 18, par: 5, yds: { blue: 501, white: 489 }, note: 'Home along Lake Tahoe, which lies right of the green, while a pond intrudes from the left: going for it in two means a carry over water.' }
    ],
    // Pars and yardages from GolfPass's scorecard (the same card as Greenskeeper.org's), each
    // hole checked against the map: where OSM has the tee box, it's within a few yds of the
    // card. OSM has the 17th as a par 4; the card, and every guide, a par 3.
    sources: [
      { title: 'Scorecard (GolfPass)', url: 'https://www.golfpass.com/travel-advisor/courses/15955-edgewood-tahoe-golf-course' },
      { title: 'Scorecard (Greenskeeper.org)', url: 'https://www.greenskeeper.org/northern_california/Lake_Tahoe_Reno/edgewood_tahoe_golf_course/scorecard.cfm' },
      { title: 'Hole-by-hole guide (GolfPass)', url: 'https://www.golfpass.com/travel-advisor/articles/edgewood-tahoe-golf-course-hole-by-hole' },
      { title: 'Course map: OpenStreetMap (© OpenStreetMap contributors, ODbL)', url: 'https://www.openstreetmap.org/way/63521167' },
      { title: 'Elevation: USGS 3D Elevation Program, via AWS Terrain Tiles', url: 'https://registry.opendata.aws/terrain-tiles/' },
      { title: 'Altitude: "The effect of altitude on golf ball performance" (Titleist)', url: 'https://www.titleist.com/teamtitleist/gb/b/weblog/posts/the-effect-of-altitude-on-golf-ball-performance' }
    ],
    map: null,
    elev: null
  };

  var LIST = [HARDING, EDGEWOOD];
  // Each course's two files, stamped with a hash of their contents by scripts/stamp.js (so a
  // phone fetches them fresh when they change).
  var FILES = {
    'harding-park': ['js/courses/harding-park.js?v=a9d10464', 'js/courses/harding-park-elev.js?v=1194ffe8'],
    'edgewood-tahoe': ['js/courses/edgewood-tahoe.js?v=8a184933', 'js/courses/edgewood-tahoe-elev.js?v=c9a68b54']
  };
  function get(id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return null; }
  function par(course, holes) {
    return course.holes.filter(function (h) { return !holes || holes.indexOf(h.n) >= 0; }).reduce(function (t, h) { return t + h.par; }, 0);
  }
  function attach(course, d) { if (d && d.map) { course.map = d.map; course.elev = d.elev || null; } return course; }
  if (req) LIST.forEach(function (c) { attach(c, { map: req('./courses/' + c.id + '.js'), elev: req('./courses/' + c.id + '-elev.js') }); });
  else LIST.forEach(function (c) { attach(c, (self.GolfCourseData || {})[c.id]); });   // any a page already has
  // Whether a course's map and heights are here yet, and load(id): a promise of the course,
  // its files fetched (once) as scripts. A file that hasn't come in within TIMEOUT counts as
  // failed, so does one that came in cut short (it ran, but left no map or no heights), and
  // a try after a failure fetches the files afresh. prefetch(id) loads one quietly ahead of
  // time, so a round can start with no signal later (at the range, say).
  var TIMEOUT = 20000, pending = {}, tries = {};
  function loaded(id) { var c = get(id); return !!(c && c.map && c.elev); }
  function load(id) {
    var c = get(id);
    if (!c) return Promise.reject(new Error('No such course: ' + id));
    if (loaded(id)) return Promise.resolve(c);
    if (!FILES[id]) return Promise.reject(new Error('The files of ' + c.name + ' aren’t listed'));
    if (pending[id]) return pending[id];
    var n = tries[id] = (tries[id] || 0) + 1;
    pending[id] = FILES[id].reduce(function (p, src) {
      return p.then(function () {
        return new Promise(function (ok, fail) {
          var el = document.createElement('script'), done = false, timer = 0;
          function end(err) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (el.parentNode) el.parentNode.removeChild(el);
            if (err) fail(err); else ok();
          }
          timer = setTimeout(function () { end(new Error('Loading ' + c.name + ' took too long')); }, TIMEOUT);
          el.onload = function () { end(); };
          el.onerror = function () { end(new Error('Couldn’t load ' + c.name)); };
          el.src = src + (n > 1 ? '&try=' + n : '');
          document.head.appendChild(el);
        });
      });
    }, Promise.resolve()).then(function () {
      var all = self.GolfCourseData || {}, d = all[id] || {};
      if (!d.map || !d.elev) { delete all[id]; throw new Error('Part of ' + c.name + ' didn’t load'); }
      attach(c, d);
      return c;
    });
    pending[id].catch(function () { delete pending[id]; });
    return pending[id];
  }
  function prefetch(id) { if (get(id) && !loaded(id)) load(id).catch(function () {}); }
  return { list: LIST, get: get, par: par, load: load, loaded: loaded, prefetch: prefetch, FILES: FILES, HARDING: HARDING, EDGEWOOD: EDGEWOOD };
});
