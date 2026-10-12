'use strict';
// Experiment-only conservative damage estimator derived solely from DRAW OPERATIONS.
// This module never reads rendered pixels, a screenshot or any reference frame.
// IDs are stable, ordered array positions express layer order, omission = deletion.
const shapes=Object.freeze({
  1:[455,100,655,275],
  2:[570,155,785,355],
  3:[160,240,392,457]
});
const pad=5;
function validate(state) {
 if(!Array.isArray(state))throw Error('Scene state must be an ordered array');
 const ids=new Set();
 for(const o of state){
  if(!o||!Number.isSafeInteger(o.id)||ids.has(o.id))throw Error('Duplicate or invalid drawing operation ID');
  ids.add(o.id);
  if(!shapes[o.kind]||![o.dx,o.dy,o.opacity,o.blend,o.clip].every(Number.isFinite)||
   o.opacity<0||o.opacity>1||!Number.isInteger(o.blend)||o.blend<0||o.blend>3||
   !Number.isInteger(o.clip)||o.clip<0||o.clip>1)throw Error('Invalid draw operation metadata');
 }
}
function encoded(state){
 validate(state);
 return state.flatMap(o=>[o.id,o.kind,o.dx,o.dy,o.opacity,o.blend,o.clip]);
}
function boundsFor(o,w,h){
 const b=shapes[o.kind];
 const left=Math.max(0,Math.floor(b[0]+o.dx-pad));
 const top=Math.max(0,Math.floor(b[1]+o.dy-pad));
 const right=Math.min(w,Math.ceil(b[2]+o.dx+pad));
 const bottom=Math.min(h,Math.ceil(b[3]+o.dy+pad));
 if(right<=left||bottom<=top)return null;
 return {x:left,y:top,w:right-left,h:bottom-top};
}
function union(a,b) {
 const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
 return {x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};
}
function intersects(a,b){
 return a.x<=b.x+b.w&&b.x<=a.x+a.w&&a.y<=b.y+b.h&&b.y<=a.y+a.h;
}
function merge(input){
 const pending=input.slice();
 let changed=true;
 while(changed){
  changed=false;
  outer: for(let i=0;i<pending.length;i++){
   for(let j=i+1;j<pending.length;j++){
    if(intersects(pending[i],pending[j])){
     pending[i]=union(pending[i],pending[j]);
     pending.splice(j,1);
     changed=true;break outer;
    }
   }
  }
 }
 return pending.sort((a,b)=>a.y-b.y||a.x-b.x);
}
function estimateDamage(previous,current,w,h){
 validate(previous);validate(current);
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<=0||h<=0)throw Error('Invalid canvas');
 const before=new Map(previous.map((o,i)=>[o.id,{op:o,index:i}]));
 const after=new Map(current.map((o,i)=>[o.id,{op:o,index:i}]));
 const rectangles=[],causes=[];
 for(const id of new Set([...before.keys(),...after.keys()])){
  const a=before.get(id),b=after.get(id);
  const changes=[];
  if(!a)changes.push('insert');
  else if(!b)changes.push('delete');
  else {
   if(a.op.kind!==b.op.kind)changes.push('replace');
   if(a.op.dx!==b.op.dx||a.op.dy!==b.op.dy)changes.push('move');
   if(a.op.opacity!==b.op.opacity)changes.push('opacity');
   if(a.op.blend!==b.op.blend)changes.push('blend');
   if(a.op.clip!==b.op.clip)changes.push('clip');
   if(a.index!==b.index)changes.push('reorder');
  }
  if(!changes.length)continue;
  // Every changed layer can influence the pixels of its previous and new
  // footprint; report all semantic changes, not only the first changed field.
  if(a){const r=boundsFor(a.op,w,h);if(r)rectangles.push(r);}
  if(b){const r=boundsFor(b.op,w,h);if(r)rectangles.push(r);}
  for(const cause of changes)causes.push({id,cause,wasPresent:!!a,isPresent:!!b,
   orderBefore:a?.index??-1,orderAfter:b?.index??-1});
 }
 const rects=merge(rectangles);
 return {rects,causes,damagePixels:rects.reduce((n,r)=>n+r.w*r.h,0),
  totalPixels:w*h};
}
const A=(dx=0,dy=0,opacity=.78,blend=0,clip=0)=>({id:10,kind:1,dx,dy,opacity,blend,clip});
const B=(dx=0,dy=0,opacity=.61,blend=1,clip=0)=>({id:20,kind:2,dx,dy,opacity,blend,clip});
const C=(dx=0,dy=0,opacity=.88,blend=0,clip=0)=>({id:30,kind:3,dx,dy,opacity,blend,clip});
const stages=[
 [A(),B(),C()],                                    // initial layer stack
 [A(15.375,-6.25),B(),C()],                        // move
 [A(15.375,-6.25),C()],                            // delete B
 [C(),A(15.375,-6.25),B(-11.25,4.75)],             // insert + reorder
 [C(-14.25,9.125),A(15.375,-6.25,.42),B(-11.25,4.75)], // distant move + opacity
 [C(-14.25,9.125),A(24.375,-10.625,.42),B(-11.25,4.75,.61,3,1)], // clip/blend/move
 [B(-11.25,4.75,.61,3,1),A(24.375,-10.625,.42)], // delete C + reorder
 [B(-11.25,4.75,.61,3,1),A(24.375,-10.625,.42)], // no-op
 [C(6.125,-9.375,.72,2,1),B(-11.25,4.75,.84,2),A(4.125,2.875,.68,0,1)] // insert, clip, opacity, reorder
];
module.exports={estimateDamage,encoded,stages,boundsFor};
