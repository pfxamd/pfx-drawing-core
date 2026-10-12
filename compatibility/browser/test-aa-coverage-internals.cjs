'use strict';
// Inspect actual instrumented pinned Vello intermediate geometry and AA coverage.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Missing paths');
const root=path.resolve(process.env.PFX_WEBROOT),out=path.resolve(process.env.PFX_PROOF_DIR);
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
  let file;
  try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
  catch{res.writeHead(400);return res.end();}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file))}
  catch(e){res.writeHead(404);res.end(String(e))}
});
const scenes=[{name:'single-blob-a',flag:8},{name:'single-blob-b',flag:16}];
const frames=[0,43,97,159];
const tiles=[
 {name:'origin-448-96',x:448,y:96,w:336,h:256},
 {name:'origin-449-97',x:449,y:97,w:335,h:255},
 {name:'origin-432-80',x:432,y:80,w:352,h:272},
];
async function run(browser,origin,scene,round){
 const context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:1});
 const page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url())});
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith('http')&&new URL(url).origin!==origin){external.push(url);return route.abort();}
  return route.continue();
 });
 let report=null;
 try {
  await page.goto(origin+'/aa-precision.html',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:120000});
  report=await page.evaluate(({scene,frames,tiles})=>{
   const api=window.PFX_AA;
   if(!api.ready)throw Error('Vello unavailable '+api.error);
   if(!api.intermediate||!api.traceLines||!api.traceCoverage)
    throw Error('Missing trace exports');
   const roi={x0:464,x1:776,y0:112,y1:344};
   const toMap=flat=>{
    const map=new Map();
    for(let i=0;i<flat.length;i+=4){
     const [x,y,pre,quantized]=flat.slice(i,i+4);
     const id=y*800+x;
     if(map.has(id))throw Error('Duplicate coverage entry at '+id);
     map.set(id,{pre,quantized});
    }
    return map;
   };
   function capture(frame,r){
    const bytes=api.intermediate(frame,r.x,r.y,r.w,r.h,scene.flag);
    if(bytes.length!==r.w*r.h*4)throw Error('Incorrect source bytes');
    const traces=api.traceCoverage();
    const lines=api.traceLines();
    if(api.traceTruncated())throw Error('Intermediate record cap exceeded');
    if(lines.length%6||traces.length%4)throw Error('Corrupt intermediate trace');
    return {bytes,cover:toMap(traces),lines};
   }
   function coordinateLineStats(full,tile,r){
    const f=full.lines,t=tile.lines;
    const matched=Math.min(f.length,t.length)/6;
    let nonzero=0,maxGlobalDelta=0,excerpts=[];
    for(let i=0;i<matched;i++){
     let diff=0;
     if(f[i*6]!==t[i*6]||f[i*6+1]!==t[i*6+1])continue;
     for(let j=2;j<6;j++){
      const origin=j%2===0?r.x:r.y;
      const delta=Math.abs(f[i*6+j]-(t[i*6+j]+origin));
      diff=Math.max(diff,delta);
     }
     if(diff>0){nonzero++;maxGlobalDelta=Math.max(maxGlobalDelta,diff);
       if(excerpts.length<4)excerpts.push({line:i,delta:diff})}
    }
    return {fullSegments:f.length/6,tileSegments:t.length/6,
     matchedSegmentIndices:matched,changedAfterOriginRestore:nonzero,maxGlobalDelta,excerpts};
   }
   const perFrame=[];
   for(const frame of frames){
    const f=capture(frame,{x:0,y:0,w:800,h:500});
    if(f.cover.size<10||f.lines.length<6)throw Error('No intermediate output traced');
    for(const r of tiles){
     const tile=capture(frame,r);
     const stats={frame,origin:r.name,referenceLineCount:f.lines.length/6,
       referenceCoveragePoints:f.cover.size,tileCoveragePoints:tile.cover.size,
       alphaMismatchedPixels:0,prequantDifferentAtMismatch:0,
       u8MaskDifferentAtMismatch:0,missingFullCoverage:0,missingTileCoverage:0,
       fullCoverageEqualsOutput:0,tileCoverageEqualsOutput:0,
       maxAlphaDelta:0,maxPrequantDifference:0,samples:[],
       lines:coordinateLineStats(f,tile,r)};
     for(let y=roi.y0;y<roi.y1;y++)for(let x=roi.x0;x<roi.x1;x++){
      const idx=y*800+x;
      const a=f.bytes[idx*4+3],b=tile.bytes[((y-r.y)*r.w+x-r.x)*4+3];
      if(a===b)continue;
      stats.alphaMismatchedPixels++;
      stats.maxAlphaDelta=Math.max(stats.maxAlphaDelta,Math.abs(a-b));
      const fa=f.cover.get(idx),ta=tile.cover.get(idx);
      if(!fa)stats.missingFullCoverage++;
      if(!ta)stats.missingTileCoverage++;
      const fpre=fa?.pre??0,tpre=ta?.pre??0;
      const fquant=fa?.quantized??0,tquant=ta?.quantized??0;
      if(fquant!==tquant)stats.u8MaskDifferentAtMismatch++;
      if(fpre!==tpre)stats.prequantDifferentAtMismatch++;
      stats.maxPrequantDifference=Math.max(stats.maxPrequantDifference,Math.abs(fpre-tpre));
      if(fquant===a)stats.fullCoverageEqualsOutput++;
      if(tquant===b)stats.tileCoverageEqualsOutput++;
      if(stats.samples.length<10)stats.samples.push({
       x,y,alphaFull:a,alphaTile:b,prequantFull:fpre,prequantTile:tpre,
       quantizedFull:fquant,quantizedTile:tquant,
       fullTracePresent:!!fa,tileTracePresent:!!ta
      });
     }
     perFrame.push(stats);
    }
   }
   return {scene,frames,tiles,roi,perFrame};
  },{scene,frames,tiles});
  const sums={
    alphaMismatches:0,prequantChanged:0,maskChanged:0,missingFullCoverage:0,missingTileCoverage:0,
    coverageExplained:0,maxAlphaDelta:0,maxPrequantDifference:0,
    linesChanged:0,maxGlobalLineDelta:0
  };
  const failures=[];
  for(const p of report.perFrame){
   sums.alphaMismatches+=p.alphaMismatchedPixels;
   sums.prequantChanged+=p.prequantDifferentAtMismatch;
   sums.maskChanged+=p.u8MaskDifferentAtMismatch;
   sums.missingFullCoverage+=p.missingFullCoverage;
   sums.missingTileCoverage+=p.missingTileCoverage;
   sums.maxAlphaDelta=Math.max(sums.maxAlphaDelta,p.maxAlphaDelta);
   sums.maxPrequantDifference=Math.max(sums.maxPrequantDifference,p.maxPrequantDifference);
   sums.linesChanged+=p.lines.changedAfterOriginRestore;
   sums.maxGlobalLineDelta=Math.max(sums.maxGlobalLineDelta,p.lines.maxGlobalDelta);
   sums.coverageExplained+=Math.min(p.fullCoverageEqualsOutput,p.tileCoverageEqualsOutput);
   if(p.maxAlphaDelta>1)failures.push('RGBA alpha deviation beyond 1/255');
  }
  if(sums.alphaMismatches===0)failures.push('No numerical AA mismatches exercised');
  if(sums.prequantChanged===0)failures.push('No differing pre-u8 coverage measured');
  if(sums.maskChanged===0)failures.push('No quantized AA changes detected');
  if(errors.length||external.length)failures.push('Unexpected browser errors/requests');
  report.summary=sums;
  report.browserErrors=errors;report.externalRequests=external;
  report.status=failures.length?'FAIL':'PASS';
  if(failures.length)report.failures=failures;
  writeFileSync(path.join(out,'r'+round+'-'+scene.name+'.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(report.status+' r'+round+' '+scene.name+' alpha='+sums.alphaMismatches+
    ' prequant='+sums.prequantChanged+' mask='+sums.maskChanged+
    ' lineChanges='+sums.linesChanged+'\n');
  return report;
 }catch(e){
  writeFileSync(path.join(out,'r'+round+'-'+scene.name+'-error.json'),
   JSON.stringify({error:String(e),report,errors,external},null,2)+'\n');
  process.stderr.write('ERROR r'+round+' '+scene.name+' '+String(e)+'\n');
  return {status:'FAIL',scene,round,error:String(e)};
 }finally{await context.close()}
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const result=[];
  for(let round=1;round<=2;round++)
   for(const scene of (round===1?scenes:[...scenes].reverse()))
    result.push(await run(browser,origin,scene,round));
  const summary={
   status:result.every(r=>r.status==='PASS')?'PASS':'FAIL',
   passed:result.filter(r=>r.status==='PASS').length,attempted:result.length,
   results:result.map(r=>({status:r.status,scene:r.scene,round:r.round,error:r.error,
      failures:r.failures,summary:r.summary})),
   caveats:[
    'Actual pinned-source Vello CPU instrumented before strip-u8 conversion; no GPU timing.',
    'Single-path opaque paint lets output alpha serve as a direct AA-mask proxy.',
    'Line indices can diverge under culling and are not a globally stable geometry ID.',
    'Prequant values are f32(coverage*255+0.5), before integer conversion; exact f32 captured.',
    'Only two scenes, four frames and three tile origins, two isolated browser contexts.',
    'No production Vello source or final rendering engine selected.'
   ]
  };
  writeFileSync(path.join(out,'coverage-internals-summary.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write('SUMMARY '+summary.passed+'/'+summary.attempted+' '+summary.status+'\n');
  if(summary.status!=='PASS')process.exitCode=1;
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
