"""Polly layered rig: animation capture (live glass path, deterministic ?seed, one frame per 60 Hz tick).
Scenes: gaze darts + holds (cheerful), expression swap behind a blink (confident -> bored), pop swap on a squash frame
(-> love, hearts lub-dub), starry twinkle, dizzy spin. Writes polly-v5-anim.mp4 / .gif + a swap film strip.
   python3 tools/polly_anim.py [outdir]"""
import sys, os, json, time, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE); sys.path.insert(0, '/tmp')
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from cdp import Page
BASE = 'http://127.0.0.1:8767/index.html?noadapt&seed=7&coat=carbon&mode=dark&sheet=polly&toon=1'
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
FB = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)

def main(out):
  fr_dir = os.path.join(out, 'frames'); shutil.rmtree(fr_dir, ignore_errors=True); os.makedirs(fr_dir)
  p = Page(620, 680)
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
        cx, cy = css[0] + css[2] // 2, css[1] + css[3] // 2
        crop = im.crop((cx - 190, cy - 125, cx + 190, cy + 95)).resize((760, 440), Image.LANCZOS)
        canvas = Image.new('RGB', (760, 500), (16, 17, 21)); canvas.paste(crop, (0, 60)); d = ImageDraw.Draw(canvas)
        d.text((12, 8), label, fill='white', font=FB)
        d.text((12, 32), f"t {n * 1000 / 60:6.0f} ms   showing {st['cur']}{(' -> ' + st['pending']) if st['pending'] else ''}   closure {st['close']:.2f}   gaze ({st['gaze'][0]:+.2f},{st['gaze'][1]:+.2f})   pupil scale {st['sL']:.2f}/{st['sR']:.2f}", fill=(190, 190, 200), font=F)
        canvas.save(f'{fr_dir}/f{n:04d}.png')
        log.append(dict(n=n, label=label, cur=st['cur'], pending=st['pending'], close=round(st['close'], 3), gaze=st['gaze'], sL=st['sL'], sR=st['sR'], rL=st['rL'], rR=st['rR'], hl=st['hl'], offL=st['offL']))
        n += 1
    swaps = json.loads(p.ev('JSON.stringify(__astrid.layers().swaps)'))
    errs = [e for e in p.errors() if 'willReadFrequently' not in e]
  finally:
    p.close()
  json.dump(dict(frames=log, swaps=swaps, errors=errs), open(f'{out}/polly-v5-anim.json', 'w'), indent=0)
  mp4 = os.path.join(ROOT, 'polly-v5-anim.mp4'); gif = os.path.join(ROOT, 'polly-v5-anim.gif')
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
    tiles = [Image.open(f'{fr_dir}/f{i:04d}.png').crop((140, 90, 620, 400)).resize((240, 155), Image.LANCZOS) for i in idx]
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
    S.save(os.path.join(ROOT, 'polly-v5-swapstrip.png'))
  print('frames', n, 'swaps', swaps, 'errors', errs[:3], 'mp4', os.path.getsize(mp4) // 1024, 'KB gif', os.path.getsize(gif) // 1024, 'KB')

if __name__ == '__main__': main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/em/anim')
