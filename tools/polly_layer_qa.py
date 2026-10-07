"""Polly layered-rig QA (v5 gates).
Renders every emotion in the rig's QA pose (rest gaze, ?qa 1:1 blit of the layer composite), extracts WHITE / PUPIL /
BLACK from the render with the SAME colour classifier as the reference (polly_layers.py) and gates each layer with a
metric that suits its geometry:
  WHITE (large fills)        IoU >= .995 per eye, mean >= .995, AND symmetric boundary distance max <= 1 px
  PUPIL (coloured + motifs   IoU >= .99, Boundary IoU (d = 2 px, Cheng et al. 2021) >= .95, mean CIEDE2000 on the
         + highlights)       interior (pupil eroded 2 px) <= 2, same connected-component count (8-conn)
  BLACK (outline, lashes,    symmetric boundary (chamfer) distance mean <= .35 px, max <= 1 px, same component count and
         pupil cores)        Euler number (no broken / merged strokes). Not IoU: a 4 px stroke needs ~0.01 px for 99.5%.
  ANIMATION                  every frame of a scripted gaze sweep (+ an expression swap) rendered in the QA blit with
                             debug codes (R = white-body coverage, G = visible moving layers, B = moving layers before the
                             clip): zero pupil/core/highlight pixels outside the white; swaps only on frames with
                             closure >= .9.
Also: gaze test sheet (forced L/R/U/D), live preview sheet, SDF magnification diagnostic (2x, not gated).
   python3 tools/polly_layer_qa.py [outdir]      (needs the local server on :8767 and /tmp/cdp.py)"""
import sys, os, json, time, math
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, '/tmp'); sys.path.insert(0, HERE)
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from skimage.color import rgb2lab, deltaE_ciede2000
from skimage.measure import euler_number
from polly_layers import classify, layer_masks, HL_HULL
from cdp import Page
IDS = ['cheerful','confident','bored','angry','sleepy','smug','furious','starry','pleading','love','dizzy','blush']
REF = '/workspace/eye-emotes/refs/cells/polly-{i:02d}-{e}.png'
BASE = 'http://127.0.0.1:8767/index.html?noadapt&seed=7&coat=carbon&mode=dark&sheet=polly&toon=1'
IDLE = json.dumps([[0, 120, 120]] * 24)
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
FS = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 10)
FB = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
G = dict(white_iou=.995, white_bmax=1.0, pupil_iou=.99, pupil_biou=.95, pupil_de=2.0, black_cmean=.35, black_bmax=1.0)
K8 = np.ones((3, 3), bool)

def layers3(c):
  M = layer_masks(c)
  return dict(white=M['white'], pupil=M['pupil'], black=M['outline'] | M['core'])

def wait_ready(p):
  for _ in range(100):
    if p.ev('window.__astrid && window.__astrid.atlasReady && window.__astrid.atlasReady()'): return
    time.sleep(.05)

def info_of(p):
  return json.loads(p.ev('JSON.stringify(Object.assign(__astrid.layers(),{css:(()=>{const c=document.getElementById("gl");return [c.offsetLeft,c.offsetTop]})()}))'))

def shoot(p, eid, extra, path, still=True):
  p.go(f'{BASE}{"&still" if still else ""}&eyes=polly-{eid}{extra}', .6)
  p.ev('document.querySelectorAll(".emoteBar,.sheetBar,.eyes,.coats").forEach(e=>e.style.display="none")')
  wait_ready(p)
  p.ev('__astrid.drive(%s)' % IDLE); time.sleep(.05); p.ev('__astrid.kick()'); time.sleep(.1)
  info = info_of(p)
  qb = p.ev('JSON.stringify(__astrid.qaBlit())')
  assert '"disp":"none"' in qb or '"cv":false' in qb, 'v4 ref-mask blit canvas visible: ' + qb   # gate must measure the rig, not the ref
  p.shot(path); return info

# ---------------- metrics ----------------
def iou(a, b):
  u = (a | b).sum(); return 1.0 if u == 0 else float((a & b).sum() / u)
def bnd(m): return m & ~ndi.binary_erosion(m, K8, border_value=0)
def bdist(a, b):
  """symmetric boundary distance (px) between two masks: mean (chamfer), max (Hausdorff), p99"""
  A, B = bnd(a), bnd(b)
  if not A.any() and not B.any(): return dict(mean=0.0, max=0.0, p99=0.0)
  if not A.any() or not B.any(): return dict(mean=99.0, max=99.0, p99=99.0)
  d = np.r_[ndi.distance_transform_edt(~B)[A], ndi.distance_transform_edt(~A)[B]]
  return dict(mean=float(d.mean()), max=float(d.max()), p99=float(np.percentile(d, 99)))
def biou(g, p, d=2):
  if not g.any() and not p.any(): return 1.0
  gd = g & (ndi.distance_transform_edt(g) <= d); pd = p & (ndi.distance_transform_edt(p) <= d)
  return iou(gd, pd)
def ncomp(m): return int(ndi.label(m, K8)[1])
def euler(m): return int(euler_number(m, connectivity=2)) if m.any() else 0
def delta_e(ref, ours, m):
  inner = ndi.binary_erosion(m, K8, iterations=2)
  if inner.sum() < 8: inner = ndi.binary_erosion(m, K8, iterations=1)
  if inner.sum() < 8: inner = m
  if not inner.any(): return dict(mean=0.0, p95=0.0, n=0)
  la, lb = rgb2lab(ref[inner][None] / 255.0)[0], rgb2lab(ours[inner][None] / 255.0)[0]
  de = deltaE_ciede2000(la, lb)
  return dict(mean=float(de.mean()), p95=float(np.percentile(de, 95)), n=int(inner.sum()))

def eye_metrics(rl, ol, ref, crop):
  w = dict(iou=iou(rl['white'], ol['white']), **{'b' + k: v for k, v in bdist(rl['white'], ol['white']).items()})
  w['pass'] = w['iou'] >= G['white_iou'] and w['bmax'] <= G['white_bmax']
  rp, op = rl['pupil'], ol['pupil']
  pu = dict(iou=iou(rp, op), biou=biou(rp, op), de=delta_e(ref, crop, rp), comps=[ncomp(rp), ncomp(op)], area=[int(rp.sum()), int(op.sum())],
            empty=bool(not rp.any() and not op.any()))
  pu['pass'] = pu['iou'] >= G['pupil_iou'] and pu['biou'] >= G['pupil_biou'] and pu['de']['mean'] <= G['pupil_de'] and pu['comps'][0] == pu['comps'][1]
  rb, ob = rl['black'], ol['black']
  bd = bdist(rb, ob)
  bk = dict(cmean=bd['mean'], bmax=bd['max'], p99=bd['p99'], comps=[ncomp(rb), ncomp(ob)], euler=[euler(rb), euler(ob)], iou_info=iou(rb, ob))
  bk['pass'] = bk['cmean'] <= G['black_cmean'] and bk['bmax'] <= G['black_bmax'] and bk['comps'][0] == bk['comps'][1] and bk['euler'][0] == bk['euler'][1]
  return dict(white=w, pupil=pu, black=bk)

def evaluate(eid, i, shot, info, rt):
  ref = np.asarray(Image.open(REF.format(i=i, e=eid)).convert('RGB'))
  H, W = ref.shape[:2]
  em = rt['emotes'][eid]['eyes']
  ox = info['css'][0] + info['qaL'][0] - em['L']['refOrigin'][0]; oy = info['css'][1] + info['qaL'][1] - em['L']['refOrigin'][1]
  ours_full = np.asarray(Image.open(shot).convert('RGB'))
  rc = classify(ref, eid in HL_HULL); rl = [layers3(c) for c in rc]; rF = [c['F'] for c in rc]
  best = None
  for dy in range(-3, 4):          # verify the alignment instead of trusting it: best footprint overlap in +-3 px
    for dx in range(-3, 4):
      crop = ours_full[oy + dy:oy + dy + H, ox + dx:ox + dx + W]
      if crop.shape[:2] != (H, W): continue
      oc = classify(np.ascontiguousarray(crop), eid in HL_HULL)
      sc = np.mean([iou(rF[k], oc[k]['F']) for k in range(2)])
      if best is None or sc > best[0]: best = (sc, dx, dy, oc, crop)
      if sc > .9999: break
    if best and best[0] > .9999: break
  _, dx, dy, oc, crop = best
  ol = [layers3(c) for c in oc]
  eyes = [eye_metrics(rl[k], ol[k], ref, crop) for k in range(2)]
  return dict(L=eyes[0], R=eyes[1]), (dx, dy), ref, crop, rl, ol

def overlay(a, b, box):
  x0, y0, x1, y1 = box
  t = np.full((y1 - y0, x1 - x0, 3), 255, np.uint8)
  A, B = a[y0:y1, x0:x1], b[y0:y1, x0:x1]
  t[A & B] = (150, 150, 150); t[A & ~B] = (235, 40, 40); t[B & ~A] = (40, 80, 245)
  return Image.fromarray(t)

def fmt(L, m):
  if L == 'white': return f"IoU {m['iou']:.4f} bmax {m['bmax']:.2f}"
  if L == 'pupil':
    if m['empty']: return 'none (no coloured pupil)'
    return f"IoU {m['iou']:.4f} bIoU {m['biou']:.3f} dE {m['de']['mean']:.2f} cc {m['comps'][0]}/{m['comps'][1]}"
  return f"ch {m['cmean']:.2f} max {m['bmax']:.2f} cc {m['comps'][0]}/{m['comps'][1]} eu {m['euler'][0]}/{m['euler'][1]}"

# ---------------- animation leak sweep ----------------
PATH = [(120, 120, 18), (-50, 120, 24), (290, 120, 24), (120, -50, 22), (120, 290, 22), (290, 290, 20), (-50, -50, 20), (200, 60, 14), (120, 120, 16)]
def leak_sweep(p, eid, nxt, out, keep=()):
  p.go(f'{BASE}&qa&eyes=polly-{eid}', .6)
  p.ev('document.querySelectorAll(".emoteBar,.sheetBar,.eyes,.coats,.bar").forEach(e=>e.style.display="none")')
  wait_ready(p); p.ev('__astrid.layDbg(1)');
  cr = json.loads(p.ev('JSON.stringify((()=>{const c=document.getElementById("gl").getBoundingClientRect();return [Math.round(c.left),Math.round(c.top),Math.round(c.right),Math.round(c.bottom)]})())'))
  p.ev('__astrid.drive(%s)' % json.dumps([[0, 120, 120]] * 6)); time.sleep(.05)
  frames = []; k = 0; steps = []
  for (x, y, n) in PATH: steps += [(x, y)] * n
  swap_at = len(steps); steps += [(120, 120)] * 30            # expression swap behind a blink (debug sweep animates)
  for fi, (x, y) in enumerate(steps):
    if fi == swap_at: p.ev(f'__astrid.setEyes("polly-{nxt}")')
    p.ev('__astrid.drive(%s)' % json.dumps([[2, x, y]]))
    st = info_of(p)
    path = f'{out}/_leak.png'; p.shot(path)
    im = np.asarray(Image.open(path).convert('RGB')).astype(int)[max(0, cr[1]):cr[3], max(0, cr[0]):cr[2]]   # canvas only (page UI is not the rig)
    R, Gc, B = im[..., 0] > 127, im[..., 1] > 127, im[..., 2] > 127
    leak = int((Gc & ~R).sum()); clipped = int((B & ~R).sum())
    fr = dict(f=fi, cur=st['cur'], close=round(st['close'], 3), lClose=round(st['lClose'], 3), offL=[round(v, 2) for v in st['offL']], offR=[round(v, 2) for v in st['offR']],
              hl=[round(v, 2) for v in st['hl']], sL=round(st['sL'], 4), sR=round(st['sR'], 4), leak=leak, clipped=clipped, moving=int(B.sum()))
    frames.append(fr)
    if fi in keep: Image.fromarray(im.astype(np.uint8)).save(f'{out}/leak-{eid}-f{fi:03d}.png')
  swaps = info_of(p)['swaps']
  return frames, swaps, swap_at

def main(out, do_leak=True, do_mag=True):
  os.makedirs(out, exist_ok=True)
  rt = json.load(open(os.path.join(ROOT, 'polly-layer-atlas.json')))
  p = Page(620, 680); results = {}; rows = []; errs = []
  try:
    # ---- 1. QA pose, rest gaze ----
    for i, e in enumerate(IDS):
      shot = f'{out}/qa-{e}.png'; info = shoot(p, e, '&qa', shot)
      r, sh, ref, crop, rl, ol = evaluate(e, i, shot, info, rt)
      r['_align'] = sh; r['_offsets'] = dict(L=info['offL'], R=info['offR']); results[e] = r
      print(f"{e:10s} " + ' | '.join(f"{L}: " + ' / '.join(fmt(L, r[s][L]) + ('' if r[s][L]['pass'] else ' FAIL') for s in 'LR') for L in ('white', 'pupil', 'black')) + f"  align {sh}", flush=True)
      allm = np.zeros(ref.shape[:2], bool)
      for k in range(2):
        for L in ('white', 'pupil', 'black'): allm |= rl[k][L] | ol[k][L]
      ys, xs = np.nonzero(allm); box = (max(0, xs.min() - 4), max(0, ys.min() - 4), min(ref.shape[1], xs.max() + 5), min(ref.shape[0], ys.max() + 5))
      bw, bh = box[2] - box[0], box[3] - box[1]; sc = 230 / bw; th = int(bh * sc)
      tiles = [Image.fromarray(ref[box[1]:box[3], box[0]:box[2]]).resize((230, th), Image.LANCZOS),
               Image.fromarray(crop[box[1]:box[3], box[0]:box[2]]).resize((230, th), Image.LANCZOS)]
      for L in ('white', 'pupil', 'black'):
        tiles.append(overlay(rl[0][L] | rl[1][L], ol[0][L] | ol[1][L], box).resize((230, th), Image.NEAREST))
      row = Image.new('RGB', (8 + 5 * 238, th + 50), 'white'); d = ImageDraw.Draw(row)
      d.text((8, 4), e, fill=(0, 0, 0), font=FB)
      for k, t in enumerate(tiles):
        x = 8 + k * 238; row.paste(t, (x, 46))
        if k == 0: d.text((x, 30), 'reference', fill=(60, 60, 60), font=F)
        elif k == 1: d.text((x, 30), 'rig render (QA pose)', fill=(60, 60, 60), font=F)
        else:
          L = ('white', 'pupil', 'black')[k - 2]
          for j, s in enumerate('LR'):
            m = r[s][L]; d.text((x, 20 + 12 * j), f"{L[0].upper()}{s} " + fmt(L, m), fill=(0, 120, 0) if m['pass'] else (190, 0, 0), font=FS)
      rows.append(row)
    # ---- 2. gaze test (QA pose; forced gaze via the rig's own ?yaw/?pitch hook; lid follows the vertical gaze) ----
    gz = [('rest', ''), ('left', '&yaw=-0.5'), ('right', '&yaw=0.5'), ('up', '&pitch=-0.34'), ('down', '&pitch=0.34')]
    grows = []; gaze = {}
    for i, e in enumerate(IDS):
      tiles = []; gaze[e] = {}
      for nm, q in gz:
        path = f'{out}/gaze-{e}-{nm}.png'; info = shoot(p, e, '&qa' + q, path)
        gaze[e][nm] = dict(offL=info['offL'], offR=info['offR'], rawL=info['rawL'], rawR=info['rawR'], hl=info['hl'], close=info['close'])
        im = Image.open(path).convert('RGB')
        cx = info['css'][0] + (info['qaL'][0] + info['qaR'][0] + rt['cw']) // 2; cy = info['css'][1] + info['qaL'][1] + rt['ch'] // 2
        c = im.crop((cx - 200, cy - 85, cx + 200, cy + 85)); a = np.asarray(c).copy()
        yy, xx = np.mgrid[cy - 85:cy + 85, cx - 200:cx + 200]          # page outside the canvas -> grey (cosmetic; ink untouched)
        outside = (xx < info['css'][0]) | (xx >= info['css'][0] + info['W']) | (yy < info['css'][1]) | (yy >= info['css'][1] + info['H'])
        a[outside] = (136, 136, 136)
        tiles.append((nm, Image.fromarray(a).resize((240, 102), Image.LANCZOS), info))
      row = Image.new('RGB', (8 + 5 * 246, 102 + 34), 'white'); d = ImageDraw.Draw(row); d.text((8, 2), e, fill=(0, 0, 0), font=FB)
      for k, (nm, t, info) in enumerate(tiles):
        x = 8 + k * 246; row.paste(t, (x, 32))
        d.text((x + 40, 17), f"{nm}  L({info['offL'][0]:+.0f},{info['offL'][1]:+.0f}) R({info['offR'][0]:+.0f},{info['offR'][1]:+.0f})", fill=(60, 60, 60), font=F)
      grows.append(row)
    # ---- 3. live preview (glass path, rest + a glance) ----
    prev = []
    for e in IDS:
      for nm, q in (('rest', ''), ('glance', '&yaw=0.35&pitch=0.15')):
        path = f'{out}/live-{e}-{nm}.png'; info = shoot(p, e, q, path)
        im = Image.open(path).convert('RGB'); cx = info['css'][0] + info['W'] // 2; cy = info['css'][1] + info['H'] // 2
        prev.append((e, nm, im.crop((cx - 120, cy - 120, cx + 120, cy + 120))))
    errs += p.errors()
  finally:
    p.close()
  # ---- 4. animation leak sweep (every frame) ----
  leak = {}
  if do_leak:
    p = Page(620, 680)
    try:
      for i, e in enumerate(IDS):
        nxt = IDS[(i + 1) % len(IDS)]
        frames, swaps, swap_at = leak_sweep(p, e, nxt, out, keep=(40, 100, 152, 165))
        L = dict(frames=len(frames), leak_px=sum(f['leak'] for f in frames), leak_frames=sum(1 for f in frames if f['leak']),
                 max_clipped=max(f['clipped'] for f in frames), rest_clipped=frames[0]['clipped'],
                 swaps=[s for s in swaps if s['from']], swap_at_frame=swap_at,
                 swap_ok=all(s['closure'] >= .9 for s in swaps if s['from']) and any(s['from'] for s in swaps),
                 cur_changes=[(f['f'], f['cur'], f['lClose']) for a, f in zip(frames, frames[1:]) if a['cur'] != f['cur']],
                 min_close_after_swap=min(f['lClose'] for f in frames[swap_at:]), max_scale=max(max(f['sL'], f['sR']) for f in frames))
        leak[e] = L
        print(f"leak {e:10s} frames {L['frames']} leak_px {L['leak_px']} max_clipped {L['max_clipped']} (rest {L['rest_clipped']}) swap {L['swaps']} cur_changes {L['cur_changes']} reopen-min {L['min_close_after_swap']}", flush=True)
        json.dump(frames, open(f'{out}/leak-{e}-frames.json', 'w'))
      errs += p.errors()
    finally:
      p.close()
  # ---- 5. SDF magnification diagnostic (2x, smooth SDF edges vs the nearest-upsampled reference masks; not gated) ----
  mag = {}
  if do_mag:
    p = Page(1300, 1100)
    try:
      for i, e in enumerate(IDS):
        p.go(f'{BASE}&still&qa&eyes=polly-{e}', .6); wait_ready(p)
        p.ev('__astrid.layScale(2)'); p.ev('__astrid.layDbg(2)'); p.ev('__astrid.drive(%s)' % IDLE); time.sleep(.05); p.ev('__astrid.kick()'); time.sleep(.1)
        info = info_of(p); path = f'{out}/_mag.png'; p.shot(path)
        im = np.asarray(Image.open(path).convert('RGB')).astype(int)
        em = rt['emotes'][e]['eyes']; rec = {}
        for s, side in enumerate('LR'):
          o = info['qaL'] if side == 'L' else info['qaR']
          x0, y0 = info['css'][0] + int(round(o[0])), info['css'][1] + int(round(o[1]))
          tile = im[y0:y0 + 2 * rt['ch'], x0:x0 + 2 * rt['cw']]
          meta = json.load(open(os.path.join(ROOT, 'emotes/polly-layers/meta.json')))['eyes'][e][side]
          bx = meta['bbox']; cw, ch = rt['cw'], rt['ch']; w, h = bx[2] - bx[0], bx[3] - bx[1]; oxc, oyc = (cw - w) // 2, (ch - h) // 2
          def up(nm):
            m = np.asarray(Image.open(os.path.join(ROOT, f'emotes/polly-layers/masks/{e}-{side}-{nm}.png'))) > 127
            c = np.zeros((ch, cw), bool); c[oyc:oyc + h, oxc:oxc + w] = m
            return np.kron(c, np.ones((2, 2), bool))
          body_ref = up('body'); ol_ref = up('outline')
          body_ours = tile[..., 0] > 127; ol_ours = tile[..., 2] > 127
          if body_ours.shape != body_ref.shape: continue
          rec[side] = dict(body=bdist(body_ref, body_ours), outline=bdist(ol_ref, ol_ours), body_iou=iou(body_ref, body_ours), outline_iou=iou(ol_ref, ol_ours))
          if e in ('starry', 'dizzy') and side == 'L':
            Image.fromarray(tile.astype(np.uint8)).save(f'{out}/mag-{e}-L-codes.png')
        mag[e] = rec
      p.go(f'{BASE}&still&qa&eyes=polly-starry', .6); wait_ready(p); p.ev('__astrid.layScale(3)'); p.ev('__astrid.drive(%s)' % IDLE); time.sleep(.05); p.ev('__astrid.kick()'); time.sleep(.1)
      p.shot(f'{out}/mag-starry-3x.png')
      errs += p.errors()
    finally:
      p.close()
  # ---- sheets + summary ----
  def per(L, key, agg):
    return [agg(results[e][s][L][key] for s in 'LR') for e in IDS]
  means = dict(white_iou=float(np.mean([np.mean([results[e][s]['white']['iou'] for s in 'LR']) for e in IDS])),
               white_bmax=float(max(results[e][s]['white']['bmax'] for e in IDS for s in 'LR')),
               pupil_iou=float(np.mean([np.mean([results[e][s]['pupil']['iou'] for s in 'LR']) for e in IDS if not all(results[e][s]['pupil']['empty'] for s in 'LR')])),
               pupil_biou=float(np.mean([np.mean([results[e][s]['pupil']['biou'] for s in 'LR']) for e in IDS])),
               pupil_de=float(np.mean([np.mean([results[e][s]['pupil']['de']['mean'] for s in 'LR']) for e in IDS])),
               black_cmean=float(np.mean([np.mean([results[e][s]['black']['cmean'] for s in 'LR']) for e in IDS])),
               black_bmax=float(max(results[e][s]['black']['bmax'] for e in IDS for s in 'LR')))
  layer_pass = {L: all(results[e][s][L]['pass'] for e in IDS for s in 'LR') for L in ('white', 'pupil', 'black')}
  mean_pass = means['white_iou'] >= G['white_iou'] and means['pupil_iou'] >= G['pupil_iou'] and means['black_cmean'] <= G['black_cmean']
  leak_pass = (not do_leak) or all(v['leak_px'] == 0 and v['swap_ok'] for v in leak.values())
  passed = all(layer_pass.values()) and mean_pass and leak_pass and do_leak
  Hs = sum(r.height for r in rows) + 80
  S = Image.new('RGB', (rows[0].width, Hs), 'white'); d = ImageDraw.Draw(S)
  d.text((8, 6), "Polly layered-rig QA (rig QA pose, rest gaze, 1:1)   red = ref only · blue = ours only · grey = both", fill=(0, 0, 0), font=F)
  d.text((8, 22), f"gates: white IoU>={G['white_iou']} & bmax<={G['white_bmax']}px | pupil IoU>={G['pupil_iou']} & bIoU(2px)>={G['pupil_biou']} & dE00<={G['pupil_de']} & same comps | black chamfer<={G['black_cmean']}px & max<={G['black_bmax']}px & same comps/Euler", fill=(0, 0, 0), font=FS)
  d.text((8, 40), f"white IoU mean {means['white_iou']:.4f} bmax {means['white_bmax']:.2f} | pupil IoU mean {means['pupil_iou']:.4f} bIoU {means['pupil_biou']:.3f} dE {means['pupil_de']:.2f} | black chamfer mean {means['black_cmean']:.3f} max {means['black_bmax']:.2f}"
         + ('   ALL PASS' if passed else '   NOT PASSED'), fill=(0, 120, 0) if passed else (190, 0, 0), font=FB)
  y = 66
  for r in rows: S.paste(r, (0, y)); y += r.height
  S.save(f'{out}/polly-layers-qa.png')
  Gs = Image.new('RGB', (grows[0].width, sum(r.height for r in grows) + 30), 'white'); d = ImageDraw.Draw(Gs)
  d.text((8, 6), 'Polly gaze test (QA pose; pupil + core + highlight follow the gaze, highlight at 0.4x travel; engage-only containment; lid follows down-gaze; offsets in texels)', fill=(0, 0, 0), font=F)
  y = 28
  for r in grows: Gs.paste(r, (0, y)); y += r.height
  Gs.save(f'{out}/polly-layers-gaze.png')
  P = Image.new('RGB', (6 * 240 + 70, 4 * 262 + 30), '#15161a'); d = ImageDraw.Draw(P)
  d.text((8, 6), 'Polly layered rig, live glass path (carbon/dark): rest | glance right-down', fill='white', font=F)
  for k, (e, nm, im) in enumerate(prev):
    x = 10 + (k % 6) * 250; yy = 26 + (k // 6) * 262; P.paste(im, (x, yy + 16)); d.text((x, yy), f'{e} {nm}', fill='#ddd', font=F)
  P.save(f'{out}/polly-layers-preview.png')
  summary = dict(gates=G, passed=passed, layer_pass=layer_pass, mean_pass=mean_pass, leak_pass=leak_pass, means=means, results=results,
                 gaze=gaze, leak=leak, mag=mag, errors=[e for e in errs if 'willReadFrequently' not in e])
  json.dump(summary, open(f'{out}/polly-layers-iou.json', 'w'), indent=1)
  print('MEANS', {k: round(v, 4) for k, v in means.items()}, 'LAYER PASS', layer_pass, 'MEAN PASS', mean_pass, 'LEAK PASS', leak_pass, 'PASS', passed)
  if summary['errors']: print('PAGE ERRORS', summary['errors'][:5])
  return summary

if __name__ == '__main__':
  a = [x for x in sys.argv[1:] if not x.startswith('--')]
  main(a[0] if a else '/tmp/em/layers', do_leak='--noleak' not in sys.argv, do_mag='--nomag' not in sys.argv)
