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
function validate(scene){
 assert(Array.isArray(scene)&&scene.length<=32,'Invalid root scene');
 const seen=new Set();let count=0;
 function visit(node,depth){
  assert(node&&Number.isSafeInteger(node.id)&&node.id>=0&&!seen.has(node.id),'Invalid/duplicate stable node ID');
  seen.add(node.id);count++;assert(count<=80&&depth<=8,'Excessive scene graph nesting');
  assert(['group','path'].includes(node.type),'Unexpected node type');
  assert(Number.isFinite(node.x)&&Number.isFinite(node.y)&&
   Math.abs(node.x)<=1e5&&Math.abs(node.y)<=1e5,'Invalid node translation');
  assert(Number.isFinite(node.opacity)&&node.opacity>=0&&node.opacity<=1,'Invalid opacity');
  if(node.type==='group'){
   assert(Number.isInteger(node.blend)&&node.blend>=0&&node.blend<=3,'Invalid blend mode');
   if(node.clip!==null&&node.clip!==undefined){
    assert(Array.isArray(node.clip)&&node.clip.length===4&&node.clip.every(Number.isFinite)&&
     node.clip[0]<node.clip[2]&&node.clip[1]<node.clip[3],'Invalid group clip');
   }
   assert(Array.isArray(node.children)&&node.children.length<=32,'Invalid group children');
   for(const child of node.children)visit(child,depth+1);
  } else {
   assert(Number.isInteger(node.color)&&node.color>=0&&node.color<=2,'Invalid color');
   assert(Number.isFinite(node.stroke)&&node.stroke>=0&&node.stroke<=120,'Invalid stroke');
   validatePath(node.path);
  }
 }
 for(const node of scene)visit(node,0);
 return scene;
}
function encode(scene){
 validate(scene);const tokens=[];
 function visit(n){
  if(n.type==='group'){
   const clip=n.clip||[0,0,0,0];
   tokens.push(1,n.id,n.x,n.y,n.opacity,n.blend,n.clip?1:0,...clip);
   for(const child of n.children)visit(child);
   tokens.push(2);
  }else{
   tokens.push(3,n.id,n.x,n.y,n.opacity,n.color,n.stroke,n.path.length);
   for(const seg of n.path)tokens.push(VERBS[seg[0]],...seg.slice(1));
  }
 }
 scene.forEach(visit);return tokens;
}
function controlBounds(n,x,y,w,h){
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const seg of n.path)for(let i=1;i<seg.length;i+=2){
  const px=seg[i]+x,py=seg[i+1]+y;
  x0=Math.min(x0,px);y0=Math.min(y0,py);
  x1=Math.max(x1,px);y1=Math.max(y1,py);
 }
 const extension=EPS+n.stroke/2;
 x0=Math.max(0,Math.floor(x0-extension));y0=Math.max(0,Math.floor(y0-extension));
 x1=Math.min(w,Math.ceil(x1+extension));y1=Math.min(h,Math.ceil(y1+extension));
 if(x1<=x0||y1<=y0)return null;
 return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}
function flatten(scene,w,h){
 validate(scene);
 assert(Number.isInteger(w)&&Number.isInteger(h)&&w>0&&h>0&&w<=4096&&h<=4096,'Invalid canvas');
 const byId=new Map();let order=0;
 function visit(n,dx,dy,ancestors){
  const x=dx+n.x,y=dy+n.y;
  if(n.type==='group'){
   // Ancestor signature changes whenever any group property or parent changes;
   // all descendants therefore receive old/new invalidation after group edits.
   const sig={id:n.id,x:n.x,y:n.y,opacity:n.opacity,blend:n.blend,clip:n.clip||null};
   for(const child of n.children)visit(child,x,y,[...ancestors,sig]);
  }else{
   const bbox=controlBounds(n,x,y,w,h);
   byId.set(n.id,{id:n.id,bbox,
    signature:JSON.stringify([n.type,n.x,n.y,n.opacity,n.color,n.stroke,n.path,ancestors,order++])});
  }
 }
 for(const n of scene)visit(n,0,0,[]);
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
 const a={id:11,type:'path',x:0,y:0,opacity:.88,color:1,stroke:0,path:[
  ['M',232.35,198.55],['C',207.125,119.625,418.25,108.35,449.875,208.625],
  ['C',509.25,337.75,300.125,371.875,232.35,198.55],['Z']]};
 const b={id:12,type:'path',x:0,y:0,opacity:.71,color:0,stroke:0,path:[
  ['M',369.125,245.875],['Q',426.5,128.375,547.625,212.375],
  ['C',625.125,307.25,436.375,380.75,369.125,245.875],['Z']]};
 const c={id:21,type:'path',x:0,y:0,opacity:.95,color:2,stroke:13.75,path:[
  ['M',196.875,313.625],['C',252.625,245.875,354.75,419.875,489.125,327.375]]};
 const d={id:31,type:'path',x:0,y:0,opacity:.63,color:1,stroke:7.125,path:[
  ['M',339.625,123.875],['Q',421.25,277.625,604.875,298.25]]};
 const group1={id:100,type:'group',x:0,y:0,opacity:.92,blend:0,clip:null,children:[a,b]};
 const group2={id:200,type:'group',x:0,y:0,opacity:.84,blend:1,
  clip:[152.125,113.375,634.625,423.875],children:[c,d]};
 const base=[group1,group2];
 const scenes=[clone(base)];
 function mutate(fn){const s=clone(scenes.at(-1));fn(s);scenes.push(s);}
 mutate(s=>{s[0].x=19.375;s[0].y=-8.625});              // move all group descendants
 mutate(s=>{s[0].opacity=.46});                        // opacity of entire group
 mutate(s=>{s[1].blend=3});                            // blend mode of group
 mutate(s=>{s.reverse()});                             // layer ordering of groups
 mutate(s=>{s[0].children.splice(1,1)});              // delete nested stroke
 mutate(s=>{s[0].children.push(clone(d))});           // restore
 mutate(s=>{const p=s[1].children[0].path;p[1][3]+=24.375;p[1][4]-=17.125}); // cubic control edit
 mutate(s=>{s[0].children[0].stroke=27.5});           // change rendered stroke width
 mutate(s=>{s[0].clip=[177.75,135.125,558.375,372.625]}); // change group clip
 mutate(s=>{s[1].children.reverse();s[1].opacity=.68}); // reorder children + opacity
 mutate(s=>{s.push({id:300,type:'group',x:-11.375,y:8.625,opacity:.55,blend:2,
   clip:null,children:[{id:41,type:'path',x:0,y:0,opacity:.86,color:0,stroke:0,path:[
    ['M',390.625,190.125],['C',422.375,157.875,572.125,213.625,548.875,326.375],
    ['Q',406.125,339.625,390.625,190.125],['Z']]}]})}); // insert group
 mutate(s=>{s.splice(0,1)});                           // delete whole group
 mutate(s=>{});                                       // no-op
 return scenes;
}
module.exports={validate,encode,flatten,estimate,example};
