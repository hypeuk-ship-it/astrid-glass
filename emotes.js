/* Astrid eye-emote styles: sheet catalog + per-emote motif/brow/blush params.
   Shape geometry lives in face.js SHAPES (name = `${sheet}-${id}`); this file is the
   UI/metadata layer (labels, motif type, colours, brow stroke pose, baked expression lids).
   Polly = ONE character face with 12 emotion poses (shared white base in face.js); picker
   switches pose, not an unrelated eye species.
   Motif ids match the shader uMotif.x: 0 oval/circle+glint, 1 star, 2 heart, 3 spiral, 4 ring, 5 flower, 6 tiny-dot.
   uMotif.y = anger-mark count (0/1/2). Brow stroke: h/halfW/thick/ang + arch (mid rise) + taper (outer thin). */
(function(){
  const Motif={oval:0,star:1,heart:2,spiral:3,ring:4,flower:5,dot:6};
  /* rgb 0..1 */
  const C=(r,g,b)=>[r/255,g/255,b/255];
  /* brow stroke: h = lift above eye centre ×hh, halfW ×hw, thick ×hw (inner/mid),
     ang (rad, + = outer end up), arch = mid rise above the chord ×hh, taper = outer/inner thick ratio,
     col RGB. Expression lids baked as lidSad/lidAngry/lidTired 0..1 (added to debug sliders). */
  const POLLY=[
    {id:'cheerful',  name:'Cheerful',   motif:'ring',   col:C(150,120,165), brow:{h:1.38,halfW:.50,thick:.30,ang:.18,arch:.36,taper:.48,col:C(210,185,220)}, lid:[0,0,0],   blush:0,  mark:0},
    {id:'confident', name:'Confident',  motif:'oval',   col:C(200,155,55),  brow:{h:1.34,halfW:.50,thick:.30,ang:.22,arch:.30,taper:.45,col:C(210,170,60)},  lid:[0,0,0], blush:0,  mark:0},
    {id:'bored',     name:'Bored',      motif:'oval',   col:C(70,145,245),  brow:{h:1.18,halfW:.55,thick:.28,ang:-.22,arch:.10,taper:.40,col:C(90,140,220)},  lid:[0,0,0], blush:0,  mark:0},
    {id:'angry',     name:'Angry',      motif:'oval',   col:C(200,40,50),   brow:{h:1.22,halfW:.52,thick:.32,ang:-.70,arch:.06,taper:.35,col:C(200,45,55)},  lid:[0,0,0], blush:0,  mark:1},
    {id:'sleepy',    name:'Sleepy',     motif:'dot',    col:C(90,50,140),   brow:{h:1.42,halfW:.48,thick:.28,ang:.28,arch:.32,taper:.45,col:C(150,90,190)},  lid:[0,0,0], blush:0,  mark:0},
    {id:'smug',      name:'Smug',       motif:'oval',   col:C(40,185,40),   brow:{h:1.14,halfW:.54,thick:.26,ang:-.06,arch:.06,taper:.48,col:C(50,190,50)},  lid:[0,0,0], blush:0,  mark:0},
    {id:'furious',   name:'Furious',    motif:'dot',    col:C(180,30,40),   brow:{h:1.14,halfW:.54,thick:.34,ang:-.82,arch:.04,taper:.30,col:C(190,35,45)},  lid:[0,0,0],blush:0,  mark:2},
    {id:'starry',    name:'Starry',     motif:'star',   col:C(235,130,55),  brow:{h:1.40,halfW:.50,thick:.30,ang:.20,arch:.38,taper:.45,col:C(235,140,60)},  lid:[0,0,0],   blush:0,  mark:0},
    {id:'pleading',  name:'Pleading',   motif:'flower', col:C(60,185,215),  brow:{h:1.38,halfW:.50,thick:.28,ang:.32,arch:.34,taper:.48,col:C(120,200,220)}, lid:[0,0,0], blush:.15,mark:0},
    {id:'love',      name:'Love-struck',motif:'heart',  col:C(220,70,150),  brow:{h:1.22,halfW:.50,thick:.28,ang:.08,arch:.28,taper:.48,col:C(230,90,160)},  lid:[0,0,0], blush:.60,mark:0},
    {id:'dizzy',     name:'Dizzy',      motif:'spiral', col:C(40,40,45),    brow:{h:1.45,halfW:.46,thick:.14,ang:.20,arch:.40,taper:.35,col:C(35,35,40)},    lid:[0,0,0],   blush:0,  mark:0},
    {id:'blush',     name:'Blushing',   motif:'dot',    col:C(40,35,40),    brow:{h:1.45,halfW:.48,thick:.28,ang:.24,arch:.34,taper:.45,col:C(230,130,160)}, lid:[0,0,0],   blush:.95,mark:0}
  ].map(e=>({...e, sheet:'polly', key:`polly-${e.id}`, motifId:Motif[e.motif]}));

  const SHEETS=Object.freeze([
    Object.freeze({id:'polly', label:'Polly', credit:'Style after Polly Von Dominique', emotes:Object.freeze(POLLY)})
    // El_azushu + Designs land in later batches after Polly review
  ]);

  const BY_KEY=Object.create(null);
  SHEETS.forEach(s=>s.emotes.forEach(e=>{ BY_KEY[e.key]=e; }));

  window.AstridEmotes=Object.freeze({Motif,SHEETS,BY_KEY,isEmote:k=>!!BY_KEY[k],get:k=>BY_KEY[k]||null});
})();
