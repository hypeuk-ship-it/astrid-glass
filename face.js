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
     lean inward; < 0 leans outward), bend (×hw, bean bow). Placement: lon, lat = rest eye centre on the
     sphere (gaze still adds the head turn). Lid: amin = flattest allowed aspect (1 = may round off to a
     circle; ≥ h/w = keep its own aspect, as 'ref' does), sq = how much a squint/blink shrinks it instead of squashing.
     slant/cutc/cutk = a soft slanted top cut at height cutc·hh (0 = none), tilted by slant (rad; mirrored, + = high
     outside), corner cutk·hw; asw/ahy/atilt = 3/4-view asymmetry at full strength (scaled by v[4], see eyeShapeV).
     top = 1: blink/lid come down from the top like a real lid (corner rounding ck×hw) and a happy squint shrinks
     the eye toward its bottom, so it never gets flatter than its own aspect except under the lid.
     A morph lerps all of these, so the shader runs ONE SDF per tap and the eyes glide to the new spot. */
  const SHAPES=Object.freeze([
    Object.freeze({name:'stadium', w:.23, h:.52, ex:1,    r:1,   e:0, taper:0,   tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0}),   // default pill
    Object.freeze({name:'egg',     w:.24, h:.33, ex:1.2,  r:1,   e:1, taper:.17, tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0}),   // pebble, wider at the bottom
    Object.freeze({name:'dot',     w:.24, h:.24, ex:1,    r:1,   e:0, taper:0,   tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0}),   // plain circle
    Object.freeze({name:'oval',    w:.22, h:.42, ex:1,    r:1,   e:1, taper:0,   tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0}),   // smooth tall ellipse
    Object.freeze({name:'bean',    w:.2,  h:.4,  ex:1.45, r:1,   e:1, taper:0,   tilt:.244, bend:.35, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0}), // leaning kidney bean
    Object.freeze({name:'squircle',w:.225,h:.245,ex:1.3,  r:.55, e:0, taper:0,   tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0}), // soft rounded square
    // Reference (Henlo's image): a full, closed, plump EGG, narrow rounded end UP, fullest low (~60% down the egg, ~2/3 down the part the image shows),
    // soft and round all round, gentle outward lean (a symmetric average of the two eyes in the image, whose flat
    // bottoms are only the dome edge cropping them), large, close (gap ≈ half an eye width), centred on the orb.
    Object.freeze({name:'ref',     w:.44, h:.5, ex:1.25, r:1,   e:1, taper:.22, tilt:-.3, bend:0, lon:.44, lat:0, amin:99, sq:.22, top:1, ck:.3, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0}),
    // Toon (the drawing tutorial's final frame): big rounded eyes with a full round bottom and a soft, slanted,
    // flatter top cut (high at the outer side, low inside; mirrored), the toon rim crescent hugs it. The tutorial
    // is a 3/4 view: asymmetry (slider, 1 = the tutorial) makes the left eye narrower and higher and tilts both
    // tops the same way. asw = width difference, ahy = height offset (eye heights), atilt = shared top tilt (rad).
    Object.freeze({name:'toon',    w:.5, h:.65, ex:1.3, r:1, e:.9, taper:.15, tilt:0, bend:0, lon:.38, lat:.03, amin:99, sq:.22, top:1, ck:.3, slant:.18, cutc:.88, cutk:.35, asw:.17, ahy:.17, atilt:.16})]);
  const LID0=REST.w/REST.h;               // lid at which the stadium reaches a circle (fade starts below it)
  /* Box for any shape. Lid/blink close it vertically: hh goes from the natural height to round (hh = hw)
     as lid goes 1 → LID0, then the eye fades (lidFade). For the stadium this is EXACTLY stadiumOf + lidFade
     (h·lid is linear and hits w at LID0). Shapes with little height to give (dot, squircle) shrink up to
     15% instead of squashing, so a happy squint still reads and nothing gets flatter than round.
     'ref' (top = 1) never flattens: a real lid comes down from the top and a squint shrinks it (branch below).
     Writes o.hw, o.hh, o.cap (= hh − hw, the stadium cap), o.fade, o.ex. */
  /* v = [size, lid, shapeIndex, happy]. Also writes the lid frame used by the shader (radians, eye-local):
     o.oy = egg-centre offset (a 'top' shape's squint shrinks toward its bottom, so the centre drops), o.vtop =
     lid line relative to the egg centre (parked 1.5·hh above for the others = no effect), o.ck lid corner. */
  /* slanted top cut + 3/4 asymmetry (radians, eye-local): o.asx = ±width scale per side (right 1+asx, left 1−asx),
     o.asy = ±height offset (left up, right down), o.cut = cut line height (parked 9·hh = none), o.cutk = corner,
     (o.nLx, o.nLy) / (o.nRx, o.nRy) = the cut line's normal for the left / right eye. A = v[4] (1 = the tutorial). */
  function cutFrame(o,S,A){
    const a=clamp(A||0,0,1.5); o.asx=S.asw/2*a; o.asy=S.ahy*o.hh*a;
    const pR=S.slant+S.atilt*a, pL=-S.slant+S.atilt*a;             // top line angle per eye (+ = rising to the right)
    o.nLx=-Math.sin(pL); o.nLy=Math.cos(pL); o.nRx=-Math.sin(pR); o.nRy=Math.cos(pR);
    o.cut=S.cutc?S.cutc*o.hh:9*o.hh; o.cutk=S.cutc?Math.max(1e-3,S.cutk*o.hw):1e-3;
    return o;
  }
  function eyeShapeV(o,v){
    const S=SHAPES[v[2]|0]||SHAPES[0], s=Math.max(0,v[0]), l=Math.max(0,v[1]);
    if(S.top){                                                         // real-lid shapes ('ref')
      const hp=clamp(v[3]||0,0,1), sc=1-S.sq*hp;                      // happy squint: shrink toward the bottom
      const hwN=S.w*s/2, hhN=S.h*s/2;
      o.hw=hwN*sc; o.hh=hhN*sc; o.cap=Math.max(0,o.hh-o.hw); o.ex=S.ex;
      o.oy=-hhN*(1-sc);                                                // the bottom stays where it was
      const lb=clamp(l/Math.max(.2,1-.5*hp),0,1);                      // the lid with the squint factored out
      o.vtop=o.hh*(2.25*lb-1);                                         // lid line: 1.25·hh above (open) → bottom
      o.ck=Math.max(1e-3,S.ck*o.hw); o.fade=s<=0?0:clamp(lb*5,0,1);
      return cutFrame(o,S,v[4]);
    }
    let w=S.w*s; const h=S.h*s; if(h<w) w=h;
    const k=Math.min(1,Math.max(0,(l-LID0)/(1-LID0)));                 // 1 open … 0 flattest allowed
    const am=Math.min(h/Math.max(w,1e-9),S.amin), hmin=w*am;             // never flatter than amin
    const room=Math.min(1,Math.max(0,1-(S.h/S.w-am)/(REST.h/REST.w-1)));  // 0 stadium … 1 no height to give
    const shrink=1-S.sq*(1-k)*room;
    o.hw=w/2*shrink; o.hh=(hmin+(h-hmin)*k)/2*shrink; o.cap=Math.max(0,o.hh-o.hw);
    o.fade=w<=0?0:(l>=LID0?1:Math.max(0,l/LID0)); o.ex=S.ex;
    o.oy=0; o.vtop=1.5*o.hh; o.ck=1e-3;                               // no lid line (parked well above)
    return cutFrame(o,S,v[4]);
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
  // smooth max (polynomial): rounds the corner where the lid meets the shape by ~k
  function smax(a,b,k){ const h=Math.max(k-Math.abs(a-b),0)/k; return Math.max(a,b)+h*h*k*.25; }
  /* 6 ref (Henlo's reference): a closed plump EGG, narrow end up (taper → fullest low down), mostly ellipse,
     leaned outward per side; a blink/lid comes down from the top (smooth-max'd lid line). C = the eyeShapeV box
     {oy, vtop, ck} (omit it for the open rest shape). Same as eyeSDFP(…, SHAPES.ref, C). */
  function sdRef(u,v,hw,hh,side,C){
    const P=SHAPES[6]; C=C||{oy:0,vtop:1.5*hh,ck:P.ck*hw};
    v-=C.oy;
    const c=Math.cos(P.tilt), s=Math.sin(P.tilt);
    const x0=c*u+side*s*v, y=-side*s*u+c*v, yn=clamp(y/hh,-1,1), g=1-P.taper*yn, x=x0/g;
    const cap=Math.max(0,hh-hw), dS=len(x,y-clamp(y,-cap,cap))-hw;   // stadium (rounded box, r = hw)
    const egg=(dS+(sdEllipse(x,y,hw,hh)-dS)*P.e)*g;                   // narrow-end-up egg
    return smax(egg,v-C.vtop,C.ck);                                    // lid from the top
  }
  /* 7 toon (the drawing tutorial's final frame): a rounded ellipse (mostly ellipse) with a soft slanted top cut,
     high at the outer side and low inside, mirrored per side; plus the 3/4 asymmetry and the lid from C.
     C = the eyeShapeV box (needed: it carries the cut, the asymmetry and the lid); same as eyeSDFP(…, SHAPES.toon, C). */
  function sdToon(u,v,hw,hh,side,C){ return eyeSDFP(u,v,hw,hh,side,SHAPES[7],C); }
  function sdSquircle(u,v,hw,hh){ const r=.55*hw, qx=Math.abs(u)-hw+r, qy=Math.abs(v)-hh+r;
    return len(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r; }
  const SDF=[sdStadium,sdEgg,sdDot,sdOval,sdBean,sdSquircle,sdRef,sdToon];
  function eyeSDF(id,u,v,hw,hh,side,C){ return (SDF[id|0]||sdStadium)(u,v,hw,hh,side,C); }
  /* The one the shader runs: every shape above is this function at its SHAPES params (checked in tests):
     lean + bow (bean) → taper (egg) → mix(rounded box with corner r·hw, ellipse, e). */
  function eyeSDFP(u,v,hw,hh,side,P,C){
    const A=C&&C.cut!==undefined, sx=A?1+side*C.asx:1;
    if(A){ v+=side*C.asy; u/=sx; }                                     // 3/4 asymmetry: per-eye width + height
    if(C) v-=C.oy;
    const c=Math.cos(P.tilt), s=Math.sin(P.tilt);
    let x=c*u+side*s*v; const y=-side*s*u+c*v, yn=clamp(y/hh,-1,1);
    x-=side*P.bend*hw*(1-yn*yn);
    const g=1-P.taper*yn; x/=g;
    const r=P.r*hw, qx=Math.abs(x)-hw+r, qy=Math.abs(y)-hh+r;
    const dR=len(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;
    const d=(dR+(sdEllipse(x,y,hw,hh)-dR)*P.e)*g;
    if(!C) return d;
    const e=A?smax(d,(side<0?C.nLx:C.nRx)*u+(side<0?C.nLy:C.nRy)*v-C.cut,C.cutk):d;   // soft slanted top cut
    return smax(e,v-C.vtop,C.ck)*Math.min(sx,1);
  }
  /* ---- toon layer (the drawing tutorial's eyes), for every shape ----
     Rim: the white's SDF shifted up + outward and grown a touch, drawn BEHIND the white → only a crescent shows,
     thick at the top-outer edge, tapering to nothing toward the bottom and the inner side (|offset| > grow).
     Pupil: an upright dark oval ~43% of the eye's width × 63% of its height (open size, so a blink/squint
     covers it instead of squashing it), resting a little inward and down, shifted toward the gaze, clipped by
     the white. All radians, eye-local (u, v as eyeSDFP; side = −1 left, +1 right; inward = −side·u).
     toonV(o, box, open, gx, gy, k) → o.ox, o.oy, o.grow (rim), o.a, o.b, o.pin, o.pu, o.pv (pupil).
       box = current {hw, hh, oy}; open = the same shape at lid 1 {hw, hh}; gx, gy = pupil gaze in −1…1
       (+x right, +y down, from the pupil spring); k = {rim, pupil, follow} slider factors (1 = default). */
  const TOON={rimOut:.15, rimUp:.24, rimGrow:.05, pa:.43, pb:.63, pin:.17, pdown:.14, fu:.5, fv:.45};
  function toonV(o,box,open,gx,gy,k){
    const r=k.rim*box.hw; o.ox=TOON.rimOut*r; o.oy=TOON.rimUp*r; o.grow=TOON.rimGrow*r;
    const hw0=Math.max(open.hw,1e-4), hh0=Math.max(open.hh,1e-4), sq=box.hh/hh0;   // sq: squash of a blink
    o.a=TOON.pa*hw0*k.pupil; o.b=TOON.pb*hh0*k.pupil;
    o.pin=TOON.pin*hw0;
    o.pu=clamp(gx,-1,1)*k.follow*TOON.fu*Math.max(0,hw0-o.a);
    o.pv=(box.oy||0)+(-TOON.pdown*hh0-clamp(gy,-1,1)*k.follow*TOON.fv*Math.max(0,hh0-o.b))*Math.min(1,sq);
    return o;
  }
  // rim SDF (< 0 inside the dark shape; the visible crescent is where this is < 0 and the white's SDF is > 0)
  function sdToonRim(u,v,hw,hh,side,P,C,T){ return eyeSDFP(u-side*T.ox,v-T.oy,hw,hh,side,P,C)-T.grow; }
  // pupil SDF, already clipped by the white (dWhite = the white's SDF at the same point)
  function sdPupil(u,v,side,T,dWhite,C){
    const sx=C&&C.asx!==undefined?1+side*C.asx:1; if(sx!==1||C&&C.asy) { v+=side*C.asy; u/=sx; }
    return Math.max(sdEllipse(u+side*T.pin-T.pu,v-T.pv,T.a,T.b)*Math.min(sx,1),dWhite);
  }
  window.AstridFace=Object.freeze({SHAPES,eyeShapeV,eyeSDF,eyeSDFP,TOON,toonV,sdToonRim,sdPupil,sdStadium,sdEgg,sdDot,sdOval,sdBean,sdSquircle,sdRef,sdToon,CX,CY,RR,REST,projector,projectInto,projectV,stadiumOf,lidFade,eyePts,eyeUniforms,eyeInto,eyeV});
})();
