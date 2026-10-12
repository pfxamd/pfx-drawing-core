'use strict';
// Conservative affine-stroke/effect invalidation from the operation arguments.
// NEVER reads rendered pixels or reference frames to choose dirty rectangles.
const {multiply,translate,around}=require('./affine-group-damage.cjs');
const center=[515,256];
const make=(angle,sx,sy,dx=0,dy=0)=>multiply(translate(dx,dy),around(center[0],center[1],angle,sx,sy));
const states=[
 {mode:0,m:make(0,1,1),shift:0,width:22},
 {mode:0,m:make(.06,1,.002),shift:6.375,width:22}, // near-singular
 {mode:0,m:make(-.43,1.8,.006),shift:12.625,width:31}, // high anisotropy
 {mode:0,m:make(.81,.09,1.4),shift:9.375,width:44}, // very narrow
 {mode:0,m:make(.81,.09,1.4),shift:22.875,width:47}, // moving giant miter
 {mode:1,m:make(.13,1,.78),shift:22.875,width:47}, // global alpha mask
 {mode:1,m:make(.42,1.2,.43),shift:11.375,width:27},
 {mode:1,m:make(.42,1.2,.43),shift:32.625,width:28}, // mask moved
 {mode:2,m:make(.12,1.03,.87),shift:32.625,width:28}, // Gaussian blur
 {mode:2,m:make(-.17,1.15,.91),shift:5.375,width:29}, // blurred move
 {mode:3,m:make(-.17,1.15,.91),shift:14.125,width:29}, // filtered & masked
 {mode:3,m:make(.23,.92,1.07),shift:-9.375,width:39},
 {mode:0,m:make(.54,1.55,.91),shift:3.375,width:39},
 {mode:0,m:make(.54,1.55,.91),shift:3.375,width:39} // no-op
];
const coordinates=[
 [421.125,250.375],[517.625,258.125],[441.375,266.625],[632.125,289.625],
 [444.875,215.625],[475.625,161.125],[608.375,183.875],[622.125,259.625],
 [544.375,319.125]
];
function validate(s){
 if(!s||!Number.isInteger(s.mode)||s.mode<0||s.mode>3
 ||!Array.isArray(s.m)||s.m.length!==6||!s.m.every(Number.isFinite)
 ||s.m.some(x=>Math.abs(x)>1e6)||!Number.isFinite(s.shift)
 ||!Number.isFinite(s.width)||s.width<=0||s.width>100)throw Error('Invalid boundary stress state');
}
function rect(s,w,h){
 validate(s);
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 const [a,b,c,d,e,f]=s.m;
 for(const [x,y] of coordinates){
  const xx=a*(x+s.shift)+c*y+e,yy=b*(x+s.shift)+d*y+f;
  minX=Math.min(minX,xx);maxX=Math.max(maxX,xx);
  minY=Math.min(minY,yy);maxY=Math.max(maxY,yy);
 }
 const norm=Math.hypot(a,b,c,d);
 // Actual miter limit is 12. At sharp joins the stroke extends beyond the
 // centerline convex hull, so half-width * miter limit * ||M||_F bounds
 // both path stroke joins and caps conservatively.
 const miterExtension=s.width/2*12*norm;
 const pad=Math.max(20,miterExtension+20);
 const x=Math.max(0,Math.floor(minX-pad)),y=Math.max(0,Math.floor(minY-pad));
 const endX=Math.min(w,Math.ceil(maxX+pad)),endY=Math.min(h,Math.ceil(maxY+pad));
 return endX>x&&endY>y?{x,y,w:endX-x,h:endY-y}:null;
}
function union(a,b){
 if(!a)return b;if(!b)return a;
 const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
 return {x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};
}
function estimate(a,b,w,h){
 validate(a);validate(b);
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<=0||h<=0)throw Error('Invalid canvas');
 if(JSON.stringify(a)===JSON.stringify(b))return {rects:[],reason:'unchanged',area:0,fullFallback:false};
 const fragile=s=>{
  const [a0,b0,c0,d0]=s.m;
  return Math.abs(a0*d0-b0*c0)<0.02;
 };
 if(a.mode!==0||b.mode!==0||fragile(a)||fragile(b)){
  // Falsification in real Chromium found 1/255 divergences in subdivided
  // near-singular and isolated alpha-mask raster targets. Blur requires its
  // off-tile halo, too. Full invalidation prevents unproven dirty-tile paths
  // from leaking stale or numerically divergent pixels.
  const reason=a.mode>=2||b.mode>=2?'blur-filter-full-frame-fallback':
   a.mode===1||b.mode===1?'alpha-mask-full-frame-fallback':
   'near-singular-miter-full-frame-fallback';
  return {rects:[{x:0,y:0,w,h}],reason,area:w*h,fullFallback:true};
 }
 const area=union(rect(a,w,h),rect(b,w,h));
 return {rects:area?[area]:[],reason:a.mode===1||b.mode===1?'alpha-mask':'miter-affine-stroke',
  area:area?area.w*area.h:0,fullFallback:false};
}
module.exports={states,estimate,validate,rect,make};
