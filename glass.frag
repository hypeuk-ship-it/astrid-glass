// Astrid glass · "vibe" (v8): soft, airy, washed-out. One draw call over a canvas sized to the orb + bloom.
// GLSL ES 1.00 (WebGL1/2). Units: AstridFace 240-space. Orb r118 at (120,120); stage framing -50..290.
// Look (matches Henlo's reference): a white frosted form that bleeds into the paper with a Gaussian edge
// (no outline, no glint), a pale luminous blue pool glowing up from the BOTTOM and fading to white haze
// at the top, a faint pink/cyan prism smear only along the soft lower boundary, and big bright white
// "pebble" eyes (stadium by default; egg, dot, oval, bean, squircle by uniform) with a slight RGB split
// and a faint inner shade.
// Layering (bottom → top):
//   frost(p)  : paper · white bloom into the page · frosted body (Gaussian edge)      [fixed]
//   pool(p)   : drifting blob field (pool, deep floor, bloom) moved by the delayed, inverted head turn,
//               noise warp and random-target drift; inset so a frosted white margin stays around it
//   haze      : white veil, heavier toward the top                                    [fixed]
//   fringe    : pink outside / cyan inside where the pool meets the frosted margin, strongest low
//   eyes      : soft blue-white glow + white pebble fill, sampled 3× (R/G/B) → gentle chromatic edge
//   petting   : body squash/stretch (whole frame), contact lens dent + soft brightening under the finger
// Efficiency: the noise warp and the body transform run per vertex of a coarse grid (glass.vert);
// everything that is constant across the frame is computed on the CPU (blob transforms with
// their radii folded in, head-turn map, eye stadium params, every slider-derived width/edge, derived
// colours); gaussians are exp2 with a precomputed −log2(e)/w² factor; pixels past the bloom early-out to
// paper (+ a sin-free dither hash); the eye SDF runs only inside a tight capsule per eye (CPU-projected
// stadium axis + glow margin, ~13% of canvas pixels) and does ONE sphere inversion per pixel: the R/B
// chroma taps reuse it through the analytic Jacobian of (lon, lat) instead of two more inversions.
// The page background is the same paper colour, so the canvas itself only covers the orb + bloom.
// Port note (Metal): uniforms map 1:1 to a constant buffer; plain functions; no textures.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2  vP;       // body-space position (units), from the vertex grid (affine → exact per pixel)
varying vec2  vWarp;    // pool noise warp (units), evaluated per grid vertex (smooth 30–60u features)
uniform vec3  uPaper, uCore, uDeep, uMid, uEdge, uHalo, uEye, uEyeHi, uEyeLo, uGlow;
uniform vec3  uBloomCol, uLiftCol, uTouchCol;  // per coat: mix(mid,edge,.35) · mix(mid,CYAN,.45) · mix(halo,glow,dark)
uniform vec4  uAura;    // rgb: mix(core,mid,.3), a: 0.42·(1 − 0.4·dark)
uniform vec2  uMode;    // x: unused, y: dark (0/1)
uniform vec4  uRot;     // eyes: cos yaw, sin yaw, cos pitch, sin pitch
uniform vec4  uEyeP;    // eyes: -, -, lidFade (morph-blended), capsule radius (units)
uniform vec4  uEyeA;    // eye box (radians): half width, half visible height (morph-blended), 1/hw, 1/hh
uniform vec4  uShape;   // eye shape params: corner radius ×hw, ellipse weight, egg taper, peak (parallelogram/wedge; 0=off)
uniform vec4  uShapeT;  // eye shape params: cos lean, sin lean, bean bow ×hw, rest lon of the eyes (±)
uniform vec4  uAsym;    // toon shape: width scale ±(1 + side·x), height offset (side·y), cut / expression-lid height, its corner k
uniform vec4  uCutN;    // cut / expression-lid line normal: left eye (xy), right eye (zw)
uniform vec4  uLat;     // fixed lattice warp ('toon'; 1,1,1 = none): 1/k of the bottom row inner, mid, outer; 1/(1.4·hw)
uniform vec4  uToon;    // toon layer: rim alpha (0 = off → skipped), pupil alpha (0 = off), rim grow (rad), -
uniform vec4  uToonR;   // toon rim offset (rad): outward, up, -, -
uniform vec4  uRimP;    // toon rim after the shared warp ('toon'; 0,0,1 = none): outward, up (rad), scale, -
uniform vec4  uPupil;   // pupil centre (rad, eye-local): inward rest, gaze u, v; SDF scale of the dart stretch
uniform mat2  uPupilM;  // pupil dart stretch: eye-local → pupil frame (identity at rest)
uniform vec4  uPupilA;  // pupil semi-axes a, b and 1/a, 1/b (rad)
uniform vec4  uPupilC;  // per-eye pupil centre offsets from the soft containment (face.js containPupil): L xy, R zw
uniform vec4  uMotif;   // x = type (0 oval/dot ellipse, 1 star, 2 heart, 3 spiral, 4 ring, 5 flower, 6 tiny-dot), y = unused, z = brow on, w = blush
uniform vec3  uMotifCol;// motif / pupil fill colour (toon ink used for outline/rim still)
uniform vec4  uBrow;    // brow: lift×hh, halfW×hw, thick×hw, angle (rad, + = outer end higher)
uniform vec3  uBrowCol; // brow colour
uniform vec4  uBrowX;   // brow stroke extras: arch×hh (mid rise above chord), taper (outer/inner thick), outline width×thick, -
uniform vec3  uToonCol; // toon ink: the coat's dark/mark tone
uniform float uQA;     // >0.5: solid white eye silhouettes on black (for IoU)
uniform sampler2D uEyeAtlas; // Polly exact binary sprite atlas (R8, 1=inside)
uniform vec4  uAtlas;  // x=emote index (−1=off), y=cols, z=rows, w=unused (binary)
uniform vec4  uStampL; // screen-space L eye stamp: cx, cy, halfX, halfY (same space as vP/uEyeL)
uniform vec4  uStampR; // screen-space R eye stamp
// Polly 3-layer rig (polly-layer-atlas.png): per emote row 8 cells = L white-body, pupil, outline, core | R same
uniform sampler2D uLayTex;
uniform vec4  uLay;    // x = on (1/0), y = emote row, z = 1/atlas width, w = 1/atlas height (texels)
uniform vec4  uLayC;   // x = cell w, y = cell h (texels), z = texels per radian (live), w = QA canvas height (device px; 0 = live)
uniform vec4  uLayL;   // L eye: anchor (cell texels, y down) xy, pupil offset (texels, y down; gaze + containment) zw
uniform vec4  uLayR;   // R eye: same
uniform vec4  uLayQ;   // QA 1:1 blit: L cell origin xy, R cell origin zw (device px from the canvas top-left)
uniform vec4  uLayML;  // L pupil sprite: centre xy (cell texels), inverse rotation·scale (cos θ / s, sin θ / s) zw
uniform vec4  uLayMR;  // R pupil sprite: same
uniform vec4  uLayH;   // highlight offset relative to the pupil (texels, y down): L xy, R zw
uniform vec4  uLayB;   // v6 lids: L lid closure 0..1, R lid closure, open-overshoot vertical stretch (>= 1), lower-lid share of the closure
// v6 Polly brows / FX / nose shade (polly-deco-atlas.png, tools/build_polly_deco.py): per emote row L brow, L fx, R brow, R fx, mid fx, mid shade
uniform sampler2D uDecoTex;
uniform vec4  uDeco;   // x = on, y = row, z = 1/atlas W, w = 1/atlas H
uniform vec4  uDecoC;  // cell w, cell h, eye anchor in the cell (x, y)
uniform vec4  uDecoB;  // brow dy L, brow dy R (texels, + down), brow alpha, fx alpha
uniform vec4  uDecoF;  // fx pulse scale L, R; brow squash (vertical scale) L, R
uniform vec4  uDecoP;  // fx pulse centre L (x, y), R (x, y) (deco texels)
uniform vec4  uDecoQ;  // brow squash pivot y L, R (deco texels: the brow's lower edge), sub-texel anchor x L, R
uniform vec4  uDecoM;  // mid layer: texels per radian of lon (stretch to the rig's eye spacing), sub-texel anchor x, y, nose-shade strength (v6 review: 0)
uniform vec4  uLayD;   // x = texels per device px at Z = 1 (live), y = debug codes, z = QA scale (1 = 1:1 exact), w unused
uniform vec4  uShadow;  // eye drop shadow: strength, lat offset down (rad), gauss k (exp2), -
uniform vec4  uShapeC;  // eye lid (radians): egg-centre offset, lid line (rel. to centre), corner k, -
uniform vec4  uEyeL, uEyeR; // eyes: tight bounding capsules = projected stadium axis ends (a.xy, b.xy), screen units
uniform vec4  uEyeK;    // eyes: soft edge w, glow k, aura k (exp2 factors), 1/hw
uniform vec4  uEyeK2;   // eyes: 1/(2·hh), rim-shade edge (−0.7·hw·RR), lat centre (shape rest lat + lift), arc/hw (morph-blended box)
uniform vec4  uFace;    // cos roll, sin roll, -, -
uniform vec4  uQ;       // head-turn map (inverted gaze + foreshorten): q = pl·xy + zw
uniform mat2  uBA, uBB, uBC; // blobs (floor, pool, bloom): drift⁻¹ with 1/radii folded in
uniform vec2  uCA, uCB, uCC; //   … and their offsets: blob-space d = B·q + c (|d| = 1 at the blob edge)
uniform vec4  uFrost;   // halo exp2 k, body edge0, body edge1, early-out radius
uniform vec4  uPoolK;   // inset at sides (30es), inset at bottom (14es), margin in (10es), margin out (6es+2)
uniform vec4  uFringeK; // fringe exp2 k, outer-smear exp2 k, fringe strength, haze
uniform vec4  uMisc;    // pool strength, chroma split scale, contact exp2 k (34u), dent strength
uniform vec4  uTouch;   // petting contact: x, y (units), pressure (sprung), -

const vec2  C  = vec2(120.0, 120.0);
const float R  = 118.0;   // orb
const float RR = 110.0;   // eye sphere (AstridFace projector)
const vec3  PINK = vec3(0.976, 0.620, 0.902);
const vec3  CYAN = vec3(0.560, 0.905, 1.000);

// gauss(x, w) = exp(−x²/w²) = exp2(x²·k) with k = −log2(e)/w² precomputed on the CPU
float g2(float x, float k){ return exp2(x * x * k); }
// cheap sin-free hash for the dither only (±0.5/255)
float dhash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// dark paper wants light added (screen), light paper wants a tint (mix)
vec3 tint(vec3 col, vec3 c, float a){
  return mix(mix(col, c, a), 1.0 - (1.0 - col) * (1.0 - c * a * 0.8), uMode.y);
}


// Screen-space exact sprite stamp: binary L/R atlas cells (no mirror; dizzy is asymmetric).
float atlasStamp(vec2 p, vec4 stamp, float side){
  if (uAtlas.x < -0.5) return 1e5;
  vec2 ctr = stamp.xy;
  vec2 hst = max(stamp.zw, vec2(1e-3));
  vec2 t = (p - ctr) / hst;               // [-1,1] in stamp box
  if (max(abs(t.x), abs(t.y)) > 1.02) return 1e5;
  // cell index: emote*2 + (R?1:0); atlas is 8×3 binary-LR
  float idx = uAtlas.x * 2.0 + (side > 0.0 ? 1.0 : 0.0);
  float cols = uAtlas.y;
  float rows = uAtlas.z;
  float col = mod(idx, cols);
  float row = floor(idx / cols);
  // PNG row0 = top; vP y-down: +t.y (below) → PNG bottom
  vec2 local = vec2(t.x * 0.5 + 0.5, t.y * 0.5 + 0.5);
  local = clamp(local, 0.0, 1.0);
  vec2 uv = (vec2(col, row) + local) / vec2(cols, rows);
  float enc = texture2D(uEyeAtlas, uv).r; // 1 = inside (white)
  // negative inside for step(d,0) fill; uAtlas.w unused for binary (kept for compat)
  return (0.5 - enc) * min(hst.x, hst.y);
}

// ---- Polly layered sprites (back -> front): white body, coloured pupil/motif, pupil-core ink, highlight (the three
// moving layers are clipped to the white), LID (v6: her upper lash slides down over the eye, below), outline ink (on top).
// Atlas: 10 cells per eye (white, pupil, core, highlight, outline, fringe, nat, lidprof, lash, lidprof2) x L/R; RGB = reference colours, A = signed distance field
// (texels, a = .5 + d / (2 * LAY_R)); the fringe cell is straight alpha (the pupil's own anti-aliasing, unmixed). Coverage = SDF edge at the current texel/px scale, so edges stay crisp at any size;
// v5.1: the white's coverage is the exact rest body while the pupil is home and the NATURAL white contour (nat cell: the
// open eye edge bridged across where the rest pupil sat, pupil bulges trimmed) once it has moved > ~1-3.5 texels, so a dart
// never leaves a pupil-shaped bite in the white. The white RGB is defined on both (one clean two-tone field).
// at the exact 1:1 QA pose (hard = 1) it is a step at .5 at texel centres = the reference masks bit for bit.
// No derivatives / extensions (Metal-portable): the px scale comes in as a uniform.
const float LAY_R = 4.0;
const vec3 LAY_INK = vec3(0.0353, 0.0275, 0.0392);      // median reference ink (outline + core), closed-eye fill
vec4 layTex(float col, vec2 t){
  vec2 c = clamp(t, vec2(0.5), uLayC.xy - 0.5);
  return texture2D(uLayTex, (vec2(col * uLayC.x, uLay.y * uLayC.y) + c) * uLay.zw);
}
float layCov(float a, float s, float hard){
  return hard > 0.5 ? step(0.5, a) : clamp((a - 0.5) * (2.0 * LAY_R) / s + 0.5, 0.0, 1.0);
}
// v6: the open overshoot of a blink is a small vertical stretch of the whole eye about its anchor (z >= 1; 1 = none).
// The blink itself is the LID below (no squash any more: v5 squashed the whole stack and filled it with ink).
vec2 layClose(vec2 t, float piv){ t.y = piv + (t.y - piv) / max(uLayB.z, 0.03); return t; }
const float LAY_NC = 10.0;
const float LAY_OV = 4.0;                                // texels
// v6 LID (Polly's lid language: the thick upper lash line IS the lid edge; the lavender band under it is the lid shadow).
// Per column (lidprof cell): top / bottom of the opening and the top of the upper lash (texels). Closure cl slides the lash
// down column-wise by dd = cl * (1 - k) * H and the lower lash line up by ee = cl * k * H, so at cl = 1 the lash lands on the
// lower line: her lash stroke, bent to the lower lid's curve = the drawn closed eye (thick ink arc). Returns the opening's
// coverage at t (whites / pupils are clipped to it); dd, ee, lt (moved lash top) out.
float layLid(vec2 t, float c0, float cl, float s, out float dd, out float ee, out float lt, out float ly){
  vec2 tc = vec2(t.x, 0.5 * uLayC.y);
  vec3 pr = layTex(c0 + 7.0, tc).rgb * uLayC.y;                    // top, bottom of the opening, clip top (column's top ink)
  vec2 pq = layTex(c0 + 9.0, tc).rg;                               // lash top / CH, her lash thickness / 64
  float hh = max(pr.y - pr.x, 0.0);
  // + LAY_OV: the two lash lines overlap a little when shut, so the closed eye is ONE ink arc (no sliver between them)
  float hc = cl * (hh + LAY_OV * smoothstep(0.6, 1.0, cl));
  dd = (1.0 - uLayB.w) * hc; ee = uLayB.w * hc; lt = pr.z + dd;
  // the lash rides down with its lower edge on the lid line; a steep (tall) lash run is squashed toward her lash thickness
  // as it shuts, so the closed frame is an even arc and the eye's sides shorten instead of riding down as spikes
  float run = max(pr.x - pq.x * uLayC.y, 0.5), th = max(mix(run, min(run, pq.y * 64.0 * 1.1), cl), 0.5);
  ly = pr.x - (pr.x + dd - t.y) * run / th;
  return clamp((t.y - pr.x - dd) / s + 0.5, 0.0, 1.0) * clamp((pr.y - ee - t.y) / s + 0.5, 0.0, 1.0);
}
// rest body -> natural white contour as the pupil leaves home (0 at rest and under the +-0.5 texel idle jitter)
float layNatK(vec4 E){ return smoothstep(1.0, 3.5, length(E.zw)); }
// pupil-sprite coords: gaze offset po, rotation/scale M about the pupil centre
vec2 layPup(vec2 t, vec2 po, vec4 M){ vec2 v = t - po - M.xy; return M.xy + vec2(M.z * v.x + M.w * v.y, -M.w * v.x + M.z * v.y); }
// one eye at cell coords t (stretch applied by the caller) -> interior colour (white + moving layers, clipped to the lid
// opening); ab = body coverage, ao / oc = outline coverage / colour, mv = visible moving-layer coverage (after the clip to the
// white and under the outline), mp = moving coverage before the clip (debug / QA leak check)
vec3 layEye(vec2 t, vec4 E, vec4 M, vec2 rel, float c0, float s, float hard, float cl, out float ab, out float ao, out vec3 oc, out float mv, out float mp){
  float dd = 0.0, ee = 0.0, lt = 0.0, ly = 0.0, lw = 1.0;
  bool lid = cl > 1e-4;                                              // rest / QA: exactly the v5 path
  if (lid) lw = layLid(t, c0, cl, s, dd, ee, lt, ly);
  vec4 wb = layTex(c0, t);
  ab = mix(layCov(wb.a, s, hard), layCov(layTex(c0 + 6.0, t).a, s, hard), layNatK(E)) * lw;
  vec3 col = lid ? layTex(c0, vec2(t.x, t.y - dd)).rgb : wb.rgb;     // the lavender lid shadow rides down with the lash
  vec2 tp = layPup(t, E.zw, M);
  // pupil AA fringe (moves with the pupil). v6 review: on the live path its baked (near-white) colour is tinted by the sclera
  // it now sits on, so a pupil on the lavender band has no white halo; the 1:1 QA pose (hard) keeps the exact colour
  vec4 fr = layTex(c0 + 5.0, tp); col = mix(col, hard > 0.5 ? fr.rgb : fr.rgb * min(col * (1.0 / 0.96), vec3(1.0)), fr.a);
  vec4 pp = layTex(c0 + 1.0, tp); float ap = layCov(pp.a, s, hard); col = mix(col, pp.rgb, ap);
  vec4 kc = layTex(c0 + 2.0, tp); float ak = layCov(kc.a, s, hard); col = mix(col, kc.rgb, ak);
  vec4 hh = layTex(c0 + 3.0, layPup(t - rel, E.zw, M)); float ah = layCov(hh.a, s, hard) * ap;   // clipped to the pupil
  col = mix(col, hh.rgb, ah);
  if (!lid) { vec4 ol = layTex(c0 + 4.0, t); ao = layCov(ol.a, s, hard); oc = ol.rgb; }
  else {
    // lower lash line (outline minus the upper lash) rides up by ee; anything of it above the moved lash is gone (the
    // opening is smaller now); the upper lash rides down by dd
    vec2 ts = vec2(t.x, t.y + ee);
    vec4 ol = layTex(c0 + 4.0, ts);
    float aS = layCov(ol.a, s, hard) * (1.0 - layCov(layTex(c0 + 8.0, ts).a, s, hard)) * clamp((t.y - lt) / s + 0.5, 0.0, 1.0);
    vec4 ls = layTex(c0 + 8.0, vec2(t.x, ly)); float aL = layCov(ls.a, s, hard);
    ao = max(aS, aL); oc = aL >= aS ? ls.rgb : ol.rgb;
  }
  mp = max(max(ap, ak), ah); mv = mp * ab * (1.0 - ao);
  return col;
}
// QA: 1:1 device-px blit of the rig's layer composite on a grey page (uLayD.z > 1: magnified, smooth SDF edges)
vec3 layQA(vec3 col){
  vec2 fp = vec2(gl_FragCoord.x, uLayC.w - gl_FragCoord.y);
  float k = max(uLayD.z, 1.0), hard = k > 1.0 ? 0.0 : 1.0;
  vec3 dbg = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec2 o = i == 0 ? uLayQ.xy : uLayQ.zw;
    vec4 E = i == 0 ? uLayL : uLayR;
    vec4 M = i == 0 ? uLayML : uLayMR;
    vec2 rel = i == 0 ? uLayH.xy : uLayH.zw;
    float cl = i == 0 ? uLayB.x : uLayB.y;
    float c0 = i == 0 ? 0.0 : LAY_NC;
    vec2 t = hard > 0.5 ? floor(fp - o) + 0.5 : (fp - o) / k;
    if (t.x < 0.0 || t.y < 0.0 || t.x > uLayC.x || t.y > uLayC.y) continue;
    t = layClose(t, E.y);
    float ab, ao, mv, mp; vec3 oc;
    vec3 ci = layEye(t, E, M, rel, c0, 1.0 / k, hard, cl, ab, ao, oc, mv, mp);
    col = mix(mix(col, ci, ab), oc, ao);
    dbg = max(dbg, uLayD.y > 1.5 ? vec3(ab, mv, ao) : vec3(ab, mv, mp * (1.0 - ao)));   // 1: leak codes, 2: outline
  }
  return uLayD.y > 0.5 ? dbg : col;
}

// ---- eye shapes: ONE parametric SDF in eye-local sphere coords (radians; < 0 inside), box b = (half w,
// half h). Every shape is a parameter set (face.js SHAPES / eyeSDFP): stadium = rounded box with r = hw,
// squircle r = .55hw, dot = round box, oval = ellipse, egg = tapered ellipse, bean = leaning bowed ellipse,
// ref = plump (mostly ellipse) egg leaning outward; toon = ellipse whose lower half a fixed lattice squashes up.
// A shape switch lerps the params on the CPU → no branches, one evaluation per tap, even mid-morph.
// smooth max: rounds the corner where the lid line meets the shape by ~k
float smax(float a, float c, float k){ float h = max(k - abs(a - c), 0.0) / k; return max(a, c) + h * h * k * 0.25; }
// rp = rim transform applied after the shared lattice warp ('toon' rim: outward, up, scale; vec3(0,0,1) = none).
float eyeSDF(vec2 p, vec2 b, float side, vec3 rp){
  float sx = 1.0 + side * uAsym.x;
  p.y += side * uAsym.y; p.x /= sx;
  p.y -= uShapeC.x;
  vec2 ib = uEyeA.zw;
  float f = clamp(-side * p.x * uLat.w, -1.0, 1.0);
  float wl = uLat.y + (f > 0.0 ? uLat.x - uLat.y : uLat.y - uLat.z) * f;
  vec2 pw = vec2(p.x, p.y < 0.0 ? p.y * wl : p.y);
  float js = 1.0 / (1.0 + (wl - 1.0) * clamp(-2.0 * p.y * ib.y, 0.0, 1.0));
  vec2 ro = vec2(side * rp.x, rp.y);
  pw = (pw - ro) / rp.z;
  vec2 q = vec2(uShapeT.x * pw.x + side * uShapeT.y * pw.y, -side * uShapeT.y * pw.x + uShapeT.x * pw.y);
  float yn = clamp(q.y * ib.y, -1.0, 1.0);
  q.x -= side * uShapeT.z * b.x * (1.0 - yn * yn);
  float g = 1.0 - uShape.z * yn; q.x /= g;
  // Exact binary sprite atlas (Polly 1:1): L/R cells, no mirror.
  // Atlas cell covers square [-1,1]² in units of S=max(b.x,b.y); hood/cut already baked in.
  if (uAtlas.x > -0.5) {
    float S = max(b.x, b.y);
    vec2 t = q / max(S, 1e-6);
    float idx = uAtlas.x * 2.0 + (side > 0.0 ? 1.0 : 0.0);
    float cols = uAtlas.y;
    float rows = uAtlas.z;
    float col = mod(idx, cols);
    float row = floor(idx / cols);
    // eye +y up → PNG top (local.y=0): flip vs screen-stamp convention
    vec2 local = vec2(t.x * 0.5 + 0.5, 0.5 - t.y * 0.5);
    local = clamp(local, 0.0, 1.0);
    vec2 uv = (vec2(col, row) + local) / vec2(cols, rows);
    float enc = texture2D(uEyeAtlas, uv).r; // 1 = inside
    float dA = (0.5 - enc) * S;             // radians-ish; <0 inside
    return dA * min(sx, 1.0);
  }
  // peak (uShape.w): pointed-hood / parallelogram wedge. 0 = off → classic pixel path.
  // Shear shifts the TOP inward (toward the nose) so a slanted cut yields a sharp HIGH INNER peak
  // and a narrower OUTER belly — the Polly pleading parallelogram that rounded-box∩plane alone can't make.
  float peak = uShape.w;
  if (peak > 1e-5) {
    q.x += (-side) * peak * q.y;                         // parallelogram shear (top → inward)
  }
  float r = uShape.x * b.x;
  if (peak > 1e-5) r = mix(r, min(r, 0.18 * b.x), clamp(peak * 1.8, 0.0, 1.0)); // sharper corners for the peak
  vec2 k = abs(q) - b + r;
  float dR = length(max(k, 0.0)) + min(max(k.x, k.y), 0.0) - r;
  vec2 e0 = q * ib, e1 = e0 * ib;
  float k0 = length(e0);
  float dE = k0 * (k0 - 1.0) * inversesqrt(max(dot(e1, e1), 1e-8));
  float d = mix(dR, dE, uShape.y) * g * (rp.z * js);
  vec2 pl = p - ro;
  // Hood / expression cut changes the WHITE OUTLINE (true silhouette), not a painted lid on a fixed oval.
  vec2 cn = side < 0.0 ? uCutN.xy : uCutN.zw;
  d = max(d, dot(pl, cn) - uAsym.z);
  // Outer-biased second hood plane: carves the outer-top/belly while leaving the inner peak
  if (peak > 1e-5) {
    vec2 on = normalize(cn + vec2(side * peak * 0.95, -0.20 * peak));
    float oc = uAsym.z - peak * b.y * 0.40;
    d = max(d, dot(pl, on) - oc);
  }
  return smax(d, pl.y - uShapeC.y, uShapeC.z) * min(sx, 1.0);
}


// toon pupil coverage (unclipped), computed by the centre tap (always called first) and reused by the two side
// taps: the pupil is painted INTO each tap's white colour, so the white's own edge clips it (one AA edge, no
// seam against the rim behind, no light line) and the pupil itself never gets an RGB split. gFillMax = the union
// of the three taps' white fills: the pupil is laid over all three channels there too, so where it nears the
// white's edge (e.g. foreshortened at the limb) the edge's colour split never shows on it.
float gCovP, gFillMax; vec3 gPupilCol;
// ---- emote motifs (Polly batch): pupil glyphs + brows ----
float sdStarIQ(vec2 p){
  // 5-point star, outer radius 1, inner ~0.4 (Inigo Quilez sdStar)
  float an = 3.14159265 / 5.0;
  vec2 acs = vec2(cos(an), sin(an));
  vec2 ecs = vec2(0.401, 0.916);         // ≈ (rf·cos(en), sin(en)) with rf=.38, en=π/5
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, acs.y / ecs.y);
  return length(p) * sign(p.x);
}
// Simpler heart: union of two circles + diamond (stable)
float sdHeart(vec2 p){
  // Inigo Quilez — https://iquilezles.org/articles/distfunctions2d/
  p.x = abs(p.x);
  if (p.y + p.x > 1.0)
    return length(p - vec2(0.25, 0.75)) - sqrt(2.0) * 0.25;
  return sqrt(min(dot(p - vec2(0.00, 1.00), p - vec2(0.00, 1.00)),
                  dot(p - 0.5 * max(p.x + 0.0, 0.0) * vec2(1.0, -1.0),
                      p - 0.5 * max(p.x + 0.0, 0.0) * vec2(1.0, -1.0)))) * sign(p.x - p.y);
}
float sdFlower(vec2 p){
  float a = atan(p.y, p.x), r = length(p);
  return r - (0.50 + 0.32 * cos(6.0 * a));
}
float sdSpiral(vec2 p){
  float a = atan(p.y, p.x), r = length(p);
  float k = 1.35;
  float arm = abs(fract((r * k - a / 6.2831853) * 0.5 + 0.5) - 0.5) * 2.0 / k;
  return arm - 0.10;
}
float sdRing(vec2 p){ return abs(length(p) - 0.70) - 0.16; }
float motifSDF(vec2 pq, float typ){
  if (typ < 1.5) return sdStarIQ(pq);
  if (typ < 2.5) return sdHeart(pq * 0.85 + vec2(0.0, 0.35));
  if (typ < 3.5) return sdSpiral(pq);
  if (typ < 4.5) return sdRing(pq);
  if (typ < 5.5) return sdFlower(pq);
  return length(pq) - 1.0;                                 // tiny-dot (typ 6) scaled by pupil axes
}
// Stroke brow: thick rounded stroke along a quadratic arch (inner → apex → outer),
// tapered toward the outer tip. Per-eye, centred on that eye — not a flat bar / unibrow.
float sdCapsule2(vec2 p, vec2 a, vec2 b, float ra, float rb){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
float sdBrow(vec2 p, float side, vec2 b){
  float lift = uBrow.x * b.y, hw = max(uBrow.y * b.x, 1e-4), th0 = max(uBrow.z * b.x, 1e-4), ang = uBrow.w;
  float arch = uBrowX.x * b.y, taper = clamp(uBrowX.y, 0.15, 1.0);
  float ca = cos(ang), sa = sin(ang);
  // eye-local: origin at eye centre; chord through (0, lift) angled by ang; apex raised by arch
  vec2 along = vec2(side * ca, sa);           // toward outer end
  vec2 up    = vec2(-side * sa, ca);          // across brow, + = above chord
  vec2 mid   = vec2(0.0, lift);
  vec2 inner = mid - along * hw;
  vec2 outer = mid + along * hw;
  vec2 apex  = mid + up * arch;
  float thIn = th0, thMid = th0 * mix(1.0, taper, 0.35), thOut = th0 * taper;
  return min(sdCapsule2(p, inner, apex, thIn, thMid),
             sdCapsule2(p, apex, outer, thMid, thOut));
}
// Classic anime anger-vein (4 short radial strokes) — mark≥1 above outer-upper of each eye;
// mark≥2 also adds a second smaller pop near the brow tip.
float sdAngerMark(vec2 p, float side, vec2 b, float n){
  if (n < 0.5) return 1e3;
  // primary mark sits above-outer relative to eye centre
  vec2 c = vec2(side * b.x * 0.95, b.y * 1.55);
  vec2 q = p - c;
  float s = b.x * 0.22;
  q /= max(s, 1e-4);
  // 4 short capsules through the origin at 45° offsets
  float d = 1e3;
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.5707963 + 0.7853982;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 a1 = dir * 0.15, a2 = dir * 1.05;
    vec2 pa = q - a1, ba = a2 - a1;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    d = min(d, length(pa - ba * h) - 0.14);
  }
  if (n > 1.5) {
    // second smaller pop, slightly higher/outer
    vec2 c2 = vec2(side * b.x * 1.25, b.y * 1.85);
    vec2 q2 = (p - c2) / max(s * 0.7, 1e-4);
    for (int i = 0; i < 4; i++) {
      float a = float(i) * 1.5707963 + 0.4;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 a1 = dir * 0.1, a2 = dir * 0.95;
      vec2 pa = q2 - a1, ba = a2 - a1;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
      d = min(d, length(pa - ba * h) - 0.12);
    }
  }
  return d * s;
}

// eye shading for one chroma tap, given its sphere coordinates (lon, lat) and visible-hemisphere Z
// Polly layered sprites (live path): cell texel coords of a sphere point (same eye-local u, v as eyeTap), closure
// applied; c0 = the eye's first atlas column
// eye-local sphere point -> texels relative to that eye's anchor (no stretch); shared by the eye layers and the deco
vec2 layRel(float lon, float lat, float side){
  float u = lon - uShapeT.w * side;
  float v = lat - uEyeK2.z + uEyeK2.w * u * u;
  return vec2(u, -(v - uShapeC.x)) * uLayC.z;
}
vec2 layT(float lon, float lat, out float c0, out vec4 E, out vec4 M, out vec2 rel){
  float side = lon < 0.0 ? -1.0 : 1.0;
  c0 = side > 0.0 ? LAY_NC : 0.0; E = side > 0.0 ? uLayR : uLayL; M = side > 0.0 ? uLayMR : uLayML;
  rel = side > 0.0 ? uLayH.zw : uLayH.xy;
  return layClose(E.xy + layRel(lon, lat, side), E.y);
}
float layBodyA(float lon, float lat, float s){ float c0; vec4 E, M; vec2 rel; vec2 t = layT(lon, lat, c0, E, M, rel);
  float cl = c0 > 0.5 ? uLayB.y : uLayB.x, dd, ee, lt, ly, lw = cl > 1e-4 ? layLid(t, c0, cl, s, dd, ee, lt, ly) : 1.0;
  return lw * mix(layCov(layTex(c0, t).a, s, 0.0), layCov(layTex(c0 + 6.0, t).a, s, 0.0), layNatK(E)); }
// v6 deco: Polly's own brows, FX (anger marks, blush, tears) and nose shade, straight alpha, in eye-anchor texels.
// Both eyes' cells are sampled everywhere (each holds only its half of the face), so nothing seams at the midline.
vec4 decoTex(float col, vec2 d){
  if (d.x < 0.0 || d.y < 0.0 || d.x > uDecoC.x || d.y > uDecoC.y) return vec4(0.0);
  vec2 c = clamp(d, vec2(0.5), uDecoC.xy - 0.5);
  return texture2D(uDecoTex, (vec2(col * uDecoC.x, uDeco.y * uDecoC.y) + c) * uDeco.zw);
}
// back (under the eyes, as on her sheet): the MID layer (midline-crossing blush smudge + nose shade, centred on the face
// midline and stretched sideways to the rig's eye spacing: uDecoM.x = texels per radian of lon) and each eye's FX.
// v6 review: everything here is masked by the OPEN eye's footprint (rest white | natural white | outline, no lid), so art
// her sheet keeps hidden under the eyes stays hidden when the lid closes (v6 showed the nose shade / blush band as a grey
// or brown slab on every shut frame). The nose shade itself is off on the live path (uDecoM.w = 0: on the glass it read
// as a dark grey rectangle between the eyes).
float layFoot(float lon, float lat, float s){
  float c0; vec4 E, M; vec2 rel; vec2 t = layT(lon, lat, c0, E, M, rel);
  float fw = max(layCov(layTex(c0, t).a, s, 0.0), layCov(layTex(c0 + 6.0, t).a, s, 0.0));
  return max(fw, layCov(layTex(c0 + 4.0, t).a, s, 0.0));
}
vec3 layDecoBack(vec3 col, float lon, float lat, float vis, float Z){
  vis *= 1.0 - layFoot(lon, lat, uLayD.x / (0.5 * Z + 0.5));
  vec2 dm = vec2(lon * uDecoM.x, -(lat - uEyeK2.z + uEyeK2.w * lon * lon - uShapeC.x) * uLayC.z) + uDecoC.zw + uDecoM.yz;
  vec4 sh = decoTex(5.0, dm); col *= mix(vec3(1.0), sh.rgb, sh.a * vis * uDecoB.w * uDecoM.w);   // nose shade: multiply
  vec4 mf = decoTex(4.0, dm); col = mix(col, mf.rgb, mf.a * vis * uDecoB.w);
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? -1.0 : 1.0, c0 = i == 0 ? 0.0 : 2.0;
    vec2 d = layRel(lon, lat, side) + uDecoC.zw + vec2(i == 0 ? uDecoQ.z : uDecoQ.w, 0.0);
    float fs = i == 0 ? uDecoF.x : uDecoF.y;                         // fx pulse about its own centre
    vec2 fc = i == 0 ? uDecoP.xy : uDecoP.zw;
    vec4 fx = decoTex(c0 + 1.0, fc + (d - fc) / max(fs, 0.2));
    col = mix(col, fx.rgb, fx.a * vis * uDecoB.w);
  }
  return col;
}
// front: her brows (own offset + squash toward the brow's base, on springs)
vec3 layDeco(vec3 col, float lon, float lat, float vis){
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? -1.0 : 1.0, c0 = i == 0 ? 0.0 : 2.0;
    vec2 d = layRel(lon, lat, side) + uDecoC.zw + vec2(i == 0 ? uDecoQ.z : uDecoQ.w, 0.0);
    float by = i == 0 ? uDecoB.x : uDecoB.y, bs = i == 0 ? uDecoF.z : uDecoF.w, bq = i == 0 ? uDecoQ.x : uDecoQ.y;
    vec2 db = d - vec2(0.0, by);
    db.y = bq + (db.y - bq) / max(bs, 0.2);
    vec4 br = decoTex(c0, db);
    col = mix(col, br.rgb, br.a * vis * uDecoB.z);
  }
  return col;
}
// Polly glass RGB split on the eye edge: a fraction of the shared chroma offset (subtle glass, clean shapes); the classic
// shapes keep the full split (their path does not come here)
// v5.2: 0.12 (v5 1.0, v5.1 0.3). Past the centre tap's body edge the side-tap channel shows the WHITE colour only, so
// no pupil / motif colour can ever be drawn outside the white (v5.1 mixed the full sprite colour into R / B).
const float LAY_CHROMA = 0.12;
// sprite colours on the sphere: the whole stack comes from the centre tap (all three channels); only the body's own
// edge keeps the glass RGB split (the side taps' body coverage), so sprite detail never gets colour fringes.
vec3 layEyes(vec3 col, float lon, float lat, float Z, vec3 dl){
  float c0; vec4 E, M; vec2 rel; vec2 t = layT(lon, lat, c0, E, M, rel);
  float vl = uEyeP.z * smoothstep(0.02, 0.08, Z);
  // texels per px (foreshortened; squashed: geometric mean of the x (1) and y (1 / squash) footprints, capped). v5 used the
  // full 1 / squash: near shut the AA ramp grew past the +-4 texel SDF range and the whole eye capsule took ~50 % ink
  // (two dark discs on every blink / swap frame).
  float s = uLayD.x / (0.5 * Z + 0.5);
  float ab, ao, mv, mp; vec3 oc;
  vec3 ci = layEye(t, E, M, rel, c0, s, 0.0, c0 > 0.5 ? uLayB.y : uLayB.x, ab, ao, oc, mv, mp);
  vec2 dq = dl.xy * LAY_CHROMA;
  float aR = layBodyA(lon + dq.x, lat + dq.y, s), aB = layBodyA(lon - dq.x, lat - dq.y, s);
  vec3 cw = layTex(c0, t).rgb;                                       // white colour (for the side taps past the edge)
  float kR = aR > ab ? ab / max(aR, 1e-4) : 1.0, kB = aB > ab ? ab / max(aB, 1e-4) : 1.0;
  vec3 c = vec3(mix(col.r, mix(cw.r, ci.r, kR), aR), mix(col.g, ci.g, ab), mix(col.b, mix(cw.b, ci.b, kB), aB));
  c = mix(c, oc, ao);
  return mix(col, c, vl);
}
vec3 eyeTap(vec3 col, float lon, float lat, float Z, float rimA, float pc){
  float side = lon < 0.0 ? -1.0 : 1.0;
  float u = lon - uShapeT.w * side;
  // happy: eyes lift a touch and bow into a soft ∩ (edges droop) — any shape, never flatter than round
  float v = lat - uEyeK2.z + uEyeK2.w * u * u;
  float d = eyeSDF(vec2(u, v), uEyeA.xy, side, vec3(0.0, 0.0, 1.0));      // radians
  float ds = d * RR * (0.5 * Z + 0.5);                        // ≈ screen units (foreshortened)
  float w  = uEyeK.x;
  float vis = uEyeP.z * smoothstep(0.02, 0.08, Z);            // lidFade · z>0.02 cull
  // QA silhouette mode: solid white fill of the (cut) white SDF — no glow/pupil/brows
  if (uQA > 0.5) {
    float fill = step(ds, 0.0);           // hard silhouette (inside white SDF)
    return mix(col, vec3(1.0), fill * step(0.01, vis));
  }
  float dsp = max(ds, 0.0);
  float gv = vis * (1.0 - abs(rimA));                              // the toon rim stays crisp (no glow over it)
  col = tint(col, uGlow, 0.26 * g2(dsp, uEyeK.y) * gv);       // soft luminous glow
  col = mix(col, uAura.rgb, uAura.a * g2(dsp - 1.5, uEyeK.z) * gv);    // pool-coloured aura
  // pebble fill: bright top-right → white → faint shade lower-left, plus a soft inner edge shade
  float uu = clamp(u * uEyeK.w * 0.5 + 0.5, 0.0, 1.0);
  float vv = clamp(0.5 - v * uEyeK2.x, 0.0, 1.0);
  float t  = clamp((0.45*(1.0 - uu) + vv) * (1.0 / 1.2), 0.0, 1.0);
  vec3 ec  = t < 0.5 ? mix(uEyeHi, uEye, t * 2.0) : mix(uEye, uEyeLo, 0.55 * smoothstep(0.55, 1.0, t));
  float rimShade = smoothstep(uEyeK2.y, 0.0, ds) * smoothstep(0.3, 0.9, t);
  ec = mix(ec, uEyeLo, 0.4 * rimShade);
  // toon pupil / emote motif: upright oval (type 0) or glyph (star/heart/spiral/ring/flower/dot). Soft
  // containment keeps it inside the white; lids cover it. Centre tap evaluates, side taps reuse coverage.
  // Motif fill uses uMotifCol; classic toon (type 0, default ink) keeps uToonCol so classic shapes match.
#ifdef TOON
  if (uToon.y > 0.0 && pc > 0.5) {
    float psx = 1.0 + side * uAsym.x;
    vec2 pc2 = side < 0.0 ? uPupilC.xy : uPupilC.zw;
    vec2 pq = uPupilM * vec2(u / psx + side * uPupil.x - uPupil.y - pc2.x, v + side * uAsym.y - uPupil.z - pc2.y);
    float typ = uMotif.x;
    float dp;
    vec2 pqn = pq * uPupilA.zw;
    if (typ < 0.5 || typ > 5.5) {
      // ellipse (0) or tiny-dot (6): same gradient-normalised ellipse as classic toon; type 6 uses smaller axes
      vec2 p0 = pqn, p1 = p0 * uPupilA.zw;
      float pk = length(p0);
      dp = pk * (pk - 1.0) * inversesqrt(max(dot(p1, p1), 1e-8));
    } else {
      dp = motifSDF(pqn, typ);
    }
    dp *= min(psx, 1.0) * uPupil.w * RR * (0.5 * Z + 0.5);
    gCovP = uToon.y * (1.0 - smoothstep(-w, w, dp));
    // Polly / any emote (brow on) uses the motif colour even for oval/dot; classic toon keeps ink
    gPupilCol = (uMotif.z > 0.0 || typ > 0.5) ? uMotifCol : uToonCol;
    // soft white glint (toon-style catchlight) — one soft disc, upper-outer of pupil/motif
    if (uMotif.z > 0.0 && typ < 5.5) {
      vec2 gq = pqn - vec2(0.32, 0.38);
      float gd = length(gq) - (typ < 0.5 ? 0.28 : 0.18);
      float gv = smoothstep(0.0, 1.0, 1.0 - smoothstep(-w, w, gd * uPupil.w * RR * 0.45));
      gPupilCol = mix(gPupilCol, vec3(1.0), gv * 0.75);
    }
  }
  // Polly: lavender upper fill inside the (cut) white
  if (uMotif.z > 0.0) {
    float upper = smoothstep(-uEyeA.y * 0.25, uEyeA.y * 0.25, v);
    ec = mix(ec, vec3(0.76, 0.70, 0.88), 0.75 * upper);
  }
  ec = mix(ec, gPupilCol, gCovP);
#endif
  float fill = 1.0 - smoothstep(-w, w, ds);
#ifdef TOON
  gFillMax = max(gFillMax, fill * vis);
#endif
  return mix(col, ec, fill * vis);
}
// soft offset drop shadow (ambient occlusion on the pool): the eye SDF sampled a little lower, Gaussian
// falloff, multiplied toward the deep pool colour → a darker, bluer band hugging the eye's lower edges.
// Once per pixel (centre tap, before the fill), only inside the eye capsules; follows gaze, lid and fade.
vec3 eyeShadow(vec3 col, float lon, float lat, float Z){
  if (uLay.x > 0.5) return col;                               // Polly layers: the ink outline does that job
  float side = lon < 0.0 ? -1.0 : 1.0;
  float u = lon - uShapeT.w * side;
  float v = lat - uEyeK2.z + uEyeK2.w * u * u + uShadow.y;
  float ds = eyeSDF(vec2(u, v), uEyeA.xy, side, vec3(0.0, 0.0, 1.0)) * RR * (0.5 * Z + 0.5);
  float sh = uShadow.x * uEyeP.z * smoothstep(0.02, 0.08, Z) * g2(max(ds, 0.0), uShadow.z);
  return col * mix(vec3(1.0), uDeep * 0.85, sh);
}
#ifdef TOON
// toon rim (face.js sdToonRim): the eye SDF grown a little and shifted up + outward (classic shapes) or, for
// 'toon', the same white scaled + moved after the shared lattice warp (uRimP), drawn BEHIND the white, so only
// a crescent shows — thick at the top-outer edge, tapering to nothing low and inside (a lid/lash line).
// Once per pixel (centre tap); the white's own taps then cover it with the usual cyan split on the edge.
float eyeRim(float lon, float lat, float Z){
  float side = lon < 0.0 ? -1.0 : 1.0;
  float u = lon - uShapeT.w * side;
  float v = lat - uEyeK2.z + uEyeK2.w * u * u;
  float d = eyeSDF(vec2(u - side * uToonR.x, v - uToonR.y), uEyeA.xy, side, uRimP.xyz) - uToon.z;
  float vis = uEyeP.z * smoothstep(0.02, 0.08, Z);
  return uToon.x * vis * (1.0 - smoothstep(-uEyeK.x, uEyeK.x, d * RR * (0.5 * Z + 0.5)));
}
#endif
// squared distance from p to segment ab (capsule test without a sqrt)
float seg2(vec2 p, vec4 ab){ vec2 pa = p - ab.xy, ba = ab.zw - ab.xy;
  vec2 e = pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return dot(e, e); }
// eyes with a gentle RGB split: screen → sphere (r=RR) → undo roll, yaw, pitch → lon/lat → analytic
// stadium (AstridFace.eyePath). The sphere map runs ONCE at p; the R and B taps (p ± off, 1–4u away)
// step along its analytic Jacobian (second-order error ≈ 0.01u — invisible) instead of 3 full maps.
vec3 eyes(vec3 col, vec2 p, vec2 off){
  vec2 s0 = (p - C) * (1.0 / RR); s0.y = -s0.y;
  vec2 s = vec2(s0.x*uFace.x + s0.y*uFace.y, -s0.x*uFace.y + s0.y*uFace.x);   // undo roll
  float rr = dot(s, s);
  if (rr >= 0.999) return col;
  float Z  = sqrt(1.0 - rr);
  float x  = s.x*uRot.x - Z*uRot.y;
  float z1 = s.x*uRot.y + Z*uRot.x;
  float y  = s.y*uRot.z + z1*uRot.w;
  float z  = -s.y*uRot.w + z1*uRot.z;
  float lon = atan(x, z), lat = asin(clamp(y, -1.0, 1.0));
  // Jacobian wrt s, then wrt screen units (s = R(−roll)·diag(1,−1)·(p−C)/RR)
  vec2 gZ  = -s / Z;
  vec2 gx  = vec2(uRot.x, 0.0) - uRot.y * gZ;
  vec2 gz1 = vec2(uRot.y, 0.0) + uRot.x * gZ;
  vec2 gy  = vec2(0.0, uRot.z) + uRot.w * gz1;
  vec2 gz  = vec2(0.0, -uRot.w) + uRot.z * gz1;
  float h2 = x*x + z*z;                                       // = cos²(lat)
  vec2 gLon = (z * gx - x * gz) / h2, gLat = gy * inversesqrt(max(h2, 1e-6));
  // Δs for the screen offset o: (cr·o.x − sr·o.y, −sr·o.x − cr·o.y)/RR
  vec2 ds_ = vec2(uFace.x*off.x - uFace.y*off.y, -uFace.y*off.x - uFace.x*off.y) * (1.0 / RR);
  vec3 dl = vec3(dot(gLon, ds_), dot(gLat, ds_), dot(gZ, ds_));
  col = eyeShadow(col, lon, lat, Z);
#ifdef TOON
  // toon variant (compiled only while the toon layer is on: '#define TOON' is prepended by index.html)
  float rimA = 0.0;                                            // ≥ 0 on the centre tap, ≤ 0 on the side taps
  if (uQA < 0.5 && uToon.x > 0.0) { rimA = eyeRim(lon, lat, Z); col = mix(col, uToonCol, rimA); }
  // Polly layers first, then brows (stroke) and FX (anger marks, blush) on top of them (layer order)
  if (uLay.x > 0.5 && uDeco.x > 0.5) col = layDecoBack(col, lon, lat, uEyeP.z * smoothstep(0.02, 0.08, Z), Z);
  if (uLay.x > 0.5) col = layEyes(col, lon, lat, Z, dl);
  // v6: Polly's own brows / FX / nose shade (sprites from her sheet) replace the stroke brows + anger marks on that path
  if (uLay.x > 0.5 && uDeco.x > 0.5) col = layDeco(col, lon, lat, uEyeP.z * smoothstep(0.02, 0.08, Z));
  // emote stroke brows (arched tapered capsules + dark outline) + anger marks + soft blush
  else if (uQA < 0.5 && uMotif.z > 0.0) {
    float side = lon < 0.0 ? -1.0 : 1.0;
    float u = lon - uShapeT.w * side;
    float v = lat - uEyeK2.z + uEyeK2.w * u * u;
    float sc = RR * (0.5 * Z + 0.5);
    float db = sdBrow(vec2(u, v), side, uEyeA.xy) * sc;
    float ow = max(uBrowX.z, 0.0) * max(uBrow.z * uEyeA.x, 1e-4) * sc;  // outline width in screen units
    float vis = uEyeP.z * smoothstep(0.02, 0.08, Z);
    float fill = 1.0 - smoothstep(-uEyeK.x, uEyeK.x, db);
    float outline = (1.0 - smoothstep(-uEyeK.x, uEyeK.x, db - ow)) - fill;
    col = mix(col, uBrowCol * 0.45, outline * vis * uMotif.z);          // dark stroke edge
    col = mix(col, uBrowCol, fill * vis * uMotif.z);
    // anger-vein marks (uMotif.y = 0/1/2)
    if (uMotif.y > 0.5) {
      float dm = sdAngerMark(vec2(u, v), side, uEyeA.xy, uMotif.y) * sc;
      float mv = vis * (1.0 - smoothstep(-uEyeK.x, uEyeK.x, dm));
      col = mix(col, uMotifCol, mv * 0.95);
    }
  }
  if (uQA < 0.5 && uMotif.w > 0.0 && uLay.x < 0.5) {   // not on the Polly layer path (v5.2: it drew a thin ring there)
    // blush: soft ellipses just below/outside each eye (love / blush poses)
    float side = lon < 0.0 ? -1.0 : 1.0;
    float u = lon - uShapeT.w * side + side * uEyeA.x * .55;
    float v = lat - uEyeK2.z - uEyeA.y * .85;
    vec2 be = vec2(u / (uEyeA.x * .7), v / (uEyeA.y * .35));
    float bd = (length(be) - 1.0) * RR * .5;
    float bv = uEyeP.z * smoothstep(0.02, 0.08, Z) * exp(-bd*bd*2.5) * .55;
    col = mix(col, vec3(.95,.35,.55), bv * uMotif.w);
  }
  if (uLay.x > 0.5) return col;
  gCovP = 0.0; gFillMax = 0.0; gPupilCol = uToonCol;
  float cg = eyeTap(col, lon, lat, Z, rimA, 1.0).g;            // centre tap (also the pupil)
  vec3 c = vec3(eyeTap(col, lon + dl.x, lat + dl.y, Z + dl.z, -rimA, 0.0).r, cg,
                eyeTap(col, lon - dl.x, lat - dl.y, Z - dl.z, -rimA, 0.0).b);   // side taps skip the pupil
  return mix(c, gPupilCol, gCovP * gFillMax);
#else
  if (uLay.x > 0.5) return layEyes(col, lon, lat, Z, dl);
  return vec3(eyeTap(col, lon + dl.x, lat + dl.y, Z + dl.z, 0.0, 0.0).r,
              eyeTap(col, lon, lat, Z, 0.0, 0.0).g,
              eyeTap(col, lon - dl.x, lat - dl.y, Z - dl.z, 0.0, 0.0).b);
#endif
}

void main(){
  vec2 f = gl_FragCoord.xy;
  vec2 p = vP;                                 // already squash/stretched (petting) in the vertex stage
  vec2 d = p - C; float r = length(d * 0.01) * 100.0;   // scaled: no fp16 overflow far off-orb (mediump)
  float dith = (dhash(mod(f, 64.0)) - 0.5) / 255.0;     // dither (kills 8-bit banding)

  // QA silhouette: black page, solid white eye fills (cut SDF) — for IoU vs ref masks
  if (uQA > 0.5 && uLay.x > 0.5) { gl_FragColor = vec4(layQA(vec3(136.0 / 255.0)), 1.0); return; }
  if (uQA > 0.5) {
    vec3 col = vec3(0.0);
    if (uAtlas.x > -0.5) {
      // Screen-space traced stamps (1:1 vs flat ref silhouettes)
      float d = min(atlasStamp(p, uStampL, -1.0), atlasStamp(p, uStampR, 1.0));
      col = mix(col, vec3(1.0), step(d, 0.0));
    } else {
      float rj = uEyeP.w;
      if (uEyeP.z > 0.0 && min(seg2(p, uEyeL), seg2(p, uEyeR)) < rj * rj)
        col = eyes(col, p, vec2(0.0));
    }
    gl_FragColor = vec4(col, 1.0); return;
  }
  // early-out: past the bloom (its gaussian is < 0.3% there) only paper remains
  if (r > uFrost.w) { gl_FragColor = vec4(uPaper + dith, 1.0); return; }

  // ---- frost: paper · white bloom · frosted body (all fixed; Gaussian edge, no outline) ----
  float out_ = max(r - R + 4.0, 0.0);
  vec3 col = mix(uPaper, uHalo, 0.38 * g2(out_, uFrost.x));
  float body = 1.0 - smoothstep(uFrost.y, uFrost.z, r);
  col = mix(col, uEdge, body);

  if (r < R + 12.0) {
    float low = (p.y - C.y) * (1.0 / R);       // −1 top … +1 bottom
    // ---- petting contact: a shallow dent under the finger (concave lens → slight minify) ----
    vec2 pt = p - uTouch.xy;
    float tg = g2(length(pt), uMisc.z) * uTouch.z;
    vec2 pl = p + pt * (0.22 * uMisc.w * tg);
    // ---- pool: head-turn (inverted, delayed) → noise warp (vertex grid) → random-target drift ----
    vec2 q = pl * uQ.xy + uQ.zw + vWarp;
    float dP = length(uBB * q + uCB);          // main pool: a broad dome rising from below the orb
    float aP = 1.0 - smoothstep(0.48, 0.98, dP);
    vec3  cP = mix(uMid, uCore, smoothstep(0.95, 0.55, dP));
    float dA = length(uBA * q + uCA);          // deeper floor (bottom, slightly off-centre)
    float aA = 0.55 * (1.0 - smoothstep(0.1, 1.0, dA));
    float dC = length(uBC * q + uCC);          // pale bloom that morphs through the upper pool
    float aC = 0.45 * (1.0 - smoothstep(0.0, 1.0, dC));
    // frosted margin: the pool never reaches the rim (sides wide, bottom thinner)
    float inset = mix(uPoolK.x, uPoolK.y, smoothstep(0.2, 0.95, low)) + 4.0;
    float rb = R - inset;                                       // pool boundary radius
    float m = 1.0 - smoothstep(rb - uPoolK.z, rb + uPoolK.w, r);
    float pa = clamp(aP * uMisc.x, 0.0, 1.0);
    vec3 pool = mix(uEdge, cP, pa);
    pool = mix(pool, uDeep, aA * aP * uMisc.x);
    pool = mix(pool, uBloomCol, aC * aP);
    // backlit floor: just above the bottom margin the pool goes lighter + cyan (luminous, not muddy)
    float lift = smoothstep(0.55, 0.95, low) * m;
    pool = mix(pool, uLiftCol, 0.55 * lift * pa * (1.0 - uMode.y*0.5));
    col = mix(col, pool, m * body);

    // ---- haze: white veil, heavier toward the top (fixed) ----
    float hz = uFringeK.w * (0.06 + 0.70 * smoothstep(-0.38, -0.98, low));
    col = mix(col, uEdge, clamp(hz, 0.0, 1.0) * body);

    // ---- fringe: blurred prism smear where the blue meets the frosted margin, strongest low ----
    float fr = uFringeK.z * smoothstep(-0.35, 0.85, low) * (0.25 + 0.75 * clamp(pa * 1.6, 0.0, 1.0));
    col = tint(col, PINK, 0.44 * fr * g2(r - (rb + 2.0), uFringeK.x));
    col = tint(col, CYAN, 0.30 * fr * g2(r - (rb - 7.0), uFringeK.x));
    // faint outer smear on the paper just below the form's soft bottom edge
    col = tint(col, PINK, 0.07 * uFringeK.z * smoothstep(0.5, 1.0, low) * g2(r - (R + 2.0), uFringeK.y));

    // ---- eyes: 3 taps (R/G/B) at slightly different positions → gentle chromatic edge ----
    vec2 dir = r > 1e-3 ? d / r : vec2(0.0);
    vec2 off = (dir * (0.8 + 2.2 * min(r * (1.0 / R), 1.0)) + vec2(1.5, 0.0)) * uMisc.y;
    // one tight bounding test for all three taps (each tap is within |off| of pl)
    float rj = uEyeP.w + length(off);
    if (uEyeP.z > 0.0 && min(seg2(pl, uEyeL), seg2(pl, uEyeR)) < rj * rj)
      col = eyes(col, pl, off);
    // contact light: the glass brightens softly where it's touched; dent walls shade (light top-left)
    col = tint(col, uTouchCol, 0.34 * tg * body);
    col += vec3(uMisc.w * tg * body * dot(pt, vec2(0.05 * 0.7 / 34.0)));
  }

  gl_FragColor = vec4(col + dith, 1.0);
}
