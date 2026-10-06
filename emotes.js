/* Astrid eye-emote styles: sheet catalog + per-emote motif/brow/blush params.
   Shape geometry lives in face.js SHAPES (name = `${sheet}-${id}`); this file is the
   UI/metadata layer (labels, motif type, colours, brow pose, baked expression lids).
   Motif ids match the shader uMotif.x: 0 oval, 1 star, 2 heart, 3 spiral, 4 ring, 5 flower, 6 dot. */
(function(){
  const Motif={oval:0,star:1,heart:2,spiral:3,ring:4,flower:5,dot:6};
  /* rgb 0..1 */
  const C=(r,g,b)=>[r/255,g/255,b/255];
  /* brow: h = lift above eye centre ×hh (open), halfW ×hw, thick ×hw, ang (rad, + = outer end up),
     col RGB. Expression lids baked as lidSad/lidAngry/lidTired 0..1 (added to debug sliders). */
  const POLLY=[
    {id:'cheerful',  name:'Cheerful',  motif:'ring',   col:C(150,120,165), brow:{h:1.15,halfW:.7,thick:.22,ang:.35,col:C(210,185,220)}, lid:[0,0,0], blush:0, mark:0},
    {id:'confident', name:'Confident', motif:'oval',   col:C(200,155,55),  brow:{h:1.15,halfW:.7,thick:.22,ang:.4,col:C(210,170,60)},  lid:[0,0,0], blush:0, mark:0},
    {id:'bored',     name:'Bored',     motif:'oval',   col:C(70,145,245),  brow:{h:1.05,halfW:.75,thick:.2,ang:-.15,col:C(90,140,220)}, lid:[0,0,.72], blush:0, mark:0},
    {id:'angry',     name:'Angry',     motif:'oval',   col:C(200,40,50),   brow:{h:1.1,halfW:.7,thick:.22,ang:-.55,col:C(200,45,55)},  lid:[0,.85,0], blush:0, mark:1},
    {id:'sleepy',    name:'Sleepy',    motif:'dot',    col:C(30,30,40),    brow:{h:1.35,halfW:.65,thick:.2,ang:.45,col:C(150,90,190)},  lid:[0,0,.92], blush:0, mark:0},
    {id:'smug',      name:'Smug',      motif:'oval',   col:C(40,185,40),   brow:{h:1.05,halfW:.7,thick:.2,ang:-.05,col:C(50,190,50)},  lid:[0,0,.7], blush:0, mark:0},
    {id:'furious',   name:'Furious',   motif:'dot',    col:C(20,15,20),    brow:{h:1.0,halfW:.75,thick:.24,ang:-.7,col:C(190,35,45)},  lid:[0,.95,.15], blush:0, mark:2},
    {id:'starry',    name:'Starry',    motif:'star',   col:C(235,130,55),  brow:{h:1.2,halfW:.7,thick:.22,ang:.4,col:C(235,140,60)},  lid:[0,0,0], blush:0, mark:0},
    {id:'pleading',  name:'Pleading',  motif:'flower', col:C(60,185,215),  brow:{h:1.2,halfW:.7,thick:.2,ang:.55,col:C(120,200,220)}, lid:[.9,0,0], blush:0, mark:0},
    {id:'love',      name:'Love-struck',motif:'heart', col:C(220,70,150),  brow:{h:1.05,halfW:.7,thick:.2,ang:.05,col:C(230,90,160)}, lid:[0,0,.65], blush:.55, mark:0},
    {id:'dizzy',     name:'Dizzy',     motif:'spiral', col:C(40,40,45),    brow:{h:1.3,halfW:.65,thick:.2,ang:.5,col:C(35,35,40)},   lid:[0,0,0], blush:0, mark:0},
    {id:'blush',     name:'Blushing',  motif:'dot',    col:C(40,35,40),    brow:{h:1.35,halfW:.65,thick:.2,ang:.5,col:C(230,130,160)}, lid:[0,0,0], blush:.9, mark:0}
  ].map(e=>({...e, sheet:'polly', key:`polly-${e.id}`, motifId:Motif[e.motif]}));

  const SHEETS=Object.freeze([
    Object.freeze({id:'polly', label:'Polly', credit:'Style after Polly Von Dominique', emotes:Object.freeze(POLLY)})
    // El_azushu + Designs land in later batches after Polly review
  ]);

  const BY_KEY=Object.create(null);
  SHEETS.forEach(s=>s.emotes.forEach(e=>{ BY_KEY[e.key]=e; }));

  window.AstridEmotes=Object.freeze({Motif,SHEETS,BY_KEY,isEmote:k=>!!BY_KEY[k],get:k=>BY_KEY[k]||null});
})();
