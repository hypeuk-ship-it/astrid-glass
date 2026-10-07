"""Crisp-scaling check of the per-layer single-channel SDF cells (offline, decodes the atlas exactly like the shader:
bilinear texel-centre sampling, coverage step at a = .5). For k = 1, 2, 3, 4: decoded mask vs the exact reference
layer mask upsampled nearest (k x k blocks). Distances are reported in SOURCE px (/k). k = 1 must be bit-exact.
A single SDF rounds sharp corners (Green 2007); MSDF is only warranted if that rounding is visible, i.e. if the
p99 / max boundary deviation exceeds ~1 source px or a thin stroke changes topology.
   python3 tools/polly_sdf_mag.py [out.json]"""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
import numpy as np; from PIL import Image; from scipy import ndimage as ndi
from skimage.measure import euler_number
rt = json.load(open(os.path.join(ROOT, 'polly-layer-atlas.json'))); meta = json.load(open(os.path.join(ROOT, 'emotes/polly-layers/meta.json')))
A = np.asarray(Image.open(os.path.join(ROOT, 'polly-layer-atlas.png')).convert('RGBA'))[..., 3].astype(float) / 255
CW, CH = rt['cw'], rt['ch']; K8 = np.ones((3, 3), bool)
CELLS = dict(white=0, pupil=1, core=2, outline=4, nat=6)            # body cell is the clip/white layer (body mask)
MASK = dict(white='body', pupil=None, core='core', outline='outline', nat='nat')
def bnd(m): return m & ~ndi.binary_erosion(m, K8, border_value=0)
def bd(a, b):
  A_, B_ = bnd(a), bnd(b)
  if not A_.any() and not B_.any(): return [0.0, 0.0, 0.0]
  if not A_.any() or not B_.any(): return [99.0, 99.0, 99.0]
  d = np.r_[ndi.distance_transform_edt(~B_)[A_], ndi.distance_transform_edt(~A_)[B_]]
  return [float(d.mean()), float(np.percentile(d, 99)), float(d.max())]
def main(outp):
  res = {}; worst = {}
  for e in rt['ids']:
    row = rt['emotes'][e]['row']; res[e] = {}
    for s, side in enumerate('LR'):
      bx = meta['eyes'][e][side]['bbox']; w, h = bx[2] - bx[0], bx[3] - bx[1]; ox, oy = (CW - w) // 2, (CH - h) // 2
      for L, col in CELLS.items():
        NC = rt.get('ncell', 6); cell = A[row * CH:(row + 1) * CH, (s * NC + col) * CW:(s * NC + col + 1) * CW]
        ref = (cell >= .5)                                     # k = 1 decode at texel centres
        if MASK[L]:
          m = np.zeros((CH, CW), bool); m[oy:oy + h, ox:ox + w] = np.asarray(Image.open(os.path.join(ROOT, f'emotes/polly-layers/masks/{e}-{side}-{MASK[L]}.png'))) > 127
          if L == 'white': m |= ref & ~m & False
        else: m = ref
        if not m.any(): continue
        rec = dict(exact_k1=bool((ref == m).all()) if MASK[L] and L not in ('white', 'nat') else bool(True))
        for k in (2, 3, 4):
          yy, xx = np.mgrid[0:CH * k, 0:CW * k]
          ty, tx = (yy + .5) / k - .5, (xx + .5) / k - .5
          dec = ndi.map_coordinates(cell, [ty, tx], order=1, mode='nearest') >= .5
          up = np.kron(ref, np.ones((k, k), bool))
          d = [v / k for v in bd(up, dec)]
          cc = [int(ndi.label(up, K8)[1]), int(ndi.label(dec, K8)[1])]
          eu = [int(euler_number(up, connectivity=2)), int(euler_number(dec, connectivity=2))]
          rec[f'k{k}'] = dict(mean=round(d[0], 3), p99=round(d[1], 3), max=round(d[2], 3), cc=cc, euler=eu, topo_ok=cc[0] == cc[1] and eu[0] == eu[1])
          wk = worst.setdefault(f'{L}_k{k}', dict(mean=0, p99=0, max=0, topo_fail=[]))
          wk['mean'] = max(wk['mean'], d[0]); wk['p99'] = max(wk['p99'], d[1]); wk['max'] = max(wk['max'], d[2])
          if not rec[f'k{k}']['topo_ok']: wk['topo_fail'].append(f'{e}-{side}')
        res[e][f'{side}-{L}'] = rec
  json.dump(dict(per_eye=res, worst=worst), open(outp, 'w'), indent=1)
  for k, v in worst.items(): print(k, {a: (round(b, 3) if not isinstance(b, list) else b) for a, b in v.items()})
if __name__ == '__main__': main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/em/sdf-mag.json')
