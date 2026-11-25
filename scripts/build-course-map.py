#!/usr/bin/env python3
"""Builds a course for the Game tab from OpenStreetMap's map of it (© OpenStreetMap
contributors, ODbL), in yards east (x) and north (z) of the middle of the course:
js/courses/COURSE.js, and with --tiles the height of its ground, js/courses/COURSE-elev.js.

Usage:
  python3 scripts/build-course-map.py COURSE FEATURES.geojson BOUNDARY.json [--tiles DIR]

COURSE: harding-park or edgewood-tahoe (each one's settings are in COURSES below).
FEATURES.geojson: the course's OSM golf features (from the Overpass API), one GeoJSON
feature each, with properties.k set to hole, green, fairway, tee, bunker, range, wood,
water or path, and for a hole its ref (number) and par. BOUNDARY.json: the course boundary
as a list of [lon, lat] points, or {"rings": [[[lon, lat], ...]]}, or a cache with the
course's key in it. The copies used were cached from the Overpass API by
github.com/ummerr/mackenzie (its public/data/holes/KEY.geojson and data/osm-cache.json);
only OpenStreetMap's data was taken from it.

What it does, besides converting: matches OSM's hole lines to the course's 18 holes,
puts each set of tees on the real tee box closest to its scorecard yardage, draws the lake
beyond the lake side of the boundary, places the trees between the holes (seeded, so the
same every time), builds the fairways OSM has none for, and fills the gaps each course's
hooks below describe. Needs numpy.

DIR (optional): the ground's heights, as AWS Terrain Tiles (the public elevation-tiles-prod
bucket: https://elevation-tiles-prod.s3.amazonaws.com/terrarium/15/X/Y.png, zoom 15,
about 4 m a pixel, from the USGS's 3D Elevation Program in the US), saved as 15-X-Y.png
for every tile over the course. With it, the script also writes COURSE-elev.js: the height
of the ground every 6 yds over the course, in feet above sea level. Needs Pillow.
"""
import argparse, json, math, random, os
import numpy as np

# Each course's settings: its key in the OSM cache, which OSM hole line is which hole, the
# scorecard's yardages (to put each set of tees on its tee box), the lake beyond the
# boundary, the trees, and the fairways to build where OSM has none.
COURSES = {
    'harding-park': {
        'name': 'TPC Harding Park', 'key': 'tpc-harding-park-golf-course', 'way': '16753068',
        # Harding's holes among OSM's hole lines (the others are the Fleming nine: 2,133 yds, par 30).
        'lines': {1: 0, 2: 2, 3: 4, 4: 6, 5: 8, 6: 10, 7: 12, 8: 14, 9: 16, 10: 18, 11: 19, 12: 20, 13: 21, 14: 22, 15: 23, 16: 24, 17: 25},
        'yds': {'blue': [395, 430, 165, 580, 395, 440, 335, 200, 495, 550, 185, 480, 405, 440, 405, 330, 175, 440],
                'white': [375, 400, 155, 540, 365, 390, 325, 190, 475, 530, 155, 450, 375, 410, 375, 310, 165, 420]},
        # How far to the side of the line of play a tee box may sit: 14 yds, but the 18th's forward
        # tees stand on the peninsula well to the side of the back tee's line (the White tee box is
        # about 32 yds off it).
        'tee_off': {18: 40},
        # Lake Merced: beyond the boundary from the south tip (vertex 34) clockwise round the
        # west end to the 18th green (vertex 12). Its far side is drawn 450 yds out, from a
        # simplified copy of the shore so the outline never crosses itself. Its surface: the
        # shore's height (the tiles have the lake bed in places).
        'lake': {'from': 34, 'to': 12, 'simple': [34, 35, 36, 38, 39, 40, 41, 3, 11, 12], 'out': 450, 'level': 'shore'},
        # Harding Park's cypress: 13-23 yds tall, 3.8-6.8 yds round.
        'trees': {'seed': 1925, 'kind': 'cypress', 'h': (13, 23), 'r': (3.8, 6.8)},
        'build_fw': {2: 30, 4: 32, 5: 26, 7: 30, 9: 34, 13: 30, 15: 28}, 'par5': {4, 9},
        'follow_fw': {16: 11, 18: 9},
        'elev_base': -50,
    },
    'edgewood-tahoe': {
        'name': 'Edgewood Tahoe', 'key': 'edgewood-tahoe-resort-golf', 'way': '63521167',
        'lines': 'ref',   # OSM's 18 hole lines are the course's, each with its number
        'yds': {'blue': [402, 393, 575, 520, 188, 398, 161, 430, 417, 413, 372, 187, 425, 406, 394, 547, 175, 501],
                'white': [370, 362, 532, 488, 152, 368, 149, 382, 380, 383, 328, 167, 387, 388, 341, 533, 140, 489]},
        'tee_off': {},
        # Lake Tahoe: beyond the boundary from vertex 10 to vertex 20, down the west side by the
        # 16th green, the 17th and the 18th, where the USGS heights 15-30 yds out are the lake's
        # surface (6,225.6 ft) all the way along, past a strip of beach. Its far side is drawn
        # 2,500 yds out, so the lake reaches the horizon. Its surface: the lowest ground in it.
        'lake': {'from': 10, 'to': 20, 'simple': [10, 12, 15, 18, 20], 'out': 2500, 'level': 'min'},
        # The Sierra's Jeffrey and lodgepole pines: tall and narrow, 20-34 yds tall, 3-5 yds round.
        'trees': {'seed': 1968, 'kind': 'pine', 'h': (20, 34), 'r': (3.0, 5.0)},
        'build_fw': {4: 34, 14: 32}, 'par5': {4},
        'follow_fw': {},
        'elev_base': 6200,
    },
}
ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
ap.add_argument('course', choices=sorted(COURSES))
ap.add_argument('features')
ap.add_argument('boundary')
ap.add_argument('--tiles', default=None)
args = ap.parse_args()
CID = args.course; CFG = COURSES[CID]
OUT = os.path.join('js', 'courses', CID + '.js'); ELEV_OUT = os.path.join('js', 'courses', CID + '-elev.js')
geo = json.load(open(args.features))
bnd = json.load(open(args.boundary))
if isinstance(bnd, dict) and 'rings' in bnd: ring_ll = bnd['rings'][0]
elif isinstance(bnd, dict) and CFG['key'] in bnd: ring_ll = bnd[CFG['key']]['rings'][0]
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
greens, tees, fairways, bunkers, ranges, woods, ponds = (polys(k) for k in ['green', 'tee', 'fairway', 'bunker', 'range', 'wood', 'water'])
paths = [[yd(p) for p in f['geometry']['coordinates']] for f in feats if f['properties']['k'] == 'path']
boundary = [yd(p) for p in ring_ll]
report = []
# Spikes in OSM's outlines: a point where the outline doubles back on itself, sharper than
# 35°, with a side under 8 yds long beside it (a slip of the mapper's mouse, or a node
# shared with the next feature). Drawn, each is a sliver of fairway poking out into the
# rough. On a green any point that sharp goes, however long its sides, and first any point
# where the edge turns in on itself by more than 240° (the rest of the course's greens bend
# in by 220° at most): the 6th green's outline ran in to a node of its fairway and back
# out, cutting a deep notch into it.
def angle_at(a, b, c):
    v1, v2 = (a[0] - b[0], a[1] - b[1]), (c[0] - b[0], c[1] - b[1])
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if not n1 or not n2: return 0, n1, n2
    return math.degrees(math.acos(max(-1, min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2))))), n1, n2
def notched(p, i, deep):
    a, b, c = p[i - 1], p[i], p[(i + 1) % len(p)]
    area = sum(p[k][0] * p[(k + 1) % len(p)][1] - p[(k + 1) % len(p)][0] * p[k][1] for k in range(len(p)))
    turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    return turn * area < 0 and 360 - angle_at(a, b, c)[0] > deep
def despike(poly, any_len=False, sharp=35, short=8, deep=None):
    p, gone = list(poly), 0
    while deep and len(p) > 4:
        worst = max(range(len(p)), key=lambda i: (notched(p, i, deep), -angle_at(p[i - 1], p[i], p[(i + 1) % len(p)])[0]))
        if not notched(p, worst, deep): break
        del p[worst]; gone += 1
    while len(p) > 4:
        worst = None
        for i in range(len(p)):
            ang, n1, n2 = angle_at(p[i - 1], p[i], p[(i + 1) % len(p)])
            if ang < sharp and (any_len or min(n1, n2) < short) and (worst is None or ang < worst[0]): worst = (ang, i)
        if worst is None: break
        del p[worst[1]]; gone += 1
    return p, gone
for kind, lst, any_len in [('fairway', fairways, False), ('tee', tees, False), ('green', greens, True)]:
    for i, poly in enumerate(lst):
        lst[i], gone = despike(poly, any_len, deep=240 if kind == 'green' else None)
        if gone: report.append(f"{kind} {i}: {gone} spike{'s' if gone > 1 else ''} taken out")
lines = [f for f in feats if f['properties']['k'] == 'hole']
# Which OSM hole line is which hole: set in COURSES, or by each line's number (ref). The rest
# are another course's (Harding's Fleming nine), kept off by the trees like the course's own.
if CFG['lines'] == 'ref':
    LINES = {}
    for i, f in enumerate(lines):
        r = str(f['properties'].get('ref', ''))
        if r.isdigit() and 1 <= int(r) <= 18 and int(r) not in LINES: LINES[int(r)] = i
else: LINES = CFG['lines']
OTHER = [i for i in range(len(lines)) if i not in LINES.values()]
YDS = CFG['yds']
gcent = [centroid(g) for g in greens]; tcent = [centroid(t) for t in tees]

holes = {}
for n, li in LINES.items():
    pts = [yd(p) for p in lines[li]['geometry']['coordinates']]
    gi = min(range(len(greens)), key=lambda k: dist(gcent[k], pts[-1]))
    if dist(gcent[gi], pts[-1]) > 15: gi = None           # a green OSM doesn't have
    if gi is not None: pts[-1] = tuple(round(v, 1) for v in gcent[gi])
    holes[n] = {'line': pts, 'green': gi}

# ----- TPC Harding Park's gaps -----
def harding_lines():
    """Hole 18: from its back tee box (just past the 17th green), across the inlet of Lake
    Merced to the corner of its fairway (OSM fairway 9), then up the fairway to its green
    (OSM green 1, by the clubhouse): a dogleg left around the lake."""
    fw18 = fairways[9]; g18 = 1
    # The fairway's long axis, and the point a third of the way along it from its far end.
    P = np.array(fw18); m = P.mean(axis=0); u = np.linalg.svd(P - m)[2][0]
    if np.dot(u, np.array(gcent[g18]) - m) < 0: u = -u
    proj = (P - m) @ u
    corner = tuple(np.round(m + u * (proj.min() + 0.33 * (proj.max() - proj.min())), 1))
    t18 = [35, 36, 37, 38, 39]   # the 18th's tee boxes, back to front
    back18 = tuple(round(v, 1) for v in tcent[t18[0]])
    holes[18] = {'line': [back18, corner, tuple(round(v, 1) for v in gcent[g18])], 'green': g18, 'built': True}
HOOKS = {'harding-park': {'lines': harding_lines}}
def hook(step):
    f = HOOKS.get(CID, {}).get(step)
    if f: f()
hook('lines')

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
def smooth_line(pts, sigma=20, step=2):
    """The line with its corners rounded: a point every `step` yds, each the Gaussian-weighted
    mean of the points round it (sigma yds), over a window that shrinks towards the ends so
    they stay put. A dogleg's turn becomes a curve about 2.5 sigma long."""
    L = plen(pts); n = max(2, int(round(L / step)))
    P = np.array([line_at(pts, L * k / n)[0] for k in range(n + 1)])
    k = int(3 * sigma / (L / n)); w = np.exp(-0.5 * (np.arange(-k, k + 1) * (L / n) / sigma) ** 2)
    out = []
    for i in range(len(P)):
        m = min(i, len(P) - 1 - i, k)
        ww = w[k - m:k + m + 1]
        out.append(tuple((P[i - m:i + m + 1] * ww[:, None]).sum(0) / ww.sum()))
    return out
def simplify(pts, tol, closed=False):
    """Douglas-Peucker: drops the points that lie within tol yds of the line through their neighbours."""
    if closed:
        k = max(range(len(pts)), key=lambda i: dist(pts[i], pts[0]))
        a, b = simplify(pts[:k + 1], tol), simplify(pts[k:] + [pts[0]], tol)
        return a[:-1] + b[:-1]
    if len(pts) < 3: return list(pts)
    d, i = max((segd(pts[i], pts[0], pts[-1]), i) for i in range(1, len(pts) - 1))
    if d <= tol: return [pts[0], pts[-1]]
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol)
def across(poly, cl, s, reach=45):
    """How far a shape reaches left and right of the line at s, square to it (0 if not at all)."""
    (x, z), hd = line_at(cl, s); rx, rz = math.cos(hd), -math.sin(hd)
    l = r = 0
    for k in range(1, reach * 4):
        d = k / 4
        if inpoly((x + rx * d, z + rz * d), poly): r = d
        if inpoly((x - rx * d, z - rz * d), poly): l = d
    return l, r
# Lines of play that stray off their mapped fairway: OSM's line for the 16th runs down the
# right edge of its fairway and out into the rough, and the 18th's (built above) hugs the
# lake once round the corner, where the 2020 PGA Championship guides call the hole "a long,
# gentle dogleg left" whose drive "carries the lake" and "heads up the right side". Each is
# re-routed down the middle of its fairway: from points 20 yds apart along the old line,
# where a cross-section meets the fairway, the point of it farthest from the fairway's
# edges, smoothed; the tee end and the green stay, and so does a carry over water before it.
FOLLOW_FW = CFG['follow_fw']
def widest(p, hd, fw, reach=70):
    rx, rz = math.cos(hd), -math.sin(hd)
    best = None
    for lat in range(-reach, reach + 1):
        q = (p[0] + rx * lat, p[1] + rz * lat)
        if not inpoly(q, fw): continue
        d = min(segd(q, fw[i], fw[(i + 1) % len(fw)]) for i in range(len(fw)))
        if best is None or d > best[0]: best = (d, q)
    return best
for n, fi in FOLLOW_FW.items():
    pts = holes[n]['line']; fw = fairways[fi]; L = plen(pts)
    mids = []
    for s_ in range(0, int(L), 20):
        p, hd = line_at(pts, s_)
        b = widest(p, hd, fw)
        if b and b[0] >= 5: mids.append(b[1])
    sm = [mids[0]] + [tuple(np.mean(mids[max(0, k - 1):k + 2], axis=0)) for k in range(1, len(mids) - 1)] + [mids[-1]]
    route = [pts[0]]
    for q in sm:
        if dist(q, route[-1]) >= 30: route.append(q)
    if dist(route[-1], pts[-1]) < 25: route.pop()
    route.append(pts[-1])
    holes[n]['line'] = [tuple(round(float(v), 1) for v in q) for q in route]
def harding_waypoint13():
    """Hole 13: OSM's line runs straight from the tee over the fairway bunker in the landing area,
    so the fairway built along it would have the bunker in its middle. The 2020 PGA
    Championship guides put that bunker down the right, with the drive turning left to right
    past it, so the line passes 6 yds left of the bunker; the fairway built along it then has
    the bunker on its right edge."""
    pts13 = holes[13]['line']
    for b in bunkers:
        sv = [on_line(v, pts13) for v in b]
        lats = [l for _, l in sv]; s_mid = float(np.mean([x for x, _ in sv]))
        if not (min(lats) < 0 < max(lats) and 100 <= s_mid <= plen(pts13) - 100): continue
        p, hd = line_at(pts13, s_mid)
        rx, rz = math.cos(hd), -math.sin(hd); off = min(lats) - 6
        way = (round(p[0] + rx * off, 1), round(p[1] + rz * off, 1))
        acc = 0
        for i in range(len(pts13) - 1):
            acc += dist(pts13[i], pts13[i + 1])
            if acc >= s_mid: pts13 = pts13[:i + 1] + [way] + pts13[i + 1:]; break
        holes[13]['line'] = pts13
        break

# The 9th green isn't mapped. NBC's 2009 guide to the hole has "front bunkers at the green",
# and OSM has the two: one down the left of where the green's front half would be (bunker 39)
# and one short right (40). Every other line of play here ends within 8 yds of the middle of
# its green, so the 9th's is built round the end of its line: about as big as Harding's
# mapped greens (576-764 sq yds, 675 on average), 37 yds deep and 22 across, its front
# reaching out towards the bunker short right and its left side clear of the one on the
# left, its outline a smooth curve through these points (yds along the line from its end,
# and right of it). Marked in greensBuilt.
G9 = [(-22, 4), (-20, 9), (-10, 12), (3, 12), (11.5, 8), (15, 1), (12, -6), (4, -9), (-8, -9.5), (-17, -5.5), (-21, -1)]
def catmull(ctrl, per=6):
    """A closed curve through the points (Catmull-Rom), `per` points between each two."""
    out = []; n = len(ctrl)
    for i in range(n):
        p0, p1, p2, p3 = (np.array(ctrl[(i + k) % n], dtype=float) for k in (-1, 0, 1, 2))
        for k in range(per):
            t = k / per
            out.append(tuple(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3)))
    return out
built_greens = []
def harding_green9():
    if holes[9]['green'] is None:
        pts9 = holes[9]['line']; e9 = pts9[-1]; d9 = dist(e9, pts9[-2])
        ux, uz = (e9[0] - pts9[-2][0]) / d9, (e9[1] - pts9[-2][1]) / d9
        g9 = [(e9[0] + ux * a + uz * l, e9[1] + uz * a - ux * l) for a, l in catmull(G9)]
        # at least 3.5 yds clear of every bunker (room for the fringe), pulled in where it isn't
        c9 = centroid(g9); near_b = [b for b in bunkers if dist(centroid(b), c9) < 90]
        for i, p in enumerate(g9):
            while min(polyd(p, b) for b in near_b) < 3.5: p = (p[0] + (c9[0] - p[0]) * 0.02, p[1] + (c9[1] - p[1]) * 0.02)
            g9[i] = p
        g9 = simplify(g9, 0.12, closed=True)
        for kind, lst in [('green', greens), ('tee', tees), ('fairway', fairways)]:
            assert not any(inpoly(p, q) for q in lst for p in g9), f'the 9th green overlaps a {kind}'
        holes[9]['green'] = len(greens); built_greens.append(len(greens))
        greens.append(g9); gcent.append(centroid(g9))
        holes[9]['line'] = pts9[:-1] + [tuple(round(v, 1) for v in gcent[-1])]
        a9 = abs(sum(g9[i][0] * g9[(i + 1) % len(g9)][1] - g9[(i + 1) % len(g9)][0] * g9[i][1] for i in range(len(g9))) / 2)
        report.append(f"9: green built round the end of its line, {round(a9)} sq yds, {round(min(polyd(p, b) for b in near_b for p in g9), 1)} yds from the nearest bunker")
HOOKS['harding-park'].update({'waypoints': harding_waypoint13, 'greens': harding_green9})
hook('waypoints')
hook('greens')

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
# How far to the side of the line of play a tee box may sit: 14 yds, or as the course's
# settings say (tee_off).
TEE_OFF = CFG['tee_off']
for n in range(1, 19):
    h = holes[n]; pts = h['line']; h['tees'] = {}
    cand = []
    for k, c in enumerate(tcent):
        g, off = along(c, pts)
        if off < TEE_OFF.get(n, 14) and g > plen(pts) - 140: cand.append((k, g, off))
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

# The lake beyond the boundary (see the course's settings): from vertex `from` round to
# vertex `to`, its far side `out` yds away, drawn from a simplified copy of the shore so the
# outline never crosses itself.
NB = len(boundary); LK = CFG['lake']
lake_idx = list(range(LK['from'], NB)) + list(range(0, LK['to'] + 1)) if LK['from'] > LK['to'] else list(range(LK['from'], LK['to'] + 1))
shore = [boundary[i] for i in lake_idx]
simple = [boundary[i] for i in LK['simple']]
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
    far.append((round(p[0] + nx * LK['out'], 1), round(p[1] + nz * LK['out'], 1)))
lake = shore + far[::-1]
# Trees fill the ground between the holes (see the course's settings for their kind and
# size). Seeded, so the same every time: a jittered grid, kept off the line of play of every
# hole (the course's and any other's, like Harding's Fleming nine), the fairways, greens,
# tees, bunkers, ponds and practice ground; in rows with gaps along the holes, thinner
# further back, and denser in the woods.
TR = CFG['trees']
rnd = random.Random(TR['seed'])
hlines = [holes[n]['line'] for n in range(1, 19)]
flines = [[yd(p) for p in lines[i]['geometry']['coordinates']] for i in OTHER]
xs = [p[0] for p in boundary]; zs = [p[1] for p in boundary]
def bbox(poly): return (min(p[0] for p in poly), min(p[1] for p in poly), max(p[0] for p in poly), max(p[1] for p in poly))
def near(p, polys_, pad):
    for poly in polys_:
        b = poly[1]
        if p[0] < b[0] - pad or p[0] > b[2] + pad or p[1] < b[1] - pad or p[1] > b[3] + pad: continue
        if polyd(p, poly[0]) <= pad: return True
    return False
FW = [(f, bbox(f)) for f in fairways]; GR = [(g, bbox(g)) for g in greens]; TE = [(t, bbox(t)) for t in tees]
BU = [(b, bbox(b)) for b in bunkers]; RA = [(r, bbox(r)) for r in ranges]; WO = [(w, bbox(w)) for w in woods]; PO = [(w, bbox(w)) for w in ponds]
trees = []
STEP = 12
for gx in np.arange(min(xs), max(xs), STEP):
    for gz in np.arange(min(zs), max(zs), STEP):
        # Each spot draws all its numbers first, so a change to the map in one place moves
        # only the trees there, not every tree after it.
        jx, jz, roll = rnd.uniform(-4.5, 4.5), rnd.uniform(-4.5, 4.5), rnd.random()
        h, r, tone = round(rnd.uniform(*TR['h']), 1), round(rnd.uniform(*TR['r']), 1), rnd.randrange(3)
        p = (gx + jx, gz + jz)
        if not inpoly(p, boundary) or polyd(p, boundary) == 0 and min(segd(p, boundary[i], boundary[(i + 1) % NB]) for i in range(NB)) < 3: continue
        inwood = near(p, WO, 0)
        dl = min(lined(p, l) for l in hlines)
        # Rows with gaps along the holes, thinning further back: half the spots in the first
        # 15 yds past the rough, a third in the next 25, a quarter beyond; the woods are full.
        keep = 0.9 if inwood else 0.5 if dl < 45 else 0.34 if dl < 70 else 0.25
        if roll > keep: continue
        if dl < 30: continue
        if any(lined(p, l) < 19 for l in flines): continue
        if near(p, FW, 7) or near(p, GR, 13) or near(p, TE, 6) or near(p, BU, 4) or near(p, RA, 6) or near(p, PO, 3): continue
        trees.append([round(p[0], 1), round(p[1], 1), h, r, tone])
def harding_cypress():
    """The 4th's "large cypress at the corner of the dogleg" (PGA; Arccos: "do not get greedy"):
    one big tree inside the turn, 30 yds left of the line of play where it bends (as close as
    any tree stands to a line), 27 yds tall and 18 across; the trees round it make way."""
    global trees
    t4 = holes[4]['line']; c4 = t4[1]
    d1 = np.array(c4) - np.array(t4[0]); d1 /= np.linalg.norm(d1)
    d2 = np.array(t4[2]) - np.array(c4); d2 /= np.linalg.norm(d2)
    inward = d2 - d1; inward /= np.linalg.norm(inward)
    big = tuple(np.array(c4) + inward * 30 / math.cos(math.acos(float(np.dot(d1, d2))) / 2))
    assert min(lined(big, l) for l in hlines) >= 29.9 and not near(big, FW + GR + TE + BU, 4), "the 4th's cypress isn't in the rough"
    trees = [t for t in trees if dist(t, big) > 9 + t[3] + 1] + [[round(big[0], 1), round(big[1], 1), 27, 9, 0]]
    report.append(f"4: the cypress at the corner stands at {round(big[0], 1)}, {round(big[1], 1)}")
HOOKS['harding-park']['trees'] = harding_cypress
hook('trees')
# Fairways OSM doesn't have. Seven of Harding's holes have no fairway mapped (2, 4, 5, 7,
# 9, 13 and 15), so the whole hole would play as rough. Each gets one shaped like the
# course's mapped ones, which run from 120-170 yds off the back tee to the green, 23-40 yds
# wide, wider where the drives land and narrower in between:
# - down the middle of its line of play, its corners rounded, so a dogleg's fairway curves;
# - from 130 yds off the back tee, with a rounded end, to under the front of the green,
#   narrowing over its last 40 yds to the green's width;
# - BUILD_FW yds wide where the drives land (215-295 yds out), a little narrower short of
#   that and on the way in; on a par 5, a neck past the landing area and a second wide part
#   where the second shot is laid up (hole 5, "among the tightest fairways", is narrower;
#   the long par 5s a little wider);
# - its edges wavering a little, as a mower's do;
# - curving in round each fairway bunker beside it, so the bunker sits on its edge (one
#   across the middle sits in the fairway).
# Never more than 19 yds either side of the middle, so no tree (all at least 30 yds from
# every line) stands in one. Marked in fairwaysBuilt.
BUILD_FW = CFG['build_fw']
PAR5 = CFG['par5']
def smooth01(x):
    x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)
def knotted(knots, s):
    if s <= knots[0][0]: return knots[0][1]
    for (a, va), (b, vb) in zip(knots, knots[1:]):
        if s <= b: return va + (vb - va) * smooth01((s - a) / (b - a))
    return knots[-1][1]
def outline_pts(poly, step=1.0):
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]; k = max(1, int(dist(a, b) / step))
        out += [(a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k) for j in range(k)]
    return out
def crossings(poly):
    def o(p, q, r): return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    n, c = len(poly), 0
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1: continue
            p, q = poly[j], poly[(j + 1) % n]
            if o(a, b, p) * o(a, b, q) < 0 and o(p, q, a) * o(p, q, b) < 0: c += 1
    return c
built_fw = []; spine_of = {}
for n, W in BUILD_FW.items():
    g = greens[holes[n]['green']]
    cl = smooth_line(holes[n]['line']); L = plen(cl)
    s_front = L
    while s_front > 0 and inpoly(line_at(cl, s_front - 1)[0], g): s_front -= 1
    s0, s_end, s_in = 130, s_front + 6, s_front - 40
    gl, grr = across(g, cl, s_end)
    end_w = (max(5, 0.8 * gl), max(5, 0.8 * grr))
    knots = [(s0, 0.8), (s0 + 50, 0.92), (215, 1), (295, 1)]
    knots += [(365, 0.84), (s_front - 150, 0.96), (s_front - 75, 0.96)] if n in PAR5 else [(s_front - 70, 0.88)]
    kk = []
    for k in knots:
        if k[0] < s_in and (not kk or k[0] > kk[-1][0]): kk.append(k)
    ph = [n * 1.7, n * 2.9 + 1, n * 0.6 + 2, n * 3.7 + 3]
    def half(s, side):
        hw = W / 2 * knotted(kk, s) * (1 + 0.06 * math.sin(2 * math.pi * s / 115 + ph[side]) + 0.035 * math.sin(2 * math.pi * s / 53 + ph[side + 2]))
        if s > s_in: hw += (end_w[side] - hw) * smooth01((s - s_in) / (s_end - s_in))
        if s < s0 + 12: hw *= math.sqrt(max(0, 1 - ((s0 + 12 - s) / 12) ** 2))
        return hw
    ss = list(np.arange(s0, s_end, 2.0)) + [s_end]
    hw = [[half(s, 0) for s in ss], [half(s, 1) for s in ss]]
    # Round each fairway bunker beside it: the edge comes in to 0.8 yds short of the sand and
    # curves back out (2 yds out 10 yds along, 11 yds out 20 yds along).
    for b in bunkers:
        if lined(centroid(b), cl) > 40: continue
        sv = [on_line(v, cl) for v in outline_pts(b)]
        if min(l for _, l in sv) < 0 < max(l for _, l in sv): continue
        side = 1 if sv[0][1] > 0 else 0
        for k, s in enumerate(ss):
            lim = min(abs(l) - 0.8 + max(0, abs(sb - s) - 2) ** 2 / 30 for sb, l in sv)
            hw[side][k] = min(hw[side][k], max(6, lim))
    left, right = [], []
    for k, s in enumerate(ss):
        (x, z), hd = line_at(cl, s); rx, rz = math.cos(hd), -math.sin(hd)
        wl, wr = min(19, hw[0][k]), min(19, hw[1][k])
        left.append((x - rx * wl, z - rz * wl)); right.append((x + rx * wr, z + rz * wr))
    fw = simplify(left + right[::-1][1:], 0.2, closed=True)
    assert crossings(fw) == 0, f'the {n} fairway crosses itself'
    assert all(inpoly(p, boundary) for p in fw), f'the {n} fairway runs out of the course'
    assert not any(inpoly((t[0], t[1]), fw) for t in trees), f'a tree stands in the {n} fairway'
    built_fw.append(len(fairways)); fairways.append(fw); spine_of[len(fairways) - 1] = (cl, s0 - 10, s_end + 10)
    report.append(f"{n}: fairway built from {s0} to {round(s_end)} yds along the line (the green's front at {round(s_front)}), {W} yds wide")
# Each fairway's spine: the line its mowing stripes run square to. A fairway built above
# follows its own middle; one that a line of play (Harding's or the Fleming nine's) runs
# down follows that line, its corners rounded, so a dogleg's stripes turn with it; any
# other runs along the long axis of its shape.
def spine_pts(cl, a, b, step=6):
    L = plen(cl); k = max(2, int(math.ceil((b - a) / step))); out = []
    for j in range(k + 1):
        s = a + (b - a) * j / k
        if 0 <= s <= L: out.append(line_at(cl, s)[0]); continue
        (x, z), hd = line_at(cl, 0 if s < 0 else L); d = s if s < 0 else s - L
        out.append((x + math.sin(hd) * d, z + math.cos(hd) * d))
    return out
cand = [(str(n), holes[n]['line']) for n in range(1, 19)] + [('F' + str(i), l) for i, l in enumerate(flines)]
smoothed, spines, spine_by = {}, [], []
for i, f in enumerate(fairways):
    if i in spine_of:
        cl, a, b = spine_of[i]; spines.append(spine_pts(cl, a, b)); spine_by.append('own'); continue
    fb = bbox(f); best = None
    for key, ln in cand:
        lb = bbox(ln)
        if lb[0] > fb[2] or lb[2] < fb[0] or lb[1] > fb[3] or lb[3] < fb[1]: continue
        inside = 2 * sum(1 for k in range(0, int(plen(ln)), 2) if inpoly(line_at(ln, k)[0], f))
        if inside >= 15 and (best is None or inside > best[0]): best = (inside, key, ln)
    if best:
        cl = smoothed.setdefault(best[1], smooth_line(best[2])); L = plen(cl)
        (x0, z0), h0 = line_at(cl, 0); (x1, z1), h1 = line_at(cl, L); lo, hi = 1e9, -1e9
        for v in f:
            s, _ = on_line(v, cl)
            if s <= 0: s = (v[0] - x0) * math.sin(h0) + (v[1] - z0) * math.cos(h0)
            elif s >= L: s = L + (v[0] - x1) * math.sin(h1) + (v[1] - z1) * math.cos(h1)
            lo, hi = min(lo, s), max(hi, s)
        spines.append(spine_pts(cl, lo - 10, hi + 10)); spine_by.append(best[1])
    else:
        P = np.array(f); m = P.mean(axis=0); v = np.linalg.svd(P - m)[2][0]; pr = (P - m) @ v
        spines.append([tuple(m + v * (pr.min() - 10)), tuple(m + v * (pr.max() + 10))]); spine_by.append('axis')
report.append('stripes: ' + ', '.join(f'f{i}>{k}' for i, k in enumerate(spine_by)))
for kind, lst in [('fairway', fairways), ('green', greens), ('tee', tees), ('bunker', bunkers)]:
    for i, poly in enumerate(lst):
        assert crossings(poly) == 0, f'{kind} {i} crosses itself'
def r1(poly): return [[round(x, 1), round(z, 1)] for x, z in poly]
data = {
    'source': f"OpenStreetMap (© OpenStreetMap contributors, ODbL): course boundary way {CFG['way']} and its golf=* features",
    'origin': {'lat': lat0, 'lon': lon0},
    'boundary': r1(boundary),
    'lakeFrom': LK['from'], 'lakeTo': LK['to'],
    'lake': r1(lake),
    'holes': {str(n): {'line': r1(holes[n]['line']), 'green': holes[n]['green'], 'tees': holes[n]['tees'],
                       **({'built': True} if holes[n].get('built') else {})} for n in range(1, 19)},
    'greens': [r1(g) for g in greens], 'fairways': [r1(f) for f in fairways], 'fairwaySpine': [r1(sp) for sp in spines], 'fairwaysBuilt': built_fw, 'greensBuilt': built_greens,
    'bunkers': [r1(b) for b in bunkers], 'tees': [r1(t) for t in tees], 'ranges': [r1(r) for r in ranges], 'woods': [r1(w) for w in woods],
    **({'ponds': [r1(w) for w in ponds]} if ponds else {}),
    'paths': [r1(p) for p in paths], 'trees': trees, **({'treeKind': TR['kind']} if TR['kind'] != 'cypress' else {}),
}
# What each course's file says it holds, and what was built by hand where OSM has a gap.
NOTES = {
    'harding-park': """// TPC Harding Park: the course boundary (OpenStreetMap way 16753068) and the golf
// features inside it (the line of play of each hole, greens, fairways, tee boxes,
// bunkers, practice ground, woods and cart paths), in yards east (x) and north (z) of
// the middle of the course. Map data © OpenStreetMap contributors, available under the
// Open Database License: https://www.openstreetmap.org/copyright
//
// Built by hand from OSM where it has a gap (each one is marked in the data):
// - Hole 18 has no line of play in OSM: it runs from its back tee box (the championship
//   tee, 466 yds), across the inlet of Lake Merced, then up the middle of its fairway to
//   its green: a long, gentle dogleg left. Its Blue and White tees stand on the boxes beside.
// - OSM's line of play for the 16th runs down the right edge of its fairway, so it follows
//   the middle of the fairway instead.
// - The 9th green isn't mapped: one is built round the end of its line, between its front
//   bunkers, as big as the course's mapped greens (greensBuilt lists it).
// - Lake Merced lies beyond the boundary from the south tip round the west end to the
//   18th green (lakeFrom → lakeTo, boundary vertices); its far side is drawn 450 yds out.
//   The rest of the boundary is the property line: out of bounds.
// - The trees are placed in the ground between the holes (OSM doesn't map them one by one).
// - Holes 2, 4, 5, 7, 9, 13 and 15 have no fairway in OSM: each has one built down its
//   line of play, shaped like the course's mapped ones (fairwaysBuilt lists them).
// - Hole 13: OSM's straight line runs over the fairway bunker in the landing area; the
//   2020 PGA Championship guides put that bunker down the right, so the line passes 6 yds
//   left of it and the fairway built along it has the bunker on its right edge.
// - Each set of tees stands on the real tee box closest to its scorecard yardage.
// - A few spikes in OSM's outlines (slips of the mapper's mouse) are taken out, among them
//   a notch cut deep into the 6th green.
// - fairwaySpine: for each fairway, the line its mowing stripes run square to: its hole's
//   line of play, corners rounded, so a dogleg's stripes turn with it.

""",
    'edgewood-tahoe': """// Edgewood Tahoe: the course boundary (OpenStreetMap way 63521167) and the golf
// features inside it (the line of play of each hole, greens, fairways, tee boxes,
// bunkers, ponds, woods and cart paths), in yards east (x) and north (z) of the middle of
// the course. Map data © OpenStreetMap contributors, available under the Open Database
// License: https://www.openstreetmap.org/copyright
//
// Built by hand from OSM where it has a gap (each one is marked in the data):
// - Lake Tahoe lies beyond the boundary down the west side, by the 16th green, the 17th
//   and the 18th (lakeFrom → lakeTo, boundary vertices), where the USGS heights are the
//   lake's surface; its far side is drawn 2,500 yds out. The rest of the boundary is the
//   property line: out of bounds.
// - The ponds and Edgewood Creek are OSM's water: penalty areas.
// - The trees are placed in the ground between the holes (OSM doesn't map them one by one):
//   tall pines (treeKind).
// - Holes 4 and 14 have no fairway in OSM: each has one built down its line of play, shaped
//   like the course's mapped ones (fairwaysBuilt lists them).
// - Each set of tees stands on the real tee box closest to its scorecard yardage.
// - A few spikes in OSM's outlines (slips of the mapper's mouse) are taken out.
// - fairwaySpine: for each fairway, the line its mowing stripes run square to: its hole's
//   line of play, corners rounded, so a dogleg's stripes turn with it.
""",
}
def wrap(part, body, notes):
    return (f"// GolfCourseData['{CID}'].{part}: {CFG['name']} for the Game tab, loaded when a round on it\n"
            "// starts (js/courses.js). No dependencies; the node tests load it too. Built by\n"
            "// scripts/build-course-map.py: don't edit it by hand.\n//\n" + notes +
            "(function (root, id, part, data) {\n"
            "  if (typeof module === 'object' && module.exports) module.exports = data;\n"
            "  else { var all = root.GolfCourseData = root.GolfCourseData || {}; (all[id] = all[id] || {})[part] = data; }\n"
            f"}})(typeof self !== 'undefined' ? self : this, '{CID}', '{part}', " + body + ");\n")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
js = wrap('map', json.dumps(data, separators=(',', ':')), NOTES[CID])
open(OUT, 'w').write(js)
if args.tiles:
    from PIL import Image
    import glob
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
    STEPE, UNIT, BASE = 6, 0.1, CFG['elev_base']              # yds between heights; 0.1 ft steps up from the base
    ex0, ez0 = math.floor(min(xs) - 30), math.floor(min(zs) - 30)
    nx = int(math.ceil((max(xs) + 30 - ex0) / STEPE)) + 1; nz = int(math.ceil((max(zs) + 30 - ez0) / STEPE)) + 1
    # The lake's surface: the shore's height (Harding: the tiles have Lake Merced's bed in
    # places), or the lowest ground in it (Edgewood: past a beach, the water is level).
    if LK['level'] == 'shore': lake_level = round(min(metres(*boundary[i]) for i in lake_idx) * 3.28084, 1)
    else:
        inlake = [(ex0 + i * STEPE, ez0 + j * STEPE) for j in range(nz) for i in range(nx)]
        lake_level = round(min(metres(x, z) for x, z in inlake if inpoly((x, z), lake) and not inpoly((x, z), boundary)) * 3.28084, 1)
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
            q = int(round((ft - BASE) / UNIT))
            assert 0 <= q <= 4095, f'{round(ft)} ft is outside what the file can hold ({BASE} to {BASE + 409.5} ft): change elev_base'
            if prev is None: out.append(two(q))
            else:
                dq = q - prev
                out.append(B64[dq + 31] if -31 <= dq <= 31 else B64[63] + two(q))
            prev = q
        rows.append(''.join(out))
    elev = {'source': "USGS 3D Elevation Program (3DEP), via AWS Terrain Tiles (zoom 15)", 'unit': 'ft above sea level (NAVD88)',
            'x0': ex0, 'z0': ez0, 'step': STEPE, 'nx': nx, 'nz': nz, 'q': UNIT, 'base': BASE, 'lake': lake_level, 'rows': rows}
    enotes = f"""// The ground's height every 6 yds over the course, in feet above sea level, from the USGS
// 3D Elevation Program (3DEP, public domain) by way of the AWS Terrain Tiles (zoom 15, about
// 4 m a pixel). In the course map's yards (x east, z north of its middle): heights start at
// (x0, z0) and run east along each row, rows going north. The lake is held at its surface.
//
// Each row is a string: its first height in two characters, then each next one as the
// change from the one before (one character, -3.1 to +3.1 ft in 0.1 ft steps), or, for a
// bigger change, '/' and the height in two characters. A height in two characters is
// (feet - base) / q in base 64 (A-Z a-z 0-9 + /).
"""
    ejs = wrap('elev', json.dumps(elev, separators=(',', ':')), enotes)
    open(ELEV_OUT, 'w').write(ejs)
    print('elevation', nx, 'x', nz, 'every', STEPE, 'yds;', round(ft_min, 1), 'to', round(ft_max, 1), 'ft; lake', lake_level, 'ft;', len(ejs), 'bytes')
print('\n'.join(report))
print('trees', len(trees), 'file', len(js), 'bytes', 'lake pts', len(lake))
