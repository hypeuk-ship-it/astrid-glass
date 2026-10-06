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
  window.AstridFace=Object.freeze({CX,CY,RR,REST,projector,projectInto,projectV,stadiumOf,lidFade,eyePts,eyeUniforms,eyeInto,eyeV});
})();
