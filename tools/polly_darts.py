"""Polly v5.1 dart test on the LIVE glass path (not the QA blit): every emotion, pupils driven to rest + the 8 gaze
limits with the real pointer-follow rig (?seed=7, darts + glissade, blinks allowed but each shot waits for an open,
settled eye). Writes a contact sheet (one row per emotion: rest + 8 limits) and per-shot crops.
   python3 tools/polly_darts.py [out.png] [port] [workdir]"""
import sys, os, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, HERE)
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from cdp import Page
IDS = ['cheerful','confident','bored','angry','sleepy','smug','furious','starry','pleading','love','dizzy','blush']
DIRS = [('rest', 120, 120), ('L', -60, 120), ('R', 300, 120), ('U', 120, -60), ('D', 120, 300),
        ('UL', -60, -60), ('UR', 300, -60), ('DL', -60, 300), ('DR', 300, 300)]
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
FB = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)

IDS_ALL = list(IDS)
if os.environ.get('POLLY_IDS'): IDS = os.environ['POLLY_IDS'].split(',')
if os.environ.get('POLLY_DIRS'): DIRS = [d for d in DIRS if d[0] in os.environ['POLLY_DIRS'].split(',')]

def settle(p, x, y, n=40):
  """drive the pointer at (x, y) until the eye is open (closure < .02) and the gaze spring has settled"""
  p.ev('__astrid.drive(%s)' % json.dumps([[2, x, y]] * n))
  for _ in range(40):
    st = json.loads(p.ev('JSON.stringify(__astrid.layers())'))
    if abs(st['close']) < .02 and not st['pending']: return st
    p.ev('__astrid.drive(%s)' % json.dumps([[2, x, y]] * 4))
  return st

def main(out, port=8767, wd='/tmp/p51/darts'):
  os.makedirs(wd, exist_ok=True)
  base = f'http://127.0.0.1:{port}/index.html?noadapt&seed=7&coat=carbon&mode=dark&sheet=polly&toon=1'
  p = Page(620, 680, 2); rows = []; meta = {}
  try:
    for e in IDS:
      p.go(f'{base}&eyes=polly-{e}', .6)
      p.ev('document.querySelectorAll(".emoteBar,.sheetBar,.eyes,.coats,.bar").forEach(e=>e.style.display="none")')
      for _ in range(100):
        if p.ev('window.__astrid && __astrid.atlasReady && __astrid.atlasReady()'): break
        time.sleep(.05)
      settle(p, 120, 120, 60)
      css = json.loads(p.ev('JSON.stringify((()=>{const c=document.getElementById("gl");return [c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight]})())'))
      tiles = []; meta[e] = {}
      for nm, x, y in DIRS:
        st = settle(p, x, y)
        p.ev('__astrid.drive(%s)' % json.dumps([[2, x, y]] * 2))
        st = json.loads(p.ev('JSON.stringify(__astrid.layers())'))
        path = f'{wd}/dart-{e}-{nm}.png'; p.shot(path)
        im = Image.open(path).convert('RGB'); cx, cy = 2 * (css[0] + css[2] // 2), 2 * (css[1] + css[3] // 2)
        a = np.asarray(im).astype(int); wm = a.min(-1) > 200
        wm[:, :2 * css[0]] = False; wm[:, 2 * (css[0] + css[2]):] = False
        ys, xs = np.nonzero(wm)
        ex, ey = (int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2)) if len(xs) else (cx, cy)
        tile = im.crop((ex - 270, ey - 190, ex + 270, ey + 110)).resize((390, 217), Image.LANCZOS)
        Image.fromarray(a[ey - 190:ey + 110, ex - 270:ex + 270].astype(np.uint8)).save(f'{wd}/dart-{e}-{nm}-full.png')
        tile.save(f'{wd}/dart-{e}-{nm}-crop.png')
        tiles.append((nm, tile, st)); meta[e][nm] = dict(offL=st['offL'], offR=st['offR'], close=st['close'], gaze=st['gaze'])
      row = Image.new('RGB', (len(DIRS) * 394 + 10, 217 + 34), (16, 17, 21)); d = ImageDraw.Draw(row); d.text((8, 2), e, fill='white', font=FB)
      for k, (nm, t, st) in enumerate(tiles):
        x = 6 + k * 394; row.paste(t, (x, 32))
        d.text((x + 70, 17), f"{nm}  L({st['offL'][0]:+.0f},{st['offL'][1]:+.0f}) R({st['offR'][0]:+.0f},{st['offR'][1]:+.0f}) c{st['close']:.2f}", fill=(190, 190, 200), font=F)
      os.makedirs(os.path.join(wd, 'rows'), exist_ok=True); row.save(os.path.join(wd, 'rows', f'{IDS_ALL.index(e):02d}-{e}.png'))
      json.dump(meta[e], open(os.path.join(wd, 'rows', f'{IDS_ALL.index(e):02d}-{e}.json'), 'w'))
      rows.append(row); print(e, {k: (round(v['offL'][0]), round(v['offR'][0]), round(v['offL'][1])) for k, v in meta[e].items()}, flush=True)
    errs = [x for x in p.errors() if 'willReadFrequently' not in x]
  finally:
    p.close()
  S = Image.new('RGB', (rows[0].width, sum(r.height for r in rows) + 30), (16, 17, 21)); d = ImageDraw.Draw(S)
  d.text((8, 8), 'Polly dart test, LIVE glass path (carbon/dark, pointer-driven rig, seed 7): rest + 8 gaze limits per emotion; offsets = pupil texels', fill='white', font=F)
  y = 30
  for r in rows: S.paste(r, (0, y)); y += r.height
  S.save(out); json.dump(dict(meta=meta, errors=errs), open(os.path.join(wd, 'darts.json'), 'w'), indent=1)
  print('errors', errs[:5], 'sheet', out)

def assemble(wd, out):
  """v5.2: stitch the per-emotion rows written by (possibly parallel) runs into one sheet"""
  import glob
  rows = [Image.open(f) for f in sorted(glob.glob(os.path.join(wd, 'rows', '*.png')))]
  S = Image.new('RGB', (rows[0].width, sum(r.height for r in rows) + 30), (16, 17, 21)); d = ImageDraw.Draw(S)
  d.text((8, 8), 'Polly dart test, LIVE glass path (carbon/dark, pointer-driven rig, seed 7): rest + 8 gaze limits per emotion; offsets = pupil texels', fill='white', font=F)
  y = 30
  for r in rows: S.paste(r, (0, y)); y += r.height
  S.save(out); print('assembled', len(rows), 'rows ->', out, S.size)

if __name__ == '__main__' and '--assemble' in sys.argv:
  assemble(sys.argv[2], sys.argv[3]); sys.exit(0)
if __name__ == '__main__':
  a = sys.argv[1:]
  main(a[0] if a else '/tmp/p51/darts.png', int(a[1]) if len(a) > 1 else 8767, a[2] if len(a) > 2 else '/tmp/p51/darts')
