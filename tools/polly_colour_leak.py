"""Containment check independent of the shader's debug codes. QA-pose 1:1 colour renders at the rig's gaze limits
(8 directions); per eye, the render is cropped at the eye's own atlas-cell origin (qaL / qaR) and classified with the
reference colour classifier. Leak = a pupil / motif / highlight-coloured pixel (colour class, not white) outside the
REFERENCE eye footprint (body | outline | nat masks of that eye (nat = v5.1 bridged white contour), placed in the cell; closure-squashed about the lid pivot
exactly like the shader when the lid follows a vertical gaze). Core ink is black like the outline, so it is covered by
the debug-code sweep instead.
   python3 tools/polly_colour_leak.py [outdir]"""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, '/tmp'); sys.path.insert(0, HERE)
import numpy as np; from PIL import Image; from scipy import ndimage as ndi
import polly_layer_qa as Q
from polly_layers import raw
from cdp import Page
DIRS = [('L', -.5, 0), ('R', .5, 0), ('U', 0, -.34), ('D', 0, .34), ('UL', -.5, -.34), ('UR', .5, -.34), ('DL', -.5, .34), ('DR', .5, .34)]
rt = json.load(open(os.path.join(ROOT, 'polly-layer-atlas.json'))); meta = json.load(open(os.path.join(ROOT, 'emotes/polly-layers/meta.json')))
CW, CH = rt['cw'], rt['ch']
def ref_fp(e, side, close_scale, piv):
  bx = meta['eyes'][e][side]['bbox']; w, h = bx[2] - bx[0], bx[3] - bx[1]; ox, oy = (CW - w) // 2, (CH - h) // 2
  m = np.zeros((CH, CW), bool)
  for nm in ('body', 'outline', 'nat'):            # v5.1: nat = the natural white contour shown once the pupil moved
    fn = os.path.join(ROOT, f'emotes/polly-layers/masks/{e}-{side}-{nm}.png')
    if os.path.exists(fn): m[oy:oy + h, ox:ox + w] |= np.asarray(Image.open(fn)) > 127
  if abs(close_scale - 1) > 1e-4:                     # shader: t.y = piv + (t.y - piv) / s  (sample the cell squashed)
    ys = np.arange(CH) + .5; src = piv + (ys - piv) / max(close_scale, .03)
    idx = np.floor(src).astype(int); ok = (idx >= 0) & (idx < CH)
    mm = np.zeros_like(m); mm[ok] = m[idx[ok]]; m = mm
  return ndi.binary_dilation(m, np.ones((3, 3), bool))     # 1 px tolerance for the anti-aliased rim under the squash
def main(out):
  os.makedirs(out, exist_ok=True); p = Page(620, 680); res = {}
  try:
    for i, e in enumerate(Q.IDS):
      res[e] = {}
      for nm, y, pt in DIRS:
        path = f'{out}/cl-{e}-{nm}.png'; info = Q.shoot(p, e, f'&qa&yaw={y}&pitch={pt}', path)
        im = np.asarray(Image.open(path).convert('RGB')); r = dict(close=round(info['close'], 3), offL=[round(v, 1) for v in info['offL']])
        # own-eye ownership: on a glance the two cells overlap, so each pixel belongs to the nearer eye footprint
        fps = {}; own = {}
        for side in 'LR':
          o = info['qaL'] if side == 'L' else info['qaR']; x0, y0 = info['css'][0] + int(round(o[0])), info['css'][1] + int(round(o[1]))
          fps[side] = (x0, y0, ref_fp(e, side, 1 - .9 * info['close'], rt['emotes'][e]['eyes'][side]['pivot']))
        Hh, Ww = im.shape[:2]; dist = {}
        for side, (x0, y0, fp) in fps.items():
          full = np.zeros((Hh, Ww), bool); full[y0:y0 + CH, x0:x0 + CW] = fp[:max(0, min(CH, Hh - y0)), :max(0, min(CW, Ww - x0))]
          dist[side] = ndi.distance_transform_edt(~full)
        own['L'] = dist['L'] <= dist['R']; own['R'] = ~own['L']
        for side in 'LR':
          o = info['qaL'] if side == 'L' else info['qaR']; x0, y0 = info['css'][0] + int(round(o[0])), info['css'][1] + int(round(o[1]))
          crop = np.ascontiguousarray(im[y0:y0 + CH, x0:x0 + CW])
          if crop.shape[:2] != (CH, CW): r[side] = None; continue
          bk, wh, co = raw(crop); mov = co & ~wh & own[side][y0:y0 + CH, x0:x0 + CW]
          piv = rt['emotes'][e]['eyes'][side]['pivot']
          fp = ref_fp(e, side, 1 - .9 * info['close'], piv)               # same vertical scale as the shader (uLayB.z)
          r[side] = dict(moving_px=int(mov.sum()), outside=int((mov & ~fp).sum()))
          if r[side]['outside']:
            dbg = crop.copy(); dbg[mov & ~fp] = (0, 255, 0); Image.fromarray(dbg).save(f'{out}/cl-{e}-{nm}-{side}-leak.png')
        res[e][nm] = r
      print(e, {k: (v['L']['outside'] if v['L'] else None, v['R']['outside'] if v['R'] else None, v['close']) for k, v in res[e].items()}, flush=True)
  finally: p.close()
  json.dump(res, open(f'{out}/colour-leak.json', 'w'), indent=1)
if __name__ == '__main__': main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/em/cleak')
