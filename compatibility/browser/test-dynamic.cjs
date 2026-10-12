'use strict';
// Per-frame dynamic 2D experiment. CPU/RAF observational measurements on SwiftShader.
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Required webroot/proof paths missing');
const root=path.resolve(process.env.PFX_WEBROOT),out=path.resolve(process.env.PFX_PROOF_DIR);
mkdirSync(out,{recursive:true});
const types={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.filamat':'application/octet-stream'};
const server=createServer((req,res)=>{
  let file;
  try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
  catch{res.writeHead(400);return res.end();}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));}
  catch(error){res.writeHead(404);res.end(String(error));}
});
const stats=arr=>{
  if(!arr.length)return null;
  const sorted=[...arr].sort((a,b)=>a-b);
  const at=p=>sorted[Math.ceil(sorted.length*p)-1];
  return {count:sorted.length,median:at(.5),p95:at(.95),p99:at(.99),
    mean:+(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(3),max:sorted.at(-1)};
};
const median=a=>stats(a)?.median??null;
const rgba=(img,x,y)=>[...img.data.subarray((y*img.width+x)*4,(y*img.width+x)*4+4)];
function comparePixels(a,b,box){
  let changed=0;
  for(let y=box.top;y<box.bottom;y+=2)for(let x=box.left;x<box.right;x+=2){
    const p=rgba(a,x,y),q=rgba(b,x,y);
    if(Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1])+Math.abs(p[2]-q[2])>72)changed++;
  }
  return changed;
}
async function getHeap(client){
  const values=Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  return {jsHeapUsedBytes:values.JSHeapUsedSize??null,jsHeapTotalBytes:values.JSHeapTotalSize??null};
}
const cases={
  '3d-only':{mode:'3d',strategy:'static'},
  'mixed-static':{mode:'mixed',strategy:'static'},
  'mixed-cache-motion':{mode:'mixed',strategy:'cache'},
  'mixed-reraster-motion':{mode:'mixed',strategy:'reraster'},
  '2d-cache-motion':{mode:'2d',strategy:'cache'},
  '2d-reraster-motion':{mode:'2d',strategy:'reraster'}
};
async function runCase(browser,origin,name,round){
  const spec=cases[name],caseId='r'+round+'-'+name,frames=180;
  const context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],external=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(!url.startsWith('http'))return route.continue();
    requests.push(new URL(url).pathname);
    if(new URL(url).origin!==origin){external.push(url);return route.abort();}
    return route.continue();
  });
  let report=null;
  try{
    const client=await context.newCDPSession(page);
    await client.send('Performance.enable');
    const query=new URLSearchParams({...spec,frames:String(frames)});
    await page.goto(origin+'/dynamic.html?'+query,{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>window.PFX_DYNAMIC?.frames>=35||window.PFX_DYNAMIC?.errors?.length>0||window.PFX_BOOT_ERROR,null,{timeout:90000});
    const before=PNG.sync.read(await page.screenshot({animations:'disabled'}));
    const warmHeap=await getHeap(client);
    await page.waitForFunction(n=>window.PFX_DYNAMIC?.frames>=n||window.PFX_DYNAMIC?.errors?.length>0||window.PFX_BOOT_ERROR,frames,{timeout:120000});
    const {state,overlayProbe}=await page.evaluate(()=>{
      const state=window.PFX_DYNAMIC;
      let overlayProbe=null;
      if(state.vello){
        const [x,y]=state.lastTranslation||[0,0];
        overlayProbe=[...document.getElementById('hud').getContext('2d',{willReadFrequently:true})
          .getImageData(330+x,228+y,1,1).data];
      }
      return {state,overlayProbe};
    });
    const endHeap=await getHeap(client);
    const after=PNG.sync.read(await page.screenshot({path:path.join(out,caseId+'.png'),animations:'disabled'}));
    report={
      caseId,name,mode:spec.mode,strategy:spec.strategy,round,status:'PASS',targetFrames:frames,
      framesCompleted:state.frames,expectedRgbaBytesPerFrame:800*500*4,
      renderCpuCallMs:stats(state.renderDurationsMs.slice(30)),
      callbackIntervalMs:stats(state.frameIntervalsMs.slice(30)),
      frameCpuWorkMs:stats(state.frameCpuMs.slice(30)),
      velloRasterCpuMs:stats(state.velloRasterMs.slice(spec.strategy==='reraster'?1:0)),
      pixelBufferCopyMs:stats(state.rgbaCopyMs.slice(spec.strategy==='reraster'?1:0)),
      canvasPutImageDataCallMs:stats(state.putImageDataMs.slice(spec.strategy==='reraster'?1:0)),
      canvasDrawCallsCpuMs:stats(state.canvasCompositeMs.slice(spec.strategy==='static'?0:30)),
      over24msCallbackIntervals:state.frameIntervalsMs.filter(x=>x>24).length,
      velloCallCount:state.velloCalls,rgbaUploadCallCount:state.putImageDataCalls,
      rgbaTransferBytes:state.totalRgbaTransferBytes,overlayUpdates:state.overlayUpdates,
      main2dOver3dPixel:overlayProbe,
      changing2dPixels:spec.strategy==='static'||spec.mode==='3d'?null:comparePixels(before,after,{left:0,top:10,right:290,bottom:60}),
      changing3dPixels:spec.mode==='2d'?null:comparePixels(before,after,{left:275,top:145,right:555,bottom:390}),
      gpuVersion:state.gpuVersion??null,gpuRenderer:state.gpuRenderer??null,
      heap:{warm:warmHeap,end:endHeap,deltaBytes:endHeap.jsHeapUsedBytes-warmHeap.jsHeapUsedBytes},
      zeroAlphaSource:state.pixelChecks?.transparent??null,contextLosses:state.contextLosses,
      errors:[...errors,...state.errors],externalRequests:external,loadedAssetPaths:requests
    };
    const failures=[];
    if(report.errors.length||external.length)failures.push('Browser/runtime/network error');
    if(state.frames!==frames||state.targetFrames!==frames)failures.push('Incomplete frame count');
    if(after.width!==800||after.height!==500)failures.push('Unexpected screenshot dimensions');
    if(!report.callbackIntervalMs||!report.frameCpuWorkMs)failures.push('Missing frame timing');
    if(spec.mode==='3d'){
      if(state.vello||state.velloCalls||requests.some(p=>/pfx_vello_overlay/.test(p)))failures.push('2D not isolated');
    }else{
      if(!state.vello||state.pixelChecks?.transparent!==0)failures.push('Vello/alpha invalid');
      if(!overlayProbe||overlayProbe[0]<150||overlayProbe[2]<120||overlayProbe[1]>120||overlayProbe[3]!==255)failures.push('Moving Vello foreground missing');
      const expectedRasters=spec.strategy==='reraster'?frames+1:1;
      if(state.velloCalls!==expectedRasters||state.putImageDataCalls!==expectedRasters)failures.push('Raster and upload count');
      if(state.totalRgbaTransferBytes!==expectedRasters*1600000)failures.push('RGBA copied bytes incorrect');
      const expectedOverlay=spec.strategy==='static'?1:frames+1;
      if(state.overlayUpdates!==expectedOverlay)failures.push('Overlay draw count');
      if(spec.strategy!=='static'&&report.changing2dPixels<50)failures.push('No visible 2D animation');
    }
    if(spec.mode==='2d'){
      if(state.filament||requests.some(p=>/filament|filamat/.test(p)))failures.push('3D runtime unexpectedly loaded');
    }else{
      if(!state.filament||!state.perspective||state.contextLosses!==0)failures.push('3D engine invalid or lost');
      if(!report.renderCpuCallMs||report.changing3dPixels<150)failures.push('3D animation missing');
    }
    if(failures.length){report.status='FAIL';report.failures=failures;}
    writeFileSync(path.join(out,caseId+'.json'),JSON.stringify(report,null,2)+'\n');
    if(failures.length)throw Error(caseId+': '+failures.join('; '));
    process.stdout.write('PASS '+caseId+' frames='+state.frames+
      ' callbackP95='+report.callbackIntervalMs.p95+
      ' frameCpuP95='+report.frameCpuWorkMs.p95+
      ' rasterCalls='+state.velloCalls+'\n');
    return report;
  }catch(error){
    writeFileSync(path.join(out,caseId+'-failure.json'),JSON.stringify({message:String(error),report,errors,external,requests},null,2)+'\n');
    throw error;
  }finally{await context.close();}
}
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const rounds=[
      ['3d-only','mixed-static','mixed-cache-motion','mixed-reraster-motion','2d-cache-motion','2d-reraster-motion'],
      ['mixed-reraster-motion','2d-cache-motion','3d-only','2d-reraster-motion','mixed-static','mixed-cache-motion'],
      ['2d-reraster-motion','mixed-cache-motion','mixed-static','3d-only','mixed-reraster-motion','2d-cache-motion']
    ];
    const results=[];
    for(let i=0;i<rounds.length;i++)for(const name of rounds[i])results.push(await runCase(browser,origin,name,i+1));
    const summary={status:'PASS',testedAt:new Date().toISOString(),
      totalScenarios:results.length,totalFrames:results.reduce((n,r)=>n+r.framesCompleted,0),
      modeAggregate:{},rounds,reports:results,
      limitations:[
        'Vello CPU rasterizes an identical source scene on each reraster frame; the moving image is translated by Canvas2D, not moving Vello path geometry.',
        'CPU raster copy / Canvas2D putImageData / drawImage measured as JavaScript call wall time only, not GPU completion.',
        'All canvases are independent and composited by Chromium; shared WebGL/WebGPU GPU ownership is not tested.',
        'Headless SwiftShader software WebGL2. 2D-only has no 3D GPU workload.',
        'Only one CI runner run with 3 contexts per case; browser GC, order and scheduling bias remain.',
        'CDP heap excludes WebAssembly linear memory, GPU resources and Chrome subprocesses; no complete RAM or VRAM accounting.'
      ]};
    for(const name of Object.keys(cases)){
      const rows=results.filter(r=>r.name===name);
      summary.modeAggregate[name]={
        repetitions:rows.length,frames:rows.reduce((n,r)=>n+r.framesCompleted,0),
        medianFrameCpuWorkP95Ms:median(rows.map(r=>r.frameCpuWorkMs.p95)),
        medianCallbackIntervalP95Ms:median(rows.map(r=>r.callbackIntervalMs.p95)),
        medianVelloRasterP95Ms:median(rows.map(r=>r.velloRasterCpuMs?.p95).filter(Number.isFinite)),
        medianCanvasUploadP95Ms:median(rows.map(r=>r.canvasPutImageDataCallMs?.p95).filter(Number.isFinite)),
        medianRender3dP95Ms:median(rows.map(r=>r.renderCpuCallMs?.p95).filter(Number.isFinite)),
        totalVelloRasters:rows.reduce((n,r)=>n+r.velloCallCount,0),
        totalUploadedRgbaBytes:rows.reduce((n,r)=>n+r.rgbaTransferBytes,0),
        totalOver24msIntervals:rows.reduce((n,r)=>n+r.over24msCallbackIntervals,0)
      };
    }
    writeFileSync(path.join(out,'dynamic-overlay-summary.json'),JSON.stringify(summary,null,2)+'\n');
    process.stdout.write('SUMMARY '+JSON.stringify({totalScenarios:summary.totalScenarios,totalFrames:summary.totalFrames,aggregate:summary.modeAggregate})+'\n');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
