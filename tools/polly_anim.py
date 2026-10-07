"""Polly layered rig: animation capture (live glass path, deterministic ?seed, one frame per 60 Hz tick).
Scenes: gaze darts + holds (cheerful), expression swap behind a blink (confident -> bored), pop swap on a squash frame
(-> love, hearts lub-dub), starry twinkle, dizzy spin. Writes polly-<tag>-anim.mp4 / .gif, a swap film strip (every
60 Hz frame around every swap), a dart contact sheet (every 2nd frame around every gaze dart) and a hard-cut audit (every
frame whose displayed emotion changes must be drawn >= .9 closed; big frame-to-frame jumps outside closed frames listed).
   python3 tools/polly_anim.py [outdir] [tag]"""
import sys, os, json, time, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from cdp import Page
BASE = 'http://127.0.0.1:8767/index.html?noadapt&seed=7&coat=carbon&mode=dark&sheet=polly&toon=1'
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
FB = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)

def main(out, tag='v51'):
  fr_dir = os.path.join(out, 'frames'); shutil.rmtree(fr_dir, ignore_errors=True); os.makedirs(fr_dir)
  p = Page(620, 680, 2)   # v5.2: device px 2x (v5.1 shot at 1x and upscaled: soft, hard to read)
  # scene script: (label, emote to set at start or None, list of pointer targets per frame)
  def hold(x, y, n): return [(x, y)] * n
  def glide(a, b, n): return [(a[0] + (b[0] - a[0]) * k / (n - 1), a[1] + (b[1] - a[1]) * k / (n - 1)) for k in range(n)]
  scenes = [('gaze darts + holds (pointer glides; eyes dart, hold, glissade)', 'cheerful',
             hold(120, 120, 20) + glide((120, 120), (-40, 100), 40) + hold(-40, 100, 25) + glide((-40, 100), (280, 160), 45) + hold(280, 160, 20) + [(120, 280)] * 30 + [(120, 120)] * 20),
            ('expression swap behind a blink: confident -> bored', 'confident', hold(120, 120, 24)),
            ('', 'bored', hold(120, 120, 46)),
            ('pop swap on a squash frame -> love (hearts lub-dub)', 'love', hold(120, 120, 100)),
            ('-> starry (stars twinkle per eye)', 'starry', hold(120, 120, 100)),
            ('-> dizzy (spirals spin, counter-rotating)', 'dizzy', hold(120, 120, 100)),
            ('-> sleepy: lid follows vertical gaze; slow heavy blink clock', 'sleepy', hold(120, 120, 30) + [(120, 10)] * 50 + [(120, 290)] * 60 + hold(120, 120, 100)),
            ('-> pleading: darts + holds, highlight lags (0.4x travel, springy)', 'pleading', hold(120, 120, 20) + [(10, 90)] * 35 + [(250, 150)] * 35 + [(60, 200)] * 30 + [(200, 60)] * 30 + hold(120, 120, 30))]
  n = 0; log = []
  try:
    p.go(f'{BASE}&eyes=polly-cheerful', .8)
    p.ev('document.querySelectorAll(".emoteBar,.sheetBar,.eyes,.coats,.bar").forEach(e=>e.style.display="none")')
    for _ in range(100):
      if p.ev('window.__astrid && window.__astrid.atlasReady && window.__astrid.atlasReady()'): break
      time.sleep(.05)
    p.ev('__astrid.drive(%s)' % json.dumps([[2, 120, 120]] * 30))
    css = json.loads(p.ev('JSON.stringify((()=>{const c=document.getElementById("gl");return [c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight]})())'))
    label = ''
    for (lab, emo, steps) in scenes:
      if lab: label = lab
      cur = json.loads(p.ev('JSON.stringify(__astrid.layers())'))['cur']
      if emo and emo != cur: p.ev(f'__astrid.setEyes("polly-{emo}")')
      for (x, y) in steps:
        p.ev('__astrid.drive(%s)' % json.dumps([[2, x, y]]))
        st = json.loads(p.ev('JSON.stringify(__astrid.layers())'))
        path = f'{fr_dir}/raw.png'; p.shot(path)
        im = Image.open(path).convert('RGB')
        cx, cy = 2 * (css[0] + css[2] // 2), 2 * (css[1] + css[3] // 2)
        crop = im.crop((cx - 560, cy - 400, cx + 560, cy + 300))          # 1120 x 700 device px (head turns stay in frame)
        canvas = Image.new('RGB', (1120, 760), (16, 17, 21)); canvas.paste(crop, (0, 60)); d = ImageDraw.Draw(canvas)
        d.text((12, 8), label, fill='white', font=FB)
        d.text((12, 32), f"t {n * 1000 / 60:6.0f} ms   showing {st['cur']}{(' -> ' + st['pending']) if st['pending'] else ''}   closure {st['close']:.2f}   gaze ({st['gaze'][0]:+.2f},{st['gaze'][1]:+.2f})   pupil scale {st['sL']:.2f}/{st['sR']:.2f}", fill=(190, 190, 200), font=F)
        canvas.save(f'{fr_dir}/f{n:04d}.png')
        log.append(dict(n=n, label=label, cur=st['cur'], pending=st['pending'], close=round(st['close'], 3), darts=st['gz']['darts'], bsq=round(st.get('bsq', 0), 3), gaze=st['gaze'], sL=st['sL'], sR=st['sR'], rL=st['rL'], rR=st['rR'], hl=st['hl'], offL=st['offL']))
        n += 1
    swaps = json.loads(p.ev('JSON.stringify(__astrid.layers().swaps)'))
    errs = [e for e in p.errors() if 'willReadFrequently' not in e]
  finally:
    p.close()
  json.dump(dict(frames=log, swaps=swaps, errors=errs), open(f'{out}/polly-{tag}-anim.json', 'w'), indent=0)
  mp4 = os.path.join(ROOT, f'polly-{tag}-anim.mp4'); gif = os.path.join(ROOT, f'polly-{tag}-anim.gif')
  subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '60', '-i', f'{fr_dir}/f%04d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4], check=True)
  subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '60', '-i', f'{fr_dir}/f%04d.png', '-vf',
                  'fps=30,scale=380:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer', gif], check=True)
  # film strip around each swap: 18 consecutive frames (every 60 Hz frame)
  strips = []
  for sw in swaps:
    if not sw['from']: continue
    k0 = next((f['n'] for f in log if f['cur'] == sw['to'] and f['n'] > 0 and log[f['n'] - 1]['cur'] == sw['from']), None)
    if k0 is None: continue
    idx = list(range(max(0, k0 - 6), min(n, k0 + 12)))
    tiles = [Image.open(f'{fr_dir}/f{i:04d}.png').crop((200, 120, 920, 585)).resize((240, 155), Image.LANCZOS) for i in idx]
    row = Image.new('RGB', (6 * 244 + 10, 3 * 175 + 30), (16, 17, 21)); d = ImageDraw.Draw(row)
    d.text((8, 6), f"swap {sw['from']} -> {sw['to']} ({'squash' if sw['pop'] else 'blink'}; swapped at closure {sw['closure']:.2f}); every 60 Hz frame, swap frame boxed", fill='white', font=F)
    for j, (i, t) in enumerate(zip(idx, tiles)):
      x = 8 + (j % 6) * 244; y = 28 + (j // 6) * 175
      row.paste(t, (x, y + 16)); d.text((x, y), f"f{i} close {log[i]['close']:.2f} {log[i]['cur']}", fill=(200, 200, 200), font=F)
      if i == k0: d.rectangle((x - 2, y + 14, x + 241, y + 172), outline=(255, 210, 0), width=2)
    strips.append(row)
  if strips:
    S = Image.new('RGB', (strips[0].width, sum(s.height for s in strips)), (16, 17, 21)); y = 0
    for s in strips: S.paste(s, (0, y)); y += s.height
    S.save(os.path.join(ROOT, f'polly-{tag}-swapstrip.png'))
  # dart contact sheet: every 2nd frame from 2 before to 22 after each dart (12 tiles per dart)
  darts = [f['n'] for a, f in zip(log, log[1:]) if f['darts'] != a['darts']]
  drows = []
  for k0 in darts:
    idx = [i for i in range(k0 - 2, k0 + 22, 2) if 0 <= i < n]
    row = Image.new('RGB', (6 * 244 + 10, 2 * 175 + 30), (16, 17, 21)); d = ImageDraw.Draw(row)
    d.text((8, 6), f"dart at f{k0} ({log[k0]['cur']}, {log[k0]['label'][:60]}); every 2nd 60 Hz frame", fill='white', font=F)
    for j, i in enumerate(idx):
      t = Image.open(f'{fr_dir}/f{i:04d}.png').crop((90, 100, 1030, 690)).resize((240, 150), Image.LANCZOS)
      x = 8 + (j % 6) * 244; y = 28 + (j // 6) * 175
      row.paste(t, (x, y + 16)); d.text((x, y), f"f{i} close {log[i]['close']:.2f} gaze ({log[i]['gaze'][0]:+.2f},{log[i]['gaze'][1]:+.2f})", fill=(200, 200, 200), font=F)
    drows.append(row)
  if drows:
    S = Image.new('RGB', (drows[0].width, sum(s.height for s in drows)), (16, 17, 21)); y = 0
    for s_ in drows: S.paste(s_, (0, y)); y += s_.height
    S.save(os.path.join(ROOT, f'polly-{tag}-dartframes.png'))
  # hard-cut audit
  bad_swaps = [(a['n'], a['cur'], f['cur'], f['close']) for a, f in zip(log, log[1:]) if a['cur'] != f['cur'] and f['close'] < .9]
  diffs = []
  for i in range(1, n):
    A_ = np.asarray(Image.open(f'{fr_dir}/f{i - 1:04d}.png').crop((0, 60, 1120, 760))).astype(np.int16)
    B_ = np.asarray(Image.open(f'{fr_dir}/f{i:04d}.png').crop((0, 60, 1120, 760))).astype(np.int16)
    diffs.append(float(np.abs(A_ - B_).mean()))
  jumps = [(i + 1, round(dv, 2), log[i + 1]['close'], log[i]['close']) for i, dv in enumerate(diffs) if dv > 6 and max(log[i + 1]['close'], log[i]['close']) < .5]
  json.dump(dict(bad_swaps=bad_swaps, jumps=jumps, diffs=diffs, darts=darts), open(f'{out}/polly-{tag}-cuts.json', 'w'))
  print('swap frames drawn < .9 closed:', bad_swaps, '| big jumps on open frames:', jumps[:20], '| darts', len(darts))
  print('frames', n, 'swaps', swaps, 'errors', errs[:3], 'mp4', os.path.getsize(mp4) // 1024, 'KB gif', os.path.getsize(gif) // 1024, 'KB')

if __name__ == '__main__': main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/em/anim', sys.argv[2] if len(sys.argv) > 2 else 'v51')
