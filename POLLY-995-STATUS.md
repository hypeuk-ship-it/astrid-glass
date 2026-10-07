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
