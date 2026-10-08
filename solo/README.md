# Astrid · solo

Standalone build of one Astrid look: the **Toon eye** (upright ellipse, lower half squashed up by a fixed lattice,
dark rim crescent behind, tall dark pupils) with the toon layer on. Default coat **carbon**; the small UI offers only two coats (glass = the white/blue vibe,
and carbon) plus Light/Dark, Sound, and Think. The eye is hard-wired: no eye-shape picker, no emote sheets, no URL or
localStorage needed (the coat/mode choice is remembered under its own key, `astridSoloCoat`).

Think: the pupil grows into the white and runs a green CRT terminal about time and events (calendar scripts).
The Think button runs one cycle (idle → thinking → working → done). `?demo=think` loops it. `?think=crt|mono|amber|min|rain` (crt default), `?eyes=same|split` (split default).

Kept from the full rig: the glass shader (frost, pool, haze, fringe, RGB split), breathing, petting / tickle / tap
reactions and voice (Sound button), blinks (incl. gaze-shift blinks), gaze + pupil life (dilation, dart stretch,
soft containment), springs, and the debug panel (`?debug` or press `d`; its tuning is saved under its own key).

Files: `index.html` (inlined shaders + rig), `glass.frag` / `glass.vert` (edit these, then `python3 build.py`;
`--check` verifies they match), `face.js` (eye box + toon layer), `springs.js`, `coats.js` (read-only ColorWay
coats; only glass + carbon are offered), `v6-svg.html` (SVG fallback when WebGL is unavailable).

Test hooks: `?coat=glass|carbon&mode=light|dark` (not saved), `?seed=N` (deterministic, static until `__astrid.drive()`), `?still`, `?yaw=&pitch=`, `?content=0..1`,
`?breath=0..1`, `?noadapt`, `?demo=think`, `?think=`, `?eyes=`.
Hooks: `__astrid.state('idle'|'listening'|'thinking'|'working'|'done')`, `__astrid.think(lines)`, `__astrid.thinkStyle`, `__astrid.thinkEyes`, `__astrid.coat()` (the coat; was `state()`).

The full rig (all shapes + Polly) stays at the repo root; it is also tagged `full-rig-2026-10-07`.
