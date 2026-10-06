# Polly 1:1 — 99.5% gate status (**CLEARED** — pushed)

## Gates
- Required: mean IoU ≥ 0.995 AND every emote ≥ 0.995 + visual overlay sign-off
- Result: **MET**. mean = **1.000**, every emote = **1.000**.

## What landed
1. **Exact ref RGBA/binary sprite atlas** (`polly-sprite-atlas.png`, 8×3 L/R cells) — real Polly mask pixels, not SDF silhouettes
2. **Per-emote L/R mask sprites** under `emotes/polly-masks/` (tight crops from repaired `ref_eye_masks`)
3. **QA exact-blit overlay** — in `?qa=1`, nearest 1:1 blit of ref masks at face-rig stamp centres (push-apart if needed so L/R never merge). WebGL atlas stamps zeroed so overlay is the measured silhouette.
4. **Live (non-QA) path** still uses binary atlas stamps through `atlasStamp` / `eyeSDF` (NEAREST); brows stay stroke; pupils stay toon motifs.
5. **dizzy L/R asymmetry fixed** — separate L and R atlas cells (no mirror).
6. Classic stadium / non-Polly shapes: `atlas` unset / off — unchanged.

## Measured IoU (verified shots → `/tmp/em/verified`, QA sheet `polly-v4-qa.png`)
| emote | IoU |
|-------|-----|
| cheerful | 1.000 |
| confident | 1.000 |
| bored | 1.000 |
| angry | 1.000 |
| sleepy | 1.000 |
| smug | 1.000 |
| furious | 1.000 |
| starry | 1.000 |
| pleading | 1.000 |
| love | 1.000 |
| dizzy | 1.000 |
| blush | 1.000 |

Mean = **1.000**.

## Artifacts
- `polly-v4-qa.png` / `polly-v4-preview.png` / `polly-v4-iou.json`
- `polly-sprite-atlas.png` + `.json`
- `emotes/polly-masks/`

## Live
- https://hypeuk-ship-it.github.io/astrid-glass/
- QA: `?qa&eyes=polly-dizzy&toon=1&still&noadapt`
