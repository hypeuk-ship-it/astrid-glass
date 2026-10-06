# Astrid · glass

WebGL glass Astrid orb in the soft "vibe" look: frosted white form with a Gaussian edge, a pale blue pool
glowing up from the bottom, a faint pink/cyan fringe and big white pebble eyes.

**Petting:** press and stroke her. Slow strokes make her content (happy, half-closed eyes, little rising
chirps), fast scrubbing tickles (wiggle, blinks, giggle), a quick tap pokes. She holds the happy face ~1.5 s
after you stop. Sound unlocks on your first gesture; the Sound/Muted button is remembered.

Open with `?debug` (or press `d`) for tuning sliders. Test params: `?still`, `?yaw=&pitch=`, `?coat=&mode=`,
`?noadapt`, `?content=0..1` (pins the happy face).

- `v7-bubble.html`: the previous glossy soap-bubble build (standalone).
- `v6-svg.html`: SVG/CSS fallback used when WebGL is unavailable.
- Edit `glass.frag`, then `python3 build.py` to inline it into `index.html` (`--check` verifies they match).
