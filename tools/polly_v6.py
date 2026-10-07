"""Polly v6 (animated components + drawn blink) capture on the LIVE glass path.
   python3 tools/polly_v6.py strip|preview|anim|all [outdir]
strip   : polly-v6-blinkstrip.png  every 60 Hz frame of one blink, close-up of one eye (+ brow), several emotions
preview : polly-v6-preview.png     12 emotions: rest | half shut | shut (drawn closed eye) | glance up-left | glance down-right
anim    : polly-v6-anim.mp4        continuous demo (slow drawn blinks, gaze darts, swap behind a blink, motifs)"""
import sys, os, json, time, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, HERE)
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from cdp import Page
BASE = 'http://127.0.0.1:8767/index.html?noadapt&seed=7&coat=carbon&mode=dark&sheet=polly&toon=1'
IDS = ['cheerful','confident','bored','angry','sleepy','smug','furious','starry','pleading','love','dizzy','blush']
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
FB = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
BG = (16, 17, 21)

class Rig:
  def __init__(self):
    self.p = Page(620, 680, 2)
  def go(self, emo):
    p = self.p
    p.go(f'{BASE}&eyes=polly-{emo}', .6)
    p.ev('document.querySelectorAll(".emoteBar,.sheetBar,.eyes,.coats,.bar").forEach(e=>e.style.display="none")')
    for _ in range(120):
      if p.ev('window.__astrid && __astrid.atlasReady && __astrid.atlasReady()'): break
      time.sleep(.05)
    p.ev('__astrid.holdBlinks(1)')
    self.css = json.loads(p.ev('JSON.stringify((()=>{const c=document.getElementById("gl");return [c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight]})())'))
    self.c = (2 * (self.css[0] + self.css[2] // 2), 2 * (self.css[1] + self.css[3] // 2))
    self.drive(120, 120, 60)
  def drive(self, x, y, n=1): self.p.ev('__astrid.drive(%s)' % json.dumps([[2, x, y]] * n))
  def st(self): return json.loads(self.p.ev('JSON.stringify(__astrid.layers())'))
  def shot(self):                           # face region only (device px 600 x 440), clipped capture (fast)
    cx, cy = self.c
    tmp = f'/tmp/_v6-{os.getpid()}.png'                # per process (two captures in parallel raced on one file)
    self.p.shot_clip(tmp, (cx - 300) / 2, (cy - 330) / 2, 300, 220); return Image.open(tmp).convert('RGB')
  def face(self, im): return im
  def close(self): self.p.close()

def eye_box(face_img, side='R'):
  """bbox of the eye + brow art in one half of the face crop (bright / saturated pixels), padded"""
  a = np.asarray(face_img).astype(int); W = a.shape[1]
  m = (a.max(2) > 150) | ((a.max(2) - a.min(2)) > 60)
  if side == 'R': m[:, :W // 2] = False
  else: m[:, W // 2:] = False
  ys, xs = np.nonzero(m)
  x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
  return (max(0, x0 - 18), max(0, y0 - 14), min(W, x1 + 18), min(a.shape[0], y1 + 22))

def blink_frames(r, n=30, wait_open=True):
  """trigger one blink, return [(img, state)] for every 60 Hz tick from the trigger until settled open"""
  out = [(r.shot(), r.st())]
  r.p.ev('__astrid.blinkNow(1)')
  for i in range(n):
    r.drive(120, 120, 1); out.append((r.shot(), r.st()))
  return out

def strip(outdir, emos=('confident', 'cheerful', 'bored', 'angry', 'sleepy', 'love', 'dizzy', 'pleading')):
  r = Rig(); rows = []; log = {}
  try:
    for emo in emos:
      r.go(emo)
      fr = blink_frames(r, 26 if emo != 'sleepy' else 40)
      box = eye_box(r.face(fr[0][0]), 'R')
      tiles = []
      for k, (im, st) in enumerate(fr):
        t = r.face(im).crop(box); sc = 150 / t.height; t = t.resize((max(1, int(t.width * sc)), 150), Image.LANCZOS)
        tiles.append((t, st))
      log[emo] = [dict(t=round(k * 1000 / 60), close=round(s['lClose'], 3), lid=round(s['lid'][0], 3), stretch=round(s['lid'][1], 3), bp=s['bp'], browdy=round(s['decoB'][1], 2)) for k, (_, s) in enumerate(fr)]
      tw = max(t.width for t, _ in tiles); per = 14
      nrow = (len(tiles) + per - 1) // per
      R_ = Image.new('RGB', (per * (tw + 4) + 8, nrow * 178 + 26), BG); d = ImageDraw.Draw(R_)
      d.text((8, 4), f'{emo}: one blink, every 60 Hz frame (16.7 ms), right eye + brow, live glass path', fill='white', font=FB)
      for k, (t, st) in enumerate(tiles):
        x = 8 + (k % per) * (tw + 4); y = 26 + (k // per) * 178
        R_.paste(t, (x, y + 16)); d.text((x, y), f"{k * 1000 / 60:.0f}ms {st['lid'][0]:.2f}", fill=(200, 200, 205), font=F)
      rows.append(R_)
  finally: r.close()
  W = max(x.width for x in rows); S = Image.new('RGB', (W, sum(x.height for x in rows)), BG); y = 0
  for x in rows: S.paste(x, (0, y)); y += x.height
  S.save(os.path.join(ROOT, 'polly-v6-blinkstrip.png'))
  json.dump(log, open(os.path.join(outdir, 'polly-v6-blinkstrip.json'), 'w'), indent=0)
  return log

def preview(outdir, full=False):
  """full=True also saves the whole-orb frame of every glance cell to outdir (crop check)"""
  r = Rig(); rows = []
  cols = ['rest', 'half shut', 'shut (drawn)', 'reopen (peak overshoot)', 'glance up-left', 'glance down-right']
  try:
    for emo in IDS:
      r.go(emo); cells = [r.face(r.shot())]
      r.p.ev('__astrid.blinkNow(1)'); got = {}; best = 1.0; phase = 0
      for i in range(70):                     # sleepy: ~43 ticks to settle; the others ~25
        r.drive(120, 120, 1); st = r.st(); c, z = st['lid'][0], st['lid'][1]
        if 'half' not in got and c >= .45: got['half'] = r.face(r.shot())
        if 'shut' not in got and c >= .999: got['shut'] = r.face(r.shot()); phase = 1
        if phase == 1 and c < .999: phase = 2  # reopening
        if phase == 2:
          # v6 review: the 4th cell is the reopen's PEAK overshoot frame (max vertical stretch). Sleepy reopens heavy with no
          # overshoot by design (stretch <= 1.002), so the old 'stretch > 1.02' trigger never fired and the cell stayed blank;
          # emotions without a visible overshoot now show the mid-reopen frame (lid .5) instead, labelled in the cell.
          if z > best + .002: best = z; got['over'] = r.face(r.shot()); got['overlab'] = f'stretch {z:.3f}'
          if 'mid' not in got and c <= .5: got['mid'] = r.face(r.shot())
          if c < .01 and z < best - .004: break
      if best < 1.01 and 'mid' in got: got['over'] = got['mid']; got['overlab'] = 'no overshoot: mid-reopen (lid .5)'
      ov = got.get('over')
      if ov is not None:
        ov = ov.copy(); ImageDraw.Draw(ov).text((8, 6), got['overlab'], fill=(230, 230, 235), font=F)
      cells += [got.get('half'), got.get('shut'), ov]
      for nm, (x, y) in (('upleft', (-80, -60)), ('downright', (320, 300))):
        # settle: a big dart can trigger a blink (and the dart itself waits out the current hold, up to 1.55 s), so drive until
        # the gaze has landed and the lid is open again (v6 review: starry's down-right cell caught that blink)
        r.drive(x, y, 30)
        for _ in range(30):
          st = r.st()
          if st['lClose'] < .01 and st['bp'] == 0 and abs(st['gaze'][0] - st['gz']['tx']) < .03 and abs(st['gaze'][1] - st['gz']['ty']) < .03: break
          r.drive(x, y, 5)
        r.drive(x, y, 6); cells.append(r.face(r.shot()))
        if full: r.p.shot(os.path.join(outdir, f'glance-{emo}-{nm}.png'))
      rows.append((emo, cells))
  finally: r.close()
  tw, th = 300, 220
  S = Image.new('RGB', (len(cols) * (tw + 4) + 100, len(rows) * (th + 4) + 30), BG); d = ImageDraw.Draw(S)
  for j, c in enumerate(cols): d.text((100 + j * (tw + 4) + 4, 8), c, fill='white', font=FB)
  for i, (emo, cells) in enumerate(rows):
    d.text((6, 30 + i * (th + 4) + th // 2), emo, fill='white', font=FB)
    for j, c in enumerate(cells):
      if c is None: d.text((100 + j * (tw + 4) + 20, 30 + i * (th + 4) + th // 2), 'MISSING', fill=(255, 80, 80), font=FB); continue
      S.paste(c.resize((tw, th), Image.LANCZOS), (100 + j * (tw + 4), 30 + i * (th + 4)))
  S.save(os.path.join(ROOT, 'polly-v6-preview.png'))

def anim(outdir):
  fr_dir = os.path.join(outdir, 'frames'); shutil.rmtree(fr_dir, ignore_errors=True); os.makedirs(fr_dir)
  r = Rig(); n = 0; n2 = 0; lastb = 0; log = []
  def hold(x, y, k): return [('', x, y)] * k
  # scenes: (label, emotion to request at start, steps); step = (action, x, y), action 'b' = blink now
  # scenes: (label, emotion to request at start, steps); step = (action, x, y), action 'b' = blink now
  # v6 review: ~16 s. 'slow' = replay the frames since the last blink trigger at 1/3 speed (labelled), so the drawn lid can be read
  scenes = [
    ('(a) drawn blink at rest: her lash line slides down, holds as the closed lash arc, reopens with a little overshoot', 'confident',
     hold(120, 120, 20) + [('b', 120, 120)] + hold(120, 120, 34)),
    ('(a) same blink, 1/3 speed replay', None, [('slow', 0, 0)]),
    ('(b) gaze darts + holds: pupils / blacks / highlights move inside solid whites, lids follow, face barely turns', None,
     hold(-60, 110, 35) + hold(300, 140, 35) + hold(120, -60, 35) + hold(120, 300, 35) + hold(280, -40, 30) + hold(120, 120, 25)),
    ('(c) expression swap behind a blink: confident -> bored (all layers change on the closed frame)', 'bored', hold(120, 120, 60)),
    ('(c) ... bored -> angry, then darts', 'angry', hold(120, 120, 50) + hold(-40, 120, 25) + hold(260, 120, 25)),
    ('(c) ... angry -> sleepy (slow heavy blink)', 'sleepy', hold(120, 120, 40) + [('b', 120, 120)] + hold(120, 120, 60) + hold(120, 120, 30)),
    ('(d) motif alive: starry (stars twinkle per eye)', 'starry', hold(120, 120, 60)),
    ('(d) motif alive: love (hearts lub-dub)', 'love', hold(120, 120, 70)),
    ('(d) motif alive: dizzy (spirals counter-rotate)', 'dizzy', hold(120, 120, 60)),
    ('(d) furious: anger marks pulse', 'furious', hold(120, 120, 50)),
    ('(e) pleading: darts + a drawn blink', 'pleading', hold(120, 120, 20) + hold(10, 90, 30) + hold(250, 150, 30) + [('b', 120, 120)] + hold(120, 120, 40)),
  ]
  try:
    r.go('confident'); label = ''
    for (lab, emo, steps) in scenes:
      label = lab
      if emo and emo != r.st()['cur']: r.p.ev(f'__astrid.setEyes("polly-{emo}")')
      for (act, x, y) in steps:
        if act == 'slow':
          end = n2
          for k in range(lastb, end):
            src = Image.open(f'{fr_dir}/f{k:04d}.png')
            for rep in range(3):
              c2 = src.copy(); d2 = ImageDraw.Draw(c2); d2.rectangle((0, 0, 900, 30), fill=BG)
              d2.text((12, 8), label + f'  (frame {k - lastb + 1}/{end - lastb})', fill=(255, 220, 120), font=FB)
              c2.save(f'{fr_dir}/f{n2:04d}.png'); n2 += 1
              log.append(dict(log[k], n=n2 - 1, replay=k))
          continue
        if act == 'b': r.p.ev('__astrid.blinkNow(1)'); lastb = n2
        r.drive(x, y, 1); st = r.st()
        im = r.face(r.shot())
        canvas = Image.new('RGB', (900, 660 + 60), BG)
        canvas.paste(im.resize((900, 660), Image.LANCZOS), (0, 60)); d = ImageDraw.Draw(canvas)
        d.text((12, 8), label, fill='white', font=FB)
        d.text((12, 34), f"t {n * 1000 / 60:6.0f} ms   showing {st['cur']}{(' -> ' + st['pending']) if st['pending'] else ''}   lid {st['lid'][0]:.2f}  stretch {st['lid'][1]:.3f}   gaze ({st['gaze'][0]:+.2f},{st['gaze'][1]:+.2f})   brow dy {st['decoB'][0]:+.1f}", fill=(190, 190, 200), font=F)
        canvas.save(f'{fr_dir}/f{n2:04d}.png')
        log.append(dict(n=n2, t=n, cur=st['cur'], pending=st['pending'], lid=st['lid'], close=st['lClose'], gaze=st['gaze'], darts=st['gz']['darts'], bp=st['bp']))
        n += 1; n2 += 1
    swaps = r.st()['swaps']; errs = r.p.errors()
  finally: r.close()
  mp4 = os.path.join(ROOT, 'polly-v6-anim.mp4')
  subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '60', '-i', f'{fr_dir}/f%04d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4], check=True)
  json.dump(dict(frames=log, swaps=swaps, errors=errs), open(os.path.join(outdir, 'polly-v6-anim.json'), 'w'))
  live = [f for f in log if 'replay' not in f]
  bad = [(a['n'], a['cur'], b['cur'], b['lid'][0]) for a, b in zip(live, live[1:]) if a['cur'] != b['cur'] and b['lid'][0] < .97]
  print('frames', n2, 'live ticks', n, 'swaps', [(s['from'], s['to'], s['closure']) for s in swaps], 'swap frames drawn < .97 shut:', bad, 'errors', errs[:3])
  return log

if __name__ == '__main__':
  what = sys.argv[1] if len(sys.argv) > 1 else 'all'; out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/p6'
  os.makedirs(out, exist_ok=True)
  if what in ('strip', 'all'): print(json.dumps(strip(out)['confident']))
  if what in ('preview', 'all'): preview(out, full=True)
  if what in ('anim', 'all'): anim(out)
