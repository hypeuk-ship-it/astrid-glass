/* Exact port of AstridFace (Swift): projector(yaw,pitch,roll), stadiumOf, lidFade, eyePath.
   CX=120 CY=120 RR=110, rest eyes lon ±0.2 lat 0.04, stadium w 0.23 h 0.52 (never flatter than a circle).
   eyePts() is the literal 20-seg polygon port (z>0.02 cull) — kept for parity/debug overlay.
   eyeUniforms() hands the same stadium to the shader, which inverts the projector per pixel
   (screen → sphere → un-rotate → lon/lat) and evaluates the stadium analytically there.
   Exposes window.AstridFace. */
(function(){
  const CX=120, CY=120, RR=110, REST=Object.freeze({lon:.2, lat:.04, w:.23, h:.52});
  /* projectV: the projector maths with precomputed trig, inputs in a Float64Array
     v=[cy,sy,cp,sp,cr,sr,lon,lat], writing into `o`. Per-frame use: only object pointers cross the call,
     so an unoptimised/mid-tier JIT has no doubles to box → zero allocation. */
  function projectV(o,v){
    const cy=v[0],sy=v[1],cp=v[2],sp=v[3],cr=v[4],sr=v[5],lon=v[6],lat=v[7];
    let x=Math.cos(lat)*Math.sin(lon), y=Math.sin(lat), z=Math.cos(lat)*Math.cos(lon);
    const y1=y*cp-z*sp; z=y*sp+z*cp; y=y1;
    const x2=x*cy+z*sy; z=-x*sy+z*cy; x=x2;
    o.x=CX+RR*(x*cr-y*sr); o.y=CY-RR*(x*sr+y*cr); o.z=z; return o;
  }
  const PV=new Float64Array(8);
  function projectInto(o,cy,sy,cp,sp,cr,sr,lon,lat){
    PV[0]=cy;PV[1]=sy;PV[2]=cp;PV[3]=sp;PV[4]=cr;PV[5]=sr;PV[6]=lon;PV[7]=lat; return projectV(o,PV);
  }
  function projector(yaw,pitch,roll){
    const cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw),cr=Math.cos(roll),sr=Math.sin(roll);
    return (lon,lat)=>projectInto({x:0,y:0,z:0},cy,sy,cp,sp,cr,sr,lon,lat);
  }
  function stadiumOf(e){ const s=Math.max(0,e.s); let w=REST.w*s; const h=REST.h*s; if(h<w) w=h; return [w,h]; }
  function lidFade(e){ const [w,h]=stadiumOf(e); if(w<=0) return 0; return e.lid*h<w ? Math.max(0,e.lid*h/w) : 1; }
  function eyePts(e,xf){
    const n=20,[w,h]=stadiumOf(e),vis=Math.max(w,h*e.lid),hw=w/2,hh=vis/2,r=hw,cap=Math.max(0,hh-r),c=Math.cos(e.rot),sn=Math.sin(e.rot),pts=[];
    const add=(u,v)=>{const u2=u*c-v*sn,v2=u*sn+v*c,p=xf(e.lon+u2,e.lat+v2); if(p.z>.02) pts.push(p);};
    for(let i=0;i<=n;i++){const a=Math.PI-(i/n)*Math.PI; add(hw*Math.cos(a),cap+r*Math.sin(a));}
    for(let i=0;i<=n;i++){const a=-(i/n)*Math.PI; add(hw*Math.cos(a),-cap+r*Math.sin(a));}
    return pts;
  }
  /* shader hand-off: same numbers eyePts() uses (hw, cap) + lidFade, both eyes share size/lid */
  function eyeUniforms(size,lid){ return eyeInto({hw:0,cap:0,fade:0},size,lid); }
  /* eyeInto: same numbers as stadiumOf + lidFade + eyePts (hw, cap), written into `o` (no allocation) */
  const EV=new Float64Array(2);
  function eyeInto(o,size,lid){ EV[0]=size; EV[1]=lid; return eyeV(o,EV); }
  /* eyeV: same, inputs v=[size,lid] (Float64Array) — the allocation-free per-frame form */
  function eyeV(o,v){
    const s=Math.max(0,v[0]), l=Math.max(0,v[1]);
    let w=REST.w*s; const h=REST.h*s; if(h<w) w=h;              // stadiumOf: never flatter than a circle
    const vis=Math.max(w,h*l), hw=w/2;
    o.hw=hw; o.cap=Math.max(0,vis/2-hw);
    o.fade=w<=0?0:(l*h<w?Math.max(0,l*h/w):1);                   // lidFade
    return o;
  }
  /* ---------------- eye shapes (port 1:1 to AstridFace.swift) ----------------
     Every shape lives in the same eye-local sphere coords as the stadium: u = lon − (±0.2) (radians,
     + = screen right), v = lat − lat0 (+ = up). The shape is drawn from a box (hw, hh) = half width,
     half visible height, computed by eyeShapeV() from the shape's natural (w, h) × size and the lid.
     The SDFs return radians (< 0 inside); the shader runs the same maths per pixel.
     side = −1 for the screen-left eye, +1 for the right (bean mirrors).                                 */
  /* natural w, h (radians at size 1; eyes sit ±0.2 apart, so w ≤ ~.25) · ex = bounding half-width ×hw ·
     unified-SDF params (see eyeSDFP): r corner radius ×hw, e ellipse weight, taper (egg), tilt (rad, bean
     lean inward), bend (×hw, bean bow). A morph lerps these params, so the shader runs ONE SDF per tap. */
  const SHAPES=Object.freeze([
    Object.freeze({name:'stadium', w:.23, h:.52, ex:1,    r:1,   e:0, taper:0,   tilt:0,    bend:0}),   // default pill
    Object.freeze({name:'egg',     w:.24, h:.33, ex:1.2,  r:1,   e:1, taper:.17, tilt:0,    bend:0}),   // pebble, wider at the bottom
    Object.freeze({name:'dot',     w:.24, h:.24, ex:1,    r:1,   e:0, taper:0,   tilt:0,    bend:0}),   // plain circle
    Object.freeze({name:'oval',    w:.22, h:.42, ex:1,    r:1,   e:1, taper:0,   tilt:0,    bend:0}),   // smooth tall ellipse
    Object.freeze({name:'bean',    w:.2,  h:.4,  ex:1.45, r:1,   e:1, taper:0,   tilt:.244, bend:.35}), // leaning kidney bean
    Object.freeze({name:'squircle',w:.225,h:.245,ex:1.3,  r:.55, e:0, taper:0,   tilt:0,    bend:0})]); // soft rounded square
  const LID0=REST.w/REST.h;               // lid at which the stadium reaches a circle (fade starts below it)
  /* Box for any shape. Lid/blink close it vertically: hh goes from the natural height to round (hh = hw)
     as lid goes 1 → LID0, then the eye fades (lidFade). For the stadium this is EXACTLY stadiumOf + lidFade
     (h·lid is linear and hits w at LID0). Shapes with little height to give (dot, squircle) shrink up to
     15% instead of squashing, so a happy squint still reads and nothing gets flatter than round.
     v = [size, lid, shapeIndex]; writes o.hw, o.hh, o.cap (= hh − hw, the stadium cap), o.fade, o.ex. */
  function eyeShapeV(o,v){
    const S=SHAPES[v[2]|0]||SHAPES[0], s=Math.max(0,v[0]), l=Math.max(0,v[1]);
    let w=S.w*s; const h=S.h*s; if(h<w) w=h;
    const k=Math.min(1,Math.max(0,(l-LID0)/(1-LID0)));                 // 1 open … 0 round
    const room=Math.min(1,Math.max(0,1-(S.h/S.w-1)/(REST.h/REST.w-1)));  // 0 stadium … 1 dot
    const shrink=1-.15*(1-k)*room;
    o.hw=w/2*shrink; o.hh=(w+(h-w)*k)/2*shrink; o.cap=Math.max(0,o.hh-o.hw);
    o.fade=w<=0?0:(l>=LID0?1:Math.max(0,l/LID0)); o.ex=S.ex;
    return o;
  }
  const len=(x,y)=>Math.sqrt(x*x+y*y), clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
  // ellipse, semi-axes a, b (iq's gradient-normalised approximation: exact on the boundary)
  function sdEllipse(u,v,a,b){ const k0=len(u/a,v/b), k1=len(u/(a*a),v/(b*b)); return k1>1e-9?k0*(k0-1)/k1:-Math.min(a,b); }
  // 0 stadium: segment of half-length cap, radius hw
  function sdStadium(u,v,hw,hh){ const cap=Math.max(0,hh-hw); return len(u,v-clamp(v,-cap,cap))-hw; }
  // 1 egg: an ellipse whose width grows toward the bottom (×1.17 at the base, ×0.83 at the top)
  function sdEgg(u,v,hw,hh){ const g=1-.17*clamp(v/hh,-1,1); return sdEllipse(u/g,v,hw,hh)*g; }
  // 2 dot: circle of radius hw (the box is round for the dot)
  function sdDot(u,v,hw,hh){ return len(u,v)-hw; }
  // 3 oval: plain ellipse filling the box
  function sdOval(u,v,hw,hh){ return sdEllipse(u,v,hw,hh); }
  // 4 bean: tops lean 14° toward the centre, middle bowed outward by 0.35·hw (concave side inward)
  const BEAN_C=Math.cos(.244), BEAN_S=Math.sin(.244);
  function sdBean(u,v,hw,hh,side){
    const x=BEAN_C*u+side*BEAN_S*v, y=-side*BEAN_S*u+BEAN_C*v, yn=clamp(y/hh,-1,1);
    return sdEllipse(x-side*.35*hw*(1-yn*yn),y,hw,hh);
  }
  // 5 squircle: rounded box, corner radius 0.55·hw
  function sdSquircle(u,v,hw,hh){ const r=.55*hw, qx=Math.abs(u)-hw+r, qy=Math.abs(v)-hh+r;
    return len(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r; }
  const SDF=[sdStadium,sdEgg,sdDot,sdOval,sdBean,sdSquircle];
  function eyeSDF(id,u,v,hw,hh,side){ return (SDF[id|0]||sdStadium)(u,v,hw,hh,side); }
  /* The one the shader runs: every shape above is this function at its SHAPES params (checked in tests):
     lean + bow (bean) → taper (egg) → mix(rounded box with corner r·hw, ellipse, e). */
  function eyeSDFP(u,v,hw,hh,side,P){
    const c=Math.cos(P.tilt), s=Math.sin(P.tilt);
    let x=c*u+side*s*v; const y=-side*s*u+c*v, yn=clamp(y/hh,-1,1);
    x-=side*P.bend*hw*(1-yn*yn);
    const g=1-P.taper*yn; x/=g;
    const r=P.r*hw, qx=Math.abs(x)-hw+r, qy=Math.abs(y)-hh+r;
    const dR=len(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;
    return (dR+(sdEllipse(x,y,hw,hh)-dR)*P.e)*g;
  }
  window.AstridFace=Object.freeze({SHAPES,eyeShapeV,eyeSDF,eyeSDFP,sdStadium,sdEgg,sdDot,sdOval,sdBean,sdSquircle,CX,CY,RR,REST,projector,projectInto,projectV,stadiumOf,lidFade,eyePts,eyeUniforms,eyeInto,eyeV});
})();
