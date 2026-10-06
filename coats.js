/* Astrid coats — read-only copy of ColorWay (EInkPalette.swift) desk paper / orb / mark, as [light, dark].
   Plus the default 'glass' preset. palette() derives the shader colours (same logic as v6-svg.html).
   Classic script (no modules) so index.html works from file://. Exposes window.AstridCoats. */
(function(){
  const COATS={
    cream:    {paper:['faf8f3','14130f'],orb:['faf8f3','050505'],mark:['111111','faf8f3']},
    carbon:   {paper:['08090c','08090c'],orb:['05060a','05060a'],mark:['c5ccd6','c5ccd6']},
    sumi:     {paper:['e8f0e4','121310'],orb:['c5cbb8','121310'],mark:['1a1c16','e8f0e4']},
    manila:   {paper:['f4ead0','1c150c'],orb:['e6c48a','1c150c'],mark:['1a2744','f0d8a8']},
    cyanotype:{paper:['d6eef8','0a1822'],orb:['7eb3cc','0a1822'],mark:['003153','b8d4e4']},
    violet:   {paper:['f0e5f9','160a22'],orb:['c9a0e4','08040e'],mark:['2b1548','e4c8f6']},
  };
  /* read-only: deep-freeze so nothing at runtime can drift from EInkPalette.swift */
  Object.values(COATS).forEach(c=>{Object.values(c).forEach(Object.freeze);Object.freeze(c);}); Object.freeze(COATS);
  const hx=h=>{h=h.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
  const toHex=a=>'#'+a.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
  const mix=(a,b,t)=>toHex(hx(a).map((v,i)=>v+(hx(b)[i]-v)*t));
  const lum=h=>{const [r,g,b]=hx(h);return (.2126*r+.7152*g+.0722*b)/255};
  const rgb=h=>hx(h).map(v=>v/255);              // → [0..1] for uniforms

  function palette(name,dark){
    /* 'glass' = Henlo's reference vibe: pale frosted white, sky-blue pool glowing up from the bottom */
    if(name==='glass') return dark
      ? {paper:'#0b0d14',core:'#3f86e8',deep:'#2a62c8',mid:'#5c8fd0',edge:'#1a2030',halo:'#161b29',eye:'#ffffff',eyeHi:'#ffffff',eyeLo:'#c6d8f2',glow:'#8fc0ff',shadow:'#000000',ink:'#9aa6bd',inner:0,dark:1}
      : {paper:'#f1f1f1',core:'#76b4f1',deep:'#5a9fec',mid:'#a9d3f8',edge:'#ffffff',halo:'#ffffff',eye:'#ffffff',eyeHi:'#ffffff',eyeLo:'#d3e2f4',glow:'#eaf6ff',shadow:'#2a3d66',ink:'#5a6272',inner:0,dark:0};
    const c=COATS[name]||COATS.cream,i=dark?1:0,paper='#'+c.paper[i],orb='#'+c.orb[i],mark='#'+c.mark[i];
    const isDark=lum(paper)<.3;
    const core=Math.abs(lum(orb)-lum(paper))<.08 ? mix(orb,mark,isDark?.3:.2) : mix(orb,mark,.1);
    const edge=isDark?mix(paper,mark,.1):mix(paper,'#ffffff',.6);
    const mid=mix(core,edge,.45);
    return {paper,core,deep:mix(core,mark,.22),mid,edge,halo:isDark?mix(paper,mark,.07):'#ffffff',
            eye:mark,eyeHi:mix(mark,isDark?'#ffffff':edge,.3),eyeLo:mix(mark,core,.35),
            glow:isDark?mix(mark,core,.4):'#ffffff',shadow:isDark?'#000000':mark,ink:mix(mark,paper,.3),
            inner:isDark?.2:.55,dark:isDark?1:0};
  }
  /* swatch for the dot picker (same as v6) */
  const swatch=n=>n==='glass'?'radial-gradient(circle at 50% 85%,#5598e8,#a6d0f7 55%,#ffffff)'
    :'#'+(COATS[n].orb[0]===COATS[n].paper[0]?COATS[n].mark[0]:COATS[n].orb[0]);

  window.AstridCoats=Object.freeze({COATS,names:Object.freeze(['glass',...Object.keys(COATS)]),palette,swatch,mix,rgb,lum});
})();
