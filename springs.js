/* Velocity springs — same integrator as the Swift rig: v=(v+(t-x)*k)*d; x+=v.
   Stepped at a fixed 60 Hz (see index.html) so feel is frame-rate independent.
   Exposes window.AstridSprings. */
(function(){
  const spring=(x,k,d)=>({x,v:0,t:x,k,d});
  const step=s=>{s.v=(s.v+(s.t-s.x)*s.k)*s.d; s.x+=s.v;};
  /* time-scaled step (drift speed slider): k·s², d^s ≈ the same spring run s× faster */
  const stepScaled=(s,speed)=>{
    if(speed<1e-3){s.v=0;return;}
    s.v=(s.v+(s.t-s.x)*s.k*speed*speed)*Math.pow(s.d,speed); s.x+=s.v;
  };
  const snap=(s,x)=>{s.x=s.t=x;s.v=0;};
  window.AstridSprings={spring,step,stepScaled,snap};
})();
