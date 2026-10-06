// Astrid glass · "vibe" (v8): soft, airy, washed-out. One fullscreen fragment pass, one draw call.
// GLSL ES 1.00 (WebGL1/2). Units: AstridFace 240-space. Orb r118 at (120,120); stage framing -50..290.
// Look (matches Henlo's reference): a white frosted form that bleeds into the paper with a Gaussian edge
// (no outline, no glint), a pale luminous blue pool glowing up from the BOTTOM and fading to white haze
// at the top, a faint pink/cyan prism smear only along the soft lower boundary, and big bright white
// stadium "pebble" eyes with a slight RGB split and a faint inner shade.
// Layering (bottom → top):
//   frost(p)  : paper · white bloom into the page · frosted body (Gaussian edge)      [fixed]
//   pool(p)   : drifting blob field (pool, deep floor, bloom) moved by the delayed, inverted head turn,
//               noise warp and random-target drift; inset so a frosted white margin stays around it
//   haze      : white veil, heavier toward the top                                    [fixed]
//   fringe    : pink outside / cyan inside where the pool meets the frosted margin, strongest low
//   eyes      : soft blue-white glow + white pebble fill, sampled 3× (R/G/B) → gentle chromatic edge
//   petting   : body squash/stretch (whole frame), contact lens dent + soft brightening under the finger
// Port note (Metal): uniforms map 1:1 to a constant buffer; plain functions; no textures.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec3  uView;    // centre x,y (drawing-buffer px, GL origin bottom-left), units per px
uniform vec3  uPaper, uCore, uDeep, uMid, uEdge, uHalo, uEye, uEyeHi, uEyeLo, uGlow;
uniform vec2  uMode;    // x: unused (was inner line), y: dark (0/1)
uniform vec4  uRot;     // eyes: cos yaw, sin yaw, cos pitch, sin pitch
uniform vec4  uEyeP;    // eyes: stadium half-width (rad), cap half-length (rad), lidFade, reject radius (units)
uniform vec4  uEyeC;    // eyes: projected screen centres (L.xy, R.xy) — cheap bounding reject only
uniform vec4  uCoreM;   // glass head-turn: offset xy (units, inverted to gaze), foreshorten scale xy
uniform mat2  uMA, uMB, uMC; // blob drift (floor, pool, bloom): inverse of rotate·scale (precomputed in JS)
uniform vec2  uTA, uTB, uTC; // blob drift: drift origin (120,144.8) + translate (units)
uniform float uNT;      // noise time (advanced by JS × drift speed, wrapped at 28900)
uniform vec4  uTune1;   // eye RGB split, edge softness, haze, pool height
uniform vec4  uTune2;   // eye softness, fringe, noise warp (units), pool strength
uniform vec4  uTouch;   // petting contact: x, y (units), pressure 0..1 (sprung), dent strength
uniform mat2  uBodyM;   // petting squash/stretch: inverse body transform about the orb centre
uniform vec4  uFace;    // cos roll, sin roll, happy eye lift (rad of lat), happy arc (0..~.4)

const vec2  C  = vec2(120.0, 120.0);
const float R  = 118.0;   // orb
const float RR = 110.0;   // eye sphere (AstridFace projector)
const vec3  PINK = vec3(0.976, 0.620, 0.902);
const vec3  CYAN = vec3(0.560, 0.905, 1.000);

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// lattice wrapped to 289 cells → the noise is periodic, so JS can wrap uNT (period 28900 s, a common
// multiple of every rate below ×289) and the hash never sees huge arguments after hours on screen.
// Identical to the unwrapped noise for the first 289 lattice cells.
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  vec2 j = mod(i + 1.0, 289.0); i = mod(i, 289.0);              // wrap both corners → seamless
  return mix(mix(hash(i), hash(vec2(j.x, i.y)), f.x),
             mix(hash(vec2(i.x, j.y)), hash(j), f.x), f.y);
}
float gauss(float x, float w){ return exp(-(x*x) / (w*w)); }

const vec2 DO = vec2(120.0, 144.8);
vec2 undrift(vec2 q, mat2 m, vec2 ot){ return m * (q - ot) + DO; }

// dark paper wants light added (screen), light paper wants a tint (mix)
vec3 tint(vec3 col, vec3 c, float a){
  return mix(mix(col, c, a), 1.0 - (1.0 - col) * (1.0 - c * a * 0.8), uMode.y);
}

// eyes: screen → sphere (r=RR) → undo yaw, pitch → lon/lat → analytic stadium (AstridFace.eyePath)
vec3 eyes(vec3 col, vec2 p){
  vec2 el = p - uEyeC.xy, er = p - uEyeC.zw;
  if (min(dot(el, el), dot(er, er)) > uEyeP.w * uEyeP.w) return col;   // far from both eyes
  vec2 s0 = (p - C) / RR; s0.y = -s0.y;
  vec2 s = vec2(s0.x*uFace.x + s0.y*uFace.y, -s0.x*uFace.y + s0.y*uFace.x);   // undo roll
  float rr = dot(s, s);
  if (rr >= 1.0 || uEyeP.z <= 0.0) return col;
  float Z  = sqrt(1.0 - rr);
  float x  = s.x*uRot.x - Z*uRot.y;
  float z1 = s.x*uRot.y + Z*uRot.x;
  float y  = s.y*uRot.z + z1*uRot.w;
  float z  = -s.y*uRot.w + z1*uRot.z;
  float lon = atan(x, z), lat = asin(clamp(y, -1.0, 1.0));
  float hw = uEyeP.x, cap = uEyeP.y;
  float u = lon - (lon < 0.0 ? -0.2 : 0.2);
  // happy: eyes lift a touch and bow into a soft ∩ (edges droop) — same stadium, never flatter
  float v = lat - 0.04 - uFace.z + uFace.w * u * u / max(hw, 1e-4);
  float d  = length(vec2(u, v - clamp(v, -cap, cap))) - hw;   // radians
  float ds = d * RR * mix(Z, 1.0, 0.5);                       // ≈ screen units (foreshortened)
  float w  = 0.8 * uTune2.x + 0.4;
  float vis = uEyeP.z * smoothstep(0.02, 0.08, Z);            // lidFade · z>0.02 cull
  // soft luminous glow: the pebble lights the haze around it a little
  float glow = 0.26 * gauss(max(ds, 0.0), 4.0 + 3.0*w);
  col = tint(col, uGlow, glow * vis);
  // pool-coloured aura hugging the outline: keeps the pebbles reading when a glance carries them
  // out over the white haze (on the blue pool it is nearly invisible)
  col = mix(col, mix(uCore, uMid, 0.3), 0.42 * gauss(max(ds, 0.0) - 1.5, 3.5 + 2.5*w) * vis * (1.0 - uMode.y*0.4));
  // pebble fill: bright top-right → white → faint shade lower-left, plus a soft inner edge shade
  float uu = clamp(u / max(hw, 1e-4) * 0.5 + 0.5, 0.0, 1.0);
  float vv = clamp(0.5 - v / (2.0 * (cap + hw) + 1e-4), 0.0, 1.0);
  float t  = clamp((0.45*(1.0 - uu) + vv) / 1.2, 0.0, 1.0);
  vec3 ec  = t < 0.5 ? mix(uEyeHi, uEye, t / 0.5) : mix(uEye, uEyeLo, 0.55 * smoothstep(0.55, 1.0, t));
  float rimShade = smoothstep(-hw * RR * 0.7, 0.0, ds) * smoothstep(0.3, 0.9, t);
  ec = mix(ec, uEyeLo, 0.4 * rimShade);
  float fill = 1.0 - smoothstep(-w, w, ds);
  return mix(col, ec, fill * vis);
}

void main(){
  vec2 f = gl_FragCoord.xy;
  vec2 p = C + vec2(f.x - uView.x, uView.y - f.y) * uView.z;
  p = C + uBodyM * (p - C);                    // petting squash/stretch (identity at rest)
  vec2 d = p - C; float r = length(d * 0.01) * 100.0;   // scaled: no fp16 overflow far off-orb (mediump)
  float es = uTune1.y;
  float low = (p.y - C.y) / R;                 // −1 top … +1 bottom

  // ---- frost: paper · white bloom · frosted body (all fixed; Gaussian edge, no outline) ----
  vec3 col = uPaper;
  float out_ = max(r - R + 4.0, 0.0);
  col = mix(col, uHalo, 0.38 * gauss(out_, 10.0 * es + 3.0));
  float body = 1.0 - smoothstep(R - 6.0*es - 1.0, R + 5.0*es + 1.0, r);
  col = mix(col, uEdge, body);

  if (r < R + 12.0) {
    // ---- pool: head-turn (inverted, delayed) → noise warp → random-target drift ----
    // ---- petting contact: a shallow dent under the finger (concave lens → slight minify) ----
    vec2 pt = p - uTouch.xy;
    float tg = gauss(length(pt), 34.0) * uTouch.z;
    vec2 pl = p + pt * (0.22 * uTouch.w * tg);
    vec2 np = pl * 0.016;
    vec2 warp = vec2(vnoise(np + vec2(uNT*0.11, uNT*0.05)) + 0.5*vnoise(np*2.1 + vec2(-uNT*0.07, uNT*0.09) + 3.7),
                     vnoise(np + vec2(7.1 - uNT*0.06, 2.3 + uNT*0.10)) + 0.5*vnoise(np*2.1 + vec2(uNT*0.08, -uNT*0.06) + 9.2)) - 0.75;
    warp *= uTune2.z;
    vec2 q = (pl - C - uCoreM.xy) / uCoreM.zw + C + warp;
    float ph = uTune1.w;
    // main pool: a broad dome rising from below the orb
    vec2 qb = undrift(q, uMB, uTB);
    float dP = length((qb - vec2(120.0, 222.0)) / vec2(136.0, 196.0 * ph));
    float aP = 1.0 - smoothstep(0.48, 0.98, dP);
    vec3  cP = mix(uMid, uCore, smoothstep(0.95, 0.55, dP));
    // deeper floor (bottom, slightly off-centre)
    vec2 qa = undrift(q, uMA, uTA);
    float dA = length((qa - vec2(108.0, 186.0)) / vec2(82.0, 56.0 * mix(1.0, ph, 0.5)));
    float aA = 0.55 * (1.0 - smoothstep(0.1, 1.0, dA));
    // pale bloom that morphs through the upper pool
    vec2 qc = undrift(q, uMC, uTC);
    float dC = length((qc - vec2(140.0, 128.0)) / vec2(70.0, 52.0));
    float aC = 0.45 * (1.0 - smoothstep(0.0, 1.0, dC));
    // frosted margin: the pool never reaches the rim (sides wide, bottom thinner)
    float inset = mix(30.0, 14.0, smoothstep(0.2, 0.95, low)) * es + 4.0;
    float m = 1.0 - smoothstep(R - inset - 10.0*es, R - inset + 6.0*es + 2.0, r);
    float pa = clamp(aP * uTune2.w, 0.0, 1.0);
    vec3 pool = mix(uEdge, cP, pa);
    pool = mix(pool, uDeep, aA * aP * uTune2.w);
    pool = mix(pool, mix(uMid, uEdge, 0.35), aC * aP);
    // backlit floor: just above the bottom margin the pool goes lighter + cyan (luminous, not muddy)
    float lift = smoothstep(0.55, 0.95, low) * m;
    pool = mix(pool, mix(uMid, CYAN, 0.45), 0.55 * lift * pa * (1.0 - uMode.y*0.5));
    col = mix(col, pool, m * body);

    // ---- haze: white veil, heavier toward the top (fixed) ----
    float hz = uTune1.z * (0.06 + 0.70 * smoothstep(-0.38, -0.98, low));
    col = mix(col, uEdge, clamp(hz, 0.0, 1.0) * body);

    // ---- fringe: blurred prism smear where the blue meets the frosted margin, strongest low ----
    float fr = uTune2.y * smoothstep(-0.35, 0.85, low) * (0.25 + 0.75 * clamp(pa * 1.6, 0.0, 1.0));
    float rb = R - inset;                                       // pool boundary radius
    float fw = 5.0 * es + 2.5;
    col = tint(col, PINK, 0.44 * fr * gauss(r - (rb + 2.0), fw));
    col = tint(col, CYAN, 0.30 * fr * gauss(r - (rb - 7.0), fw));
    // faint outer smear on the paper just below the form's soft bottom edge
    col = tint(col, PINK, 0.07 * uTune2.y * smoothstep(0.5, 1.0, low) * gauss(r - (R + 2.0), 4.0 + 3.0*es));

    // ---- eyes: 3 taps (R/G/B) at slightly different positions → gentle chromatic edge ----
    vec2 dir = r > 1e-3 ? d / r : vec2(0.0);
    vec2 off = (dir * (0.8 + 2.2 * min(r / R, 1.0)) + vec2(1.5, 0.0)) * uTune1.x * mix(1.0, 0.7, uMode.y);
    col = vec3(eyes(col, pl + off).r, eyes(col, pl).g, eyes(col, pl - off).b);
    // contact light: the glass brightens softly where it's touched; dent walls shade (light top-left)
    col = tint(col, mix(uHalo, uGlow, uMode.y), 0.34 * tg * body);
    col += vec3(0.05 * uTouch.w * tg * body * dot(pt / 34.0, vec2(0.7, 0.7)));
  }

  col += (hash(mod(f, 64.0)) - 0.5) / 255.0;   // dither (kills 8-bit banding); mod keeps mediump finite
  gl_FragColor = vec4(col, 1.0);
}
