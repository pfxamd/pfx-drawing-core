'use strict';
// Browser test of source-built Vello CPU complex AA Bézier paths over Filament.
// Validate byte-level reference BEFORE reporting performance as correctness.
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Missing paths');
const root=path.resolve(process.env.PFX_WEBROOT),out=path.resolve(process.env.PFX_PROOF_DIR);
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
const stats=xs=>{
  if(!xs.length)return null;
  const a=[...xs].sort((x,y)=>x-y);
  const p=q=>a[Math.ceil(a.length*q)-1];
  return {samples:a.length,mean:+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(3),
    median:p(.5),p95:p(.95),p99:p(.99),max:a.at(-1)};
};
const med=xs=>stats(xs)?.median??null;
const rgba=(img,x,y)=>[...img.data.subarray((y*img.width+x)*4,(y*img.width+x)*4+4)];
function changed(a,b,box){
  let pixels=0;
  for(let y=box.y0;y<box.y1;y+=3)for(let x=box.x0;x<box.x1;x+=3){
    const u=rgba(a,x,y),v=rgba(b,x,y);
    if(Math.abs(u[0]-v[0])+Math.abs(u[1]-v[1])+Math.abs(u[2]-v[2])>50)pixels++;
  }
  return pixels;
}
const runs={
  '3d-only':{mode:'3d',strategy:'full'},
  '2d-full':{mode:'2d',strategy:'full'},
  '2d-union':{mode:'2d',strategy:'union'},
  '2d-overlap':{mode:'2d',strategy:'overlap'},
  'mixed-full':{mode:'mixed',strategy:'full'},
  'mixed-union':{mode:'mixed',strategy:'union'},
  'mixed-overlap':{mode:'mixed',strategy:'overlap'}
};
async function scenario(browser,origin,name,round){
  const spec=runs[name],id='r'+round+'-'+name,frames=160;
  const context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],external=[],requested=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(!url.startsWith('http'))return route.continue();
    requested.push(new URL(url).pathname);
    if(new URL(url).origin!==origin){external.push(url);return route.abort();}
    return route.continue();
  });
  let result=null;
  try{
    const cdp=await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const query=new URLSearchParams({...spec,frames:String(frames)});
    await page.goto(origin+'/complex.html?'+query,{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>window.PFX_COMPLEX?.frames>=30||window.PFX_COMPLEX?.errors?.length||window.PFX_BOOT_ERROR,null,{timeout:120000});
    const before=PNG.sync.read(await page.screenshot({animations:'disabled'}));
    const warm=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    await page.waitForFunction(n=>window.PFX_COMPLEX?.frames>=n||window.PFX_COMPLEX?.errors?.length||window.PFX_BOOT_ERROR,frames,{timeout:120000});
    // Keep snapshot/PNG timings away from the subsequent pixel-exact verification.
    const state=await page.evaluate(()=>window.PFX_COMPLEX);
    const end=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    const screenshot=PNG.sync.read(await page.screenshot({path:path.join(out,id+'.png'),animations:'disabled'}));
    const verification=spec.mode==='3d'?null:await page.evaluate(()=>window.PFX_VERIFY_COMPLEX());
    const n={full:0,union:0,tileA:0,tileB:0};
    if(spec.mode!=='3d'){
      n.full=1+(spec.strategy==='full'?frames:0);
      if(spec.strategy==='union')n.union=frames;
      if(spec.strategy==='overlap'){n.tileA=frames;n.tileB=frames;}
    }
    const expectedBytes=n.full*1600000+n.union*344064+n.tileA*173056+n.tileB*159744;
    result={
      id,name,round,status:'PASS',mode:spec.mode,strategy:spec.strategy,frames:state.frames,
      cpuFrameMs:stats(state.frameCpuMs.slice(30)),callbackMs:stats(state.frameIntervalsMs.slice(30)),
      velloRasterCallMs:stats(state.rasterCallsMs.slice(1)),
      jsCopyCallMs:stats(state.rgbaCopyMs.slice(1)),
      canvasUploadCallMs:stats(state.putImageDataMs.slice(1)),
      filamentCpuRenderCallMs:stats(state.renderDurationsMs.slice(30)),
      lateCallbacks:state.frameIntervalsMs.filter(x=>x>24).length,
      renderedRegions:state.rendererCounts,expectedRegions:n,
      countedRgbaBytes:state.rgbaTransferBytes,expectedBytes,verification,
      moving2dPixels:spec.mode==='3d'?null:changed(before,screenshot,{x0:450,y0:102,x1:780,y1:348}),
      moving3dPixels:spec.mode==='2d'?null:changed(before,screenshot,{x0:310,y0:245,x1:530,y1:405}),
      jsHeapUsedAt30:warm.JSHeapUsedSize??null,jsHeapUsedAtEnd:end.JSHeapUsedSize??null,
      glVersion:state.gpuVersion,glRenderer:state.gpuRenderer,contextLosses:state.contextLosses,
      errors:[...errors,...state.errors],externalRequests:external,assets:requested
    };
    const failures=[];
    if(result.frames!==frames||state.targetFrames!==frames)failures.push('Wrong frame count');
    if(result.errors.length||external.length)failures.push('Unexpected runtime or off-origin network');
    if(!result.cpuFrameMs||!result.callbackMs)failures.push('Missing timing');
    if(result.countedRgbaBytes!==expectedBytes)failures.push('Wrong transferred byte count');
    for(const key of Object.keys(n))if(state.rendererCounts[key]!==n[key])failures.push('Wrong '+key+' raster calls');
    if(spec.mode==='3d'){
      if(state.vello||requested.some(s=>s.includes('pfx_vello_complex')))failures.push('2D engine loaded in 3D only');
    }else{
      if(!state.vello||state.pixelChecks?.transparent!==0)failures.push('2D source initialization failed');
      if(spec.mode==='2d'&&requested.some(s=>/filament|filamat/.test(s)))failures.push('3D engine loaded in 2D only');
      if(!verification||verification.mismatchesUnion||verification.mismatchesA||
        verification.mismatchesB||verification.mismatchesDisplayed)failures.push('RGBA reference mismatch '+JSON.stringify(verification));
      if(verification?.subpixelAlpha<25)failures.push('Antialiasing not actually exercised');
      if(verification?.overlapPainted<100)failures.push('Overlapping regions contain no painted geometry');
      if(verification?.lastFrame!==frames-1)failures.push('Final geometry step mismatch');
      if(result.moving2dPixels<100)failures.push('Dynamic 2D path movement not visible');
    }
    if(spec.mode!=='2d'){
      if(!state.filament||!state.perspective||state.contextLosses!==0)failures.push('Filament engine not stable');
      if(!result.filamentCpuRenderCallMs||result.moving3dPixels<100)failures.push('No 3D cube motion');
    }
    if(failures.length){result.status='FAIL';result.failures=failures;}
    writeFileSync(path.join(out,id+'.json'),JSON.stringify(result,null,2)+'\n');
    if(failures.length)throw Error(id+': '+failures.join('; '));
    process.stdout.write('PASS '+id+' CPUframeP95='+result.cpuFrameMs.p95+
      ' RAFp95='+result.callbackMs.p95+' bytes='+result.countedRgbaBytes+'\n');
    return result;
  }catch(error){
    writeFileSync(path.join(out,id+'-failure.json'),JSON.stringify({error:String(error),result,errors,external,requested},null,2)+'\n');
    throw error;
  }finally{await context.close();}
}
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,
    args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const schedule=[
      ['3d-only','mixed-full','2d-overlap','mixed-union','2d-full','mixed-overlap','2d-union'],
      ['mixed-overlap','2d-union','3d-only','mixed-full','2d-overlap','mixed-union','2d-full'],
      ['2d-full','mixed-union','mixed-overlap','2d-union','mixed-full','3d-only','2d-overlap']
    ];
    const reports=[];
    for(let i=0;i<schedule.length;i++)for(const name of schedule[i])reports.push(await scenario(browser,origin,name,i+1));
    const aggregate={};
    for(const name of Object.keys(runs)){
      const records=reports.filter(x=>x.name===name);
      aggregate[name]={
        repetitions:records.length,frames:records.reduce((sum,x)=>sum+x.frames,0),
        medianCpuFrameP95Ms:med(records.map(x=>x.cpuFrameMs.p95)),
        medianRafCallbackP95Ms:med(records.map(x=>x.callbackMs.p95)),
        medianVelloRasterP95Ms:med(records.map(x=>x.velloRasterCallMs?.p95).filter(Number.isFinite)),
        medianUploadCallP95Ms:med(records.map(x=>x.canvasUploadCallMs?.p95).filter(Number.isFinite)),
        lateCallbacks:records.reduce((sum,x)=>sum+x.lateCallbacks,0),
        rgbaBytes:records.reduce((sum,x)=>sum+x.countedRgbaBytes,0)
      };
    }
    const summary={status:'PASS',timestamp:new Date().toISOString(),count:reports.length,
      frames:reports.reduce((sum,x)=>sum+x.frames,0),aggregate,schedule,reports,
      caveats:[
        'Manually predetermined two overlapping dirty boxes cover the whole complex moving scene; no general automatic dirty detection.',
        'The Vello paths include cubic, quadratic Bézier curves, subpixel movements and overlapping different-color fills; pixel equality compares full RGBA outputs.',
        'Only source-built Vello CPU WASM and Filament WebGL2 with Chromium SwiftShader; no physical GPU timing or shared device.',
        'RGBA buffer sizes count CPU-to-Canvas2D input, not verified physical GPU transfer or GPU memory.',
        'Source antialiasing behavior may differ across other geometry, clipping, transforms and renderer backends.',
        'Three fresh browser contexts on a single CI runner; GC/scheduling and process memory are not exhaustively controlled.'
      ]};
    writeFileSync(path.join(out,'complex-dirty-summary.json'),JSON.stringify(summary,null,2)+'\n');
    process.stdout.write('SUMMARY '+JSON.stringify({count:summary.count,frames:summary.frames,aggregate})+'\n');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
