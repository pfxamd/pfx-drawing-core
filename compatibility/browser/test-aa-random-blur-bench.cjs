'use strict';
// Deterministic adversarial property probes + isolated WASM-only CPU timings.
// Full-frame oracle is used only AFTER ROI/halo proposals are fixed.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {mkdirSync,readFileSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const {make}=require('./boundary-effect-damage.cjs');
const root=path.resolve(process.env.PFX_WEBROOT||'.');
const out=path.resolve(process.env.PFX_PROOF_DIR||'.');
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
 let f;
 try{f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
 catch{res.writeHead(400);return res.end();}
 if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{const data=readFileSync(f);res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});res.end(data);}
 catch(e){res.writeHead(404);res.end(String(e));}
});
const sizes=[{w:640,h:400},{w:800,h:500},{w:1024,h:640}];
const radii=[0,2,5.25,8,12,20];
const halos=[0,16,32,64,96];
const seed=0x70de2026;
function generator(initial){let state=initial>>>0;return ()=>{
 state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;
};}
function samples(canvas){
 const r=generator(seed^canvas.w^canvas.h),out=[];
 for(let i=0;i<36;i++){
  const radius=radii[i%radii.length],mask=i%4>=2;
  const angle=(r()-.5)*1.3;
  let sx=.4+r()*1.55,sy=.3+r()*1.45;
  if(i%9===2)sy=.004+r()*.01;
  const dx=(r()-.5)*28,dy=(r()-.5)*24;
  const shape={m:make(angle,sx,sy,dx,dy),mode:mask?3:2,
   shift:(r()-.5)*35,width:10+r()*42,radius,ordinal:i};
  const x=Math.min(canvas.w-170,340+Math.floor(r()*175));
  const y=Math.min(canvas.h-150,90+Math.floor(r()*125));
  shape.rois=[
   {x,y,w:130,h:110},
   {x:Math.min(canvas.w-130,420+(i%6)*19),y:Math.min(canvas.h-110,170+(i%5)*18),w:115,h:98}
  ];
  out.push(shape);
 }
 return out;
}
async function check(browser,base,canvas,round){
 const ctx=await browser.newContext({viewport:{width:1100,height:800},deviceScaleFactor:1});
 const page=await ctx.newPage(),errors=[],outside=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url())});
 await page.route('**/*',route=>{
  const u=route.request().url();
  if(u.startsWith('http')&&new URL(u).origin!==base){outside.push(u);return route.abort();}
  return route.continue();
 });
 const filename='random-'+round+'-'+canvas.w+'x'+canvas.h;
 let data;
 try{
  await page.goto(base+'/aa-precision.html',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:90000});
  const tests=samples(canvas);if(round===2)tests.reverse();
  data=await page.evaluate(({canvas,tests,halos})=>{
   const {w,h}=canvas,api=window.PFX_AA,full={x:0,y:0,w,h};
   if(!api.ready||typeof api.boundaryRadius!=='function')throw Error('Missing source-built variable-blur export '+api.error);
   const render=(s,r)=>{
    const v=api.boundaryRadius(w,h,r.x,r.y,r.w,r.h,new Float64Array(s.m),
       s.mode,s.shift,s.width,s.radius,true,false);
    if(v.length!==r.w*r.h*4)throw Error('Unexpected WASM pixel byte count');
    return v;
   };
   const expanded=(r,p)=>{
    const x=Math.max(0,Math.floor((r.x-p)/4)*4);
    const y=Math.max(0,Math.floor((r.y-p)/4)*4);
    const xx=Math.min(w,Math.ceil((r.x+r.w+p)/4)*4);
    const yy=Math.min(h,Math.ceil((r.y+r.h+p)/4)*4);
    return {x,y,w:xx-x,h:yy-y};
   };
   const compare=(fullRGBA,srcRGBA,r,src)=>{
    let channels=0,maxDelta=0;const samples=[];
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
     const ref=((r.y+y)*w+r.x+x)*4;
     const local=((r.y+y-src.y)*src.w+r.x+x-src.x)*4;
     for(let ch=0;ch<4;ch++){
      const a=fullRGBA[ref+ch],b=srcRGBA[local+ch],d=Math.abs(a-b);
      if(!d)continue;
      channels++;maxDelta=Math.max(d,maxDelta);
      if(samples.length<3)samples.push({x:r.x+x,y:r.y+y,ch,a,b,delta:d});
     }
    }
    return {channels,maxDelta,samples};
   };
   const summaries=[];let nonWhiteROI=0,fullCanonicalChanges=0;
   const modeTiming=[];
   const time=()=>performance.now();
   function median(a){return [...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];}
   for(const s of tests){
    const reference=render(s,full);
    // Also verify canonical full == original full for every case.
    const original=api.boundaryRadius(w,h,0,0,w,h,new Float64Array(s.m),
      s.mode,s.shift,s.width,s.radius,false,false);
    for(let q=0;q<reference.length;q++)if(reference[q]!==original[q])fullCanonicalChanges++;
    const results=[];
    for(const roi of s.rois){
      let signal=0;
      for(let y=roi.y;y<roi.y+roi.h;y++)for(let x=roi.x;x<roi.x+roi.w;x++){
        const k=(y*w+x)*4;
        if(reference[k]!==255||reference[k+1]!==255||reference[k+2]!==255)signal++;
      }
      if(signal>20)nonWhiteROI++;
      const attempts=[];
      for(const halo of halos){
       const src=expanded(roi,halo),tiled=render(s,src);
       const diff=compare(reference,tiled,roi,src);
       attempts.push({halo,srcArea:src.w*src.h,fullSource:src.w===w&&src.h===h,
         channels:diff.channels,maxDelta:diff.maxDelta,samples:diff.samples});
      }
      results.push({roi,signal,attempts,
       firstExactHalo:attempts.find(x=>x.channels===0)?.halo??null});
    }
    // Timings measure whole WASM call and typed-array output, not browser UI,
    // screen presentation, GPU upload or real editor scheduling.
    if(canvas.w===800&&[0,1,2,3,4,5].includes(s.ordinal)){
     const roi=s.rois[0],src=expanded(roi,32),fullMs=[],roiMs=[],runs=18;
     for(let k=0;k<4;k++){render(s,src);render(s,full);}
     for(let k=0;k<runs;k++){
      if(k%2===0){let t=time();render(s,full);fullMs.push(time()-t);t=time();render(s,src);roiMs.push(time()-t);}
      else {let t=time();render(s,src);roiMs.push(time()-t);t=time();render(s,full);fullMs.push(time()-t);}
     }
     modeTiming.push({ordinal:s.ordinal,radius:s.radius,mask:s.mode===3,
      sourceArea:src.w*src.h,fullArea:w*h,fullMedianMs:median(fullMs),
      paddedSourceMedianMs:median(roiMs),fullRuns:runs,roiRuns:runs,
      roi32Exact:results[0].attempts[2].channels===0});
    }
    summaries.push({ordinal:s.ordinal,mode:s.mode,radius:s.radius,
     sxSyApprox:[Math.hypot(s.m[0],s.m[1]),Math.hypot(s.m[2],s.m[3])],
     results});
   }
   return {canvas,summaries,modeTiming,nonWhiteROI,fullCanonicalChanges};
  },{canvas,tests,halos});
  const failures=[];
  if(data.fullCanonicalChanges!==0)failures.push('Full-frame canonical vs original changed');
  if(data.nonWhiteROI<10)failures.push('Insufficient actual nonwhite ROI coverage');
  if(errors.length||outside.length)failures.push('Browser errors/external requests');
  data.status=failures.length?'FAIL':'PASS';
  data.failures=failures;data.errors=errors;data.external=outside;
  writeFileSync(path.join(out,filename+'.json'),JSON.stringify(data,null,2)+'\n');
  const all=data.summaries.flatMap(s=>s.results),counts=halos.map((p,i)=>({
   halo:p,failed:all.filter(r=>r.attempts[i].channels>0).length,
   fullSource:all.filter(r=>r.attempts[i].fullSource).length
  }));
  process.stdout.write(data.status+' '+filename+' cases='+data.summaries.length+
   ' regions='+all.length+' '+JSON.stringify(counts)+'\n');
  return {status:data.status,canvas,round,totalStates:data.summaries.length,
   totalROIs:all.length,signal:data.nonWhiteROI,fullCanonicalChanges:data.fullCanonicalChanges,
   failures,haloCounts:counts,
   byRadius:radii.map(radius=>({radius,byHalo:halos.map((halo,i)=>({
    halo,failed:data.summaries.filter(s=>s.radius===radius).flatMap(s=>s.results)
      .filter(r=>r.attempts[i].channels!==0).length}))})),
   timings:data.modeTiming,examples:data.summaries.flatMap(s=>s.results.map(r=>
    ({ordinal:s.ordinal,radius:s.radius,mask:s.mode===3,roi:r.roi,
      firstExactHalo:r.firstExactHalo,channelsAt32:r.attempts[2].channels})))
    .filter(x=>x.channelsAt32>0).slice(0,6)};
 }catch(e){
  writeFileSync(path.join(out,filename+'-error.json'),JSON.stringify({error:String(e),errors,outside},null,2)+'\n');
  process.stderr.write('ERROR '+filename+' '+String(e)+'\n');
  return {status:'FAIL',canvas,round,error:String(e)};
 }finally{await ctx.close();}
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox',
   '--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const outputs=[];
  for(let round=1;round<=2;round++)for(const canvas of round===1?sizes:[...sizes].reverse())
   outputs.push(await check(browser,base,canvas,round));
  const summary={status:outputs.every(r=>r.status==='PASS')?'PASS':'FAIL',
   seed,halos,radii,sizes,contexts:outputs.length,
   states:outputs.reduce((n,r)=>n+(r.totalStates||0),0),
   testedRegions:outputs.reduce((n,r)=>n+(r.totalROIs||0),0),
   byHalo:halos.map((halo,i)=>({halo,failedROIs:outputs.reduce((n,r)=>n+(r.haloCounts?.[i].failed||0),0),
    fullCanvasSourceROIs:outputs.reduce((n,r)=>n+(r.haloCounts?.[i].fullSource||0),0)})),
   outputs,scope:[
    'Deterministic random affine/miter strokes; actual Gaussian radius varies 0,2,5.25,8,12,20 in source-built pinned Vello CPU WASM.',
    'All RGBA tile bytes compared to separate full scene; false halo assumptions are reported, not silently tolerated.',
    'Source ROI globally phase-aligned to 4 pixels and expanded by listed halo; full reference used only as oracle.',
    'Benchmarks are synchronous CPU WASM + buffer returns in shared GitHub Actions runners, not graphics hardware or GPU timings.',
    'Exact tested cases are NOT proof of universal safe filter kernel support. No production main merge.'
   ]};
  writeFileSync(path.join(out,'random-blur-bench-summary.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write('SUMMARY '+summary.status+' states='+summary.states+
    ' ROIs='+summary.testedRegions+' failures='+JSON.stringify(summary.byHalo)+'\n');
  if(summary.status!=='PASS')process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
