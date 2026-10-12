'use strict';
// Validates freshly rebuilt vector geometry, pixel-exact dirty tile and browser timing.
// Vello source-built CPU WASM + pinned source-built Filament WASM on SwiftShader.
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(process.env.PFX_WEBROOT||'');
const out=path.resolve(process.env.PFX_PROOF_DIR||'');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('PFX_WEBROOT/PFX_PROOF_DIR required');
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.filamat':'application/octet-stream'};
const server=createServer((req,res)=>{
  let file;
  try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
  catch{res.writeHead(400);return res.end();}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));}
  catch(e){res.writeHead(404);res.end(String(e));}
});
function stats(arr){
  if(!arr.length)return null;
  const a=[...arr].sort((x,y)=>x-y),at=q=>a[Math.ceil(a.length*q)-1];
  return {samples:a.length,median:at(.5),p95:at(.95),p99:at(.99),max:a.at(-1),
    mean:+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(3)};
}
const median=a=>stats(a)?.median??null;
const color=(img,x,y)=>[...img.data.subarray((y*img.width+x)*4,(y*img.width+x)*4+4)];
function pixelDiff(a,b,box){
  let n=0;
  for(let y=box.y0;y<box.y1;y+=3)for(let x=box.x0;x<box.x1;x+=3){
    const left=color(a,x,y),right=color(b,x,y);
    if(Math.abs(left[0]-right[0])+Math.abs(left[1]-right[1])+Math.abs(left[2]-right[2])>65)n++;
  }
  return n;
}
const cases={
  '3d-only':{mode:'3d',strategy:'full'},
  '2d-full':{mode:'2d',strategy:'full'},
  '2d-dirty':{mode:'2d',strategy:'dirty'},
  'mixed-full':{mode:'mixed',strategy:'full'},
  'mixed-dirty':{mode:'mixed',strategy:'dirty'}
};
async function runCase(browser,origin,name,round){
  const spec=cases[name],label='r'+round+'-'+name,frames=180;
  const context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:1});
  const page=await context.newPage();
  const errors=[],requests=[],forbidden=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text());});
  page.on('response',response=>{if(response.status()>=400)errors.push('HTTP '+response.status()+' '+response.url());});
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(!/^https?:/.test(url))return route.continue();
    requests.push(new URL(url).pathname);
    if(new URL(url).origin!==origin){forbidden.push(url);return route.abort();}
    return route.continue();
  });
  let report=null;
  try{
    const cdp=await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const q=new URLSearchParams({...spec,frames:String(frames)});
    await page.goto(origin+'/geometry.html?'+q,{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>window.PFX_GEOMETRY?.frames>=36||window.PFX_GEOMETRY?.errors?.length||window.PFX_BOOT_ERROR,null,{timeout:120000});
    const before=PNG.sync.read(await page.screenshot({animations:'disabled'}));
    const warm=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    await page.waitForFunction(expected=>window.PFX_GEOMETRY?.frames>=expected||window.PFX_GEOMETRY?.errors?.length||window.PFX_BOOT_ERROR,frames,{timeout:120000});
    // Read timing arrays before the separate, intentionally expensive pixel-exact proof.
    const state=await page.evaluate(()=>window.PFX_GEOMETRY);
    const end=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    const after=PNG.sync.read(await page.screenshot({path:path.join(out,label+'.png'),animations:'disabled'}));
    const verified=spec.mode==='3d'?null:await page.evaluate(()=>window.PFX_VERIFY_GEOMETRY());
    const expectedFull=spec.mode==='3d'?0:1+(spec.strategy==='full'?frames:0);
    const expectedTile=spec.mode==='3d'?0:(spec.strategy==='dirty'?frames:0);
    const expectedBytes=expectedFull*1600000+expectedTile*112000;
    report={
      label,name,mode:spec.mode,strategy:spec.strategy,round,frames:state.frames,
      status:'PASS',rendererCpuCallMs:stats(state.renderDurationsMs.slice(30)),
      frameWorkCpuMs:stats(state.frameCpuMs.slice(30)),
      frameCallbackMs:stats(state.frameIntervalsMs.slice(30)),
      velloCpuRasterMs:stats(state.velloRasterMs.slice(1)),
      rgbaCopyCpuMs:stats(state.rgbaCopyMs.slice(1)),
      canvasPutImageDataCpuMs:stats(state.putImageDataMs.slice(1)),
      callbackIntervalsOver24ms:state.frameIntervalsMs.filter(x=>x>24).length,
      fullRenders:state.fullRenders,tileRenders:state.tileRenders,uploadCalls:state.putImageDataCalls,
      rgbaBytesTransferred:state.rgbaTransferBytes,expectedBytes,verification:verified,
      sourceMagenta:state.pixelChecks.magenta||null,sourceTransparent:state.pixelChecks.transparent??null,
      movement2dPixels:spec.mode==='3d'?null:pixelDiff(before,after,{x0:550,y0:100,x1:750,y1:240}),
      movement3dPixels:spec.mode==='2d'?null:pixelDiff(before,after,{x0:310,y0:250,x1:540,y1:400}),
      glVersion:state.gpuVersion,glRenderer:state.gpuRenderer,contextLosses:state.contextLosses,
      heap:{start:warm.JSHeapUsedSize??null,end:end.JSHeapUsedSize??null,
        difference:(end.JSHeapUsedSize??0)-(warm.JSHeapUsedSize??0)},
      errors:[...errors,...state.errors],forbiddenRequests:forbidden,assets:requests
    };
    const failure=[];
    if(report.frames!==frames)failure.push('Frame target mismatch');
    if(report.errors.length||report.forbiddenRequests.length)failure.push('Browser or network errors');
    if(!report.frameCallbackMs||!report.frameWorkCpuMs)failure.push('Missing performance measurements');
    if(state.fullRenders!==expectedFull||state.tileRenders!==expectedTile||state.putImageDataCalls!==expectedFull+expectedTile)failure.push('Raster or upload count mismatch');
    if(state.rgbaTransferBytes!==expectedBytes)failure.push('Unexpected RGBA bytes');
    if(spec.mode==='3d'){
      if(state.vello||requests.some(a=>a.includes('pfx_vello_overlay')))failure.push('Vello loaded in 3D only');
    }else{
      if(!state.vello||state.pixelChecks?.transparent!==0)failure.push('Vello source not valid');
      if(requests.some(p=>spec.mode==='2d'&&/filament|filamat/.test(p)))failure.push('Filament loaded in 2D only');
      if(verified?.mismatchedTile!==0||verified?.mismatchedFinalDisplay!==0)failure.push('Geometry full-tile pixel mismatch');
      if(verified?.lastStep!==179||verified?.oldPositionAlpha!==0)failure.push('Stale geometry or incorrect last frame');
      const col=verified?.magenta||[];
      if(col[0]<150||col[2]<120||col[1]>120||col[3]!==255)failure.push('Final geometry not painted magenta');
      if(report.movement2dPixels<100)failure.push('Actual 2D shape did not move');
    }
    if(spec.mode!=='2d'){
      if(!state.filament||!state.perspective||state.contextLosses!==0)failure.push('Filament 3D failed or context lost');
      if(!report.rendererCpuCallMs||report.movement3dPixels<100)failure.push('3D motion failed');
    }
    if(failure.length){report.status='FAIL';report.failures=failure;}
    writeFileSync(path.join(out,label+'.json'),JSON.stringify(report,null,2)+'\n');
    if(failure.length)throw Error(label+' '+failure.join('; '));
    process.stdout.write('PASS '+label+' frames='+frames+
      ' CPU-frame-p95='+report.frameWorkCpuMs.p95+
      ' RAF-p95='+report.frameCallbackMs.p95+
      ' RGBA-bytes='+report.rgbaBytesTransferred+'\n');
    return report;
  }catch(error){
    writeFileSync(path.join(out,label+'-failure.json'),JSON.stringify({
      message:String(error),report,errors,forbidden,requests},null,2)+'\n');
    throw error;
  }finally{await context.close();}
}
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,
    args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const order=[
      ['3d-only','2d-full','mixed-dirty','mixed-full','2d-dirty'],
      ['mixed-full','2d-dirty','3d-only','2d-full','mixed-dirty'],
      ['2d-dirty','mixed-dirty','2d-full','3d-only','mixed-full']
    ];
    const reports=[];
    for(let i=0;i<order.length;i++)for(const name of order[i])reports.push(await runCase(browser,origin,name,i+1));
    const aggregates={};
    for(const name of Object.keys(cases)){
      const runs=reports.filter(r=>r.name===name);
      aggregates[name]={
        repeats:runs.length,frames:runs.reduce((a,r)=>a+r.frames,0),
        medianFrameCpuP95Ms:median(runs.map(r=>r.frameWorkCpuMs.p95)),
        medianRafCallbackP95Ms:median(runs.map(r=>r.frameCallbackMs.p95)),
        medianVelloRasterP95Ms:median(runs.map(r=>r.velloCpuRasterMs?.p95).filter(Number.isFinite)),
        medianUploadP95Ms:median(runs.map(r=>r.canvasPutImageDataCpuMs?.p95).filter(Number.isFinite)),
        callbackIntervalsOver24Ms:runs.reduce((a,r)=>a+r.callbackIntervalsOver24ms,0),
        bytesUploaded:runs.reduce((a,r)=>a+r.rgbaBytesTransferred,0)
      };
    }
    const summary={
      status:'PASS',date:new Date().toISOString(),caseCount:reports.length,
      totalFrames:reports.reduce((a,r)=>a+r.frames,0),
      pinnedVelloSourceSha:'235739c4f08eb48d900e1512459d453a9ab77f96',
      pinnedFilamentSourceSha:'764fe6cac9bdb4ba24d3d852344dfa04a5f70f75',
      aggregate:aggregates,order,reports,
      caveats:[
        'Full Vello CPU pixel buffers (800x500) vs exact Vello-rendered dirty tile (200x140); actual Rust scene geometry changes each frame.',
        'Visual equality validated after timing with independent full and tile source render calls and complete Canvas2D RGBA comparison.',
        'Measured JS CPU call duration and rAF callback intervals are not GPU compositor execution timings or hardware FPS.',
        'Headless software SwiftShader in Chromium and distinct overlay/WebGL2 canvases, no shared GPU context.',
        'Dirty-region transfer byte count is Vello-to-JS ImageData/Canvas2D putImageData bytes; not verified hardware GPU bus upload.',
        'Only one CI runner with three contexts per case; garbage collection and scheduler variation limit generalization.',
        'No desktop, GPU memory, context recovery, vector scene complexity scaling or WASM heap measurement.'
      ]};
    writeFileSync(path.join(out,'geometry-dirty-summary.json'),JSON.stringify(summary,null,2)+'\n');
    process.stdout.write('SUMMARY '+JSON.stringify({totalCases:summary.caseCount,totalFrames:summary.totalFrames,aggregate:aggregates})+'\n');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
