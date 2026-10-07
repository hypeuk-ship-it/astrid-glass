"""Contact sheets from a polly_anim.py frame dump (larger tiles than the in-run sheets, for reading by eye):
  polly-<tag>-dartframes.png : every 2nd 60 Hz frame from 2 before to 16 after every gaze dart (eye region crop)
  polly-<tag>-swaps.png      : every 60 Hz frame from 4 before to 9 after every expression swap (swap frame boxed)
   python3 tools/polly_anim_sheets.py [framedir_parent] [tag]"""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
from PIL import Image, ImageDraw, ImageFont
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
TW, TH, COLS = 360, 186, 5
def tile(fr, i): return Image.open(f'{fr}/f{i:04d}.png').crop((40, 150, 1080, 686)).resize((TW, TH), Image.LANCZOS)
def sheet(groups, title, path, fr, log):
  rows = []
  for (k0, label, idx, box) in groups:
    nr = (len(idx) + COLS - 1) // COLS
    row = Image.new('RGB', (COLS * (TW + 6) + 10, nr * (TH + 22) + 28), (16, 17, 21)); d = ImageDraw.Draw(row)
    d.text((8, 6), label, fill='white', font=F)
    for j, i in enumerate(idx):
      x = 8 + (j % COLS) * (TW + 6); y = 26 + (j // COLS) * (TH + 22)
      row.paste(tile(fr, i), (x, y + 18)); f = log[i]
      d.text((x, y + 2), f"f{i} close {f['close']:.2f} {f['cur']} gaze({f['gaze'][0]:+.2f},{f['gaze'][1]:+.2f})", fill=(200, 200, 200), font=F)
      if i == box: d.rectangle((x - 2, y + 16, x + TW + 1, y + TH + 19), outline=(255, 210, 0), width=2)
    rows.append(row)
  S = Image.new('RGB', (rows[0].width, sum(r.height for r in rows) + 30), (16, 17, 21)); d = ImageDraw.Draw(S); d.text((8, 8), title, fill='white', font=F)
  y = 30
  for r in rows: S.paste(r, (0, y)); y += r.height
  S.save(path); return S.size
def main(out, tag):
  J = json.load(open(f'{out}/polly-{tag}-anim.json')); log = J['frames']; fr = f'{out}/frames'; n = len(log)
  darts = [f['n'] for a, f in zip(log, log[1:]) if f['darts'] != a['darts']]
  g = [(k, f"dart at f{k} ({log[k]['cur']}): every 2nd frame", [i for i in range(k - 2, k + 17, 2) if 0 <= i < n], None) for k in darts]
  print('darts', sheet(g, f'Polly {tag}: every gaze dart in the clip, every 2nd 60 Hz frame (live glass path)', os.path.join(ROOT, f'polly-{tag}-dartframes.png'), fr, log))
  sw = [f['n'] for a, f in zip(log, log[1:]) if f['cur'] != a['cur'] and a['cur']]
  g = [(k, f"swap {log[k - 1]['cur']} -> {log[k]['cur']} at f{k} (boxed = first frame showing the new layers; drawn closure {log[k]['close']:.2f})",
        [i for i in range(k - 4, k + 11) if 0 <= i < n], k) for k in sw]
  print('swaps', sheet(g, f'Polly {tag}: every expression swap in the clip, every 60 Hz frame (live glass path)', os.path.join(ROOT, f'polly-{tag}-swaps.png'), fr, log))
if __name__ == '__main__': main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/p51/anim', sys.argv[2] if len(sys.argv) > 2 else 'v51')
