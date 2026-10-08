# Astrid · solo

Standalone build of one Astrid look: the **Toon eye** (upright ellipse, lower half squashed up by a fixed lattice,
dark rim crescent behind, tall dark pupils) with the toon layer on, on the **carbon** coat. Everything is hard-wired:
no eye-shape picker, no emote sheets, no coat picker, no URL or localStorage needed.

Kept from the full rig: the glass shader (frost, pool, haze, fringe, RGB split), breathing, petting / tickle / tap
reactions and voice (Sound button), blinks (incl. gaze-shift blinks), gaze + pupil life (dilation, dart stretch,
soft containment), springs, and the debug panel (`?debug` or press `d`; its tuning is saved under its own key).

Files: `index.html` (inlined shaders + rig), `glass.frag` / `glass.vert` (edit these, then `python3 build.py`;
`--check` verifies they match), `face.js` (eye box + toon layer), `springs.js`, `coats.js` (read-only ColorWay
coats; only carbon is used), `v6-svg.html` (SVG fallback when WebGL is unavailable).

Test hooks: `?seed=N` (deterministic, static until `__astrid.drive()`), `?still`, `?yaw=&pitch=`, `?content=0..1`,
`?breath=0..1`, `?noadapt`.

The full rig (all shapes + Polly) stays at the repo root; it is also tagged `full-rig-2026-10-07`.
