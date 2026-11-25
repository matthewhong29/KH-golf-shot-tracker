#!/usr/bin/env python3
"""Builds js/course-maps.js: TPC Harding Park as mapped in OpenStreetMap (© OpenStreetMap
contributors, ODbL), in yards east (x) and north (z) of the middle of the course.

Usage:
  python3 scripts/build-course-map.py FEATURES.geojson BOUNDARY.json [--out js/course-maps.js]

FEATURES.geojson: the course's OSM golf features (from the Overpass API), one GeoJSON
feature each, with properties.k set to hole, green, fairway, tee, bunker, range, wood or
path, and for a hole its ref (number) and par. BOUNDARY.json: the course boundary
(OSM way 16753068) as a list of [lon, lat] points, or {"rings": [[[lon, lat], ...]]}.
The copy used was cached from the Overpass API by github.com/ummerr/mackenzie (its
public/data/holes/tpc-harding-park-golf-course.geojson and data/osm-cache.json); only
OpenStreetMap's data was taken from it.

What it does, besides converting: matches OSM's hole lines to Harding's 18 holes (the
other nine are the Fleming nine), builds the 18th's line (OSM has none), puts each set of
tees on the real tee box closest to its scorecard yardage, draws Lake Merced beyond the
lake side of the boundary, and places the trees between the holes (seeded, so the same
every time). Needs numpy.
"""
import argparse, json, math, random

ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
ap.add_argument('features')
ap.add_argument('boundary')
ap.add_argument('--out', default='js/course-maps.js')
args = ap.parse_args()
OUT = args.out
geo = json.load(open(args.features))
bnd = json.load(open(args.boundary))
if isinstance(bnd, dict) and 'rings' in bnd: ring_ll = bnd['rings'][0]
elif isinstance(bnd, dict) and 'tpc-harding-park-golf-course' in bnd: ring_ll = bnd['tpc-harding-park-golf-course']['rings'][0]
else: ring_ll = bnd
if ring_ll[0] == ring_ll[-1]: ring_ll = ring_ll[:-1]
lat0 = round(sum(p[1] for p in ring_ll) / len(ring_ll), 6)
lon0 = round(sum(p[0] for p in ring_ll) / len(ring_ll), 6)
KX = 111320 * math.cos(math.radians(lat0)) / 0.9144
KY = 110540 / 0.9144
def yd(p): return (round((p[0] - lon0) * KX, 1), round((p[1] - lat0) * KY, 1))
def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])
def plen(pts): return sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
def centroid(poly):
    a = cx = cy = 0
    for i in range(len(poly)):
        x0, y0 = poly[i]; x1, y1 = poly[(i + 1) % len(poly)]
        c = x0 * y1 - x1 * y0; a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    a /= 2
    return (cx / (6 * a), cy / (6 * a))
def inpoly(p, poly):
    x, y = p; inside = False; j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: inside = not inside
        j = i
    return inside
def segd(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy
    u = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) if L2 else 0
    return dist(p, (a[0] + dx * u, a[1] + dy * u))
def polyd(p, poly):  # 0 inside, else distance to the edge
    if inpoly(p, poly): return 0
    return min(segd(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))
def lined(p, pts): return min(segd(p, pts[i], pts[i + 1]) for i in range(len(pts) - 1))

feats = geo['features']
def polys(kind):
    out = []
    for f in feats:
        if f['properties']['k'] != kind: continue
        r = [yd(p) for p in f['geometry']['coordinates'][0]]
        if r[0] == r[-1]: r = r[:-1]
        out.append(r)
    return out
greens, tees, fairways, bunkers, ranges, woods = (polys(k) for k in ['green', 'tee', 'fairway', 'bunker', 'range', 'wood'])
paths = [[yd(p) for p in f['geometry']['coordinates']] for f in feats if f['properties']['k'] == 'path']
boundary = [yd(p) for p in ring_ll]
lines = [f for f in feats if f['properties']['k'] == 'hole']
# Harding's holes among OSM's hole lines (the others are the Fleming nine: 2,133 yds, par 30).
HARDING = {1: 0, 2: 2, 3: 4, 4: 6, 5: 8, 6: 10, 7: 12, 8: 14, 9: 16, 10: 18, 11: 19, 12: 20, 13: 21, 14: 22, 15: 23, 16: 24, 17: 25}
FLEMING = [i for i in range(len(lines)) if i not in HARDING.values()]
YDS = {'blue': [395, 430, 165, 580, 395, 440, 335, 200, 495, 550, 185, 480, 405, 440, 405, 330, 175, 440],
       'white': [375, 400, 155, 540, 365, 390, 325, 190, 475, 530, 155, 450, 375, 410, 375, 310, 165, 420]}
gcent = [centroid(g) for g in greens]; tcent = [centroid(t) for t in tees]

holes = {}
for n, li in HARDING.items():
    pts = [yd(p) for p in lines[li]['geometry']['coordinates']]
    gi = min(range(len(greens)), key=lambda k: dist(gcent[k], pts[-1]))
    if dist(gcent[gi], pts[-1]) > 15: gi = None           # the 9th green isn't mapped
    if gi is not None: pts[-1] = tuple(round(v, 1) for v in gcent[gi])
    holes[n] = {'line': pts, 'green': gi}
# Hole 18: from its back tee box (just past the 17th green), across the inlet of Lake
# Merced to the corner of its fairway (OSM fairway 9), then up the fairway to its green
# (OSM green 1, by the clubhouse): a dogleg left around the lake.
fw18 = fairways[9]; g18 = 1
fc = centroid(fw18)
# The fairway's long axis, and the point a third of the way along it from its far end.
import numpy as np
P = np.array(fw18); m = P.mean(axis=0); u = np.linalg.svd(P - m)[2][0]
if np.dot(u, np.array(gcent[g18]) - m) < 0: u = -u
proj = (P - m) @ u
corner = tuple(np.round(m + u * (proj.min() + 0.33 * (proj.max() - proj.min())), 1))
t18 = [35, 36, 37, 38, 39]   # the 18th's tee boxes, back to front
back18 = tuple(round(v, 1) for v in tcent[t18[0]])
holes[18] = {'line': [back18, corner, tuple(round(v, 1) for v in gcent[g18])], 'green': g18, 'built': True}

# Each set of tees on the real tee box whose distance to the green, along the line of play,
# comes closest to the scorecard's; used only when it's within 12 yds of it.
def along(p, pts):
    """Distance along the line from p's projection onto it to the end, plus how far off it p is."""
    best = None; s = 0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]; L = dist(a, b)
        dx, dy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        t = max(-200 if i == 0 else 0, min(L, (p[0] - a[0]) * dx + (p[1] - a[1]) * dy))
        q = (a[0] + dx * t, a[1] + dy * t); d = dist(p, q)
        if best is None or d < best[0]: best = (d, s + t)
        s += L
    return plen(pts) - best[1], best[0]
report = []
for n in range(1, 19):
    h = holes[n]; pts = h['line']; h['tees'] = {}
    cand = []
    for k, c in enumerate(tcent):
        g, off = along(c, pts)
        if off < 14 and g > plen(pts) - 140: cand.append((k, g, off))
    for tee in ['blue', 'white']:
        want = YDS[tee][n - 1]
        # Closest to the card; between boxes within 2 yds of each other on that, the one
        # further back for Blue and further forward for White.
        best = None
        if cand:
            err = lambda x: abs(x[1] + x[2] * 0.3 - want)
            low = min(err(x) for x in cand)
            near_best = [x for x in cand if err(x) <= low + 2]
            best = max(near_best, key=lambda x: x[1]) if tee == 'blue' else min(near_best, key=lambda x: x[1])
        if best and abs(best[1] - want) <= 12:
            h['tees'][tee] = {'box': best[0], 'at': [round(v, 1) for v in tcent[best[0]]], 'g': round(best[1], 1)}
        else:
            h['tees'][tee] = {'box': None, 'g': want}
        report.append(f"{n} {tee}: card {want}, {'tee box ' + str(best[0]) + ' at ' + str(round(best[1])) if best and abs(best[1] - want) <= 12 else 'no tee box close enough: placed on the line'}")

# Lake Merced: beyond the boundary from the south tip (vertex 34) clockwise round the
# west end to the 18th green (vertex 12). Its far side is drawn 450 yds out, from a
# simplified copy of the shore so the outline never crosses itself.
NB = len(boundary)
lake_idx = list(range(34, NB)) + list(range(0, 13))
shore = [boundary[i] for i in lake_idx]
simple = [boundary[i] for i in [34, 35, 36, 38, 39, 40, 41, 3, 11, 12]]
cx, cz = np.mean(np.array(boundary), axis=0)
def outward(i, pts):
    a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
    dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
    nx, nz = dz / L, -dx / L       # right of the direction of travel (clockwise ring: outward)
    p = pts[i]
    if (p[0] - cx) * nx + (p[1] - cz) * nz < 0: nx, nz = -nx, -nz
    return nx, nz
far = []
for i, p in enumerate(simple):
    nx, nz = outward(i, simple)
    far.append((round(p[0] + nx * 450, 1), round(p[1] + nz * 450, 1)))
lake = shore + far[::-1]
# Trees: Harding Park's cypress fill the ground between the holes. Seeded, so the same
# every time: a jittered grid, kept off the line of play of every hole (Harding and
# Fleming), the fairways, greens, tees, bunkers and practice ground; in rows with gaps
# along the holes, thinner further back, and denser in the woods.
rnd = random.Random(1925)
hlines = [holes[n]['line'] for n in range(1, 19)]
flines = [[yd(p) for p in lines[i]['geometry']['coordinates']] for i in FLEMING]
xs = [p[0] for p in boundary]; zs = [p[1] for p in boundary]
def bbox(poly): return (min(p[0] for p in poly), min(p[1] for p in poly), max(p[0] for p in poly), max(p[1] for p in poly))
def near(p, polys_, pad):
    for poly in polys_:
        b = poly[1]
        if p[0] < b[0] - pad or p[0] > b[2] + pad or p[1] < b[1] - pad or p[1] > b[3] + pad: continue
        if polyd(p, poly[0]) <= pad: return True
    return False
FW = [(f, bbox(f)) for f in fairways]; GR = [(g, bbox(g)) for g in greens]; TE = [(t, bbox(t)) for t in tees]
BU = [(b, bbox(b)) for b in bunkers]; RA = [(r, bbox(r)) for r in ranges]; WO = [(w, bbox(w)) for w in woods]
trees = []
STEP = 12
for gx in np.arange(min(xs), max(xs), STEP):
    for gz in np.arange(min(zs), max(zs), STEP):
        p = (gx + rnd.uniform(-4.5, 4.5), gz + rnd.uniform(-4.5, 4.5))
        if not inpoly(p, boundary) or polyd(p, boundary) == 0 and min(segd(p, boundary[i], boundary[(i + 1) % NB]) for i in range(NB)) < 3: continue
        inwood = near(p, WO, 0)
        dl = min(lined(p, l) for l in hlines)
        # Rows with gaps along the holes, thinning further back: half the spots in the first
        # 15 yds past the rough, a third in the next 25, a quarter beyond; the woods are full.
        keep = 0.9 if inwood else 0.5 if dl < 45 else 0.34 if dl < 70 else 0.25
        if rnd.random() > keep: continue
        if dl < 30: continue
        if any(lined(p, l) < 19 for l in flines): continue
        if near(p, FW, 7) or near(p, GR, 13) or near(p, TE, 6) or near(p, BU, 4) or near(p, RA, 6): continue
        h = round(rnd.uniform(13, 23), 1); r = round(rnd.uniform(3.8, 6.8), 1)
        trees.append([round(p[0], 1), round(p[1], 1), h, r, rnd.randrange(3)])
# The 9th green isn't mapped: a 26 by 30 yd green at the end of its line stands in.
def r1(poly): return [[round(x, 1), round(z, 1)] for x, z in poly]
def axis(poly):
    P = np.array(poly); m = P.mean(axis=0); v = np.linalg.svd(P - m)[2][0]
    return round(math.atan2(v[0], v[1]), 3)
data = {
    'source': 'OpenStreetMap (© OpenStreetMap contributors, ODbL): course boundary way 16753068 and its golf=* features',
    'origin': {'lat': lat0, 'lon': lon0},
    'boundary': r1(boundary),
    'lakeFrom': 34, 'lakeTo': 12,
    'lake': r1(lake),
    'holes': {str(n): {'line': r1(holes[n]['line']), 'green': holes[n]['green'], 'tees': holes[n]['tees'],
                       **({'built': True} if holes[n].get('built') else {})} for n in range(1, 19)},
    'greens': [r1(g) for g in greens], 'fairways': [r1(f) for f in fairways], 'fairwayAxis': [axis(f) for f in fairways],
    'bunkers': [r1(b) for b in bunkers], 'tees': [r1(t) for t in tees], 'ranges': [r1(r) for r in ranges], 'woods': [r1(w) for w in woods],
    'paths': [r1(p) for p in paths], 'trees': trees,
}
js = """// GolfCourseMaps: real courses, as mapped in OpenStreetMap, for the Game tab. No
// dependencies; the node tests load it too.
//
// TPC Harding Park: the course boundary (OpenStreetMap way 16753068) and the golf
// features inside it (the line of play of each hole, greens, fairways, tee boxes,
// bunkers, practice ground, woods and cart paths), in yards east (x) and north (z) of
// the middle of the course. Map data © OpenStreetMap contributors, available under the
// Open Database License: https://www.openstreetmap.org/copyright
//
// Built by hand from OSM where it has a gap (each one is marked in the data):
// - Hole 18 has no line of play in OSM: it runs from its back tee box, across the inlet
//   of Lake Merced to the corner of its fairway, then up the fairway to its green.
// - The 9th green isn't mapped: the game puts a 26 by 30 yd green at the end of its line.
// - Lake Merced lies beyond the boundary from the south tip round the west end to the
//   18th green (lakeFrom → lakeTo, boundary vertices); its far side is drawn 450 yds out.
//   The rest of the boundary is the property line: out of bounds.
// - The trees are placed in the ground between the holes (OSM doesn't map them one by one).
// - Each set of tees stands on the real tee box closest to its scorecard yardage.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GolfCourseMaps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return { 'harding-park': """ + json.dumps(data, separators=(',', ':')) + """ };
});
"""
open(OUT, 'w').write(js)
print('\n'.join(report))
print('trees', len(trees), 'file', len(js), 'bytes', 'lake pts', len(lake))
print('18 line', holes[18]['line'], 'length', round(plen(holes[18]['line'])))
