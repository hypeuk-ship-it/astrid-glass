"""Polly eye -> three rig layers (WHITE sclera, PUPIL incl. motif+highlights, BLACK outline/core) by colour.

Colour thresholds (8-bit sRGB; lum = .299R+.587G+.114B, sat = max-min):
  FRAME   rows/cols >= 80% green (G>100,R<60,B<60) or black (max<40)        -> crop-frame strip, ignored
  BLACK   max(R,G,B) <= 70 and sat <= 30                                     near-black ink (+ dark AA half)
  WHITE   lum >= 150 and sat <= 50                                           sclera white + lavender wash
  PUPIL   sat > 50 and max > 90, minus blush wash (R>G+35, |G-B|<20, sat<90, lum>90)
          + violet ink (B>G+22, sat>=28, 95<=lum<155, >2.5 px from BLACK) for cheerful's lavender ring
          + white islands whose outer ring is >= 50% pupil-coloured (highlights / catchlights, sub-mask 'hl')
          + white inside the convex hull of each pupil blob, for the oval/heart pupils whose catchlight
            breaks the rim (HL_HULL: confident, bored, angry, smug, love) -> 'hl' sub-mask
Eye footprint F (per side; image split by distance to the two largest sclera blobs): fill_holes(closing_r2(sclera seed + black comps touching it
(<=4 px) + lash comps (<=10 px, not above the eye) + pupil comps touching the sclera (<=3 px)).
Inside F every pixel gets exactly one layer: the raw class, or (unclassified anti-aliased / grey pixels)
the class of the nearest classified pixel (Euclidean distance transform). BLACK splits into OUTLINE
(components whose 1-px outer ring is > 15% outside F) and CORE (mostly enclosed by F: pupil dots, spirals).
BODY (clip mask the pupil lives in) = F minus OUTLINE.
"""
import numpy as np, json, os, sys
from PIL import Image
from scipy import ndimage as ndi

T = dict(black_max=70, black_sat=30, white_lum=150, white_sat=50, pupil_sat=50, pupil_max=90,
         touch_black=4, touch_lash=10, touch_pupil=3, hl_ring=0.5, core_out=0.15)
WHITE, PUPIL, BLACK_O, BLACK_C, BG = 1, 2, 3, 4, 0
HL_HULL = {'confident', 'bored', 'angry', 'smug', 'love'}
K8 = np.ones((3, 3), bool)
DISK2 = np.array([[0,1,1,1,0],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[0,1,1,1,0]], bool)
yy, xx = np.mgrid[-3:4, -3:4]; DISK3 = (yy * yy + xx * xx) <= 10
def _fill(x): return ndi.binary_fill_holes(x | ndi.binary_closing(x, DISK2))

def frame_mask(rgb):
  r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
  fr = ((g > 100) & (r < 60) & (b < 60)) | (rgb.max(2) < 40)
  m = np.zeros(fr.shape, bool)
  m[fr.mean(1) >= .8, :] = True
  m[:, fr.mean(0) >= .8] = True
  return m & fr

def raw(rgb):
  rgb = rgb.astype(np.int32)
  lum = rgb @ np.array([.299, .587, .114]); mx = rgb.max(2); mn = rgb.min(2); sat = mx - mn
  r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
  fr = frame_mask(rgb)
  black = (mx <= T['black_max']) & (sat <= T['black_sat']) & ~fr
  white = (lum >= T['white_lum']) & (sat <= T['white_sat']) & ~fr
  blushw = (r > g + 35) & (np.abs(g - b) < 20) & (sat < 90) & (lum > 90)
  colour = (sat > T['pupil_sat']) & (mx > T['pupil_max']) & ~blushw & ~fr
  # violet ink: darker lavender (cheerful's ring pupil), away from black outlines (excludes wash->ink AA)
  violet = (b > g + 22) & (sat >= 28) & (lum >= 95) & (lum < 155) & ~fr
  violet &= ndi.distance_transform_edt(~black) > 2.5 if black.any() else violet
  return black, white, colour | violet

def _hull_mask(m):
  from scipy.spatial import ConvexHull
  from PIL import ImageDraw
  ys, xs = np.nonzero(m)
  pts = np.c_[xs, ys].astype(float)
  pts = np.concatenate([pts + [dx, dy] for dx in (-.5, .5) for dy in (-.5, .5)])
  try: hv = pts[ConvexHull(pts).vertices]
  except Exception: return m.copy()
  im = Image.new('L', (m.shape[1], m.shape[0]), 0)
  ImageDraw.Draw(im).polygon([(x - .5 + .5, y - .5 + .5) for x, y in hv], fill=1)
  return np.asarray(im).astype(bool) | m

def _dist_to(mask):
  return ndi.distance_transform_edt(~mask) if mask.any() else np.full(mask.shape, 1e9)

def classify(rgb, hl_hull=False):
  """rgb HxWx3 uint8 -> list of per-side dicts {cls (HxW int8), hl (bool)} for the L (x<mid) and R halves."""
  H, W = rgb.shape[:2]; mid = W // 2
  black, white, colour = raw(rgb)
  # side split: two largest sclera components (by centroid x) -> Voronoi by distance; fallback midline
  wl0, n0 = ndi.label(white, K8)
  halves = None
  if n0 >= 2:
    sz = ndi.sum(np.ones_like(wl0), wl0, range(1, n0 + 1)); order = np.argsort(sz)[::-1][:2] + 1
    a, b = (wl0 == order[0]), (wl0 == order[1])
    if np.nonzero(a)[1].mean() > np.nonzero(b)[1].mean(): a, b = b, a
    if b.sum() > .3 * a.sum() and a.sum() > .3 * b.sum():
      da, db = _dist_to(a), _dist_to(b); halves = [da <= db, da > db]
  if halves is None:
    halves = [np.zeros((H, W), bool), np.zeros((H, W), bool)]; halves[0][:, :mid] = True; halves[1][:, mid:] = True
  out = []
  for side in (0, 1):
    half = halves[side]
    wl, n = ndi.label(white & half, K8)
    if n == 0: out.append(None); continue
    sizes = ndi.sum(np.ones_like(wl), wl, range(1, n + 1))
    seed = wl == (1 + int(np.argmax(sizes)))
    ys, xs = np.nonzero(seed); top = ys.min(); hgt = ys.max() - ys.min() + 1
    bl, nb = ndi.label(black & half, K8)
    cl, nc = ndi.label(colour & half, K8)
    wall = white & half
    sclera = seed; keepb = np.zeros((H, W), bool); keepc = np.zeros((H, W), bool)
    for _ in range(4):   # grow: inks touching the sclera, then white islands they enclose (spiral corridors)
      dsc = _dist_to(sclera)
      for i in range(1, nb + 1):
        c = bl == i
        if not (c & keepb).any() and dsc[c].min() <= T['touch_black']: keepb |= c
      for i in range(1, nc + 1):
        c = cl == i
        if not (c & keepc).any() and c.sum() >= 12 and dsc[c].min() <= T['touch_pupil']: keepc |= c
      F = _fill(sclera | keepb | keepc)
      ns = sclera | (wall & F)
      if (ns == sclera).all(): break
      sclera = ns
    core = sclera | keepb | keepc
    # lashes: separate black strokes close to the eye, not above it (brows are above)
    dcore = _dist_to(core)
    for i in range(1, nb + 1):
      c = bl == i
      if (c & keepb).any(): continue
      cy = np.nonzero(c)[0].mean()
      if dcore[c].min() <= T['touch_lash'] and cy > top + .25 * hgt: keepb |= c
    F = _fill(sclera | keepb | keepc)
    # raw classes inside F
    cls = np.zeros((H, W), np.int8)
    rb, rw, rc = black & F, white & F, keepc & F
    rw &= ~rb; rc &= ~rb & ~rw
    cls[rw] = WHITE; cls[rc] = PUPIL; cls[rb] = BLACK_O
    # highlights: white islands mostly ringed by pupil colour
    hl = np.zeros((H, W), bool)
    il, ni = ndi.label(rw, K8)
    for i in range(1, ni + 1):
      c = il == i
      if c.sum() > 400: continue
      ring = ndi.binary_dilation(c, K8) & ~c
      if ring.sum() == 0: continue
      # pupil incl. its AA (unclassified neighbours adjacent to pupil count as pupil)
      pr = (cls[ring] == PUPIL).sum(); un = (cls[ring] == BG).sum()
      if (pr + .5 * un) / ring.sum() >= T['hl_ring'] and pr > 0: hl |= c
    # catchlights that break the pupil rim (open bites): white inside the convex hull of each pupil
    # component, only for the oval/heart pupils listed in HL_HULL (a star/flower/ring hull would eat sclera)
    if hl_hull:
      pl, npl = ndi.label(cls == PUPIL, K8)
      for i in range(1, npl + 1):
        c = pl == i
        if c.sum() < 30: continue
        hull = _hull_mask(c)
        hl |= hull & rw & ~c
    cls[hl] = PUPIL
    # unclassified pixels inside F -> nearest classified pixel
    un = F & (cls == BG)
    if un.any():
      known = F & (cls != BG)
      _, (iy, ix) = ndi.distance_transform_edt(~known, return_indices=True)
      cls[un] = cls[iy[un], ix[un]]
    # black split: outline (touches outside F) vs core (enclosed)
    kl, nk = ndi.label(cls == BLACK_O, K8)
    outside = ~F
    for i in range(1, nk + 1):
      c = kl == i
      ring = ndi.binary_dilation(c, K8) & ~c
      if (ring & outside).sum() <= T['core_out'] * ring.sum(): cls[c] = BLACK_C
    out.append(dict(cls=cls, hl=hl, F=F))
  return out

def layer_masks(c):
  cls = c['cls']
  return dict(white=cls == WHITE, pupil=cls == PUPIL, black=(cls == BLACK_O) | (cls == BLACK_C),
              outline=cls == BLACK_O, core=cls == BLACK_C, body=(cls == WHITE) | (cls == PUPIL) | (cls == BLACK_C))
