'use strict';
// Experimental scene graph damage invalidator. Source of truth is the actual
// Bézier path command stream, not known shape IDs or raster pixel inspection.
// Conservative bounds use the hull of ALL control points, expanded for stroke,
// raster AA, f32 rounding and closure. Supports nested translated groups.
const VERBS=Object.freeze({M:10,L:11,Q:12,C:13,Z:14});
const ARITY=Object.freeze({M:2,L:2,Q:4,C:6,Z:0});
const EPS=8; // deliberately conservative pixel fringe and f32 AA pad
const clone=scene=>JSON.parse(JSON.stringify(scene));
function assert(condition,message){if(!condition)throw Error(message)}
function validatePath(path){
 assert(Array.isArray(path)&&path.length>=2&&path.length<=100,'Invalid path length');
 assert(path[0][0]==='M','A path must begin with move');
 let coords=0;
 for(const seg of path){
  assert(Array.isArray(seg)&&Object.hasOwn(ARITY,seg[0])&&seg.length===ARITY[seg[0]]+1,'Malformed Bézier segment');
  for(let i=1;i<seg.length;i++)assert(Number.isFinite(seg[i])&&Math.abs(seg[i])<=1e6,'Invalid path coordinate');
  coords+=seg.length-1;
 }
 assert(coords>0,'Empty geometry');
}

const I=[1,0,0,1,0,0];
function validateMatrix(m){
 assert(Array.isArray(m)&&m.length===6&&m.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e5),
  'Invalid affine matrix');
}
function multiply(p,q){
 // Kurbo affine convention: [a,b,c,d,e,f], p*q applies q first.
 const [a,b,c,d,e,f]=p,[x,y,z,t,u,v]=q;
 return [a*x+c*y,b*x+d*y,a*z+c*t,b*z+d*t,a*u+c*v+e,b*u+d*v+f];
}
function translate(x,y){return [1,0,0,1,x,y];}
function rotation(angle){return [Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0];}
function scale(sx,sy){return [sx,0,0,sy,0,0];}
function around(cx,cy,angle,sx,sy){
 return multiply(multiply(multiply(translate(cx,cy),rotation(angle)),scale(sx,sy)),translate(-cx,-cy));
}
function validate(scene){
 assert(Array.isArray(scene)&&scene.length<=32,'Invalid scene root');
 const ids=new Set();let count=0;
 function visit(n,depth){
  assert(n&&Number.isSafeInteger(n.id)&&n.id>=0&&!ids.has(n.id),'Invalid or duplicate node ID');
  ids.add(n.id);count++;
  assert(count<=80&&depth<=8,'Excessive graph complexity');
  assert(n.type==='group'||n.type==='path','Invalid node type');
  validateMatrix(n.m);
  assert(Number.isFinite(n.opacity)&&n.opacity>=0&&n.opacity<=1,'Invalid node opacity');
  if(n.type==='group'){
   assert(Number.isInteger(n.blend)&&n.blend>=0&&n.blend<=3,'Invalid blend');
   if(n.clip!==null&&n.clip!==undefined)
    assert(Array.isArray(n.clip)&&n.clip.length===4&&n.clip.every(Number.isFinite)&&
      n.clip[0]<n.clip[2]&&n.clip[1]<n.clip[3],'Invalid group clip');
   assert(Array.isArray(n.children)&&n.children.length<=32,'Invalid child array');
   for(const child of n.children)visit(child,depth+1);
  }else{
   assert(Number.isInteger(n.color)&&n.color>=0&&n.color<=2,'Invalid color');
   assert(Number.isFinite(n.stroke)&&n.stroke>=0&&n.stroke<=120,'Invalid stroke');
   validatePath(n.path);
  }
 }
 for(const node of scene)visit(node,0);
 return scene;
}
function encode(scene){
 validate(scene);const stream=[];
 function visit(n){
  if(n.type==='group'){
   stream.push(1,n.id,...n.m,n.opacity,n.blend,n.clip?1:0,...(n.clip||[0,0,0,0]));
   for(const child of n.children)visit(child);
   stream.push(2);
  }else{
   stream.push(3,n.id,...n.m,n.opacity,n.color,n.stroke,n.path.length);
   for(const seg of n.path)stream.push(VERBS[seg[0]],...seg.slice(1));
  }
 }
 scene.forEach(visit);return stream;
}
function affineBounds(n,m,w,h){
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const seg of n.path)for(let i=1;i<seg.length;i+=2){
  const x=m[0]*seg[i]+m[2]*seg[i+1]+m[4];
  const y=m[1]*seg[i]+m[3]*seg[i+1]+m[5];
  x0=Math.min(x0,x);y0=Math.min(y0,y);
  x1=Math.max(x1,x);y1=Math.max(y1,y);
 }
 // Frobenius norm bounds the maximum singular value, and therefore
 // the expansion of the stroke radius under any finite affine map.
 const norm=Math.hypot(m[0],m[1],m[2],m[3]);
 const radius=(n.stroke/2)*norm+12;
 const left=Math.max(0,Math.floor(x0-radius));
 const top=Math.max(0,Math.floor(y0-radius));
 const right=Math.min(w,Math.ceil(x1+radius));
 const bottom=Math.min(h,Math.ceil(y1+radius));
 return right>left&&bottom>top?
  {x:left,y:top,w:right-left,h:bottom-top}:null;
}
function flatten(scene,w,h){
 validate(scene);
 assert(Number.isInteger(w)&&Number.isInteger(h)&&w>0&&h>0&&w<=4096&&h<=4096,
  'Invalid canvas size');
 const byId=new Map();let order=0;
 function visit(n,parent,ancestors){
  const world=multiply(parent,n.m);
  if(n.type==='group'){
   const sig=[n.id,n.m,n.opacity,n.blend,n.clip||null];
   for(const child of n.children)visit(child,world,[...ancestors,sig]);
  }else{
   byId.set(n.id,{id:n.id,bbox:affineBounds(n,world,w,h),
    signature:JSON.stringify([n.type,n.m,n.opacity,n.color,n.stroke,n.path,ancestors,order++])});
  }
 }
 for(const node of scene)visit(node,I,[]);
 return byId;
}
function merge(rectangles){
 // Inclusive adjacent rectangles are intentionally merged for safer clipped
 // alpha/coverage behavior and fewer copies during dirty repaint.
 const rs=rectangles.slice();let found=true;
 while(found){
  found=false;
  outer:for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){
   const a=rs[i],b=rs[j];
   if(a.x>a.x+a.w||b.y>b.y+b.h)throw Error('Corrupt damage rect');
   if(a.x>b.x+b.w||b.x>a.x+a.w||a.y>b.y+b.h||b.y>a.y+a.h)continue;
   const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
   rs[i]={x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,
    h:Math.max(a.y+a.h,b.y+b.h)-y};
   rs.splice(j,1);found=true;break outer;
  }
 }
 return rs.sort((a,b)=>a.y-b.y||a.x-b.x);
}
function estimate(previous,next,w,h){
 const a=flatten(previous,w,h),b=flatten(next,w,h);
 const rects=[],causes=[];
 for(const id of new Set([...a.keys(),...b.keys()])){
  const old=a.get(id),cur=b.get(id);
  if(old?.signature===cur?.signature)continue;
  if(old?.bbox)rects.push(old.bbox);
  if(cur?.bbox)rects.push(cur.bbox);
  causes.push({id,change:!old?'insert':!cur?'delete':'geometry-style-group-or-order'});
 }
 const damage=merge(rects);
 return {rects:damage,causes,area:damage.reduce((n,r)=>n+r.w*r.h,0),canvasArea:w*h};
}

function example(){
 const old=require('./path-group-damage.cjs').example();
 function convert(n){
  const matrix=translate(n.x,n.y);
  delete n.x;delete n.y;n.m=matrix;
  if(n.type==='group')n.children.forEach(convert);
 }
 const scenes=old.slice(0,-1).map(s=>{const c=clone(s);c.forEach(convert);return c;});
 function edit(fn){const n=clone(scenes.at(-1));fn(n);scenes.push(n);}
 // Keep the earlier source-driven lifecycle transitions, then add affine tests.
 edit(s=>{s[0].m=around(432,252,.29,1.16,1.16);});
 edit(s=>{s[0].m=around(432,252,-.23,.77,1.27);});
 edit(s=>{s[1].m=around(455,251,.49,1.12,.82);});
 edit(s=>{const p=s[0].children.find(n=>n.id===11);p.m=multiply(translate(-8.625,4.125),around(342,229,.34,1.12,.89));});
 // Nest path id 12 inside an independently transformed clip group 400.
 edit(s=>{const g=s[0],i=g.children.findIndex(n=>n.id===12);
   const p=g.children.splice(i,1)[0];
   g.children.push({id:400,type:'group',m:I.slice(),opacity:.83,blend:2,
    clip:[317.375,131.875,594.125,388.625],children:[p]});
 });
 edit(s=>{const inner=s[0].children.find(n=>n.id===400);
   inner.m=around(450,251,.39,.92,1.19);
 });
 edit(s=>{s[0].m=multiply(translate(12.375,-4.625),around(432,252,.61,1.33,.77));});
 edit(s=>{s[1].m=multiply(s[1].m,[1,.22,-.13,1,0,0]);});
 edit(s=>{s[0].children.reverse();s[0].opacity=.57;});
 edit(s=>{s.reverse();});
 edit(s=>{s[0].m=around(432,252,-.42,1.05,1.02);});
 edit(s=>{});
 return scenes;
}
module.exports={validate,encode,flatten,estimate,example,multiply,translate,rotation,scale,around,affineBounds};
