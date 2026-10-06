// Astrid glass — one fullscreen fragment pass, one draw call per frame. GLSL ES 1.00 (WebGL1/2).
// Units: AstridFace 240-space. Orb r118 at (120,120); view framing -50..290 (340 units across the stage).
// Layering (bottom → top):
//   base(p)    : paper · contact shadow · halo · frosted shell (evaluated once)
//   interior(p): inner-rim iridescence · drifting blob field (deep pool, core, bloom) · Fresnel ·
//                eyes (glow + glossy fill) — clipped to the orb and sampled 3× (R/G/B) at slightly
//                different radii → real refraction fringe, ~0 at the centre, growing ∝ r² to the rim.
//   room light: sheen · crisp thin-film iridescent rim · inner white line · glint (never refracted,
//               never moves with gaze).
// Port note (Metal): uniforms map 1:1 to a constant buffer; base()/interior() → plain functions; no textures.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec3  uView;    // centre x,y (drawing-buffer px, GL origin bottom-left), units per px
uniform vec3  uPaper, uCore, uDeep, uMid, uEdge, uHalo, uEye, uEyeHi, uEyeLo, uGlow, uShadow;
uniform vec2  uMode;    // x: inner line opacity, y: dark (0/1)
uniform vec4  uRot;     // eyes: cos yaw, sin yaw, cos pitch, sin pitch
uniform vec4  uEyeP;    // eyes: stadium half-width (rad), cap half-length (rad), lidFade, reject radius (units)
uniform vec4  uEyeC;    // eyes: projected screen centres (L.xy, R.xy) — cheap bounding reject only
uniform vec4  uCoreM;   // glass head-turn: offset xy (units, inverted to gaze), foreshorten scale xy
uniform mat2  uMA, uMB, uMC; // blob drift (core, pool, bloom): inverse of CSS rotate·scale (precomputed in JS)
uniform vec2  uTA, uTB, uTC; // blob drift: drift origin (120,144.8) + translate (units)
uniform float uNT;      // noise time (advanced by JS × drift speed)
uniform vec4  uTune1;   // refraction, rim thickness (×1.5u), rim intensity, frost softness
uniform vec4  uTune2;   // eye softness, glint, noise warp (units), -

const vec2  C  = vec2(120.0, 120.0);
const float R  = 118.0;   // orb
const float RR = 110.0;   // eye sphere (AstridFace projector)

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 rot2(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c*v.x - s*v.y, s*v.x + c*v.y); }
// "blurred linear ramp": 1 at d=0 → 0 at d=1, softened by k at both ends
float lin(float d, float k){ return 1.0 - smoothstep(-k, 1.0 + k, d); }

// inverse of CSS `translate(t) rotate(r) scale(s)` about the drift origin O (same as v6 .drift):
//   q_local = M⁻¹ (q − O − t) + O, with M⁻¹ and O+t precomputed per blob in JS (no trig per pixel)
const vec2 DO = vec2(120.0, 144.8);
vec2 undrift(vec2 q, mat2 m, vec2 ot){ return m * (q - ot) + DO; }

// iridescent thin-film ramp, cyclic: cyan → lavender → pink → peach → cyan
vec3 iri(float t){
  t = fract(t);
  vec3 c0 = vec3(0.561, 0.890, 1.000), c1 = vec3(0.769, 0.651, 1.000),
       c2 = vec3(1.000, 0.624, 0.878), c3 = vec3(1.000, 0.824, 0.651);
  if (t < 0.28) return mix(c0, c1, smoothstep(0.0, 0.28, t));
  if (t < 0.50) return mix(c1, c2, smoothstep(0.28, 0.50, t));
  if (t < 0.75) return mix(c2, c3, smoothstep(0.50, 0.75, t));
  return mix(c3, c0, smoothstep(0.75, 1.0, t));
}

// eyes: screen → sphere (r=RR) → undo yaw, pitch → lon/lat → analytic stadium (AstridFace.eyePath)
vec3 eyes(vec3 col, vec2 p){
  vec2 el = p - uEyeC.xy, er = p - uEyeC.zw;
  if (min(dot(el, el), dot(er, er)) > uEyeP.w * uEyeP.w) return col;   // far from both eyes
  vec2 s = (p - C) / RR; s.y = -s.y;
  float rr = dot(s, s);
  if (rr >= 1.0 || uEyeP.z <= 0.0) return col;
  float Z  = sqrt(1.0 - rr);
  float x  = s.x*uRot.x - Z*uRot.y;
  float z1 = s.x*uRot.y + Z*uRot.x;
  float y  = s.y*uRot.z + z1*uRot.w;
  float z  = -s.y*uRot.w + z1*uRot.z;
  float lon = atan(x, z), lat = asin(clamp(y, -1.0, 1.0));
  float u = lon - (lon < 0.0 ? -0.2 : 0.2), v = lat - 0.04;
  float hw = uEyeP.x, cap = uEyeP.y;
  float d  = length(vec2(u, v - clamp(v, -cap, cap))) - hw;   // radians
  float ds = d * RR * mix(Z, 1.0, 0.5);                       // ≈ screen units (foreshortened)
  float w  = 1.1 * uTune2.x + 0.3;
  float vis = uEyeP.z * smoothstep(0.02, 0.08, Z);            // lidFade · z>0.02 cull
  float glow = 0.36 * (1.0 - smoothstep(-1.0, 4.0 + 2.0*w, ds));
  col = mix(col, uGlow, glow * vis);
  // glossy fill: eyeHi → eye → eyeLo along (0.35, 1) in the stadium's own frame
  float uu = clamp(u / max(hw, 1e-4) * 0.5 + 0.5, 0.0, 1.0);
  float vv = clamp(0.5 - v / (2.0 * (cap + hw) + 1e-4), 0.0, 1.0);
  float t  = clamp((0.35*uu + vv) / 1.1225, 0.0, 1.0);
  vec3 ec  = t < 0.55 ? mix(uEyeHi, uEye, t / 0.55) : mix(uEye, uEyeLo, (t - 0.55) / 0.45);
  float fill = 1.0 - smoothstep(-w, w, ds);
  return mix(col, ec, fill * vis);
}

// outer layer (not refracted): paper · contact shadow · halo · frosted shell
vec3 base(vec2 p, float r){
  vec3 col = uPaper;
  // contact shadow: she sits on the page
  vec2 sd = (p - vec2(120.0, 252.0)) / vec2(88.0, 13.0);
  col = mix(col, uShadow, 0.16 * exp(-dot(sd, sd) * 2.6));
  // halo (trimmed)
  col = mix(col, uHalo, 0.75 * (1.0 - smoothstep(112.0, 146.0, r)));
  // frosted shell: radial mid → edge (static, centred low like v6 #body)
  float bt = length(p - vec2(120.0, 146.0)) / 128.0;
  vec3 m2 = mix(uMid, uEdge, 0.6);
  vec3 body = bt < 0.55 ? uMid : (bt < 0.76 ? mix(uMid, m2, (bt - 0.55) / 0.21)
                                            : mix(m2, uEdge, clamp((bt - 0.76) / 0.17, 0.0, 1.0)));
  float bw = 9.0 * uTune1.w + 0.5;
  return mix(col, body, 1.0 - smoothstep(R - bw, R + bw, r));
}

// inner-rim iridescence (sharp-ish band → refracted per channel)
vec3 rimIri(vec3 col, vec2 p){
  float r = length(p - C), rn = r / R;
  float ia = rn < 0.8 ? 0.0 : (rn < 0.9 ? 0.22 * (rn - 0.8) / 0.1 : mix(0.22, 0.2, clamp((rn - 0.9) / 0.1, 0.0, 1.0)));
  ia *= 1.3 * (1.0 - smoothstep(R - 0.8, R + 0.8, r));
  float diag = ((p.x - 20.0) + (p.y - 20.0)) / 400.0;
  vec3 pk = vec3(1.0, 0.624, 0.878), lv = vec3(0.769, 0.651, 1.0), cy = vec3(0.624, 0.902, 1.0);
  vec3 ir = rn < 0.95 ? mix(pk, lv, clamp((rn - 0.9) / 0.05, 0.0, 1.0)) : mix(lv, cy, clamp((rn - 0.95) / 0.05, 0.0, 1.0));
  vec3 ic = mix(ir, iri(diag + 0.1), 0.35);                   // v6 rimGlow ramp + a little position hue
  vec3 icMix = mix(col, ic, ia);                              // light paper: tint
  vec3 icScr = 1.0 - (1.0 - col) * (1.0 - ic * ia * 1.4);     // dark paper: screen (glow, not mud)
  return mix(icMix, icScr, uMode.y);
}

// blob field + Fresnel (soft, ≥8u features)
vec3 blobs(vec3 col, vec2 p, vec2 warp){
  float r = length(p - C), rn = min(r / R, 1.0);
  float clip = 1.0 - smoothstep(R - 0.8, R + 0.8, r);
  float k = uTune1.w * 0.035 + 0.005;
  // head-turn (inverted, foreshortened) → noise warp → per-blob random-target drift
  vec2 q = (p - C - uCoreM.xy) / uCoreM.zw + C + warp;
  vec2 qb = undrift(q, uMB, uTB);                            // deep pool (bottom)
  float aB = 0.6 * lin(length(qb - vec2(120.0, 214.0)) / 110.9, k * 2.0);
  col = mix(col, uDeep, aB * clip);
  vec2 qa = undrift(q, uMA, uTA);                            // main core
  float dA = length(qa - vec2(120.0, 146.0)) / 127.44;
  vec3 c1 = mix(uCore, uMid, 0.4);
  vec3 ca = dA < 0.3 ? mix(uCore, c1, dA / 0.3) : mix(c1, uMid, clamp((dA - 0.3) / 0.2, 0.0, 1.0));
  float aA = (dA < 0.3 ? 1.0 : (dA < 0.5 ? mix(1.0, 0.6, (dA - 0.3) / 0.2) : 0.6))
           * (1.0 - smoothstep(0.5 - k*2.0, 0.62 + k*2.0, dA));
  col = mix(col, ca, aA * clip);
  vec2 qc = undrift(q, uMC, uTC);                            // lighter bloom
  float aC = 0.75 * lin(length((qc - vec2(91.7, 120.0)) / vec2(70.8, 56.6)), k * 3.0);
  col = mix(col, mix(uCore, uMid, 0.6), aC * clip);
  // Fresnel edge brightening
  float fz = sqrt(max(0.0, 1.0 - rn*rn));
  float fz1 = 1.0 - fz, fres = fz1 * fz1 * fz1;
  return mix(col, mix(uEdge, vec3(1.0), mix(0.55, 0.1, uMode.y)), fres * mix(0.35, 0.5, uMode.y) * clip);
}

// interior, full order (rim iridescence · blobs · Fresnel · eyes) — used by CHROMA_FULL
vec3 interior(vec3 col, vec2 p, vec2 warp){ return eyes(blobs(rimIri(col, p), p, warp), p); }

void main(){
  vec2 f = gl_FragCoord.xy;
  vec2 p = C + vec2(f.x - uView.x, uView.y - f.y) * uView.z;
  vec2 d = p - C; float r = length(d);
  vec3 col;

  if (r < 150.0) {
    // noise warp computed once per pixel (shared by the 3 chroma taps)
    vec2 np = p * 0.018;
    vec2 warp = vec2(vnoise(np + vec2(uNT*0.11, uNT*0.05)) + 0.5*vnoise(np*2.1 + vec2(-uNT*0.07, uNT*0.09) + 3.7),
                     vnoise(np + vec2(7.1 - uNT*0.06, 2.3 + uNT*0.10)) + 0.5*vnoise(np*2.1 + vec2(uNT*0.08, -uNT*0.06) + 9.2)) - 0.75;
    warp *= uTune2.z;
    // chromatic refraction: R/G/B at different radii — 0 at centre, ∝ r² toward the rim
    float rn = min(r / R, 1.0);
    vec2 dir = r > 1e-3 ? d / r : vec2(0.0);
    vec2 off = (dir * (0.45 + 6.5*rn*rn) + vec2(0.55, -0.18)) * uTune1.x * mix(1.0, 0.6, uMode.y);
    vec3 b = base(p, r);
    vec3 ii;
#ifdef CHROMA_FULL
    // reference path: whole interior sampled 3× (≈2× the cost; visually identical — blobs are ≥8u soft)
    ii = vec3(interior(b, p - off, warp).r, interior(b, p, warp).g, interior(b, p + off, warp).b);
#else
    // fast path: the sharp layers (rim iridescence, eyes) are refracted per channel; the soft blob
    // field is shared. Order differs from v6 only in that blobs sit above the inner-rim band.
    vec3 rr = vec3(rimIri(b, p - off).r, rimIri(b, p).g, rimIri(b, p + off).b);
    vec3 sm = blobs(rr, p, warp);
    ii = vec3(eyes(sm, p - off).r, eyes(sm, p).g, eyes(sm, p + off).b);
#endif
    col = mix(b, ii, 1.0 - smoothstep(R - 0.8, R + 0.8, r));   // clip at the pixel, not the tap
  } else {
    col = base(p, r);
  }

  // ---- room light (fixed; not refracted, not moved by gaze) ----
  float px = uView.z;
  // sheen
  float sh = length((p - vec2(100.0, 54.0)) / vec2(56.0, 24.0));
  col = mix(col, vec3(1.0), 0.5 * (1.0 - smoothstep(0.0, 1.25, sh)));
  // crisp thin-film rim: hue from position (pink→lavender→cyan→peach) + film phase across the band
  float hwid = 0.75 * uTune1.y;
  float band = (r - 117.6) / max(hwid, 1e-3);
  float ring = clamp((hwid - abs(r - 117.6)) / px + 0.5, 0.0, 1.0);
  float diag = ((p.x - 20.0) + (p.y - 20.0)) / 400.0;
  float ang  = atan(d.y, d.x) / 6.2831853;
  vec3 film  = iri(diag + 0.04 * sin(ang * 6.2831853 * 2.0) + 0.06 * band);
  col = mix(col, film, ring * 0.9 * uTune1.z);
  // outer iridescent bloom right at the rim (soft, very faint)
  float ob = exp(-pow((r - 118.5) / (2.2 * uTune1.y), 2.0)) * (1.0 - ring);
  col = mix(col, film, ob * 0.18 * uTune1.z);
  // inner white line
  float il = clamp((0.4 - abs(r - 115.8)) / px + 0.5, 0.0, 1.0);
  col = mix(col, vec3(1.0), il * uMode.x);
  // glint (top-left) + small dot
  float gi = uTune2.y;
  float ge = length(rot2(p - vec2(74.0, 44.0), 0.6283185) / vec2(13.0, 5.5));
  col = mix(col, vec3(1.0), 0.92 * gi * (1.0 - smoothstep(0.78, 1.22, ge)));
  float gd = length(p - vec2(92.0, 33.0));
  col = mix(col, vec3(1.0), 0.8 * gi * (1.0 - smoothstep(1.1, 3.1, gd)));

  // dither (kills 8-bit banding in the soft gradients)
  col += (hash(f) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
