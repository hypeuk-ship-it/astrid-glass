"""Classic / non-Polly pixel identity: every non-Polly shape rendered on a baseline server (default :8769 = 5dc042d) and
on the working tree (:8767), same seed / pose / coat; reports differing pixels (must be 0).
   python3 tools/polly_classic_identity.py [base_port] [new_port] [outdir]"""
import sys, os, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np; from PIL import Image
from cdp import Page
QS = ['?eyes=stadium&still&noadapt&seed=7&coat=carbon&mode=dark', '?eyes=stadium&still&noadapt&seed=7&coat=glass',
      '?eyes=stadium&still&noadapt&seed=7&toon=1&coat=carbon&mode=dark', '?eyes=stadium&noadapt&seed=7&coat=carbon&mode=dark',
      '?eyes=bean&still&noadapt&seed=7&coat=carbon&mode=dark', '?eyes=dot&still&noadapt&seed=7&coat=carbon&mode=dark',
      '?eyes=egg&still&noadapt&seed=7&coat=carbon&mode=dark', '?eyes=oval&still&noadapt&seed=7&coat=carbon&mode=dark',
      '?eyes=ref&still&noadapt&seed=7&coat=carbon&mode=dark', '?eyes=squircle&still&noadapt&seed=7&coat=carbon&mode=dark',
      '?eyes=toon&still&noadapt&seed=7&coat=carbon&mode=dark', '?eyes=oval&still&noadapt&seed=7&toon=1&coat=glass']
def main(bp=8769, np_=8767, out='/tmp/p51/classic'):
  os.makedirs(out, exist_ok=True); p = Page(620, 680); res = []
  try:
    for k, q in enumerate(QS):
      ims = []
      for port in (bp, np_):
        p.go(f'http://127.0.0.1:{port}/index.html{q}', 1.0)
        p.ev('document.querySelectorAll(".emoteBar,.sheetBar,.eyes,.coats,.bar").forEach(e=>e.style.display="none")')
        steps = [[0, 120, 120]] * 20 if 'still' in q else [[2, 120, 120]] * 40 + [[2, 40, 150]] * 40 + [[2, 220, 80]] * 40
        p.ev('__astrid.drive(%s)' % json.dumps(steps)); time.sleep(.1); p.ev('__astrid.kick()'); time.sleep(.1)
        p.shot(f'{out}/_c.png'); ims.append(np.asarray(Image.open(f'{out}/_c.png').convert('RGB')).astype(int))
      d = np.abs(ims[0] - ims[1]).max(-1); res.append(dict(q=q, diff_px=int((d > 0).sum()), max=int(d.max())))
      Image.fromarray(np.concatenate(ims, 1).astype(np.uint8)).save(f'{out}/classic-{k}.png')
      print(res[-1], flush=True)
    errs = p.errors()
  finally: p.close()
  json.dump(dict(results=res, errors=errs), open(f'{out}/classic.json', 'w'), indent=1)
  print('ALL IDENTICAL' if all(r['diff_px'] == 0 for r in res) else 'DIFFERENT', 'errors', errs[:3])
if __name__ == '__main__':
  a = sys.argv[1:]; main(int(a[0]) if a else 8769, int(a[1]) if len(a) > 1 else 8767, a[2] if len(a) > 2 else '/tmp/p51/classic')
