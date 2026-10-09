// Astrid glass · "vibe" (v8), solo build: carbon coat + the Toon eye. One draw call over a canvas sized to the
// orb + bloom. GLSL ES 1.00 (WebGL1/2). Units: AstridFace 240-space. Orb r118 at (120,120); stage framing -50..290.
// Look: a frosted form that bleeds into the paper with a Gaussian edge (no outline, no glint), a luminous pool
// glowing up from the BOTTOM and fading to haze at the top, a faint pink/cyan prism smear only along the soft lower
// boundary, and two Toon eyes (the drawing tutorial's eye: upright ellipse, lower half squashed up by a fixed
// lattice, a dark rim crescent peeking out behind it, tall dark pupils) with a slight RGB split.
// Layering (bottom → top):
//   frost(p)  : paper · bloom into the page · frosted body (Gaussian edge)                [fixed]
//   pool(p)   : drifting blob field (pool, deep floor, bloom) moved by the delayed, inverted head turn,
//               noise warp and random-target drift; inset so a frosted margin stays around it
//   haze      : veil, heavier toward the top                                              [fixed]
//   fringe    : pink outside / cyan inside where the pool meets the frosted margin, strongest low
//   eyes      : drop shadow · rim crescent · soft glow + fill sampled 3× (R/G/B) → gentle chromatic edge · pupils
//   petting   : body squash/stretch (whole frame), contact lens dent + soft brightening under the finger
// Efficiency: the noise warp and the body transform run per vertex of a coarse grid (glass.vert);
// everything that is constant across the frame is computed on the CPU (blob transforms with
// their radii folded in, head-turn map, eye box, every slider-derived width/edge, derived
// colours); gaussians are exp2 with a precomputed −log2(e)/w² factor; pixels past the bloom early-out to
// paper (+ a sin-free dither hash); the eye SDF runs only inside a tight capsule per eye (CPU-projected
// axis + glow margin) and does ONE sphere inversion per pixel: the R/B chroma taps reuse it through the
// analytic Jacobian of (lon, lat) instead of two more inversions.
// The page background is the same paper colour, so the canvas itself only covers the orb + bloom.
// Port note (Metal): uniforms map 1:1 to a constant buffer; plain functions; one texture (the thinking screen).
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
uniform vec4  uEyeA;    // eye box (radians): half width, half visible height, 1/hw, 1/hh
uniform vec4  uShapeC;  // eye (radians): centre offset (happy squint), blink lid line (rel. to centre), lid corner k, rest lon (±)
uniform vec4  uAsym;    // 3/4 asymmetry: width scale ±(1 + side·x), height offset (side·y); expression-lid height z, height scale ±(1 + side·w)
uniform vec4  uCutN;    // expression-lid line normal: left eye (xy), right eye (zw)
uniform vec4  uLat;     // fixed lattice warp: 1/k of the bottom row inner, mid, outer; 1/(1.4·hw)
uniform vec4  uToon;    // toon layer: rim alpha (0 = off → skipped), pupil alpha (0 = off), -, -
uniform vec4  uRimP;    // rim after the shared warp: outward, up (rad), scale, -
uniform vec4  uPupil;   // pupil centre (rad, eye-local): inward rest, gaze u, v; SDF scale of the dart stretch
uniform mat2  uPupilM;  // pupil dart stretch: eye-local → pupil frame (identity at rest)
uniform vec4  uPupilA;  // pupil semi-axes a, b and 1/a, 1/b (rad)
uniform vec4  uPupilC;  // per-eye pupil centre offsets from the soft containment (face.js containPupil): L xy, R zw
uniform vec3  uToonCol; // toon ink (rim + pupils): the coat's dark tone
uniform vec4  uShadow;  // eye drop shadow: strength, lat offset down (rad), gauss k (exp2), -
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
// ---- thinking: pupil takeover screen (0 = off → skipped). The pupil scales past the white and is clipped to
// the eye outline (uScr.y ≤ 0, no sclera rim). Where it covers the white it is a screen: canvas2D text texture
// (both eyes side by side), scanlines, edge vignette. Centre tap only (no RGB split on the screen, like the pupil).
// A blink's lid is in the white SDF, so the lid still cuts across the screen. The dark rim crescent stays,
// because it sits where the white fill is ~0.
uniform sampler2D uScrT;
uniform vec4  uScr;     // on (0/1), inset margin (rad), text brightness 0…1, flicker gain
uniform vec4  uScrM;    // text frame: top v (rad, rel. to eye centre), S (tex units per rad), scanlines per screen, scanline depth
uniform vec4  uScrK;    // vignette width (rad), bg lift, bg mix (pupil ink → screen bg), -
uniform vec3  uScrBg;   // screen background (dark)
uniform vec4  uEmo;     // heart 0..1 (kept at 0: pupils stay the tall ovals), warm 0..1, pupil width scale, smile glow
uniform vec4  uLove;    // love: z = M1 pool+rim (1.15) on happy face; x/y/w retired (stay 0)

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

// ---- the eye: ONE SDF in eye-local sphere coords (radians; < 0 inside), box b = (half w, half h) (face.js eyeSDF):
// 3/4 asymmetry → happy-squint centre → fixed lattice (lower half squashed up, inner more than outer) → rim
// transform → gradient-normalised ellipse → expression lid line → blink lid from the top (smooth-max'd).
// smooth max: rounds the corner where the lid line meets the shape by ~k
float smax(float a, float c, float k){ float h = max(k - abs(a - c), 0.0) / k; return max(a, c) + h * h * k * 0.25; }
// rp = rim transform applied after the shared lattice warp (outward, up, scale; vec3(0,0,1) = the white itself).
float eyeSDF(vec2 p, vec2 b, float side, vec3 rp){
  float sx = 1.0 + side * uAsym.x;
  float sy = max(0.35, 1.0 + side * uAsym.w);
  p.y += side * uAsym.y; p.x /= sx; p.y /= sy;
  p.y -= uShapeC.x;
  vec2 ib = uEyeA.zw;
  float f = clamp(-side * p.x * uLat.w, -1.0, 1.0);
  float wl = uLat.y + (f > 0.0 ? uLat.x - uLat.y : uLat.y - uLat.z) * f;
  vec2 pw = vec2(p.x, p.y < 0.0 ? p.y * wl : p.y);
  float js = 1.0 / (1.0 + (wl - 1.0) * clamp(-2.0 * p.y * ib.y, 0.0, 1.0));
  vec2 ro = vec2(side * rp.x, rp.y);
  vec2 q = (pw - ro) / rp.z;
  vec2 e0 = q * ib, e1 = e0 * ib;
  float k0 = length(e0);
  float d = k0 * (k0 - 1.0) * inversesqrt(max(dot(e1, e1), 1e-8)) * (rp.z * js);
  vec2 pl = p - ro;                                    // lid lines ride with the rim (lash line)
  vec2 cn = side < 0.0 ? uCutN.xy : uCutN.zw;
  d = max(d, dot(pl, cn) - uAsym.z);                   // expression lid (debug sliders; parked far above = none)
  return smax(d, pl.y - uShapeC.y, uShapeC.z) * min(min(sx, sy), 1.0);
}

// pupil coverage (unclipped), computed by the centre tap (always called first) and reused by the two side
// taps: the pupil is painted INTO each tap's white colour, so the white's own edge clips it (one AA edge, no
// seam against the rim behind, no light line) and the pupil itself never gets an RGB split. gFillMax = the union
// of the three taps' white fills: the pupil is laid over all three channels there too, so where it nears the
// white's edge (e.g. foreshortened at the limb) the edge's colour split never shows on it.
float gCovP, gFillMax; vec3 gScrC;

// eye shading for one chroma tap, given its sphere coordinates (lon, lat) and visible-hemisphere Z
vec3 eyeTap(vec3 col, float lon, float lat, float Z, float rimA, float pc){
  float side = lon < 0.0 ? -1.0 : 1.0;
  float u = lon - uShapeC.w * side;
  // happy: eyes lift a touch and bow into a soft ∩ (edges droop)
  float v = lat - uEyeK2.z + uEyeK2.w * u * u;
  float d = eyeSDF(vec2(u, v), uEyeA.xy, side, vec3(0.0, 0.0, 1.0));      // radians
  float ds = d * RR * (0.5 * Z + 0.5);                        // ≈ screen units (foreshortened)
  float w  = uEyeK.x;
  float vis = uEyeP.z * smoothstep(0.02, 0.08, Z);            // lidFade · z>0.02 cull
  float dsp = max(ds, 0.0);
  float gv = vis * (1.0 - abs(rimA));                              // the rim stays crisp (no glow over it)
  vec3 glowC = mix(uGlow, vec3(1.0, 0.58, 0.74), clamp(uEmo.y, 0.0, 1.0));
  col = tint(col, glowC, 0.26 * (1.0 + 0.95 * uEmo.w + 0.4 * uEmo.y) * g2(dsp, uEyeK.y) * gv);
  // glow rim just outside the white. z=1 is the faint take; z>1 thickens + brightens (still muted).
  float gz = max(uLove.z, 0.0);
  float gBoost = max(gz - 1.0, 0.0);
  float roseOuter = 7.5 + 5.5 * gBoost;
  float roseRing = smoothstep(-0.4, 2.2, ds) * (1.0 - smoothstep(2.2, roseOuter, ds));
  col = mix(col, vec3(0.78, 0.48, 0.52), min(0.62 * gz, 0.92) * roseRing * vis);
  col = mix(col, uAura.rgb, uAura.a * g2(dsp - 1.5, uEyeK.z) * gv);    // pool-coloured aura
  // pebble fill: bright top-right → eye colour → faint shade lower-left, plus a soft inner edge shade
  float uu = clamp(u * uEyeK.w * 0.5 + 0.5, 0.0, 1.0);
  float vv = clamp(0.5 - v * uEyeK2.x, 0.0, 1.0);
  float t  = clamp((0.45*(1.0 - uu) + vv) * (1.0 / 1.2), 0.0, 1.0);
  vec3 ec  = t < 0.5 ? mix(uEyeHi, uEye, t * 2.0) : mix(uEye, uEyeLo, 0.55 * smoothstep(0.55, 1.0, t));
  float rimShade = smoothstep(uEyeK2.y, 0.0, ds) * smoothstep(0.3, 0.9, t);
  ec = mix(ec, uEyeLo, 0.4 * rimShade);
  ec = mix(ec, vec3(1.0), 0.22 * uEmo.w);                              // happy: brighter white
  ec = mix(ec, vec3(1.0, 0.80, 0.86), 0.38 * uEmo.y);                  // happy's small warm (live)
  // dusty rose only in the lower white. Stronger when paired with glow (B/D).
  float blushK = 0.34 + 0.28 * step(0.5, uLove.z);
  ec = mix(ec, vec3(0.80, 0.58, 0.62), uLove.x * vv * blushK);
  // pupil: upright oval; soft containment (CPU) keeps it inside the white; lids cover it. Centre tap evaluates,
  // side taps reuse its coverage.
  if (uToon.y > 0.0 && pc > 0.5) {
    float psx = 1.0 + side * uAsym.x;
    float psy = max(0.35, 1.0 + side * uAsym.w);
    vec2 pc2 = side < 0.0 ? uPupilC.xy : uPupilC.zw;
    vec2 pq = uPupilM * vec2(u / psx + side * uPupil.x - uPupil.y - pc2.x, (v + side * uAsym.y - uPupil.z - pc2.y) / psy);
    float nw = max(uEmo.z, 0.3);                               // < 1 narrows the pupil (angry)
    pq.x /= nw;
    vec2 p0 = pq * uPupilA.zw, p1 = p0 * uPupilA.zw;           // gradient-normalised ellipse
    float pk = length(p0);
    float dp = pk * (pk - 1.0) * inversesqrt(max(dot(p1, p1), 1e-8));
    dp *= min(min(psx, psy), 1.0) * uPupil.w * nw * RR * (0.5 * Z + 0.5);
    vec3 pcol = uToonCol;
    if (uScr.x > 0.0) {
      // the screen: pupil ∩ eye outline. uScr.y ≤ 0 pushes the clip past the white so the sclera is gone;
      // the white's own fill (below, and the composite in eyes()) is the clip. d includes lids → a blink covers it.
      float din = d + uScr.y;
      dp = max(dp, din * RR * (0.5 * Z + 0.5));
      float vy = v - uShapeC.x;
      vec2 tl = vec2(0.5 + u * uScrM.y, (uScrM.x - vy) * uScrM.y);       // eye-local text frame (not mirrored)
      vec2 tc = vec2(clamp(tl.x, 0.004, 0.996) * 0.5 + (side < 0.0 ? 0.0 : 0.5), clamp(tl.y, 0.0, 1.0));
      vec3 tx = texture2D(uScrT, tc).rgb;
      float sl = abs(fract(tl.y * uScrM.z) - 0.5) * 2.0;                 // triangle scanline (spatial, not time)
      float vig = mix(0.45, 1.0, smoothstep(0.0, uScrK.x, -din));        // bezel falloff toward the margin
      pcol = mix(uToonCol, uScrBg, uScrK.z) * (1.0 + uScrK.y * vig)
           + tx * (uScr.z * uScr.w * vig * (1.0 - uScrM.w * sl));
      gScrC = pcol;
    }
    float cover = 1.0 - smoothstep(-w, w, dp);
    gCovP = uToon.y * cover;
  }
  vec3 pcol2 = uScr.x > 0.0 ? gScrC : uToonCol;
  ec = mix(ec, pcol2, gCovP);
  float fill = 1.0 - smoothstep(-w, w, ds);
  gFillMax = max(gFillMax, fill * vis);
  return mix(col, ec, fill * vis);
}
// soft offset drop shadow (ambient occlusion on the pool): the eye SDF sampled a little lower, Gaussian
// falloff, multiplied toward the deep pool colour → a darker band hugging the eye's lower edges.
// Once per pixel (centre tap, before the fill), only inside the eye capsules; follows gaze, lid and fade.
vec3 eyeShadow(vec3 col, float lon, float lat, float Z){
  float side = lon < 0.0 ? -1.0 : 1.0;
  float u = lon - uShapeC.w * side;
  float v = lat - uEyeK2.z + uEyeK2.w * u * u + uShadow.y;
  float ds = eyeSDF(vec2(u, v), uEyeA.xy, side, vec3(0.0, 0.0, 1.0)) * RR * (0.5 * Z + 0.5);
  float sh = uShadow.x * uEyeP.z * smoothstep(0.02, 0.08, Z) * g2(max(ds, 0.0), uShadow.z);
  return col * mix(vec3(1.0), uDeep * 0.85, sh);
}
// rim (the tutorial's step 4): the same white scaled + moved after the shared lattice warp (uRimP), drawn BEHIND
// the white, so only a crescent shows: thick at the top-outer edge, tapering to nothing low and inside (a lid/lash
// line). Once per pixel (centre tap); the white's own taps then cover it with the usual split on the edge.
float eyeRim(float lon, float lat, float Z){
  float side = lon < 0.0 ? -1.0 : 1.0;
  float u = lon - uShapeC.w * side;
  float v = lat - uEyeK2.z + uEyeK2.w * u * u;
  float d = eyeSDF(vec2(u, v), uEyeA.xy, side, uRimP.xyz);
  float vis = uEyeP.z * smoothstep(0.02, 0.08, Z);
  return uToon.x * vis * (1.0 - smoothstep(-uEyeK.x, uEyeK.x, d * RR * (0.5 * Z + 0.5)));
}
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
  float rimA = 0.0;                                            // ≥ 0 on the centre tap, ≤ 0 on the side taps
  if (uToon.x > 0.0) { rimA = eyeRim(lon, lat, Z); col = mix(col, uToonCol, rimA); }
  gCovP = 0.0; gFillMax = 0.0; gScrC = uToonCol;
  float cg = eyeTap(col, lon, lat, Z, rimA, 1.0).g;            // centre tap (also the pupil)
  vec3 c = vec3(eyeTap(col, lon + dl.x, lat + dl.y, Z + dl.z, -rimA, 0.0).r, cg,
                eyeTap(col, lon - dl.x, lat - dl.y, Z - dl.z, -rimA, 0.0).b);   // side taps skip the pupil
  float cov = gCovP * gFillMax;
  if (uScr.x > 0.0) {
    // full takeover: any pixel the white owns becomes screen, including the antialiased edge,
    // so that edge blends screen into the rim instead of leaving a sclera ring. The crescent
    // (white fill ~ 0) is untouched. gCovP still limits it to the pupil, so the shrink-back reads.
    cov = gCovP * smoothstep(0.0, 0.02, gFillMax);
  }
  vec3 ink = uScr.x > 0.0 ? gScrC : uToonCol;
  c = mix(c, ink, cov);
  // take 2: three short dark strokes at the outer corner. No motion. They start on the lid and step just past it.
  if (uLove.y > 0.001) {
    float side = lon < 0.0 ? -1.0 : 1.0;
    float u = lon - uShapeC.w * side;
    float v = lat - uEyeK2.z + uEyeK2.w * u * u;
    float hw = uEyeA.x, hh = uEyeA.y;
    vec2 o = vec2(side * hw * 0.52, hh * 0.78);
    float sg = side;
    vec2 qe = vec2(u, v);
    float d2 = seg2(qe, vec4(o, o + vec2(sg * 0.016, 0.055)));
    d2 = min(d2, seg2(qe, vec4(o + vec2(sg * 0.018, 0.006), o + vec2(sg * 0.050, 0.058))));
    d2 = min(d2, seg2(qe, vec4(o + vec2(sg * 0.034, -0.004), o + vec2(sg * 0.078, 0.028))));
    float th = 0.010;
    float a = (1.0 - smoothstep(th * th * 0.25, th * th, d2)) * uEyeP.z * smoothstep(0.02, 0.08, Z) * uLove.y;
    c = mix(c, vec3(0.11, 0.08, 0.09), a);
  }
  return c;
}

void main(){
  vec2 f = gl_FragCoord.xy;
  vec2 p = vP;                                 // already squash/stretched (petting) in the vertex stage
  vec2 d = p - C; float r = length(d * 0.01) * 100.0;   // scaled: no fp16 overflow far off-orb (mediump)
  float dith = (dhash(mod(f, 64.0)) - 0.5) / 255.0;     // dither (kills 8-bit banding)

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
    pool = mix(pool, vec3(1.0, 0.93, 0.88), 0.28 * uEmo.w * pa);          // happy: a little warmer glass
    pool = mix(pool, vec3(1.0, 0.48, 0.66), 0.26 * uEmo.y * pa);          // happy's small warm, same as the live shader
    // love glow: dusty rose in the pool. z=1 faint; z>1 warmer + a touch stronger.
    float gz = max(uLove.z, 0.0);
    float gBoost = max(gz - 1.0, 0.0);
    vec3 rosePool = mix(vec3(0.72, 0.46, 0.50), vec3(0.76, 0.44, 0.48), clamp(gBoost, 0.0, 1.0));
    pool = mix(pool, rosePool, min(0.34 * gz + 0.10 * gBoost, 0.58) * pa);
    // take C: a small dusty-rose heart in the lower pool (under the eyes, outside the whites).
    if (uLove.w > 0.001) {
      // IQ heart SDF; AstridFace y grows down, so flip y so the point aims into the pool.
      vec2 hp = (pl - vec2(C.x, C.y + 28.0)) / 12.0;
      hp.x = abs(hp.x);
      hp.y = -hp.y;
      float dH = (hp.y + hp.x > 1.0)
        ? length(hp - vec2(0.25, 0.75)) - 0.35355
        : min(length(hp - vec2(0.00, 1.00)), length(hp - vec2(0.50, 0.00))) * sign(hp.x - hp.y);
      float ha = (1.0 - smoothstep(-0.04, 0.10, dH)) * uLove.w * m * body;
      float haSoft = (1.0 - smoothstep(-0.15, 0.45, dH)) * uLove.w * m * body * 0.30 * pa;
      pool = mix(pool, vec3(0.76, 0.40, 0.46), clamp(ha * 0.98 + haSoft, 0.0, 1.0));
    }
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
