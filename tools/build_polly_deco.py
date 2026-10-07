"""v6: Polly's BROWS and FX (anger marks, tears, blush, nose shadow) as their own sprite layers, cut 1:1 from her sheet cells.
   python3 tools/build_polly_deco.py      (run after tools/build_polly_layers.py; it reads polly-layer-atlas.json for the anchors)
Writes polly-deco-atlas.png / .json: 12 rows (emotes) x 6 cells (L brow, L fx, L shade, R brow, R fx, R shade; shade = her grey nose
shadow, stored as a multiply factor c / bg so it darkens whatever face colour it sits on). Every cell is DW x DH texels =
reference px, placed so the eye's anchor (the same anchor the eye layers use) sits at (ax, ay): the shader maps a sphere point
to deco texels as  t_eye - anchor + (ax, ay). Straight alpha (her art over the sheet's flat grey, unmixed: a = projection of
(c - bg) on (f - bg), f = colour of the nearest solid art pixel), RGB bled 3 texels so LINEAR filtering keeps the colour.
Selection (no new drawing): brow = the largest coloured / black blob above each eye; fx = every other art blob that touches the
eye's surroundings (<= 26 px from the eye footprint) or sits between the eyes (nose shadow). Blobs touching the cell border that
are not brows (neighbouring cells' art) and the light watermark are dropped. Each side keeps only its half of the face (split
halfway between the two anchors)."""
import sys, os, json, numpy as np
from PIL import Image
from scipy import ndimage as ndi
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from polly_layers import classify, HL_HULL
IDS = ['cheerful','confident','bored','angry','sleepy','smug','furious','starry','pleading','love','dizzy','blush']
REF = '/workspace/eye-emotes/refs/cells/polly-{i:02d}-{e}.png'
K8 = np.ones((3, 3), bool)
PAD = 4

def main():
  rt = json.load(open(os.path.join(ROOT, 'polly-layer-atlas.json')))
  items = []
  for i, e in enumerate(IDS):
    rgb = np.asarray(Image.open(REF.format(i=i, e=e)).convert('RGB')); a = rgb.astype(float)
    H, W = rgb.shape[:2]
    lum = a @ [.299, .587, .114]; sat = a.max(2) - a.min(2)
    res = classify(rgb, e in HL_HULL)
    Fs = [r['F'] for r in res]; F = Fs[0] | Fs[1]
    em = rt['emotes'][e]
    anc = [[em['eyes'][s]['anchor'][0] + em['eyes'][s]['refOrigin'][0], em['eyes'][s]['anchor'][1] + em['eyes'][s]['refOrigin'][1]] for s in 'LR']
    midx = (anc[0][0] + anc[1][0]) / 2
    bgm = (sat < 10) & (np.abs(lum - 137) < 6)
    bg = np.median(a[bgm], 0)
    Fd = ndi.binary_dilation(F, np.ones((5, 5), bool))
    cand = ((sat > 40) | (lum > 215) | (lum < 60) | ((lum < bg.mean() - 16) & (sat < 30))) & ~Fd
    lab, n = ndi.label(cand, K8)
    dF = ndi.distance_transform_edt(~F)
    eye_top = [np.nonzero(f)[0].min() for f in Fs]
    eye_x = [(np.nonzero(f)[1].min(), np.nonzero(f)[1].max()) for f in Fs]
    brow = [np.zeros((H, W), bool), np.zeros((H, W), bool)]; fx = np.zeros((H, W), bool); shade = np.zeros((H, W), bool); midfx = np.zeros((H, W), bool)
    best = [0, 0]
    comps = []
    for k in range(1, n + 1):
      c = lab == k; sz = c.sum()
      if sz < 15: continue
      ys, xs = np.nonzero(c); cy, cx = ys.mean(), xs.mean()
      border = ys.min() == 0 or xs.min() == 0 or ys.max() == H - 1 or xs.max() == W - 1
      side = 0 if cx < midx else 1
      above = cy < eye_top[side] + 6 and eye_x[side][0] - 20 <= cx <= eye_x[side][1] + 20
      solid = (sat[c].mean() > 40) or (lum[c].mean() < 70) or (lum[c].mean() > 200)
      comps.append((k, c, sz, cy, cx, border, side, above, solid))
      if above and solid and sz > best[side] and sz > 150: best[side] = sz; brow[side] = c
    for (k, c, sz, cy, cx, border, side, above, solid) in comps:
      if brow[0] is c or brow[1] is c: continue
      near = dF[c].min() <= 26
      grey = (sat[c].mean() < 30) and (lum[c].mean() < bg.mean() - 10) and (lum[c].mean() > 70)
      between = grey and sz >= 120 and anc[0][0] + 15 < cx < anc[1][0] - 15
      if border and not (above and solid) and not (solid and dF[c].min() <= 12): continue
      if grey and not between: continue
      cxs = np.nonzero(c)[1]; cross = cxs.min() < midx - 4 and cxs.max() > midx + 4
      if between: shade |= c                                         # her nose shadow: a multiply shade, not paint
      elif near and cross: midfx |= c                                # e.g. the blush smudge under both eyes
      elif near: fx |= c
    def unmix(m):
      """straight alpha + colour of art mask m (+ its 2 px AA ring) over the flat bg"""
      R = ndi.binary_dilation(m, K8, iterations=2) & ~Fd
      _, (iy, ix) = ndi.distance_transform_edt(~m, return_indices=True)
      f = a[iy, ix]; d = f - bg; den = (d * d).sum(-1)
      al = np.where(den > 1, ((a - bg) * d).sum(-1) / np.maximum(den, 1), 0).clip(0, 1)
      al = np.where(m, 1.0, np.where(R, al, 0.0))
      col = np.where(m[..., None], a, f)
      return al, col
    out = {}
    for s in range(2):
      half = (np.arange(W)[None, :] + .5 < midx) if s == 0 else (np.arange(W)[None, :] + .5 >= midx)
      for nm, m in (('brow', brow[s]), ('fx', fx & half)):
        al, col = unmix(m); al = al * half
        out[(s, nm)] = (al, col)
    # MID layer (whole, centred on the face midline; the shader stretches it to the rig's eye spacing): midline-crossing
    # FX (blush smudge) + the nose shade
    for nm, m in (('fx', midfx), ('shade', shade)):
      out[(2, nm)] = unmix(m)
    anc.append([midx, (anc[0][1] + anc[1][1]) / 2])
    items.append(dict(e=e, anc=anc, out=out, H=H, W=W, midx=midx, bg=bg.tolist(), nbrow=[int(b.sum()) for b in brow], nfx=int(fx.sum()), nmid=int(midfx.sum()),
                      sp=float(anc[1][0] - anc[0][0])))
    print(e, 'brow px', items[-1]['nbrow'], 'fx px', items[-1]['nfx'], 'mid fx', int(midfx.sum()), 'shade', int(shade.sum()), 'bg', np.round(bg, 1), flush=True)
  # common deco cell: bbox of every art texel relative to its eye anchor
  lo = np.array([1e9, 1e9]); hi = np.array([-1e9, -1e9])
  for it in items:
    for (s, nm), (al, col) in it['out'].items():
      ys, xs = np.nonzero(al > 0)
      if not len(xs): continue
      lo = np.minimum(lo, [xs.min() - it['anc'][s][0], ys.min() - it['anc'][s][1]]); hi = np.maximum(hi, [xs.max() + 1 - it['anc'][s][0], ys.max() + 1 - it['anc'][s][1]])
  ax, ay = int(np.ceil(-lo[0])) + PAD, int(np.ceil(-lo[1])) + PAD
  DW, DH = ax + int(np.ceil(hi[0])) + PAD, ay + int(np.ceil(hi[1])) + PAD
  CELLS = [(0, 'brow'), (0, 'fx'), (1, 'brow'), (1, 'fx'), (2, 'fx'), (2, 'shade')]
  atlas = np.zeros((len(IDS) * DH, 6 * DW, 4), np.uint8)
  meta = dict(dw=DW, dh=DH, ax=ax, ay=ay, cols=6, rows=len(IDS), W=6 * DW, H=len(IDS) * DH,
              cells=['L brow', 'L fx', 'R brow', 'R fx', 'mid fx', 'mid shade (multiply)'], emotes={})
  for row, it in enumerate(items):
    em = dict(row=row, sp=round(it['sp'], 2))
    reach = [0.0, 0.0, 0.0]
    for col_i, (s, nm) in enumerate(CELLS):
      al, col = it['out'][(s, nm)]
      ox = int(round(it['anc'][s][0])) - ax; oy = int(round(it['anc'][s][1])) - ay   # ref px of the cell origin
      A = np.zeros((DH, DW)); C = np.zeros((DH, DW, 3))
      y0, x0 = max(0, oy), max(0, ox); y1, x1 = min(it['H'], oy + DH), min(it['W'], ox + DW)
      if y1 > y0 and x1 > x0:
        A[y0 - oy:y1 - oy, x0 - ox:x1 - ox] = al[y0:y1, x0:x1]; C[y0 - oy:y1 - oy, x0 - ox:x1 - ox] = col[y0:y1, x0:x1]
      m = A > 0
      key = ('L', 'R', 'M')[s] + nm
      if m.any():
        d, (iy, ix) = ndi.distance_transform_edt(~m, return_indices=True)
        C = np.where((d <= 3)[..., None], C[iy, ix], 0)
        ys, xs = np.nonzero(m); w8 = A[m]
        em[key] = dict(c=[round(float((xs * w8).sum() / w8.sum() + .5), 2), round(float((ys * w8).sum() / w8.sum() + .5), 2)],
                       bb=[int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1])
        reach[s] = max(reach[s], float(np.hypot(xs + .5 - ax, ys + .5 - ay).max()))
      if nm == 'shade': C = np.where(m[..., None], (C / np.maximum(np.array(it['bg']), 1) * 255).clip(0, 255), 255)   # multiply factor
      atlas[row * DH:(row + 1) * DH, col_i * DW:(col_i + 1) * DW, :3] = np.round(C).clip(0, 255).astype(np.uint8)
      atlas[row * DH:(row + 1) * DH, col_i * DW:(col_i + 1) * DW, 3] = np.round(A * 255).astype(np.uint8)
    em['reachL'], em['reachR'], em['reachM'] = [round(r, 1) for r in reach]
    em['subL'] = [round(it['anc'][0][0] - round(it['anc'][0][0]), 2), round(it['anc'][0][1] - round(it['anc'][0][1]), 2)]
    em['subR'] = [round(it['anc'][1][0] - round(it['anc'][1][0]), 2), round(it['anc'][1][1] - round(it['anc'][1][1]), 2)]
    em['subM'] = [round(it['anc'][2][0] - round(it['anc'][2][0]), 2), round(it['anc'][2][1] - round(it['anc'][2][1]), 2)]
    meta['emotes'][it['e']] = em
  Image.fromarray(atlas, 'RGBA').save(os.path.join(ROOT, 'polly-deco-atlas.png'), optimize=True)
  json.dump(meta, open(os.path.join(ROOT, 'polly-deco-atlas.json'), 'w'), separators=(',', ':'))
  print('deco cell', DW, DH, 'anchor', ax, ay, 'atlas', atlas.shape, os.path.getsize(os.path.join(ROOT, 'polly-deco-atlas.png')) // 1024, 'KB')
if __name__ == '__main__': main()
