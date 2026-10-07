"""Build Polly 3-layer rig assets from the reference cells.
   python3 tools/build_polly_layers.py
Writes emotes/polly-layers/* (per-eye RGBA layer sprites + masks + meta.json) and the runtime atlas
polly-layer-atlas.png/.json (10 cols x 12 rows; per eye L then R: white-body, pupil, core, highlight, outline).
Every cell is RGBA: RGB = the reference colours (bled 3 texels outward), A = a signed distance field of that layer's
exact mask (a = 0.5 + d / (2 * SDF_R), d in texels, + inside; d = +-0.5 at the first texel centre either side of the
edge, so thresholding at 0.5 at texel centres reproduces the mask bit-exactly)."""
import sys, os, json, numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from polly_layers import classify, layer_masks, T, HL_HULL, WHITE, PUPIL, BLACK_O, BLACK_C
IDS = ['cheerful','confident','bored','angry','sleepy','smug','furious','starry','pleading','love','dizzy','blush']
REF = '/workspace/eye-emotes/refs/cells/polly-{i:02d}-{e}.png'
OUTD = os.path.join(ROOT, 'emotes', 'polly-layers'); os.makedirs(os.path.join(OUTD, 'masks'), exist_ok=True)
PAD = 5
SDF_R = 4.0
NCELL = 6

def sdf8(m):
  """8-bit signed distance field of a binary mask (texels, + inside), see module doc."""
  if not m.any(): return np.zeros(m.shape, np.uint8)
  d = np.where(m, ndi.distance_transform_edt(m) - 0.5, -(ndi.distance_transform_edt(~m) - 0.5))
  return np.clip(np.round((0.5 + d / (2 * SDF_R)) * 255), 0, 255).astype(np.uint8)

def diffuse_fill(col, known, sig=2.0, relax=40):
  """Onion-peel normalised-Gaussian fill of col outside `known`, then Jacobi (Laplace) relaxation of the filled
  region with `known` as the boundary -> smooth continuation of the sclera / lavender-wash colours."""
  col = col.astype(float); fk = known.copy(); res = np.where(known[..., None], col, 0.0)
  while not fk.all():
    den = ndi.gaussian_filter(fk.astype(float), sig)
    num = np.stack([ndi.gaussian_filter(res[..., c] * fk, sig) for c in range(3)], -1)
    new = ~fk & (den > 0.02)
    if not new.any(): new = ~fk & (den > 0)
    if not new.any(): res[~fk] = col[known].mean(0) if known.any() else 240; break
    res[new] = num[new] / den[new][:, None]; fk = fk | new
  unk = ~known; kern = np.array([[0, .25, 0], [.25, 0, .25], [0, .25, 0]])
  for _ in range(relax):
    sm = np.stack([ndi.convolve(res[..., c], kern, mode='nearest') for c in range(3)], -1)
    res[unk] = sm[unk]
  return res


def two_tone_fill(med0, clean, white, zone):
  """Sclera colour under the moving layers. Polly's sclera is two-tone (lavender wash over white, split by a smooth
  curve). A plain diffusion fill smears the split into blotches that show as a ghost when the pupil glances away, so:
  2-means on the clean sclera colours; if both tones are real (dE76 > 6, each >= 12 %), fit the split as a quadratic
  (robust, from the clean A|B contact pixels near the zone), fill each tone from its own clean pixels and join them
  along the fitted curve with a 1 px anti-aliased edge. Falls back to the plain fill otherwise.
  Returns (field HxWx3 float, info dict)."""
  plain = diffuse_fill(med0, clean)
  info = dict(mode='plain')
  if clean.sum() < 60 or not zone.any(): return plain, info
  from skimage.color import rgb2lab
  lab = rgb2lab(med0.clip(0, 255) / 255.0)
  X = lab[clean].astype(np.float32)
  crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, .1)
  _, lbl, ctr = cv2.kmeans(X, 2, None, crit, 4, cv2.KMEANS_PP_CENTERS)
  lbl = lbl[:, 0]; frac = min((lbl == 0).mean(), (lbl == 1).mean()); dE = float(np.linalg.norm(ctr[0] - ctr[1]))
  info.update(dE=round(dE, 2), frac=round(float(frac), 3))
  if dE <= 6 or frac < .12: return plain, info
  K = np.full(clean.shape, -1, np.int8); K[clean] = lbl
  A, B = K == 0, K == 1
  # contact pixels: A within 2.5 px of B (and vice versa), midpoint-ish set
  dB = ndi.distance_transform_edt(~B); dA = ndi.distance_transform_edt(~A)
  cont = (A & (dB <= 2.5)) | (B & (dA <= 2.5))
  zy, zx = np.nonzero(zone); zc = np.array([zx.mean(), zy.mean()]); zr = max(np.ptp(zx), np.ptp(zy)) / 2 + 30
  ys, xs = np.nonzero(cont); near = np.hypot(xs - zc[0], ys - zc[1]) <= zr
  xs, ys = xs[near].astype(float), ys[near].astype(float)
  if len(xs) < 12: info['mode'] = 'plain(no contact)'; return plain, info
  vert = False                              # the wash is a top band: its split runs across the eye, y = f(x)
  u, v = xs, ys
  rng = np.random.default_rng(7); best = None
  for _ in range(400):                      # RANSAC quadratic (outliers: highlight specks, outline-adjacent tone changes)
    idx = rng.choice(len(u), 3, replace=False)
    if np.ptp(u[idx]) < 8: continue
    c = np.polyfit(u[idx], v[idx], 2); inl = np.abs(np.polyval(c, u) - v) <= 1.5
    if best is None or inl.sum() > best.sum(): best = inl
  keep = best if best is not None and best.sum() >= 12 else np.ones(len(u), bool)
  for _ in range(3):
    c = np.polyfit(u[keep], v[keep], 2); r = np.abs(np.polyval(c, u) - v); keep = r <= 1.8
  res = float(np.median(np.abs(np.polyval(c, u[keep]) - v[keep])))
  info.update(fit=[round(float(t), 5) for t in c], res=round(res, 2), n=int(keep.sum()), inl=round(float(keep.mean()), 2))
  if res > 2.0: info['mode'] = 'plain(bad fit)'; return plain, info
  H, W = clean.shape; gy, gx = np.mgrid[0:H, 0:W].astype(float)
  gu, gv = (gy, gx) if vert else (gx, gy)
  slope = np.polyval(np.polyder(c), gu); sd = (gv - np.polyval(c, gu)) / np.sqrt(1 + slope * slope)
  sa = np.sign(np.median(sd[A])) if A.any() else 1.0
  if np.median(sd[B]) * sa > 0: info['mode'] = 'plain(ambiguous)'; return plain, info
  FA = diffuse_fill(med0, A); FB = diffuse_fill(med0, B)
  wA = np.clip(.5 + sa * sd, 0, 1)[..., None]                    # 1 px linear AA ramp across the fitted split
  info['mode'] = 'two-tone'
  return wA * FA + (1 - wA) * FB, info


def bleed(rgb, a):
  """RGB of transparent texels := nearest opaque texel (so LINEAR filtering at the edges keeps the colour)."""
  if not a.any(): return np.zeros_like(rgb)
  d, (iy, ix) = ndi.distance_transform_edt(~a, return_indices=True)
  return np.where((d <= 3)[..., None], rgb[iy, ix], 0).astype(np.uint8)

def centroid(m):
  ys, xs = np.nonzero(m)
  return [float(xs.mean()), float(ys.mean())] if len(xs) else None
def bbox(m):
  ys, xs = np.nonzero(m)
  return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1] if len(xs) else None

def main():
  eyes = {}
  for i, e in enumerate(IDS):
    rgb = np.asarray(Image.open(REF.format(i=i, e=e)).convert('RGB'))
    res = classify(rgb, e in HL_HULL)
    eyes[e] = dict(rgb=rgb, res=res)
  # common cell size
  dims = []
  for e in IDS:
    for r in eyes[e]['res']:
      b = bbox(r['F']); dims.append((b[2] - b[0], b[3] - b[1]))
  CW = max(d[0] for d in dims) + 2 * PAD; CH = max(d[1] for d in dims) + 2 * PAD
  COLS, ROWS = 2 * NCELL, len(IDS)
  atlas = np.zeros((ROWS * CH, COLS * CW, 4), np.uint8)
  meta = dict(thresholds=T, hl_hull=sorted(HL_HULL), ids=IDS, layers=['white', 'pupil', 'black'],
              note='pupil layer = coloured pupil + highlights + CORE blacks (everything that moves with gaze); '
                   'black layer = OUTLINE + CORE (all near-black ink). Coordinates: px in the reference cell '
                   '(x right, y down); sprite px = ref px - bbox[0:2].', eyes={})
  rt = dict(cw=CW, ch=CH, cols=COLS, rows=ROWS, W=COLS * CW, H=ROWS * CH, ids=IDS, ncell=NCELL, sdfR=SDF_R,
            cells=['white', 'pupil', 'core', 'highlight', 'outline', 'fringe'], emotes={})
  ink_px = []
  for row, e in enumerate(IDS):
    rgb = eyes[e]['rgb']; res = eyes[e]['res']
    bodies = [layer_masks(r)['body'] for r in res]
    bbs = [bbox(b) for b in bodies]
    # anchors (ref px): x = own body bbox centre, y = shared mean of the two bbox centres (keeps L/R offsets)
    ay = (sum((b[1] + b[3]) / 2 for b in bbs)) / 2
    anchors = [[(b[0] + b[2]) / 2, ay] for b in bbs]
    maxdim = max(max(b[2] - b[0], b[3] - b[1]) for b in bbs)
    em = dict(row=row, maxdim=int(maxdim), refSize=[int(rgb.shape[1]), int(rgb.shape[0])], eyes={})
    meta['eyes'][e] = {}
    for s, side in enumerate('LR'):
      r = res[s]; M = layer_masks(r); cls = r['cls']
      fb = bbox(r['F']); x0, y0, x1, y1 = fb; w, h = x1 - x0, y1 - y0
      crop = np.s_[y0:y1, x0:x1]
      white, pupil_c, outline, core, body, hl = M['white'][crop], M['pupil'][crop], M['outline'][crop], M['core'][crop], M['body'][crop], r['hl'][crop]
      pupil_l = pupil_c | core; black_l = outline | core
      src = rgb[crop]
      # --- per-eye export sprites (RGBA, footprint bbox) ---
      def rgba(m, rgbsrc=src):
        o = np.zeros((h, w, 4), np.uint8); o[..., :3] = np.where(m[..., None], rgbsrc, 0); o[..., 3] = m * 255; return o
      Image.fromarray(rgba(white)).save(f'{OUTD}/{e}-{side}-white.png')
      Image.fromarray(rgba(pupil_l)).save(f'{OUTD}/{e}-{side}-pupil.png')
      Image.fromarray(rgba(black_l)).save(f'{OUTD}/{e}-{side}-black.png')
      for nm, m in dict(white=white, pupil=pupil_l, black=black_l, pupil_colour=pupil_c, highlight=hl, outline=outline,
                        core=core, body=body).items():
        Image.fromarray((m * 255).astype(np.uint8)).save(f'{OUTD}/masks/{e}-{side}-{nm}.png')
      Image.fromarray(((pupil_c & ~hl) * 255).astype(np.uint8)).save(f'{OUTD}/masks/{e}-{side}-pupil_colour_only.png')
      # --- atlas cells: footprint placed at (ox, oy) inside a CW x CH cell ---
      ox = (CW - w) // 2; oy = (CH - h) // 2
      def cell(m, rgbsrc):
        c = np.zeros((CH, CW, 4), np.uint8); mm = np.zeros((CH, CW), bool); mm[oy:oy + h, ox:ox + w] = m
        cr = np.zeros((CH, CW, 3), np.uint8); cr[oy:oy + h, ox:ox + w] = np.asarray(rgbsrc).clip(0, 255).astype(np.uint8)
        c[..., :3] = bleed(cr, mm); c[..., 3] = sdf8(mm); return c
      mov = pupil_c | core
      zone = (ndi.binary_dilation(mov, np.ones((11, 11), bool)) & white) if mov.any() else np.zeros_like(white)
      # clean sclera = white class, >5 px from pupil/core, locally flat (|c - median7| < 12) and on the
      # white..lavender hue line (B >= R-8, B >= G-4: rejects the warm AA tint around the iris)
      sf = src.astype(float)
      med0 = np.stack([ndi.median_filter(sf[..., k], size=7) for k in range(3)], -1)
      far = (ndi.distance_transform_edt(~mov) > 5) if mov.any() else np.ones_like(white)
      clean = (white & far & (np.abs(sf - med0).max(-1) < 12) & (sf[..., 2] >= sf[..., 0] - 8) & (sf[..., 2] >= sf[..., 1] - 4))
      clean = ndi.binary_erosion(clean, np.ones((3, 3), bool))
      if clean.sum() < 30: clean = white & ~zone
      if not clean.any(): clean = white
      Sf, sinfo = two_tone_fill(med0, clean, white, zone)
      S = np.round(Sf).clip(0, 255)                                         # clean sclera colour field (8-bit), two-tone aware
      print(e, side, sinfo, flush=True)
      # WHITE body colours: sclera median-cleaned (7x7: drops the faint sheet watermark / JPEG speckle); under the
      # pupil, the core and their AA zone = the clean field, so a glance reveals plain sclera (no ghost). Every one
      # of these stays WHITE by colour, so the layer classes at rest are the reference's.
      base = np.where(white[..., None], sf, S)
      med = np.stack([ndi.median_filter(base[..., k], size=7) for k in range(3)], -1)
      lum = sf.mean(-1); sat = sf.max(-1) - sf.min(-1)
      plain = white & (lum >= T['white_lum']) & (sat <= T['white_sat']) & (ndi.distance_transform_edt(white) > 2.5) & ~zone
      plain &= (med.mean(-1) >= T['white_lum'] + 4) & ((med.max(-1) - med.min(-1)) <= T['white_sat'] - 4)
      wcol = np.where(plain[..., None], med, sf)                          # median only on plain sclera; AA edges keep theirs
      wcol = np.where((zone | (body & ~white))[..., None], S, wcol)       # under / around the moving layers: clean field
      # FRINGE layer: the pupil's anti-aliasing that the reference baked into the sclera (zone pixels), unmixed against
      # the clean field: c = a*F + (1-a)*S with a from the projection on the nearest pupil/core colour (raised just
      # enough to keep F in 0..255), F = S + (c - S)/a. It moves with the pupil as straight alpha (not an SDF), so at
      # rest the composite reproduces the reference pixel (+-1 level) and a glance leaves no ghost ring and no halo.
      fa = np.zeros(white.shape); fcol = np.zeros_like(sf)
      if mov.any():
        _, (jy, jx) = ndi.distance_transform_edt(~mov, return_indices=True)
        P = sf[jy, jx]; Sq = np.round(S).clip(0, 255); dc = sf - Sq; dPS = P - Sq; den = (dPS * dPS).sum(-1)
        ap = np.where(den > 1, (dc * dPS).sum(-1) / np.maximum(den, 1), 0).clip(0, 1)
        ar = np.where(dc < 0, -dc / np.maximum(Sq, 1), dc / np.maximum(255 - Sq, 1)).max(-1)
        fz = zone & (np.abs(dc).max(-1) > 2)
        a8 = np.ceil(np.maximum(np.maximum(ap, ar), 3 / 255) * 255).clip(1, 255)
        fa = np.where(fz, a8 / 255, 0)
        fcol = np.where(fz[..., None], np.round(Sq + dc / np.maximum(fa, 1 / 255)[..., None]).clip(0, 255), 0)
        S = Sq
      # body coverage reaches 1 texel under the outline (the outline is drawn on top), so the two AA edges never
      # leave a see-through seam between the white and the ink in the live render
      body_s = body | (outline & ndi.binary_dilation(body, np.ones((3, 3), bool)))
      # HIGHLIGHT layer = the highlight pixels + their 1-px anti-aliased halo inside the pupil (lighter than the
      # local pupil colour), so a lagging highlight carries its own edge and leaves no ghost ring behind
      pcol_px = pupil_c & ~hl
      hl_s = hl.copy()
      if hl.any() and pcol_px.any():
        P0 = diffuse_fill(sf, ndi.binary_erosion(pcol_px, np.ones((3, 3), bool)) if ndi.binary_erosion(pcol_px, np.ones((3, 3), bool)).sum() > 20 else pcol_px)
        halo = ndi.binary_dilation(hl, np.ones((3, 3), bool)) & pcol_px & (sf.mean(-1) > P0.mean(-1) + 15)
        hl_s = hl | halo
      # PUPIL layer = coloured pupil (+ under the highlight, + under core ink that touches it), colours inpainted
      # from the clean pupil pixels where something sits on top of it (revealed when the highlight lags)
      pk = pupil_c & ~hl_s
      pup_s = (pupil_c | (core & ndi.binary_dilation(pupil_c, np.ones((5, 5), bool)))) if pupil_c.any() else np.zeros_like(white)
      pcol = sf.copy()
      if pk.any(): pcol = np.where((pup_s & ~pk)[..., None], diffuse_fill(sf, pk), sf)
      def cella(alpha, rgbsrc):
        c = np.zeros((CH, CW, 4), np.uint8); aa = np.zeros((CH, CW)); aa[oy:oy + h, ox:ox + w] = alpha
        cr = np.zeros((CH, CW, 3), np.uint8); cr[oy:oy + h, ox:ox + w] = np.asarray(rgbsrc).clip(0, 255).astype(np.uint8)
        c[..., :3] = bleed(cr, aa > 0); c[..., 3] = np.round(aa * 255).astype(np.uint8); return c
      cells = [cell(body_s, wcol), cell(pup_s, pcol), cell(core, sf), cell(hl_s, sf), cell(outline, sf), cella(fa, fcol)]
      for k, c in enumerate(cells):
        col = s * NCELL + k
        atlas[row * CH:(row + 1) * CH, col * CW:(col + 1) * CW] = c
      Image.fromarray(rgba(hl_s)).save(f'{OUTD}/{e}-{side}-highlight.png')
      ink_px.append(sf[outline | core])
      # --- runtime geometry (cell px) ---
      bm = np.zeros((CH, CW), np.uint8); bm[oy:oy + h, ox:ox + w] = body
      cs, _ = cv2.findContours(bm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
      cmax = max(cs, key=cv2.contourArea)
      poly = cv2.approxPolyDP(cmax, 0.6, True)[:, 0, :].astype(float) + 0.5   # pixel-centre coords
      pm = np.zeros((CH, CW), np.uint8); pm[oy:oy + h, ox:ox + w] = (pupil_c | core)
      hull = []; pc = None; pbb = None
      if pm.any():
        ys, xs = np.nonzero(pm); pts = np.c_[xs, ys].astype(np.float32)
        pts = np.concatenate([pts + [dx, dy] for dx in (0, 1) for dy in (0, 1)]).astype(np.float32)
        hv = cv2.convexHull(pts)[:, 0, :]
        # resample the hull to <= 24 evenly spaced boundary points
        seg = np.r_[hv, hv[:1]]; L = np.r_[0, np.cumsum(np.hypot(*np.diff(seg, axis=0).T))]
        n = 24; tt = np.linspace(0, L[-1], n, endpoint=False)
        hull = [[float(np.interp(t, L, seg[:, 0])), float(np.interp(t, L, seg[:, 1]))] for t in tt]
        pc = [float(xs.mean() + .5), float(ys.mean() + .5)]; pbb = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
      bb = bbox(bm.astype(bool))
      hpm = np.zeros((CH, CW), bool); hpm[oy:oy + h, ox:ox + w] = hl_s
      anc = [anchors[s][0] - x0 + ox, anchors[s][1] - y0 + oy]
      # gaze range (texels): the toon rule (fu .55 / fv .52 of the free room), at least 4 / 3 texels
      if pbb:
        rx = max(4.0, .55 * ((bb[2] - bb[0]) - (pbb[2] - pbb[0])) / 2); ry = max(3.0, .52 * ((bb[3] - bb[1]) - (pbb[3] - pbb[1])) / 2)
      else: rx, ry = 0.0, 0.0
      em['eyes'][side] = dict(anchor=[round(anc[0], 2), round(anc[1], 2)], refOrigin=[x0 - ox, y0 - oy],
                              poly=[[round(a, 2), round(b, 2)] for a, b in poly], hull=[[round(a, 2), round(b, 2)] for a, b in hull],
                              range=[round(rx, 2), round(ry, 2)], hasPupil=bool(pm.any()),
                              pc=None if pc is None else [round(pc[0], 2), round(pc[1], 2)], bb=bb,
                              pivot=round(bb[1] + .62 * (bb[3] - bb[1]), 2), hasHl=bool(hpm.any()))
      # --- export meta (ref coords) ---
      def cen(m): c = centroid(m); return None if c is None else [round(c[0] + x0, 2), round(c[1] + y0, 2)]
      def bbr(m): b = bbox(m); return None if b is None else [b[0] + x0, b[1] + y0, b[2] + x0, b[3] + y0]
      wc, bc, pcn = cen(white), cen(body), cen(pupil_l)
      meta['eyes'][e][side] = dict(
        bbox=fb, size=[w, h], files={k: f'emotes/polly-layers/{e}-{side}-{k}.png' for k in ('white', 'pupil', 'black')},
        area={k: int(m.sum()) for k, m in dict(white=white, pupil=pupil_l, black=black_l, pupil_colour=pupil_c,
                                               highlight=hl, outline=outline, core=core, body=body).items()},
        centroid=dict(white=wc, body=bc, pupil=pcn, black=cen(black_l), core=cen(core)),
        bboxes=dict(white=bbr(white), body=bbr(body), pupil=bbr(pupil_l), black=bbr(black_l)),
        pupil_rel_white=None if pcn is None else [round(pcn[0] - wc[0], 2), round(pcn[1] - wc[1], 2)],
        pupil_rel_body=None if pcn is None else [round(pcn[0] - bc[0], 2), round(pcn[1] - bc[1], 2)],
        anchor_ref=[round(anchors[s][0], 2), round(anchors[s][1], 2)])
    rt['emotes'][e] = em
  ink = np.median(np.concatenate(ink_px), 0); rt['ink'] = [round(float(v) / 255, 4) for v in ink]
  Image.fromarray(atlas, 'RGBA').save(os.path.join(ROOT, 'polly-layer-atlas.png'), optimize=True)
  json.dump(rt, open(os.path.join(ROOT, 'polly-layer-atlas.json'), 'w'), separators=(',', ':'))
  json.dump(meta, open(f'{OUTD}/meta.json', 'w'), indent=1)
  print('cell', CW, CH, 'atlas', atlas.shape, os.path.getsize(os.path.join(ROOT, 'polly-layer-atlas.png')) // 1024, 'KB')
if __name__ == '__main__': main()
