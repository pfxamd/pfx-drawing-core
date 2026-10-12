'use strict';
// Real Chromium + source-built pinned Vello CPU.
// Damage is decided solely by arguments, never from reference pixels.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
const {states,estimate,rect,validate}=require('./boundary-effect-damage.cjs');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Paths required');
const root=path.resolve(process.env.PFX_WEBROOT),out=path.resolve(process.env.PFX_PROOF_DIR);
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
 let file;
 try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
 catch{res.writeHead(400);return res.end();}
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));}
 catch(e){res.writeHead(404);res.end(String(e));}
});
const canvases=[{w:640,h:400},{w:800,h:500},{w:1024,h:640}];
function planFor(canvas){
 const result=[];
 for(let i=1;i<states.length;i++)result.push(estimate(states[i-1],states[i],canvas.w,canvas.h));
 if(result.at(-1).rects.length)throw Error('No-op causes repaint');
 if(result.some((p,i)=>i>=8&&i<=11&&!p.fullFallback))throw Error('Blur needs explicit full fallback');
 if(!result.some(p=>p.area>0&&p.area<canvas.w*canvas.h))throw Error('Never paints partial');
 return result;
}
function pieces(r,layout){
 if(layout==='whole')return [r];
 const mx=r.x+Math.floor(r.w/2),my=r.y+Math.floor(r.h/2);
 const xs=[[r.x,Math.min(r.x+r.w,mx+5)],[Math.max(r.x,mx-5),r.x+r.w]];
 const ys=[[r.y,Math.min(r.y+r.h,my+5)],[Math.max(r.y,my-5),r.y+r.h]];
 return ys.flatMap(([y0,y1])=>xs.map(([x0,x1])=>({x:x0,y:y0,w:x1-x0,h:y1-y0})));
}
function checkInputs(){
 const a=states[1];
 const s={...a,m:[Infinity,0,0,1,0,0]};
 let rejected=false;
 try{validate(s);}catch{rejected=true;}
 if(!rejected)throw Error('Nonfinite transform accepted');
 if(rect(states[2],800,500)===null)throw Error('Anisotropic miter geometry ignored');
}
checkInputs();
async function run(browser,origin,canvas,round){
 const pageContext=await browser.newContext({viewport:{width:1150,height:700},deviceScaleFactor:1});
 const page=await pageContext.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url())});
 await page.route('**/*',route=>{
  const u=route.request().url();
  if(u.startsWith('http')&&new URL(u).origin!==origin){external.push(u);return route.abort();}
  return route.continue();
 });
 const plans=planFor(canvas),layouts=round===1?['whole','overlap4']:['overlap4','whole'];
 const safePlans=plans.map(p=>({
  ...p,layouts:Object.fromEntries(layouts.map(k=>[k,p.rects.flatMap(r=>pieces(r,k))]))
 }));
 const filename='r'+round+'-'+canvas.w+'x'+canvas.h;
 let report;
 try{
  await page.goto(origin+'/aa-precision.html',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:120000});
  report=await page.evaluate(({canvas,states,plans,layouts,round})=>{
   const api=window.PFX_AA;if(!api.ready||typeof api.boundaryEffect!=='function')throw Error('WASM missing '+api.error);
   const {w,h}=canvas,base={x:0,y:0,w,h};
   const render=(state,r,canonical,safe)=>{
    const v=api.boundaryEffect(w,h,r.x,r.y,r.w,r.h,
      new Float64Array(state.m),state.mode,state.shift,state.width,canonical,safe);
    if(v.length!==r.w*r.h*4)throw Error('Bad rgba length '+v.length+' expected '+r.w*r.h*4);
    return v;
   };
   const fulls=states.map(s=>render(s,base,false,false));
   let fullChanged=0,painted=0;
   for(let i=0;i<states.length;i++){
    const alt=render(states[i],base,true,false);
    for(let k=0;k<alt.length;k++)if(alt[k]!==fulls[i][k])fullChanged++;
    for(let k=3;k<alt.length;k+=4)if(alt[k])painted++;
   }
   function compare(full,tile,r,samples){
    let channels=0,pixels=0,maxDelta=0;
    for(let y=0;y<r.h;y++){
     let row=(r.y+y)*w+r.x;
     for(let x=0;x<r.w;x++){
      let found=false;
      for(let k=0;k<4;k++){
       const a=full[(row+x)*4+k],b=tile[(y*r.w+x)*4+k];
       const d=Math.abs(a-b);if(!d)continue;
       channels++;found=true;maxDelta=Math.max(maxDelta,d);
       if(samples.length<5)samples.push({x:r.x+x,y:r.y+y,k,a,b,delta:d});
      }
      if(found)pixels++;
     }
    }
    return {channels,pixels,maxDelta};
   }
   const paste=(cache,tile,r)=>{
    for(let y=0;y<r.h;y++){
     const start=y*r.w*4;
     cache.set(tile.subarray(start,start+r.w*4),((r.y+y)*w+r.x)*4);
    }
   };
   const contains=(rects,x,y)=>rects.some(r=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h);
   const caches=Object.fromEntries(layouts.map(k=>[k,new Uint8Array(fulls[0])]));
   const transitions=[];let totalMissed=0,totalCanonical=0,totalLegacy=0,
    totalCacheDifferences=0,totalChanged=0,tileCalls=0,wholeFallbackCalls=0;
   for(let i=1;i<states.length;i++){
    const p=plans[i-1],s=states[i],prev=fulls[i-1],ref=fulls[i];
    let trueChanged=0,missed=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
     const k=(y*w+x)*4;
     if(prev[k]===ref[k]&&prev[k+1]===ref[k+1]&&prev[k+2]===ref[k+2]&&prev[k+3]===ref[k+3])continue;
     trueChanged++;
     if(!contains(p.rects,x,y))missed++;
    }
    totalChanged+=trueChanged;totalMissed+=missed;
    const parts=[];
    for(const layout of layouts){
     let legacy=0,canonical=0,rendered=0;
     for(const r of p.layouts[layout]){
      const b=render(s,r,true,true),old=render(s,r,false,true);
      // The reference is the FULL canvas; compare() uses its full stride.
      // A cropped reference cannot be passed with the full-scene stride.
      const samples=[];
      canonical+=compare(ref,b,r,samples).channels;
      legacy+=compare(ref,old,r,[]).channels;
      paste(caches[layout],b,r);
      rendered++;tileCalls++;
      if(s.mode>=2&&(r.x||r.y||r.w!==w||r.h!==h))wholeFallbackCalls++;
     }
     const diff=compare(ref,caches[layout],base,[]);
     totalCacheDifferences+=diff.channels;totalLegacy+=legacy;totalCanonical+=canonical;
     parts.push({layout,rendered,legacy,canonical,cache:diff});
    }
    transitions.push({index:i,mode:s.mode,reason:p.reason,trueChanged,missed,
      damageArea:p.area,fullFallback:p.fullFallback,parts});
   }
   // Demonstrate whether raw partial filtering with missing source halo is
   // intrinsically byte-exact; never gate correctness on that unsupported path.
   const probes=[];
   const probe={x:Math.min(352,w-260),y:Math.min(108,h-180),w:220,h:170};
   for(const mode of [0,1,2,3]){
    const state=states.find(s=>s.mode===mode);
    const full=render(state,base,false,false);
    const native=render(state,probe,true,false);
    const safe=render(state,probe,true,true);
    probes.push({mode,region:probe,
     nativeDifferences:compare(full,native,probe,[]),
     safeDifferences:compare(full,safe,probe,[])});
   }
   return {canvas,round,totalMissed,totalCanonical,totalLegacy,
     totalCacheDifferences,totalChanged,tileCalls,wholeFallbackCalls,
     fullChanged,painted,transitions,probes};
  },{canvas,states,plans:safePlans,layouts,round});
  if(round===1&&canvas.w===800){
   await page.evaluate(({state})=>{
    const img=window.PFX_AA.boundaryEffect(800,500,0,0,800,500,
      new Float64Array(state.m),state.mode,state.shift,state.width,true,true);
    const el=document.getElementById('output');
    el.width=800;el.height=500;
    el.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img),800,500),0,0);
   },{state:states[10]});
   await page.screenshot({path:path.join(out,'mask-and-blur-fullframe-800.png')});
  }
  const failures=[];
  if(report.fullChanged!==0)failures.push('Full-frame canonical differs from baseline');
  if(report.totalMissed!==0)failures.push('Geometry/effect damage missed actual pixels');
  if(report.totalCanonical!==0)failures.push('Canonical partial tiles not byte exact');
  if(report.totalCacheDifferences!==0)failures.push('Persistent repaint cache mismatch');
  if(report.totalChanged<50||report.painted<100)failures.push('Stress scene not exercised');
  if(report.probes.some(p=>p.safeDifferences.channels!==0))failures.push('Fallback masked/filter ROI is not exact');
  if(report.wholeFallbackCalls<1)failures.push('No full-filter fallback exercised');
  if(errors.length||external.length)failures.push('Unexpected network/browser errors');
  report.status=failures.length?'FAIL':'PASS';report.failures=failures;
  report.errors=errors;report.external=external;
  writeFileSync(path.join(out,filename+'.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(report.status+' '+filename+' transitions='+report.transitions.length+
   ' misses='+report.totalMissed+' canonical='+report.totalCanonical+
   ' cache='+report.totalCacheDifferences+' blurFallbacks='+report.wholeFallbackCalls+'\n');
  return report;
 }catch(e){
  writeFileSync(path.join(out,filename+'-error.json'),JSON.stringify({error:String(e),report,errors,external},null,2)+'\n');
  process.stderr.write('ERROR '+filename+' '+String(e)+'\n');
  return {status:'FAIL',error:String(e),canvas,round};
 }finally{await pageContext.close();}
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox',
   '--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const runs=[];
  for(let round=1;round<=2;round++)
   for(const c of round===1?canvases:[...canvases].reverse())
    runs.push(await run(browser,origin,c,round));
  const summary={status:runs.every(r=>r.status==='PASS')?'PASS':'FAIL',
   runs:runs.map(r=>({canvas:r.canvas,round:r.round,status:r.status,failures:r.failures,
    error:r.error,transitions:r.transitions?.length,
    misses:r.totalMissed,canonical:r.totalCanonical,cache:r.totalCacheDifferences,
    changed:r.totalChanged,tiles:r.tileCalls,blurFallbacks:r.wholeFallbackCalls,
    nativeProbes:r.probes})),
   limitations:[
    'Near-singular scales, anisotropic affine transforms, explicit miter joins (limit 12), global alpha mask and Vello CPU Gaussian blur.',
    'Filtered damage intentionally triggers conservative full-frame invalidation; safe cropped requests render full then crop, so NOT a partial-render acceleration.',
    'Actual Vello filter API is documented as incomplete/experimental; only single-threaded source-built CPU WASM.',
    'Mask generated from global coordinates and local mask pixel span. Full-frame references are checked only AFTER command-derived damage planning.',
    'No text, image paints, native GPU, true filter-halo incremental raster, mixed hardware composition or main merge.'
   ]};
  writeFileSync(path.join(out,'boundary-effect-summary.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write('SUMMARY '+summary.status+' transitions='+runs.reduce((a,r)=>a+(r.transitions?.length||0),0)+'\n');
  if(summary.status!=='PASS')process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
