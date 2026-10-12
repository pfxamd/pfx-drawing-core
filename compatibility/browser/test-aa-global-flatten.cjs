'use strict';
// Actual source-built Vello CPU comparison; no physical GPU or renderer integration.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Missing test paths');
const root=path.resolve(process.env.PFX_WEBROOT),out=path.resolve(process.env.PFX_PROOF_DIR);
mkdirSync(out,{recursive:true});
const server=createServer((req,res)=>{
 let f;
 try{f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
 catch{res.writeHead(400);return res.end()}
 if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
 try{
  const ext=path.extname(f);
  res.writeHead(200,{'Content-Type':{'.html':'text/html','.wasm':'application/wasm','.js':'application/javascript'}[ext]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(readFileSync(f));
 }catch(e){res.writeHead(404);res.end(String(e))}
});
const scenarios=[
 {name:'single-A',flag:8},
 {name:'single-B',flag:16},
 {name:'mixed-scene',flag:7}
];
const regions=[
 {name:'original',x:448,y:96,w:336,h:256},
 {name:'offset-one',x:449,y:97,w:335,h:255},
 {name:'offset-sixteen',x:432,y:80,w:352,h:272}
];
const frames=[0,43,97,159],roi={x0:449,x1:784,y0:97,y1:352};
async function test(browser,origin,scene,round){
 const context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:1});
 const page=await context.newPage();
 const errors=[],external=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url())});
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith('http')&&new URL(url).origin!==origin){external.push(url);return route.abort();}
  return route.continue()
 });
 let result;
 try{
  await page.goto(origin+'/aa-precision.html',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:120000});
  result=await page.evaluate(({scene,regions,frames,roi})=>{
   const api=window.PFX_AA;
   if(!api.ready||typeof api.canonical!=='function')throw Error('Canonical Vello export not initialized');
   const full={x:0,y:0,w:800,h:500};
   const render=(frame,r,canonical,collect=false)=>{
    const data=api.canonical(frame,r.x,r.y,r.w,r.h,scene.flag,canonical,collect);
    if(data.length!==r.w*r.h*4)throw Error('Incorrect RGBA result: '+r.name);
    return data;
   };
   function diff(reference,tile,r){
    const d={pixels:0,channels:0,alphaChannels:0,maxDelta:0,samples:[]};
    for(let y=roi.y0;y<roi.y1;y++)for(let x=roi.x0;x<roi.x1;x++){
     const a=(y*800+x)*4,b=((y-r.y)*r.w+x-r.x)*4;
     let changed=false;
     for(let channel=0;channel<4;channel++){
      const delta=Math.abs(reference[a+channel]-tile[b+channel]);
      if(delta===0)continue;
      changed=true;d.channels++;
      if(channel===3)d.alphaChannels++;
      d.maxDelta=Math.max(d.maxDelta,delta);
      if(d.samples.length<4)d.samples.push({x,y,channel,full:reference[a+channel],tile:tile[b+channel],delta});
     }
     if(changed)d.pixels++;
    }
    return d;
   }
   const report={scene,frames,regions:[],legacyCompatibilityChannels:0,nonTransparentPixels:0,
     globalFullChangedChannels:0,probes:[]};
   for(const frame of frames){
    const reference=render(frame,full,false);
    const control=render(frame,full,true);
    for(let i=0;i<reference.length;i++)if(reference[i]!==control[i])report.globalFullChangedChannels++;
    if(scene.flag===7) {
      const old=api.trace(frame,0,0,800,500,1,0,0,0,true,7,false);
      for(let i=0;i<reference.length;i++)if(reference[i]!==old[i])report.legacyCompatibilityChannels++;
    }
    for(let y=roi.y0;y<roi.y1;y++)for(let x=roi.x0;x<roi.x1;x++){
     if(reference[(y*800+x)*4+3]>0)report.nonTransparentPixels++;
    }
    for(const r of regions){
      const legacy=diff(reference,render(frame,r,false),r);
      const canonical=diff(reference,render(frame,r,true),r);
      report.probes.push({frame,origin:r.name,legacy,canonical});
    }
   }
   const summary={};
   for(const mode of ['legacy','canonical']){
    const stats={channels:0,alphaChannels:0,pixels:0,maxDelta:0,framesImproved:0,framesWorsened:0};
    for(const p of report.probes){
      const v=p[mode];
      stats.channels+=v.channels;stats.alphaChannels+=v.alphaChannels;
      stats.pixels+=v.pixels;stats.maxDelta=Math.max(stats.maxDelta,v.maxDelta);
      if(mode==='canonical') {
       if(v.channels<p.legacy.channels)stats.framesImproved++;
       if(v.channels>p.legacy.channels)stats.framesWorsened++;
      }
    }
    summary[mode]=stats;
   }
   report.summary=summary;
   // Timings without trace buffers; compare same scene, same tile, alternate order.
   const region=regions[0];
   const timings={legacy:[],canonical:[],full:[]};
   for(let i=0;i<6;i++)for(const mode of ['legacy','canonical','full'])
    render(30+i,mode==='full'?full:region,mode==='canonical');
   for(let i=0;i<36;i++) {
    const order=i%2===0?['legacy','canonical','full']:['full','canonical','legacy'];
    for(const mode of order){
     const t=performance.now();
     render(57+i,mode==='full'?full:region,mode==='canonical');
     timings[mode].push(performance.now()-t);
    }
   }
   report.performance=Object.fromEntries(Object.entries(timings).map(([mode,values])=>{
     values.sort((a,b)=>a-b);
     return [mode,{samples:values.length,medianMs:values[Math.floor(values.length/2)],
       p95Ms:values[Math.ceil(values.length*.95)-1],
       rgbaBytesPerCall:(mode==='full'?1600000:region.w*region.h*4)}];
   }));
   // Trace one canonical tile and compare its intermediate lines to its full reference.
   if(scene.flag!==7){
    render(97,full,false,true);
    const fullLines=api.traceLines();
    render(97,region,true,true);
    const tileLines=api.traceLines();
    if(api.traceTruncated())throw Error('Intermediate trace truncated');
    let identicalGlobalSegments=0;
    const pairs=Math.min(fullLines.length,tileLines.length)/6;
    let maxRestoreError=0;
    for(let i=0;i<pairs;i++){
     let changed=false;
     for(let j=2;j<6;j++){
      const offset=j%2===0?region.x:region.y;
      const delta=Math.abs(fullLines[i*6+j]-Math.fround(tileLines[i*6+j]+offset));
      maxRestoreError=Math.max(maxRestoreError,delta);
      if(delta>0)changed=true;
     }
     if(!changed)identicalGlobalSegments++;
    }
    report.geometry={fullSegments:fullLines.length/6,tileSegments:tileLines.length/6,
      alignedCount:pairs,globallyIdenticalSegments:identicalGlobalSegments,
      maxRestoredLineDelta:maxRestoreError};
   }
   return report;
  },{scene,regions,frames,roi});
  const failures=[];
  if(result.nonTransparentPixels<100)failures.push('Unpainted verification region');
  if(result.globalFullChangedChannels!==0)failures.push('Global baseline changed in canonical mode');
  if(result.legacyCompatibilityChannels!==0)failures.push('Original source behavior changed');
  if(result.summary.legacy.channels===0)failures.push('Baseline differences not exercised');
  if(result.summary.canonical.maxDelta>1)failures.push('Canonical numeric regression exceeds 1/255');
  if(errors.length||external.length)failures.push('Runtime/network errors');
  result.status=failures.length?'FAIL':'PASS';if(failures.length)result.failures=failures;
  result.errors=errors;result.externalRequests=external;
  writeFileSync(path.join(out,'r'+round+'-'+scene.name+'.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(result.status+' r'+round+' '+scene.name+
    ' legacy='+result.summary.legacy.channels+' canonical='+result.summary.canonical.channels+
    ' alpha='+result.summary.canonical.alphaChannels+'\n');
  return result;
 }catch(error){
  writeFileSync(path.join(out,'r'+round+'-'+scene.name+'-error.json'),
    JSON.stringify({error:String(error),result,errors,external},null,2)+'\n');
  process.stderr.write('ERROR '+scene.name+': '+String(error)+'\n');
  return {status:'FAIL',scene,round,error:String(error)};
 }finally{await context.close()}
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'
 ]});
 try {
  const runs=[];
  for(let round=1;round<=2;round++)for(const scene of (round===1?scenarios:[...scenarios].reverse()))
   runs.push(await test(browser,origin,scene,round));
  const aggregate={status:runs.every(r=>r.status==='PASS')?'PASS':'FAIL',
   count:runs.length,passed:runs.filter(r=>r.status==='PASS').length,
   results:runs.map(r=>({scene:r.scene,round:r.round,status:r.status,failures:r.failures,
     summary:r.summary,performance:r.performance,geometry:r.geometry,error:r.error})),
   limitations:[
    'Pinned-source Vello CPU WASM, SwiftShader Chromium; no real GPU or memory-bus measurements.',
    'Canonical variant flattens in global 800x500 space then subtracts raster origin from f32 line endpoints.',
    'No production code integration; global bbox fixed for the scene and not a general clip strategy.',
    'Only sampled frames, selected clip origins and curves; byte-exact is reported separately from PASS.',
    'Synchronous WASM render-call timings exclude Canvas, 3D and compositor work.'
   ]};
  writeFileSync(path.join(out,'aa-global-flatten-summary.json'),JSON.stringify(aggregate,null,2)+'\n');
  process.stdout.write('SUMMARY '+aggregate.passed+'/'+aggregate.count+' '+aggregate.status+'\n');
  if(aggregate.status!=='PASS')process.exitCode=1;
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>server.close());
