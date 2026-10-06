// Astrid glass — vertex stage. A coarse grid (24×24 cells over the canvas; one draw call) carries the
// work that is smooth across the orb: the canvas → units map, the petting squash/stretch (affine, so
// interpolation is exact) and the pool's noise warp (value noise with 30–60u features: linear
// interpolation over ~14u cells stays under ~1/255). Vertex stage = highp everywhere.
attribute vec2 aPos;          // clip-space grid vertex
uniform vec4  uVS;            // clip → units: p = uVS.xy + aPos·uVS.zw (y down)
uniform mat2  uBodyM;         // petting squash/stretch: inverse body transform about the orb centre
uniform float uNT;            // noise time (advanced by JS × drift speed, wrapped at 28900)
uniform float uWarp;          // noise warp amplitude (units)
varying vec2  vP;
varying vec2  vWarp;
const vec2 C = vec2(120.0, 120.0);
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// lattice wrapped to 289 cells → periodic, so JS can wrap uNT (28900 = 289 × 100) seamlessly
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  vec2 j = mod(i + 1.0, 289.0); i = mod(i, 289.0);
  return mix(mix(hash(i), hash(vec2(j.x, i.y)), f.x),
             mix(hash(vec2(i.x, j.y)), hash(j), f.x), f.y);
}
void main(){
  vec2 p = C + uBodyM * (uVS.xy + aPos * uVS.zw - C);
  vec2 np = p * 0.016;
  vec2 warp = vec2(vnoise(np + vec2(uNT*0.11, uNT*0.05)) + 0.5*vnoise(np*2.1 + vec2(-uNT*0.07, uNT*0.09) + 3.7),
                   vnoise(np + vec2(7.1 - uNT*0.06, 2.3 + uNT*0.10)) + 0.5*vnoise(np*2.1 + vec2(uNT*0.08, -uNT*0.06) + 9.2)) - 0.75;
  vP = p; vWarp = warp * uWarp;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
