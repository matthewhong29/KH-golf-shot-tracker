#!/usr/bin/env python3
"""Builds js/course-maps.js: TPC Harding Park as mapped in OpenStreetMap (© OpenStreetMap
contributors, ODbL), in yards east (x) and north (z) of the middle of the course.

Usage:
  python3 scripts/build-course-map.py FEATURES.geojson BOUNDARY.json [--out js/course-maps.js]
      [--tiles DIR --elev-out js/course-elev.js]

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
lake side of the boundary, places the trees between the holes (seeded, so the same every
time), and builds the fairways of the seven holes OSM has none for. Needs numpy.

DIR (optional): the ground's heights, as AWS Terrain Tiles (the public elevation-tiles-prod
bucket: https://elevation-tiles-prod.s3.amazonaws.com/terrarium/15/X/Y.png, zoom 15,
about 4 m a pixel, from the USGS's 3D Elevation Program in the US), saved as 15-X-Y.png
for every tile over the course. With it, the script also writes js/course-elev.js: the
height of the ground every 6 yds over the course, in feet above sea level. Needs Pillow.
"""
import argparse, json, math, random

ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
ap.add_argument('features')
ap.add_argument('boundary')
ap.add_argument('--out', default='js/course-maps.js')
ap.add_argument('--tiles', default=None)
ap.add_argument('--elev-out', default='js/course-elev.js')
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
# Fairways OSM doesn't have. Seven of Harding's holes have no fairway mapped (2, 4, 5, 7,
# 9, 13 and 15), so the whole hole would play as rough. Each gets one along its line of
# play, like the course's mapped ones (which run from 120-170 yds off the back tee to the
# front of the green, 23-40 yds wide): from 130 yds off the back tee to the front of the
# green, BUILD_FW yds wide (hole 5, "among the tightest fairways", narrower; the long
# par 5s a little wider), opening out over its first 40 yds and narrowing over its last
# 60, and pinched where a fairway bunker cuts in, so the bunker sits on its edge. Never
# more than 18 yds either side of the line, so no tree (all at least 30 yds from every
# line) stands in one. Marked in fairwaysBuilt.
BUILD_FW = {2: 30, 4: 32, 5: 26, 7: 30, 9: 34, 13: 30, 15: 28}
def line_at(pts, s):
    """The point s yds along the line, and the heading there (taken over 16 yds)."""
    def pt(s):
        s = max(0, min(plen(pts), s)); acc = 0
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]; L = dist(a, b)
            if acc + L >= s or i == len(pts) - 2:
                u = (s - acc) / L if L else 0
                return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
            acc += L
    p0, p1 = pt(s - 8), pt(s + 8)
    return pt(s), math.atan2(p1[0] - p0[0], p1[1] - p0[1])
def on_line(p, pts):
    """(s, lat): how far along the line p is, and how far right (+) or left of it."""
    best = None; acc = 0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]; L = dist(a, b)
        dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        t = max(0, min(L, (p[0] - a[0]) * dx + (p[1] - a[1]) * dz))
        q = (a[0] + dx * t, a[1] + dz * t); dd = dist(p, q)
        lat = (p[0] - a[0]) * dz - (p[1] - a[1]) * dx
        if best is None or dd < best[0]: best = (dd, acc + t, lat)
        acc += L
    return best[1], best[2]
def grown(poly, by):
    c = centroid(poly)
    return [(x + (x - c[0]) / max(1e-9, dist((x, z), c)) * by, z + (z - c[1]) / max(1e-9, dist((x, z), c)) * by) for x, z in poly]
built_fw = []
for n, W in BUILD_FW.items():
    pts = holes[n]['line']; L = plen(pts); gi = holes[n]['green']
    s0 = 130
    if gi is None: s1 = L - 17
    else:
        gp = grown(greens[gi], 3); s1 = L
        while s1 > s0 and inpoly(line_at(pts, s1)[0], gp): s1 -= 1
    ss = list(np.arange(s0, s1, 4)) + [s1]
    def taper(s):
        a = min(1, (s - s0) / 40); b = min(1, (s1 - s) / 60)
        a = a * a * (3 - 2 * a); b = b * b * (3 - 2 * b)
        return (0.6 + 0.4 * a) * (0.75 + 0.25 * b)
    wl = [min(18, W / 2 * taper(s) * (1 + 0.05 * math.sin((s - s0) / 23 + n))) for s in ss]
    wr = [min(18, W / 2 * taper(s) * (1 + 0.05 * math.sin((s - s0) / 29 + 2 * n))) for s in ss]
    for b in bunkers:
        c = centroid(b)
        if lined(c, pts) > 35: continue
        sv = [on_line(v, pts) for v in b]
        lats = [l for _, l in sv]
        if min(lats) < 0 < max(lats): continue          # across the line: a bunker in the fairway
        side = 1 if lats[0] > 0 else -1
        inner = min(abs(l) for l in lats)
        lo, hi = min(x for x, _ in sv) - 8, max(x for x, _ in sv) + 8
        if hi < s0 or lo > s1: continue
        for k, s_ in enumerate(ss):
            if lo <= s_ <= hi:
                if side > 0: wr[k] = min(wr[k], max(7, inner - 0.5))
                else: wl[k] = min(wl[k], max(7, inner - 0.5))
    sm = lambda w: [sum(w[max(0, k - 1):k + 2]) / len(w[max(0, k - 1):k + 2]) for k in range(len(w))]
    wl, wr = sm(wl), sm(wr)
    left, right = [], []
    for k, s_ in enumerate(ss):
        (x, z), hd = line_at(pts, s_)
        rx, rz = math.cos(hd), -math.sin(hd)               # to the right of the heading
        left.append((x - rx * wl[k], z - rz * wl[k])); right.append((x + rx * wr[k], z + rz * wr[k]))
    built_fw.append(len(fairways))
    fairways.append(left + right[::-1])
    report.append(f"{n}: fairway built from {s0} to {round(s1)} yds along the line, {W} yds wide")
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
    'greens': [r1(g) for g in greens], 'fairways': [r1(f) for f in fairways], 'fairwayAxis': [axis(f) for f in fairways], 'fairwaysBuilt': built_fw,
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
// - Holes 2, 4, 5, 7, 9, 13 and 15 have no fairway in OSM: each has one built along its
//   line of play, as wide as the course's mapped ones (fairwaysBuilt lists them).
// - Hole 13's fairway bunker: OSM has it left of the line of play; the 2020 PGA
//   Championship guides say down the right. The map follows OSM.
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
if args.tiles:
    from PIL import Image
    import glob, os
    Z = 15; NT = 2 ** Z
    def tile_xy(lat, lon):
        fx = (lon + 180) / 360 * NT
        fy = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * NT
        return fx, fy
    tiles = {}
    for f in glob.glob(os.path.join(args.tiles, '15-*-*.png')):
        _, tx, ty = os.path.basename(f)[:-4].split('-')
        a = np.asarray(Image.open(f).convert('RGB')).astype(float)
        tiles[(int(tx), int(ty))] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768   # terrarium: metres
    def metres(x, z):
        lat = lat0 + z / KY; lon = lon0 + x / KX
        fx, fy = tile_xy(lat, lon); px_, py_ = fx * 256, fy * 256
        i0, j0 = int(math.floor(px_)), int(math.floor(py_)); u, v = px_ - i0, py_ - j0
        def h(i, j):
            t = tiles.get((i // 256, j // 256))
            if t is None: raise SystemExit(f'missing tile 15-{i // 256}-{j // 256}.png')
            return t[j % 256, i % 256]
        return (h(i0, j0) * (1 - u) * (1 - v) + h(i0 + 1, j0) * u * (1 - v) + h(i0, j0 + 1) * (1 - u) * v + h(i0 + 1, j0 + 1) * u * v)
    STEPE, UNIT, BASE = 6, 0.1, -50                         # yds between heights; 0.1 ft steps from -50 ft
    ex0, ez0 = math.floor(min(xs) - 30), math.floor(min(zs) - 30)
    nx = int(math.ceil((max(xs) + 30 - ex0) / STEPE)) + 1; nz = int(math.ceil((max(zs) + 30 - ez0) / STEPE)) + 1
    # Lake Merced's surface: the shore's height (the tiles have the lake bed in places).
    lake_level = round(min(metres(*boundary[i]) for i in lake_idx) * 3.28084, 1)
    B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    def two(v): return B64[v >> 6] + B64[v & 63]
    rows = []; ft_min, ft_max = 1e9, -1e9
    for j in range(nz):
        out = []; prev = None
        for i in range(nx):
            x, z = ex0 + i * STEPE, ez0 + j * STEPE
            ft = metres(x, z) * 3.28084
            if inpoly((x, z), lake) and not inpoly((x, z), boundary): ft = lake_level
            ft = max(ft, lake_level)
            ft_min, ft_max = min(ft_min, ft), max(ft_max, ft)
            q = int(round((ft - BASE) / UNIT)); q = max(0, min(4095, q))
            if prev is None: out.append(two(q))
            else:
                dq = q - prev
                out.append(B64[dq + 31] if -31 <= dq <= 31 else B64[63] + two(q))
            prev = q
        rows.append(''.join(out))
    elev = {'source': "USGS 3D Elevation Program (3DEP), via AWS Terrain Tiles (zoom 15)", 'unit': 'ft above sea level (NAVD88)',
            'x0': ex0, 'z0': ez0, 'step': STEPE, 'nx': nx, 'nz': nz, 'q': UNIT, 'base': BASE, 'lake': lake_level, 'rows': rows}
    ejs = """// GolfCourseElev: the height of the ground on the Game tab's courses. No dependencies;
// the node tests load it too.
//
// TPC Harding Park: the ground's height every 6 yds over the course, in feet above sea
// level, from the USGS 3D Elevation Program (3DEP, public domain) by way of the AWS
// Terrain Tiles (zoom 15, about 4 m a pixel). In the course map's yards (x east, z north
// of its middle): heights start at (x0, z0) and run east along each row, rows going north.
// Lake Merced is held at its shore's height. Built by scripts/build-course-map.py.
//
// Each row is a string: its first height in two characters, then each next one as the
// change from the one before (one character, -3.1 to +3.1 ft in 0.1 ft steps), or, for a
// bigger change, '/' and the height in two characters. A height in two characters is
// (feet - base) / q in base 64 (A-Z a-z 0-9 + /).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GolfCourseElev = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return { 'harding-park': """ + json.dumps(elev, separators=(',', ':')) + """ };
});
"""
    open(args.elev_out, 'w').write(ejs)
    print('elevation', nx, 'x', nz, 'every', STEPE, 'yds;', round(ft_min, 1), 'to', round(ft_max, 1), 'ft; lake', lake_level, 'ft;', len(ejs), 'bytes')
print('\n'.join(report))
print('trees', len(trees), 'file', len(js), 'bytes', 'lake pts', len(lake))
print('18 line', holes[18]['line'], 'length', round(plen(holes[18]['line'])))
