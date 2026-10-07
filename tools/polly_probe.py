"""Quick live-glass probe: python3 tools/polly_probe.py out.png page emo1:x:y[:n] emo2:x:y ...  (DPR 2, eye-band crop,
tiles stacked 2 per row). page = index.html or a debug copy. Prints layers() state per shot."""
import sys, os, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from PIL import Image, ImageDraw, ImageFont
from cdp import Page
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
out, page, specs = sys.argv[1], sys.argv[2], sys.argv[3:]
p = Page(620, 680, 2); tiles = []; cur = None
try:
  for sp in specs:
    e, x, y, *n = sp.split(':'); n = int(n[0]) if n else 60
    if e != cur:
      p.go(f'{os.environ.get("PROBE_BASE", "http://127.0.0.1:8767")}/{page}?noadapt&seed=7&coat=carbon&mode=dark&sheet=polly&toon=1&eyes=polly-{e}', .6)
      p.ev('document.querySelectorAll(".emoteBar,.sheetBar,.eyes,.coats,.bar").forEach(e=>e.style.display="none")')
      for _ in range(100):
        if p.ev('window.__astrid && __astrid.atlasReady && __astrid.atlasReady()'): break
        time.sleep(.05)
      cur = e
    p.ev('__astrid.drive(%s)' % json.dumps([[2, float(x), float(y)]] * n))
    for _ in range(30):
      st = json.loads(p.ev('JSON.stringify(__astrid.layers())'))
      if abs(st['close']) < .02: break
      p.ev('__astrid.drive(%s)' % json.dumps([[2, float(x), float(y)]] * 4))
    p.shot('/tmp/_probe.png'); im = Image.open('/tmp/_probe.png').convert('RGB')
    import numpy as np
    A = np.asarray(im).astype(int); wm = A.min(-1) > 200; wm[:120] = False; wm[1300:] = False
    ys, xs = np.nonzero(wm)
    ex, ey = (int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2)) if len(xs) else (620, 640)
    t = im.crop((ex - 360, ey - 200, ex + 360, ey + 160))
    ImageDraw.Draw(t).text((6, 4), f"{sp} offL({st['offL'][0]:+.1f},{st['offL'][1]:+.1f}) offR({st['offR'][0]:+.1f},{st['offR'][1]:+.1f}) c{st['close']:.2f}", fill='yellow', font=F)
    os.makedirs('/tmp/p51/ptiles', exist_ok=True); t.save('/tmp/p51/ptiles/%s.png' % sp.replace(':', '_')); tiles.append(t); print(sp, 'offL', [round(v, 1) for v in st['offL']], 'offR', [round(v, 1) for v in st['offR']], flush=True)
  print('errors', [x for x in p.errors() if 'willReadFrequently' not in x][:5])
finally:
  p.close()
S = Image.new('RGB', (2 * 724, ((len(tiles) + 1) // 2) * 364), (16, 17, 21))
for k, t in enumerate(tiles): S.paste(t, ((k % 2) * 724, (k // 2) * 364))
S.save(out)
