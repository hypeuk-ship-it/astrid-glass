"""v6 leak / hole / shut-pupil sweep on the LIVE glass path, brows + FX off (?nodeco), so only the eye stack is measured.
Per emotion: 9 gaze targets (centre, 4 sides, 4 diagonals at the pointer limits), each captured once the dart has landed and
the lid is open, plus every frame of one blink that is >= .97 shut. Frames -> /tmp/p6/leak/dart-<emo>-<k>.png and
shut-<emo>-<k>.png; tools/polly_live_leak.analyse gives leak px (pupil hue outside the sclera hull + 3 px) and hole px
(background inside the eroded hull). Shut frames: sclera px and pupil-hue px must be ~0 (only lash art).
   python3 tools/polly_v6_leak.py [emotions...]"""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np
from PIL import Image
import polly_v6
polly_v6.BASE += '&nodeco'
from polly_v6 import Rig, IDS
from polly_live_leak import analyse, classify, PAL
OUT = '/tmp/p6/leak'
TG = [(120, 120), (-80, 120), (320, 120), (120, -60), (120, 300), (-80, -60), (320, -60), (-80, 300), (320, 300)]
def settle(r, x, y):
  r.drive(x, y, 30)
  for _ in range(30):
    st = r.st()
    if st['lClose'] < .01 and st['bp'] == 0 and abs(st['gaze'][0] - st['gz']['tx']) < .03 and abs(st['gaze'][1] - st['gz']['ty']) < .03: break
    r.drive(x, y, 5)
  r.drive(x, y, 6)
def main(emos):
  os.makedirs(OUT, exist_ok=True); r = Rig(); res = {}
  try:
    for e in emos:
      r.go(e); res[e] = dict(dart=[], shut=[])
      for k, (x, y) in enumerate(TG):
        settle(r, x, y); f = f'{OUT}/dart-{e}-{k}.png'; r.shot().save(f)
        a = analyse(f, 0, e); res[e]['dart'].append(dict(k=k, gaze=r.st()['gaze'], leak=a['leak'], hole=a['hole'], lxy=a['leak_xy'][:2], hxy=a['hole_xy'][:3]))
      for attempt in range(4):                  # a scheduled half blink (sleepy / bored) never shuts: blink again
        settle(r, 120, 120); r.p.ev('__astrid.blinkNow(1)'); got = 0
        for i in range(45):
          r.drive(120, 120, 1); st = r.st()
          if st['lid'][0] >= .97:
            got += 1; f = f'{OUT}/shut-{e}-{i}.png'; im = r.shot(); im.save(f)
            w, lav, ink, pup, bg = classify(np.asarray(im), PAL.get(e))
            res[e]['shut'].append(dict(i=i, lid=round(st['lid'][0], 3), sclera=int((w | lav).sum()), pupil=int(pup.sum()) if PAL.get(e) is not None else 0))
        if got: break
      for i in range(0):
        r.drive(120, 120, 1); st = r.st()
        if st['lid'][0] >= .97:
          f = f'{OUT}/shut-{e}-{i}.png'; im = r.shot(); im.save(f)
          w, lav, ink, pup, bg = classify(np.asarray(im), PAL.get(e))
          res[e]['shut'].append(dict(i=i, lid=round(st['lid'][0], 3), sclera=int((w | lav).sum()), pupil=int(pup.sum()) if PAL.get(e) is not None else 0))
      d = res[e]['dart']; s = res[e]['shut']
      print(e, 'leak', sum(q['leak'] for q in d), 'hole', sum(q['hole'] for q in d), 'shut frames', len(s), 'max sclera', max([q['sclera'] for q in s] or [0]), 'max pupil', max([q['pupil'] for q in s] or [0]), flush=True)
  finally: r.close()
  json.dump(res, open(f'{OUT}/leak.json', 'w'), indent=0)
if __name__ == '__main__': main(sys.argv[1:] or IDS)
