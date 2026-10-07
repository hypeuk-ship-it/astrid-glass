"""v5.2 leak + hole gate measured on RENDERED live-glass frames (not shader debug codes).
Per frame, per eye blob (white / lavender sclera pixels, dilated): H = convex hull of the sclera pixels.
  leak px = pupil-coloured (saturated, non-sclera) pixels of any saturated component touching the eye, lying > TOL px
            outside H dilated by TOL (TOL covers the outline AA + the reduced glass split)
  hole px = background-like pixels (grey / dark, low saturation, not ink, not sclera, not pupil) inside H eroded by 4 px,
            in components that survive a 3x3 opening and have >= 12 px (drops AA rings around ink cores)
   python3 tools/polly_live_leak.py <png files or dirs...> [--json out.json] [--crop y0]"""
import sys, os, json, glob
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import convex_hull_image
TOL = 3
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import colorsys
def _palette():
  j = json.load(open(os.path.join(ROOT, 'polly-layer-atlas.json')))
  A = np.asarray(Image.open(os.path.join(ROOT, 'polly-layer-atlas.png')).convert('RGBA'))
  cw, ch, nc = j['cw'], j['ch'], j['ncell']; P = {}
  for e in j['ids']:
    r = j['emotes'][e]['row']; px = []
    for s_ in (0, 1):
      c = A[r * ch:(r + 1) * ch, (s_ * nc + 1) * cw:(s_ * nc + 2) * cw]; px.append(c[c[..., 3] >= 128][:, :3])
    px = np.concatenate(px)
    if len(px) < 20: P[e] = None; continue
    hsv = np.array([colorsys.rgb_to_hsv(*(q / 255.0)) for q in px[::max(1, len(px) // 400)]])
    hsv = hsv[hsv[:, 1] > .25]
    P[e] = None if len(hsv) < 10 else float(np.degrees(np.angle(np.exp(1j * 2 * np.pi * hsv[:, 0]).mean())) % 360)
  return P
PAL = _palette()

def classify(a, hue=None):
  a = a.astype(np.float32); r, g, b = a[..., 0], a[..., 1], a[..., 2]
  mx, mn = a.max(-1), a.min(-1); sat = (mx - mn) / np.maximum(mx, 1)
  white = mn > 212
  lav = (r > 170) & (r < 222) & (g > 150) & (g < 205) & (b > 190) & (b < 240) & (b > g + 12) & (r > g + 6)
  ink = mx < 26
  pup = (sat > .28) & (mx > 70) & ~lav & ~white
  if hue is not None:                       # this emotion's pupil hue only (the glass split's orange / blue never counts)
    from skimage.color import rgb2hsv
    h = rgb2hsv(a / 255.0)[..., 0] * 360; dh = np.abs((h - hue + 180) % 360 - 180); pup &= dh < 28
  bg = ~white & ~lav & ~ink & ~pup & (sat < .2) & (mx < 150)
  return white, lav, ink, pup, bg

def analyse(path, y0=0, emo=None):
  a = np.asarray(Image.open(path).convert('RGB'))[y0:]
  white, lav, ink, pup, bg = classify(a, PAL.get(emo) if emo else None)
  if emo and PAL.get(emo) is None: pup[:] = False           # no coloured pupil (ink dots / spirals: hidden under ink anyway)
  scl = white | lav
  lab, n = ndi.label(ndi.binary_dilation(scl, iterations=3))
  out = dict(leak=0, hole=0, eyes=0, leak_xy=[], hole_xy=[])
  pupo = ndi.binary_opening(pup, np.ones((3, 3), bool))           # blobs only: the 1-2 px glass split lines drop out
  plab, pn = ndi.label(pupo)
  for i in range(1, n + 1):
    blob = lab == i
    if (scl & blob).sum() < 400: continue
    out['eyes'] += 1
    H = convex_hull_image(scl & blob)
    Hd = ndi.binary_dilation(H, iterations=TOL)
    touch = np.unique(plab[ndi.binary_dilation(H, iterations=1) & pupo]); touch = touch[touch > 0]
    if len(touch):
      lk = np.isin(plab, touch) & ~Hd
      c = int(lk.sum()); out['leak'] += c
      if c: ys, xs = np.nonzero(lk); out['leak_xy'].append([int(xs.mean()), int(ys.mean() + y0), c])
    He = ndi.binary_erosion(H, iterations=4)
    hb = ndi.binary_opening(bg & He, np.ones((3, 3), bool))
    hl, hn = ndi.label(hb)
    for j in range(1, hn + 1):
      m = hl == j; c = int(m.sum())
      if c >= 12:
        out['hole'] += c; ys, xs = np.nonzero(m); out['hole_xy'].append([int(xs.mean()), int(ys.mean() + y0), c])
  return out

if __name__ == '__main__':
  args = sys.argv[1:]; js = None; y0 = 0
  if '--json' in args: k = args.index('--json'); js = args[k + 1]; del args[k:k + 2]
  if '--crop' in args: k = args.index('--crop'); y0 = int(args[k + 1]); del args[k:k + 2]
  files = []
  for a in args: files += sorted(glob.glob(os.path.join(a, '*.png'))) if os.path.isdir(a) else [a]
  res = {}; tl = th = 0; bad = []
  log = {}
  for a in args:
    if os.path.isdir(a):
      for jf in glob.glob(os.path.join(os.path.dirname(a.rstrip('/')), 'polly-*-anim.json')):
        for fr in json.load(open(jf))['frames']: log['f%04d.png' % fr['n']] = fr['cur']
  for f in files:
    bn = os.path.basename(f); emo = log.get(bn) or (bn.split('-')[1] if bn.startswith('dart-') else None)
    r = analyse(f, y0, emo); r['emo'] = emo; res[os.path.basename(f)] = r; tl += r['leak']; th += r['hole']
    if r['leak'] or r['hole']: bad.append((os.path.basename(f), r['leak'], r['hole'], r['leak_xy'][:2], r['hole_xy'][:2]))
  print('frames', len(files), 'leak px', tl, 'hole px', th, 'frames with issues', len(bad))
  for b in bad[:40]: print('  ', b)
  if js: json.dump(dict(total_leak=tl, total_hole=th, frames=res), open(js, 'w'))
