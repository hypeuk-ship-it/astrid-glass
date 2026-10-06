/* Exact port of AstridFace (Swift): projector(yaw,pitch,roll), stadiumOf, lidFade, eyePath.
   CX=120 CY=120 RR=110, rest eyes lon ±0.2 lat 0.04, stadium w 0.23 h 0.52 (never flatter than a circle).
   eyePts() is the literal 20-seg polygon port (z>0.02 cull) — kept for parity/debug overlay.
   eyeUniforms() hands the same stadium to the shader, which inverts the projector per pixel
   (screen → sphere → un-rotate → lon/lat) and evaluates the stadium analytically there.
   Exposes window.AstridFace. */
(function(){
  const CX=120, CY=120, RR=110, REST=Object.freeze({lon:.2, lat:.04, w:.23, h:.52});
  function projector(yaw,pitch,roll){
    const cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw),cr=Math.cos(roll),sr=Math.sin(roll);
    return (lon,lat)=>{
      let x=Math.cos(lat)*Math.sin(lon), y=Math.sin(lat), z=Math.cos(lat)*Math.cos(lon);
      const y1=y*cp-z*sp; z=y*sp+z*cp; y=y1;
      const x2=x*cy+z*sy; z=-x*sy+z*cy; x=x2;
      return {x:CX+RR*(x*cr-y*sr), y:CY-RR*(x*sr+y*cr), z};
    };
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
  function eyeUniforms(size,lid){
    const e={lon:REST.lon,lat:REST.lat,s:size,rot:0,lid:Math.max(0,lid)};
    const [w,h]=stadiumOf(e), vis=Math.max(w,h*e.lid), hw=w/2, cap=Math.max(0,vis/2-hw);
    return {hw,cap,fade:lidFade(e)};
  }
  window.AstridFace=Object.freeze({CX,CY,RR,REST,projector,stadiumOf,lidFade,eyePts,eyeUniforms});
})();
