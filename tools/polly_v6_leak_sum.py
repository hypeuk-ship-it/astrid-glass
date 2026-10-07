"""Summarise /tmp/p6/leak (tools/polly_v6_leak.py frames, ?nodeco).
 hole*  = background-like px inside the eroded sclera hull that are NOT within 3 px of ink (her pupil dots / spiral strokes
          carry grey anti-aliasing that the v5.2 classifier calls background) -> a real hole shows the skin through the white
 leak   = pupil-hue px outside the sclera hull + 3 px (tools/polly_live_leak.py); 'over rest' = minus the k=0 (rest gaze) frame,
          whose overhang is her own drawing (pupils overlap the nasal / lower corner on the sheet)
 shut   = every >= .97-shut frame: sclera px (white / lavender) and pupil-hue px (must be ~0: only lash art)"""
import sys, os, glob, json, re
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import convex_hull_image
from polly_live_leak import analyse, classify, PAL
D = sys.argv[1] if len(sys.argv) > 1 else '/tmp/p6/leak'
def holes(path, emo):
  a = np.asarray(Image.open(path).convert('RGB'))
  w, lav, ink, pup, bg = classify(a, PAL.get(emo)); scl = w | lav
  near = ndi.binary_dilation(ink | (a.max(-1) < 90), iterations=3)
  lab, n = ndi.label(ndi.binary_dilation(scl, iterations=3)); tot = 0; xy = []
  for i in range(1, n + 1):
    blob = lab == i
    if (scl & blob).sum() < 400: continue
    He = ndi.binary_erosion(convex_hull_image(scl & blob), iterations=4)
    hb = ndi.binary_opening(bg & He & ~near, np.ones((3, 3), bool)); hl, hn = ndi.label(hb)
    for j in range(1, hn + 1):
      m = hl == j; c = int(m.sum())
      if c >= 12: tot += c; ys, xs = np.nonzero(m); xy.append((int(xs.mean()), int(ys.mean()), c))
  return tot, xy
out = {}; emos = sorted({re.match(r'(dart|shut)-(\w+)-', os.path.basename(f)).group(2) for f in glob.glob(f'{D}/*.png')})
for e in emos:
  dart = sorted(glob.glob(f'{D}/dart-{e}-*.png')); shut = sorted(glob.glob(f'{D}/shut-{e}-*.png'))
  lk = {int(f.rsplit('-', 1)[1][:-4]): analyse(f, 0, e)['leak'] for f in dart}
  hs = {int(f.rsplit('-', 1)[1][:-4]): holes(f, e) for f in dart}
  sh = []
  for f in shut:
    w, lav, ink, pup, bg = classify(np.asarray(Image.open(f).convert('RGB')), PAL.get(e))
    sh.append((int((w | lav).sum()), int(pup.sum()) if PAL.get(e) is not None else 0))
  r0 = lk.get(0, 0)
  out[e] = dict(frames=len(dart), rest_leak=r0, max_leak_over_rest=max([v - r0 for v in lk.values()] or [0]), holes=sum(h[0] for h in hs.values()),
                hole_xy=[(k, h[1][:2]) for k, h in hs.items() if h[0]], shut_frames=len(sh), shut_max_sclera=max([s[0] for s in sh] or [0]), shut_max_pupil=max([s[1] for s in sh] or [0]))
  print(e, out[e], flush=True)
json.dump(out, open(f'{D}/summary.json', 'w'), indent=1)
