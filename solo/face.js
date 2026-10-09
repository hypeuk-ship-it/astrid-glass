/* Astrid's eye: the Toon eye (the drawing tutorial's eye, built its way) on the AstridFace sphere.
   CX=120 CY=120 RR=110 (AstridFace.swift projector). The shader inverts the projector per pixel
   (screen → sphere → un-rotate → lon/lat) and evaluates the same eye SDF there; this file holds the
   CPU side: the eye box per frame (size, lid, happy squint, 3/4 asymmetry, expression lids) and the
   toon layer (rim behind the white, tall pupils with dilation, dart stretch and soft containment).
   Exposes window.AstridFace. */
(function(){
  const CX=120, CY=120, RR=110;
  /* projectV: the projector maths with precomputed trig, inputs in a Float64Array
     v=[cy,sy,cp,sp,cr,sr,lon,lat], writing into `o` (allocation-free per frame). */
  function projectV(o,v){
    const cy=v[0],sy=v[1],cp=v[2],sp=v[3],cr=v[4],sr=v[5],lon=v[6],lat=v[7];
    let x=Math.cos(lat)*Math.sin(lon), y=Math.sin(lat), z=Math.cos(lat)*Math.cos(lon);
    const y1=y*cp-z*sp; z=y*sp+z*cp; y=y1;
    const x2=x*cy+z*sy; z=-x*sy+z*cy; x=x2;
    o.x=CX+RR*(x*cr-y*sr); o.y=CY-RR*(x*sr+y*cr); o.z=z; return o;
  }
  /* ---------------- the eye (port 1:1 to AstridFace.swift) ----------------
     Eye-local sphere coords (radians): u = lon − (±lon) (+ = screen right), v = lat − lat0 (+ = up);
     side = −1 for the screen-left eye, +1 for the right. SDFs return radians (< 0 inside).
     Step 2/3: a plain upright ellipse (semi-axes 0.427 : 0.600 of the tutorial's near eye), mirrored.
     Step 4: the rim = the SAME ellipse scaled ×rs and moved up rpu·hh (+ rpo·hw outward), drawn behind.
     Step 5: ONE fixed 3×3 lattice warps both: only its bottom row moves, squashing the lower half up
     ×lki inner / lkm mid / lko outer. Step 6: tall oval pupils (pa·hw × pb·hh) sitting pin·hw inward,
     dropped pdown·hh, clipped to the white.
     w, h = natural size (radians at size 1); lon, lat = rest eye centre; sq = how much a happy squint
     shrinks it (toward its bottom); ck = lid corner rounding ×hw (the blink lid comes down from the top);
     asw/ahy/atilt = 3/4-view asymmetry at full strength (lopsided slider, default 0): width difference,
     eye heights, shared lid tilt (also used by the expression lids). */
  const EYE=Object.freeze({w:.47, h:.66, lon:.38, lat:-.065, sq:.22, ck:.3, asw:.17, ahy:.17, atilt:.16,
    lki:.714, lkm:.726, lko:.92, rs:1.068, rpo:.06, rpu:.17, pa:.36, pb:.60, pin:.36, pdown:.05});
  const len=(x,y)=>Math.sqrt(x*x+y*y), clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
  /* expression lids (debug sliders): a straight lid line per eye, height ×hh above the eye centre and angle
     (+ = the inner side higher), slid in from above (off) by the summed weight. */
  const LIDX=Object.freeze({off:1.35, sad:[.45,.45], angry:[.40,-.45], tired:[.05,0], love:[.90,-.16], k:.08, loveK:.20});
  /* 3/4 asymmetry + lid line: o.asx = ±width scale per side (right 1+asx, left 1−asx), o.asy = ±height offset
     (left up, right down), o.cut = lid line height (parked 9·hh = none), o.cutk = its corner,
     (o.nLx, o.nLy) / (o.nRx, o.nRy) = the lid line's normal for the left / right eye. A = asymmetry (1 = the tutorial). */
  function cutFrame(o,A,ls,la,lt,lf){
    const a=clamp(A||0,0,1.5); o.asx=EYE.asw/2*a; o.asy=EYE.ahy*o.hh*a;
    let pR=EYE.atilt*a, pL=EYE.atilt*a;                               // top line angle per eye (+ = rising to the right)
    o.cut=9*o.hh; o.cutk=1e-3;
    const ws=clamp(ls||0,0,1), wa=clamp(la||0,0,1), wt=clamp(lt||0,0,1), wf=clamp(lf||0,0,1), sum=ws+wa+wt+wf;
    if(sum>0){
      const W=Math.min(1,sum), X=LIDX;
      const hT=(ws*X.sad[0]+wa*X.angry[0]+wt*X.tired[0]+wf*X.love[0])/sum, aT=(ws*X.sad[1]+wa*X.angry[1]+wt*X.tired[1]+wf*X.love[1])/sum;
      const h=X.off+(hT-X.off)*W, ang=aT*W;
      pL+=ang; pR-=ang;                                               // inner side up: left eye rises right, right eye rises left
      o.cut=h*o.hh*Math.cos(ang);
      const kk=(wf>.5&&ws+wa+wt<.01)?X.loveK:X.k;                    // love's lid is rounder, so it doesn't read as a slash
      o.cutk=Math.max(o.cutk,kk*o.hw*W);
    }
    o.nLx=-Math.sin(pL); o.nLy=Math.cos(pL); o.nRx=-Math.sin(pR); o.nRy=Math.cos(pR);
    return o;
  }
  /* eye box for this frame. v = [size, lid, -, happy, asymmetry, lidSad, lidAngry, lidTired].
     Writes o.hw, o.hh (half width / height, radians), o.fade, o.oy (centre offset: a happy squint shrinks the eye
     toward its bottom, so the centre drops), o.vtop (blink lid line rel. to the centre: 1.25·hh above when open →
     the bottom when shut), o.ck (lid corner), plus the cutFrame fields. */
  function eyeShapeV(o,v){
    const s=Math.max(0,v[0]), l=Math.max(0,v[1]);
    const hp=clamp(v[3]||0,0,1), sc=1-EYE.sq*hp;                      // happy squint: shrink toward the bottom
    const hwN=EYE.w*s/2, hhN=EYE.h*s/2;
    o.hw=hwN*sc; o.hh=hhN*sc;
    o.oy=-hhN*(1-sc);                                                  // the bottom stays where it was
    const lb=clamp(l/Math.max(.2,1-.5*hp),0,1);                        // the lid with the squint factored out
    o.vtop=o.hh*(2.25*lb-1);                                           // lid line: 1.25·hh above (open) → bottom
    o.ck=Math.max(1e-3,EYE.ck*o.hw); o.fade=s<=0?0:clamp(lb*5,0,1);
    return cutFrame(o,v[4],v[5],v[6],v[7],v[8]);
  }
  // ellipse, semi-axes a, b (iq's gradient-normalised approximation: exact on the boundary)
  function sdEllipse(u,v,a,b){ const k0=len(u/a,v/b), k1=len(u/(a*a),v/(b*b)); return k1>1e-9?k0*(k0-1)/k1:-Math.min(a,b); }
  /* the open white (no lids; what the shader's eyeSDF is without the cut / blink lid): the 3/4 asymmetry is not
     applied here (containPupil works in the asymmetry-free frame, like the shader's pupil) */
  function eyeSDF(u,v,hw,hh,side){
    // ONE fixed 3×3 lattice: inverse bilinear offsets, only the bottom row moves → below the centre the sample is
    // pulled down by w = lerp(1/k) across the columns (inner · mid · outer, over ±1.4·hw). js: SDF rescale.
    const iI=1/EYE.lki, iM=1/EYE.lkm, iO=1/EYE.lko;
    const f=clamp(-side*u/(1.4*hw),-1,1), w=iM+(f>0?iI-iM:iM-iO)*f;
    const wv=v<0?v*w:v, js=1/(1+(w-1)*clamp(-2*v/hh,0,1));
    return sdEllipse(u,wv,hw,hh)*js;
  }
  /* ---- toon layer ----
     Rim, drawn BEHIND the white so only a crescent shows: the tutorial's step 4, the same white scaled ×rs and
     moved up/out AFTER the shared lattice warp (rs/rpo/rpu), so it peeks out at the top and outer side.
     Pupil: an upright dark oval (pa × pb of the eye's OPEN half-axes, so a blink/squint covers it instead of
     squashing it), resting inward and down, shifted toward the gaze, clipped by the white. Life:
     k.dil scales it (dilation with content, 1…1.22), k.stretch (0…1) stretches it ×1.2 along the dart direction
     (k.sdx, k.sdy: unit vector, eye-local u right / v up) and ×0.85 across (o.m0, o.m1, o.m3 = symmetric 2×2 map
     into the pupil frame, o.ms = its SDF scale; exactly identity at rest).
     toonV(o, box, open, gx, gy, k) → o.rs, o.rpo, o.rpu (rim), o.a, o.b, o.pin, o.pu, o.pv, o.m0, o.m1, o.m3, o.ms,
       o.cuL, o.cvL, o.cuR, o.cvR (pupil; c* = per-eye containment offsets). box = current {hw, hh, oy}; open = the
       eye at lid 1 {hw, hh}; gx, gy = pupil gaze in −1…1 (+x right, +y down, from the pupil spring);
       k = {rim, pupil, follow, dil, stretch, sdx, sdy} (slider factors 1 = default). */
  const TOON={fu:.55, fv:.52, dilMax:1.22, sAlong:.2, sAcross:.15};
  function toonV(o,box,open,gx,gy,k){
    const P=EYE;
    const r=k.rim*box.hw; o.rs=1+(P.rs-1)*k.rim; o.rpo=P.rpo*r; o.rpu=P.rpu*k.rim*box.hh;   // rim (thickness slider scales it)
    const hw0=Math.max(open.hw,1e-4), hh0=Math.max(open.hh,1e-4), sq=box.hh/hh0;   // sq: squash of a blink
    const dil=k.dil===undefined?1:Math.min(TOON.dilMax,Math.max(1,k.dil));
    o.a=P.pa*hw0*k.pupil*dil; o.b=P.pb*hh0*k.pupil*dil;
    o.pin=P.pin*hw0;
    o.pu=clamp(gx,-1,1)*k.follow*TOON.fu*Math.max(0,hw0-o.a);
    const pvb=-P.pdown*hh0-clamp(gy,-1,1)*k.follow*TOON.fv*Math.max(0,hh0-o.b), ks=Math.min(1,sq);
    o.pv=(box.oy||0)+pvb*ks;
    const am=clamp(k.stretch||0,0,1);
    if(am>1e-4){
      const sa=1/(1+TOON.sAlong*am), sc=1/(1-TOON.sAcross*am), dx=k.sdx, dy=k.sdy;
      o.m0=sa*dx*dx+sc*dy*dy; o.m1=(sa-sc)*dx*dy; o.m3=sa*dy*dy+sc*dx*dx; o.ms=1-TOON.sAcross*am;
    } else { o.m0=1; o.m1=0; o.m3=1; o.ms=1; }
    // soft containment: per eye, nudge the pupil centre so its lower half and sides stay inside the CURRENT white
    // (lattice warp included) with a small margin; its top may still go under a lid / squint / blink, which covers it
    const bw=Math.max(box.hw,1e-4), bh=Math.max(box.hh,1e-4);
    // too big to fit even after moving (dilated in a squashed squint)? shrink both pupils by the same smooth factor
    // (from the residual penetration; never below the undilated size: past that the white's edge clips it like a lid)
    containPupil(o,-1,o.pin+o.pu,pvb*ks,bw,bh); const rL=CP.res;
    containPupil(o, 1,-o.pin+o.pu,pvb*ks,bw,bh); const rR=CP.res;
    const fit=Math.max(1/dil,1/(1+Math.max(rL,rR)/(.6*Math.min(o.a,o.b))));   // gives back at most the dilation
    if(fit<1){ o.a*=fit; o.b*=fit; }
    containPupil(o,-1,o.pin+o.pu,pvb*ks,bw,bh); o.cuL=CP.u; o.cvL=CP.v;
    containPupil(o, 1,-o.pin+o.pu,pvb*ks,bw,bh); o.cuR=CP.u; o.cvR=CP.v;
    // shared upward push (both eyes: a glance down) → mostly shorten the pupil so the centre stays low (the
    // expressive "filled bottom" look); an asymmetric push (one eye against a side) stays a centre nudge only
    const upL=Math.max(0,o.cvL), upR=Math.max(0,o.cvR), up=Math.min(upL,upR), keep=.35;
    if(up>1e-6){ const want=up*(1-keep), bMin=o.b*(1/Math.max(dil,1))*.88;
      const bShrink=Math.min(want,Math.max(0,o.b-bMin)); o.b-=bShrink;
      o.cvL-=bShrink; o.cvR-=bShrink; }
    return o;
  }
  /* containPupil: the pupil oval (centre cu, cv relative to the white's centre; o.a, o.b; stretch map o.m*) sampled
     at N boundary points against the white's SDF (box hw, hh; no lids). The upper points are faded out (fixed
     weights by angle: a lid may cover the top). Penetration = log-sum-exp of the samples (a smooth max) + margin;
     a C¹ soft hinge (exactly 0 when clear, so resting pupils don't move) pushes the centre along the softmax-weighted
     inward normal; 4 fixed iterations → continuous in gaze / dilation / stretch, no popping. Result → CP.u, CP.v
     (centre offset, rad) and CP.res (the soft-hinged penetration left after the last step: > 0 only if it can't fit). */
  const NCP=20, CPC=new Float64Array(NCP), CPS=new Float64Array(NCP), CPD=new Float64Array(NCP), CPU=new Float64Array(NCP), CPV=new Float64Array(NCP);
  const CPW=new Float64Array(NCP);                         // 0 = counts fully (lower half, sides) … −1 = ignored (top)
  for(let i=0;i<NCP;i++){ CPC[i]=Math.cos(2*Math.PI*i/NCP); CPS[i]=Math.sin(2*Math.PI*i/NCP);
    const t=clamp((CPS[i]-.15)/.45,0,1); CPW[i]=-t*t*(3-2*t); }
  const CP={u:.5,v:.5,res:.5}; CP.u=CP.v=CP.res=0;
  const CPK={margin:0, clear:.02, tau:.01, hinge:.012};     // × the white's current hh: engage only when leaving
  function containPupil(o,side,cu,cv,hw0,hh0){
    const m=CPK.margin*hh0, clr=CPK.clear*hh0, tau=CPK.tau*hh0, kh=CPK.hinge*hh0;
    const det=o.m0*o.m3-o.m1*o.m1, i0=o.m3/det, i1=-o.m1/det, i3=o.m0/det;
    const ihw2=1/(hw0*hw0), ihh2=1/(hh0*hh0);
    let du=0, dv=0, s=0, pen=0;
    for(let it=0;it<5;it++){
      let mx=-1e9;
      for(let i=0;i<NCP;i++){
        const ex=o.a*CPC[i], ey=o.b*CPS[i], qu=cu+du+i0*ex+i1*ey, qv=cv+dv+i1*ex+i3*ey;
        const d=eyeSDF(qu,qv,hw0,hh0,side)+CPW[i]*hh0; CPD[i]=d; CPU[i]=qu; CPV[i]=qv; if(d>mx) mx=d;
      }
      let se=0, nu=0, nv=0;
      for(let i=0;i<NCP;i++){
        const w=Math.exp((CPD[i]-mx)/tau), gu=CPU[i]*ihw2, gv=CPV[i]*ihh2, gl=Math.sqrt(gu*gu+gv*gv)||1;
        se+=w; nu+=w*gu/gl; nv+=w*gv/gl;
      }
      // engage only when the soft-max SDF is outside (pen0 > 0); then push toward −clear
      const pen0=mx+tau*Math.log(se)+m; pen=pen0+clr;
      s=pen0<=0?0:pen<=-kh?0:pen<kh?(pen+kh)*(pen+kh)/(4*kh):pen;
      if(s<=0||it===4) break;                                  // the 5th pass only measures the residual
      const nl=Math.sqrt(nu*nu+nv*nv)||1; du-=s*nu/nl; dv-=s*nv/nl;
    }
    const q=pen-kh; CP.u=du; CP.v=dv; CP.res=q<=-kh?0:q<kh?(q+kh)*(q+kh)/(4*kh):q;   // ignores the hinge's own tail
  }
  window.AstridFace=Object.freeze({EYE,LIDX,TOON,CPK,eyeShapeV,eyeSDF,sdEllipse,toonV,projectV,CX,CY,RR});
})();
