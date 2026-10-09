# Astrid · solo

Standalone build of one Astrid look: the **Toon eye** (upright ellipse, lower half squashed up by a fixed lattice,
dark rim crescent behind, tall dark pupils) with the toon layer on. Default coat **carbon**; the small UI offers only two coats (glass = the white/blue vibe,
and carbon) plus Light/Dark, Sound, and Think. The eye is hard-wired: no eye-shape picker, no emote sheets, no URL or
localStorage needed (the coat/mode choice is remembered under its own key, `astridSoloCoat`).

Think: the pupil fills the white completely and a green CRT about time and events comes up at once, empty except a `$ ` prompt. The left eye types the command in fast runs with a pause before the last character (the block cursor blinks only while waiting). A spinner and `run` show the command executing, then the right eye prints the result lines one at a time. Her gaze makes a small scan along the active line and saccades to the next one. The screen stays up about 5 seconds, holds on the last line, then the text fades and the pupil shrinks back with a pleased blink.
The Think button runs one cycle. `?demo=think` loops it (a thinking squint, then the screen). `?think=crt|mono|amber|min|rain` (crt default), `?eyes=same|split` (split default).

Kept from the full rig: the glass shader (frost, pool, haze, fringe, RGB split), breathing, petting / tickle / tap
reactions and voice (Sound button), blinks (incl. gaze-shift blinks), gaze + pupil life (dilation, dart stretch,
soft containment), springs, and the debug panel (`?debug` or press `d`; its tuning is saved under its own key).

Files: `index.html` (inlined shaders + rig), `glass.frag` / `glass.vert` (edit these, then `python3 build.py`;
`--check` verifies they match), `face.js` (eye box + toon layer), `springs.js`, `coats.js` (read-only ColorWay
coats; only glass + carbon are offered), `v6-svg.html` (SVG fallback when WebGL is unavailable).

Emotions (held until another is picked; ~300 ms springs): Happy, Sad, Angry, Surprised, Sleepy, Love, Concerned, Listening, Confused, on the row above the coat bar. `?emo=happy|sad|angry|surprised|sleepy|love|concerned|listening|confused|neutral`. `__astrid.emotion(name)` sets one and returns the current name. Each emotion (except Neutral) runs a directed idle loop while held — springs only, no sine on the face. Happy (and Love): zoom the face in (~8–12 %), three rapid yes-nods, a short pause, three more yes-nods, settle, repeat; soft blinks, pupil breath, optional squint pulse. Love is that same loop plus the M1 dusty-rose glow. Sad: long holds, heavy blinks, rare slow weighted head-dip (not yes-nods). Angry: sharp gaze-dart bursts and occasional forward size-lean, short hard blinks. Surprised: freeze → head turn → side-eye → hold → home; rare gasp pop. Sleepy: fighting sleep — lose→stick→catch→wide→sag with soft springs and longer overlaps (no hard kicks); very slow sticky blink clamped so eyes never fully disappear. Concerned: soft care lids (partial sad+angry, not a glare), slow blinks, tiny L/R gaze checks, rare soft roll tilt. Listening: lids a touch wider, gaze locked to user, very still; rare micro nod + soft blink. Confused: asymmetric lids + slight lift; rare double-take gaze and soft roll tilt, then recover. Think still runs from any emotion and eases back to it afterwards.

Test hooks: `?coat=glass|carbon&mode=light|dark` (not saved), `?seed=N` (deterministic, static until `__astrid.drive()`), `?still`, `?yaw=&pitch=`, `?content=0..1`,
`?breath=0..1`, `?noadapt`, `?demo=think`, `?think=`, `?eyes=`, `?emo=`.
Hooks: `__astrid.state('idle'|'listening'|'thinking'|'working'|'done')`, `__astrid.emotion(name)`, `__astrid.think(lines)`, `__astrid.thinkStyle`, `__astrid.thinkEyes`, `__astrid.coat()` (the coat; was `state()`).

The full rig (all shapes + Polly) stays at the repo root; it is also tagged `full-rig-2026-10-07`.
