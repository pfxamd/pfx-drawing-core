'use strict';
// Isolate 4x4 strip AA grid-phase effects while retaining exact global f32 flattening.
// Test includes both known 1/255 pixel failures and genuine blurred Vello layers.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {mkdirSync,readFileSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const {states,rect}=require('./boundary-effect-damage.cjs');
const root=path.resolve(process.env.PFX_WEBROOT||'.'),out=path.resolve(process.env.PFX_PROOF_DIR||'.');
mkdirSync(out,{recursive:true});
const server=createServer((req,res)=>{
 let f;try{f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
 catch{res.writeHead(400);return res.end();}
 if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{res.writeHead(200,{'Content-Type':f.endsWith('.wasm')?'application/wasm':f.endsWith('.js')?'application/javascript':'text/html'});res.end(readFileSync(f))}
 catch(e){res.writeHead(404);res.end(String(e));}
});
const canvasList=[{w:640,h:400},{w:800,h:500},{w:1024,h:640}];
const indexes=[2,6,8,10];
const variants=[{grid:1,pad:0},{grid:2,pad:0},{grid:4,pad:0},{grid:8,pad:0},{grid:16,pad:0},
 {grid:4,pad:4},{grid:4,pad:16},{grid:8,pad:16},{grid:16,pad:16},
 {grid:4,pad:32},{grid:8,pad:32},{grid:16,pad:32},{grid:4,pad:64}];
const originals=[];
function union(a,b){if(!a)return b;if(!b)return a;let x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};}
function split(r){
 const mx=r.x+Math.floor(r.w/2),my=r.y+Math.floor(r.h/2);
 return [[r.y,Math.min(r.y+r.h,my+5)],[Math.max(r.y,my-5),r.y+r.h]].flatMap(([y0,y1])=>
 [[r.x,Math.min(r.x+r.w,mx+5)],[Math.max(r.x,mx-5),r.x+r.w]].map(([x0,x1])=>({x:x0,y:y0,w:x1-x0,h:y1-y0})));
}
function regions(canvas,i){
 const r=union(rect(states[i-1],canvas.w,canvas.h),rect(states[i],canvas.w,canvas.h));
 const generated=r?split(r).map(t=>({...t,kind:'pre-fallback-split'})):[];
 return [...generated,
  {x:397,y:165,w:125,h:115,kind:'arbitrary'},
  {x:469,y:202,w:118,h:98,kind:'arbitrary'}].filter(r=>r.x+r.w<=canvas.w&&r.y+r.h<=canvas.h&&r.w>0&&r.h>0);
}
async function run(browser,base,canvas,round){
 const context=await browser.newContext({viewport:{width:1120,height:750}});
 const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>{
  const u=route.request().url();
  if(u.startsWith('http')&&new URL(u).origin!==base){errors.push('external '+u);return route.abort();}
  return route.continue();
 });
 const filename='phase'+round+'-'+canvas.w+'x'+canvas.h;
 let result;
 try{
  await page.goto(base+'/aa-precision.html');
  await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:30000});
  const tasks=(round===1?indexes:[...indexes].reverse()).map(index=>({index,state:states[index],regions:regions(canvas,index)}));
  result=await page.evaluate(({canvas,tasks,variants})=>{
   const {w,h}=canvas;
   const render=(s,r,canonical)=>{
    const bytes=window.PFX_AA.boundaryEffect(w,h,r.x,r.y,r.w,r.h,new Float64Array(s.m),
     s.mode,s.shift,s.width,canonical,false);
    if(bytes.length!==r.w*r.h*4)throw Error('Unexpected renderer output');
    return bytes;
   };
   function source(r,v){
    const grid=v.grid,pad=v.pad;
    const x=Math.max(0,Math.floor((r.x-pad)/grid)*grid);
    const y=Math.max(0,Math.floor((r.y-pad)/grid)*grid);
    const endX=Math.min(w,Math.ceil((r.x+r.w+pad)/grid)*grid);
    const endY=Math.min(h,Math.ceil((r.y+r.h+pad)/grid)*grid);
    return {x,y,w:endX-x,h:endY-y};
   }
   function diff(ref,bytes,src,roi){
    let channels=0,maxDelta=0;const samples=[];
    for(let py=roi.y;py<roi.y+roi.h;py++)
     for(let px=roi.x;px<roi.x+roi.w;px++)
      for(let ch=0;ch<4;ch++){
       const a=ref[(py*w+px)*4+ch];
       const b=bytes[((py-src.y)*src.w+px-src.x)*4+ch];
       const d=Math.abs(a-b);
       if(d){channels++;maxDelta=Math.max(d,maxDelta);
        if(samples.length<3)samples.push({x:px,y:py,ch,a,b,d});
       }
      }
    return {channels,maxDelta,samples};
   }
   const full={x:0,y:0,w,h},results=[];
   for(const t of tasks){
    const truth=render(t.state,full,false);
    const canon=render(t.state,full,true);
    let changedFull=0;for(let i=0;i<truth.length;i++)if(truth[i]!==canon[i])changedFull++;
    const rois=t.regions.map(roi=>{
      const attempts=variants.map(v=>{
       const src=source(roi,v);
       const bytes=render(t.state,src,true);
       return {...v,src,...diff(truth,bytes,src,roi)};
      });
      return {roi,attempts};
    });
    results.push({index:t.index,mode:t.state.mode,changedFull,rois});
   }
   return {canvas,results};
  },{canvas,tasks,variants});
  // The value of diagnostics is measured results, including failure.
  if(errors.length)throw Error('Page errors '+errors.join('; '));
  const oldMismatch=result.results.reduce((n,r)=>n+r.rois.reduce((m,t)=>m+t.attempts[0].channels,0),0);
  const fourGridCorrection=result.results.reduce((n,r)=>n+r.rois.filter(t=>t.attempts[0].channels>0&&t.attempts[2].channels===0).length,0);
  const stillWrong4=result.results.reduce((n,r)=>n+r.rois.filter(t=>t.attempts[2].channels>0).length,0);
  const anyExactNonFull=result.results.some(r=>r.rois.some(t=>t.attempts.some(a=>a.channels===0&&(a.src.w*a.src.h)<canvas.w*canvas.h)));
  result.oldMismatch=oldMismatch;result.fourGridCorrection=fourGridCorrection;result.stillWrong4=stillWrong4;
  result.status=oldMismatch>0&&anyExactNonFull&&result.results.every(r=>r.changedFull===0)?'PASS':'FAIL';
  writeFileSync(path.join(out,filename+'.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(result.status+' '+filename+' baseline='+oldMismatch+' correctedByGrid4='+fourGridCorrection+' persistsGrid4='+stillWrong4+'\n');
  return {status:result.status,canvas,round,baseline:oldMismatch,grid4:fourGridCorrection,persists:stillWrong4};
 }catch(e){
  writeFileSync(path.join(out,filename+'-error.json'),JSON.stringify({error:String(e),errors,result},null,2)+'\n');
  process.stderr.write('ERROR '+filename+' '+String(e)+'\n');return {status:'FAIL',error:String(e),canvas,round};
 }finally{await context.close();}
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader']});
 try{
  const runs=[];for(let round=1;round<=2;round++)
   for(const c of round===1?canvasList:[...canvasList].reverse())runs.push(await run(browser,base,c,round));
  const summary={status:runs.every(x=>x.status==='PASS')?'PASS':'FAIL',runs,
   note:'Grid phase and halo hypotheses; no production generalization without comprehensive unsafe ROI proof.'};
  writeFileSync(path.join(out,'grid-phase-summary.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write('SUMMARY '+summary.status+' replicatedNativeDiff='+runs.reduce((a,r)=>a+(r.baseline||0),0)+
   ' grid4Fixes='+runs.reduce((a,r)=>a+(r.grid4||0),0)+'\n');
  if(summary.status!=='PASS')process.exitCode=1;
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
