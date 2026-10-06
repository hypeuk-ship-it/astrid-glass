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
     lki/lkm/lko = the fixed lattice warp ('toon'): bottom-row squash of the lower half per column (inner, mid,
     outer; 1 = none). Toon layer: ro/ru/rg = rim as the white shifted out/up + grown (×hw); rs/rpo/rpu = rim as the
     white scaled ×rs and moved out ×hw / up ×hh AFTER the shared warp (the tutorial's step 4); pa/pb = pupil
     semi-axes (×open hw/hh), pin = inward rest (×hw), pdown = rest drop (×hh).
     A morph lerps all of these, so the shader runs ONE SDF per tap and the eyes glide to the new spot. */
  const SHAPES=Object.freeze([
    Object.freeze({name:'stadium', w:.23, h:.52, ex:1,    r:1,   e:0, taper:0,   tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0, lki:1, lkm:1, lko:1, ro:.15, ru:.24, rg:.05, rs:1, rpo:0, rpu:0, pa:.43, pb:.63, pin:.17, pdown:.14}),   // default pill
    Object.freeze({name:'egg',     w:.24, h:.33, ex:1.2,  r:1,   e:1, taper:.17, tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0, lki:1, lkm:1, lko:1, ro:.15, ru:.24, rg:.05, rs:1, rpo:0, rpu:0, pa:.43, pb:.63, pin:.17, pdown:.14}),   // pebble, wider at the bottom
    Object.freeze({name:'dot',     w:.24, h:.24, ex:1,    r:1,   e:0, taper:0,   tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0, lki:1, lkm:1, lko:1, ro:.15, ru:.24, rg:.05, rs:1, rpo:0, rpu:0, pa:.43, pb:.63, pin:.17, pdown:.14}),   // plain circle
    Object.freeze({name:'oval',    w:.22, h:.42, ex:1,    r:1,   e:1, taper:0,   tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0, lki:1, lkm:1, lko:1, ro:.15, ru:.24, rg:.05, rs:1, rpo:0, rpu:0, pa:.43, pb:.63, pin:.17, pdown:.14}),   // smooth tall ellipse
    Object.freeze({name:'bean',    w:.2,  h:.4,  ex:1.45, r:1,   e:1, taper:0,   tilt:.244, bend:.35, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0, lki:1, lkm:1, lko:1, ro:.15, ru:.24, rg:.05, rs:1, rpo:0, rpu:0, pa:.43, pb:.63, pin:.17, pdown:.14}), // leaning kidney bean
    Object.freeze({name:'squircle',w:.225,h:.245,ex:1.3,  r:.55, e:0, taper:0,   tilt:0,    bend:0, lon:.2, lat:.04, amin:1, sq:.15, top:0, ck:0, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0, lki:1, lkm:1, lko:1, ro:.15, ru:.24, rg:.05, rs:1, rpo:0, rpu:0, pa:.43, pb:.63, pin:.17, pdown:.14}), // soft rounded square
    // Reference (Henlo's image): a full, closed, plump EGG, narrow rounded end UP, fullest low (~60% down the egg, ~2/3 down the part the image shows),
    // soft and round all round, gentle outward lean (a symmetric average of the two eyes in the image, whose flat
    // bottoms are only the dome edge cropping them), large, close (gap ≈ half an eye width), centred on the orb.
    Object.freeze({name:'ref',     w:.44, h:.5, ex:1.25, r:1,   e:1, taper:.22, tilt:-.3, bend:0, lon:.44, lat:0, amin:99, sq:.22, top:1, ck:.3, slant:0, cutc:0, cutk:0, asw:0, ahy:0, atilt:0, lki:1, lkm:1, lko:1, ro:.15, ru:.24, rg:.05, rs:1, rpo:0, rpu:0, pa:.43, pb:.63, pin:.17, pdown:.14}),
    // Toon (the drawing tutorial, built its way): step 2/3 a plain upright ellipse (the tutorial's near eye,
    // semi-axes 0.427 : 0.600), mirrored; step 4 the rim = the SAME ellipse scaled ×1.068 and moved up 0.17·hh
    // (+0.06·hw outward), drawn behind; step 5 ONE fixed 3×3 lattice warps both: only its bottom row moves,
    // squashing the lower half up ×0.714 inner / 0.726 mid / 0.92 outer (lki/lkm/lko); step 6 tall oval pupils
    // (0.36·hw × 0.60·hh) sitting 0.36·hw inward, clipped to the white. The 3/4 look is a camera angle, so the
    // asymmetry (slider, default 0; 1 = the tutorial) only adds the far-eye narrowing on request: asw = width
    // difference, ahy = eye heights, atilt = shared lid tilt (used by the expression lids).
    Object.freeze({name:'toon',    w:.47, h:.66, ex:1, r:1, e:1, taper:0, tilt:0, bend:0, lon:.38, lat:-.065, amin:99, sq:.22, top:1, ck:.3, slant:0, cutc:0, cutk:0, asw:.17, ahy:.17, atilt:.16,
      lki:.714, lkm:.726, lko:.92, ro:0, ru:0, rg:0, rs:1.068, rpo:.06, rpu:.17, pa:.36, pb:.60, pin:.36, pdown:.05})]);
  const LID0=REST.w/REST.h;               // lid at which the stadium reaches a circle (fade starts below it)
  /* Box for any shape. Lid/blink close it vertically: hh goes from the natural height to round (hh = hw)
     as lid goes 1 → LID0, then the eye fades (lidFade). For the stadium this is EXACTLY stadiumOf + lidFade
     (h·lid is linear and hits w at LID0). Shapes with little height to give (dot, squircle) shrink up to
     15% instead of squashing, so a happy squint still reads and nothing gets flatter than round.
     'ref' (top = 1) never flattens: a real lid comes down from the top and a squint shrinks it (branch below).
     Writes o.hw, o.hh, o.cap (= hh − hw, the stadium cap), o.fade, o.ex. */
  /* v = [size, lid, shapeIndex, happy, asymmetry, lidSad, lidAngry, lidTired]. Also writes the lid frame used by the shader (radians, eye-local):
     o.oy = egg-centre offset (a 'top' shape's squint shrinks toward its bottom, so the centre drops), o.vtop =
     lid line relative to the egg centre (parked 1.5·hh above for the others = no effect), o.ck lid corner. */
  /* slanted top cut + 3/4 asymmetry (radians, eye-local): o.asx = ±width scale per side (right 1+asx, left 1−asx),
     o.asy = ±height offset (left up, right down), o.cut = cut line height (parked 9·hh = none), o.cutk = corner,
     (o.nLx, o.nLy) / (o.nRx, o.nRy) = the cut line's normal for the left / right eye. A = v[4] (1 = the tutorial). */
  /* expression lids (debug sliders): a straight lid line per eye, height ×hh above the eye centre and angle
     (+ = the inner side higher), slid in from above (off) by the summed weight. Any shape (it rides the cut). */
  const LIDX=Object.freeze({off:1.35, sad:[.45,.45], angry:[.40,-.45], tired:[.05,0], k:.08});
  function cutFrame(o,S,A,ls,la,lt){
    const a=clamp(A||0,0,1.5); o.asx=S.asw/2*a; o.asy=S.ahy*o.hh*a;
    let pR=S.slant+S.atilt*a, pL=-S.slant+S.atilt*a;               // top line angle per eye (+ = rising to the right)
    o.cut=S.cutc?S.cutc*o.hh:9*o.hh; o.cutk=S.cutc?Math.max(1e-3,S.cutk*o.hw):1e-3;
    const ws=clamp(ls||0,0,1), wa=clamp(la||0,0,1), wt=clamp(lt||0,0,1), sum=ws+wa+wt;
    if(sum>0){
      const W=Math.min(1,sum), X=LIDX;
      const hT=(ws*X.sad[0]+wa*X.angry[0]+wt*X.tired[0])/sum, aT=(ws*X.sad[1]+wa*X.angry[1]+wt*X.tired[1])/sum;
      const h=X.off+(hT-X.off)*W, ang=aT*W;
      pL+=ang; pR-=ang;                                             // inner side up: left eye rises right, right eye rises left
      o.cut=h*o.hh*Math.cos(ang); o.cutk=Math.max(o.cutk,X.k*o.hw*W);
    }
    o.nLx=-Math.sin(pL); o.nLy=Math.cos(pL); o.nRx=-Math.sin(pR); o.nRy=Math.cos(pR);
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
      return cutFrame(o,S,v[4],v[5],v[6],v[7]);
    }
    let w=S.w*s; const h=S.h*s; if(h<w) w=h;
    const k=Math.min(1,Math.max(0,(l-LID0)/(1-LID0)));                 // 1 open … 0 flattest allowed
    const am=Math.min(h/Math.max(w,1e-9),S.amin), hmin=w*am;             // never flatter than amin
    const room=Math.min(1,Math.max(0,1-(S.h/S.w-am)/(REST.h/REST.w-1)));  // 0 stadium … 1 no height to give
    const shrink=1-S.sq*(1-k)*room;
    o.hw=w/2*shrink; o.hh=(hmin+(h-hmin)*k)/2*shrink; o.cap=Math.max(0,o.hh-o.hw);
    o.fade=w<=0?0:(l>=LID0?1:Math.max(0,l/LID0)); o.ex=S.ex;
    o.oy=0; o.vtop=1.5*o.hh; o.ck=1e-3;                               // no lid line (parked well above)
    return cutFrame(o,S,v[4],v[5],v[6],v[7]);
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
  /* 7 toon (the drawing tutorial, its steps): an upright ellipse whose lower half is squashed up by the shared
     lattice (inner more than outer); plus the optional 3/4 asymmetry, expression lids and the blink lid from C.
     C = the eyeShapeV box (omit for the open rest shape); R = rim transform {x,y,s} (see sdToonRim).
     Same as eyeSDFP(…, SHAPES.toon, C, R). */
  function sdToon(u,v,hw,hh,side,C,R){ return eyeSDFP(u,v,hw,hh,side,SHAPES[7],C,R); }
  function sdSquircle(u,v,hw,hh){ const r=.55*hw, qx=Math.abs(u)-hw+r, qy=Math.abs(v)-hh+r;
    return len(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r; }
  const SDF=[sdStadium,sdEgg,sdDot,sdOval,sdBean,sdSquircle,sdRef,sdToon];
  function eyeSDF(id,u,v,hw,hh,side,C){ return (SDF[id|0]||sdStadium)(u,v,hw,hh,side,C); }
  /* The one the shader runs: every shape above is this function at its SHAPES params (checked in tests):
     lean + bow (bean) → taper (egg) → mix(rounded box with corner r·hw, ellipse, e). */
  function eyeSDFP(u,v,hw,hh,side,P,C,R){
    const A=C&&C.cut!==undefined, sx=A?1+side*C.asx:1;
    if(A){ v+=side*C.asy; u/=sx; }                                     // 3/4 asymmetry: per-eye width + height
    if(C) v-=C.oy;
    // ONE fixed 3×3 lattice ('toon'; identity otherwise): inverse bilinear offsets, only the bottom row moves →
    // below the centre the sample is pulled down by w = lerp(1/k) across the columns (inner · mid · outer, over
    // ±1.4·hw). Applied BEFORE the rim transform, so white and rim share it. js: SDF rescale (continuous at v = 0).
    const iI=1/(P.lki||1), iM=1/(P.lkm||1), iO=1/(P.lko||1);
    let wu=u, wv=v, js=1;
    if(iI!==1||iM!==1||iO!==1){
      const f=clamp(-side*u/(1.4*hw),-1,1), w=iM+(f>0?iI-iM:iM-iO)*f;
      if(v<0) wv=v*w;
      js=1/(1+(w-1)*clamp(-2*v/hh,0,1));
    }
    const rx=R?side*R.x:0, ry=R?R.y:0, rs=R?R.s:1;                      // rim: the white scaled ×rs, moved (rx, ry)
    wu=(wu-rx)/rs; wv=(wv-ry)/rs;
    const c=Math.cos(P.tilt), s=Math.sin(P.tilt);
    let x=c*wu+side*s*wv; const y=-side*s*wu+c*wv, yn=clamp(y/hh,-1,1);
    x-=side*P.bend*hw*(1-yn*yn);
    const g=1-P.taper*yn; x/=g;
    const r=P.r*hw, qx=Math.abs(x)-hw+r, qy=Math.abs(y)-hh+r;
    const dR=len(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;
    const d=(dR+(sdEllipse(x,y,hw,hh)-dR)*P.e)*g*(rs*js);
    if(!C) return d;
    const lu=u-rx, lv=v-ry;                                            // lid lines ride with the rim (lash line)
    const e=A?smax(d,(side<0?C.nLx:C.nRx)*lu+(side<0?C.nLy:C.nRy)*lv-C.cut,C.cutk):d;   // soft slanted cut / expression lid
    return smax(e,lv-C.vtop,C.ck)*Math.min(sx,1);
  }
  /* ---- toon layer (the drawing tutorial's eyes), for every shape ----
     Rim, drawn BEHIND the white so only a crescent shows: (a) the white's SDF shifted up + outward and grown a
     touch (ro/ru/rg; the 7 classic shapes), or (b) the tutorial's step 4 ('toon'): the same white scaled ×rs and
     moved up/out AFTER the shared lattice warp (rs/rpo/rpu), so it peeks out at the top and outer side.
     Pupil: an upright dark oval (pa × pb of the eye's OPEN half-axes, so a blink/squint covers it instead of
     squashing it), resting inward and down, shifted toward the gaze, clipped by the white. Toon-layer life:
     k.dil scales it (dilation with content, 1…1.22), k.stretch (0…1) stretches it ×1.2 along the dart direction
     (k.sdx, k.sdy: unit vector, eye-local u right / v up) and ×0.85 across (o.m0, o.m1, o.m3 = symmetric 2×2 map
     into the pupil frame, o.ms = its SDF scale; exactly identity at rest).
     All radians, eye-local (u, v as eyeSDFP; side = −1 left, +1 right; inward = −side·u).
     toonV(o, box, open, gx, gy, k, P) → o.ox, o.oy, o.grow, o.rs, o.rpo, o.rpu (rim), o.a, o.b, o.pin, o.pu, o.pv,
       o.m0, o.m1, o.m3, o.ms (pupil). box = current {hw, hh, oy}; open = the same shape at lid 1 {hw, hh};
       gx, gy = pupil gaze in −1…1 (+x right, +y down, from the pupil spring); k = {rim, pupil, follow, dil,
       stretch, sdx, sdy} (slider factors 1 = default); P = per-shape params (SHAPES fields, morph-lerped; omit = classic). */
  const TOON={rimOut:.15, rimUp:.24, rimGrow:.05, pa:.43, pb:.63, pin:.17, pdown:.14, fu:.5, fv:.45, dilMax:1.22, sAlong:.2, sAcross:.15};
  const TOONP=Object.freeze({ro:TOON.rimOut, ru:TOON.rimUp, rg:TOON.rimGrow, rs:1, rpo:0, rpu:0, pa:TOON.pa, pb:TOON.pb, pin:TOON.pin, pdown:TOON.pdown});
  function toonV(o,box,open,gx,gy,k,P){
    P=P||TOONP;
    const r=k.rim*box.hw; o.ox=P.ro*r; o.oy=P.ru*r; o.grow=P.rg*r;
    o.rs=1+(P.rs-1)*k.rim; o.rpo=P.rpo*r; o.rpu=P.rpu*k.rim*box.hh;          // faithful rim (thickness slider scales it)
    const hw0=Math.max(open.hw,1e-4), hh0=Math.max(open.hh,1e-4), sq=box.hh/hh0;   // sq: squash of a blink
    const dil=k.dil===undefined?1:Math.min(TOON.dilMax,Math.max(1,k.dil));
    o.a=P.pa*hw0*k.pupil*dil; o.b=P.pb*hh0*k.pupil*dil;
    o.pin=P.pin*hw0;
    o.pu=clamp(gx,-1,1)*k.follow*TOON.fu*Math.max(0,hw0-o.a);
    o.pv=(box.oy||0)+(-P.pdown*hh0-clamp(gy,-1,1)*k.follow*TOON.fv*Math.max(0,hh0-o.b))*Math.min(1,sq);
    const am=clamp(k.stretch||0,0,1);
    if(am>1e-4){
      const sa=1/(1+TOON.sAlong*am), sc=1/(1-TOON.sAcross*am), dx=k.sdx, dy=k.sdy;
      o.m0=sa*dx*dx+sc*dy*dy; o.m1=(sa-sc)*dx*dy; o.m3=sa*dy*dy+sc*dx*dx; o.ms=1-TOON.sAcross*am;
    } else { o.m0=1; o.m1=0; o.m3=1; o.ms=1; }
    return o;
  }
  // rim SDF (< 0 inside the dark shape; the visible crescent is where this is < 0 and the white's SDF is > 0)
  function sdToonRim(u,v,hw,hh,side,P,C,T){
    const R=T.rs!==undefined&&(T.rs!==1||T.rpo||T.rpu)?{x:T.rpo,y:T.rpu,s:T.rs}:undefined;
    return eyeSDFP(u-side*T.ox,v-T.oy,hw,hh,side,P,C,R)-T.grow;
  }
  // pupil SDF, already clipped by the white (dWhite = the white's SDF at the same point)
  function sdPupil(u,v,side,T,dWhite,C){
    const sx=C&&C.asx!==undefined?1+side*C.asx:1; if(sx!==1||C&&C.asy) { v+=side*C.asy; u/=sx; }
    let pu=u+side*T.pin-T.pu, pv=v-T.pv;
    if(T.m0!==undefined){ const x=T.m0*pu+T.m1*pv, y=T.m1*pu+T.m3*pv; pu=x; pv=y; }
    return Math.max(sdEllipse(pu,pv,T.a,T.b)*Math.min(sx,1)*(T.ms===undefined?1:T.ms),dWhite);
  }
  window.AstridFace=Object.freeze({SHAPES,eyeShapeV,eyeSDF,eyeSDFP,TOON,TOONP,LIDX,toonV,sdToonRim,sdPupil,sdStadium,sdEgg,sdDot,sdOval,sdBean,sdSquircle,sdRef,sdToon,CX,CY,RR,REST,projector,projectInto,projectV,stadiumOf,lidFade,eyePts,eyeUniforms,eyeInto,eyeV});
})();
