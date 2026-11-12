#!/usr/bin/env python3
"""Pull frames out of a swing video for a swing review (needs ffmpeg and Pillow).

  python3 scripts/swing-frames.py probe VIDEO
      Length, frame rate and size.
  python3 scripts/swing-frames.py sheet VIDEO --out sheet.jpg [--every 0.1] [--start S] [--end S]
      A contact sheet: small frames with their times, for picking setup, top, impact and finish.
  python3 scripts/swing-frames.py extract VIDEO --out media/dad/REVIEW-ID --at 0.40:address,1.12:top,1.36:impact,2.10:finish
          [--width 720] [--blur X,Y,W,H] [--blur 2:X,Y,W,H]
      Saves 1-address.jpg, 2-top.jpg, ... and prints the "frames" JSON to paste into the review.
      --blur hides a box (in output pixels) on every frame, or only frame N with N:X,Y,W,H (faces).
  python3 scripts/swing-frames.py grid FRAME.jpg --out grid.png [--step 40]
      The frame with a labelled pixel grid, for reading the x, y of the marks.

The video itself is never committed: only the small frames under media/ (the repo is public).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit('command failed: ' + ' '.join(cmd) + '\n' + p.stderr[-1500:])
    return p.stdout


def probe(video):
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
               'stream=width,height,avg_frame_rate,r_frame_rate,nb_frames:stream_side_data=rotation:format=duration',
               '-of', 'json', video])
    d = json.loads(out)
    st = (d.get('streams') or [{}])[0]
    num, _, den = (st.get('avg_frame_rate') or st.get('r_frame_rate') or '0/1').partition('/')
    fps = float(num) / float(den or 1) if float(den or 1) else 0
    rot = 0
    for sd in st.get('side_data_list', []) or []:
        if 'rotation' in sd:
            rot = int(sd['rotation'])
    w, h = st.get('width'), st.get('height')
    if rot in (90, -90, 270, -270):
        w, h = h, w
    return {'duration_s': round(float((d.get('format') or {}).get('duration') or 0), 3), 'fps': round(fps, 2), 'width': w, 'height': h, 'rotation': rot}


def font(size):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def grab(video, t, path, width=None):
    vf = ['-vf', 'scale=%d:-2' % width] if width else []
    run(['ffmpeg', '-v', 'error', '-y', '-ss', '%.3f' % t, '-i', video, '-frames:v', '1'] + vf + ['-q:v', '2', path])


def cmd_sheet(a):
    info = probe(a.video)
    end = a.end if a.end is not None else info['duration_s']
    times, t = [], a.start
    while t <= end + 1e-9 and len(times) < 120:
        times.append(round(t, 3))
        t += a.every
    tmp = tempfile.mkdtemp()
    try:
        thumbs = []
        for i, t in enumerate(times):
            p = os.path.join(tmp, '%03d.jpg' % i)
            grab(a.video, t, p, 240)
            if os.path.exists(p):
                thumbs.append((t, Image.open(p).convert('RGB')))
        if not thumbs:
            sys.exit('no frames read')
        tw, th = thumbs[0][1].size
        cols = a.cols
        rows = (len(thumbs) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * tw, rows * (th + 26)), 'white')
        d, f = ImageDraw.Draw(sheet), font(18)
        for i, (t, im) in enumerate(thumbs):
            x, y = (i % cols) * tw, (i // cols) * (th + 26)
            sheet.paste(im, (x, y + 26))
            d.text((x + 6, y + 3), '%.2f s' % t, fill='black', font=f)
        sheet.save(a.out, quality=85)
        print('wrote %s: %d frames, %.2f to %.2f s (video %.2f s at %s fps)' % (a.out, len(thumbs), times[0], times[-1], info['duration_s'], info['fps']))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def parse_box(s):
    n, _, box = s.rpartition(':')
    x, y, w, h = [int(float(v)) for v in box.split(',')]
    return (int(n) if n else None, (x, y, x + w, y + h))


def cmd_extract(a):
    info = probe(a.video)
    shots = []
    for i, part in enumerate(a.at.split(',')):
        t, _, label = part.partition(':')
        shots.append((float(t), (label or 'frame-%d' % (i + 1)).strip()))
    blurs = [parse_box(b) for b in (a.blur or [])]
    os.makedirs(a.out, exist_ok=True)
    frames = []
    for i, (t, label) in enumerate(shots, 1):
        slug = ''.join(c if c.isalnum() else '-' for c in label.lower()).strip('-') or 'frame'
        path = os.path.join(a.out, '%d-%s.jpg' % (i, slug))
        grab(a.video, t, path, a.width)
        im = Image.open(path).convert('RGB')
        for n, box in blurs:
            if n is None or n == i:
                region = im.crop(box)
                small = region.resize((max(1, region.width // 12), max(1, region.height // 12)))
                im.paste(small.resize(region.size, Image.NEAREST).filter(ImageFilter.GaussianBlur(6)), box[:2])
        im.save(path, quality=82, optimize=True, progressive=True)
        rel = os.path.relpath(path, ROOT) if os.path.abspath(path).startswith(ROOT + os.sep) else path
        frames.append({'src': rel.replace(os.sep, '/'), 'w': im.width, 'h': im.height, 'time_s': round(t, 2),
                       'label': label[:1].upper() + label[1:], 'marks': [], 'notes': []})
    print(json.dumps({'video': {'duration_s': info['duration_s'], 'fps': info['fps']}, 'frames': frames}, indent=2))


def cmd_grid(a):
    im = Image.open(a.frame).convert('RGB')
    d, f = ImageDraw.Draw(im), font(max(12, im.width // 50))
    for x in range(0, im.width, a.step):
        d.line([(x, 0), (x, im.height)], fill=(255, 255, 255) if x % (a.step * 5) else (255, 220, 0), width=1)
        if x % (a.step * 2) == 0:
            d.text((x + 2, 2), str(x), fill=(255, 220, 0), font=f, stroke_width=2, stroke_fill='black')
    for y in range(0, im.height, a.step):
        d.line([(0, y), (im.width, y)], fill=(255, 255, 255) if y % (a.step * 5) else (255, 220, 0), width=1)
        if y % (a.step * 2) == 0:
            d.text((2, y + 2), str(y), fill=(255, 220, 0), font=f, stroke_width=2, stroke_fill='black')
    im.save(a.out)
    print('wrote %s (%dx%d, grid every %d px)' % (a.out, im.width, im.height, a.step))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('probe'); p.add_argument('video')
    p = sub.add_parser('sheet'); p.add_argument('video'); p.add_argument('--out', required=True)
    p.add_argument('--every', type=float, default=0.1); p.add_argument('--start', type=float, default=0.0)
    p.add_argument('--end', type=float); p.add_argument('--cols', type=int, default=6)
    p = sub.add_parser('extract'); p.add_argument('video'); p.add_argument('--out', required=True)
    p.add_argument('--at', required=True); p.add_argument('--width', type=int, default=720); p.add_argument('--blur', action='append')
    p = sub.add_parser('grid'); p.add_argument('frame'); p.add_argument('--out', required=True); p.add_argument('--step', type=int, default=40)
    a = ap.parse_args()
    if a.cmd == 'probe':
        print(json.dumps(probe(a.video), indent=2))
    else:
        {'sheet': cmd_sheet, 'extract': cmd_extract, 'grid': cmd_grid}[a.cmd](a)


if __name__ == '__main__':
    main()
