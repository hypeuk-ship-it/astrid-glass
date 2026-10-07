"""v5.2: add 'npoly' (the NATURAL white contour polygon, cell texels) per emotion/eye to polly-layer-atlas.json, decoded
from the atlas's own nat cell (alpha >= .5 = inside, the same test the QA blit uses), so the runtime pupil containment
works against exactly the white the shader shows once the pupil has moved. Idempotent.
   python3 tools/polly_npoly.py"""
import os, json
import numpy as np, cv2
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = os.path.join(ROOT, 'polly-layer-atlas.json'); j = json.load(open(J))
A = np.asarray(Image.open(os.path.join(ROOT, 'polly-layer-atlas.png')).convert('RGBA'))[..., 3]
cw, ch, nc = j['cw'], j['ch'], j['ncell']
for e in j['ids']:
  em = j['emotes'][e]; r = em['row']
  for s, sd in enumerate('LR'):
    c = s * nc + 6
    m = (A[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] >= 128).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cmax = max(cs, key=cv2.contourArea)
    poly = cv2.approxPolyDP(cmax, 0.6, True)[:, 0, :].astype(float) + 0.5
    em['eyes'][sd]['npoly'] = [[round(a, 2), round(b, 2)] for a, b in poly]
    print(e, sd, 'nat px', int(m.sum()), 'npoly', len(poly), 'poly', len(em['eyes'][sd]['poly']))
json.dump(j, open(J, 'w'), separators=(',', ':'))
