/* Velocity springs — same integrator as the Swift rig: v=(v+(t-x)*k)*d; x+=v.
   Stepped at a fixed 60 Hz by index.html (accumulator), so the feel is identical at 30/60/120 Hz.
   For smooth 120 Hz output the renderer interpolates between the last two 60 Hz states:
   save() before each step, at(s,a) when drawing (a = fraction of the next step already elapsed).
   Exposes window.AstridSprings. */
(function(){
  const spring=(x,k,d)=>({x,v:0,t:x,k,d,px:x});
  const step=s=>{s.v=(s.v+(s.t-s.x)*s.k)*s.d; s.x+=s.v;};
  /* time-scaled step (drift speed slider): k·s², d^s ≈ the same spring run s× faster */
  const stepScaled=(s,speed)=>{
    if(speed<1e-3){s.v=0;return;}
    s.v=(s.v+(s.t-s.x)*s.k*speed*speed)*Math.pow(s.d,speed); s.x+=s.v;
  };
  const snap=(s,x)=>{s.x=s.t=s.px=x;s.v=0;};
  const save=s=>{s.px=s.x;};
  const at=(s,a)=>s.px+(s.x-s.px)*a;
  window.AstridSprings=Object.freeze({spring,step,stepScaled,snap,save,at});
})();
