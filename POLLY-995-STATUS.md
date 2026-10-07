# Polly v5 layered rig: gate status (**ALL GATES CLEARED**, pushed, cache-bust ?v=10071053)

## What was measured
The QA pose is the rig's own WebGL composite of the per-layer SDF atlas, at 1:1 device px and rest gaze
(`?sheet=polly&eyes=polly-<id>&toon=1&qa&still&noadapt&seed=7&coat=carbon&mode=dark`). Each shot is classified with the
same colour classifier as the reference (`tools/polly_layers.py`). The old v4 reference-mask blit canvas is checked
as hidden on every shot, so the gate measures the rig, not the reference.
Harness: `tools/polly_layer_qa.py` (gates + gaze + leak sweep), `tools/polly_colour_leak.py` (independent containment),
`tools/polly_sdf_mag.py` (scaling), `tools/polly_anim.py` (video + swap strip), `tools/cdp.py` (headless Chrome driver).

## Gates (per emotion, worse of L/R eye)
White: IoU / max boundary px. Pupil: IoU / boundary IoU (2 px) / mean ΔE00 on the interior. Black: chamfer mean px / max px / components + Euler number.

| emotion | white | coloured pupil / motif | black |
|---|---|---|---|
| cheerful | 1.0000 / 0.00 | 1.0000 / 1.000 / 0.00 | 0.00 / 0.00 / ok |
| confident | 1.0000 / 0.00 | 1.0000 / 1.000 / 0.00 | 0.00 / 0.00 / ok |
| bored | 1.0000 / 0.00 | 1.0000 / 1.000 / 0.00 | 0.00 / 0.00 / ok |
| angry | 1.0000 / 0.00 | 1.0000 / 1.000 / 0.00 | 0.00 / 0.00 / ok |
| sleepy | 1.0000 / 0.00 | n/a (no coloured pupil) | 0.00 / 0.00 / ok |
| smug | 1.0000 / 0.00 | 1.0000 / 1.000 / 0.00 | 0.00 / 0.00 / ok |
| furious | 1.0000 / 0.00 | n/a (no coloured pupil) | 0.00 / 0.00 / ok |
| starry | 1.0000 / 0.00 | 1.0000 / 1.000 / 0.00 | 0.00 / 0.00 / ok |
| pleading | 1.0000 / 0.00 | 1.0000 / 1.000 / 0.00 | 0.00 / 0.00 / ok |
| love | 1.0000 / 0.00 | 1.0000 / 1.000 / 0.00 | 0.00 / 0.00 / ok |
| dizzy | 1.0000 / 0.00 | n/a (no coloured pupil) | 0.00 / 0.00 / ok |
| blush | 1.0000 / 0.00 | n/a (no coloured pupil) | 0.00 / 0.00 / ok |
| **mean** | **1.0000 / max 0.00** | **1.0000 / 1.000 / 0.00** | **0.000 / max 0.00** |

Thresholds: white IoU ≥ .995 and max ≤ 1 px. Pupil IoU ≥ .99, boundary IoU ≥ .95, ΔE00 ≤ 2, same component count.
Black chamfer ≤ .35 px, max ≤ 1 px, same components and Euler number.

**Why every score is exact:** each SDF texel stores d = ±0.5 at the first texel centre on either side of the edge, and the
QA pose uses a hard step at texel centres. At 1:1 the decoded masks are therefore the reference masks bit for bit. RGB
holds the reference colours, and a straight-alpha "fringe" layer carries the pupil's baked anti-aliasing. These scores
show the pipeline is lossless at rest. They do not show how the glass/live path looks.

## Calibration and negative controls (offline, on the reference cells)
- Identity passes every gate: True.
- A 1 px shift fails white on 12/12 emotions, pupil on 8/8, and black on 9/12.
- A ~3 ΔE00 tint (L* −3.5) fails pupil on 8/8.
- ΔE00 threshold 2: the artist's own L-vs-R pupil fill differs by 0.38–2.08 ΔE00.
- Known weakness: the black chamfer gate lets a pure 1 px horizontal shift through on 3/12 emotions, because horizontal strokes do not move. It is necessary, not sufficient, so the overlay sheet is the visual check.

## Animation / leak
- Debug-code sweep: every 60 Hz frame of an L/R/U/D/diagonal sweep plus an expression swap, 12 × 210 frames, gives 0 pupil/core/highlight px outside the white. This is a structural check, because the shader composites every moving layer inside the white-body coverage term.
- Independent check at the 8 gaze limits, colour-classified and compared against the reference footprint: 0 of 213098 moving px fall outside.
- Swap behind a blink (from the animation log): close to 90 % in 33 ms, every layer swaps on the closed frame (closure 0.97–1.08), reopen 150–217 ms with 4–6 % overshoot, total 200–267 ms. Pop emotions (love, starry, furious) swap on a squash frame (closure .97).

## Scaling (SDF)
Offline decode, done exactly like the shader, compared with the exact masks: k = 2 is exact. At k = 3 and 4 the worst p99 is .33 / .25 source px and topology is unchanged on every layer. Corners do not round visibly, so MSDF is not needed.

## Changes in this pass (v5)
1. Sclera under the moving layers is now a two-tone fill. The tone split is fitted with a RANSAC quadratic, and each tone is filled from its own clean pixels. The old diffusion fill smeared the lavender/white split into blotches that showed as a ghost when the pupil glanced away. The zone is widened to 5 px, and the fringe re-unmixes against the new field, so the rest pose stays exact.
2. Motif secondary action is now visible. Stars twinkle +5–10 % and ±8–10° (staggered per eye). Hearts lub-dub +10 % then +6 %. Spirals counter-rotate at about .75 rev/s. The rest/QA pose still snaps to the reference.
3. QA harness rebuilt after /tmp was wiped (`tools/cdp.py`). The leak sweep now hides the page UI and measures only the canvas; the old count included the swatch buttons. The gaze-sheet cosmetic no longer turns ink grey.
4. Non-Polly shapes are pixel-identical to live 22858db (stadium in 3 coats/toon, bean, dot, egg, oval, ref, squircle, toon).

## Caveats
- The gates are measured on the 1:1 QA composite. The live glass path (refraction, chromatic fringe, curvature) is checked visually only (`polly-v5-preview.png`).
- Some reference cells crop the eye at the cell edge (for example cheerful L, pleading). The rig reproduces that crop faithfully.
- Inward gaze is limited by engage-only containment, because the pupils rest at the inner edges. On a sideways glance the far eye travels much less than the near eye.
- Licence: the 12 shapes are copied 1:1 from Polly Von Dominique's sheet. Confirm permission before shipping commercially.

## Artifacts
`polly-v5-qa.png`, `polly-v5-gates.json`, `polly-v5-gaze.png`, `polly-v5-swapstrip.png`, `polly-v5-anim.mp4` (16.5 s), `polly-v5-preview.png`.

## v6
Resumed 13:3x HKT after the interrupted run (state on disk: index.html + glass.frag 13:25, deco atlas 13:24, layer atlas 13:10,
blinkstrip 13:29, preview 13:33; no mp4). Pre-fix copies of index.html / glass.frag / tools/polly_v6.py in `.v6bak/`.
Review fixes in progress:
1. glance parallax too big (face slides off the orb, whites clipped) -> diagnosed: Polly used the full classic head yaw/pitch
   (±.5 / ±.34 rad = ~45 % of the orb radius). Plan: a head-turn scale spring (1 classic, small on the Polly rig).
2. sleepy 'reopen overshoot' blank -> capture logic: sleepy reopens with no overshoot (by design), so the cell was never filled.
3. grey smudge when shut -> her nose-shade multiply layer + back FX art that sat hidden under the whites is exposed once the
   lid closes. Plan: mask back deco by the open-eye footprint; drop the nose shade on the live path.
4. blush turns into a mouth on glance -> same cause as 1 + 3 (band under the eyes exposed when the face turns).
Changes applied (13:36–13:40):
- index.html: `headK` spring (in ALL; target 1 on classic so classic Y/P are bit-identical, LAY_HEAD = .12 on the Polly rig,
  snapped in still/forced/QA). Face yaw/pitch = classic × headK → max ≈ ±.06 / ±.04 rad ≈ 3 % of the orb. Gaze stays in the
  pupils (lpX/lpY from the pointer target, unchanged), lid follow unchanged (+10 % on down-gaze, stretch on up-gaze).
- glass.frag `layDecoBack`: back deco (blush band, per-eye FX, nose shade) masked by the open-eye footprint
  (rest white | natural white | outline, no lid) -> what her sheet hides under the eyes stays hidden when shut / on glances.
  Nose shade gated by uDecoM.w = LAY_NOSE = 0 (off on the live path).
- glass.frag `layEye`: live-path pupil fringe tinted by the sclera under it (no white halo on the lavender band); QA (hard) exact.
- highlight follow .4 -> .75 of the pupil offset (her highlight rim arc no longer trails 60 % of a glance across the pupil).
- tools/polly_v6.py: preview 4th cell = peak-overshoot frame, or mid-reopen (labelled) when the emotion has no overshoot
  (sleepy: max stretch 1.002 measured, by design), 70-tick window, MISSING label instead of a silent blank; glance cells also
  saved as full-page shots (/tmp/p6/glance-*.png) for the crop check. anim rebuilt to ~16 s with a 1/3-speed blink replay.
- Killed the stale `polly_v6.py all` from the interrupted run + 8 orphaned headless Chromes (10:29–13:33) eating CPU.
Preview pass 1 (13:44) read: face now stays put (glance bbox shift ≈ ±17 device px ≈ 3 % of the orb; crop not the cause),
shut cells show only lash art, blush band stays a cheek band on glances, sleepy 4th cell filled (mid-reopen, labelled).
Found and fixed after it (13:47–13:52):
- the nasal give-back (LAY_NASAL .4) pushed pupils that rest on the nasal edge past her outline onto the skin (angry /
  confident / pleading / starry glance cells; v5.2 leak tool flagged them). LAY_NASAL -> 0, temporal-eye minimum travel
  2 -> LAY_TMIN = 9 texels so sideways glances still read.
- starry 'glance down-right' caught a dart-triggered blink -> capture now waits for the dart to land + lid open.
- v5.2 leak tool counts v6 brows (same hue as the pupils) and her white cheerful brows as leaks / holes -> new
  `tools/polly_v6_leak.py` sweeps with `?nodeco` (new QA-only URL flag: deco atlas + stroke brows off), 9 gaze targets + every
  >= .97-shut blink frame per emotion (shut frames must show no sclera / pupil pixels).
14:01 preview pass 2 (`polly-v6-preview.png`): read cell by cell. Faces stay centred (≈3 % parallax), pupils move inside the
whites, lids drop on down-gaze, shut cells = lash art only (+ brows / her cheek FX), blush band unchanged on glances, starry
down-right open, sleepy 4th cell = 'no overshoot: mid-reopen' (labelled). Strip regenerated 13:48 (rest-gaze blinks; unaffected
by the later nasal / capture fixes). Leak sweep part 1 (cheerful..smug): 0 sclera px and <= 11 pupil-hue px (lash chroma) on
every >= .97-shut frame; 'leak' px are her rest-pose pupils that overlap the nasal / lower eye corner in the sheet (present
in the k=0 rest frame: confident 300, bored 115, angry 74), glances stay at or below that except angry up-left (+55 px at the
same corner). Leak run crashed once on a shared /tmp/_v6.png (two captures in parallel) -> per-process temp file; resumed.
14:03 anim capture started (~16 s).
14:08 leak summary part 1 (`tools/polly_v6_leak_sum.py`, ink-AA-aware hole metric): angry/bored/cheerful/confident/sleepy/
smug: holes 0 except bored up-right 15 px (her pupil rim crescent on the lavender, not skin); every >= .97-shut frame
0 sclera px, <= 11 pupil-hue px (lash chroma). Leak over the rest pose: 0–3 px except angry +55, smug +77 (down-gaze: her
pupil already overlaps the nasal / lower corner at rest and keeps that overlap as it moves).
Leak sweep paused while the anim renders (swiftshader is the bottleneck: ~1–2 s / frame with two captures).
14:14 anim pass 1 (16.8 s, 1007 frames incl. a 35-frame blink replayed at 1/3 speed; kept as /tmp/p6/polly-v6-anim-pass1.mp4).
Self-review of extracted frames: drawn blinks read well (lash slides down, closed lash arc, reopen), darts land with holds,
face stays put, motifs alive. FOUND: the first frame of each new expression was drawn at closure .91–.94 (swap gate .9), so
its pupils showed in a ~9 % slit (e.g. bored's blue pupils on frame 360). FIX: swap gate LAY_SWAP_AT = .97 on the last AND
current tick, and pop emotions (starry / love / furious) now close fully too (target 1.02, was a .97 squash).
14:17 anim pass 2 rendering.
14:15 edit (the last one before the interruption) = the swap gate above: index.html LAY_SWAP_AT = .97 (last + current tick),
pop emotions target 1.02 instead of a .97 squash; tools/polly_v6.py swap check threshold .9 -> .97. It changes rendering, so
the 14:14 mp4 was superseded: anim pass 2 (started 14:17, finished 14:28) -> polly-v6-anim.mp4 16.8 s, 1007 frames; all 8
swaps at closure 1.01–1.02, 0 swap frames drawn < .97 shut, 0 page errors.
14:30 leak sweep complete (12 emotions x 9 gaze targets + every >= .97-shut frame, ?nodeco): holes 0 everywhere except bored
up-right 15 px (her pupil rim crescent on lavender); shut frames: 0 sclera px on all 59, <= 11 pupil-hue px (lash chroma).
'Leak' over rest: pleading 3211 / starry 693 / love 202 are classifier artefacts (overlay checked: the sclera splits into
two blobs at the pupil, so the whole pupil counts as outside the small blob's hull; pupils are visibly inside the white).
14:31 videoReview self-check on frames extracted from the mp4 (blink 20–40, replay, darts 158–300, swaps 357–380 / 648–680):
whites solid, pupils inside whites, shut frames = lash art only, no grey smudge, face centred, swaps happen on shut frames.
14:33 classic identity vs live 5dc042d (tools/polly_classic_identity.py, 12 queries incl. an animated stadium with hover
darts): ALL IDENTICAL, 0 px, 0 errors. coats.js / face.js / springs.js / emotes.js unchanged (byte-identical to 5dc042d).
14:34 pushing to hypeuk-ship-it/astrid-glass (fresh clone /tmp/ag-v6), cache-bust ?v=10071435 on every script / atlas URL.
