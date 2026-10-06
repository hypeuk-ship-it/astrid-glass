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
uniform vec4  uShape;   // eye shape params: corner radius ×hw, ellipse weight, egg taper, -
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
uniform vec3  uToonCol; // toon ink: the coat's dark/mark tone
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

// ---- eye shapes: ONE parametric SDF in eye-local sphere coords (radians; < 0 inside), box b = (half w,
// half h). Every shape is a parameter set (face.js SHAPES / eyeSDFP): stadium = rounded box with r = hw,
// squircle r = .55hw, dot = round box, oval = ellipse, egg = tapered ellipse, bean = leaning bowed ellipse,
// ref = plump (mostly ellipse) egg leaning outward; toon = ellipse whose lower half a fixed lattice squashes up.
// A shape switch lerps the params on the CPU → no branches, one evaluation per tap, even mid-morph.
// smooth max: rounds the corner where the lid line meets the shape by ~k
float smax(float a, float c, float k){ float h = max(k - abs(a - c), 0.0) / k; return max(a, c) + h * h * k * 0.25; }
// rp = rim transform applied after the shared lattice warp ('toon' rim: outward, up, scale; vec3(0,0,1) = none).
float eyeSDF(vec2 p, vec2 b, float side, vec3 rp){
  float sx = 1.0 + side * uAsym.x;                                        // 3/4 asymmetry ('toon' slider; 0 otherwise):
  p.y += side * uAsym.y; p.x /= sx;                                       //  per-eye width + height
  p.y -= uShapeC.x;                                                       // squint: centre drops ('top' shapes)
  vec2 ib = uEyeA.zw;                                                     // 1/b (CPU)
  // ONE fixed 3×3 lattice ('toon'; identity otherwise): only the bottom row moves → below the centre the sample
  // is pulled down by w = lerp(1/k) across the columns (inner · mid · outer); js keeps the SDF ~unit (continuous)
  float f = clamp(-side * p.x * uLat.w, -1.0, 1.0);
  float wl = uLat.y + (f > 0.0 ? uLat.x - uLat.y : uLat.y - uLat.z) * f;
  vec2 pw = vec2(p.x, p.y < 0.0 ? p.y * wl : p.y);
  float js = 1.0 / (1.0 + (wl - 1.0) * clamp(-2.0 * p.y * ib.y, 0.0, 1.0));
  vec2 ro = vec2(side * rp.x, rp.y);
  pw = (pw - ro) / rp.z;                                                  // rim: the same white scaled + moved (shared warp)
  vec2 q = vec2(uShapeT.x * pw.x + side * uShapeT.y * pw.y, -side * uShapeT.y * pw.x + uShapeT.x * pw.y);  // lean
  float yn = clamp(q.y * ib.y, -1.0, 1.0);
  q.x -= side * uShapeT.z * b.x * (1.0 - yn * yn);                       // bow
  float g = 1.0 - uShape.z * yn; q.x /= g;                                // taper (egg)
  float r = uShape.x * b.x; vec2 k = abs(q) - b + r;
  float dR = length(max(k, 0.0)) + min(max(k.x, k.y), 0.0) - r;           // rounded box
  vec2 e0 = q * ib, e1 = e0 * ib;                                         // ellipse (gradient-normalised
  float k0 = length(e0);                                                  //  approx, exact on the edge)
  float dE = k0 * (k0 - 1.0) * inversesqrt(max(dot(e1, e1), 1e-8));
  float d = mix(dR, dE, uShape.y) * g * (rp.z * js);
  vec2 pl = p - ro;                                                       // lid lines ride with the rim (lash line)
  d = smax(d, dot(pl, side < 0.0 ? uCutN.xy : uCutN.zw) - uAsym.z, uAsym.w);   // cut / expression lid (parked = none)
  return smax(d, pl.y - uShapeC.y, uShapeC.z) * min(sx, 1.0);             // lid from the top ('top' shapes; parked)
}

// eye shading for one chroma tap, given its sphere coordinates (lon, lat) and visible-hemisphere Z
float gPupil;   // toon pupil coverage, written by the centre tap
vec3 eyeTap(vec3 col, float lon, float lat, float Z, float rimA){
  float side = lon < 0.0 ? -1.0 : 1.0;
  float u = lon - uShapeT.w * side;
  // happy: eyes lift a touch and bow into a soft ∩ (edges droop) — any shape, never flatter than round
  float v = lat - uEyeK2.z + uEyeK2.w * u * u;
  float d = eyeSDF(vec2(u, v), uEyeA.xy, side, vec3(0.0, 0.0, 1.0));      // radians
  float ds = d * RR * (0.5 * Z + 0.5);                        // ≈ screen units (foreshortened)
  float w  = uEyeK.x;
  float vis = uEyeP.z * smoothstep(0.02, 0.08, Z);            // lidFade · z>0.02 cull
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
  // toon pupil (face.js sdPupil): upright dark oval clipped by the white → lid/squint/blink cover it too.
  // Centre tap only (rimA ≥ 0 marks it): no RGB fringe on the pupil; applied after the three taps.
#ifdef TOON
  if (uToon.y > 0.0 && rimA >= 0.0) {
    float psx = 1.0 + side * uAsym.x;                           // pupils follow the 3/4 asymmetry
    vec2 pq = uPupilM * vec2(u / psx + side * uPupil.x - uPupil.y, v + side * uAsym.y - uPupil.z);   // dart stretch
    vec2 p0 = pq * uPupilA.zw, p1 = p0 * uPupilA.zw;
    float pk = length(p0);
    float dp = pk * (pk - 1.0) * inversesqrt(max(dot(p1, p1), 1e-8)) * min(psx, 1.0) * uPupil.w * RR * (0.5 * Z + 0.5);
    gPupil = uToon.y * vis * (1.0 - smoothstep(-w, w, max(dp, ds)));
  }
#endif
  float fill = 1.0 - smoothstep(-w, w, ds);
  return mix(col, ec, fill * vis);
}
// soft offset drop shadow (ambient occlusion on the pool): the eye SDF sampled a little lower, Gaussian
// falloff, multiplied toward the deep pool colour → a darker, bluer band hugging the eye's lower edges.
// Once per pixel (centre tap, before the fill), only inside the eye capsules; follows gaze, lid and fade.
vec3 eyeShadow(vec3 col, float lon, float lat, float Z){
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
  if (uToon.x > 0.0) { rimA = eyeRim(lon, lat, Z); col = mix(col, uToonCol, rimA); }
  gPupil = 0.0;
  float cg = eyeTap(col, lon, lat, Z, rimA).g;                 // centre tap (also the pupil)
  vec3 c = vec3(eyeTap(col, lon + dl.x, lat + dl.y, Z + dl.z, -rimA).r, cg,
                eyeTap(col, lon - dl.x, lat - dl.y, Z - dl.z, -rimA).b);   // −rimA: side taps skip the pupil
  return mix(c, uToonCol, gPupil);
#else
  return vec3(eyeTap(col, lon + dl.x, lat + dl.y, Z + dl.z, 0.0).r,
              eyeTap(col, lon, lat, Z, 0.0).g,
              eyeTap(col, lon - dl.x, lat - dl.y, Z - dl.z, 0.0).b);
#endif
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
